import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrollRestoreOnClear } from '../useScrollRestoreOnClear'

// jsdom has no layout, so drive scrollY and the animation frames by hand.
function setScrollY(y) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  window.dispatchEvent(new Event('scroll'))
}

describe('useScrollRestoreOnClear', () => {
  let frames, scrollTo
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', cb => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    scrollTo = vi.fn()
    window.scrollTo = scrollTo
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const flush = () => { while (frames.length) frames.shift()() }

  it('returns to the position held before the search once it is cleared', () => {
    const { rerender } = renderHook(({ narrowing }) => useScrollRestoreOnClear(narrowing), { initialProps: { narrowing: false } })
    setScrollY(1480)                 // working through a company two thirds of the way down
    rerender({ narrowing: true })    // search typed: browser will clamp the short page to the top
    setScrollY(0)                    // (scrolls while narrowing are ignored)
    rerender({ narrowing: false })   // search cleared
    flush()
    expect(scrollTo).toHaveBeenCalledWith({ top: 1480 })
  })
  it('does nothing when the list was never narrowed, and restores each search separately', () => {
    const { rerender } = renderHook(({ narrowing }) => useScrollRestoreOnClear(narrowing), { initialProps: { narrowing: false } })
    setScrollY(300)
    rerender({ narrowing: false })
    flush()
    expect(scrollTo).not.toHaveBeenCalled()
    rerender({ narrowing: true }); rerender({ narrowing: false }); flush()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300 })
    setScrollY(900)
    rerender({ narrowing: true }); rerender({ narrowing: false }); flush()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 900 })
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })
})
