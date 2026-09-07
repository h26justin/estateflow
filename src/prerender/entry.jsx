// Server-side entry for scripts/prerender.mjs. Renders the public pages to
// static HTML at build time so crawlers (and the first paint) get real content
// instead of an empty <div id="root">. The client then mounts the SPA over it.
//
// Only pure components belong here: nothing that reads Supabase at import
// time, nothing that needs a signed-in user.
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from '../lib/ThemeContext'
import MarketingSite from '../components/MarketingSite'
import PrivacyPolicy from '../components/PrivacyPolicy'
import TermsOfService from '../components/TermsOfService'
import SecurityPage from '../components/SecurityPage'

const noop = () => {}

export function renderPage(name) {
  switch (name) {
    case 'home':     return renderToStaticMarkup(<MarketingSite onSignIn={noop} onSignUp={noop} onPrivacy={noop} />)
    case 'privacy':  return renderToStaticMarkup(<ThemeProvider><PrivacyPolicy onBack={noop} /></ThemeProvider>)
    case 'terms':    return renderToStaticMarkup(<ThemeProvider><TermsOfService onBack={noop} /></ThemeProvider>)
    case 'security': return renderToStaticMarkup(<ThemeProvider><SecurityPage onBack={noop} /></ThemeProvider>)
    default: throw new Error(`unknown page ${name}`)
  }
}
