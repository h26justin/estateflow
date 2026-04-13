import { useState } from 'react'
import { useTheme } from '../lib/ThemeContext'

const mono = "'DM Mono',monospace"

// ── AI LISTING DESCRIPTION WRITER ────────────────────────────────────────────
export function AIListingWriter({ property, T: TProp }) {
  const { T: TCtx } = useTheme()
  const T = TProp || TCtx
  const [form, setForm] = useState({
    bedrooms: property?.bedrooms || '',
    bathrooms: property?.bathrooms || '',
    property_type: 'flat',
    location: property?.address || '',
    features: '',
    target: 'rightmove',
    tone: 'professional',
  })
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    setResult('')
    try {
      const prompt = `Write a property listing description for ${form.target === 'rightmove' ? 'Rightmove' : 'Zoopla'}.

Property details:
- Type: ${form.property_type}
- Bedrooms: ${form.bedrooms}
- Bathrooms: ${form.bathrooms}
- Location: ${form.location}
- Key features: ${form.features}
- Tone: ${form.tone}

Write a compelling, accurate listing description of 150-200 words. Do not invent features not listed. Use UK English. Do not include a headline/title — just the body paragraph(s).`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await response.json()
      setResult(data.content?.[0]?.text || 'No result')
    } catch(e) {
      setResult('Error generating description. Please try again.')
    }
    setLoading(false)
  }

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', width: '100%' }
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5 }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>✍</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>AI listing description writer</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Generate a professional property listing in seconds</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Property type</label>
          <select value={form.property_type} onChange={e => set('property_type', e.target.value)} style={inp}>
            {['flat','terraced house','semi-detached house','detached house','bungalow','HMO','studio'].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Bedrooms</label>
          <input type="number" min={0} max={20} value={form.bedrooms} onChange={e => set('bedrooms', e.target.value)} placeholder="e.g. 3" style={inp}/>
        </div>
        <div>
          <label style={lbl}>Bathrooms</label>
          <input type="number" min={1} max={10} value={form.bathrooms} onChange={e => set('bathrooms', e.target.value)} placeholder="e.g. 1" style={inp}/>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Location (street, area, town)</label>
        <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Chapel Street, Sunderland city centre" style={inp}/>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Key features (comma separated)</label>
        <input value={form.features} onChange={e => set('features', e.target.value)}
          placeholder="e.g. recently refurbished kitchen, private garden, off-street parking, close to schools" style={inp}/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={lbl}>Platform</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['rightmove','Rightmove'],['zoopla','Zoopla'],['general','General']].map(([k,l]) => (
              <button key={k} onClick={() => set('target', k)} style={{ fontFamily:mono, fontSize:10, padding:'4px 10px', borderRadius:20, cursor:'pointer',
                border:`1px solid ${form.target===k?T.gold:T.border}`, background:form.target===k?T.gold+'22':'transparent', color:form.target===k?T.gold:T.muted }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={lbl}>Tone</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['professional','Professional'],['warm','Warm'],['luxury','Luxury']].map(([k,l]) => (
              <button key={k} onClick={() => set('tone', k)} style={{ fontFamily:mono, fontSize:10, padding:'4px 10px', borderRadius:20, cursor:'pointer',
                border:`1px solid ${form.tone===k?T.gold:T.border}`, background:form.tone===k?T.gold+'22':'transparent', color:form.tone===k?T.gold:T.muted }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={generate} disabled={loading || !form.location}
        style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 22px', borderRadius:8, border:'none',
          background: loading||!form.location ? T.border : T.gold, color:'white', cursor:'pointer', width:'100%', marginBottom: result?12:0 }}>
        {loading ? '✍ Writing…' : '✨ Generate description'}
      </button>

      {result && (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Generated description</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => navigator.clipboard.writeText(result).then(() => {})}
                style={{ fontFamily:mono, fontSize:10, padding:'3px 10px', borderRadius:6, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer' }}>Copy</button>
              <button onClick={generate}
                style={{ fontFamily:mono, fontSize:10, padding:'3px 10px', borderRadius:6, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer' }}>Regenerate</button>
            </div>
          </div>
          <div style={{ fontFamily:mono, fontSize:12, color:T.text, lineHeight:1.8, whiteSpace:'pre-wrap' }}>{result}</div>
        </div>
      )}
    </div>
  )
}

// ── YIELD CALCULATOR FOR LIVE LISTINGS ───────────────────────────────────────
export function ListingYieldCalculator({ onAutoFill, T: TProp }) {
  const { T: TCtx } = useTheme()
  const T = TProp || TCtx
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function analyse() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const prompt = `I have a property listing URL: ${url}

Based on this URL (which is from ${url.includes('rightmove')?'Rightmove':url.includes('zoopla')?'Zoopla':url.includes('onthemarket')?'OnTheMarket':'a property portal'}) and any pricing patterns in the URL, extract or estimate the following information.

Note: You cannot actually browse the URL. Instead, use your knowledge of UK property prices and the URL structure to make reasonable estimates based on the location and property type if visible in the URL.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "purchase_price": 150000,
  "estimated_monthly_rent": 750,
  "property_type": "flat",
  "bedrooms": 2,
  "location": "Newcastle",
  "gross_yield": 6.0,
  "notes": "Brief note about the estimate"
}`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await response.json()
      const text = data.content?.[0]?.text || '{}'
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setResult(parsed)
    } catch(e) {
      setError('Could not analyse this listing. Try entering the details manually below.')
    }
    setLoading(false)
  }

  const fmt = n => n ? `£${parseInt(n).toLocaleString('en-GB')}` : '—'

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>🔗</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Listing yield calculator</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Paste a Rightmove, Zoopla or OnTheMarket URL to instantly analyse the deal</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && analyse()}
          placeholder="https://www.rightmove.co.uk/properties/..."
          style={{ flex: 1, fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '9px 12px', outline: 'none' }}/>
        <button onClick={analyse} disabled={loading || !url.trim()}
          style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '9px 18px', borderRadius: 8, border: 'none',
            background: loading||!url.trim() ? T.border : T.gold, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
          {loading ? 'Analysing…' : 'Analyse →'}
        </button>
      </div>

      {error && <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginBottom: 10 }}>{error}</div>}

      {result && (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Asking price', value: fmt(result.purchase_price), color: T.text },
              { label: 'Est. monthly rent', value: fmt(result.estimated_monthly_rent), color: '#2ECC8A' },
              { label: 'Gross yield', value: result.gross_yield ? `${parseFloat(result.gross_yield).toFixed(1)}%` : '—',
                color: parseFloat(result.gross_yield) >= 7 ? '#2ECC8A' : parseFloat(result.gross_yield) >= 5 ? '#C8A84B' : '#E05555' },
              { label: 'Type', value: result.property_type || '—', color: T.muted },
              { label: 'Bedrooms', value: result.bedrooms ? `${result.bedrooms} bed` : '—', color: T.muted },
              { label: 'Location', value: result.location || '—', color: T.muted },
            ].map(k => (
              <div key={k.label} style={{ background: T.card, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {result.notes && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12, fontStyle: 'italic' }}>Note: {result.notes}</div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {onAutoFill && result.purchase_price && (
              <button onClick={() => onAutoFill(result)}
                style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: T.gold, color: 'white', cursor: 'pointer' }}>
                → Open in Deal Calculator
              </button>
            )}
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'flex', alignItems: 'center' }}>
              AI estimates only — verify with actual listing data
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PORTFOLIO WHAT-IF MODELLER ────────────────────────────────────────────────
export function PortfolioModeller({ currentProperties = [], T: TProp }) {
  const { T: TCtx } = useTheme()
  const T = TProp || TCtx
  const [extraProps, setExtraProps] = useState(5)
  const [avgPrice, setAvgPrice] = useState(175000)
  const [avgYield, setAvgYield] = useState(6.5)
  const [years, setYears] = useState(10)
  const [growthRate, setGrowthRate] = useState(3)

  const currentIncome = currentProperties.reduce((s,p) => s + (p.rent_pcm||0)*12, 0)
  const currentValue = currentProperties.reduce((s,p) => s + (p.current_value||p.est_value||0), 0)

  const newIncome = extraProps * avgPrice * (avgYield/100)
  const totalIncome = currentIncome + newIncome
  const totalValue = currentValue + (extraProps * avgPrice)

  const futureValue = totalValue * Math.pow(1 + growthRate/100, years)
  const futureIncome = totalIncome * Math.pow(1 + 0.02, years) // assume 2% rent growth

  const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>📈</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Portfolio what-if modeller</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>See what your portfolio looks like after growth</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        {[
          { label: 'Additional properties to buy', min: 0, max: 50, value: extraProps, set: setExtraProps, suffix: ' properties' },
          { label: 'Average purchase price', min: 50000, max: 1000000, step: 5000, value: avgPrice, set: setAvgPrice, prefix: '£', fmt: true },
          { label: 'Target gross yield', min: 2, max: 15, step: 0.5, value: avgYield, set: setAvgYield, suffix: '%' },
          { label: 'Annual capital growth', min: 0, max: 10, step: 0.5, value: growthRate, set: setGrowthRate, suffix: '%' },
          { label: 'Time horizon', min: 1, max: 30, value: years, set: setYears, suffix: ' years' },
        ].map(s => (
          <div key={s.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{s.label}</span>
              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.gold }}>
                {s.prefix||''}{s.fmt ? parseInt(s.value).toLocaleString('en-GB') : s.value}{s.suffix||''}
              </span>
            </div>
            <input type="range" min={s.min} max={s.max} step={s.step||1} value={s.value}
              onChange={e => s.set(parseFloat(e.target.value))}
              style={{ width: '100%' }}/>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${T.muted}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Today (current portfolio)</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 2 }}>{fmt(currentIncome)}<span style={{ fontFamily: mono, fontSize: 11, fontWeight: 400, color: T.muted }}>/yr</span></div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Portfolio value: {fmt(currentValue)}</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{currentProperties.length} properties</div>
        </div>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${'#2ECC8A'}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>After buying {extraProps} more</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#2ECC8A', marginBottom: 2 }}>{fmt(totalIncome)}<span style={{ fontFamily: mono, fontSize: 11, fontWeight: 400, color: T.muted }}>/yr</span></div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Portfolio value: {fmt(totalValue)}</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{currentProperties.length + extraProps} properties</div>
        </div>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${'#C8A84B'}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>In {years} years (with {growthRate}% growth)</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#C8A84B', marginBottom: 2 }}>{fmt(futureIncome)}<span style={{ fontFamily: mono, fontSize: 11, fontWeight: 400, color: T.muted }}>/yr</span></div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Portfolio value: {fmt(futureValue)}</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>+{fmt(futureValue - totalValue)} capital growth</div>
        </div>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${'#4B8FE0'}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Monthly income</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Now</span>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text }}>{fmt(currentIncome/12)}/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>After purchase</span>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#2ECC8A' }}>{fmt(totalIncome/12)}/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>In {years} years</span>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#C8A84B' }}>{fmt(futureIncome/12)}/mo</span>
          </div>
        </div>
      </div>

      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, lineHeight: 1.7 }}>
        Projections are illustrative only. Based on gross rental income without deductions for voids, maintenance or tax. Capital growth is compound annual. Rent growth assumed at 2% per year.
      </div>
    </div>
  )
}
