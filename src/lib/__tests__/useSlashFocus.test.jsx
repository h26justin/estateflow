import { describe, it, expect, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import useSlashFocus from '../useSlashFocus'
import { Modal } from '../../components/ui'

afterEach(cleanup)

function Search({ enabled = true, children }) {
  const ref = useRef(null)
  useSlashFocus(ref, enabled)
  return (
    <>
      <input ref={ref} aria-label="Search" />
      <textarea aria-label="Notes" />
      <div contentEditable suppressContentEditableWarning aria-label="Rich">x</div>
      {children}
    </>
  )
}

describe('useSlashFocus', () => {
  it('"/" on the page focuses the search', () => {
    render(<Search />)
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(screen.getByLabelText('Search'))
  })

  it('does nothing when disabled or with a modifier held', () => {
    const { rerender } = render(<Search enabled={false} />)
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(document.body)
    rerender(<Search />)
    fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
    expect(document.activeElement).toBe(document.body)
  })

  it('ignores "/" typed in a textarea or contenteditable', () => {
    render(<Search />)
    const notes = screen.getByLabelText('Notes')
    notes.focus()
    fireEvent.keyDown(notes, { key: '/' })
    expect(document.activeElement).toBe(notes)
    const rich = screen.getByLabelText('Rich')
    // jsdom does not implement isContentEditable; emulate the browser.
    Object.defineProperty(rich, 'isContentEditable', { value: true })
    const ev = fireEvent.keyDown(rich, { key: '/' })
    expect(ev).toBe(true) // not preventDefault-ed
  })

  it('never steals focus out of an open modal', () => {
    render(
      <Search>
        <Modal onClose={() => {}} title="Edit"><button>Inside</button></Modal>
      </Search>
    )
    const inside = screen.getByRole('button', { name: 'Inside' })
    inside.focus()
    fireEvent.keyDown(inside, { key: '/' })
    expect(document.activeElement).toBe(inside)
  })

  it('any [aria-modal] dialog on screen blocks it', () => {
    render(
      <>
        <Search />
        <div role="dialog" aria-modal="true">open</div>
      </>
    )
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(document.body)
  })
})
