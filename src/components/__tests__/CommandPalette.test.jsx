import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import CommandPalette from '../CommandPalette'

// The palette pulls its theme from useTheme(), so wrap in ThemeProvider.
// We don't need any router or auth context — the palette is intentionally
// dumb about routing (the parent supplies action callbacks).
function renderPalette(props = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    commands: [],
  }
  return render(
    <ThemeProvider>
      <CommandPalette {...defaultProps} {...props}/>
    </ThemeProvider>
  )
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = renderPalette({ open: false })
    expect(container.firstChild).toBeNull()
  })

  it('renders the search input when open', () => {
    renderPalette()
    expect(screen.getByPlaceholderText(/jump to a page/i)).toBeInTheDocument()
  })

  it('shows a friendly empty state when no commands match', () => {
    renderPalette({ commands: [] })
    expect(screen.getByText(/no commands available/i)).toBeInTheDocument()
  })

  it('filters by label substring', () => {
    const commands = [
      { id: 'a', label: 'Go to Dashboard', group: 'navigate', icon: '🏠', action: vi.fn() },
      { id: 'b', label: 'Add Property',    group: 'create',   icon: '🏠', action: vi.fn() },
      { id: 'c', label: 'Open Reports',    group: 'open',     icon: '📊', action: vi.fn() },
    ]
    renderPalette({ commands })
    const input = screen.getByPlaceholderText(/jump to a page/i)
    fireEvent.change(input, { target: { value: 'report' } })
    expect(screen.getByText(/Open Reports/)).toBeInTheDocument()
    expect(screen.queryByText(/Go to Dashboard/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Add Property/)).not.toBeInTheDocument()
  })

  it('fires the command action on Enter and closes', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    renderPalette({
      onClose,
      commands: [{ id: 'a', label: 'Go to Dashboard', group: 'navigate', icon: '🏠', action }],
    })
    const input = screen.getByPlaceholderText(/jump to a page/i)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires the command action on click and closes', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    renderPalette({
      onClose,
      commands: [{ id: 'a', label: 'Add Property', group: 'create', icon: '🏠', action }],
    })
    fireEvent.click(screen.getByText('Add Property'))
    expect(action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderPalette({
      onClose,
      commands: [{ id: 'a', label: 'X', group: 'action', icon: '⚙', action: vi.fn() }],
    })
    const input = screen.getByPlaceholderText(/jump to a page/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('arrow-down then Enter fires the second result', () => {
    const first  = vi.fn()
    const second = vi.fn()
    renderPalette({
      commands: [
        { id: '1', label: 'First',  group: 'navigate', icon: '🏠', action: first },
        { id: '2', label: 'Second', group: 'navigate', icon: '🏘', action: second },
      ],
    })
    const input = screen.getByPlaceholderText(/jump to a page/i)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('groups commands under their section headers', () => {
    renderPalette({
      commands: [
        { id: '1', label: 'Go to Dashboard', group: 'navigate', icon: '🏠', action: vi.fn() },
        { id: '2', label: 'Add Property',    group: 'create',   icon: '🏠', action: vi.fn() },
      ],
    })
    // "Navigate" appears both as the section header AND in the footer
    // keyboard hint ("↑ ↓ navigate"). getAllByText returns both nodes;
    // we just want to confirm the section header exists so >= 1 is fine.
    expect(screen.getAllByText(/^Navigate$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/^Create$/i)).toBeInTheDocument()
  })
})
