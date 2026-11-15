// Cookie consent banner, rendered outside React so it appears on first
// paint and works even if the app bundle fails. External file so the CSP
// needs no script-src 'unsafe-inline'.
(function() {
  try {
    var prior = JSON.parse(localStorage.getItem('op_cookie_consent') || 'null');
    if (prior && prior.v === 1) return; // already decided
  } catch (e) {}

  function persist(choice) {
    try { localStorage.setItem('op_cookie_consent', JSON.stringify({ v:1, choice: choice, at: Date.now() })); } catch (e) {}
    var b = document.getElementById('op-cookie-banner');
    if (b) b.remove();
    window.removeEventListener('resize', reserveSpace);
    if (shellObserver) shellObserver.disconnect();
    document.documentElement.classList.remove('op-cookie-open');
    document.documentElement.style.removeProperty('--op-cookie-h');
  }

  // Reserve the banner's height as bottom padding on <body> (CSS in
  // index.html) so the end of the page is never stuck underneath it.
  function reserveSpace() {
    var b = document.getElementById('op-cookie-banner');
    if (!b) return;
    placeAboveNav(b);
    document.documentElement.style.setProperty('--op-cookie-h', b.offsetHeight + 'px');
    // Guarded: classList.add rewrites the attribute even when the class is
    // already there, which would re-fire the shell observer below every frame.
    if (!document.documentElement.classList.contains('op-cookie-open')) {
      document.documentElement.classList.add('op-cookie-open');
    }
  }

  // Signed in on a phone, the app's fixed bottom tab bar (.mobile-nav) sits
  // where the banner would; lift the banner to sit on top of the bar so both
  // stay usable. The bar has the safe-area inset, so the banner drops its own.
  function placeAboveNav(b) {
    var nav = document.querySelector('.mobile-nav');
    var h = 0;
    try { h = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0; } catch (e) {}
    b.style.bottom = h ? h + 'px' : '';
    b.style.paddingBottom = h ? '8px' : '';
  }

  // The app shell mounts (and adds class="ef-app" to <html>) after this
  // script runs, and again after each sign-in; re-place the banner then.
  var shellObserver = null;
  function watchShell() {
    if (typeof MutationObserver !== 'function') return;
    shellObserver = new MutationObserver(function() {
      (window.requestAnimationFrame || setTimeout)(reserveSpace);
    });
    shellObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  function accept() {
    persist('accept');
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'ad_storage': 'granted', 'ad_user_data': 'granted',
        'ad_personalization': 'granted', 'analytics_storage': 'granted',
      });
    }
    if (typeof fbq === 'function') { fbq('consent', 'grant'); }
  }

  function reject() {
    persist('reject');
    // gtag default is already 'denied' — nothing else to do.
  }

  function render() {
    var banner = document.createElement('div');
    banner.id = 'op-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<p>We use optional cookies for analytics and ads. Sign-in cookies always work. ' +
      '<a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>' +
      '<div class="op-cookie-actions">' +
      '  <button class="op-cookie-reject" type="button">Reject optional</button>' +
      '  <button class="op-cookie-accept" type="button">Accept all</button>' +
      '</div>';
    document.body.appendChild(banner);
    banner.querySelector('.op-cookie-accept').addEventListener('click', accept);
    banner.querySelector('.op-cookie-reject').addEventListener('click', reject);
    reserveSpace();
    window.addEventListener('resize', reserveSpace);
    watchShell();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
