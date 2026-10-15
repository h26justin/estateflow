import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useLoadGuard } from '../../lib/useLoadGuard'
import { logError } from '../../lib/logError'

// ── COMPANY DOCUMENTS TAB ────────────────────────────────────────────────────
export function CompanyDocumentsTab({companyId, showToast, isAdmin, user}) {
  const { T } = useTheme()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('other')
  const [docName, setDocName] = useState('')
  const inputRef = { current: null }

  const COMPANY_DOC_CATEGORIES = [
    {value:'insurance',   label:'Company Insurance',   icon:'🛡'},
    {value:'bank',        label:'Bank / Finance',      icon:'🏦'},
    {value:'legal',       label:'Legal',               icon:'⚖️'},
    {value:'tax',         label:'Tax / HMRC',          icon:'📊'},
    {value:'accounts',    label:'Annual Accounts',     icon:'📑'},
    {value:'contracts',   label:'Contracts',           icon:'📝'},
    {value:'other',       label:'Other',               icon:'📄'},
  ]

  const beginLoad = useLoadGuard()
  useEffect(()=>{ loadDocs() },[companyId])

  async function loadDocs() {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const {data} = await supabase.from('company_documents')
        .select('*').eq('company_id', companyId)
        .order('created_at', {ascending:false})
      if (!isCurrent()) return
      setDocs(data||[])
    } catch(e) {
      if (!isCurrent()) return
      logError('CompanyDocumentsTab:loadDocs', e)
    }
    setLoading(false)
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return
    setUploading(true)

    for (const file of Array.from(files)) {
      try {
        const {data:{user:u}} = await supabase.auth.getUser()
        const filePath = `${u.id}/company_documents/${companyId}/${Date.now()}-${file.name}`

        const {error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})
        if (uploadErr) throw uploadErr

        // Private bucket — no public URL stored. Signed URL minted at view time.
        // company_documents uses `type`/`size` columns (NOT file_type/file_size
        // like property_documents) — inserting the wrong keys fails with a
        // schema-cache error and no document is saved.
        const { error: insertErr } = await supabase.from('company_documents').insert({
          company_id: companyId,
          user_id: u.id,
          name: docName || file.name,
          file_path: filePath,
          type: file.type,
          size: file.size,
          category: selectedCategory,
        })
        if (insertErr) throw insertErr
        showToast('Document uploaded')
        setDocName('')
        await loadDocs()
      } catch(e) {
        showToast('Upload failed: ' + e.message, 'error')
      }
    }
    setUploading(false)
  }

  async function handleDelete(doc) {
    try {
      await api.deleteCompanyDocument(doc)
      setDocs(prev=>prev.filter(d=>d.id!==doc.id))
      showToast('Deleted')
    } catch(e) { showToast(e.message,'error') }
  }

  function formatSize(b) {
    if (!b) return ''
    if (b<1024) return b+'B'
    if (b<1024*1024) return (b/1024).toFixed(1)+'KB'
    return (b/(1024*1024)).toFixed(1)+'MB'
  }

  function getCat(val) {
    return COMPANY_DOC_CATEGORIES.find(c=>c.value===val)||COMPANY_DOC_CATEGORIES[COMPANY_DOC_CATEGORIES.length-1]
  }

  return (
    <div>
      {isAdmin&&<div
        onDrop={e=>{e.preventDefault();setDragOver(false);handleUpload(e.dataTransfer.files)}}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>inputRef.current?.click()}
        role="button" tabIndex={0} aria-label="Upload company documents: drop files here or press Enter to browse"
        onKeyDown={e=>{ if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();inputRef.current?.click()} }}
        style={{border:`2px dashed ${dragOver?T.gold:T.border}`,borderRadius:12,
          padding:'20px',textAlign:'center',cursor:'pointer',marginBottom:14,
          background:dragOver?T.gold+'11':'transparent',transition:'all 0.2s'}}>
        <div style={{fontSize:24,marginBottom:6}}>📁</div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>
          {uploading?'Uploading...':'Drop company documents here or click to browse'}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:8,flexWrap:'wrap'}}>
          <select value={selectedCategory} onChange={e=>{e.stopPropagation();setSelectedCategory(e.target.value)}}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} aria-label="Document category" style={{fontSize:11,padding:'4px 8px',width:'auto'}}>
            {COMPANY_DOC_CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <input value={docName} onChange={e=>{e.stopPropagation();setDocName(e.target.value)}}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} aria-label="Custom document name (optional)" placeholder="Custom name (optional)"
            style={{fontSize:11,padding:'4px 8px',width:160}}/>
        </div>
        <input ref={el=>inputRef.current=el} type="file" multiple aria-label="Upload company documents" style={{display:'none'}}
          onChange={e=>handleUpload(e.target.files)}/>
      </div>}

      {loading
        ? <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>Loading...</div>
        : docs.length===0
          ? <div style={{fontFamily:MONO,fontSize:11,color:T.faint,textAlign:'center',
              padding:24,background:T.bg,borderRadius:10}}>
              No company documents yet.
            </div>
          : <div style={{display:'grid',gap:8}}>
              {docs.map(doc=>{
                const cat = getCat(doc.category)
                return (
                  <div key={doc.id} style={{background:T.bg,borderRadius:10,padding:'12px 16px',
                    display:'flex',alignItems:'center',gap:12,border:`1px solid ${T.border}`,flexWrap:'wrap'}}>
                    <div style={{fontSize:22,flexShrink:0}}>{cat.icon}</div>
                    <div style={{flex:1,minWidth:150}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{doc.name}</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.goldText,
                          background:T.gold+'22',padding:'1px 6px',borderRadius:20}}>
                          {cat.icon} {cat.label}
                        </span>
                        <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>
                          {new Date(doc.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                        </span>
                        {doc.size&&<span style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint}}>
                          {formatSize(doc.size)}
                        </span>}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:6}}>
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
                          borderRadius:8,cursor:'pointer'}}
                        onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                        onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>
                        Delete
                      </button>}
                    </div>
                  </div>
                )
              })}
            </div>
      }
    </div>
  )
}
