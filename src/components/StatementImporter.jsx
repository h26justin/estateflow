import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const T = {
  bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
  text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58',
  gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', amber:'#E0943A', blue:'#4B8FE0',
}

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',minimumFractionDigits:2}).format(n||0)

// ── PDF TEXT EXTRACTION ───────────────────────────────────────────────────────
async function extractPDFText(file) {
  // Load PDF.js from CDN if not already loaded
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        resolve()
      }
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
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

// ── DETECT FORMAT ─────────────────────────────────────────────────────────────
function detectFormat(text) {
  if (text.includes('PNE') || text.includes('Propertunity') || text.includes('Management Commission')) {
    return 'PNE'
  }
  if (text.includes('ROOK') || text.includes('rookmatthewssayer') || text.includes('Rook Matthews')) {
    return 'RMS'
  }
  return 'UNKNOWN'
}

// ── PARSE PNE STATEMENT ───────────────────────────────────────────────────────
function parsePNE(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const result = {
    format: 'PNE',
    statementNo: '',
    date: '',
    company: '',
    totalIncome: 0,
    totalFees: 0,
    paymentAmount: 0,
    items: [], // { propertyName, type:'rent'|'fee'|'maintenance', amount, tenant, period, description }
  }

  // Extract header info
  for (const line of lines) {
    const stmtMatch = line.match(/Statement No\s*[:.]?\s*(\d+)/i)
    if (stmtMatch) result.statementNo = stmtMatch[1]

    const dateMatch = line.match(/(\d+(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i)
    if (dateMatch && !result.date) result.date = dateMatch[1]

    if (line.includes('Property Group') || line.includes('EXH') || line.includes('Vale') ||
        line.includes('Nouchette') || line.includes('AliCat') || line.includes('WxH')) {
      if (!result.company) result.company = line
    }

    const payMatch = line.match(/PAYMENT AMOUNT\s*[\u00A3]?([\d,]+\.?\d*)/i)
    if (payMatch) result.paymentAmount = parseFloat(payMatch[1].replace(/,/g,''))
  }

  // Parse property blocks
  // PNE format: property name in bold (line by itself), then rent lines, then management commission
  let currentProperty = null
  let inExpenditure = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.match(/^Expenditure\s*$/i) || line.match(/^Expenditure\s+Amount/i)) {
      inExpenditure = true
      continue
    }
    if (line.match(/^Income\s*$/i) || line.match(/^Income\s+Amount/i)) {
      inExpenditure = false
      continue
    }
    if (line.match(/^Summary$/i) || line.match(/^Our Invoice$/i)) break

    // Detect property name lines (lines that end with a known building/area name)
    // Property names tend to be standalone lines without £ amounts
    const isPropertyLine = !line.includes('£') &&
      !line.match(/^\d/) &&
      !line.match(/^(Rent for|Management|VAT|Gross|Amount|Income|Expenditure|Statement|Balance|Payment|Total)/i) &&
      line.length > 5 && line.length < 80 &&
      (line.match(/Flat\s+\d+|Room\s+\d+|House|Avenue|Street|Road|Place|Close|Drive|Way|Court|\d+\s+\w/i) ||
       line.match(/^\d+\s+\w/))

    if (isPropertyLine && !inExpenditure) {
      currentProperty = line.replace(/\s+/g,' ').trim()
      continue
    }

    // Rent line: "Rent for the month DD/MM/YYYY to DD/MM/YYYY - Tenant Name £XXX.XX"
    const rentMatch = line.match(/Rent for the month\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i)
    if (rentMatch && currentProperty) {
      // Find amount - look for £ in this line or next
      const amtMatch = line.match(/[\u00A3]([\d,]+\.?\d*)/)
      if (amtMatch) {
        const amount = parseFloat(amtMatch[1].replace(/,/g,''))
        const tenantMatch = line.match(/- (.+?)(?:\s+[\u00A3]|$)/)
        const tenant = tenantMatch ? tenantMatch[1].trim() : ''
        const period = `${rentMatch[1]} to ${rentMatch[2]}`

        result.items.push({
          propertyName: currentProperty,
          type: 'rent',
          amount,
          tenant,
          period,
          description: `Rent ${period}${tenant?` — ${tenant}`:''}`,
          include: true,
          matched: false,
          propertyId: null,
          editAmount: amount,
        })
        result.totalIncome += amount
      }
      continue
    }

    // Management commission line
    const commMatch = line.match(/Management Commission\s+([\d.]+)%\s+of\s+[\u00A3]([\d,]+\.?\d*)/i)
    if (commMatch && inExpenditure) {
      const amtMatch = line.match(/[\u00A3]([\d,]+\.?\d*)\s*[\u00A3]0/)
      if (amtMatch) {
        const amount = parseFloat(amtMatch[1].replace(/,/g,''))
        // Find which property this belongs to - look back for current property
        const prop = currentProperty || ''
        result.items.push({
          propertyName: prop,
          type: 'fee',
          amount,
          tenant: '',
          period: result.date,
          description: `Management fee ${commMatch[1]}%`,
          include: true,
          matched: false,
          propertyId: null,
          editAmount: amount,
        })
        result.totalFees += amount
      }
      continue
    }

    // Track property in expenditure section too
    if (inExpenditure && isPropertyLine) {
      currentProperty = line.replace(/\s+/g,' ').trim()
    }
  }

  return result
}

