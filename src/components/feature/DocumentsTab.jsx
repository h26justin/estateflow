import { useState, useEffect } from 'react'
import { SignedPhoto } from '../../lib/SignedPhoto'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, CV, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { logError } from '../../lib/logError'
import { NotesTimeline } from './NotesTimeline'
import { Icon } from '../../lib/icons'
import { SkeletonRows } from '../../lib/Skeleton'
import { EmptyState } from '../ui'

// ── DOCUMENTS TAB ────────────────────────────────────────────────────────────
const DOC_CATEGORIES = [
  {value:'tenancy',     label:'Tenancy Agreement',  icon:'file-text'},
  {value:'gas',         label:'Gas Safety',          icon:'flame'},
  {value:'eicr',        label:'EICR / Electric',     icon:'zap'},
  {value:'epc',         label:'EPC',                 icon:'home'},
  {value:'insurance',   label:'Insurance',           icon:'shield-check'},
  {value:'mortgage',    label:'Mortgage',            icon:'landmark'},
  {value:'inventory',   label:'Inventory',           icon:'clipboard-check'},
  {value:'legal',       label:'Legal',               icon:'scale'},
  {value:'maintenance', label:'Maintenance',         icon:'wrench'},
  {value:'photos',      label:'Photos',              icon:'grid-2'},
  {value:'other',       label:'Other',               icon:'file-text'},
]

