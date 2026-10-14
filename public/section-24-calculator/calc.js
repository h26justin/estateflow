// Section 24 calculator: live recompute + email capture. External file so
// the site CSP needs no script-src 'unsafe-inline' (it was inline before).

// Submit handler for the email-capture form. POSTs to the lead-capture
// edge function with the current calculator state attached so the
// confirmation email can reference their numbers later if we want.
function submitEmailCapture(ev) {
  ev.preventDefault();
  var form = ev.target;
  var btn  = document.getElementById('op-email-btn');
  var msg  = document.getElementById('op-email-msg');
  var email = (form.email.value || '').trim();
  var honeypot = (form.company.value || '').trim();

  if (!email) return false;
  btn.disabled = true; btn.textContent = 'Sending…';
  msg.style.color = '#6B7691';
  msg.textContent = '';

  var payload = {
    rent:  Number(document.getElementById('rent').value)  || 0,
    mort:  Number(document.getElementById('mort').value)  || 0,
    other: Number(document.getElementById('other').value) || 0,
    band:  Number((document.querySelector('input[name=band]:checked') || {}).value) || 0,
    net:   document.getElementById('r-net').textContent,
    extra: document.getElementById('r-extra').textContent,
  };

  fetch('https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/lead-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, source: 'section-24-calc', honeypot: honeypot, payload: payload }),
  })
    .then(function(r) { return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
    .then(function(res) {
      btn.disabled = false; btn.textContent = 'Send me a copy';
      if (res.ok) {
        msg.style.color = '#1A9E65';
        msg.textContent = '✓ Sent — check your inbox in a couple of minutes.';
        form.email.value = '';
      } else {
        msg.style.color = '#CC3333';
        msg.textContent = (res.body && res.body.error) || 'Could not send — please try again.';
      }
    })
    .catch(function() {
      btn.disabled = false; btn.textContent = 'Send me a copy';
      msg.style.color = '#CC3333';
      msg.textContent = 'Network error — please try again.';
    });
  return false;
}

// Live recompute on every input change. All math runs client-side
// (no data leaves the browser). Mortgage rate stored as a percentage
// in the input, then divided by 100 for the formula.
var $ = function(id) { return document.getElementById(id); };
var fmt = function(n) {
  var v = Math.round(Number(n) || 0);
  var sign = v < 0 ? '−' : '';
  var abs = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '£' + abs;
};
var fmtPct = function(n) { return (Number(n) || 0).toFixed(1) + '%'; };
function recompute() {
  var rent  = Number($('rent').value)  || 0;
  var mort  = Number($('mort').value)  || 0;
  var other = Number($('other').value) || 0;
  var bandPct = Number((document.querySelector('input[name=band]:checked') || {}).value) || 20;

  var profit = Math.max(0, rent - other);     // mortgage interest NOT deducted under S24
  var taxOnProfit = profit * (bandPct / 100);
  var credit = mort * 0.20;
  var taxDue = Math.max(0, taxOnProfit - credit);
  var netProfit = rent - other - mort - taxDue;
  var effRate  = rent > 0 ? (taxDue / rent) * 100 : 0;

  // Pre-S24 rules: mortgage interest WAS deductible, all relief at marginal rate
  var oldProfit = Math.max(0, rent - other - mort);
  var oldTax = oldProfit * (bandPct / 100);
  var extra = taxDue - oldTax;

  $('r-income').textContent = fmt(rent);
  $('r-other').textContent  = fmt(other);
  $('r-profit').textContent = fmt(profit);
  $('r-tax').textContent    = fmt(taxOnProfit);
  $('r-credit').textContent = '−' + fmt(credit);
  $('r-due').textContent    = fmt(taxDue);
  $('r-net').textContent    = fmt(netProfit);
  $('r-eff').textContent    = fmtPct(effRate);
  $('r-old').textContent    = fmt(oldTax);
  $('r-extra').textContent  = fmt(extra);
}
['rent','mort','other'].forEach(function(id){ $(id).addEventListener('input', recompute); });
document.querySelectorAll('input[name=band]').forEach(function(el){ el.addEventListener('change', recompute); });
recompute();

document.getElementById('op-email-capture').addEventListener('submit', submitEmailCapture);
