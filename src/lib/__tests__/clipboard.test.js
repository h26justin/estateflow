import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyToClipboard } from '../clipboard'

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
  else delete navigator.clipboard
  delete document.execCommand
  vi.restoreAllMocks()
})

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    expect(await copyToClipboard('abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')
  })

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    document.execCommand = vi.fn().mockReturnValue(true)
    expect(await copyToClipboard('abc')).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('resolves false when nothing can copy', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn().mockReturnValue(false)
    expect(await copyToClipboard('abc')).toBe(false)
  })
})
