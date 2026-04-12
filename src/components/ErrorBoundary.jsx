import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Keep console.error so we can see the actual error in Vercel logs
    console.error('[OwnProperly] Uncaught error:', error?.message || error)
    console.error('[OwnProperly] Component stack:', info?.componentStack?.split('\n').slice(0,5).join('\n'))
    this.setState({ info })
  }

  render() {
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
              An unexpected error occurred. Your data is safe — please refresh the page to continue.
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
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#2D3C4A', color: 'white', border: 'none',
                borderRadius: 10, padding: '12px 28px', fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              Refresh Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