// ── PARSE RMS STATEMENT ───────────────────────────────────────────────────────
function parseRMS(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const result = {
    format: 'RMS',
    statementNo: '',
    date: '',
    company: '',
    totalIncome: 0,
    totalFees: 0,
    paymentAmount: 0,
    items: [],
  }

  // Extract header
  for (const line of lines) {
    const refMatch = line.match(/Reference:\s*(\S+)/i)
    if (refMatch) result.statementNo = refMatch[1]

    const dateMatch = line.match(/Date:\s*(\d{2}\/\d{2}\/\d{4})/i)
    if (dateMatch) result.date = dateMatch[1]

    if (line.includes('Property Group') || line.includes('Vale') || line.includes('EXH')) {
      if (!result.company) result.company = line
    }
  }

  // RMS format: rows with Date | Property | Tenancy | Description | Money In | Money Out
  // Look for rent received, management fees, maintenance costs
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Rent received line
    const rentMatch = line.match(/Rent Received From (.+?) - (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})/i)
    if (rentMatch) {
      // Find associated property - look backwards
      let propName = ''
      for (let j = i - 1; j >= Math.max(0, i-5); j--) {
        if (lines[j].match(/Avenue|Street|Road|House|Place|Flat|Room/i) && !lines[j].match(/Rent|Management|Fee/i)) {
          propName = lines[j].replace(/\s+/g,' ').trim()
          break
        }
      }

      // Find amount on this line or nearby
      const amtMatch = line.match(/([\d,]+\.\d{2})\s*$/) || line.match(/([\d,]+\.\d{2})/)
      if (amtMatch) {
        const amount = parseFloat(amtMatch[1].replace(/,/g,''))
        if (amount > 0 && amount < 50000) {
          const period = `${rentMatch[2]} to ${rentMatch[3]}`
          result.items.push({
            propertyName: propName,
            type: 'rent',
            amount,
            tenant: rentMatch[1].trim(),
            period,
            description: `Rent ${period} — ${rentMatch[1].trim()}`,
            include: true,
            matched: false,
            propertyId: null,
            editAmount: amount,
          })
          result.totalIncome += amount
        }
      }
      continue
    }

    // Management fee line
    const mgmtMatch = line.match(/Management Fee @ ([\d.]+)%\s*-\s*\(([\d.]+)%\s+of\s+[\u00A3]([\d,]+\.?\d*)\)/i)
    if (mgmtMatch) {
      let propName = ''
      for (let j = i - 1; j >= Math.max(0, i-5); j--) {
        if (lines[j].match(/Avenue|Street|Road|House|Place|Flat|Room/i) && !lines[j].match(/Rent|Management|Fee/i)) {
          propName = lines[j].replace(/\s+/g,' ').trim()
          break
        }
      }

      // Find fee total from FEE INVOICE section
      const feeMatch = line.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/)
      if (feeMatch) {
        const total = parseFloat(feeMatch[3].replace(/,/g,''))
        result.items.push({
          propertyName: propName,
          type: 'fee',
          amount: total,
          tenant: '',
          period: result.date,
          description: `Management fee ${mgmtMatch[1]}% (inc VAT)`,
          include: true,
          matched: false,
          propertyId: null,
          editAmount: total,
        })
        result.totalFees += total
      }
      continue
    }

    // Maintenance/contractor costs
    const maintMatch = line.match(/\(Inv:([^)]+)\)\s+(.+?)(?:\s+([\d,]+\.\d{2}))?$/)
    if (maintMatch && !line.includes('Balance') && !line.includes('Fee')) {
      let propName = ''
      for (let j = i - 1; j >= Math.max(0, i-5); j--) {
        if (lines[j].match(/Avenue|Street|Road|House|Place|Flat|Room/i)) {
          propName = lines[j].replace(/\s+/g,' ').trim()
          break
        }
      }

      const amtMatch = line.match(/([\d,]+\.\d{2})/)
      if (amtMatch) {
        const amount = parseFloat(amtMatch[1].replace(/,/g,''))
        if (amount > 0 && amount < 50000) {
          result.items.push({
            propertyName: propName,
            type: 'maintenance',
            amount,
            tenant: '',
            period: result.date,
            description: maintMatch[2].trim(),
            include: true,
            matched: false,
            propertyId: null,
            editAmount: amount,
          })
        }
      }
    }

    // Payment amount
    const payMatch = line.match(/Payment made to Owner\s+([\d,]+\.\d{2})/i)
    if (payMatch) result.paymentAmount = parseFloat(payMatch[1].replace(/,/g,''))
  }

  return result
}

