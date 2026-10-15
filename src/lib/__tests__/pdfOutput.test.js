// PDF output regression: drives the real generators (Reports, Year-End Tax
// Pack, loan statements, deal pack, agent report, property summary) with fixed
// fake data and a fixed clock, then reads every document back through pdf.js,
// the same library the statement / document importers use. Guards jsPDF and
// pdf.js upgrades: page counts and the text on each page must not move.
//
// Set PDF_SNAPSHOT_DIR=/some/dir to also write each PDF and a JSON
// fingerprint (text + positions per page) for diffing across upgrades.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const captured = []

vi.mock('../pdfLibs', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    // Same constructor, but save() hands the bytes to the test instead of
    // starting a browser download.
    loadJsPDF: async () => {
      const JsPDF = await real.loadJsPDF()
      return function CapturingJsPDF(opts) {
        const doc = new JsPDF(opts)
        doc.save = (name) => { captured.push({ name, bytes: new Uint8Array(doc.output('arraybuffer')) }) }
        return doc
      }
    },
  }
})

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    fetchDealContacts: async () => [
      { name: 'Sam Solicitor', role: 'solicitor', company_name: 'Law & Co', email: 'sam@example.test', phone: '0100 000000' },
    ],
    fetchDealMilestones: async () => [
      { stage: 'offer', label: 'Offer accepted', completed: true, completed_date: '2026-08-01' },
      { stage: 'legal', label: 'Searches ordered', completed: false },
    ],
    fetchDealDocuments: async () => [
      { id: 'd1', name: 'Survey.pdf', caption: 'Level 2 survey', file_path: 'x/survey.pdf', uploaded_by: 'Justin', created_at: '2026-08-10T09:00:00Z' },
    ],
  }
})

const { loadJsPDF, loadPdfjs } = await import('../pdfLibs')
const { renderReportPDF, renderYearEndPackPDF } = await import('../reportPdf')
const { exportLoansPdf } = await import('../loanPdf')
const { exportDealPdf } = await import('../dealPdf')
const { drawAgentReportPdf } = await import('../agentReportPdf')
const { buildAgentReport } = await import('../agentReport')
const { exportPropertySummaryPDF } = await import('../api/properties')

// A small solid-colour RGB PNG, built by hand so no canvas is needed.
function makePng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3)
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return 'data:image/png;base64,' + png.toString('base64')
}

// Page count, and per page the text runs with their position (0.1pt) so a
// layout shift shows up as well as a wording change, plus the images drawn.
async function fingerprint(bytes) {
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const { items } = await page.getTextContent()
    const ops = await page.getOperatorList()
    const images = ops.fnArray.filter(fn => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject).length
    const [, , w, h] = page.view
    pages.push({
      size: [Math.round(w), Math.round(h)],
      images,
      text: items.filter(it => it.str.trim()).map(it => `${it.transform[4].toFixed(1)},${it.transform[5].toFixed(1)} ${it.str}`),
    })
  }
  await pdf.destroy()
  return { pages: pdf.numPages, perPage: pages }
}

const reportData = {
  title: 'Rent Roll', reportName: 'Rent Roll', company: 'Sample Lettings Ltd', period: '6 Apr 2026 - 5 Apr 2027',
  companyColor: '#3b4a3f',
  note: 'Figures are as recorded in Properly and exclude unverified receipts.',
  kpis: [['Properties', '3'], ['Rent pcm', '£2,450'], ['Arrears', '£150'], ['Yield', '6.4%']],
  headers: ['Property', 'Tenant', 'Rent pcm', 'Status'],
  rows: Array.from({ length: 45 }, (_, i) => [`Flat ${i + 1}, 10 High Street`, `Tenant ${i + 1}`, `£${(800 + i * 5).toLocaleString('en-GB')}`, i % 7 ? 'Paid' : 'Overdue']),
  totals: ['Total', '', '£41,400', ''],
}
const wideData = {
  ...reportData, reportName: 'Income and Expenditure',
  headers: ['Property', 'Rent', 'Repairs', 'Agent fees', 'Insurance', 'Mortgage interest', 'Net'],
  rows: Array.from({ length: 12 }, (_, i) => [`Flat ${i + 1}`, '£9,600', '£420', '£960', '£240', '£3,100', '£4,880']),
  totals: ['Total', '£115,200', '£5,040', '£11,520', '£2,880', '£37,200', '£58,560'],
}
const sectionData = {
  ...reportData, reportName: 'Company P&L', headers: undefined, rows: undefined, totals: undefined,
  sections: [
    { title: 'P&L lines', headers: ['Line', 'Amount'], rows: [['Rent received', '£24,000'], ['Repairs', '-£1,200'], ['Net profit', '£22,800']] },
    { title: 'Shareholder split', headers: ['Shareholder', 'Share', 'Amount'], rows: [['A. Shareholder', '50%', '£11,400'], ['B. Shareholder', '50%', '£11,400']] },
  ],
}

