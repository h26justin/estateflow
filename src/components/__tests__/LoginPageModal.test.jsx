import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('../../lib/api', () => ({}))

import LoginPage from '../LoginPage'

describe('LoginPage modal', () => {
  it('is a labelled modal dialog that traps focus and closes on Escape', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<LoginPage initialMode="login" onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Welcome back' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await act(async () => { vi.runAllTimers() })
    vi.useRealTimers()
    // Initial focus lands on the first field, not on the Close button.
    expect(document.activeElement).toBe(screen.getByLabelText('Email Address'))

    // Shift+Tab from the first focusable wraps to the last one inside the dialog.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close sign in' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('is not a dialog on the full-page variant', () => {
    render(<LoginPage initialMode="login" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
