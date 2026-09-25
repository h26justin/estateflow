import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import { ImportRefurbInvoice, InvoiceDetail } from '../RefurbInvoices'

const createRefurbInvoice = vi.fn(async (inv, allocs) => ({ invoice: { id: 'new', ...inv, refurb_invoice_allocations: allocs }, extras: [] }))
const logRefurbInvoicePayment = vi.fn(async () => [{ id: 'l1', project_id: 'p1', kind: 'payment', amount: 500, invoice_id: 'i1' }])
vi.mock('../../lib/api', () => ({
  createRefurbInvoice: (...a) => createRefurbInvoice(...a),
  uploadRefurbInvoiceFile: vi.fn(),
  logRefurbInvoicePayment: (...a) => logRefurbInvoicePayment(...a),
  updateRefurbInvoice: vi.fn(), deleteRefurbInvoice: vi.fn(), getCompanyDocumentSignedUrlById: vi.fn(),
}))

const companies = [{ id: 'co', name: 'Cloisters Ltd', abbr: 'CL' }]
const props = Array.from({ length: 10 }, (_, i) => ({
  id: `prop${i + 1}`, company_id: 'co', status: 'refurb', name: `Flat ${i + 1}, The Cloisters`,
  refurb_projects: [{ id: `proj${i + 1}`, property_id: `prop${i + 1}`, stage: 'in_progress', title: 'Refurbishment', refurb_lines: [] }],
}))
const wrap = ui => render(<ThemeProvider><ConfirmProvider>{ui}</ConfirmProvider></ThemeProvider>)

beforeEach(() => { createRefurbInvoice.mockClear(); logRefurbInvoicePayment.mockClear() })

describe('Import refurb invoice', () => {
  it('£25,000 across a whole 10-flat block, even split, reconciles and saves without paying anything', async () => {
    const onCreated = vi.fn()
    const mutations = { createProject: vi.fn() }
    wrap(<ImportRefurbInvoice properties={props} companies={companies} invoices={[]} canEditFor={() => true} mutations={mutations}
      onCreated={onCreated} onCancel={vi.fn()} showToast={vi.fn()} T={undefined} isMobile={false} />)
    fireEvent.click(screen.getByText('Enter manually without a file'))
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'GLB Building' } })        // supplier
    fireEvent.change(inputs[1], { target: { value: 'INV-0022' } })            // number
    const gross = inputs.find(el => el.closest('div')?.previousSibling?.textContent === 'Gross *') || inputs[4]
    fireEvent.change(gross, { target: { value: '25000' } })
    fireEvent.blur(gross)
    fireEvent.click(screen.getByText('Allocate to properties →'))
    fireEvent.click(screen.getByText(/Whole block: The Cloisters \(10\)/))
    expect(screen.getAllByText('£2,500.00')).toHaveLength(10)
    const save = screen.getByText('Save invoice to 10 properties')
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(createRefurbInvoice).toHaveBeenCalled())
    const [inv, allocs] = createRefurbInvoice.mock.calls[0]
    expect(inv).toMatchObject({ supplier_name: 'GLB Building', invoice_number: 'INV-0022', company_id: 'co' })
    expect(allocs).toHaveLength(10)
    expect(allocs.reduce((s, a) => s + a.amount, 0)).toBe(25000)
    expect(allocs.every(a => a.is_variation === false)).toBe(true)
    expect(logRefurbInvoicePayment).not.toHaveBeenCalled()
    expect(mutations.createProject).not.toHaveBeenCalled()
  })

  it('blocks a duplicate supplier + invoice number', () => {
    const existing = [{ id: 'old', company_id: 'co', supplier_name: 'GLB Building Ltd', invoice_number: 'inv 0022', gross_amount: 100, doc_kind: 'invoice' }]
    wrap(<ImportRefurbInvoice properties={props} companies={companies} invoices={existing} canEditFor={() => true} mutations={{}}
      onCreated={vi.fn()} onCancel={vi.fn()} showToast={vi.fn()} isMobile={false} />)
    fireEvent.click(screen.getByText('Enter manually without a file'))
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'GLB Building' } })
    fireEvent.change(inputs[1], { target: { value: 'INV-0022' } })
    expect(screen.getByRole('alert').textContent).toMatch(/Already imported/)
    expect(screen.getByText('Allocate to properties →').disabled).toBe(true)
  })
})

describe('Invoice detail', () => {
  const invoice = { id: 'i1', company_id: 'co', supplier_name: 'GLB Building', invoice_number: 'INV-0022', gross_amount: 1000, allocation_basis: 'gross', approval_status: 'approved', doc_kind: 'invoice',
    refurb_invoice_allocations: [{ id: 'a1', project_id: 'proj1', property_id: 'prop1', amount: 500, split_method: 'even' }, { id: 'a2', project_id: 'proj2', property_id: 'prop2', amount: 500, split_method: 'even' }] }
  const projects = props.map(p => ({ ...p.refurb_projects[0] }))
  it('is not paid on import; Log payment records money separately', async () => {
    const onLinesAdded = vi.fn()
    wrap(<InvoiceDetail invoice={invoice} properties={props} companies={companies} projects={projects} lines={[]} canEdit
      onUpdated={vi.fn()} onDeleted={vi.fn()} onLinesAdded={onLinesAdded} onOpenProject={vi.fn()} onBack={vi.fn()} showToast={vi.fn()} isMobile={false} />)
    expect(screen.getByText(/Nothing paid yet/)).toBeTruthy()
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Log payment'))
    await waitFor(() => expect(logRefurbInvoicePayment).toHaveBeenCalled())
    expect(logRefurbInvoicePayment.mock.calls[0][1]).toMatchObject({ amount: 1000, kind: 'payment' })
    expect(onLinesAdded).toHaveBeenCalled()
  })
})
