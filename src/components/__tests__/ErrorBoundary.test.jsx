import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/errorReporter', () => ({ reportClientError: vi.fn() }))

import { ErrorBoundary } from '../ErrorBoundary'

function Boom({ crash }) {
  if (crash) throw new Error('kaboom')
  return <div>page ok</div>
}

describe('ErrorBoundary panel variant', () => {
  let errSpy
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errSpy.mockRestore() })

  it('contains a crash to the panel and leaves siblings rendered', () => {
    render(<div>
      <nav>sidebar</nav>
      <ErrorBoundary variant="panel" resetKey="reports"><Boom crash /></ErrorBoundary>
    </div>)
    expect(screen.getByText('sidebar')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/This page hit a problem/)
  })

  it('resets when resetKey changes (navigating to another view)', () => {
    const { rerender } = render(<ErrorBoundary variant="panel" resetKey="reports"><Boom crash /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<ErrorBoundary variant="panel" resetKey="dashboard"><Boom crash={false} /></ErrorBoundary>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('page ok')).toBeTruthy()
  })
})
