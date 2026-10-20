import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../../lib/ThemeContext'
import { PropertyGrid } from '../app/PropertyGrid'
import ActionMenu from '../ActionMenu'
import EpcBadge from '../EpcBadge'
import { fmt } from '../../lib/format'
import { calcGrossYield } from '../../lib/propertyCalcs'

const CO = { id: 'c1', name: 'Carter Lettings Ltd', abbr: 'CLL', color: '#2f6f4f' }
const base = { company: CO, company_id: CO.id, prop_type: 'Terraced house', compliance_items: [] }

function wrap(ui) { return render(<ThemeProvider>{ui}</ThemeProvider>) }

describe('PropertyGrid — yield display', () => {
  it('shows the yield for a let property and a muted dash for one with no rent', () => {
    wrap(<PropertyGrid fmt={fmt} openDetail={() => {}} calcGrossYield={calcGrossYield} yieldBasis="cost" filtered={[
      { ...base, id: 'p1', name: '14 Albert Road', status: 'rented', rent_pcm: 1000, purchase_price: 120000, refurb_cost: 0 },
      { ...base, id: 'p2', name: '2 Mill Cottages', status: 'refurb', rent_pcm: 0, purchase_price: 189000, refurb_cost: 38000 },
    ]}/>)
    const cards = screen.getAllByRole('button')
    expect(within(cards[0]).getByText('10.0%')).toBeInTheDocument()
    expect(within(cards[1]).queryByText(/0\.0%/)).not.toBeInTheDocument()
    expect(within(cards[1]).getByTitle(/No yield/)).toHaveTextContent('—')
  })
})

describe('ActionMenu — overflow menu', () => {
  it('opens a menu, closes on Escape and returns focus to the trigger', () => {
    const onDelete = vi.fn()
    wrap(<ActionMenu buttonLabel="More actions for Deal" items={[{ label: 'Delete', onSelect: onDelete, destructive: true }]}/>)
    const trigger = screen.getByRole('button', { name: 'More actions for Deal' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('closes on an outside click and runs the chosen item', () => {
    const onCopy = vi.fn()
    wrap(<div><span>outside</span><ActionMenu items={[{ label: 'Copy deal', onSelect: onCopy }]}/></div>)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy deal' }))
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('EpcBadge — MEES wording', () => {
  it('says "C needed by 2030" for a band-D property instead of a day count', () => {
    wrap(<EpcBadgeWithTheme property={{ epc_rating: 'D', status: 'rented' }}/>)
    expect(screen.getByText(/C needed by 2030|below band C/)).toBeInTheDocument()
    expect(screen.queryByText(/\d+d to C/)).not.toBeInTheDocument()
  })
})

// EpcBadge takes T as a prop (it's shared by surfaces that already have it).
function EpcBadgeWithTheme(props) { const { T } = useTheme(); return <EpcBadge T={T} {...props}/> }
