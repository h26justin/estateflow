import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import CompliancePage from '../CompliancePage'

// Every api function the page or its Insurance sub-page might call resolves
// to an empty list, constants (POLICY_TYPES etc.) stay real, and
// createCompliance echoes a row back so the building-wide entry can be
// asserted. Built from the real module so a new export never breaks this.
const { created } = vi.hoisted(() => ({ created: [] }))
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal()
  const mocked = {}
  for (const [k, v] of Object.entries(actual)) mocked[k] = typeof v === 'function' ? vi.fn().mockResolvedValue([]) : v
  mocked.createCompliance = vi.fn(async (propertyId, item) => { const row = { id: `c-${created.length + 1}`, property_id: propertyId, ...item }; created.push(row); return row })
  return mocked
})

const companies = [{ id: 'cA', name: 'Alpha Lets Ltd', abbr: 'ALPHA' }]
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const properties = [
  // Two flats in one building: only one has a valid gas certificate
  { id: 'p1', name: 'Flat 1, Test Court', address: '1 Test Court', company_id: 'cA', status: 'rented', has_gas_supply: true,
    compliance_items: [{ id: 'g1', cert_type: 'gas_safety', expiry_date: iso(200) }] },
  { id: 'p2', name: 'Flat 2, Test Court', address: '1 Test Court', company_id: 'cA', status: 'rented', has_gas_supply: true, compliance_items: [] },
  // A solo house with everything legal in date but an advisory PAT missing
  { id: 'p3', name: 'Solo House', address: '9 Other Rd', company_id: 'cA', status: 'rented', has_gas_supply: false, compliance_items: [
    { id: 'e3', cert_type: 'eicr', expiry_date: iso(400) }, { id: 'p3e', cert_type: 'epc', expiry_date: iso(900) },
    { id: 's3', cert_type: 'smoke_alarm', expiry_date: iso(100) }, { id: 'c3', cert_type: 'co_alarm', expiry_date: iso(100) },
  ] },
]

function renderPage() {
  return render(
    <ThemeProvider><ConfirmProvider>
      <CompliancePage user={{ id: 'u1' }} companies={companies} properties={properties} companySettings={{}} showToast={() => {}} openDetail={() => {}} />
    </ConfirmProvider></ThemeProvider>
  )
}

describe('Compliance page', () => {
  it('separates legal from advisory in the tiles', async () => {
    renderPage()
    expect(await screen.findByText('Missing (legal)')).toBeInTheDocument()
    expect(screen.getByText('Advisory gaps')).toBeInTheDocument()
    expect(screen.getByText('Legally in date')).toBeInTheDocument()
  })

  it('logs a certificate for a whole building, skipping units already in date', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Log a certificate for a whole building/ }))
    // Flat 1 already has a valid gas cert, so only Flat 2 is a target
    const go = await screen.findByRole('button', { name: /Log for 1 unit$/ })
    fireEvent.click(go)
    await screen.findByRole('button', { name: /Log a certificate for a whole building/ })   // form closes
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ property_id: 'p2', cert_type: 'gas_safety', cert_name: 'Gas Safety (CP12)' })
    expect(created[0].expiry_date > created[0].issue_date).toBe(true)
  })
})
