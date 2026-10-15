// <Card> — the standard surface (same look as the .card class / card(T) recipe).
//
//   <Card>…</Card>                        padding md (20px 22px)
//   <Card padding="none" as="section">…</Card>
//   <Card interactive onClick={open}>…</Card>   hover lift, like .pcard
//
// Props
//   as          element/component to render (default 'div')
//   padding     'none' | 'sm' | 'md' | 'lg'   (default 'md')
//   interactive bool — pointer + hover border/lift. If you pass onClick on a
//               non-button element, also give it role/tabIndex/onKeyDown (or
//               use as="button").
//   ...rest     forwarded (className, style, aria-*, ref …)
export default function Card({ as: Tag = 'div', padding = 'md', interactive = false, className, children, ...rest }) {
  const cls = ['card', 'ui-card', `ui-card--pad-${padding}`, interactive && 'pcard', className].filter(Boolean).join(' ')
  return <Tag className={cls} {...rest}>{children}</Tag>
}
