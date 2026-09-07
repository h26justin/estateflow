import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/AuthContext'
import { ThemeProvider } from './lib/ThemeContext'
import { ConfirmProvider } from './lib/ConfirmContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import App from './App'
import { installGlobalErrorReporting } from './lib/errorReporter'

// Uncaught errors and unhandled promise rejections outside React's render
// tree (event handlers, async api calls) never reach the ErrorBoundary.
installGlobalErrorReporting()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ThemeProvider>
    </ErrorBoundary>
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
)
