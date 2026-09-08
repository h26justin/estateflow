import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider } from '../ThemeContext'
import { ConfirmProvider, useConfirm } from '../ConfirmContext'
import { Z } from '../styles'

function Trigger() {
  const confirm = useConfirm()
  return <button onClick={() => confirm({ title: 'Impersonate demo?', confirmLabel: 'Impersonate' })}>open</button>
}

describe('ConfirmContext dialog layering', () => {
  it('renders above the Platform Admin overlay and the modals it opens', async () => {
    render(<ThemeProvider><ConfirmProvider><Trigger/></ConfirmProvider></ThemeProvider>)
    await act(async () => { fireEvent.click(screen.getByText('open')) })
    const dialog = screen.getByRole('dialog')
    const overlay = dialog.closest('.overlay')
    const z = Number(overlay.style.zIndex)
    // The shared .overlay class is z-index 200. AdminDashboard sits at 300 and
    // opens its own modals at 600-800; the confirm raised from inside them
    // (Impersonate, Delete user) was rendered underneath and unreachable.
    expect(z).toBe(Z.confirm)
    expect(z).toBeGreaterThan(800)
    expect(z).toBeLessThan(Z.toast)
    expect(screen.getByRole('button', { name: 'Impersonate' })).toBeTruthy()
  })
})
