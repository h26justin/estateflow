import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, act } from '@testing-library/react'

vi.mock('../supabase', () => ({ supabase: {} }))

import { ThemeProvider, useTheme, LIGHT, DARK, STORAGE_KEY } from '../ThemeContext'

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

describe('ThemeProvider: system preference + explicit choice', () => {
  let listeners
  let osDark
  const realMatchMedia = window.matchMedia
  beforeEach(() => {
    listeners = new Set()
    osDark = false
    window.matchMedia = (q) => ({
      get matches() { return q.includes('dark') ? osDark : false },
      media: q,
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn),
    })
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })
  afterEach(() => { window.matchMedia = realMatchMedia; localStorage.clear() })

  function mount() {
    const ref = {}
    function Probe() { ref.ctx = useTheme(); return null }
    const utils = render(<ThemeProvider><Probe /></ThemeProvider>)
    return { ref, ...utils }
  }

  it('follows the OS preference live when nothing is saved', () => {
    osDark = true
    const { ref } = mount()
    expect(ref.ctx.darkMode).toBe(true)
    expect(ref.ctx.T).toBe(DARK)
    expect(document.documentElement.dataset.theme).toBe('dark')
    act(() => { osDark = false; listeners.forEach(fn => fn({ matches: false })) })
    expect(ref.ctx.darkMode).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()   // following the OS saves nothing
  })

  it('an explicit toggle overrides the OS and persists', () => {
    osDark = true
    const { ref } = mount()
    act(() => ref.ctx.setDarkMode(false))
    expect(ref.ctx.T).toBe(LIGHT)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    act(() => listeners.forEach(fn => fn({ matches: true })))
    expect(ref.ctx.darkMode).toBe(false)
  })

  it('a saved choice wins over the OS on load', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    const { ref } = mount()
    expect(ref.ctx.darkMode).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { ref } = mount()
    expect(ref.ctx.darkMode).toBe(false)
    act(() => ref.ctx.setDarkMode(true))
    expect(ref.ctx.darkMode).toBe(true)
    spy.mockRestore(); set.mockRestore()
  })
})
