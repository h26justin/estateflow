import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const pending = {}
vi.mock('../api', () => ({
  getDocumentSignedUrl: vi.fn(path => new Promise((resolve, reject) => { pending[path] = { resolve, reject } })),
}))

import { SignedPhoto } from '../SignedPhoto'

describe('SignedPhoto', () => {
  beforeEach(() => { for (const k of Object.keys(pending)) delete pending[k] })

  it('clears the old URL when path changes and ignores the stale response', async () => {
    const { rerender, container } = render(<SignedPhoto path="a.jpg" alt="p" wrapAnchor={false} />)
    await act(async () => { pending['a.jpg'].resolve('https://signed/a') })
    expect(screen.getByAltText('p').getAttribute('src')).toBe('https://signed/a')

    rerender(<SignedPhoto path="b.jpg" alt="p" wrapAnchor={false} />)
    // No stale image for the previous path while b resolves.
    expect(container.querySelector('img')).toBeNull()

    await act(async () => { pending['b.jpg'].resolve('https://signed/b') })
    expect(screen.getByAltText('p').getAttribute('src')).toBe('https://signed/b')
  })

  it('a late response for a previous path does not replace the current photo', async () => {
    const { rerender } = render(<SignedPhoto path="a.jpg" alt="p" wrapAnchor={false} />)
    rerender(<SignedPhoto path="b.jpg" alt="p" wrapAnchor={false} />)
    await act(async () => { pending['b.jpg'].resolve('https://signed/b') })
    await act(async () => { pending['a.jpg'].resolve('https://signed/a') })
    expect(screen.getByAltText('p').getAttribute('src')).toBe('https://signed/b')
  })
})
