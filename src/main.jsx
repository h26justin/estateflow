import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/AuthContext'
import { ThemeProvider } from './lib/ThemeContext'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider><App /></AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)
