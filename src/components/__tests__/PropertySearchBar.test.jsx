import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import PropertySearchBar from '../PropertySearchBar'

const EXH = { id: 'co-exh', name: 'ExH Property Group', abbr: 'ExH', color: '#C8A96A' }

const PROPS = [
  { id: 'p1', name: 'Flat 1, Watts Moses House',  address: 'Flat 1, Watts Moses House, John Street, Sunderland', company: EXH, status: 'rented' },
  { id: 'p4', name: 'Flat 10, Watts Moses House', address: 'Flat 10, Watts Moses House, John Street, Sunderland', company: EXH, status: 'rented' },
  { id: 'p5', name: '13 Lumley Street',           address: '13 Lumley Street, Sunderland', company: EXH, status: 'vacant', tenant_name: 'Carol White' },
]

function renderBar(props = {}) {
  const defaults = { properties: PROPS, onOpen: vi.fn() }
  const utils = render(
    <ThemeProvider>
      <PropertySearchBar {...defaults} {...props}/>
    </ThemeProvider>
  )
  return { ...utils, input: screen.getByLabelText(/search properties/i) }
}

describe('PropertySearchBar', () => {
  it('shows no dropdown until something is typed', () => {
    const { input } = renderBar()
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists matches as you type, closest first', () => {
    const { input } = renderBar()
    fireEvent.change(input, { target: { value: 'watts' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Flat 1, Watts Moses House')
    expect(options[1]).toHaveTextContent('Flat 10, Watts Moses House')
  })

  it('finds a property by tenant name', () => {
    const { input } = renderBar()
    fireEvent.change(input, { target: { value: 'carol' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('13 Lumley Street')
  })

  it('shows an empty state when nothing matches', () => {
    const { input } = renderBar()
    fireEvent.change(input, { target: { value: 'nowhere' } })
    expect(screen.getByText(/no property matches/i)).toBeInTheDocument()
  })

  it('opens the highlighted property on Enter and clears the box', () => {
    const onOpen = vi.fn()
    const { input } = renderBar({ onOpen })
    fireEvent.change(input, { target: { value: 'lumley' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe('p5')
    expect(input.value).toBe('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('arrow keys move the highlight before Enter', () => {
    const onOpen = vi.fn()
    const { input } = renderBar({ onOpen })
    fireEvent.change(input, { target: { value: 'watts' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpen.mock.calls[0][0].id).toBe('p4')
  })

  it('opens a property on click', () => {
    const onOpen = vi.fn()
    const { input } = renderBar({ onOpen })
    fireEvent.change(input, { target: { value: 'watts' } })
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(onOpen.mock.calls[0][0].id).toBe('p4')
  })

  it('Escape clears the query, then closes', () => {
    const { input } = renderBar()
    fireEvent.change(input, { target: { value: 'watts' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('"/" focuses the bar only when slashToFocus is set', () => {
    const { input } = renderBar()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).not.toBe(input)
  })

  it('"/" focuses the bar when slashToFocus is set', () => {
    const { input } = renderBar({ slashToFocus: true })
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
  })
})