const loanBase = { company_id: 'c1', principal: 50000, annual_rate: 8, term_months: 24, received_date: '2026-01-15', lender_type: 'private', purpose: 'Refurbishment of Flat 2', reference: 'LN-001' }
const loans = [
  { ...loanBase, id: 'l1', lender_name: 'Example Private Lender', repayment_type: 'repayment', property_id: 'p1',
    payments: [{ period: 1, paid_date: '2026-02-15', amount: 2261.36 }, { period: 2, paid_date: '2026-03-16', amount: 2000 }] },
  { ...loanBase, id: 'l2', lender_name: 'Second Lender', repayment_type: 'interest_only', principal: 20000, annual_rate: 6, term_months: 12 },
  { ...loanBase, id: 'l3', lender_name: 'Bridge Co', repayment_type: 'rolled_up', principal: 75000, annual_rate: 10, term_months: 9 },
]
const companies = [{ id: 'c1', name: 'Sample Lettings Ltd', color: '#3b4a3f' }]
const properties = [{ id: 'p1', name: 'Flat 2', address: '10 High Street, Exampletown' }]

const deal = {
  id: 'deal1', name: '14 Station Road', address: '14 Station Road, Exampletown', status: 'offer', deal_type: 'btl',
  purchase_type: 'mortgage', purchase_price: 200000, deposit_percent: 25, mortgage_rate: 5, mortgage_type: 'interest_only',
  mortgage_term: 25, monthly_rent: 1100, void_percent: 4, agent_fee_percent: 10, maintenance_percent: 5,
  is_additional_property: true, legal_fees: 1500, survey_cost: 600, refurb_cost: 8000, insurance_monthly: 30,
  next_action: 'Chase the vendor solicitor for replies to enquiries.', notes: 'Good transport links; needs a new kitchen.',
  expected_completion_date: '2026-12-01',
}

const AGENT = { id: 'ag1', name: 'Example Agents' }
const agentProps = [1, 2, 3].map(n => ({
  id: String(n), name: `Flat ${n}, Piers View`, company_id: 'c1', company: { name: 'Sample Lettings Ltd' },
  status: 'rented', rent_pcm: 500 + n * 50, rent_due_day: 1, managed_by_agent_id: AGENT.id, tenant_name: `Tenant ${n}`,
  rent_payments: [8, 9, 10].map(m => ({ id: `${n}-${m}`, year: 2026, month: m, status: n === 2 && m === 9 ? 'unpaid' : (m === 10 ? 'unpaid' : 'paid'), amount: 500 + n * 50 })),
  tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
}))

const property = {
  name: 'Flat 2', address: '10 High Street, Exampletown', prop_type: 'Flat', status: 'rented', company: { name: 'Sample Lettings Ltd' },
  bedrooms: 2, bathrooms: 1, purchase_price: 150000, deposit: 37500, refurb_cost: 5000, stamp_duty: 4500, legal_fees: 1200,
  current_value: 175000, mortgage_amount: 112500, mortgage_rate: 0.0499, rent_pcm: 950,
}

// In the browser the worker is the hashed asset lib/pdfLibs points at; under
// Node pdf.js runs its "fake worker" in-process and needs the real file.
async function useNodeWorker() {
  const pdfjs = await loadPdfjs()
  const req = createRequire(import.meta.url)
  const file = ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs-dist/build/pdf.worker.min.js']
    .map(f => { try { return req.resolve(f) } catch { return null } }).find(Boolean)
  pdfjs.GlobalWorkerOptions.workerSrc = file.endsWith('.mjs') ? pathToFileURL(file).href : file
}

const results = {}
const snapDir = process.env.PDF_SNAPSHOT_DIR

async function run(key, fn) {
  const before = captured.length
  const ret = await fn()
  const direct = ret instanceof Uint8Array ? ret : null
  if (!direct) expect(captured.length).toBe(before + 1)
  const bytes = direct || captured[captured.length - 1].bytes
  const fp = await fingerprint(bytes)
  results[key] = fp
  if (snapDir) {
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, `${key}.pdf`), bytes)
    writeFileSync(join(snapDir, `${key}.json`), JSON.stringify(fp, null, 1))
  }
  return fp
}

const allText = fp => fp.perPage.flatMap(p => p.text.map(t => t.slice(t.indexOf(' ') + 1))).join('\n')

