// <Modal> — the one dialog shell. Every overlay dialog in the app renders
// through this (src/lib/Modal.jsx re-exports it for older imports).
//
// Visuals live in src/styles/app.css (.overlay / .modal / .ui-modal*): paper
// surface, 16px radius (R.lg), one scrim token (--scrim), modal shadow, and a
// full-width bottom sheet on phones. Colours are theme CSS variables, so dark
// mode needs nothing here.
//
// Behaviour baked in:
//   - role="dialog" aria-modal, labelled by the title (or labelledBy/ariaLabel)
//     and described by the description
//   - focus moves inside on open, Tab cycles inside, focus returns on close
//   - Escape and backdrop click close (opt out with closeOnEscape /
//     closeOnBackdrop = false); nested dialogs: only the top one reacts
//   - optional dirty-guard: isDirty + confirmFn asks before discarding
//   - body scroll lock while any modal is open
//
// Structured (preferred):
//   <Modal onClose={close} title="Add property" description="…" size="md"
//          footer={<><Button variant="secondary" onClick={close}>Cancel</Button>
//                    <Button type="submit" form="prop-form">Save</Button></>}>
//     <form id="prop-form" onSubmit={save}>…</form>
//   </Modal>
//   Footer actions sit right-aligned; put the primary action last.
//
// Bare (custom layout): omit `title` and the children fill the shell as-is;
// pass labelledBy (id of your heading) or ariaLabel.
//
// Sizes: sm 420 · md 600 · lg 720 · xl 920.
import { Children, useEffect, useId, useRef } from 'react'
import FocusTrap from '../../lib/FocusTrap'
import { safeOverlayClose } from '../../lib/modalUtils'
import Button from './Button'

export const MODAL_SIZES = { sm: 420, md: 600, lg: 720, xl: 920 }

// Body scroll lock shared by every open modal (nested modals keep it held).
let lockCount = 0
let savedBody = null
function lockScroll() {
  if (typeof document === 'undefined') return
  if (lockCount++ > 0) return
  const { body, documentElement } = document
  const gap = window.innerWidth - documentElement.clientWidth
  savedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
  body.style.overflow = 'hidden'
  if (gap > 0) body.style.paddingRight = `${gap}px`
}
function unlockScroll() {
  if (typeof document === 'undefined' || lockCount === 0) return
  if (--lockCount > 0) return
  const { body } = document
  body.style.overflow = savedBody?.overflow || ''
  body.style.paddingRight = savedBody?.paddingRight || ''
  savedBody = null
}

export default function Modal({
  open = true,
  onClose,
  title,               // visible heading; turns on the structured layout
  description,         // optional sub-heading under the title
  footer,              // action buttons, right-aligned (primary last)
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideClose = false,   // structured layout only: drop the header's × button
  labelledBy,          // bare layout: id of the heading inside
  ariaLabel,           // fallback when there is no visible heading
  describedBy,
  isDirty = false,     // guard backdrop / Escape / × behind a confirm
  confirmFn,           // themed confirm from useConfirm() (falls back to window.confirm)
  initialFocusRef,
  zIndex,              // only for dialogs opened above another fixed layer
  className,
  style,               // merged onto the .modal element (escape hatch)
  bodyStyle,           // structured layout: merged onto the body
  children,
}) {
  const autoId = useId()
  const pressedOnScrim = useRef(false)
  const titleId = `${autoId}-title`
  const descId = `${autoId}-desc`
  const structured = title != null
  const hasBody = Children.toArray(children).length > 0

  useEffect(() => {
    if (!open) return
    lockScroll()
    return unlockScroll
  }, [open])

  if (!open) return null

  const close = () => onClose?.()
  const guarded = safeOverlayClose(isDirty, close, confirmFn)
  // safeOverlayClose only acts when target === currentTarget; pass a synthetic
  // pair for keyboard / button closes.
  const requestClose = () => guarded({ target: null, currentTarget: null })

  // Backdrop close needs the press AND the click on this modal's own scrim:
  // the .overlay node, or the transparent FocusTrap layout box that is its
  // first child (it spans the overlay's width beside the dialog). Checking
  // these exact nodes, not an attribute, means
  //   - a drag that starts in a field and ends beside the dialog (selecting
  //     text) doesn't close it: the press landed on the field;
  //   - a nested inline modal's backdrop click, bubbling up through this
  //     overlay, doesn't close this one: its target is the nested scrim;
  //   - clicks inside the dialog or in a portal it opened are ignored.
  const isOwnScrim = e => e.target === e.currentTarget || e.target === e.currentTarget.firstElementChild
  function onBackdropMouseDown(e) {
    pressedOnScrim.current = isOwnScrim(e)
  }
  function onBackdropClick(e) {
    const pressed = pressedOnScrim.current
    pressedOnScrim.current = false
    if (!isOwnScrim(e)) return
    // Handled here: don't let it reach an outer modal's overlay.
    e.stopPropagation()
    if (!closeOnBackdrop || !pressed) return
    requestClose()
  }

  const labelled = structured ? titleId : labelledBy
  const described = describedBy || (structured && description != null ? descId : undefined)
  const maxWidth = typeof size === 'number' ? size : (MODAL_SIZES[size] || MODAL_SIZES.md)

  return (
    <div className="overlay ui-modal-overlay" style={zIndex != null ? { zIndex } : undefined} onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <FocusTrap onEscape={closeOnEscape ? requestClose : undefined} initialFocusRef={initialFocusRef}>
        <div
          className={['modal', 'ui-modal', structured && 'ui-modal--structured', className].filter(Boolean).join(' ')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelled}
          aria-label={labelled ? undefined : ariaLabel}
          aria-describedby={described}
          style={{ maxWidth, ...style }}
        >
          {structured ? (
            <>
              <div className={hasBody ? 'ui-modal__header' : 'ui-modal__header ui-modal__header--only'}>
                <div className="ui-modal__heading">
                  <h2 id={titleId} className="ui-modal__title">{title}</h2>
                  {description != null && <p id={descId} className="ui-modal__desc">{description}</p>}
                </div>
                {!hideClose && (
                  <Button variant="ghost" size="sm" icon="x" aria-label="Close" className="ui-modal__close" onClick={requestClose} />
                )}
              </div>
              {hasBody && <div className="ui-modal__body" style={bodyStyle}>{children}</div>}
              {footer != null && <div className="ui-modal__footer">{footer}</div>}
            </>
          ) : children}
        </div>
      </FocusTrap>
    </div>
  )
}
