import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Switch } from '..'

describe('Switch', () => {
  it('is a named switch that reports its state', () => {
    const { rerender } = render(<Switch checked={false} onChange={() => {}} label="Show rent tab" />)
    const sw = screen.getByRole('switch', { name: 'Show rent tab' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAttribute('type', 'button')
    expect(sw).not.toHaveClass('is-on')
    rerender(<Switch checked onChange={() => {}} label="Show rent tab" />)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(sw).toHaveClass('ui-switch', 'is-on')
  })

  it('calls onChange with the next value', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="Alerts" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('does nothing when disabled', () => {
    const onChange = vi.fn()
    render(<Switch checked onChange={onChange} label="Alerts" disabled />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards aria-labelledby and other props', () => {
    render(<><span id="lbl">Weekly digest</span><Switch checked={false} aria-labelledby="lbl" id="digest" /></>)
    const sw = screen.getByRole('switch', { name: 'Weekly digest' })
    expect(sw.id).toBe('digest')
  })
})
