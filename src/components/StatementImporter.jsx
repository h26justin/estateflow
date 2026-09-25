import { useState, useRef, useEffect } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import { parseStatement } from '../lib/statementParser'
import { parseForImport, fromLegacyParse } from '../lib/statementImport'
import { extractPdfTextFromFile } from '../lib/pdfExtract'
import { safeOverlayClose } from '../lib/modalUtils'
import { useConfirm } from '../lib/ConfirmContext'
import FocusTrap from '../lib/FocusTrap'
import StatementImportReview from './StatementImportReview'

// ── MANAGING-AGENT STATEMENT IMPORT ─────────────────────────────────────────
// Upload a PNE / RMS statement (or open one received by email), Properly
// reads it, matches every line to company -> property -> tenancy -> rent
// period, and shows the IMPORT REVIEW. Nothing is written until Approve; the
// approved lines become receipts on the Rent Tracker (lib/statementImport.js
// plans it, api/statementImports.js writes it), which the dashboard reads.

// Read the statement: the stream parser first (verified on 71 real PNE / RMS
// statements), the older parser for layouts it does not know.
export function readStatementText(text) {
  const p = parseForImport(text)
  if (p.ok) return p
  const legacy = fromLegacyParse(parseStatement(text))
  if (legacy) return legacy
  return { ...p, problem: p.problem || 'This does not look like a PNE or RMS statement Properly can read.' }
}

