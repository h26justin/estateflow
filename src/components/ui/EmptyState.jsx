// <EmptyState> — the "nothing here yet" panel.
//
//   <EmptyState icon="inbox" title="No receipts yet"
//     body="Snap a receipt or forward one to your inbox address."
//     action={<Button icon="upload" onClick={openUpload}>Upload receipt</Button>} />
//
// Props
//   icon     Icon name from src/lib/icons.jsx (optional)
//   title    node (required) — rendered as a heading of level `headingLevel` (default 3)
//   body     node — explanatory text (children are appended after it)
//   action   node — usually a <Button>
//   compact  bool — tighter padding for use inside cards/tables
import { Icon } from '../../lib/icons'

export default function EmptyState({ icon, title, body, action, compact = false, headingLevel = 3, className, style, children }) {
  const H = `h${Math.min(6, Math.max(2, headingLevel))}`
  return (
    <div className={['ui-empty', compact && 'ui-empty--compact', className].filter(Boolean).join(' ')} style={style}>
      {icon && <span className="ui-empty__icon"><Icon name={icon} size={compact ? 20 : 24} /></span>}
      <H className="ui-empty__title">{title}</H>
      {body && <p className="ui-empty__body">{body}</p>}
      {children}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  )
}
