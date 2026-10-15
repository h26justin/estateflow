// <Button> — the shared button. Visuals live in src/styles/app.css (.ui-btn*),
// driven by the theme CSS variables, so it needs no `T` prop and matches the
// legacy .btn / .btn-gold / .btn-ghost / .btn-danger classes.
//
//   <Button onClick={save}>Save</Button>                       primary (gold), md
//   <Button variant="secondary" size="sm">Cancel</Button>
//   <Button variant="danger" loading={deleting}>Delete</Button>
//   <Button variant="ghost" icon="plus">Add row</Button>
//
// Props
//   variant   'primary' | 'secondary' | 'ghost' | 'danger'   (default 'primary')
//   size      'sm' | 'md' | 'lg'   (default 'md'; md/lg have a 44px+ touch target)
//   loading   bool — shows a spinner, sets aria-busy and disables the button
//   icon      Icon name from src/lib/icons.jsx, rendered before the label
//   fullWidth bool
//   type      defaults to 'button' (not 'submit') so it never submits a form by accident
//   ...rest   forwarded to <button> (onClick, disabled, aria-*, ref, className, style …)
import { Icon } from '../../lib/icons'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger']
export const BUTTON_SIZES = ['sm', 'md', 'lg']
const ICON_SIZE = { sm: 14, md: 16, lg: 18 }

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}) {
  const v = BUTTON_VARIANTS.includes(variant) ? variant : 'primary'
  const s = BUTTON_SIZES.includes(size) ? size : 'md'
  const cls = ['ui-btn', `ui-btn--${v}`, `ui-btn--${s}`, fullWidth && 'ui-btn--full', loading && 'is-loading', className]
    .filter(Boolean).join(' ')
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading
        ? <span className="ui-spin" aria-hidden="true" />
        : icon && <Icon name={icon} size={ICON_SIZE[s]} />}
      {children != null && <span className="ui-btn__label">{children}</span>}
    </button>
  )
}
