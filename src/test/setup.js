// Vitest setup — runs before each test file.

// Stub env vars so modules that read import.meta.env at import time
// (e.g. src/lib/supabase.js) don't blow up during test bootstrap.
// These never make real network calls; the supabase client is never
// actually invoked from component tests because we don't render the
// auth-bound surface in tests.
import.meta.env.VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://test.supabase.co'
import.meta.env.VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

// Extend `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, etc) so component tests read
// naturally.
import '@testing-library/jest-dom/vitest'

// JSDOM doesn't ship matchMedia. Components that read it (themes, media
// queries, anything responsive) need a stub or they explode on import.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// JSDOM also doesn't implement scrollIntoView. CommandPalette uses it
// to keep the highlighted row in view; the no-op stub is fine for tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function() {}
}
