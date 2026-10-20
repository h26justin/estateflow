// <Button> — the one button. Visuals live in src/styles/app.css (.ui-btn*),
// driven by the theme CSS variables, so it needs no `T` prop. The legacy
// .btn / .btn-gold / .btn-ghost / .btn-danger classes and the btnGold /
// btnGhost / btnDanger factories in lib/styles are aliased to the same rules,
// so un-migrated markup looks identical.
//
//   <Button onClick={save}>Save</Button>                       primary (gold), md
//   <Button variant="secondary" size="sm">Cancel</Button>      outline
//   <Button variant="ghost" icon="plus">Add row</Button>       text-style
//   <Button variant="danger" loading={deleting}>Delete</Button>
//   <Button variant="secondary" size="sm" destructive>Delete</Button>  red outline
//   <Button variant="ghost" icon="x" aria-label="Close" />     icon-only
//   <Button type="submit">Save</Button>                        form submit
//
// Props
//   variant   'primary' | 'secondary' | 'ghost' | 'danger'   (default 'primary')
//             'text' is accepted as an alias of 'ghost'.
//   size      'sm' | 'md' | 'lg'   (default 'md'; md is 40px, 44px on touch)
//   loading   bool — shows a spinner, sets aria-busy and disables the button
//   icon      Icon name from src/lib/icons.jsx, rendered before the label
//   iconOnly  bool — square button whose child is a glyph; implied when `icon`
//             is set and there are no children. Needs an aria-label.
//   destructive bool — red text/border on secondary or ghost: the quiet
//             destructive action in a row ("Delete", "Remove"). Use
//             variant="danger" for the confirming action in a dialog.
//   fullWidth bool
//   type      defaults to 'button' (not 'submit') so it never submits a form by
//             accident — pass type="submit" for a form's submit button.
//   ...rest   forwarded to <button> (onClick, disabled, aria-*, ref, className, style …)
import { Icon } from '../../lib/icons'

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger']
export const BUTTON_SIZES = ['sm', 'md', 'lg']
const VARIANT_ALIASES = { text: 'ghost', gold: 'primary', outline: 'secondary' }
const ICON_SIZE = { sm: 14, md: 16, lg: 18 }

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconOnly,
  destructive = false,
  fullWidth = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}) {
  const aliased = VARIANT_ALIASES[variant] || variant
  const v = BUTTON_VARIANTS.includes(aliased) ? aliased : 'primary'
  const s = BUTTON_SIZES.includes(size) ? size : 'md'
  const square = iconOnly ?? (icon != null && children == null)
  if (square && import.meta.env?.DEV && !rest['aria-label'] && !rest['aria-labelledby']) {
    // eslint-disable-next-line no-console
    console.warn('[Button] icon-only buttons need an aria-label')
  }
  const cls = ['ui-btn', `ui-btn--${v}`, `ui-btn--${s}`, square && 'ui-btn--icon', destructive && v !== 'danger' && 'ui-btn--destructive', fullWidth && 'ui-btn--full', loading && 'is-loading', className]
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
      {children != null && (square ? children : <span className="ui-btn__label">{children}</span>)}
    </button>
  )
}
