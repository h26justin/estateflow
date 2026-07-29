import { MONO } from './styles'
// Tiny inline-SVG chart library — zero dependencies.
//
// We deliberately don't pull in d3, recharts, victory or chart.js. They
// each add 40-100kB to the bundle and we only need four chart types
// (bar, ranked bar, area, donut). Inline SVG with React handles all of
// that in ~150 LOC and renders identically across themes.
//
// All charts:
//   - accept a `T` theme prop (mono font, text/muted/border/etc colours)
//   - accept an `accent` colour (matches the Reports category)
//   - render as 100% width, fixed height SVG with a viewBox
//   - format Y-axis tick labels via the caller-supplied `fmt` function
//     (so currency, % etc all work)
//
// Each component is independently exportable for use in non-Reports
// contexts (e.g. Property Detail, Dashboard) later.

import React from 'react'


// Shared util — nicest "round" max for Y-axis given the data max.
function niceMax(v) {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / exp
  if (norm <= 1.2) return 1.2 * exp
  if (norm <= 2)   return 2   * exp
  if (norm <= 3)   return 3   * exp
  if (norm <= 5)   return 5   * exp
  return 10 * exp
}

// ── BAR CHART ───────────────────────────────────────────────────────────
// Vertical bars, one per item. Used for "P&L by property", "Annual rent
// per property" etc.
//
//   data: [{ label, value, color? }]
export function BarChart({ data, T, accent, fmt = String, height = 220, maxBars = 12 }) {
  const series = data.slice(0, maxBars)
  if (series.length === 0) return null

  const max = niceMax(Math.max(...series.map(d => d.value), 0))
  const W = 800, H = height, padL = 60, padR = 12, padT = 14, padB = 44
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const barW = innerW / series.length * 0.7
  const gap  = innerW / series.length * 0.3

  const ticks = 4
  const tickVals = Array.from({length: ticks + 1}, (_, i) => max * i / ticks)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height,display:'block'}}>
      {/* Grid + Y labels */}
      {tickVals.map((v,i) => {
        const y = padT + innerH - (v/max)*innerH
        return (
          <g key={i}>
            <line x1={padL} x2={W-padR} y1={y} y2={y} stroke={T.border} strokeDasharray={i===0?'0':'2 3'} strokeWidth="0.6"/>
            <text x={padL-6} y={y+3} fontFamily={MONO} fontSize="9" fill={T.muted} textAnchor="end">{fmt(v)}</text>
          </g>
        )
      })}
      {/* Bars */}
      {series.map((d, i) => {
        const h = (d.value / max) * innerH
        const x = padL + i*(barW+gap) + gap/2
        const y = padT + innerH - h
        const color = d.color || accent
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(h, 0.5)} rx="3" fill={color} opacity="0.85"/>
            {/* Inline value above bar (only if it fits) */}
            {h > 18 && (
              <text x={x + barW/2} y={y + 12} fontFamily={MONO} fontSize="9" fill="white" textAnchor="middle" fontWeight="700">
                {fmt(d.value)}
              </text>
            )}
            {/* X label, rotated if many */}
            <text x={x + barW/2} y={H - padB + 12} fontFamily={MONO} fontSize="9" fill={T.muted} textAnchor="middle"
              transform={series.length > 6 ? `rotate(-30 ${x + barW/2} ${H - padB + 12})` : ''}>
              {d.label.length > 18 ? d.label.slice(0,16) + '…' : d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── RANKED HORIZONTAL BAR ───────────────────────────────────────────────
// One bar per item, sorted by value, with the label inside the bar at
// left. Used for yield comparison.
//
//   data: [{ label, value, color? }]  -- pre-sorted by caller
export function RankedBar({ data, T, accent, fmt = String, height = null, maxBars = 12 }) {
  const series = data.slice(0, maxBars)
  if (series.length === 0) return null

  const rowH = 26
  const H = height ?? series.length * rowH + 12
  const W = 800
  const padL = 8, padR = 80
  const max = Math.max(...series.map(d => d.value), 0)
  const innerW = W - padL - padR

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height:H,display:'block'}}>
      {series.map((d, i) => {
        const barW = max > 0 ? (d.value / max) * innerW : 0
        const y = i * rowH + 4
        const color = d.color || accent
        return (
          <g key={i}>
            <rect x={padL} y={y} width={barW} height={rowH - 6} rx="3" fill={color} opacity="0.85"/>
            <text x={padL + 8} y={y + (rowH-6)/2 + 4} fontFamily={MONO} fontSize="10" fill="white" fontWeight="700">
              {d.label.length > 32 ? d.label.slice(0,30) + '…' : d.label}
            </text>
            <text x={W - padR + 8} y={y + (rowH-6)/2 + 4} fontFamily={MONO} fontSize="10" fill={T.text} fontWeight="700">
              {fmt(d.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── AREA CHART (single series) ──────────────────────────────────────────
// Used for cashflow by month.
//
//   data: [{ label, value }]
export function AreaChart({ data, T, accent, fmt = String, height = 200 }) {
  if (data.length < 2) return null
  const W = 800, H = height, padL = 56, padR = 12, padT = 14, padB = 34
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const max = niceMax(Math.max(...data.map(d => d.value), 1))
  const min = Math.min(0, ...data.map(d => d.value))
  const range = max - min || 1

  const pointX = i => padL + (i / (data.length - 1)) * innerW
  const pointY = v => padT + innerH - ((v - min) / range) * innerH

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${pointX(i).toFixed(1)},${pointY(d.value).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${pointX(data.length-1).toFixed(1)},${pointY(0).toFixed(1)} L${pointX(0).toFixed(1)},${pointY(0).toFixed(1)} Z`

  const ticks = 4
  const tickVals = Array.from({length: ticks+1}, (_,i) => min + (range*i/ticks))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height,display:'block'}}>
      {/* Grid + Y labels */}
      {tickVals.map((v,i) => {
        const y = pointY(v)
        return (
          <g key={i}>
            <line x1={padL} x2={W-padR} y1={y} y2={y} stroke={T.border} strokeDasharray={v===0?'0':'2 3'} strokeWidth="0.6"/>
            <text x={padL-6} y={y+3} fontFamily={MONO} fontSize="9" fill={T.muted} textAnchor="end">{fmt(v)}</text>
          </g>
        )
      })}
      {/* Area fill */}
      <path d={areaPath} fill={accent} opacity="0.15"/>
      {/* Line */}
      <path d={linePath} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Points */}
      {data.map((d,i) => (
        <circle key={i} cx={pointX(i)} cy={pointY(d.value)} r="2.5" fill={accent}/>
      ))}
      {/* X labels */}
      {data.map((d,i) => (
        <text key={i} x={pointX(i)} y={H - padB + 14} fontFamily={MONO} fontSize="9" fill={T.muted} textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  )
}

// ── DONUT (single segment + remainder) ──────────────────────────────────
// Specifically for "X of Y" stats — e.g. occupancy rate.
//
//   value: number to display in centre
//   percent: 0–100 (how full the donut is)
//   label: bottom caption
export function DonutChart({ value, percent, label, T, accent, color, sublabel, size = 180 }) {
  const c = color || accent
  const r = size * 0.42
  const stroke = size * 0.13
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  const fill = Math.min(Math.max(percent, 0), 100) / 100
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{display:'block'}}>
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={stroke}/>
      {/* Filled arc, rotated to start at 12 o'clock */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={stroke}
        strokeDasharray={`${circ * fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}/>
      {/* Centre text */}
      <text x={cx} y={cy + 4} textAnchor="middle" fontFamily={MONO} fontSize={size*0.18} fontWeight="700" fill={T.text}>
        {value}
      </text>
      {sublabel && (
        <text x={cx} y={cy + size*0.13} textAnchor="middle" fontFamily={MONO} fontSize={size*0.07} fill={T.muted}>
          {sublabel}
        </text>
      )}
      {label && (
        <text x={cx} y={size - 6} textAnchor="middle" fontFamily={MONO} fontSize={size*0.08} fill={T.muted}>
          {label}
        </text>
      )}
    </svg>
  )
}

// ── Helper: render an SVG node as a PNG data URL for embedding in PDFs ─
// Drives renderReportPDF / renderYearEndPackPDF when we want to embed
// the same in-app chart in the PDF. Returns null on any failure (the PDF
// gracefully falls back to its existing table-only layout).
export async function svgNodeToPng(svgNode, width = 800, height = 220) {
  try {
    const xml = new XMLSerializer().serializeToString(svgNode)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = await new Promise((ok, no) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = no
      i.src = url
    })
    const canvas = document.createElement('canvas')
    const scale = 2 // crisp at 2× device pixel ratio
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    return canvas.toDataURL('image/png')
  } catch (e) {
    console.warn('svgNodeToPng failed', e)
    return null
  }
}
