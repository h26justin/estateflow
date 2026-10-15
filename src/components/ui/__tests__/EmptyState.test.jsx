import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState, Button, Card } from '..'

describe('EmptyState', () => {
  it('renders title as a heading, body, icon and action', () => {
    const { container } = render(
      <EmptyState icon="inbox" title="No receipts yet" body="Upload one to get started."
        action={<Button>Upload</Button>} />
    )
    expect(screen.getByRole('heading', { level: 3, name: 'No receipts yet' })).toBeInTheDocument()
    expect(screen.getByText('Upload one to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('omits optional parts and honours headingLevel', () => {
    const { container } = render(<EmptyState title="Nothing here" headingLevel={2} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nothing here')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.ui-empty__action')).toBeNull()
  })
})

describe('Card', () => {
  it('renders the card classes and forwards props', () => {
    render(<Card as="section" padding="sm" interactive aria-label="Summary">x</Card>)
    const el = screen.getByRole('region', { name: 'Summary' })
    expect(el.tagName).toBe('SECTION')
    expect(el).toHaveClass('card', 'ui-card--pad-sm', 'pcard')
  })
})
