import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorState } from '..'

describe('ErrorState', () => {
  it('announces the failure with a heading, message and Retry', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="Couldn't load rent" message="Check your connection." onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('ui-empty', 'ui-error')
    expect(screen.getByRole('heading', { level: 3, name: "Couldn't load rent" })).toBeInTheDocument()
    expect(screen.getByText('Check your connection.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('has a default title and no Retry without onRetry', () => {
    render(<ErrorState />)
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the retry button as busy while retrying', () => {
    render(<ErrorState onRetry={() => {}} retrying retryLabel="Reload" />)
    expect(screen.getByRole('button', { name: /Reload/ })).toHaveAttribute('aria-busy', 'true')
  })
})
