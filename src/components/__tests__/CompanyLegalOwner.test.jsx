import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../lib/api', () => ({ updateCompany: vi.fn() }))
vi.mock('../../lib/ThemeContext', () => ({ useTheme: () => ({ T }) }))

import { LegalOwnerChoice, LEGAL_OWNER_HELP } from '../CompanyLegalOwner'
import { PropertyScopeNote } from '../MtdItsaPage'

const T = { card: '#fff', border: '#ddd', muted: '#777', text: '#111', gold: '#b8860b', goldText: '#7a5e1c', amber: '#d98e04' }

describe('LegalOwnerChoice', () => {
  it('is a labelled radio group with the MTD helper text', () => {
    const onChange = vi.fn()
    render(<LegalOwnerChoice T={T} value={null} onChange={onChange} idPrefix="t"/>)
    expect(screen.getByRole('group', { name: 'Legal owner' })).toHaveAccessibleDescription(LEGAL_OWNER_HELP)
    const personal = screen.getByRole('radio', { name: /Personal.*I\/we own these properties personally/ })
    const ltd = screen.getByRole('radio', { name: /Limited company.*Owned by the company/ })
    expect(personal).not.toBeChecked()
    expect(ltd).not.toBeChecked()
    fireEvent.click(ltd)
    expect(onChange).toHaveBeenCalledWith('limited_company')
  })

  it('shows the current value', () => {
    render(<LegalOwnerChoice T={T} value="personal" onChange={() => {}} idPrefix="t"/>)
    expect(screen.getByRole('radio', { name: /^Personal/ })).toBeChecked()
  })
})

describe('PropertyScopeNote', () => {
  it('renders nothing when legal_owner is not supported or nothing to say', () => {
    const { container, rerender } = render(<PropertyScopeNote T={T} scope={{ legalOwnerSupported: false, excluded: [{ id: 'p1' }] }}/>)
    expect(container).toBeEmptyDOMElement()
    rerender(<PropertyScopeNote T={T} scope={{ legalOwnerSupported: true, excluded: [], excludedCompanies: [], unsetCompanies: [] }}/>)
    expect(container).toBeEmptyDOMElement()
    rerender(<PropertyScopeNote T={T} scope={null}/>)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts excluded properties and prompts for unset companies, linking to the setting', () => {
    render(<PropertyScopeNote T={T} scope={{
      legalOwnerSupported: true,
      excluded: [{ id: 'p1' }, { id: 'p2' }],
      excludedCompanies: [{ id: 'a', name: 'Alpha Ltd', count: 2 }],
      unsetCompanies: [{ id: 'b', name: 'Beta Group', count: 3 }],
    }}/>)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('2 properties left out')
    expect(note).toHaveTextContent('Alpha Ltd')
    expect(note).toHaveTextContent('1 company (Beta Group) doesn’t say who legally owns the properties yet')
    const links = screen.getAllByRole('link', { name: 'Portfolio → Companies → Legal owner' })
    expect(links[0]).toHaveAttribute('href', '#/properties/companies')
  })
})
