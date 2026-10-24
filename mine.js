/* "Your studio": once a bWalletX is connected, the header links to /studio (the wallet's own account page).
   - Connecting from the navbar on any page opens /studio (done in bwx.js; never on a plain page load).
   - On a channel page they own (GET /v1/claims?identity_key=): "Your channel ✓" and the Mint (owner) button.
   If the endpoint isn't there yet (404, network error, odd JSON) nothing happens. */
(() => {
  const API = 'https://push.bwalletx.com/v1/claims?identity_key=';
  const nav = document.querySelector('header .nav-links');
  if (!nav) return;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const css = document.createElement('style');
  css.textContent = `.bvx-mine{position:relative;display:inline-flex;align-items:center}
  .bvx-mine>a,.bvx-mine>button{color:#ffd24d!important;font:600 14px 'Space Grotesk',sans-serif;background:none;border:0;cursor:pointer;padding:0;text-decoration:none}
  .bvx-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:40;min-width:200px;background:#0b0b0c;border:1px solid rgba(255,210,77,.35);border-radius:12px;padding:6px;display:grid}
  .bvx-menu a{padding:8px 10px;border-radius:8px;color:#f4f1e8!important;text-decoration:none}.bvx-menu a:hover{background:rgba(255,210,77,.12)}`;
  document.head.appendChild(css);

  const href = (c) => '/c/' + encodeURIComponent(c.slug || c.channelId);
  const label = (c) => c.slug ? '@' + c.slug : c.channelId;
  const here = decodeURIComponent((location.pathname.match(/^\/c\/([^/]+)/) || [])[1] || '').toLowerCase();
  const owns = (c) => here && (here === (c.slug || '').toLowerCase() || here === c.channelId.toLowerCase());
  let slot = null, lastKey = null;

  async function lookup(key) {
    try {
      const r = await fetch(API + encodeURIComponent(key));
      if (!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j?.claims) ? j.claims.filter((c) => c && typeof c.channelId === 'string') : null;
    } catch { return null; }
  }

  function paint(list) {
    slot?.remove(); slot = null;
    if (!lastKey || location.pathname.startsWith('/studio') || location.pathname.startsWith('/u/')) return;
    slot = document.createElement('span'); slot.className = 'bvx-mine';
    const mine = (list || []).find(owns);
    if (mine) {
      slot.innerHTML = `<a href="${href(mine)}" title="You claimed this channel with your bWalletX">Your channel ✓</a>`;
      const mb = document.getElementById('mintBtn');
      if (mb) { mb.textContent = 'Mint (owner)'; mb.className = 'btn btn-gold'; mb.removeAttribute('aria-disabled'); mb.href = '/studio#videos'; }
      nav.prepend(slot);
    } // otherwise the header's "$handle" button already links to /studio
  }

  async function run(key, justConnected) {
    if (!/^0[23][0-9a-fA-F]{64}$/.test(key || '')) { lastKey = null; paint(null); return; }
    if (key === lastKey && !justConnected) return;
    lastKey = key;
    const list = await lookup(key.toLowerCase());
    if (key !== lastKey) return;
    paint(list);
  }

  document.addEventListener('bvideox-wallet', (e) => run(e.detail?.identityKey, !e.detail?.restored));
  fetch('/api/bwalletx/session', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => run(j.identityKey, false)).catch(() => {});
})();
