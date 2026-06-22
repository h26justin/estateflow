import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  TRUSTED_DEVICE_KEY,
  getStoredDevice,
  setStoredDevice,
  clearStoredDevice,
  deviceLabel,
} from '../trustedDevice'

describe('deviceLabel', () => {
  it('identifies Chrome on macOS', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'))
      .toBe('Chrome on macOS')
  })

  it('identifies Safari on iOS (no Chrome token)', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iOS')
  })

  it('prefers Edge over Chrome when both tokens present', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0'))
      .toBe('Edge on Windows')
  })

  it('identifies Firefox on Linux', () => {
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'))
      .toBe('Firefox on Linux')
  })

  it('falls back gracefully on an empty UA', () => {
    expect(deviceLabel('')).toBe('Browser on Unknown OS')
  })
})

describe('trusted-device storage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function withMemoryStorage() {
    const store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: k => { store.delete(k) },
    })
    return store
  }

  it('round-trips a stored device', () => {
    withMemoryStorage()
    setStoredDevice({ token: 'abc123', id: 'dev-1' })
    expect(getStoredDevice()).toEqual({ token: 'abc123', id: 'dev-1' })
  })

  it('returns null when nothing is stored', () => {
    withMemoryStorage()
    expect(getStoredDevice()).toBeNull()
  })

  it('returns null for a malformed value (no token)', () => {
    const store = withMemoryStorage()
    store.set(TRUSTED_DEVICE_KEY, '{"id":"dev-1"}')
    expect(getStoredDevice()).toBeNull()
  })

  it('returns null for non-JSON junk', () => {
    const store = withMemoryStorage()
    store.set(TRUSTED_DEVICE_KEY, 'not-json')
    expect(getStoredDevice()).toBeNull()
  })

  it('clears a stored device', () => {
    withMemoryStorage()
    setStoredDevice({ token: 'abc123', id: 'dev-1' })
    clearStoredDevice()
    expect(getStoredDevice()).toBeNull()
  })
})
