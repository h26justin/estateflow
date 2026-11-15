// <Switch> — an on/off toggle with the look of the app's hand-rolled knobs
// (44×24 track, 18px white knob) and the semantics they often lacked: a
// real <button role="switch"> with aria-checked, keyboard operable, and an
// accessible name.
//
//   <Switch checked={enabled} onChange={setEnabled} label="Show rent tab" />
//   <Switch checked={on} onChange={toggle} aria-labelledby="row-title" />
//
// Props
//   checked    bool (required)
//   onChange   (next: bool, event) => void
//   label      string — the accessible name (aria-label); omit only when you
//              pass aria-labelledby or wrap it in a <label>
//   disabled   bool
//   ...rest    forwarded to the <button> (id, className, style, aria-*, ref)
export default function Switch({ checked, onChange, label, disabled = false, className, ...rest }) {
  const on = !!checked
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={['ui-switch', on && 'is-on', className].filter(Boolean).join(' ')}
      onClick={(e) => onChange?.(!on, e)}
      {...rest}>
      <span className="ui-switch__knob" aria-hidden="true" />
    </button>
  )
}
