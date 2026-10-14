import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { pressable } from '../pressable'

describe('pressable', () => {
  it('returns nothing for a missing handler', () => {
    expect(pressable(undefined)).toEqual({})
  })

  it('makes a div a focusable button that fires on click, Enter and Space', () => {
    const fn = vi.fn()
    render(<div {...pressable(fn)}>Open</div>)
    const el = screen.getByRole('button', { name: 'Open' })
    expect(el).toHaveAttribute('tabindex', '0')
    fireEvent.click(el)
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyDown(el, { key: ' ' })
    fireEvent.keyDown(el, { key: 'a' })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('ignores keys pressed inside a nested control', () => {
    const fn = vi.fn()
    render(<div {...pressable(fn)}>Card <input aria-label="inner"/></div>)
    fireEvent.keyDown(screen.getByLabelText('inner'), { key: ' ' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('accepts a different role with state, or no role', () => {
    const { rerender } = render(<div {...pressable(() => {}, { role: 'switch', 'aria-checked': true })}>Free tier</div>)
    expect(screen.getByRole('switch', { name: 'Free tier' })).toHaveAttribute('aria-checked', 'true')
    rerender(<table><tbody><tr {...pressable(() => {}, { role: null })}><td>Row</td></tr></tbody></table>)
    expect(screen.getByRole('row')).toHaveAttribute('tabindex', '0')
  })
})
