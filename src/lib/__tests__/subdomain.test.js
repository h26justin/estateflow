import { describe, it, expect, afterEach, vi } from 'vitest'
import { getSubdomain } from '../subdomain'

// getSubdomain reads window.location.hostname. Stub it per-case.
function setHost(hostname) {
  vi.stubGlobal('window', { location: { hostname } })
}

describe('getSubdomain', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the company subdomain on <sub>.ownproperly.com', () => {
    setHost('vale.ownproperly.com')
    expect(getSubdomain()).toBe('vale')
  })

  it('lowercases the subdomain', () => {
    setHost('VALE.ownproperly.com')
    expect(getSubdomain()).toBe('vale')
  })

  it('returns null for the bare apex and www', () => {
    setHost('ownproperly.com')
    expect(getSubdomain()).toBeNull()
    setHost('www.ownproperly.com')
    expect(getSubdomain()).toBeNull()
  })

  it('returns null for reserved infra hosts', () => {
    for (const h of ['app', 'inbox', 'status', 'api', 'admin', 'staging']) {
      setHost(`${h}.ownproperly.com`)
      expect(getSubdomain()).toBeNull()
    }
  })

  it('returns null for Vercel preview builds', () => {
    setHost('ownproperly-git-feat-x.vercel.app')
    expect(getSubdomain()).toBeNull()
  })

  it('returns null for localhost', () => {
    setHost('localhost')
    expect(getSubdomain()).toBeNull()
  })
})
