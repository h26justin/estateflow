import { MONO } from './styles'
import { readableOn, parseHex } from './contrast'
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
//   - render as 100% width, fixed height SVG whose viewBox width is the
//     measured pixel width, so 11px labels render at 11px on a phone card
//     (an 800-unit viewBox shrank them to ~4px in a 300px card)
//   - are role="img" with an aria-label summarising the series; pass
//     `ariaLabel` to override the generated one
//   - format Y-axis tick labels via the caller-supplied `fmt` function
//     (so currency, % etc all work)
//
// Each component is independently exportable for use in non-Reports
// contexts (e.g. Property Detail, Dashboard) later.

import React, { useLayoutEffect, useState } from 'react'

// Width the viewBox falls back to before the first measure (and in jsdom,
// which has no layout).
const DEFAULT_W = 800
// Approximate advance of an 11px DM Mono glyph (0.6em), for fit checks.
const CHAR_W = 6.6

// Measures the rendered width of the chart's <svg> (same pattern as
// KpiGrid): returns [ref, width], width = DEFAULT_W until measured.
// A callback ref, so a chart that first renders empty (null) still gets
// measured once its <svg> mounts.
function useMeasuredWidth() {
  const [el, setEl] = useState(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width > 0 ? width : DEFAULT_W]
}

// The colour a bar actually shows: `color` at `opacity` over the card.
// Returns the bar colour itself when either colour is not a hex value.
function blendOver(color, bg, opacity) {
  const a = parseHex(color), b = parseHex(bg)
  if (!a || !b) return color
  const mix = (x, y) => Math.round(x * opacity + y * (1 - opacity)).toString(16).padStart(2, '0')
  return '#' + mix(a.r, b.r) + mix(a.g, b.g) + mix(a.b, b.b)
}

// Label colour for text drawn on a bar (falls back to white, the old
// behaviour, when the bar colour cannot be parsed).
function inkOnBar(color, T) {
  const shown = blendOver(color, T.card || T.surface, BAR_OPACITY)
  return parseHex(shown) ? readableOn(shown) : 'white'
}

const BAR_OPACITY = 0.85

function truncate(label, maxChars) {
  const s = String(label ?? '')
  if (s.length <= maxChars) return s
  return maxChars <= 1 ? '…' : s.slice(0, maxChars - 1) + '…'
}

