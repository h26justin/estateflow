import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from '..'

describe('Field', () => {
  it('links the label to the control with a generated id', () => {
    render(<Field label="Monthly rent"><input /></Field>)
    const input = screen.getByLabelText('Monthly rent')
    expect(input.tagName).toBe('INPUT')
    expect(input.id).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('describes the control by its hint and error, and marks it invalid', () => {
    render(<Field label="Postcode" hint="UK format" error="Enter a valid postcode"><input /></Field>)
    const input = screen.getByLabelText('Postcode')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('UK format Enter a valid postcode')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid postcode')
  })

  it('keeps an existing id and aria-describedby on the child', () => {
    render(<>
      <p id="extra">Extra</p>
      <Field label="Name" hint="As on the lease"><input id="tenant-name" aria-describedby="extra" /></Field>
    </>)
    const input = screen.getByLabelText('Name')
    expect(input.id).toBe('tenant-name')
    expect(input.getAttribute('aria-describedby')).toBe('extra tenant-name-hint')
  })

  it('works with select / textarea and passes required', () => {
    render(<Field label="Type" required><select><option>HMO</option></select></Field>)
    expect(screen.getByLabelText(/Type/)).toBeRequired()
  })

  it('supports a render prop', () => {
    render(<Field label="Notes" error="Too long">{(a) => <textarea {...a} />}</Field>)
    const ta = screen.getByLabelText('Notes')
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveAttribute('aria-invalid', 'true')
    expect(ta).toHaveAccessibleDescription('Too long')
  })

  it('gives each field a unique id', () => {
    render(<><Field label="A"><input /></Field><Field label="B"><input /></Field></>)
    expect(screen.getByLabelText('A').id).not.toBe(screen.getByLabelText('B').id)
  })
})
