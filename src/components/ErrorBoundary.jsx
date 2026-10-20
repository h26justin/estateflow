import { Component } from 'react'
import { reportClientError } from '../lib/errorReporter'
import { CV, FS, MONO, SANS } from '../lib/styles'
import { Icon } from '../lib/icons'

// Used twice: at the root (main.jsx, full-screen fallback) and around the
// signed-in page area in App.jsx with variant="panel" and a resetKey, so a
// crash inside one page leaves the nav / header usable and clears as soon
// as the user moves to another view.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  // A crash on one route must not follow the user to the next. Reset when the
  // hash changes (the app routes on the hash), so Go Back / a sidebar click
  // gets a fresh render instead of the same error card.
  componentDidMount() {
    this._onHash = () => { if (this.state.hasError) this.setState({ hasError: false, error: null, info: null }) }
    window.addEventListener('hashchange', this._onHash)
  }
  componentWillUnmount() {
    window.removeEventListener('hashchange', this._onHash)
  }
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, info: null })
    }
  }

  reset = () => this.setState({ hasError: false, error: null, info: null })

  componentDidCatch(error, info) {
    // Keep console.error so we can see the actual error in Vercel logs
    console.error('[OwnProperly] Uncaught error:', error?.message || error)
    console.error('[OwnProperly] Component stack:', info?.componentStack?.split('\n').slice(0,5).join('\n'))
    // Until 2026-09-07 this was where the trail ended: the user saw the
    // fallback and nobody else ever knew. Now it lands in client_errors and
    // the nightly audit counts it.
    reportClientError({
      message: error?.message || String(error),
      stack: error?.stack,
      kind: 'boundary',
      component: info?.componentStack?.split('\n').map(l => l.trim()).filter(Boolean)[0] || null,
    })
    this.setState({ info })
  }

  goHome = () => {
    // Send the user to the dashboard AND clear the error state so the app
    // re-renders. Plain reload() reloads the same crashed URL — users got
    // stuck and had to retype the domain. Reset hash first, then state.
    window.location.hash = '/'
    this.setState({ hasError: false, error: null, info: null })
  }

  goBack = () => {
    // Pop back one entry, then reset state so the previous (working) view
    // re-mounts. If there's no history, fall back to going home.
    if (window.history.length > 1) {
      window.history.back()
      // Defer state clear so the popstate handler fires first
      setTimeout(() => this.setState({ hasError: false, error: null, info: null }), 50)
    } else {
      this.goHome()
    }
  }

  render() {
    if (this.state.hasError && this.props.variant === 'panel') {
      const msg = this.state.error?.message || String(this.state.error || '')
      const chunk = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)
      const T = this.props.theme || {}
      return (
        <div role="alert" style={{
          maxWidth: 520, margin: '40px auto', background: T.card || CV.card,
          border: `1px solid ${T.border || CV.border}`, borderRadius: 16,
          padding: '28px 24px', textAlign: 'center', fontFamily: SANS,
        }}>
          <h2 style={{ fontFamily: SANS, fontSize: FS.lg, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px', color: T.text || CV.text }}>This page hit a problem</h2>
          <p style={{ fontSize: FS.base, color: T.muted || CV.muted, margin: '0 0 16px', lineHeight: 1.6 }}>
            {chunk
              ? 'Properly was updated while this page was open, so part of it could not load. Refresh to pick up the new version; nothing is lost.'
              : 'The rest of the app still works and your data is safe. Try again, or pick another page from the menu.'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={chunk ? () => window.location.reload() : this.reset}>
              {chunk ? 'Refresh' : 'Try again'}
            </button>
            <button className="btn btn-gold" onClick={this.goHome}>Go to Dashboard</button>
          </div>
        </div>
      )
    }
    if (this.state.hasError) {
      // Root fallback: rendered by main.jsx outside ThemeProvider, so it
      // reads the theme straight from the CSS custom properties that
      // <html data-theme> switches (src/styles/app.css) — correct in light
      // and dark mode without React context.
      const msg = this.state.error?.message || String(this.state.error || '')
      const btn = {
        borderRadius: 10, padding: '12px 24px', fontSize: FS.base, fontWeight: 600,
        cursor: 'pointer', fontFamily: SANS, minHeight: 44,
      }
      return (
        <div style={{
          minHeight: '100vh', background: CV.bg, color: CV.text,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: SANS,
        }}>
          <div role="alert" style={{
            maxWidth: 520, width: '100%',
            background: CV.surface, borderRadius: 16,
            border: `1px solid ${CV.border}`, padding: '36px 32px',
            textAlign: 'center', boxShadow: '0 10px 30px rgba(28,40,48,0.10)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: CV.red }}><Icon name="alert-triangle" size={40} /></div>
            <h2 style={{ fontFamily: SANS, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: CV.text, margin: '0 0 8px' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: FS.base, color: CV.muted, margin: '0 0 20px', lineHeight: 1.6 }}>
              {/Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)
                ? 'Properly was updated while this page was open, so part of it could not load. Refresh to pick up the new version; nothing is lost.'
                : 'An unexpected error occurred. Your data is safe.'}
            </p>
            {msg && (
              <div style={{
                fontSize: FS.sm, color: CV.red,
                background: `color-mix(in srgb, ${CV.red} 9%, ${CV.surface})`,
                border: `1px solid color-mix(in srgb, ${CV.red} 25%, transparent)`, borderRadius: 8,
                padding: '10px 14px', textAlign: 'left',
                marginBottom: 20, fontFamily: MONO,
                wordBreak: 'break-word',
              }}>
                {msg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.goBack}
                style={{ ...btn, background: 'transparent', color: CV.text, border: `1px solid ${CV.border}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="chevron-left" size={16} /> Go back
              </button>
              <button
                onClick={this.goHome}
                style={{ ...btn, background: CV.text, color: CV.surface, border: 'none', padding: '12px 28px' }}>
                Go to Dashboard
              </button>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 14,
                background: 'transparent', color: CV.muted, border: 'none',
                fontSize: FS.sm, cursor: 'pointer', fontFamily: SANS,
                textDecoration: 'underline', textUnderlineOffset: 3, minHeight: 32,
              }}>
              Or try refreshing this page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
