// bVideoX studio: /studio (the signed-in wallet's own) and /u/<username> (anyone's; owner tools when it's yours).
// The page names the wallet by its full paymail (name@bwalletx.com); with no name yet, a short key + "Get your name".
import * as S from '/mint/studio.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TEST = !/^(www\.)?bvideox\.com$/.test(location.hostname);
const uname = decodeURIComponent((location.pathname.match(/^\/u\/([^/]+)/) || [])[1] || '').toLowerCase();
const qs = new URLSearchParams(location.search);
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const badge = (el, live, text) => { el.className = 'badge ' + (live ? 'live' : 'coming'); el.textContent = text || (live ? 'Live' : 'Coming'); };
const say = (el, text, kind = '') => { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); };

let P = null, st = null, claimOn = false, googleOn = false, verified = null, yt = null, channel = null, videos = [], cfg = null, busy = false;
const picked = new Set();
const key = () => P?.isOwner ? st.identityKey : null;
const done = () => (channel && key() ? S.doneFor(channel.channelId, key()) : {});

if (TEST) $('testbar').hidden = false;

// ── load ──────────────────────────────────────────────────────────────────────
async function load() {
  const [p, c] = await Promise.all([
    fetch(uname ? '/api/studio/profile?name=' + encodeURIComponent(uname) : '/api/studio/profile?me=1', { cache: 'no-store' }).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) })).catch(() => ({ ok: false, status: 0, j: {} })),
    fetch('/api/claim/status').then((r) => r.json()).catch(() => ({})),
  ]);
  claimOn = !!c.youtube; googleOn = !!c.google;
  $('loading').hidden = true;
  if (uname && p.status === 404) { $('nf').hidden = false; $('nfTitle').textContent = `No studio called ${uname} yet.`; return; }
  if (!p.ok || !p.j.studio) {
    if (uname) { $('nf').hidden = false; $('nfTitle').textContent = 'That studio didn’t open.'; return; }
    $('gate').hidden = false; return;
  }
  P = p.j; st = P.studio;
  yt = (st.claims || []).find((x) => x.platform === 'youtube') || null;
  // Opened by an old name (its paymail alias) after a rename: show the chosen one in the address bar.
  if (uname && st.username && uname !== st.username) history.replaceState(null, '', '/u/' + encodeURIComponent(st.username) + location.search + location.hash);
  $('studio').hidden = false;
  head();
  if (P.isOwner) {
    $('owner3').hidden = false; $('ownerLinks').hidden = false;
    if (claimOn) verified = await fetch('/api/claim/bind', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((b) => b?.verified || null).catch(() => null);
    youtube(); account(); $('videos').hidden = !yt; await loadVideos();
  } else {
    $('pubLinks').hidden = false; publicView();
  }
  checklist();
  const want = location.hash.slice(1) || (qs.get('yt') || qs.get('linked') ? 'youtube' : '');
  if (P.isOwner && want) openModal(want);
}

/** Avatar: first image that loads (paymail bAvatar, then the YouTube channel picture); gold initial if none. */
function setAvatar(urls, name) {
  const av = $('av'); av.setAttribute('aria-label', name || '');
  const tried = (av._tried ||= []); const list = urls.filter((u) => u && !tried.includes(u));
  if (!av.style.backgroundImage) { av.textContent = (name || 'b').trim().charAt(0).toUpperCase(); av.classList.add('init'); }
  for (const u of list) {
    tried.push(u);
    const i = new Image();
    i.onload = () => { if (av._ok) return; av._ok = u; av.style.backgroundImage = `url("${u}")`; av.textContent = ''; av.classList.remove('init'); };
    i.src = u;
  }
}

function head() {
  const name = st.displayName || (st.alias ? st.alias : 'bWalletX studio');
  document.title = `${P.isOwner ? 'Your studio' : name} · bVideoX`;
  $('kick').textContent = P.isOwner ? 'Your studio' : 'Studio';
  $('name').textContent = name;
  // Full paymail is the primary label; the $handle is secondary. No name: short key + "Get your name".
  const sk = st.identityKey ? st.identityKey.slice(0, 6) + '\u2026' + st.identityKey.slice(-4) : '';
  $('handle').textContent = st.paymail || sk || 'No name yet';
  if (st.paymail) $('mail').textContent = st.alias ? '$' + st.alias : '';
  else $('mail').innerHTML = '<a href="https://bwalletx.com/get" target="_blank" rel="noopener">Get your name</a>';
  setAvatar([st.avatar], name);
  if (st.username) { $('linkRow').hidden = false; $('pubLink').textContent = 'bvideox.com/u/' + st.username; }
  $('copyLink').onclick = async () => { try { await navigator.clipboard.writeText('https://bvideox.com/u/' + st.username); $('copyLink').textContent = 'Copied'; } catch { $('copyLink').textContent = 'Copy failed'; } setTimeout(() => { $('copyLink').textContent = 'Copy link'; }, 1600); };
  $('st1s').textContent = st.paymail || sk || 'Connected';
}