export function DocumentsTab({propertyId, propertyName, showToast, isAdmin, user}) {
  const { T } = useTheme()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('other')
  const [filterCategory, setFilterCategory] = useState('all')
  const [docName, setDocName] = useState('')
  // OCR state
  const [expandedOcrId, setExpandedOcrId] = useState(null)
  const [ocrRunning, setOcrRunning] = useState(null)
  // Map of documentId -> linked compliance_items.id (or null if not linked).
  // Loaded lazily on demand when a doc card expands.
  const [complianceLinks, setComplianceLinks] = useState({})
  const [complianceBusy, setComplianceBusy] = useState(null)
  const fileInputRef = useState(null)
  const inputRef = { current: null }

  // When a doc panel expands, check if it's already linked to a compliance row.
  async function ensureComplianceLink(doc) {
    if (complianceLinks[doc.id] !== undefined) return  // cached
    try {
      const link = await api.fetchComplianceForDocument(doc.id)
      setComplianceLinks(prev => ({ ...prev, [doc.id]: link?.id || null }))
    } catch (e) {
      // If the column doesn't exist yet (migration not run), fail silent
      setComplianceLinks(prev => ({ ...prev, [doc.id]: null }))
    }
  }

  async function addToCompliance(doc) {
    setComplianceBusy(doc.id)
    try {
      const candidate = api.buildComplianceFromDoc(doc)
      if (!candidate) { showToast('Could not auto-detect cert details', 'error'); return }
      const created = await api.createCompliance(propertyId, candidate)
      setComplianceLinks(prev => ({ ...prev, [doc.id]: created.id }))
      showToast(`Added ${candidate.cert_name} to Compliance`)
    } catch (e) {
      showToast('Failed to add: ' + (e.message || 'unknown'), 'error')
    }
    setComplianceBusy(null)
  }

  const beginLoad = useLoadGuard()
  useEffect(()=>{ loadDocs() },[propertyId])

  async function loadDocs() {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const {data} = await supabase.from('property_documents')
        .select('*').eq('property_id', propertyId)
        .is('deleted_at', null)
        .order('created_at', {ascending:false})
      if (!isCurrent()) return
      setDocs(data||[])
    } catch(e) {
      if (!isCurrent()) return
      logError('DocumentsTab:loadDocs', e)
    }
    setLoading(false)
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return
    setUploading(true)
    let uploaded = 0

    for (const file of Array.from(files)) {
      try {
        const {data:{user:u}} = await supabase.auth.getUser()
        const ext = file.name.split('.').pop()
        const filePath = `${u.id}/${propertyId}/${Date.now()}-${file.name}`

        // Upload to Supabase Storage (private bucket).
        const {data:uploadData, error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})

        if (uploadErr) throw uploadErr

        // Save record to DB. We deliberately DO NOT store a public URL anymore —
        // the bucket is private and signed URLs are minted on demand at view time.
        // file_url is left blank for new uploads; older rows may still have a stale
        // public URL but it won't work and we ignore it during render.
        const {error:dbErr} = await supabase.from('property_documents').insert({
          property_id: propertyId,
          user_id: u.id,
          name: docName || file.name,
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
          category: selectedCategory,
        })

        if (dbErr) throw dbErr
        uploaded++
      } catch(e) {
        showToast('Upload failed: ' + e.message, 'error')
      }
    }

    if (uploaded > 0) {
      showToast(uploaded + ' document' + (uploaded>1?'s':'') + ' uploaded')
      setDocName('')
      await loadDocs()
    }
    setUploading(false)
  }

  async function handleDelete(doc) {
    try {
      const { data: { user: u } } = await supabase.auth.getUser()
      // Soft-delete: flip deleted_at/deleted_by. Keep Storage file intact
      // so the doc can be restored from Trash for 30 days.
      const { error } = await supabase.from('property_documents')
        .update({ deleted_at: new Date().toISOString(), deleted_by: u?.id })
        .eq('id', doc.id)
      if (error) throw error
      setDocs(prev => prev.filter(d => d.id !== doc.id))
      showToast('Document moved to Trash')
    } catch(e) {
      showToast(e.message, 'error')
    }
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB'
    return (bytes/(1024*1024)).toFixed(1) + ' MB'
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
  }

  function getCatInfo(val) {
    return DOC_CATEGORIES.find(c=>c.value===val) || DOC_CATEGORIES[DOC_CATEGORIES.length-1]
  }

  const filtered = filterCategory==='all' ? docs : docs.filter(d=>d.category===filterCategory)
  // Photos (e.g. carried across from a converted deal, or uploaded under the
  // Photos category) render as a thumbnail gallery; everything else is a row.
  const photoDocs = filtered.filter(d => d.category === 'photos')
  const listDocs  = filtered.filter(d => d.category !== 'photos')
  const byCategory = DOC_CATEGORIES.reduce((acc,cat)=>{
    const catDocs = filtered.filter(d=>d.category===cat.value)
    if (catDocs.length>0) acc[cat.value] = catDocs
    return acc
  },{})

  return (
    <div>
      {/* Upload area */}
      {isAdmin&&<div
        onDrop={e=>{e.preventDefault();setDragOver(false);handleUpload(e.dataTransfer.files)}}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>inputRef.current?.click()}
        role="button" tabIndex={0} aria-label="Upload documents: drop files here or press Enter to browse"
        onKeyDown={e=>{ if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();inputRef.current?.click()} }}
        style={{
          border:`2px dashed ${dragOver?T.gold:T.border}`,
          borderRadius:12,padding:'24px 20px',textAlign:'center',
          cursor:'pointer',marginBottom:16,transition:'all 0.2s',
          background:dragOver?T.gold+'11':'transparent'
        }}>
        <div style={{display:'flex',justifyContent:'center',marginBottom:8}}><Icon name="upload" size={28} color={T.muted}/></div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>
          {uploading?'Uploading...':'Drop files here or click to browse'}
        </div>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginBottom:12}}>
          PDF, images, Word docs — any file type accepted
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
          <select value={selectedCategory} onChange={e=>{e.stopPropagation();setSelectedCategory(e.target.value)}}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} aria-label="Document category"
            style={{fontSize:11,padding:'4px 8px',width:'auto'}}>
            {DOC_CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input value={docName} onChange={e=>{e.stopPropagation();setDocName(e.target.value)}}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} aria-label="Custom document name (optional)"
            placeholder="Custom name (optional)"
            style={{fontSize:11,padding:'4px 8px',width:180}}/>
        </div>
        <input ref={el=>inputRef.current=el} type="file" multiple accept="*/*" aria-label="Upload documents"
          style={{display:'none'}} onChange={e=>handleUpload(e.target.files)}/>
      </div>}

      {/* Filter bar */}
      {docs.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        <button onClick={()=>setFilterCategory('all')}
          style={{fontFamily:MONO,fontSize:FS.xs,padding:'3px 10px',borderRadius:20,cursor:'pointer',
            border:`1px solid ${filterCategory==='all'?T.gold:T.border}`,
            background:filterCategory==='all'?T.gold+'22':'transparent',
            color:filterCategory==='all'?T.goldText:T.muted}}>
          All ({docs.length})
        </button>
        {DOC_CATEGORIES.filter(c=>docs.some(d=>d.category===c.value)).map(c=>(
          <button key={c.value} onClick={()=>setFilterCategory(c.value)}
            style={{fontFamily:MONO,fontSize:FS.xs,padding:'3px 10px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${filterCategory===c.value?T.gold:T.border}`,
              background:filterCategory===c.value?T.gold+'22':'transparent',
              color:filterCategory===c.value?T.goldText:T.muted}}>
            <Icon name={c.icon} size={12} style={{display:'inline-block',verticalAlign:'-2px'}}/> {c.label} ({docs.filter(d=>d.category===c.value).length})
          </button>
        ))}
      </div>}

      {/* Photo gallery */}
      {!loading && photoDocs.length>0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Photos ({photoDocs.length})</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',gap:10}}>
            {photoDocs.map(doc=>(
              <div key={doc.id} style={{position:'relative',minWidth:0}}>
                <SignedPhoto path={doc.file_path} url={doc.file_url} alt={doc.name||'Photo'}
                  style={{width:'100%',aspectRatio:'4 / 3',objectFit:'cover',borderRadius:10,border:`1px solid ${T.border}`,display:'block'}}/>
                {isAdmin&&<button onClick={()=>handleDelete(doc)} aria-label="Move photo to Trash" title="Move to Trash"
                  style={{position:'absolute',top:6,right:6,width:22,height:22,borderRadius:11,border:'none',background:'rgba(0,0,0,0.6)',color:'white',cursor:'pointer',fontSize:12,lineHeight:1,padding:0}}>×</button>}
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.text,marginTop:5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{doc.name}</div>
                <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{formatDate(doc.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document list */}
      {loading
        ? <SkeletonRows rows={3} height={36}/>
        : listDocs.length===0
          ? (photoDocs.length===0 && <EmptyState compact icon="folder" title="No documents yet" body="Upload tenancy agreements, certificates and other files here."/>)
          : <div style={{display:'grid',gap:8}}>
              {listDocs.map(doc=>{
                const cat = getCatInfo(doc.category)
                const isPDF = doc.file_type?.includes('pdf') || doc.name?.endsWith('.pdf')
                const isImage = doc.file_type?.includes('image')
                const ocrEligible = isPDF || isImage
                const status = doc.extraction_status || 'not_requested'
                const isExpanded = expandedOcrId === doc.id
                const extractedFields = doc.extracted_fields

                async function runOcr() {
                  if (!ocrEligible) { showToast('OCR only works on PDFs and images', 'error'); return }
                  try {
                    setOcrRunning(doc.id)
                    await api.markDocumentForExtraction(doc.id)
                    // Optimistically update UI to show processing
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, extraction_status: 'processing' } : d))
                    await api.triggerDocumentOCR(doc.id)
                    // Refetch this document to get extracted fields
                    const updated = await api.fetchDocumentExtraction(doc.id)
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, ...updated } : d))
                    setExpandedOcrId(doc.id)
                    showToast('Fields extracted!')
                  } catch(e) {
                    showToast('Extraction failed: ' + (e.message || 'unknown'), 'error')
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, extraction_status: 'failed', extraction_error: e.message } : d))
                  } finally {
                    setOcrRunning(null)
                  }
                }

                return (
                  <div key={doc.id} style={{background:T.bg,borderRadius:10,padding:'12px 16px',
                    display:'flex',flexDirection:'column',gap:8,
                    border:`1px solid ${T.border}`}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                      {/* Icon */}
                      <div style={{flexShrink:0,color:T.muted}}>
                        <Icon name={isPDF?'file-text':isImage?'grid-2':cat.icon} size={24}/>
                      </div>
                      {/* Info */}
                      <div style={{flex:1,minWidth:150}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{doc.name}</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.goldText,
                            background:T.gold+'22',padding:'1px 6px',borderRadius:20}}>
                            <Icon name={cat.icon} size={12} style={{display:'inline-block',verticalAlign:'-2px'}}/> {cat.label}
                          </span>
                          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>
                            {formatDate(doc.created_at)}
                          </span>
                          {doc.file_size&&<span style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint}}>
                            {formatSize(doc.file_size)}
                          </span>}
                          {/* OCR status badge */}
                          {status === 'processing' && <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.blue,background:T.blue+'22',padding:'1px 6px',borderRadius:20}}>Extracting…</span>}
                          {status === 'completed' && <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.green,background:T.green+'22',padding:'1px 6px',borderRadius:20}}>AI-extracted</span>}
                          {status === 'failed' && <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.red,background:T.red+'22',padding:'1px 6px',borderRadius:20}} title={doc.extraction_error}>Extraction failed</span>}
                        </div>
                      </div>
                      {/* Actions */}
                      <div style={{display:'flex',gap:6,flexShrink:0,flexWrap:'wrap'}}>
                        {ocrEligible && isAdmin && status !== 'processing' && (
                          <button onClick={runOcr} disabled={ocrRunning === doc.id}
                            style={{fontFamily:MONO,fontSize:11,padding:'5px 10px',
                              background: status === 'completed' ? T.surface : T.gold+'22',
                              color: status === 'completed' ? T.muted : T.goldText,
                              border: `1px solid ${T.gold}44`,
                              borderRadius:8,cursor: ocrRunning === doc.id ? 'wait' : 'pointer',opacity: ocrRunning === doc.id ? 0.6 : 1}}>
                            {ocrRunning === doc.id ? 'Extracting…' : status === 'completed' ? 'Re-extract' : 'Extract'}
                          </button>
                        )}
                        {status === 'completed' && (
                          <button onClick={()=>setExpandedOcrId(isExpanded ? null : doc.id)}
                            style={{fontFamily:MONO,fontSize:11,padding:'5px 10px',
                              background:T.surface,color:T.text,border:`1px solid ${T.border}`,
                              borderRadius:8,cursor:'pointer'}}>
                            {isExpanded ? '▲ Hide' : '▼ View fields'}
                          </button>
                        )}
                        <button onClick={async()=>{
                          try {
                            const url = await api.getDocumentSignedUrl(doc.file_path)
                            if (url) window.open(url, '_blank', 'noopener,noreferrer')
                            else showToast('Could not generate view link', 'error')
                          } catch(e) { showToast('Could not view: ' + (e.message||'unknown'), 'error') }
                        }}
                          style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',
                            background:T.surface,color:T.goldText,border:`1px solid ${T.gold}44`,
                            borderRadius:8,cursor:'pointer'}}>
                          View
                        </button>
                        {isAdmin&&<button onClick={()=>handleDelete(doc)}
                          style={{fontFamily:MONO,fontSize:11,padding:'5px 10px',
                            background:T.surface,color:T.muted,border:`1px solid ${T.border}`,
                            borderRadius:8,cursor:'pointer',transition:'color 0.15s, border-color 0.15s'}}
                          onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                          onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>
                          Delete
                        </button>}
                      </div>
                    </div>

                    {/* Expanded OCR fields */}
                    {isExpanded && status === 'completed' && extractedFields && (
                      <div style={{background:T.surface,borderRadius:8,padding:'12px 16px',border:`1px dashed ${T.green}44`,marginTop:4}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                          <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                            AI-extracted fields {doc.extracted_at && <span style={{color:T.faint,textTransform:'none',letterSpacing:0,marginLeft:6}}>— extracted {formatDate(doc.extracted_at)}</span>}
                          </div>
                        </div>
                        {extractedFields._parse_error ? (
                          <div style={{fontFamily:MONO,fontSize:11,color:T.amber,lineHeight:1.6}}>
                            <strong>Raw AI response (couldn't parse as JSON):</strong>
                            <div style={{background:T.bg,padding:10,borderRadius:6,marginTop:6,whiteSpace:'pre-wrap',maxHeight:280,overflow:'auto'}}>{extractedFields._raw_response}</div>
                          </div>
                        ) : (
                          <div style={{display:'grid',gap:6}}>
                            {Object.entries(extractedFields).map(([key, value]) => {
                              if (value === null || value === undefined || value === '') return null
                              const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                              // Format a single item (primitive or {label,value} / {date,description} / etc.)
                              const fmtItem = v => {
                                if (v === null || v === undefined) return '—'
                                if (typeof v !== 'object') return String(v)
                                if (Array.isArray(v)) return v.map(fmtItem).join(', ')
                                // Object: prefer common human-readable shapes
                                const labelKey = v.label ?? v.name ?? v.type ?? v.description ?? v.date
                                const valueKey = v.value ?? v.amount ?? v.date ?? v.description
                                if (labelKey && valueKey && labelKey !== valueKey) return `${labelKey}: ${valueKey}`
                                if (labelKey) return String(labelKey)
                                // Fallback: pretty key/value pairs, not raw JSON
                                return Object.entries(v)
                                  .filter(([,vv]) => vv !== null && vv !== undefined && vv !== '')
                                  .map(([k,vv]) => `${k.replace(/_/g,' ')}: ${fmtItem(vv)}`)
                                  .join(', ')
                              }
                              // For arrays of objects, render each on its own line for readability
                              const isArrayOfObjects = Array.isArray(value) && value.length > 0
                                && value.some(v => v && typeof v === 'object' && !Array.isArray(v))
                              let displayValue
                              if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No'
                              else if (Array.isArray(value)) displayValue = value.length === 0 ? '—' : value.map(fmtItem).join(isArrayOfObjects ? '\n' : ', ')
                              else if (typeof value === 'object') displayValue = fmtItem(value)
                              else displayValue = String(value)
                              return (
                                <div key={key} style={{display:'flex',gap:10,padding:'6px 10px',background:T.bg,borderRadius:6,alignItems:'flex-start'}}>
                                  <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,minWidth:140,flexShrink:0,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
                                  <div style={{fontFamily:MONO,fontSize:12,color:T.text,wordBreak:'break-word',whiteSpace:'pre-line'}}>{displayValue}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {/* Compliance auto-link CTA. Triggers ensureComplianceLink on first render
                            via the IIFE — keeps logic local to the panel without an extra useEffect. */}
                        {(() => {
                          const cat = doc.category
                          const cert = ['gas','eicr','epc','insurance'].includes(cat)
                          if (!cert || extractedFields._parse_error) return null
                          const candidate = api.buildComplianceFromDoc(doc)
                          if (!candidate) return null
                          // Lazy-check link state
                          if (complianceLinks[doc.id] === undefined) ensureComplianceLink(doc)
                          const linked = complianceLinks[doc.id]
                          if (linked) {
                            return (
                              <div style={{marginTop:10,padding:'10px 12px',background:T.green+'11',border:`1px solid ${T.green}44`,borderRadius:8,fontFamily:MONO,fontSize:11,color:T.green,display:'flex',alignItems:'center',gap:8}}>
                                <span>Linked to Compliance — {candidate.cert_name} expires {candidate.expiry_date}</span>
                              </div>
                            )
                          }
                          return (
                            <div style={{marginTop:10,padding:'10px 12px',background:T.gold+'11',border:`1px dashed ${T.gold}66`,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                              <div style={{fontFamily:MONO,fontSize:11,color:T.text,lineHeight:1.5}}>
                                Looks like a <strong>{candidate.cert_name}</strong> expiring <strong>{candidate.expiry_date}</strong>.
                              </div>
                              <button onClick={()=>addToCompliance(doc)} disabled={complianceBusy===doc.id}
                                style={{fontFamily:MONO,fontSize:11,padding:'6px 14px',
                                  background:T.gold,color:CV.onGold,border:'none',borderRadius:8,
                                  cursor:complianceBusy===doc.id?'wait':'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
                                {complianceBusy===doc.id ? 'Adding…' : '+ Add to Compliance'}
                              </button>
                            </div>
                          )
                        })()}
                        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,marginTop:10,lineHeight:1.5}}>
                          AI extraction is best-effort. Always verify critical values against the original document.
                        </div>
                      </div>
                    )}

                    {/* Failed extraction details */}
                    {status === 'failed' && doc.extraction_error && (
                      <div style={{background:T.red+'11',borderRadius:6,padding:'8px 12px',border:`1px solid ${T.red}44`,fontFamily:MONO,fontSize:FS.xs,color:T.red,lineHeight:1.5}}>
                        <strong>Extraction error:</strong> {doc.extraction_error.slice(0,200)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
      }

      {/* Notes for this tab */}
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user}
          showToast={showToast} category="documents"/>
      </div>
    </div>
  )
}