export function StatementImporter({properties, companies, showToast, onClose, asPage = false, initialDocIds = null, canEditRent}) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const [step, setStep] = useState('upload') // upload | preview | done
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [sourceDoc, setSourceDoc] = useState(null)   // emailed statement being imported
  const [inbox, setInbox] = useState(null)           // emailed statements awaiting review
  const [parsed, setParsed] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importResults, setImportResults] = useState(null)
  // Learned label -> property mappings, so a spelling corrected once matches
  // outright next time. An empty list on failure falls back to name scoring.
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
  // read-and-review flow as a manual upload.
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
      const f = new File([blob], doc.name || 'statement.pdf', { type: doc.file_type || 'application/pdf' })
      setSourceDoc(doc)
      await handleFile(f, doc)
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

  async function handleFile(f, doc = null) {
    if (!f || !/\.pdf$/i.test(f.name)) {
      showToast('Please select a PDF file', 'error')
      return
    }
    setLoading(true)
    try {
      const text = await extractPdfTextFromFile(f)
      const res = readStatementText(text)
      if (!res.ok) {
        console.warn('StatementImporter: cannot import', f.name, res.problem)
        showToast(res.problem || 'Could not read this statement', 'error')
        setLoading(false)
        return
      }
      setFile(doc ? null : f)   // an emailed statement is already stored
      setFileName(f.name)
      setParsed(res)
      setStep('preview')
    } catch (e) {
      const msg = e?.message || (typeof e === 'string' ? e : null) || 'Unknown error (check console)'
      console.error('StatementImporter:read', e)
      showToast('Error reading PDF: ' + msg, 'error')
    }
    setLoading(false)
  }

  // edit_rent gate: a statement can span companies, so writing is checked per
  // matched property; the page is usable read-only without it.
  const canWriteCompany = (companyId) => typeof canEditRent === 'function' ? !!canEditRent(companyId) : true
  const canWriteProperty = (propertyId) => canWriteCompany(properties.find(p => p.id === propertyId)?.company_id)
  const canEditAnyRent = typeof canEditRent !== 'function' || (companies || []).some(c => canWriteCompany(c.id))
  const steps = ['upload', 'review', 'done']
  const stepIdx = step === 'upload' ? 0 : step === 'preview' ? 1 : 2

  const inner = (
    <>
        {/* Header */}
        <div style={{padding:'20px 24px',borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <h2 id="statement-importer-title" style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:2}}>Import Statement</h2>
              <div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>
                {step==='upload'&&'Upload a PNE or RMS rental statement PDF'}
                {step==='preview'&&`Import review · ${fileName} · ${parsed?.lines.length || 0} lines read`}
                {step==='done'&&'Import complete'}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            {steps.map((s,i)=>(
              <div key={s} style={{display:'flex',alignItems:'center',gap:6}}>
                <div style={{width:20,height:20,borderRadius:'50%',
                  background:stepIdx===i?T.gold:stepIdx>i?T.green:T.surface,
                  border:`1px solid ${stepIdx===i?T.gold:stepIdx>i?T.green:T.border}`,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:MONO,fontSize:9,color:stepIdx===i?'#1C2830':stepIdx>i?'#0E3B27':T.muted,fontWeight:700}}>
                  {stepIdx>i?'✓':i+1}
                </div>
                <span style={{fontFamily:MONO,fontSize:10,color:stepIdx===i?T.gold:T.muted,textTransform:'uppercase'}}>{s}</span>
                {i<2&&<div style={{width:20,height:1,background:T.border}}/>}
              </div>
            ))}
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
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
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>{e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f){setSourceDoc(null); handleFile(f)}}}
                style={{border:`2px dashed ${T.border}`,borderRadius:12,padding:40,textAlign:'center',cursor:'pointer',transition:'border-color 0.2s'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Icon name="file-text" size={36} color={T.faint}/></div>
                <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:6}}>Drop your statement PDF here</div>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:16}}>or click to browse</div>
                <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
                  {[{l:'PNE Asset Management',c:T.gold},{l:'Rook Matthews Sayer',c:T.blue}].map(x=>(
                    <span key={x.l} style={{fontFamily:MONO,fontSize:10,color:x.c,background:x.c+'22',padding:'3px 10px',borderRadius:20,border:`1px solid ${x.c}44`}}>{x.l}</span>
                  ))}
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}}
                onChange={e=>{ if (e.target.files[0]) { setSourceDoc(null); handleFile(e.target.files[0]) } }}/>

              {!canEditAnyRent&&(
                <div style={{marginTop:14,padding:'10px 12px',background:T.amber+'14',border:`1px solid ${T.amber}55`,borderRadius:8,fontFamily:MONO,fontSize:11,color:T.muted}}>
                  You have read-only access to rent in every company you can see, so a statement can be reviewed here but not imported. Ask an admin for the Rent Tracker Editor role.
                </div>
              )}
              {loading&&(
                <div style={{textAlign:'center',padding:20,fontFamily:MONO,color:T.gold,fontSize:12}}>
                  <div style={{marginBottom:8}}>Reading PDF…</div>
                  <div style={{fontSize:10,color:T.muted}}>Extracting the lines and matching them to your properties</div>
                </div>
              )}

              <div style={{marginTop:20,padding:16,background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
                <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>How it works</div>
                <div style={{display:'grid',gap:6}}>
                  {[
                    '1. Upload a PNE or RMS statement. Properly reads every line: rent with its own rent period, fees with VAT, deductions, payments to you.',
                    '2. Each line is matched: company, property, tenancy, rent period, amount. The statement date is never used as the rent month.',
                    '3. Review the exceptions: anything uncertain is marked Needs Review and left out until you check it; lines already recorded show as Duplicate.',
                    '4. Approve. Receipts land on the Rent Tracker periods (several payments for one month stay one month) and the dashboard updates. The PDF and a line-by-line record are kept, and the import can be reverted.',
                  ].map((t,i)=>(
                    <div key={i} style={{fontFamily:MONO,fontSize:11,color:T.text,lineHeight:1.5}}>{t}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step==='preview'&&parsed&&(
            <StatementImportReview parsed={parsed} file={file} fileName={fileName} sourceDoc={sourceDoc}
              properties={properties} companies={companies} aliases={aliases} canWriteProperty={canWriteProperty}
              showToast={showToast} onBack={()=>{ setStep('upload'); setParsed(null) }}
              onDone={res=>{ setImportResults(res); setStep('done') }} />
          )}

          {step==='done'&&importResults&&(
            <div style={{textAlign:'center',padding:20}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><Icon name="check-circle" size={38} color={T.green}/></div>
              <div style={{fontSize:15,fontWeight:600,color:T.text,marginBottom:20}}>Import complete</div>
              <div style={{display:'grid',gap:8,marginBottom:20,textAlign:'left',maxWidth:520,margin:'0 auto 20px'}}>
                {[
                  {l:'Rent receipts recorded on the Rent Tracker', v:importResults.receipts, c:T.green},
                  {l:'Rent periods updated', v:importResults.periodsUpdated + importResults.periodsCreated, c:T.green},
                  {l:'Hand-entered amounts kept as receipts', v:importResults.bridges, c:T.muted},
                  {l:'Agent fees and deductions recorded', v:importResults.expenses, c:T.amber},
                  {l:'Already recorded, skipped', v:importResults.skipped||0, c:T.muted},
                ].map((item,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:T.surface,borderRadius:8}}>
                    <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                    <span style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:item.c}}>{item.v}</span>
                  </div>
                ))}
              </div>
              {importResults.learned>0&&(
                <div style={{background:T.green+'14',border:`1px solid ${T.green}44`,borderRadius:8,padding:'10px 12px',margin:'0 auto 16px',maxWidth:520,textAlign:'left',fontFamily:MONO,fontSize:10,color:T.muted}}>
                  Remembered {importResults.learned} property label{importResults.learned!==1?'s':''} you matched by hand, so future statements match automatically.
                </div>
              )}
              {importResults.errors.length>0&&(
                <div style={{background:T.red+'14',border:`1px solid ${T.red}`,borderRadius:8,padding:12,margin:'0 auto 16px',maxWidth:620,textAlign:'left'}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.red,marginBottom:6}}>NOT RECORDED</div>
                  {importResults.errors.map((e,i)=>(
                    <div key={i} style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{e}</div>
                  ))}
                </div>
              )}
              <div style={{fontFamily:MONO,fontSize:10,color:T.faint,marginBottom:14}}>Batch saved with the original statement and a line-by-line record. Undo from Data import → History.</div>
              <button className="btn btn-gold" style={{fontSize:12}} onClick={onClose}>Close &amp; refresh</button>
            </div>
          )}
        </div>
    </>
  )

  // Routed page mode (#/import): the review table needs the room.
  if (asPage) return (
    <div className="fade" style={{maxWidth: step === 'preview' ? 1400 : 760, margin:'0 auto'}}>
      <div className="card" style={{padding:0,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        {inner}
      </div>
    </div>
  )

  return (
    <div className="overlay" onClick={safeOverlayClose(step !== 'upload' && step !== 'done', onClose, confirmDiscard)}>
      <FocusTrap onEscape={() => safeOverlayClose(step !== 'upload' && step !== 'done', onClose, confirmDiscard)({ target: null, currentTarget: null })}>
      <div className="modal" style={{maxWidth: step === 'preview' ? 1300 : 720, width: step === 'preview' ? '96vw' : undefined, maxHeight:'92vh',overflow:'hidden',display:'flex',flexDirection:'column'}} role="dialog" aria-modal="true" aria-labelledby="statement-importer-title">
        {inner}
      </div>
      </FocusTrap>
    </div>
  )
}
