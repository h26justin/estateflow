// Sets <html data-theme> before first paint so the app does not flash light
// then dark. Must stay a tiny synchronous external file: the CSP has no
// 'unsafe-inline' for scripts. Mirrors the rule in src/lib/ThemeContext.jsx:
// an explicit saved choice wins, otherwise follow prefers-color-scheme.
(function () {
  var dark = false
  try {
    var stored = localStorage.getItem('ef_dark_mode')
    if (stored === 'true') dark = true
    else if (stored !== 'false') dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  } catch (e) {
    try { dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch (e2) { /* default light */ }
  }
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
})()
