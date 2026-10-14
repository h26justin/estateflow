import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const auth = { session: null, loading: false }
const appLoaded = vi.fn()

vi.mock('../lib/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../lib/ThemeContext', () => ({ useTheme: () => ({ T: { bg: '#fff', border: '#ccc', gold: '#c80' } }) }))
vi.mock('../lib/subdomain', () => ({ getSubdomain: () => null }))
vi.mock('../App', () => {
  appLoaded()
  return { default: ({ initialLoginMode }) => <div>APP mode={String(initialLoginMode)}</div> }
})
vi.mock('../components/MarketingSite', () => ({
  default: ({ onSignIn, onSignUp }) => (
    <div>MARKETING<button onClick={onSignIn}>sign in</button><button onClick={onSignUp}>sign up</button></div>
  ),
}))

import Root, { isPlainMarketingVisit } from '../Root'

describe('isPlainMarketingVisit', () => {
  const loc = (pathname, search = '', hash = '') => ({ pathname, search, hash })
  it('is true only for the bare homepage on the main host', () => {
    expect(isPlainMarketingVisit(loc('/'), null)).toBe(true)
    expect(isPlainMarketingVisit(loc('/', '', '#/'), null)).toBe(true)
    expect(isPlainMarketingVisit(loc('/privacy'), null)).toBe(false)
    expect(isPlainMarketingVisit(loc('/', '?invite=abc'), null)).toBe(false)
    expect(isPlainMarketingVisit(loc('/', '', '#access_token=x&type=recovery'), null)).toBe(false)
    expect(isPlainMarketingVisit(loc('/', '', '#/settings'), null)).toBe(false)
    expect(isPlainMarketingVisit(loc('/'), 'vale')).toBe(false)
  })
})

describe('Root', () => {
  beforeEach(() => { auth.session = null; auth.loading = false; appLoaded.mockClear(); window.history.replaceState({}, '', '/') })

  it('shows the marketing site without loading App for a logged-out visitor', async () => {
    render(<Root />)
    expect(await screen.findByText('MARKETING')).toBeTruthy()
    expect(appLoaded).not.toHaveBeenCalled()
  })

  it('loads App with the login modal mode once the visitor clicks Sign up', async () => {
    render(<Root />)
    fireEvent.click(await screen.findByText('sign up'))
    expect(await screen.findByText('APP mode=signup')).toBeTruthy()
  })

  it('goes straight to App when signed in', async () => {
    auth.session = { user: { id: 'u1' } }
    render(<Root />)
    expect(await screen.findByText('APP mode=null')).toBeTruthy()
  })
})
