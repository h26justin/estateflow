// Google consent mode v2 default-deny. Loaded synchronously from <head>
// (external so the CSP needs no script-src 'unsafe-inline').
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'denied',
  'functionality_storage': 'granted',
  'security_storage': 'granted',
  'wait_for_update': 500,
});
// Honour any prior consent from localStorage so returning visitors
// don't see the banner again.
try {
  var prior = JSON.parse(localStorage.getItem('op_cookie_consent') || 'null');
  if (prior && prior.v === 1 && prior.choice === 'accept') {
    gtag('consent', 'update', {
      'ad_storage': 'granted', 'ad_user_data': 'granted',
      'ad_personalization': 'granted', 'analytics_storage': 'granted',
    });
  }
} catch (e) {}