// ── MATCH PROPERTIES ──────────────────────────────────────────────────────────
function matchProperties(items, properties) {
  return items.map(item => {
    if (!item.propertyName) return item

    const name = item.propertyName.toLowerCase()

    // Try to find a matching property
    let bestMatch = null
    let bestScore = 0

    for (const prop of properties) {
      const propName = prop.name.toLowerCase()
      const propAddr = (prop.address||'').toLowerCase()

      // Score the match
      let score = 0

      // Flat/room number extraction
      const flatNumInName = name.match(/(?:flat|room)\s*(\d+[ab]?)/i)?.[1]
      const flatNumInProp = propName.match(/(?:flat|room)\s*(\d+[ab]?)/i)?.[1]
      if (flatNumInName && flatNumInProp && flatNumInName === flatNumInProp) score += 10

      // Building name matching
      if (name.includes('watts moses') && propName.includes('watts moses')) score += 5
      if (name.includes('esplanade') && propName.includes('esplanade')) score += 5
      if (name.includes('st. georges') || name.includes('st georges')) {
        if (propName.includes('st georges') || propName.includes('georges')) score += 5
      }
      if (name.includes('park place east') && propName.includes('park place east')) score += 5
      if (name.includes('park place west') && propName.includes('park place west')) score += 5
      if (name.includes('turnberry') && (propName.includes('turnberry') || propAddr.includes('turnberry'))) score += 5

      // Street number matching
      const numInName = name.match(/^(\d+)\s/)?.[1]
      const numInProp = propName.match(/^(\d+)\s/)?.[1] || propAddr.match(/^(\d+)\s/)?.[1]
      if (numInName && numInProp && numInName === numInProp) score += 8

      // Word overlap
      const nameWords = name.split(/\s+/).filter(w => w.length > 3)
      const propWords = (propName + ' ' + propAddr).split(/\s+/)
      const overlap = nameWords.filter(w => propWords.some(pw => pw.includes(w) || w.includes(pw)))
      score += overlap.length * 2

      if (score > bestScore) {
        bestScore = score
        bestMatch = prop
      }
    }

    return {
      ...item,
      matched: bestScore >= 5,
      propertyId: bestScore >= 5 ? bestMatch.id : null,
      matchedName: bestScore >= 5 ? bestMatch.name : null,
      matchScore: bestScore,
    }
  })
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export function StatementImporter({properties, companies, showToast, onClose}) {
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
      console.error(e)
      showToast('Error reading PDF: ' + e.message, 'error')
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
          // Determine month/year from period
          const dateMatch = item.period.match(/(\d{2})\/(\d{2})\/(\d{4})/)
          if (dateMatch) {
            const year = parseInt(dateMatch[3])
            const month = parseInt(dateMatch[2])
            const monthLabel = new Date(year, month-1).toLocaleString('en-GB', {month:'short', year:'numeric'})

            // Check if payment record exists
            const {data: existing} = await supabase.from('rent_payments')
              .select('id').eq('property_id', item.propertyId).eq('year', year).eq('month', month).single()

            if (existing) {
              await supabase.from('rent_payments').update({status:'paid', amount:item.editAmount}).eq('id', existing.id)
            } else {
              await supabase.from('rent_payments').insert({
                property_id: item.propertyId, user_id: user.id,
                month_label: monthLabel, year, month, status: 'paid', amount: item.editAmount
              })
            }
            results.rent++
          }
        }

        if (item.type === 'fee') {
          const dateMatch = item.period.match(/(\d{2})\/(\d{2})\/(\d{4})/) || item.date?.match(/(\w+)\s+(\d{4})/)
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
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
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
                          <input type="number" step="0.01"
                            value={item.editAmount}
                            onChange={e=>updateItem(idx,'editAmount',parseFloat(e.target.value)||0)}
                            style={{width:70,textAlign:'right',fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,
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
