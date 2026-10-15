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
    document.documentElement.classList.remove('op-cookie-open');
    document.documentElement.style.removeProperty('--op-cookie-h');
  }

  // Reserve the banner's height as bottom padding on <body> (CSS in
  // index.html) so the end of the page is never stuck underneath it.
  function reserveSpace() {
    var b = document.getElementById('op-cookie-banner');
    if (!b) return;
    document.documentElement.style.setProperty('--op-cookie-h', b.offsetHeight + 'px');
    document.documentElement.classList.add('op-cookie-open');
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
