import { describe, it, expect, vi, beforeEach } from 'vitest'

// The reporter must be quiet, deduplicated and bounded. Mock the client so
// no network is touched and we can count inserts.
const inserts = []
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn(() => ({ insert: vi.fn(row => { inserts.push(row); return Promise.resolve({ data: null, error: null }) }) })),
  },
}))

const flush = () => new Promise(r => setTimeout(r, 0))

describe('errorReporter', () => {
  beforeEach(() => { inserts.length = 0; vi.resetModules() })

  it('posts one row per crash with the page and kind, as the signed-in user', async () => {
    const { reportClientError } = await import('../errorReporter')
    location.hash = '#/stl'
    reportClientError({ message: 'boom', stack: 'Error: boom\n at x', kind: 'boundary', component: 'at StlPage' })
    await flush()
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ kind: 'boundary', message: 'boom', page: '#/stl', component: 'at StlPage', user_id: 'u1' })
  })

  it('drops the same message repeated within a minute and caps a session', async () => {
    const { reportClientError } = await import('../errorReporter')
    for (let i = 0; i < 5; i++) reportClientError({ message: 'same' })
    await flush()
    expect(inserts).toHaveLength(1)
    for (let i = 0; i < 40; i++) reportClientError({ message: `distinct ${i}` })
    await flush()
    expect(inserts.length).toBeLessThanOrEqual(12)   // MAX_PER_SESSION
  })

  it('ignores browser-extension and cross-origin noise', async () => {
    const { reportClientError } = await import('../errorReporter')
    reportClientError({ message: 'Script error.' })
    reportClientError({ message: 'ResizeObserver loop completed with undelivered notifications.' })
    reportClientError({ message: 'Uncaught TypeError at chrome-extension://abc/x.js' })
    await flush()
    expect(inserts).toHaveLength(0)
  })

  it('never throws, even when the client is broken', async () => {
    const { reportClientError } = await import('../errorReporter')
    const { supabase } = await import('../supabase')
    supabase.from.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => reportClientError({ message: 'x' })).not.toThrow()
  })
})
