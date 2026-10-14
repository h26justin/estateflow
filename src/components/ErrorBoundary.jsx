import { Component } from 'react'
import { reportClientError } from '../lib/errorReporter'

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
          maxWidth: 520, margin: '40px auto', background: T.card || '#fff',
          border: `1px solid ${T.border || '#E2DFD8'}`, borderRadius: 16,
          padding: '28px 24px', textAlign: 'center', fontFamily: 'inherit',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: T.text || '#1A1C26' }}>This page hit a problem</h2>
          <p style={{ fontSize: 13, color: T.muted || '#6B7191', margin: '0 0 16px', lineHeight: 1.6 }}>
            {chunk
              ? 'Properly was updated while this page was open, so part of it could not load. Refresh to pick up the new version; nothing is lost.'
              : 'The rest of the app still works and your data is safe. Try again, or pick another page from the menu.'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={chunk ? () => window.location.reload() : this.reset}>
              {chunk ? 'Refresh' : 'Try again'}
            </button>
            <button className="btn btn-gold" onClick={this.goHome}>Go to Dashboard</button>
          </div>
        </div>
      )
    }
    if (this.state.hasError) {
      const msg = this.state.error?.message || String(this.state.error || '')
      return (
        <div style={{
          minHeight: '100vh', background: '#F4F3EF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: 'Arial, sans-serif',
        }}>
          <div style={{
            maxWidth: 520, width: '100%',
            background: '#fff', borderRadius: 16,
            border: '1px solid #E2DFD8', padding: '36px 32px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1A1C26', marginBottom: 8 }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 13, color: '#6B7191', marginBottom: 20, lineHeight: 1.6 }}>
              {/Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)
                ? 'Properly was updated while this page was open, so part of it could not load. Refresh to pick up the new version; nothing is lost.'
                : 'An unexpected error occurred. Your data is safe.'}
            </p>
            {msg && (
              <div style={{
                fontSize: 12, color: '#CC3333', background: '#FEF2F2',
                border: '1px solid #FECACA', borderRadius: 8,
                padding: '10px 14px', textAlign: 'left',
                marginBottom: 20, fontFamily: 'monospace',
                wordBreak: 'break-word',
              }}>
                {msg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.goBack}
                style={{
                  background: 'white', color: '#2D3C4A', border: '1px solid #E2DFD8',
                  borderRadius: 10, padding: '12px 24px', fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                ← Go Back
              </button>
              <button
                onClick={this.goHome}
                style={{
                  background: '#2D3C4A', color: 'white', border: 'none',
                  borderRadius: 10, padding: '12px 28px', fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                Go to Dashboard
              </button>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 14,
                background: 'transparent', color: '#6B7191', border: 'none',
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                textDecoration: 'underline',
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