function seriesSummary(kind, series, fmt) {
  return `${kind}: ` + series.map(d => `${d.label} ${fmt(d.value)}`).join(', ')
}


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
export function BarChart({ data, T, accent, fmt = String, height = 220, maxBars = 12, ariaLabel }) {
  const [ref, W] = useMeasuredWidth()
  const series = data.slice(0, maxBars)
  if (series.length === 0) return null

  const max = niceMax(Math.max(...series.map(d => d.value), 0))
  const H = height, padL = 60, padR = 12, padT = 14, padB = 44
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const barW = innerW / series.length * 0.7
  const gap  = innerW / series.length * 0.3

  const ticks = 4
  const tickVals = Array.from({length: ticks + 1}, (_, i) => max * i / ticks)

  const rotate = series.length > 6
  // Unrotated labels get their slot's width; rotated ones the old 16 chars.
  const labelChars = rotate ? 16 : Math.max(3, Math.floor((barW + gap) / CHAR_W))

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height,display:'block'}}
      role="img" aria-label={ariaLabel || seriesSummary('Bar chart', series, fmt)}>
      {/* Grid + Y labels */}
      {tickVals.map((v,i) => {
        const y = padT + innerH - (v/max)*innerH
        return (
          <g key={i}>
            <line x1={padL} x2={W-padR} y1={y} y2={y} stroke={T.border} strokeDasharray={i===0?'0':'2 3'} strokeWidth="0.6"/>
            <text x={padL-6} y={y+3} fontFamily={MONO} fontSize="11" fill={T.muted} textAnchor="end">{fmt(v)}</text>
          </g>
        )
      })}
      {/* Bars */}
      {series.map((d, i) => {
        const h = (d.value / max) * innerH
        const x = padL + i*(barW+gap) + gap/2
        const y = padT + innerH - h
        const color = d.color || accent
        const valueText = fmt(d.value)
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(h, 0.5)} rx="3" fill={color} opacity={BAR_OPACITY}/>
            {/* Inline value at the top of the bar (only if it fits), in
                whichever ink reads on that bar's colour */}
            {h > 18 && String(valueText).length * CHAR_W <= barW + 4 && (
              <text x={x + barW/2} y={y + 12} fontFamily={MONO} fontSize="11" fill={inkOnBar(color, T)} textAnchor="middle" fontWeight="700">
                {valueText}
              </text>
            )}
            {/* X label, rotated if many */}
            <text x={x + barW/2} y={H - padB + 12} fontFamily={MONO} fontSize="11" fill={T.muted} textAnchor="middle"
              transform={rotate ? `rotate(-30 ${x + barW/2} ${H - padB + 12})` : ''}>
              {String(d.label).length > 18 || String(d.label).length > labelChars ? truncate(d.label, Math.min(17, labelChars)) : d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── RANKED HORIZONTAL BAR ───────────────────────────────────────────────
// One bar per item, sorted by value, with the label inside the bar at
// left — or just past the bar's end when the bar is too short to hold it.
// Used for yield comparison.
//
//   data: [{ label, value, color? }]  -- pre-sorted by caller
export function RankedBar({ data, T, accent, fmt = String, height = null, maxBars = 12, ariaLabel }) {
  const [ref, W] = useMeasuredWidth()
  const series = data.slice(0, maxBars)
  if (series.length === 0) return null

  const rowH = 26
  const H = height ?? series.length * rowH + 12
  const padL = 8, padR = 80
  const max = Math.max(...series.map(d => d.value), 0)
  const innerW = W - padL - padR

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height:H,display:'block'}}
      role="img" aria-label={ariaLabel || seriesSummary('Ranked bar chart', series, fmt)}>
      {series.map((d, i) => {
        const barW = max > 0 ? Math.max(0, (d.value / max) * innerW) : 0
        const y = i * rowH + 4
        const color = d.color || accent
        const label = String(d.label).length > 32 ? truncate(d.label, 31) : String(d.label)
        const inside = label.length * CHAR_W + 16 <= barW
        // Outside: from the bar's end to the value column.
        const outsideChars = Math.max(1, Math.floor((innerW - barW - 12) / CHAR_W))
        return (
          <g key={i}>
            <rect x={padL} y={y} width={barW} height={rowH - 6} rx="3" fill={color} opacity={BAR_OPACITY}/>
            <text x={inside ? padL + 8 : padL + barW + 6} y={y + (rowH-6)/2 + 4} fontFamily={MONO} fontSize="11"
              fill={inside ? inkOnBar(color, T) : T.text} fontWeight="700">
              {inside ? label : truncate(label, outsideChars)}
            </text>
            <text x={W - padR + 8} y={y + (rowH-6)/2 + 4} fontFamily={MONO} fontSize="11" fill={T.text} fontWeight="700">
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
export function AreaChart({ data, T, accent, fmt = String, height = 200, ariaLabel }) {
  const [ref, W] = useMeasuredWidth()
  if (data.length < 2) return null
  const H = height, padL = 56, padR = 12, padT = 14, padB = 34
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
  // At true pixel size 12 month labels no longer fit a phone card; show
  // every nth so they don't overprint.
  const longest = Math.max(...data.map(d => String(d.label ?? '').length), 1)
  const step = innerW / (data.length - 1)
  const labelStep = Math.max(1, Math.ceil((longest * CHAR_W + 6) / step))

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height,display:'block'}}
      role="img" aria-label={ariaLabel || seriesSummary('Area chart', data, fmt)}>
      {/* Grid + Y labels */}
      {tickVals.map((v,i) => {
        const y = pointY(v)
        return (
          <g key={i}>
            <line x1={padL} x2={W-padR} y1={y} y2={y} stroke={T.border} strokeDasharray={v===0?'0':'2 3'} strokeWidth="0.6"/>
            <text x={padL-6} y={y+3} fontFamily={MONO} fontSize="11" fill={T.muted} textAnchor="end">{fmt(v)}</text>
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
      {data.map((d,i) => (i % labelStep !== 0 && i !== data.length - 1) ? null : (
        <text key={i} x={pointX(i)} y={H - padB + 14} fontFamily={MONO} fontSize="11" fill={T.muted} textAnchor="middle">
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
export function DonutChart({ value, percent, label, T, accent, color, sublabel, size = 180, ariaLabel }) {
  const c = color || accent
  const r = size * 0.42
  const stroke = size * 0.13
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  const fill = Math.min(Math.max(percent, 0), 100) / 100
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{display:'block'}}
      role="img" aria-label={ariaLabel || [label || 'Donut chart', [value, sublabel].filter(v => v != null && v !== '').join(' '), `${Math.round(fill * 100)}%`].filter(Boolean).join(': ')}>
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