// ── YouTube ───────────────────────────────────────────────────────────────────
const HELP = {
  'no-channel': ['That Google account has no YouTube channel', [
    'On Google’s sign-in screen, pick the account that owns the channel. A channel made as a “Brand Account” is listed there under its own name.',
    'Not sure which one? Open youtube.com, tap your picture, then “Switch account” to see the channel’s account.',
    'No channel yet? Make one at youtube.com/create_channel, then come back and press Link YouTube.',
  ]],
  'no-videos': ['We found your channel, but no public videos', [
    'Open YouTube Studio and go to Content.',
    'Set the videos you want here to Public. Private and unlisted videos don’t show up.',
    'If you hid your channel, sign in to YouTube and restore it first.',
    'Come back and press Refresh.',
  ]],
  private: ['Your channel is not public', [
    'Open YouTube Studio, then Settings › Channel.',
    'Make sure the channel and the videos you want are Public.',
    'Come back and press Refresh.',
  ]],
  denied: ['Google didn’t give us access', [
    'If you pressed Cancel, press Link YouTube again and allow the read-only YouTube permission.',
    'bVideoX is still in Google’s testing stage, so your Google account may need adding as a tester first. Ask us in Ask b and we’ll add you.',
  ]],
  scope: ['YouTube access wasn’t ticked', ['Press Link YouTube again and tick the YouTube permission on Google’s screen. It is read-only.']],
  state: ['That sign-in took too long', ['Press Link YouTube again. Use the same tab from start to finish.']],
  token: ['Google sign-in didn’t finish', ['Press Link YouTube again.']],
  google: ['Google refused the sign-in', ['Try again. If it keeps happening, tell us in Ask b.']],
  youtube: ['YouTube didn’t answer', ['Try again in a minute.']],
};
function help(kind) {
  const h = HELP[kind];
  if (!h) { $('ytHelp').hidden = true; return; }
  $('ytHelp').hidden = false;
  $('ytHelp').innerHTML = `<h3>${esc(h[0])}</h3><ol>${h[1].map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
    + '<div class="walk" aria-label="Video walkthrough, coming soon"><div><b>Video walkthrough</b><span class="badge coming">Coming</span></div></div>';
}

function youtube() {
  const body = $('ytBody');
  const stepDone = (t) => { $('st2').classList.add('done'); $('st2s').textContent = t; };
  if (yt) {
    badge($('ytBadge'), true, 'Linked');
    const label = yt.slug && !/^UC[\w-]{22}$/.test(yt.slug) ? '@' + yt.slug : 'your channel';
    body.innerHTML = `<div class="chan"><div><p style="margin:0">✓ Linked to <b>${esc(label)}</b>. Every public video is listed below.</p></div><a class="btn btn-ghost" href="/c/${encodeURIComponent(yt.slug || yt.channelId)}">Channel page</a><button class="btn btn-ghost" type="button" id="ytRefresh">Refresh videos</button></div>`;
    $('ytRefresh').onclick = () => loadVideos(true);
    stepDone(label);
    help(qs.get('hint') || null);
    return;
  }
  if (verified && verified.channelId) {
    badge($('ytBadge'), true, 'Almost there');
    body.innerHTML = `<p>✓ ${verified.method === 'code' ? 'YouTube shows' : 'Google confirmed'} you own <b>${esc(verified.name || (verified.slug ? '@' + verified.slug : 'the channel'))}</b>${verified.email ? ` (${esc(verified.email)})` : ''}. Sign with your wallet to link it to your studio. It costs nothing.</p><button class="btn btn-gold" type="button" id="bindBtn">Link it to my wallet</button>`;
    $('bindBtn').onclick = bind;
    if (qs.get('many')) say($('ytMsg'), `That Google account has ${qs.get('many')} channels. We picked the first. To link another, sign in again and choose that channel’s account.`);
    help(qs.get('hint') || null);
    return;
  }
  const on = claimOn && !TEST;
  badge($('ytBadge'), on, on ? 'Live' : 'Coming');
  body.innerHTML = `<p>Paste a short code in your channel description and press Check. No Google sign-in. We only read your public channel page.</p>`
    + (on ? `<a class="btn btn-gold" id="ytGo" href="#">Link YouTube</a>`
      : `<a class="btn btn-gold" aria-disabled="true" href="#" id="ytGo">${TEST ? 'Works on bvideox.com' : 'Coming soon'}</a>`);
  $('ytGo').addEventListener('click', (e) => { e.preventDefault(); if (!$('ytGo').getAttribute('aria-disabled')) window.bvxClaimCode.open({ google: googleOn ? '/api/claim/youtube/start?studio=1' : null, onVerified: (v) => { verified = v; youtube(); } }); });
  const err = qs.get('yt');
  if (err) help(err);
}

async function bind() {
  const btn = $('bindBtn'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Check your wallet…'; say($('ytMsg'), '');
  try {
    const w = await window.bvxWallet();
    const timestamp = Date.now();
    const msg = `bvideox claim youtube ${verified.channelId} ${key()} ${timestamp}`;
    const { signature } = await w.createSignature({ protocolID: [2, 'bwalletx channel claim'], keyID: 'youtube ' + verified.channelId, counterparty: 'anyone', data: Array.from(new TextEncoder().encode(msg)) });
    const r = await fetch('/api/claim/bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timestamp, signature }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.code === 'reverify') verified = null; throw new Error(j.error || 'The link was not saved.'); }
    yt = { platform: 'youtube', channelId: verified.channelId, slug: verified.slug, claimedAt: j.claimedAt };
    history.replaceState(null, '', location.pathname);
    youtube(); checklist(); $('ytMsg').textContent = ''; $('youtube').close(); $('videos').hidden = false; await loadVideos(); $('videos').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    say($('ytMsg'), /denied|declin|reject|cancel/i.test(String(e?.message)) ? 'Your wallet said no, so nothing was linked.' : e?.code === 'NOT_FOUND' ? 'Your wallet isn’t connected in this browser. Press Connect bWalletX at the top, then try again.' : (e?.message || 'That didn’t work. Try again.'), 'bad');
    if (verified) { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Link it to my wallet'; } else youtube();
  }
}

// ── videos ────────────────────────────────────────────────────────────────────
async function loadVideos(fresh) {
  if (!yt) { $('vLede').textContent = 'Link YouTube to see every video you’ve posted here.'; $('tools').hidden = true; $('grid').innerHTML = ''; return; }
  $('vLede').textContent = 'Loading your videos…';
  $('grid').innerHTML = '<div class="skel"></div>'.repeat(6);
  const slug = yt.slug || yt.channelId;
  const [j, c] = await Promise.all([
    fetch('/api/channel?slug=' + encodeURIComponent(slug) + (fresh ? '&t=' + Date.now() : '')).then((r) => r.json()).catch(() => null),
    S.loadCfg(yt.channelId),
  ]);
  cfg = c;
  if (!j?.channel) { $('grid').innerHTML = ''; $('vLede').textContent = 'YouTube didn’t answer just now. Press Refresh videos in a minute.'; return; }
  channel = j.channel; videos = j.videos || [];
  setAvatar([channel.avatar], st.displayName || st.alias);
  if (!videos.length) { $('grid').innerHTML = ''; $('tools').hidden = true; $('vLede').textContent = 'No public videos found on this channel yet.'; help('no-videos'); return; }
  const total = j.channel.total;
  $('vLede').textContent = `${S.videosN(videos.length)}${total && total > videos.length ? ` of ${total} shown (YouTube only lists public ones)` : ''}. Mint one at a time, or pick several and mint them together.`;
  $('tools').hidden = false; $('caveats').hidden = false;
  paintGrid(); paintTools();
}

const unminted = () => videos.filter((v) => !done()[v.id]);
const date = (v) => v.published ? new Date(v.published).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + (v.dateExact === false ? ' (about)' : '') : '';
function paintGrid() {
  const d = done(), block = S.gate(cfg, key(), channel.channelId);
  $('grid').innerHTML = videos.map((v) => {
    const m = !!d[v.id], sel = picked.has(v.id);
    return `<article class="v${m ? ' minted' : ''}${sel ? ' sel' : ''}" data-id="${esc(v.id)}">
      <a class="th" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener" style="background-image:url('https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg')" aria-label="Watch on YouTube: ${esc(v.title)}"></a>
      ${m ? '<span class="seal">MINTED</span>' : `<label class="pick" title="Select"><input type="checkbox" data-pick="${esc(v.id)}"${sel ? ' checked' : ''} aria-label="Select ${esc(v.title)}"></label>`}
      <div class="meta"><span class="t">${esc(v.title || v.id)}</span><span class="d">${esc(date(v))}</span>
      ${m ? '<button class="btn btn-ghost" type="button" disabled>Minted ✓</button>' : `<button class="btn btn-gold" type="button" data-mint="${esc(v.id)}"${busy || block ? ' disabled' : ''}>Mint</button>`}</div></article>`;
  }).join('');
  const n = Object.keys(d).length;
  $('st3s').textContent = n ? `${S.videosN(n)} minted` : 'Ready when you are';
  $('st3').classList.toggle('done', n > 0);
}
async function paintTools() {
  const left = unminted(), sel = left.filter((v) => picked.has(v.id));
  const target = sel.length ? sel : left;
  const block = S.gate(cfg, key(), channel.channelId);
  const room = Math.max(0, S.LIVE_LIMIT - Object.keys(done()).length);
  $('selAll').textContent = left.length && sel.length === left.length ? 'Clear' : 'Select all';
  $('selAll').disabled = busy || !left.length;
  $('mintSel').textContent = sel.length ? `Mint ${S.videosN(sel.length)}` : `Mint all ${left.length}`;
  $('mintSel').disabled = busy || !!block || !left.length;
  const q = await S.quote(channel, target, cfg);
  const cap = target.length > room && room > 0 ? ` First test run: we mint ${S.videosN(room)} now; the rest wait for the bigger batch (coming).` : '';
  $('quote').textContent = block ? block : !left.length ? 'Every video here is minted.' : q ? q.text + '.' + cap : 'Pricing…';
}

async function mintThese(list) {
  if (busy || !list.length) return;
  busy = true; paintGrid(); paintTools();
  $('mintSel').classList.add('busy');
  say($('mintMsg'), 'Checking your wallet…'); // fresh pin check on every press; an old answer never sticks
  try {
    const r = await S.mint({ channel, videos: list, key: key(), onStatus: (t) => say($('mintMsg'), t) });
    picked.clear();
    say($('mintMsg'), `Done: ${S.videosN(r.minted)} minted, about ${r.cost}.` + (r.skipped ? ` ${S.videosN(r.skipped)} still to go: minting more than ${S.LIVE_LIMIT} at once is coming after we check this test run.` : ''), 'ok');
  } catch (e) { say($('mintMsg'), e.message, 'bad'); }
  busy = false; $('mintSel').classList.remove('busy'); paintGrid(); paintTools(); checklist();
}

$('grid').addEventListener('change', (e) => { const id = e.target.dataset?.pick; if (!id) return; e.target.checked ? picked.add(id) : picked.delete(id); e.target.closest('.v').classList.toggle('sel', e.target.checked); paintTools(); });
$('grid').addEventListener('click', (e) => { const id = e.target.closest('[data-mint]')?.dataset.mint; if (id) mintThese(videos.filter((v) => v.id === id)); });
$('selAll').onclick = () => { const left = unminted(); const all = left.length && left.every((v) => picked.has(v.id)); left.forEach((v) => all ? picked.delete(v.id) : picked.add(v.id)); paintGrid(); paintTools(); };
$('mintSel').onclick = () => { const left = unminted(), sel = left.filter((v) => picked.has(v.id)); mintThese(sel.length ? sel : left); };

// ── account: username + domain ────────────────────────────────────────────────
function account() {
  badge($('uBadge'), st.settingsLive);
  badge($('dB1'), st.settingsLive);
  $('uIn').value = st.username || '';
  $('dIn').value = st.domain || '';
  $('uForm').onsubmit = (e) => { e.preventDefault(); save('u'); };
  $('dForm').onsubmit = (e) => { e.preventDefault(); save('d'); };
  $('uIn').oninput = () => { const v = $('uIn').value.trim().toLowerCase(); $('uIn').setAttribute('aria-invalid', String(!!v && !USERNAME_RE.test(v))); };
}
async function save(which) {
  const out = which === 'u' ? $('uMsg') : $('dMsg'), btn = which === 'u' ? $('uSave') : $('dSave');
  const username = $('uIn').value.trim().toLowerCase();
  const domain = $('dIn').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '') || null;
  if (!USERNAME_RE.test(username)) return say(out, 'Use 3 to 30 letters, numbers, - or _, starting with a letter or number.', 'bad');
  if (domain && !DOMAIN_RE.test(domain)) return say(out, 'That doesn’t look like a domain. Try something like videos.yourname.com.', 'bad');
  if (!st.settingsLive) return say(out, `Coming soon: saving ${which === 'u' ? 'your own username' : 'a domain'} opens shortly. Your studio link is bvideox.com/u/${st.username} until then.`);
  if (st.usernameSaved && username === st.username && domain === (st.domain || null)) return say(out, 'Nothing to change: that’s already saved.');
  btn.disabled = true; btn.classList.add('busy'); const label = btn.textContent; btn.textContent = 'Check your wallet…'; say(out, '');
  try {
    const w = await window.bvxWallet();
    const timestamp = Date.now();
    const msg = `bvideox studio ${key()} ${username} ${domain || '-'} ${timestamp}`;
    const { signature } = await w.createSignature({ protocolID: [2, 'bvideox studio'], keyID: 'settings', counterparty: 'anyone', data: Array.from(new TextEncoder().encode(msg)) });
    const r = await fetch('/api/studio/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, domain, timestamp, signature }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'That wasn’t saved.');
    const moved = j.username && j.username !== st.username;
    st.username = j.username; st.domain = j.domain || null; st.usernameSaved = true;
    say(out, moved ? 'Saved ✓ Your studio is now at bvideox.com/u/' + j.username : 'Saved ✓', 'ok');
    head();
    if (moved && uname) history.replaceState(null, '', '/u/' + encodeURIComponent(j.username) + location.hash);
  } catch (e) {
    say(out, /denied|declin|reject|cancel/i.test(String(e?.message)) ? 'Your wallet said no, so nothing changed.' : e?.code === 'NOT_FOUND' ? 'Your wallet isn’t connected in this browser. Press Connect bWalletX at the top, then try again.' : e.message, 'bad');
  }
  btn.disabled = false; btn.classList.remove('busy'); btn.textContent = label;
}

// ── public view + checklist ──────────────────────────────────────────────────
function publicView() {
  const list = st.claims || [];
  $('pub').hidden = false;
  $('pubList').innerHTML = list.length
    ? list.map((c) => `<p><a class="btn btn-ghost" href="/c/${encodeURIComponent(c.slug || c.channelId)}">${esc(c.slug && !/^UC/.test(c.slug) ? '@' + c.slug : 'YouTube channel')}</a></p>`).join('')
    : '<p class="mute">No channels linked yet.</p>';
  if (P.signedIn === false) $('pubList').insertAdjacentHTML('beforeend', '<p class="hint">Is this yours? Connect bWalletX at the top to manage it.</p>');
}
function checklist() {
  if (!P) return;
  const ytLive = claimOn && !TEST;
  const rows = [
    ['Connect bWalletX', true],
    ['Your $name and paymail on your studio', true],
    [`Your studio link (bvideox.com/u/${st.username || 'name'})`, !!st.username],
    ['Choose your own username', !!st.settingsLive],
    ['Use your own domain', false],
    ['Link YouTube with a code (no Google sign-in)', ytLive],
    ['See every public video on your channel', true],
    ['Mint one video, a few, or all of them', true],
    ['Mint the whole channel in one go', false],
    ['Video walkthrough for YouTube settings', false],
  ];
  $('checklist').innerHTML = rows.map(([t, live]) => `<li><span>${esc(t)}</span><span class="badge ${live ? 'live' : 'coming'}">${live ? 'Live' : 'Coming'}</span></li>`).join('');
}

document.addEventListener('bvideox-wallet', (e) => {
  const k = e.detail?.identityKey || null;
  say($('mintMsg'), ''); // an old "needs an update" answer belongs to the old connection
  // Connected on the gate, or the wallet changed: reopen the studio for whoever is signed in now.
  if (!P && k) location.reload();
  else if (P?.isOwner && k !== st.identityKey) location.assign(uname ? location.pathname : '/studio');
  else if (P && !P.isOwner && k === st.identityKey) location.reload();
});

// ── modals: every step opens over the studio; one at a time ───────────────────
const MODALS = ['youtube', 'account', 'status'];
function openModal(id) {
  if (id === 'videos') { if (!yt) id = 'youtube'; else { $('videos').hidden = false; $('videos').scrollIntoView({ behavior: 'smooth' }); return; } }
  if (!MODALS.includes(id)) return;
  if (!P?.isOwner && id !== 'status') return;
  MODALS.forEach((m) => { const d = $(m); if (d.open && m !== id) d.close(); });
  const d = $(id); if (!d.open) d.showModal();
}
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); openModal(o.dataset.open); return; }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  else if (e.target.tagName === 'DIALOG') e.target.close(); // backdrop click
});
MODALS.forEach((m) => $(m).addEventListener('close', () => { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }));

load();
