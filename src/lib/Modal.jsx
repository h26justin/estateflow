// Canonical modal shell — the one way to open a dialog.
//
// Wraps the app's existing `.overlay` / `.modal` CSS (App.jsx global styles:
// backdrop blur, mobile bottom-sheet behaviour, 90vh scroll) and bakes in
// everything each hand-rolled modal had to remember on its own:
//   - FocusTrap (focus-in on mount, Tab cycling, Escape, focus restore)
//   - role="dialog" aria-modal + labelling
//   - dirty-guard on backdrop click / Escape via the themed confirm
//   - a size preset instead of 14 ad-hoc maxWidth values
//
// Usage:
//   const confirmDiscard = useConfirm()   // optional, for dirty forms
//   <Modal onClose={onClose} size="lg" labelledBy="my-title"
//          isDirty={isDirty} confirmFn={confirmDiscard}>
//     <div style={{padding:'22px 26px'}}>
//       <h2 id="my-title">…</h2>
//       …
//     </div>
//   </Modal>
//
// Sizes: sm 420 · md 600 (the .modal default) · lg 720 · xl 920.

import FocusTrap from './FocusTrap'
import { safeOverlayClose } from './modalUtils'

const SIZES = { sm: 420, md: 600, lg: 720, xl: 920 }

export default function Modal({
  onClose,
  size = 'md',
  labelledBy,          // id of the heading inside (preferred)
  ariaLabel,           // fallback when there is no visible heading
  isDirty = false,     // guard backdrop/Escape close behind a confirm
  confirmFn,           // themed confirm from useConfirm() (falls back to window.confirm)
  initialFocusRef,
  style,               // merged onto the .modal element (escape hatch)
  children,
}) {
  const guardedClose = safeOverlayClose(isDirty, onClose, confirmFn)
  return (
    <div className="overlay" onClick={guardedClose}>
      <FocusTrap onEscape={() => guardedClose({ target: null, currentTarget: null })} initialFocusRef={initialFocusRef}>
        <div className="modal" role="dialog" aria-modal="true"
          aria-labelledby={labelledBy} aria-label={ariaLabel}
          style={{ maxWidth: SIZES[size] || SIZES.md, ...style }}>
          {children}
        </div>
      </FocusTrap>
    </div>
  )
}
