import { describe, it, expect } from 'vitest'
import writeExcelFile from 'write-excel-file/node'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDealExportModel, modelGroups } from '../dealExport'
import { buildDealsWorkbook, SHEET_NAMES, colLetter } from '../dealExportXlsx'

const line = (deal_id, category, amount, state = 'confirmed', extra = {}) => ({ id: `${deal_id}-${category}-${amount}`, deal_id, category, amount, state, ...extra })

// Contact-style fields and notes; none may reach the workbook.
const CONTACTY = {
  solicitor_name: 'Sam Solicitor', solicitor_email: 'sam@law.example', solicitor_phone: '0100 000000',
  vendor_name: 'Val Vendor', agent_email: 'agent@example.test', notes: 'Call Sam on 0100 000000',
}
const FORBIDDEN = ['Sam Solicitor', 'sam@law.example', '0100 000000', 'Val Vendor', 'agent@example.test', 'Broker Bob', '07700 900000', 'Ring Sam']

const companies = [
  { id: 'c1', name: 'Alpha Homes Ltd', abbr: 'AH', color: '#3b4a3f' },
  { id: 'c2', name: 'Beta Lets Ltd', abbr: 'BL' },
]
const deals = [
  { id: 'd1', name: 'Park Row', company_id: 'c1', status: 'conveyancing', purchase_price: 15000, expected_completion_date: '2026-11-27',
    next_action: 'Chase searches', next_action_due: '2026-11-21', ...CONTACTY },
  { id: 'd2', name: 'Douro Terrace', company_id: 'c1', status: 'exchanged', purchase_price: 150000, legal_fees: 1500, refurb_cost: 12000,
    target_completion_date: '2026-12-10', ...CONTACTY },
  { id: 'd3', name: 'Fallen Lane', company_id: 'c1', status: 'dead', purchase_price: 90000, expected_completion_date: '2026-11-30' },
  { id: 'd5', name: 'Beta One', company_id: 'c2', status: 'under_offer', purchase_price: 80000, expected_completion_date: '2026-12-01' },
  { id: 'd6', name: 'No Company Close', company_id: null, status: 'analysing', purchase_price: 60000, expected_completion_date: '2027-01-15' },
  { id: 'd7', name: 'Unknown Price', company_id: 'c2', status: 'analysing' },
]
const linesByDeal = {
  d1: [
    line('d1', 'purchase_price', 15000), line('d1', 'sdlt', 750), line('d1', 'legal_fee', 900.1, 'quoted', { notes: 'Ring Sam on 0100 000000', source: 'Solicitor quote' }),
    line('d1', 'legal_vat', 180.02, 'quoted'), line('d1', 'searches', 159), line('d1', 'on_account', 300.03, 'paid'),
    line('d1', 'refurb', 4000, 'estimate'),
  ],
  d3: [line('d3', 'purchase_price', 90000)],
}
const fundingByDeal = {
  d1: [{ id: 'f1', deal_id: 'd1', source: 'mortgage', amount: 10000, state: 'confirmed', notes: 'Broker Bob 07700 900000' },
    { id: 'f2', deal_id: 'd1', source: 'investor', amount: 2000, state: 'expected' }],
  d2: [{ id: 'f3', deal_id: 'd2', source: 'company_cash', amount: 50000, state: 'confirmed' }],
}
const cashByCompany = {
  c1: [{ company_id: 'c1', as_of: '2026-11-18', amount: 30000 }],
  c2: { company_id: 'c2', as_of: '2026-11-15', amount: 100000, note: 'Ring Sam on 0100 000000' },
}
const model = buildDealExportModel({
  deals, companies, linesByDeal, fundingByDeal, cashByCompany,
  asOf: new Date('2026-11-19T14:05:00Z'), filters: { companyId: 'all', status: 'all' },
})

