import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Modal, Button } from '..'

// FocusTrap moves focus on the next tick.
const tick = () => act(() => new Promise(r => setTimeout(r, 0)))
// A real click: press and release on the same node.
const clickOn = el => { fireEvent.mouseDown(el); fireEvent.click(el) }

afterEach(() => { cleanup(); document.body.style.overflow = '' })

function Harness({ modalProps = {}, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal onClose={() => setOpen(false)} title="Edit tenant" description="Changes save to the tenancy."
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button>Save</Button></>}
          {...modalProps}>
          {children ?? <input aria-label="Name" />}
        </Modal>
      )}
    </>
  )
}

describe('Modal', () => {
  it('is a labelled, described, modal dialog', () => {
    render(<Modal onClose={() => {}} title="Add property" description="Address and purchase details.">body</Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Add property' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Address and purchase details.')
    expect(screen.getByRole('heading', { name: 'Add property' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('bare layout takes ariaLabel / labelledBy', () => {
    const { rerender } = render(<Modal onClose={() => {}} ariaLabel="Photo viewer"><img alt="" /></Modal>)
    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeTruthy()
    rerender(<Modal onClose={() => {}} labelledBy="h"><h2 id="h">Compare deals</h2></Modal>)
    expect(screen.getByRole('dialog', { name: 'Compare deals' })).toBeTruthy()
  })

  it('applies size presets and renders nothing when open is false', () => {
    const { rerender } = render(<Modal onClose={() => {}} title="t" size="sm">x</Modal>)
    expect(screen.getByRole('dialog').style.maxWidth).toBe('420px')
    rerender(<Modal onClose={() => {}} title="t" size="lg">x</Modal>)
    expect(screen.getByRole('dialog').style.maxWidth).toBe('720px')
    rerender(<Modal open={false} onClose={() => {}} title="t">x</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus inside, traps Tab, and restores focus on close', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    await tick()
    const close = screen.getByRole('button', { name: 'Close' })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(document.activeElement).toBe(close)
    // Shift+Tab from the first element wraps to the last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)
    // Tab from the last element wraps to the first
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape, backdrop click and the × button', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} title="t">x</Modal>)
    await tick()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    clickOn(screen.getByRole('dialog').closest('.overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    // A click inside the dialog never closes it
    fireEvent.click(screen.getByText('x'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('closes for a press + click beside the dialog (the layout box around it)', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} title="t">x</Modal>)
    await tick()
    clickOn(screen.getByRole('dialog').parentElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a text-selection drag ends beside the dialog', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} title="t"><input aria-label="Name" /></Modal>)
    await tick()
    const overlay = screen.getByRole('dialog').closest('.overlay')
    // Press in the field, release beside the dialog: the browser fires the
    // click on the common ancestor (the layout box or the overlay).
    fireEvent.mouseDown(screen.getByLabelText('Name'))
    fireEvent.click(screen.getByRole('dialog').parentElement)
    fireEvent.mouseDown(screen.getByLabelText('Name'))
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
    // A click with no press on the scrim (synthetic / keyboard) doesn't either
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a nested inline modal's backdrop click closes only the nested one", async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <Modal onClose={outer} title="Outer">
        <Modal onClose={inner} title="Inner">i</Modal>
      </Modal>
    )
    await tick()
    const innerDialog = screen.getByRole('dialog', { name: 'Inner' })
    clickOn(innerDialog.closest('.overlay'))
    clickOn(innerDialog.parentElement)
    expect(inner).toHaveBeenCalledTimes(2)
    expect(outer).not.toHaveBeenCalled()
  })

  it('can opt out of Escape and backdrop close', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} title="t" closeOnEscape={false} closeOnBackdrop={false}>x</Modal>)
    await tick()
    fireEvent.keyDown(document, { key: 'Escape' })
    clickOn(screen.getByRole('dialog').closest('.overlay'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('only the top-most nested modal reacts to Escape', async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <Modal onClose={outer} title="Outer">o</Modal>
        <Modal onClose={inner} title="Inner">i</Modal>
      </>
    )
    await tick()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('asks before discarding a dirty form', async () => {
    const onClose = vi.fn()
    const confirmFn = vi.fn().mockResolvedValue(false)
    render(<Modal onClose={onClose} title="t" isDirty confirmFn={confirmFn}>x</Modal>)
    await tick()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    confirmFn.mockResolvedValue(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks body scroll while open (nested-safe)', () => {
    const { rerender, unmount } = render(<Modal onClose={() => {}} title="a">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<><Modal onClose={() => {}} title="a">x</Modal><Modal onClose={() => {}} title="b">y</Modal></>)
    rerender(<Modal onClose={() => {}} title="a">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps form submit buttons working inside the body', () => {
    const onSubmit = vi.fn(e => e.preventDefault())
    render(
      <Modal onClose={() => {}} title="t" footer={<Button type="submit" form="f">Save</Button>}>
        <form id="f" onSubmit={onSubmit}><input aria-label="n" /></form>
      </Modal>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
