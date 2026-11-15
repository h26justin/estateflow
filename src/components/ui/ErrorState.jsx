// <ErrorState> — "this failed to load" panel, the error twin of
// <EmptyState> (same layout and spacing), with an optional Retry button.
//
//   <ErrorState title="Couldn't load rent"
//     message="Check your connection and try again." onRetry={reload} />
//
// Props
//   title       node — heading (default "Something went wrong"), level
//               `headingLevel` (default 3)
//   message     node — what happened / what to do
//   onRetry     () => void — shows a Retry button when set
//   retryLabel  string (default "Try again")
//   retrying    bool — puts the Retry button in its loading state
//   icon        Icon name (default 'alert-circle'); pass null for none
//   compact     bool — tighter padding for use inside cards/tables
// The panel is role="alert" so a screen reader announces the failure when
// it replaces the loading state.
import { Icon } from '../../lib/icons'
import Button from './Button'

export default function ErrorState({
  title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', retrying = false,
  icon = 'alert-circle', compact = false, headingLevel = 3, className, style, children,
}) {
  const H = `h${Math.min(6, Math.max(2, headingLevel))}`
  return (
    <div role="alert" className={['ui-empty', 'ui-error', compact && 'ui-empty--compact', className].filter(Boolean).join(' ')} style={style}>
      {icon && <span className="ui-empty__icon"><Icon name={icon} size={compact ? 20 : 24} /></span>}
      <H className="ui-empty__title">{title}</H>
      {message && <p className="ui-empty__body">{message}</p>}
      {children}
      {onRetry && (
        <div className="ui-empty__action">
          <Button variant="secondary" size="sm" icon="refresh" loading={retrying} onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  )
}
