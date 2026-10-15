import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, escapeSvgText } from '../icons'

describe('Icon title', () => {
  it('escapes markup in the title instead of injecting it', () => {
    const evil = '</title><image href="x" onerror="alert(1)"/><title>'
    const { container } = render(<Icon name="home" title={evil} />)
    const svg = container.querySelector('svg')
    expect(svg.querySelector('image')).toBeNull()
    expect(svg.querySelector('title').textContent).toBe(evil)
  })

  it('escapeSvgText covers the HTML specials', () => {
    expect(escapeSvgText(`<a & "b" 'c'>`)).toBe('&lt;a &amp; &quot;b&quot; &#39;c&#39;&gt;')
  })
})
