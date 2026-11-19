import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import DealDocumentExtract from '../DealDocumentExtract'
import * as api from '../../lib/api'
import { extractPdfPagesFromFile } from '../../lib/pdfExtract'

// 3 Park Row, as the brief's example (document text, not live data).
const PAGES = [[
  'COMPLETION STATEMENT',
  'Purchase price £15,000.00',
  'Stamp Duty Land Tax £0.00',
  'Our legal fees £1,450.00 plus VAT £290.00',
  'Searches £249.00',
  'Land Registry fee £50.00',
  'Total £17,039.00',
  'Less: monies received on account (£300.00)',
  'Balance due £16,739.00',
]]

let stored = []
vi.mock('../../lib/api', () => ({
  getDocumentSignedUrl: vi.fn(async () => 'https://storage.example/doc.pdf'),
  fetchExtractedFields: vi.fn(async () => stored),
  addExtractedFields: vi.fn(async rows => rows.map((r, i) => ({ ...r, id: `e${i}`, status: 'pending' }))),
  reviewExtractedField: vi.fn(async (id, { status, applied_to, value_number }) => {
    const row = stored.find(r => r.id === id) || {}
    return { ...row, id, status, applied_to: status === 'approved' ? applied_to : null, value_number: value_number ?? row.value_number }
  }),
  fetchDealCostLines: vi.fn(async () => []),
  upsertDealCostLine: vi.fn(async (dealId, row) => ({ id: row.id || 'line-new', deal_id: dealId, ...row })),
  deleteDealCostLine: vi.fn(async () => {}),
}))
vi.mock('../../lib/pdfExtract', () => ({ extractPdfPagesFromFile: vi.fn(async () => PAGES) }))

const doc = { id: 'doc1', name: 'Completion statement.pdf', file_path: 'u/deals/d1/x.pdf', type: 'application/pdf' }
const wrap = ui => render(<ThemeProvider><ConfirmProvider>{ui}</ConfirmProvider></ThemeProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  stored = []
  globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }))
})

describe('DealDocumentExtract', () => {
  it('extracts, stores pending suggestions and shows the balance check', async () => {
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}}/>)
    expect(await screen.findByTestId('suggestion-balance_due')).toBeTruthy()
    const inserted = api.addExtractedFields.mock.calls[0][0]
    expect(inserted.every(r => r.deal_id === 'd1' && r.document_id === 'doc1')).toBe(true)
    expect(inserted.find(r => r.field === 'balance_due')).toMatchObject({ value_number: 16739, page: 1 })
    expect(screen.getAllByText(/matches the balance due £16,739/).length).toBeGreaterThan(0)
  })

  it('approving writes a source-linked cost line, then marks the suggestion approved', async () => {
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}} showToast={() => {}}/>)
    const card = await screen.findByTestId('suggestion-sdlt')
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.reviewExtractedField).toHaveBeenCalled())
    expect(api.upsertDealCostLine).toHaveBeenCalledWith('d1', expect.objectContaining({
      category: 'sdlt', amount: 0, state: 'quoted', source: 'Completion statement.pdf p.1', notes: 'Stamp Duty Land Tax £0.00',
    }))
    expect(api.reviewExtractedField).toHaveBeenCalledWith(expect.any(String), { status: 'approved', applied_to: 'line-new', value_number: 0 })
  })

  it('asks before replacing an existing cost line of the same category', async () => {
    api.fetchDealCostLines.mockResolvedValueOnce([{ id: 'old', category: 'purchase_price', amount: 14000, state: 'estimate' }])
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}} showToast={() => {}}/>)
    const card = await screen.findByTestId('suggestion-purchase_price')
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))
    const prompt = await within(card).findByRole('alertdialog')
    expect(api.upsertDealCostLine).not.toHaveBeenCalled()
    fireEvent.click(within(prompt).getByRole('button', { name: /Replace £14,000/ }))
    await waitFor(() => expect(api.upsertDealCostLine).toHaveBeenCalledWith('d1', expect.objectContaining({ id: 'old', amount: 15000, category: 'purchase_price' })))
  })

  it('rejecting marks the row rejected and writes nothing else', async () => {
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}}/>)
    const card = await screen.findByTestId('suggestion-searches')
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(api.reviewExtractedField).toHaveBeenCalledWith(expect.any(String), { status: 'rejected' }))
    expect(api.upsertDealCostLine).not.toHaveBeenCalled()
  })

  it('shows stored suggestions after a reload without extracting again', async () => {
    stored = [{ id: 's1', deal_id: 'd1', document_id: 'doc1', field: 'total', value_number: 17039, page: 1, quote: 'Total £17,039.00', confidence: 0.9, status: 'pending' }]
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}}/>)
    expect(await screen.findByTestId('suggestion-total')).toBeTruthy()
    expect(api.addExtractedFields).not.toHaveBeenCalled()
  })

  it('says so when a scan has no text', async () => {
    extractPdfPagesFromFile.mockResolvedValueOnce([[]])
    wrap(<DealDocumentExtract dealId="d1" doc={doc} onClose={() => {}}/>)
    expect(await screen.findByText('No text found: enter the figures manually.')).toBeTruthy()
    expect(api.addExtractedFields).not.toHaveBeenCalled()
  })
})
