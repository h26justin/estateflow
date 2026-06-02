import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import { detectFormat, parsePNE, parseRMS, matchProperties } from '../lib/statementParser'
import { safeOverlayClose } from '../lib/modalUtils'
import MoneyInput from '../lib/MoneyInput'
import { loadCdnScript } from '../lib/loadCdnScript'


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
    pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch (e) {
    // PDF.js throws with .message="Invalid PDF structure" or similar for
    // corrupt/password-protected docs. Surface that, not "undefined".
    throw new Error(e?.message || 'The file does not appear to be a valid PDF')
  }

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // Preserve layout by sorting items by Y then X position
    const items = content.items.sort((a,b) => {
      const yDiff = Math.round(b.transform[5]) - Math.round(a.transform[5])
      return yDiff !== 0 ? yDiff : a.transform[4] - b.transform[4]
    })
    let lastY = null
    for (const item of items) {
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 3) fullText += '\n'
      fullText += item.str + ' '
      lastY = y
    }
    fullText += '\n\n--- PAGE BREAK ---\n\n'
  }
  return fullText
}

// Parsers imported from lib/statementParser.js

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export function StatementImporter({properties, companies, showToast, onClose}) {
  const { T } = useTheme()
  const [step, setStep] = useState('upload') // upload | preview | importing | done
  const [format, setFormat] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [importResults, setImportResults] = useState(null)
  const fileRef = useRef()

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.pdf')) {
      showToast('Please select a PDF file', 'error')
      return
    }
    setLoading(true)
    try {
      const text = await extractPDFText(file)
      const fmt = detectFormat(text)
      let parsed = fmt === 'PNE' ? parsePNE(text) : fmt === 'RMS' ? parseRMS(text) : null

      if (!parsed) {
        showToast('Could not detect statement format (PNE or RMS)', 'error')
        setLoading(false)
        return
      }

      const matched = matchProperties(parsed.items, properties)
      setFormat(fmt)
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

  async function handleImport() {
    setStep('importing')
    const results = { rent: 0, fees: 0, maintenance: 0, errors: [] }

    for (const item of items) {
      if (!item.include) continue
      if (!item.propertyId) {
        results.errors.push(`No property match for: ${item.propertyName}`)
        continue
      }

      try {
        const {data: {user}} = await supabase.auth.getUser()

        if (item.type === 'rent') {
          // Parse period dates — format is "DD/MM/YYYY to DD/MM/YYYY"
          const periodParts = item.period.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/)
          const dateMatch = item.period.match(/(\d{2})\/(\d{2})\/(\d{4})/)
          if (dateMatch) {
            const year = parseInt(dateMatch[3])
            const month = parseInt(dateMatch[2])
            const monthLabel = new Date(year, month-1).toLocaleString('en-GB', {month:'short', year:'numeric'})

            // Convert DD/MM/YYYY to YYYY-MM-DD for storage
            const toIso = (d,m,y) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
            const periodStart = periodParts ? toIso(periodParts[1], periodParts[2], periodParts[3]) : null
            const periodEnd   = periodParts ? toIso(periodParts[4], periodParts[5], periodParts[6]) : null

            // Check if a payment record exists for this month. A month can now
            // hold several dated segments, so take the first rather than .single()
            // (which throws on multiple rows).
            const {data: existing} = await supabase.from('rent_payments')
              .select('id').eq('property_id', item.propertyId).eq('year', year).eq('month', month)
              .order('period_start', { ascending: true, nullsFirst: true })
              .limit(1).maybeSingle()

            if (existing) {
              await supabase.from('rent_payments').update({
                status:'paid', amount:item.editAmount,
                ...(periodStart && { period_start: periodStart }),
                ...(periodEnd   && { period_end:   periodEnd }),
              }).eq('id', existing.id)
            } else {
              await supabase.from('rent_payments').insert({
                property_id: item.propertyId, user_id: user.id,
                month_label: monthLabel, year, month, status: 'paid', amount: item.editAmount,
                ...(periodStart && { period_start: periodStart }),
                ...(periodEnd   && { period_end:   periodEnd }),
              })
            }
            results.rent++
          }
        }

        if (item.type === 'fee') {
          const dateMatch = item.period.match(new RegExp('(\\d{2})\\/(\\d{2})\\/(\\d{4})')) || item.date?.match(new RegExp('(\\w+)\\s+(\\d{4})'))
          const expDate = dateMatch ? `${dateMatch[3]||new Date().getFullYear()}-${(dateMatch[2]||'01').padStart(2,'0')}-01` : new Date().toISOString().split('T')[0]

          await supabase.from('property_expenses').insert({
            property_id: item.propertyId, user_id: user.id,
            category: 'agent_fees',
            description: item.description || 'Management fee',
            amount: item.editAmount,
            date: expDate,
          })
          results.fees++
        }

        if (item.type === 'maintenance') {
          await supabase.from('maintenance_jobs').insert({
            property_id: item.propertyId, user_id: user.id,
            title: item.description || 'Maintenance',
            category: 'other',
            priority: 'medium',
            status: 'complete',
            actual_cost: item.editAmount,
            date_raised: new Date().toISOString().split('T')[0],
          })
          results.maintenance++
        }
      } catch(e) {
        results.errors.push(`Error on ${item.propertyName}: ${e.message}`)
      }
    }

    setImportResults(results)
    setStep('done')
  }

  const typeColor = {rent: T.green, fee: T.amber, maintenance: T.blue}
  const typeIcon  = {rent: '💷', fee: '📋', maintenance: '🔧'}
  const typeLabel = {rent: 'Rent Payment', fee: 'Mgmt Fee', maintenance: 'Maintenance'}

  const includedItems = items.filter(i => i.include)
  const unmatchedItems = items.filter(i => i.include && !i.propertyId)
  const totalToImport = includedItems.reduce((s,i) => s + (i.type==='rent' ? i.editAmount : 0), 0)

  return (
    <div className="overlay" onClick={safeOverlayClose(step !== 'upload' && step !== 'done', onClose)}>
      <div className="modal" style={{maxWidth:720,maxHeight:'90vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>

        {/* Header */}
        <div style={{padding:'20px 24px',borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <h2 style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:2}}>📄 Import Statement</h2>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                {step==='upload'&&'Upload a PNE or RMS rental statement PDF'}
                {step==='preview'&&`${format} Statement · ${parsed?.date} · ${items.length} items found`}
                {step==='importing'&&'Importing data…'}
                {step==='done'&&'Import complete'}
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>

          {/* Step indicator */}
          <div style={{display:'flex',gap:8,marginTop:14}}>
            {['upload','preview','done'].map((s,i)=>(
              <div key={s} style={{display:'flex',alignItems:'center',gap:6}}>
                <div style={{width:20,height:20,borderRadius:'50%',
                  background:step===s?T.gold:['upload','preview','done'].indexOf(step)>i?T.green:T.surface,
                  border:`1px solid ${step===s?T.gold:['upload','preview','done'].indexOf(step)>i?T.green:T.border}`,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:"'DM Mono',monospace",fontSize:9,color:step===s?'black':'white',fontWeight:700}}>
                  {['upload','preview','done'].indexOf(step)>i?'✓':i+1}
                </div>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:step===s?T.gold:T.muted,textTransform:'uppercase'}}>
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
              <div
                onClick={()=>fileRef.current?.click()}
                style={{border:`2px dashed ${T.border}`,borderRadius:12,padding:40,textAlign:'center',cursor:'pointer',transition:'border-color 0.2s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                <div style={{fontSize:40,marginBottom:12}}>📄</div>
                <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:6}}>Drop your statement PDF here</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:16}}>or click to browse</div>
                <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
                  {[{l:'PNE / Propertunity',c:T.gold},{l:'Rook Matthews Sayer',c:T.blue}].map(x=>(
                    <span key={x.l} style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:x.c,background:x.c+'22',padding:'3px 10px',borderRadius:20,border:`1px solid ${x.c}44`}}>{x.l}</span>
                  ))}
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}}
                onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])}/>

              {loading&&(
                <div style={{textAlign:'center',padding:20,fontFamily:"'DM Mono',monospace",color:T.gold,fontSize:12}}>
                  <div style={{marginBottom:8}}>Reading PDF…</div>
                  <div style={{fontSize:10,color:T.muted}}>Extracting text and detecting format</div>
                </div>
              )}

              <div style={{marginTop:20,padding:16,background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>How it works</div>
                <div style={{display:'grid',gap:6}}>
                  {[
                    '1. Upload your PNE or RMS statement PDF',
                    '2. Review the extracted data — edit any amounts or toggle items off',
                    '3. Check property matches — fix any that didn\'t auto-match',
                    '4. Click Confirm Import — rent payments, fees and maintenance are logged instantly',
                  ].map((t,i)=>(
                    <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text}}>{t}</div>
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
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',marginBottom:4}}>{item.l}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:item.c}}>{item.v}</div>
                  </div>
                ))}
              </div>

              {unmatchedItems.length>0&&(
                <div style={{background:'#2B1A0A',border:`1px solid ${T.amber}`,borderRadius:8,padding:'10px 14px',marginBottom:14,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.amber}}>
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
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,
                            color:typeColor[item.type],background:typeColor[item.type]+'22',
                            padding:'1px 6px',borderRadius:20}}>
                            {typeIcon[item.type]} {typeLabel[item.type]}
                          </span>

                          {/* Property match */}
                          {item.propertyId
                            ? <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.green}}>✓ {item.matchedName}</span>
                            : <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.amber}}>⚠ Unmatched</span>
                          }
                        </div>

                        {/* From statement */}
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:4}}>
                          From statement: <span style={{color:T.text}}>{item.propertyName}</span>
                        </div>

                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:6}}>
                          {item.description}
                          {item.tenant&&<span style={{color:T.faint}}> · {item.tenant}</span>}
                        </div>

                        {/* Property override dropdown */}
                        {!item.propertyId&&item.include&&(
                          <div style={{marginTop:4}}>
                            <select
                              value={item.propertyId||''}
                              onChange={e=>{
                                const prop = properties.find(p=>p.id===e.target.value)
                                updateItem(idx,'propertyId',e.target.value)
                                updateItem(idx,'matchedName',prop?.name||'')
                                updateItem(idx,'matched',true)
                              }}
                              style={{fontSize:11,padding:'4px 8px',width:'100%'}}>
                              <option value="">— Select property manually —</option>
                              {[...properties].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>(
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
                              onChange={e=>{
                                const prop = properties.find(p=>p.id===e.target.value)
                                updateItem(idx,'propertyId',e.target.value)
                                updateItem(idx,'matchedName',prop?.name||'')
                              }}
                              style={{fontSize:10,padding:'2px 6px',background:T.bg,border:`1px solid ${T.border}`,color:T.muted,borderRadius:4,width:'auto'}}>
                              {[...properties].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>(
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.faint,marginLeft:4}}>change if wrong</span>
                          </div>
                        )}
                      </div>

                      {/* Amount editor */}
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:3}}>AMOUNT</div>
                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:T.muted}}>£</span>
                          <MoneyInput allowDecimals
                            value={item.editAmount}
                            onChange={v=>updateItem(idx,'editAmount',v||0)}
                            style={{width:90,textAlign:'right',fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,
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
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
                Logging rent payments, fees and maintenance jobs
              </div>
            </div>
          )}

          {/* STEP 4: DONE */}
          {step==='done'&&importResults&&(
            <div style={{textAlign:'center',padding:20}}>
              <div style={{fontSize:40,marginBottom:16}}>✅</div>
              <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:20}}>Import Complete!</div>
              <div style={{display:'grid',gap:8,marginBottom:20,textAlign:'left'}}>
                {[
                  {l:'Rent payments logged', v:importResults.rent, c:T.green},
                  {l:'Management fees logged', v:importResults.fees, c:T.amber},
                  {l:'Maintenance jobs logged', v:importResults.maintenance, c:T.blue},
                ].map((item,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:T.surface,borderRadius:8}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{item.l}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:item.c}}>{item.v}</span>
                  </div>
                ))}
              </div>
              {importResults.errors.length>0&&(
                <div style={{background:'#2B1010',border:`1px solid ${T.red}`,borderRadius:8,padding:12,marginBottom:16,textAlign:'left'}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,marginBottom:6}}>ERRORS</div>
                  {importResults.errors.map((e,i)=>(
                    <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{e}</div>
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
            <div style={{flex:1,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
              {includedItems.length} items selected · {fmt(totalToImport)} rent to log
              {unmatchedItems.length>0&&<span style={{color:T.amber}}> · {unmatchedItems.length} unmatched</span>}
            </div>
            <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setStep('upload')}>← Back</button>
            <button className="btn btn-gold" style={{fontSize:11}} onClick={handleImport}
              disabled={includedItems.filter(i=>i.propertyId).length===0}>
              ✓ Confirm Import ({includedItems.filter(i=>i.propertyId).length} items)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
