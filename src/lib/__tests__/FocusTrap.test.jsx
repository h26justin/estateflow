import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPortal } from 'react-dom'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import FocusTrap from '../FocusTrap'

const tick = () => act(() => new Promise(r => setTimeout(r, 0)))

afterEach(cleanup)

describe('FocusTrap stacking', () => {
  it('nested traps mounted in the same render: Escape reaches only the inner', async () => {
    // React runs the inner trap's effect before the outer's, so the outer
    // registers last; it must still sit beneath the inner.
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <FocusTrap onEscape={outer}>
        <button>outer</button>
        <FocusTrap onEscape={inner}>
          <button>inner-a</button>
          <button>inner-b</button>
        </FocusTrap>
      </FocusTrap>
    )
    await tick()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('nested traps mounted in the same render: Tab cycles within the inner', async () => {
    render(
      <FocusTrap>
        <button>outer</button>
        <FocusTrap>
          <button>inner-a</button>
          <button>inner-b</button>
        </FocusTrap>
      </FocusTrap>
    )
    await tick()
    const a = screen.getByRole('button', { name: 'inner-a' })
    const b = screen.getByRole('button', { name: 'inner-b' })
    expect(document.activeElement).toBe(a)
    b.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(a)
  })

  it('a nested trap portalled out of the DOM tree still sits on top', async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <FocusTrap onEscape={outer}>
        <button>outer</button>
        {createPortal(<FocusTrap onEscape={inner}><button>inner</button></FocusTrap>, document.body)}
      </FocusTrap>
    )
    await tick()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('the outer trap takes over once the inner closes', async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const tree = showInner => (
      <FocusTrap onEscape={outer}>
        <button>outer</button>
        {showInner && <FocusTrap onEscape={inner}><button>inner</button></FocusTrap>}
      </FocusTrap>
    )
    const { rerender } = render(tree(true))
    await tick()
    rerender(tree(false))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(outer).toHaveBeenCalledTimes(1)
    expect(inner).not.toHaveBeenCalled()
  })
})
