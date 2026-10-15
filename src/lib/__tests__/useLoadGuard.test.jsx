import { describe, it, expect } from 'vitest'
import { useEffect, useState } from 'react'
import { renderHook, render, screen, act } from '@testing-library/react'
import { useLoadGuard } from '../useLoadGuard'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

describe('useLoadGuard', () => {
  it('only the most recent load is current', () => {
    const { result } = renderHook(() => useLoadGuard())
    const first = result.current()
    expect(first()).toBe(true)
    const second = result.current()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('unmount invalidates loads in flight', () => {
    const { result, unmount } = renderHook(() => useLoadGuard())
    const isCurrent = result.current()
    unmount()
    expect(isCurrent()).toBe(false)
  })

  it('returns a stable function across renders', () => {
    const { result, rerender } = renderHook(() => useLoadGuard())
    const fn = result.current
    rerender()
    expect(result.current).toBe(fn)
  })

  it('drops an out-of-order response after the prop changes', async () => {
    const pending = {}
    const fetchFor = id => { pending[id] = deferred(); return pending[id].promise }
    function Panel({ id }) {
      const beginLoad = useLoadGuard()
      const [data, setData] = useState('loading')
      useEffect(() => {
        (async () => {
          const isCurrent = beginLoad()
          const rows = await fetchFor(id)
          if (isCurrent()) setData(rows)
        })()
      }, [beginLoad, id])
      return <div data-testid="out">{data}</div>
    }
    const { rerender } = render(<Panel id="A" />)
    rerender(<Panel id="B" />)
    await act(async () => { pending.B.resolve('rows for B') })
    expect(screen.getByTestId('out').textContent).toBe('rows for B')
    // A's slow response lands last and must not overwrite B's.
    await act(async () => { pending.A.resolve('rows for A') })
    expect(screen.getByTestId('out').textContent).toBe('rows for B')
  })
})
