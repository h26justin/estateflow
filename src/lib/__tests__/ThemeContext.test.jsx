import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, act } from '@testing-library/react'

vi.mock('../supabase', () => ({ supabase: {} }))

import { ThemeProvider, useTheme } from '../ThemeContext'

describe('ThemeProvider', () => {
  it('keeps the context value stable across unrelated parent re-renders', () => {
    const seen = []
    function Probe() { seen.push(useTheme()); return null }
    let bump
    function Parent() {
      const [n, setN] = useState(0)
      bump = () => setN(n + 1)
      return <ThemeProvider><Probe /><span>{n}</span></ThemeProvider>
    }
    render(<Parent />)
    act(() => bump())
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(new Set(seen).size).toBe(1)
  })

  it('changes the value when dark mode toggles', () => {
    let ctx
    function Probe() { ctx = useTheme(); return null }
    render(<ThemeProvider><Probe /></ThemeProvider>)
    const before = ctx
    act(() => ctx.setDarkMode(!ctx.darkMode))
    expect(ctx).not.toBe(before)
    expect(ctx.T).not.toBe(before.T)
  })
})