// ── a minimal .xlsx reader: unzip and read cells (value and formula) ────────
function readXlsx(buf) {
  const files = unzipSync(new Uint8Array(buf))
  const xml = name => new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml')
  const shared = files['xl/sharedStrings.xml']
    ? [...xml('xl/sharedStrings.xml').getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join(''))
    : []
  const rels = {}
  for (const r of xml('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target')
  const sheets = {}
  const names = []
  for (const s of xml('xl/workbook.xml').getElementsByTagName('sheet')) {
    const name = s.getAttribute('name')
    names.push(name)
    const target = rels[s.getAttribute('r:id')].replace(/^\/?(xl\/)?/, 'xl/')
    const cells = {}
    for (const c of xml(target).getElementsByTagName('c')) {
      const v = c.getElementsByTagName('v')[0]?.textContent
      const f = c.getElementsByTagName('f')[0]?.textContent
      const t = c.getAttribute('t')
      cells[c.getAttribute('r')] = { f: f ?? null, v: v == null ? null : t === 's' ? shared[Number(v)] : t === 'b' ? v === '1' : Number(v) }
    }
    sheets[name] = cells
  }
  return { names, sheets, raw: Object.values(files).map(u => strFromU8(u)).join('\n') }
}

// Evaluate the few formula shapes the workbook writes, against its own cells.
function evaluate(cells, ref, seen = new Set()) {
  if (seen.has(ref)) throw new Error(`cycle at ${ref}`)
  const c = cells[ref]
  if (!c) return 0
  if (c.f == null) return typeof c.v === 'number' ? c.v : 0
  const val = r => evaluate(cells, r, new Set([...seen, ref]))
  const expr = c.f.replace(/^=/, '')
  let m
  if ((m = expr.match(/^SUM\(([A-Z]+)(\d+):\1(\d+)\)$/))) {
    let s = 0
    for (let i = Number(m[2]); i <= Number(m[3]); i++) s += val(`${m[1]}${i}`)
    return s
  }
  if ((m = expr.match(/^MAX\(0,(.+)\)$/))) return Math.max(0, arith(m[1], val))
  return arith(expr, val)
}
function arith(expr, val) {
  const terms = expr.match(/[+-]?[A-Z]+\d+/g)
  if (!terms || terms.join('') !== expr) throw new Error(`unexpected formula ${expr}`)
  return terms.reduce((s, t) => (t[0] === '-' ? s - val(t.slice(1)) : s + val(t.replace(/^\+/, ''))), 0)
}
const penny = v => Math.round(v * 100)

async function workbook() {
  const sheets = buildDealsWorkbook(model)
  const buf = await writeExcelFile(sheets).toBuffer()
  return { sheets, book: readXlsx(buf) }
}

describe('colLetter', () => {
  it('maps indexes to Excel column letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })
})

describe('buildDealsWorkbook', () => {
  it('writes the six sheets in order', async () => {
    const { book } = await workbook()
    expect(book.names).toEqual([
      SHEET_NAMES.dashboard, SHEET_NAMES.deals, SHEET_NAMES.lines, SHEET_NAMES.funding, SHEET_NAMES.methodology, SHEET_NAMES.dataQuality,
    ])
    expect(book.names).toEqual(['Dashboard', 'Deals', 'Cost lines', 'Completion funding', 'Assumptions & methodology', 'Data quality'])
  })

  it('dashboard carries the as-of date, filters and per-company figures, with formulas that equal the model', async () => {
    const { book } = await workbook()
    const d = book.sheets.Dashboard
    expect(d.B3.v).toBe('2026-11-19')
    expect(d.B4.v).toBe(model.filters.text)
    expect(d.B2.v).toBe(model.asOfLabel)
    const groups = modelGroups(model)
    groups.forEach((g, i) => {
      const r = 7 + i
      expect(d[`A${r}`].v).toBe(g.company.name)
      expect(d[`C${r}`].v).toBe(g.totals.balanceDue)
      expect(d[`E${r}`].v).toBe(g.totals.cashNeed)
      expect(d[`H${r}`].f).toBe(`MAX(0,E${r}-F${r})`)
      expect(penny(evaluate(d, `H${r}`))).toBe(penny(g.totals.fundingGap))
      expect(penny(evaluate(d, `J${r}`))).toBe(penny(g.totals.combinedGap))
    })
    const total = 7 + groups.length
    expect(d[`A${total}`].v).toBe('Total')
    expect(d[`H${total}`].f).toBe(`SUM(H7:H${total - 1})`)
    expect(penny(evaluate(d, `H${total}`))).toBe(penny(model.totals.fundingGap))
    expect(penny(evaluate(d, `E${total}`))).toBe(penny(model.totals.cashNeed))
    expect(penny(evaluate(d, `C${total}`))).toBe(penny(model.totals.balanceDue))
    // c2 has more cash than it needs: no gap, never offset against c1's gap.
    const c2 = groups.findIndex(g => g.company.id === 'c2')
    expect(evaluate(d, `H${7 + c2}`)).toBe(0)
    expect(model.totals.fundingGap).toBeGreaterThan(0)
  })

  it('deals sheet: balance due = total − credits and cash need as formulas that equal the model', async () => {
    const { book } = await workbook()
    const s = book.sheets.Deals
    expect(s.K1.v).toBe('Balance due')
    expect(s.I1.v).toBe('Completion total')
    expect(s.J1.v).toBe('Credits')
    const rows = modelGroups(model).flatMap(g => g.deals)
    rows.forEach((r, i) => {
      const n = i + 2
      expect(s[`B${n}`].v).toBe(r.name)
      if (r.balanceDue == null) { expect(s[`K${n}`]).toBeUndefined(); return }
      expect(s[`K${n}`].f).toBe(`I${n}-J${n}`)
      expect(penny(evaluate(s, `K${n}`))).toBe(penny(r.balanceDue))
      expect(s[`P${n}`].f).toBe(`MAX(0,K${n}-N${n})`)
      expect(penny(evaluate(s, `P${n}`))).toBe(penny(r.cashNeed))
    })
    // Park Row: 15000 + 750 + 900.10 + 180.02 + 159 − 300.03 on account.
    const park = rows.findIndex(r => r.name === 'Park Row') + 2
    expect(penny(evaluate(s, `K${park}`))).toBe(penny(16689.09))
  })

  it('cost lines sheet lists every line and funding row, amounts as numbers', async () => {
    const { book } = await workbook()
    const s = book.sheets['Cost lines']
    const amounts = Object.entries(s).filter(([k]) => /^G\d+$/.test(k) && k !== 'G1').map(([, c]) => c.v)
    expect(amounts).toEqual(expect.arrayContaining([15000, 750, 900.1, 180.02, 159, 300.03, 4000, 10000, 2000, 50000, 90000]))
    expect(Object.values(s).some(c => c.v === 'Funding')).toBe(true)
  })

  it('completion funding: weekly schedule per company, running total and shortfall equal the model', async () => {
    const { book } = await workbook()
    const s = book.sheets['Completion funding']
    const byValue = v => Object.entries(s).find(([, c]) => c.v === v)?.[0]
    for (const g of modelGroups(model)) {
      const at = byValue(g.company.name)
      expect(at).toBeTruthy()
      let row = Number(at.slice(1)) + 2
      for (const wk of g.funding.weeks) {
        expect(s[`A${row}`].v).toBe(wk.week)
        expect(s[`E${row}`].v).toBe(wk.need)
        expect(penny(evaluate(s, `G${row}`))).toBe(penny(wk.cumulative))
        expect(penny(evaluate(s, `I${row}`))).toBe(penny(wk.shortfall))
        row += 1
      }
    }
  })

  it('methodology and data quality sheets carry the model text', async () => {
    const { book } = await workbook()
    const m = Object.values(book.sheets['Assumptions & methodology']).map(c => c.v)
    for (const s of model.methodology) expect(m).toContain(s)
    const q = Object.values(book.sheets['Data quality']).map(c => c.v)
    for (const s of model.dataQuality) expect(q).toContain(s)
  })

  it('never includes contacts, notes or phone numbers', async () => {
    const { sheets, book } = await workbook()
    const json = JSON.stringify(sheets)
    for (const s of FORBIDDEN) {
      expect(json).not.toContain(s)
      expect(book.raw).not.toContain(s)
    }
  })

  it('writes a valid workbook for an empty export', async () => {
    const empty = buildDealExportModel({ deals: [], companies, asOf: '2026-11-19' })
    const buf = await writeExcelFile(buildDealsWorkbook(empty)).toBuffer()
    const book = readXlsx(buf)
    expect(book.names).toHaveLength(6)
    expect(Object.values(book.sheets.Dashboard).some(c => c.v === 'No deals match these filters.')).toBe(true)
  })
})
