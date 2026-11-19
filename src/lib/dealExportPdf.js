// ── DEALS FUNDING PDF ────────────────────────────────────────────────────────
// Company / All Deals export (Deals brief §10), drawn from the export model in
// lib/dealExport, which takes every number from lib/dealFinance. Per company:
// an executive summary (balance due, cash available, funding gap, refurb
// forecast, weekly schedule) and a property schedule; then a Methodology &
// assumptions page and a data-quality page. The as-of time and the filters
// are printed at the top and in the footer of every page.
//
// Same kit as the Reports PDFs (lib/reportPdfKit) and jsPDF lazy-loaded
// through lib/pdfLibs, so none of this is in the entry bundle.

import { loadJsPDF } from './pdfLibs'
import { createPdfWriter, loadPdfImage, hexToRgb, PALETTE } from './reportPdfKit'
import { gbp, dateGB } from './dealFinance'
import { modelGroups, exportFileName } from './dealExport'

// dealFinance prints a true minus sign; Helvetica (Latin-1) has none.
const t = s => String(s ?? '').replace(/−/g, '-').replace(/≤/g, '<=')
const money = v => (v == null ? 'Unknown' : t(gbp(v)))

/** Draw the PDF into a new jsPDF document and return the writer. */
export function drawDealsPdf(JsPDF, model, { title, mark = null } = {}) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const groups = modelGroups(model)
  const single = groups.length === 1 ? groups[0] : null
  const accent = single?.company.color ? hexToRgb(single.company.color) : null
  const stamp = `As of ${model.asOfLabel} · ${model.filters.text}`
  const w = createPdfWriter(doc, { accent, mark, footerLabel: `As of ${model.asOfLabel}` })
  const P = PALETTE

  function paragraph(s, { size = 9, color = P.slate, gap = 2.2, bullet = false } = {}) {
    w.font(size, 'normal', color)
    const indent = bullet ? 4 : 0
    const lines = w.wrap(t(s), w.CW - indent)
    w.ensure(Math.min(lines.length, 3) * 4.4 + gap)
    if (bullet) { w.font(size, 'bold', P.gold); w.text('-', w.M, w.y + 3.4); w.font(size, 'normal', color) }
    lines.forEach(l => { w.ensure(4.6); w.text(l, w.M + indent, w.y + 3.4); w.y += 4.4 })
    w.y += gap
  }

  const kpisFor = (totals, unassigned) => [
    { label: 'Balance due', value: money(totals.balanceDue), sub: `${totals.liveDeals} live deal${totals.liveDeals === 1 ? '' : 's'}` },
    { label: 'Cash available', value: unassigned ? 'n/a' : totals.cash == null ? 'Not entered' : money(totals.cash), sub: unassigned ? 'no company' : totals.cashAsOf ? `as of ${dateGB(totals.cashAsOf)}` : totals.cash == null ? 'taken as £0' : undefined },
    { label: 'Funding gap', value: money(totals.fundingGap), color: totals.fundingGap > 0 ? P.red : P.green, sub: `cash need ${money(totals.cashNeed)}` },
    { label: 'Refurb forecast', value: money(totals.refurbForecast), sub: totals.refurbForecast > 0 ? `with refurb gap ${money(totals.combinedGap)}` : 'separate from completion' },
  ]

  // ── cover / summary ───────────────────────────────────────────────────────
  w.letterhead({
    title: title || (single ? single.company.name : 'All deals'),
    subtitle: 'Deals: costs, funding and cash need',
    meta: [`As of ${model.asOfLabel}`, ...model.filters.labels],
  })
  if (!groups.length) {
    w.note('No deals match these filters.')
  } else if (!single) {
    w.heading('All deals: summary')
    w.kpis(kpisFor(model.totals, false))
    w.table({
      headers: ['Company', 'Live deals', 'Balance due', 'Cash need', 'Cash available', 'Funding gap', 'Refurb'],
      rows: groups.map(g => [g.company.name, String(g.totals.liveDeals), money(g.totals.balanceDue), money(g.totals.cashNeed),
        g.company.unassigned ? 'n/a' : g.totals.cash == null ? 'Not entered' : money(g.totals.cash), money(g.totals.fundingGap), money(g.totals.refurbForecast)]),
      totals: ['Total', String(model.totals.liveDeals), money(model.totals.balanceDue), money(model.totals.cashNeed), money(model.totals.cash), money(model.totals.fundingGap), money(model.totals.refurbForecast)],
    })
    w.note('The funding gap is worked out per company and then added up: one company\'s cash cannot pay for another company\'s purchase.')
  }

  // ── per company ───────────────────────────────────────────────────────────
  groups.forEach((g, gi) => {
    const f = g.funding
    if (!single || gi > 0) { w.newPage() }
    w.sectionBand(g.company.name, `${g.totals.deals} deal${g.totals.deals === 1 ? '' : 's'} listed · ${g.totals.liveDeals} counted in funding`)
    w.kpis(kpisFor(g.totals, g.company.unassigned))

    w.heading('Weekly schedule')
    const weekRows = f.weeks.map(wk => [
      `w/c ${dateGB(wk.week)}${wk.overdue ? ' (overdue)' : ''}`,
      wk.deals.map(id => g.deals.find(r => r.id === id)?.name || 'Deal').join(', '),
      money(wk.need) + (wk.unknownCount ? ` +${wk.unknownCount} unknown` : ''),
      money(wk.cumulative),
      wk.shortfall > 0 ? money(wk.shortfall) : '-',
    ])
    if (f.unscheduled.deals.length) {
      weekRows.push(['Unscheduled', f.unscheduled.deals.map(id => g.deals.find(r => r.id === id)?.name || 'Deal').join(', '),
        money(f.unscheduled.need) + (f.unscheduled.unknownCount ? ` +${f.unscheduled.unknownCount} unknown` : ''), '', ''])
    }
    w.table({
      headers: [{ label: 'Week', w: 0.2 }, { label: 'Deals', w: 0.38 }, { label: 'Need', w: 0.16, align: 'right' }, { label: 'To date', w: 0.13, align: 'right' }, { label: 'Short', w: 0.13, align: 'right' }],
      rows: weekRows,
    })

    w.heading('Property schedule')
    w.table({
      headers: [{ label: 'Deal', w: 0.2 }, { label: 'Stage', w: 0.13 }, { label: 'Due', w: 0.12 }, { label: 'Balance due', w: 0.11, align: 'right' },
        { label: 'Confirmed financing', w: 0.12, align: 'right' }, { label: 'Cash need', w: 0.11, align: 'right' }, { label: 'Refurb', w: 0.09, align: 'right' }, { label: 'Basis', w: 0.12 }],
      rows: g.deals.map(r => ({
        cells: [
          [r.partOf ? `  ${r.name}` : r.name, r.partOf ? `Part of ${r.partOf}` : (r.excludedReason || (r.groupRole === 'parent' ? `Group purchase · ${r.unitCount} unit${r.unitCount === 1 ? '' : 's'}` : '') || r.attention || r.nextAction || '')],
          r.excludedReason ? [r.stage, 'Not counted'] : r.partOf ? [r.stage, 'Counted on parent'] : r.stage,
          r.expectedCompletion ? dateGB(r.expectedCompletion) : 'No date',
          money(r.balanceDue), money(r.financingConfirmed), money(r.cashNeed),
          r.refurbForecast == null ? '-' : money(r.refurbForecast),
          r.basis === 'lines' ? ['Itemised', r.stateLabel] : 'Estimate',
        ],
        colors: r.excludedReason || r.partOf ? Array(8).fill(P.faint) : undefined,
      })),
      totals: ['Counted in funding', '', '', money(g.totals.balanceDue), money(g.totals.financingConfirmed), money(g.totals.cashNeed), money(g.totals.refurbForecast), ''],
    })
    if (g.totals.financingExpected > 0) w.note(`Expected financing of ${money(g.totals.financingExpected)} is not deducted until it is confirmed.`)

    w.heading('How calculated')
    f.explain.forEach(s => paragraph(s, { bullet: true, gap: 0.8 }))
    w.y += 3
  })

  // ── methodology ───────────────────────────────────────────────────────────
  w.newPage()
  w.sectionBand('Methodology & assumptions', 'How every number in this export is worked out')
  model.methodology.forEach(s => paragraph(s, { bullet: true, gap: 1.6 }))

  // ── data quality ──────────────────────────────────────────────────────────
  w.newPage()
  w.sectionBand('Data quality', 'Gaps to fill before relying on these numbers')
  model.dataQuality.forEach(s => paragraph(s, { bullet: true, gap: 1.2 }))

  // As-of and filters at the top of every page (the footer repeats the as-of).
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    w.font(6.8, 'normal', P.faint)
    w.text(w.wrap(stamp, w.CW)[0], w.W - w.M, 7.5, { align: 'right' })
  }
  w.finish()
  return w
}

/** Build and download the PDF. Returns { pages }. */
export async function exportDealsPdf(model, opts = {}) {
  const [JsPDF, mark] = await Promise.all([loadJsPDF(), loadPdfImage('/icon-512.png', 128).catch(() => null)])
  const w = drawDealsPdf(JsPDF, model, { ...opts, mark })
  w.doc.save(exportFileName(model, 'deals-funding', 'pdf'))
  return { pages: w.doc.internal.getNumberOfPages() }
}
