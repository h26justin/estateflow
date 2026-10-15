import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '..'

describe('Button', () => {
  it('defaults to a primary md type="button"', () => {
    render(<Button>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b).toHaveAttribute('type', 'button')
    expect(b).toHaveClass('ui-btn', 'ui-btn--primary', 'ui-btn--md')
  })

  it('applies variant and size classes, falling back on unknown values', () => {
    const { rerender } = render(<Button variant="danger" size="lg">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('ui-btn--danger', 'ui-btn--lg')
    rerender(<Button variant="nope" size="huge">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('ui-btn--primary', 'ui-btn--md')
  })

  it('forwards props, className and ref', () => {
    const onClick = vi.fn()
    const ref = createRef()
    render(<Button ref={ref} onClick={onClick} className="extra" aria-label="Go" data-x="1" type="submit">→</Button>)
    const b = screen.getByRole('button', { name: 'Go' })
    expect(ref.current).toBe(b)
    expect(b).toHaveClass('extra')
    expect(b).toHaveAttribute('data-x', '1')
    expect(b).toHaveAttribute('type', 'submit')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('loading disables, sets aria-busy and swallows clicks', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Saving</Button>)
    const b = screen.getByRole('button', { name: 'Saving' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b.querySelector('.ui-spin')).not.toBeNull()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders an icon before the label', () => {
    render(<Button icon="plus">Add</Button>)
    expect(screen.getByRole('button').querySelector('svg')).not.toBeNull()
  })
})