describe('PDF output through the real generators', () => {
  beforeAll(async () => {
    await useNodeWorker()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
  })
  afterAll(() => { vi.useRealTimers() })

  it('report PDF (portrait, paginated table)', async () => {
    const fp = await run('report-portrait', () => renderReportPDF(reportData))
    expect(fp.pages).toBe(2)
    expect(fp.perPage[0].size).toEqual([595, 842])
    const t = allText(fp)
    expect(t).toContain('Sample Lettings Ltd')
    expect(t).toContain('Flat 45, 10 High Street')
    expect(t).toContain('£41,400')
    expect(t).toContain('Generated 5 October 2026')
  })

  it('report PDF (landscape, wide table) and multi-section report', async () => {
    const wide = await run('report-landscape', () => renderReportPDF(wideData))
    expect(wide.perPage[0].size).toEqual([842, 595])
    expect(allText(wide)).toContain('MORTGAGE INTEREST')
    const sec = await run('report-sections', () => renderReportPDF(sectionData))
    expect(allText(sec)).toContain('Shareholder split')
    expect(allText(sec)).toContain('B. Shareholder')
  })

  it('year-end tax pack with contents page', async () => {
    const fp = await run('year-end-pack', () => renderYearEndPackPDF({
      company: 'Sample Lettings Ltd', companyColor: '#3b4a3f', period: '2026-27',
      reports: [{ name: 'Rent Roll', data: reportData }, { name: 'Income and Expenditure', data: wideData }, { name: 'Empty', data: null }],
    }))
    expect(fp.pages).toBe(5)
    expect(allText(fp)).toContain('Year-End Tax Pack')
    expect(allText(fp)).toContain('CONTENTS')
    expect(allText(fp)).toContain('No data for this period.')
  })

  it('loan statement and loans report', async () => {
    const one = await run('loan-statement', () => exportLoansPdf({ loans: [loans[0]], companies, properties }))
    expect(allText(one)).toContain('Example Private Lender')
    expect(allText(one)).toContain('£2,261.36')
    const many = await run('loans-report', () => exportLoansPdf({ loans, companies, properties }))
    expect(one.pages).toBe(2)
    expect(many.pages).toBe(6)
    expect(allText(many)).toContain('Bridge Co')
  })

  it('deal pack', async () => {
    const fp = await run('deal-pack', () => exportDealPdf({ deal, company: companies[0] }))
    const t = allText(fp)
    expect(t).toContain('14 Station Road')
    expect(t).toContain('Sam Solicitor')
    expect(t).toContain('Prepared 5 October 2026')
    expect(fp.pages).toBe(3)
  })

  it('agent report with an embedded PNG logo', async () => {
    const JsPDF = await loadJsPDF()
    const model = buildAgentReport(agentProps, { agent: AGENT, asOf: '2026-10-05', companies: [{ id: 'c1', name: 'Sample Lettings Ltd', color: '#3b4a3f' }] })
    const logo = { data: makePng(40, 20, [59, 74, 63]), w: 40, h: 20 }
    const mark = { data: makePng(16, 16, [184, 144, 47]), w: 16, h: 16 }
    const fp = await run('agent-report', () => new Uint8Array(drawAgentReportPdf(JsPDF, model, { logos: { c1: logo }, mark }).output('arraybuffer')))
    expect(allText(fp)).toContain('Example Agents')
    expect(fp.pages).toBe(3)
    expect(fp.perPage.map(p => p.images)).toEqual([1, 0, 1])
  })

  it('property summary', async () => {
    const fp = await run('property-summary', () => exportPropertySummaryPDF(property))
    expect(fp.pages).toBe(1)
    expect(allText(fp)).toContain('GBP 150,000')
  })
})

describe('pdf.js import path', () => {
  beforeAll(useNodeWorker)
  it('extracts text from a jsPDF document with the statement importer', async () => {
    const { extractPdfTextFromFile } = await import('../pdfExtract')
    const JsPDF = await loadJsPDF()
    const doc = new JsPDF({ unit: 'mm', format: 'a4' })
    doc.text('Statement for 10 High Street', 15, 20)
    doc.text('01/09/2026   Rent received   £950.00', 15, 30)
    doc.addPage()
    doc.text('Closing balance £1,234.56', 15, 20)
    const bytes = doc.output('arraybuffer')
    const file = { arrayBuffer: async () => bytes }
    const text = await extractPdfTextFromFile(file)
    expect(text).toContain('Statement for 10 High Street')
    expect(text).toContain('Rent received')
    expect(text).toContain('£950.00')
    expect(text).toContain('Closing balance £1,234.56')
  })

  it('rejects a file that is not a PDF', async () => {
    const { extractPdfTextFromFile } = await import('../pdfExtract')
    const file = { arrayBuffer: async () => new TextEncoder().encode('not a pdf').buffer }
    await expect(extractPdfTextFromFile(file)).rejects.toThrow()
  })
})
