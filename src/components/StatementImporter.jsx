import { useState, useRef, useEffect } from 'react'
import { MONO } from '../lib/styles'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import { parseStatement, matchProperties, normaliseStatementName } from '../lib/statementParser'
import { linesFromTextItems, textFromPages } from '../lib/pdfText'
import { safeOverlayClose } from '../lib/modalUtils'
import { useConfirm } from '../lib/ConfirmContext'
import FocusTrap from '../lib/FocusTrap'
import MoneyInput from '../lib/MoneyInput'
import { loadCdnScript } from '../lib/loadCdnScript'
import { naturalCompare } from '../lib/addressUtils'
import { sourceRef } from '../lib/csvImport'
import { findOverlappingPaid, periodsIntersect } from '../lib/rentStats'
import { parseLooseDate } from '../lib/tenancyUtils'


const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2}).format(n||0)

// ── PDF TEXT EXTRACTION ───────────────────────────────────────────────────────
// PDF.js v3.11.174 from cdnjs (CSP allow-listed in vercel.json). Loader
// helper surfaces real errors instead of "undefined" if the CDN is blocked.
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174'

async function extractPDFText(file) {
  await loadCdnScript(`${PDFJS_CDN}/pdf.min.js`, 'pdfjsLib')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`

  let pdf
  try {
    const arrayBuffer = await file.arrayBuffer()
    // isEvalSupported:false — CSP no longer allows eval; force pdf.js onto its
    // interpreter path instead of relying on its runtime feature-test.
    pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise
  } catch (e) {
    // PDF.js throws with .message="Invalid PDF structure" or similar for
    // corrupt/password-protected docs. Surface that, not "undefined".
    throw new Error(e?.message || 'The file does not appear to be a valid PDF')
  }

  // Rebuild reading-order lines per page. The viewport transform applies the
  // page rotation, so a landscape statement saved with /Rotate 90 (the 2026
  // RMS layout) reads correctly, and cells whose text wraps stay together.
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    pages.push(linesFromTextItems(content.items, viewport.transform))
  }
  return textFromPages(pages)
}

// Parsers imported from lib/statementParser.js

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
// canEditRent: optional (companyId) => boolean from App.jsx (edit_rent per
// company). When absent every company is treated as writable, matching the
// pre-permission behaviour of this importer.
export function StatementImporter({properties, companies, showToast, onClose, asPage = false, initialDocIds = null, canEditRent}) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const [step, setStep] = useState('upload') // upload | preview | importing | done
  const [format, setFormat] = useState(null)
  const [fileName, setFileName] = useState('')
  const [sourceDoc, setSourceDoc] = useState(null)   // emailed statement being imported
  const [inbox, setInbox] = useState(null)           // emailed statements awaiting review
  const [parsed, setParsed] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [importResults, setImportResults] = useState(null)
  // Learned label → property mappings, so a spelling we've been corrected on
  // before matches outright this time. Loaded up front; an empty list on
  // failure just means we fall back to fuzzy scoring.
  const [aliases, setAliases] = useState([])
  const fileRef = useRef()

  useEffect(() => {
    let live = true
    api.fetchStatementAliases()
      .then(rows => { if (live) setAliases(rows) })
      .catch(e => console.error('StatementImporter:fetchStatementAliases', e))
    return () => { live = false }
  }, [])

  // Emailed statements: list them, and open one straight into the same
  // parse-and-review flow as a manual upload.
  useEffect(() => {
    let live = true
    api.fetchStatementInbox((companies || []).map(c => c.id))
      .then(rows => { if (live) setInbox(rows) })
      .catch(e => { console.error('StatementImporter:fetchStatementInbox', e); if (live) setInbox([]) })
    return () => { live = false }
  }, [companies])
  async function openFromDocument(doc) {
    setLoading(true)
    try {
      const url = await api.getDocumentSignedUrl(doc.file_path, 300)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Could not download the statement (${resp.status})`)
      const blob = await resp.blob()
      const file = new File([blob], doc.name || 'statement.pdf', { type: doc.file_type || 'application/pdf' })
      setSourceDoc(doc)
      await handleFile(file)
    } catch (e) {
      showToast(e?.message || 'Could not open the emailed statement', 'error')
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!initialDocIds?.length || !inbox?.length || sourceDoc || step !== 'upload') return
    const doc = inbox.find(d => initialDocIds.includes(d.id))
    if (doc) openFromDocument(doc)
  }, [initialDocIds, inbox]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.pdf')) {
      showToast('Please select a PDF file', 'error')
      return
    }
    setLoading(true)
    try {
      const text = await extractPDFText(file)
      const res = parseStatement(text)
      if (!res.parsed || res.problem) {
        // Leave a trace for support: which signatures matched and how much text
        // there was, without dumping tenant data into the console.
        console.warn('StatementImporter: cannot import', file.name, res.detail)
        showToast(res.problem || 'Could not read this statement', 'error')
        setLoading(false)
        return
      }
      const fmt = res.format
      const parsed = res.parsed

      const matched = matchProperties(parsed.items, properties, aliases)
      setFormat(fmt)
      setFileName(file.name)
      setParsed(parsed)
      setItems(matched)
      setStep('preview')
    } catch(e) {
      // Defence in depth: e might be a string, an Event (script onerror),
      // or any object — guard against `undefined.message`.
      const msg = e?.message || (typeof e === 'string' ? e : null) || 'Unknown error (check console)'
      console.error('StatementImporter:extractPDFText', e)
      showToast('Error reading PDF: ' + msg, 'error')
    }
    setLoading(false)
  }

  function updateItem(idx, field, value) {
    setItems(prev => prev.map((item, i) => i === idx ? {...item, [field]: value} : item))
  }

  // The user picking a property by hand is the signal that our match was
  // wrong (or missing). Flag it here; handleImport persists the correction as
  // an alias once they actually commit the import, so idly opening and
  // closing the dropdown doesn't teach us anything.
  function assignProperty(idx, propertyId) {
    const prop = properties.find(p => p.id === propertyId)
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      propertyId,
      matchedName: prop?.name || '',
      matched: !!propertyId,
      matchedVia: propertyId ? 'manual' : null,
    } : item))
  }

  // Remember every label the user corrected by hand, so next month's
  // statement matches it without help. One row per distinct label — a
  // statement lists the same property on its rent, fee and maintenance lines.
  async function learnAliases(committed) {
    const seen = new Set()
    for (const item of committed) {
      if (item.matchedVia !== 'manual' || !item.propertyId || !item.propertyName) continue
      const norm = normaliseStatementName(item.propertyName)
      // Nothing to learn when the label already normalises to the chosen
      // property's own name — the matcher handles that case unaided.
      const prop = properties.find(p => p.id === item.propertyId)
      if (!norm || seen.has(norm) || norm === normaliseStatementName(prop?.name)) continue
      seen.add(norm)
      try {
        await api.saveStatementAlias(item.propertyId, item.propertyName, norm)
      } catch (e) {
        // A failed alias write must never fail the import — the money is
        // already logged by this point.
        console.error('StatementImporter:saveStatementAlias', e)
      }
    }
    return seen.size
  }

  async function handleImport() {
    setStep('importing')
    const results = { rent: 0, fees: 0, maintenance: 0, learned: 0, skipped: 0, errors: [], batchId: null }
    const stmtKey = String(parsed?.statementNo || parsed?.date || fileName || 'statement').trim()
    const toIso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const todayIso = new Date().toISOString().split('T')[0]

    const {data: {user}} = await supabase.auth.getUser()

    // Every statement import is a batch, written FIRST so anything that lands
    // is attributable and reversible (Data import → History → Revert). Before
    // this, statement rows carried no provenance at all.
    // Company for the batch history filter: the company most of the matched
    // properties belong to (a statement is per landlord, so normally all).
    const companyIds = items.filter(i => i.include && i.propertyId)
      .map(i => properties.find(p => p.id === i.propertyId)?.company_id).filter(Boolean)
    const companyId = companyIds.length
      ? [...new Set(companyIds)].sort((a, b) => companyIds.filter(x => x === a).length - companyIds.filter(x => x === b).length).pop()
      : null
    let batch = null
    try {
      const { data, error } = await supabase.from('import_batches').insert({
        user_id: user.id, company_id: companyId, kind: 'mixed', source: 'statement',
        filename: fileName || null,
        notes: `${format || 'Agent'} statement ${stmtKey}. Rent and fees revert with the batch; maintenance jobs do not.`,
      }).select().single()
      if (error) throw error
      batch = data
      results.batchId = batch.id
    } catch (e) {
      // A missing batch row must not block logging the money, but say so.
      console.error('StatementImporter:import_batches', e)
      results.errors.push(`Could not record an import batch (${e.message}); rows were still written but cannot be reverted as a group.`)
    }
    const undo = []
    let created = 0, updated = 0

    for (const item of items) {
      if (!item.include) continue
      if (!item.propertyId) {
        results.errors.push(`No property match for: ${item.propertyName}`)
        continue
      }
      // Per-row permission check at commit time. The button is disabled when
      // any included row is blocked, but this keeps a stale click from writing
      // rows that RLS would reject one at a time with a less useful error.
      if (!canWriteProperty(item.propertyId)) {
        results.errors.push(`${item.propertyName}: you have read-only access to rent for this company`)
        continue
      }

      try {
        if (item.type === 'rent') {
          // Period is "DD/MM/YYYY to DD/MM/YYYY"
          const periodParts = item.period.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/)
          const dateMatch = item.period.match(/(\d{2})\/(\d{2})\/(\d{4})/)
          if (!dateMatch) {
            results.errors.push(`${item.propertyName}: could not read the rent period "${item.period}"`)
            continue
          }
          const year = parseInt(dateMatch[3])
          const month = parseInt(dateMatch[2])
          const monthLabel = new Date(year, month-1).toLocaleString('en-GB', {month:'short', year:'numeric'})
          const monthStart = `${year}-${String(month).padStart(2,'0')}-01`
          const monthEnd   = `${year}-${String(month).padStart(2,'0')}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`
          const periodStart = periodParts ? toIso(periodParts[1], periodParts[2], periodParts[3]) : monthStart
          const periodEnd   = periodParts ? toIso(periodParts[4], periodParts[5], periodParts[6]) : monthEnd
          const ref = sourceRef('stmt', [format, stmtKey, item.propertyId, periodStart, periodEnd])

          // Candidate rows: anything on this property whose period shares a
          // day with the statement period (across month boundaries — a 7 May
          // to 6 Jun cycle must see June's row), plus legacy whole-month rows
          // for the arrival month that carry no period dates.
          const {data: candidates, error: qErr} = await supabase.from('rent_payments')
            .select('id, period_start, period_end, status, amount, source_ref, import_batch_id')
            .eq('property_id', item.propertyId)
            .or(`and(period_start.lte.${periodEnd},period_end.gte.${periodStart}),and(year.eq.${year},month.eq.${month},period_start.is.null)`)
            .order('period_start', { ascending: true, nullsFirst: true })
          if (qErr) throw qErr
          const rows = candidates || []

          // Same statement line already imported → nothing to do.
          if (rows.some(r => r.source_ref === ref)) { results.skipped++; continue }

          // Prefer a row with exactly these bounds, then a legacy whole-month
          // row, then an intersecting non-paid row (a pre-generated void).
          const exact = rows.find(r => r.period_start === periodStart && r.period_end === periodEnd)
          const legacy = rows.find(r => !r.period_start)
          const fillable = rows.find(r => r.status !== 'paid' && periodsIntersect(r.period_start, r.period_end, periodStart, periodEnd))
          const existing = exact || legacy || fillable || null

          // Double-count guard: a DIFFERENT paid row with a real amount already
          // covers some of these days. Never overwrite money with money.
          const clash = findOverlappingPaid(rows, periodStart, periodEnd, existing?.id || null)
          if (clash) {
            results.errors.push(`${item.propertyName}: rent of £${Number(clash.amount).toFixed(2)} is already recorded for ${clash.period_start} to ${clash.period_end}, which covers some of the same days as ${periodStart} to ${periodEnd}. Skipped so it is not counted twice.`)
            results.skipped++
            continue
          }
          if (existing && existing.status === 'paid' && existing.amount != null
              && Number(existing.amount) === Number(item.editAmount)) {
            // Already recorded with the same figure (e.g. keyed by hand).
            // Stamp provenance so the next import recognises it, but change
            // nothing financial.
            if (!existing.source_ref) {
              await supabase.from('rent_payments').update({ source_ref: ref }).eq('id', existing.id)
            }
            results.skipped++
            continue
          }

          let periodRowId = existing?.id || null
          if (existing) {
            undo.push({ table: 'rent_payments', id: existing.id, status: existing.status, amount: existing.amount,
                        period_start: existing.period_start, period_end: existing.period_end,
                        source_ref: existing.source_ref, import_batch_id: existing.import_batch_id })
            const { error } = await supabase.from('rent_payments').update({
              status: 'paid', amount: item.editAmount,
              period_start: periodStart, period_end: periodEnd,
              source_ref: ref, ...(batch ? { import_batch_id: batch.id } : {}),
            }).eq('id', existing.id)
            if (error) throw error
            updated++
          } else {
            const { data: ins, error } = await supabase.from('rent_payments').insert({
              property_id: item.propertyId, user_id: user.id,
              month_label: monthLabel, year, month, status: 'paid', amount: item.editAmount,
              period_start: periodStart, period_end: periodEnd,
              source_ref: ref, ...(batch ? { import_batch_id: batch.id } : {}),
            }).select('id').single()
            if (error) {
              if (error.code === '23505') { results.skipped++; continue }
              throw error
            }
            periodRowId = ins?.id || null
            created++
          }
          results.rent++
          // The statement line is also a RECEIPT: dated money allocated to the
          // period, so the traffic-light engine and the collection rate read
          // it directly. Same source_ref, so a re-import is refused by the
          // unique index rather than duplicated.
          try {
            const received = parseLooseDate(parsed?.date) || periodEnd
            await api.createReceipt({
              property_id: item.propertyId, company_id: companyId, received_date: received,
              amount: item.editAmount, payer: 'tenant', source: 'statement', source_ref: ref,
              import_batch_id: batch?.id || null, reference: `${format || 'Agent'} statement ${stmtKey}`,
              notes: item.tenant ? `Tenant on statement: ${item.tenant}` : null,
            }, periodRowId ? [{ target: 'current_rent', rent_payment_id: periodRowId, amount: item.editAmount }] : [], { allowUnallocated: !periodRowId })
          } catch (e) {
            if (!/already been recorded/i.test(e.message || '')) results.errors.push(`${item.propertyName}: rent logged but the receipt could not be recorded (${e.message})`)
          }
        }

        if (item.type === 'fee') {
          const dateMatch = item.period.match(new RegExp('(\\d{2})\\/(\\d{2})\\/(\\d{4})')) || item.date?.match(new RegExp('(\\w+)\\s+(\\d{4})'))
          const expDate = dateMatch ? `${dateMatch[3]||new Date().getFullYear()}-${(dateMatch[2]||'01').padStart(2,'0')}-01` : todayIso
          const ref = sourceRef('stmtfee', [format, stmtKey, item.propertyId, item.description || '', item.editAmount, expDate])
          const { error } = await supabase.from('property_expenses').insert({
            property_id: item.propertyId, user_id: user.id,
            category: 'agent_fees',
            description: item.description || 'Management fee',
            amount: item.editAmount,
            date: expDate,
            source_ref: ref, ...(batch ? { import_batch_id: batch.id } : {}),
          })
          if (error) {
            // Unique (user, source_ref): this fee line was imported before.
            if (error.code === '23505') { results.skipped++; continue }
            throw error
          }
          created++
          results.fees++
        }

        if (item.type === 'maintenance') {
          // maintenance_jobs has no source_ref column, so the statement key is
          // carried in the description and checked before inserting.
          const description = `From ${format || 'agent'} statement ${stmtKey}`
          const title = item.description || 'Maintenance'
          const { data: dupes, error: dErr } = await supabase.from('maintenance_jobs')
            .select('id').eq('property_id', item.propertyId).eq('title', title)
            .eq('actual_cost', item.editAmount).eq('description', description).is('deleted_at', null).limit(1)
          if (dErr) throw dErr
          if (dupes && dupes.length) { results.skipped++; continue }
          const { error } = await supabase.from('maintenance_jobs').insert({
            property_id: item.propertyId, user_id: user.id,
            title, description,
            category: 'other',
            priority: 'medium',
            status: 'complete',
            actual_cost: item.editAmount,
            date_raised: todayIso,
          })
          if (error) throw error
          results.maintenance++
        }
      } catch(e) {
        results.errors.push(`Error on ${item.propertyName}: ${e.message}`)
      }
    }

    if (batch) {
      await supabase.from('import_batches').update({
        rows_created: created, rows_updated: updated, rows_skipped: results.skipped,
        meta: { undo, failed_count: results.errors.length },
      }).eq('id', batch.id).then(({ error }) => { if (error) console.error('StatementImporter:batch update', error) })
    }

    results.learned = await learnAliases(items.filter(i => i.include))
    if (sourceDoc) {
      try { await api.markStatementImported(sourceDoc.id, { batch_id: batch?.id || null, rent: results.rent, fees: results.fees, skipped: results.skipped }) }
      catch (e) { console.error('StatementImporter:markStatementImported', e) }
    }

    setImportResults(results)
    setStep('done')
  }

  const typeColor = {rent: T.green, fee: T.amber, maintenance: T.blue}
  const typeIcon  = {rent: '💷', fee: '📋', maintenance: '🔧'}
  const typeLabel = {rent: 'Rent Payment', fee: 'Mgmt Fee', maintenance: 'Maintenance'}

  const includedItems = items.filter(i => i.include)
  const unmatchedItems = items.filter(i => i.include && !i.propertyId)

  // ── edit_rent gate ────────────────────────────────────────────────────
  // A statement can carry several landlords' properties, so the target
  // company is only known per matched line. Gate the whole workflow on having
  // edit_rent SOMEWHERE (otherwise nothing could ever be written) and the
  // commit button on every matched line being writable.
  const canWriteCompany = (companyId) => typeof canEditRent === 'function' ? !!canEditRent(companyId) : true
  const canWriteProperty = (propertyId) => canWriteCompany(properties.find(p => p.id === propertyId)?.company_id)
  const canEditAnyRent = typeof canEditRent !== 'function' || (companies || []).some(c => canWriteCompany(c.id))
  const blockedByPermission = includedItems.filter(i => i.propertyId && !canWriteProperty(i.propertyId))
  const readyCount = includedItems.filter(i => i.propertyId).length
  const commitBlocked = !canEditAnyRent || blockedByPermission.length > 0
  const totalToImport = includedItems.reduce((s,i) => s + (i.type==='rent' ? i.editAmount : 0), 0)

  // Header + steps + content, shared between the routed page (#/import) and
  // the legacy modal shell.
  const inner = (
    <>

        {/* Header */}
        <div style={{padding:'20px 24px',borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <h2 id="statement-importer-title" style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:2}}>Import Statement</h2>
              <div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>
                {step==='upload'&&'Upload a PNE or RMS rental statement PDF'}
                {step==='preview'&&`${format} Statement · ${parsed?.date} · ${items.length} items found`}
                {step==='importing'&&'Importing data…'}
                {step==='done'&&'Import complete'}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>

          {/* Step indicator */}
          <div style={{display:'flex',gap:8,marginTop:14}}>
            {['upload','preview','done'].map((s,i)=>(
              <div key={s} style={{display:'flex',alignItems:'center',gap:6}}>
                <div style={{width:20,height:20,borderRadius:'50%',
                  background:step===s?T.gold:['upload','preview','done'].indexOf(step)>i?T.green:T.surface,
                  border:`1px solid ${step===s?T.gold:['upload','preview','done'].indexOf(step)>i?T.green:T.border}`,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:MONO,fontSize:9,color:step===s?'#1C2830':['upload','preview','done'].indexOf(step)>i?'#0E3B27':T.muted,fontWeight:700}}>
                  {['upload','preview','done'].indexOf(step)>i?'✓':i+1}
                </div>
                <span style={{fontFamily:MONO,fontSize:10,color:step===s?T.gold:T.muted,textTransform:'uppercase'}}>
                  {s}
                </span>
                {i<2&&<div style={{width:20,height:1,background:T.border}}/>}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>

          {/* STEP 1: UPLOAD */}
          {step==='upload'&&(
            <div>
              {inbox && inbox.length > 0 && (
                <div style={{marginBottom:16,border:`1px solid ${T.border}`,borderRadius:12,padding:'14px 16px'}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Statements received by email</div>
                  <div style={{display:'grid',gap:6}}>
                    {inbox.slice(0,12).map(d=>{
                      const done = d.extracted_fields?.import?.at
                      const co = (companies||[]).find(c=>c.id===d.property?.company_id)
                      return (
                        <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:T.bg,borderRadius:8,flexWrap:'wrap'}}>
                          <span style={{fontFamily:MONO,fontSize:10,color:T.muted,width:84}}>{new Date(d.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                          <span style={{fontSize:12,color:T.text,flex:1,minWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</span>
                          {co && <span style={{fontFamily:MONO,fontSize:9,color:co.color||T.gold}}>{co.abbr||co.name}</span>}
                          {done
                            ? <span style={{fontFamily:MONO,fontSize:10,color:T.green}}>Imported {new Date(done).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                            : <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>openFromDocument(d)} disabled={loading}>Review &amp; import</button>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div
                onClick={()=>fileRef.current?.click()}
                style={{border:`2px dashed ${T.border}`,borderRadius:12,padding:40,textAlign:'center',cursor:'pointer',transition:'border-color 0.2s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Icon name="file-text" size={36} color={T.faint}/></div>
                <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:6}}>Drop your statement PDF here</div>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:16}}>or click to browse</div>
                <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
                  {[{l:'PNE / Propertunity',c:T.gold},{l:'Rook Matthews Sayer',c:T.blue}].map(x=>(
                    <span key={x.l} style={{fontFamily:MONO,fontSize:10,color:x.c,background:x.c+'22',padding:'3px 10px',borderRadius:20,border:`1px solid ${x.c}44`}}>{x.l}</span>
                  ))}
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}}
                onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])}/>

              {!canEditAnyRent&&(
                <div style={{marginTop:14,padding:'10px 12px',background:T.amber+'14',border:`1px solid ${T.amber}55`,borderRadius:8,fontFamily:MONO,fontSize:11,color:T.muted}}>
                  You have read-only access to rent in every company you can see, so a statement can be reviewed here but not imported. Ask an admin for the Rent Tracker Editor role.
                </div>
              )}

              {loading&&(
                <div style={{textAlign:'center',padding:20,fontFamily:MONO,color:T.gold,fontSize:12}}>
                  <div style={{marginBottom:8}}>Reading PDF…</div>
                  <div style={{fontSize:10,color:T.muted}}>Extracting text and detecting format</div>
                </div>
              )}

              <div style={{marginTop:20,padding:16,background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
                <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>How it works</div>
                <div style={{display:'grid',gap:6}}>
                  {[
                    '1. Upload your PNE or RMS statement PDF',
                    '2. Review the extracted data — edit any amounts or toggle items off',
                    '3. Check property matches — fix any that didn\'t auto-match',
                    '4. Click Confirm Import — rent payments, fees and maintenance are logged instantly',
                  ].map((t,i)=>(
                    <div key={i} style={{fontFamily:MONO,fontSize:11,color:T.text}}>{t}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PREVIEW */}
          {step==='preview'&&(
            <div>
              {/* Summary */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
                {[
                  {l:'Rent Income',   v:fmt(parsed.totalIncome||items.filter(i=>i.type==='rent').reduce((s,i)=>s+i.editAmount,0)), c:T.green},
                  {l:'Management Fees', v:fmt(parsed.totalFees||items.filter(i=>i.type==='fee').reduce((s,i)=>s+i.editAmount,0)), c:T.amber},
                  {l:'Items to Import', v:`${includedItems.length} of ${items.length}`, c:T.gold},
                ].map((item,i)=>(
                  <div key={i} style={{background:T.bg,borderRadius:8,padding:'12px 14px'}}>
                    <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',marginBottom:4}}>{item.l}</div>
                    <div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:item.c}}>{item.v}</div>
                  </div>
                ))}
              </div>

              {unmatchedItems.length>0&&(
                <div style={{background:T.amber+'1A',border:`1px solid ${T.amber}`,borderRadius:8,padding:'10px 14px',marginBottom:14,fontFamily:MONO,fontSize:11,color:T.amber}}>
                  ⚠ {unmatchedItems.length} item{unmatchedItems.length!==1?'s':''} couldn't be matched to a property automatically. Please assign them below or toggle them off.
                </div>
              )}

              {/* Item rows */}
              <div style={{display:'grid',gap:8}}>
                {items.map((item, idx)=>(
                  <div key={idx} style={{
                    background:item.include?T.surface:T.bg,
                    border:`1px solid ${item.include?(item.propertyId?T.border:T.amber):T.faint}`,
                    borderRadius:10,padding:'12px 14px',opacity:item.include?1:0.5,
                    transition:'all 0.2s'
                  }}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:10,flexWrap:'wrap'}}>
                      {/* Toggle */}
                      <div onClick={()=>updateItem(idx,'include',!item.include)}
                        style={{width:20,height:20,borderRadius:4,border:`2px solid ${item.include?typeColor[item.type]:T.border}`,
                          background:item.include?typeColor[item.type]:'transparent',cursor:'pointer',flexShrink:0,marginTop:2,
                          display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'black',fontWeight:700}}>
                        {item.include?'✓':''}
                      </div>

                      <div style={{flex:1,minWidth:200}}>
                        {/* Type badge + property name */}
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
                          <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,
                            color:typeColor[item.type],background:typeColor[item.type]+'22',
                            padding:'1px 6px',borderRadius:20}}>
                            {typeIcon[item.type]} {typeLabel[item.type]}
                          </span>

                          {/* Property match */}
                          {item.propertyId
                            ? <span style={{fontFamily:MONO,fontSize:10,color:T.green}}>
                                ✓ {item.matchedName}
                                {item.matchedVia==='alias'&&<span style={{color:T.faint}}> · remembered label</span>}
                              </span>
                            : <span style={{fontFamily:MONO,fontSize:10,color:T.amber}}>Unmatched</span>
                          }
                        </div>

                        {/* From statement */}
                        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,marginBottom:4}}>
                          From statement: <span style={{color:T.text}}>{item.propertyName}</span>
                        </div>

                        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,marginBottom:6}}>
                          {item.description}
                          {item.tenant&&<span style={{color:T.faint}}> · {item.tenant}</span>}
                        </div>

                        {/* Property override dropdown */}
                        {!item.propertyId&&item.include&&(
                          <div style={{marginTop:4}}>
                            <select
                              value={item.propertyId||''}
                              onChange={e=>assignProperty(idx, e.target.value)}
                              style={{fontSize:11,padding:'4px 8px',width:'100%'}}>
                              <option value="">— Select property manually —</option>
                              {[...properties].sort((a,b)=>naturalCompare(a.name, b.name)).map(p=>(
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Property override even if matched */}
                        {item.propertyId&&(
                          <div style={{marginTop:4}}>
                            <select
                              value={item.propertyId}
                              onChange={e=>assignProperty(idx, e.target.value)}
                              style={{fontSize:10,padding:'2px 6px',background:T.bg,border:`1px solid ${T.border}`,color:T.muted,borderRadius:4,width:'auto'}}>
                              {[...properties].sort((a,b)=>naturalCompare(a.name, b.name)).map(p=>(
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <span style={{fontFamily:MONO,fontSize:9,color:T.faint,marginLeft:4}}>
                              {item.matchedVia==='manual'
                                ? 'we\'ll remember this label next time'
                                : 'change if wrong'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Amount editor */}
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontFamily:MONO,fontSize:9,color:T.muted,marginBottom:3}}>AMOUNT</div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontFamily:MONO,fontSize:13,color:T.muted}}>£</span>
                          <MoneyInput allowDecimals
                            value={item.editAmount}
                            onChange={v=>updateItem(idx,'editAmount',v||0)}
                            style={{width:90,textAlign:'right',fontFamily:MONO,fontSize:13,fontWeight:700,
                              color:typeColor[item.type],padding:'3px 6px'}}/>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: IMPORTING */}
          {step==='importing'&&(
            <div style={{textAlign:'center',padding:40}}>
              <div style={{fontSize:40,marginBottom:16}}>⏳</div>
              <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:8}}>Importing data…</div>
              <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>
                Logging rent payments, fees and maintenance jobs
              </div>
            </div>
          )}

          {/* STEP 4: DONE */}
          {step==='done'&&importResults&&(
            <div style={{textAlign:'center',padding:20}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><Icon name="check-circle" size={38} color={T.green}/></div>
              <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:20}}>Import Complete!</div>
              <div style={{display:'grid',gap:8,marginBottom:20,textAlign:'left'}}>
                {[
                  {l:'Rent payments logged', v:importResults.rent, c:T.green},
                  {l:'Management fees logged', v:importResults.fees, c:T.amber},
                  {l:'Maintenance jobs logged', v:importResults.maintenance, c:T.blue},
                  {l:'Already recorded, skipped', v:importResults.skipped||0, c:T.muted},
                ].map((item,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:T.surface,borderRadius:8}}>
                    <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                    <span style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:item.c}}>{item.v}</span>
                  </div>
                ))}
              </div>
              {importResults.learned>0&&(
                <div style={{background:T.green+'14',border:`1px solid ${T.green}44`,borderRadius:8,padding:'10px 12px',marginBottom:16,textAlign:'left',fontFamily:MONO,fontSize:10,color:T.muted}}>
                  Remembered {importResults.learned} property label{importResults.learned!==1?'s':''} you corrected — future statements using {importResults.learned!==1?'those spellings':'that spelling'} will match automatically.
                </div>
              )}
              {importResults.errors.length>0&&(
                <div style={{background:T.red+'14',border:`1px solid ${T.red}`,borderRadius:8,padding:12,marginBottom:16,textAlign:'left'}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.red,marginBottom:6}}>ERRORS</div>
                  {importResults.errors.map((e,i)=>(
                    <div key={i} style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{e}</div>
                  ))}
                </div>
              )}
              <button className="btn btn-gold" style={{fontSize:12}} onClick={onClose}>Close & Refresh</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step==='preview'&&(
          <div style={{padding:'16px 24px',borderTop:`1px solid ${T.border}`,flexShrink:0,display:'flex',gap:10,alignItems:'center'}}>
            <div style={{flex:1,fontFamily:MONO,fontSize:11,color:T.muted}}>
              {includedItems.length} items selected · {fmt(totalToImport)} rent to log
              {unmatchedItems.length>0&&<span style={{color:T.amber}}> · {unmatchedItems.length} unmatched</span>}
              {blockedByPermission.length>0&&<div style={{color:T.amber,marginTop:4}}>
                {blockedByPermission.length} item{blockedByPermission.length!==1?'s':''} matched to a company where you have read-only access to rent. Untick {blockedByPermission.length!==1?'them':'it'} or ask an admin for the Rent Tracker Editor role.
              </div>}
            </div>
            <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setStep('upload')}>← Back</button>
            <button className="btn btn-gold" style={{fontSize:11}} onClick={handleImport}
              disabled={readyCount===0 || commitBlocked}
              title={commitBlocked ? 'You have read-only access to rent for one or more of these companies' : ''}>
              Confirm Import ({readyCount} items)
            </button>
          </div>
        )}
    </>
  )

  // Routed page mode (#/import): a multi-step reconcile workflow deserves a
  // page, not a modal — no nested scroll box, no accidental backdrop close.
  if (asPage) return (
    <div className="fade" style={{maxWidth:760,margin:'0 auto'}}>
      <div className="card" style={{padding:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        {inner}
      </div>
    </div>
  )

  return (
    <div className="overlay" onClick={safeOverlayClose(step !== 'upload' && step !== 'done', onClose, confirmDiscard)}>
      <FocusTrap onEscape={() => safeOverlayClose(step !== 'upload' && step !== 'done', onClose, confirmDiscard)({ target: null, currentTarget: null })}>
      <div className="modal" style={{maxWidth:720,maxHeight:'90vh',overflow:'hidden',display:'flex',flexDirection:'column'}} role="dialog" aria-modal="true" aria-labelledby="statement-importer-title">
        {inner}
      </div>
      </FocusTrap>
    </div>
  )
}
