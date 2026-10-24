// Step 5 on /c/<slug>/claim: mint private video records. Only the identity the channel is claimed to can mint.
// LIVE gates real writes; LIVE_LIMIT is no longer a cap (owner 24 Oct: users mint what they want). Real writes also need the wallet to pin
// [2,'bvideox records'] to bvideox.com (getVersion().pinnedProtocols >= PIN_VERSION) and the premium payee set on
// the server. Any check failing = the page refuses to write. Dry run is always available and sends nothing.
import * as R from './records.js';
import { LIVE, LIVE_LIMIT, esc, ls, videosN, txN, money, doneKey as dk, loadCfg as cfgFor, pinCheck, liveBlock as blockFor, friendly } from './core.js';

const $ = (id) => document.getElementById(id);

let ch = null, videos = [], key = null, cfg = null, pinned = null, walletKey = null, busy = false, walletSeen = '';
const picked = new Set();
const doneKey = () => dk(ch.channelId, key);
const dryKey = () => `bvx-dry-${ch.channelId}`;
const done = () => ls.get(doneKey()) || {};

const loadCfg = () => cfgFor(ch.channelId);
async function pins(w) { const p = await pinCheck(w); walletSeen = p.seen; return p.ok; }
/** Why a real write is refused right now, or null. */
const liveBlock = () => blockFor({ cfg, key, walletKey, pinned, seen: walletSeen, doneCount: Object.keys(done()).length });
// The pin check is re-run on every Mint press and on reconnect, so the button never stays disabled by an old answer:
// paint() gates on everything except the pin; a failed pin shows next to the button until the next check passes.
const paintBlock = () => blockFor({ cfg, key, walletKey, pinned: null, seen: '', doneCount: Object.keys(done()).length });
const selection = () => videos.filter((v) => picked.has(v.id) && !done()[v.id]);

async function paint() {
  const mine = !!(cfg?.claim?.claimed && key && cfg.claim.identityKey === key);
  $('s4').classList.toggle('mine', mine);
  $('mintBox').hidden = !mine;
  $('mintOff').hidden = mine;
  if (!mine) return;
  const d = done();
  $('mintList').innerHTML = videos.map((v) => `<label class="mv${d[v.id] ? ' minted' : ''}"><input type="checkbox" data-id="${esc(v.id)}"${picked.has(v.id) || d[v.id] ? ' checked' : ''}${d[v.id] ? ' disabled' : ''}><span>${esc(v.title || v.id)}</span>${d[v.id] ? '<em>Minted</em>' : ''}</label>`).join('');
  const sel = selection(), block = paintBlock();
  const liveN = Math.min(sel.length, Math.max(0, LIVE_LIMIT - Object.keys(d).length));
  if (cfg && sel.length) {
    const p = await R.plan(ch, sel, cfg);
    $('mintQuote').textContent = `${videosN(sel.length)} selected: 1p per video + network fee (${money(p.feeSats, cfg)}) = about ${money(p.totalSats, cfg)}, in ${txN(p.txs)}.`;
  } else $('mintQuote').textContent = sel.length ? 'Pricing…' : 'Pick the videos to mint.';
  $('dryBtn').disabled = busy || !sel.length;
  $('liveBtn').disabled = busy || !!block || !liveN;
  $('liveBtn').textContent = liveN ? `Mint ${videosN(liveN)}${LIVE_LIMIT < Infinity ? ' (test run)' : ''}` : 'Mint';
  $('mintGate').textContent = block || (LIVE_LIMIT < Infinity ? `Test run: real minting is capped at ${LIVE_LIMIT} videos for now.` : '');
  $('mintBadge').className = 'badge ' + (block ? 'coming' : 'live'); $('mintBadge').textContent = block ? 'Dry run' : 'Live';
}

/** Errors go inside the modal, next to the Mint button (never a browser dialog). */
function showErr(t) { const el = $('mintErr'); if (!el) return; el.textContent = t || ''; el.hidden = !t; }

async function run(dryRun) {
  if (busy) return;
  const msg = $('mintMsg'); busy = true; showErr(''); paint();
  try {
    const w = await window.bvxWallet();
    walletKey = (await w.getPublicKey({ identityKey: true })).publicKey;
    pinned = await pins(w);
    if (pinned) showErr('');
    if (!dryRun) {
      cfg = await loadCfg();
      const b = liveBlock(); if (b) throw new Error(b);
    }
    let sel = selection();
    if (!dryRun) sel = sel.slice(0, LIVE_LIMIT - Object.keys(done()).length);
    if (!cfg) throw new Error("We couldn't get today's prices. Try again in a minute.");
    if (!sel.length) throw new Error('Pick the videos to mint.');
    const p = await R.plan(ch, sel, cfg);
    const payeeScript = cfg.payee ? await R.p2pkhScriptFor(cfg.payee) : null;
    if (!dryRun && !payeeScript) throw new Error('No payee set.');
    let n = 0;
    const dry = [];
    msg.textContent = dryRun ? 'Check your wallet: it encrypts your records with your keys. Nothing is sent.'
      : `Check your wallet: one approval, "Mint ${videosN(sel.length)}, locked to you on bvideox.com", covers locking and paying.`;
    await R.runMint({
      wallet: w, channel: ch, videos: sel, dryRun, perTx: cfg.perTx || R.PER_TX, payeeScript, premiumSatsPerItem: p.premiumSatsPerItem,
      done: dryRun ? {} : done(),
      onChecking: () => { msg.textContent = 'Approved. Checking the network has it…'; },
      onBatch: (es) => {
        n += es.length;
        if (dryRun) dry.push(...es);
        else { const d = done(); for (const e of es) d[e.videoId] = { outpoint: e.outpoint, kid: e.kid }; ls.set(doneKey(), d); }
        msg.textContent = `${dryRun ? 'Dry run: ' : ''}${n} of ${videosN(sel.length)} encrypted${dryRun ? ' on this device. Nothing sent.' : ' and written.'}`;
      },
    });
    if (dryRun) ls.set(dryKey(), dry.map((e) => ({ outpoint: e.outpoint, kid: e.kid, script: e.script })));
    msg.textContent = dryRun
      ? `Dry run done: ${videosN(n)} encrypted by your wallet into ${txN(p.txs)}, about ${money(p.totalSats, cfg)}. Nothing was sent or spent. Open them below.`
      : `Done: ${videosN(n)} written, locked with your keys. Open them below.`;
    picked.clear();
    await readBack(w);
  } catch (e) {
    msg.textContent = '';
    showErr(friendly(e));
  }
  busy = false; paint();
}

/** "Your minted videos": live records from the wallet's actions + this device's dry run, decrypted locally. */
async function readBack(w) {
  const out = $('mintedList'), rows = [];
  out.innerHTML = '<p class="mute">Opening your records on this device…</p>';
  try {
    w = w || await window.bvxWallet();
    const seen = new Set();
    try {
      const a = await w.listActions({ labels: [R.LABEL], includeOutputs: true, includeOutputLockingScripts: true, limit: 200 });
      for (const t of a.actions || []) for (const o of t.outputs || []) {
        if (!o.lockingScript || !R.parseRecordScript(o.lockingScript)) continue;
        const r = await R.openRecord(w, o.lockingScript).catch(() => null);
        if (r && r.record.channelId === ch.channelId && !seen.has(r.record.videoId)) { seen.add(r.record.videoId); rows.push({ ...r, outpoint: `${t.txid}:${o.outputIndex}`, dry: false }); }
      }
      if (key && rows.length) { const d = done(); for (const r of rows) d[r.record.videoId] = d[r.record.videoId] || { outpoint: r.outpoint, kid: r.kid }; ls.set(doneKey(), d); }
    } catch {}
    for (const e of ls.get(dryKey()) || []) {
      const r = await R.openRecord(w, e.script).catch(() => null);
      if (r) rows.push({ ...r, outpoint: e.outpoint, dry: true });
    }
  } catch {}
  out.innerHTML = rows.length ? (rows.length > 1 ? `<div class="rec"><span class="mute">${rows.length} records</span><button class="btn pubAll" type="button">Make all public</button></div>` : '') + rows.map((r, i) => `<div class="rec"><div><b>${esc(r.record.title || r.record.videoId)}</b><br><span class="mute">${r.dry ? 'Dry run, on this device only' : 'On chain · ' + esc(r.outpoint.slice(0, 10)) + '…'} · <span class="vis" data-i="${i}">private</span></span></div><button class="btn btn-ghost pubBtn" type="button" data-i="${i}">Make public</button></div>`).join('')
    : '<p class="mute">No minted videos yet.</p>';
  out.onclick = (e) => {
    const b = e.target.closest('.pubBtn'); if (b) return makePublic([rows[Number(b.dataset.i)]], [b], out);
    const a = e.target.closest('.pubAll');
    if (a) { const btns = [...out.querySelectorAll('.pubBtn')].filter((x) => !x.disabled); makePublic(btns.map((x) => rows[Number(x.dataset.i)]), btns, out, a); }
  };
  paint();
}

/** Styled in-page confirm (never a browser dialog). Resolves true on the primary button. */
function ask(title, body, yes) {
  return new Promise((done) => {
    if (!document.getElementById('bvxAskCss')) {
      const st = document.createElement('style'); st.id = 'bvxAskCss';
      st.textContent = '.bvx-ask{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.72);backdrop-filter:blur(6px)}.bvx-ask>div{max-width:420px;width:100%;background:#0d0d0f;border:1px solid rgba(212,175,55,.35);border-radius:16px;padding:22px;color:#f4f1e8;box-shadow:0 20px 60px rgba(0,0,0,.6)}.bvx-ask h3{margin:0 0 8px;color:#d4af37;font-size:18px}.bvx-ask p{margin:0 0 18px;line-height:1.5;color:#c9c4b5;font-size:14px}.bvx-ask .row{display:flex;gap:10px;justify-content:flex-end}.bvx-ask button{border-radius:10px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;border:1px solid rgba(212,175,55,.4);background:transparent;color:#f4f1e8}.bvx-ask button.go{background:#d4af37;color:#0b0b0b;border-color:#d4af37}';
      document.head.appendChild(st);
    }
    const m = document.createElement('div'); m.className = 'bvx-ask'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="row"><button type="button" class="no">Cancel</button><button type="button" class="go">${esc(yes)}</button></div></div>`;
    const close = (v) => { m.remove(); document.removeEventListener('keydown', key); done(v); };
    const key = (e) => { if (e.key === 'Escape') close(false); };
    m.onclick = (e) => { if (e.target === m || e.target.closest('.no')) close(false); else if (e.target.closest('.go')) close(true); };
    document.addEventListener('keydown', key);
    document.body.appendChild(m); m.querySelector('.go').focus();
  });
}

/** Make one or more records public in ONE wallet prompt (one transaction). */
async function makePublic(list, btns, out, allBtn) {
  if (!list.length) return;
  const one = list.length === 1;
  const ok = await ask(one ? `Make "${list[0].record.title}" public?` : `Make all ${list.length} public?`,
    `${one ? 'Its record' : 'Each record'} (title, description, date, link) goes on chain in clear, signed by you. That can't be undone.`,
    one ? 'Make public' : `Make ${list.length} public`);
  if (!ok) return;
  const all = [...btns, allBtn].filter(Boolean);
  all.forEach((b) => { b.disabled = true; });
  try {
    const w = await window.bvxWallet();
    const scripts = [];
    for (const r of list) scripts.push(await R.publicScript(w, r.record, r.kid, r.outpoint));
    if (list.some((r) => r.dry) || !LIVE || !(await pins(w))) { btns.forEach((b, i) => { b.textContent = `Dry run: ${scripts[i].length / 2} bytes, not sent`; }); return; }
    const t = await w.createAction({ description: one ? 'bVideoX: make one video record public' : `bVideoX: make ${list.length} video records public`, outputs: scripts.map((lockingScript) => ({ lockingScript, satoshis: 0, outputDescription: 'Public video record' })), labels: [R.LABEL, 'bvideox public'], options: { randomizeOutputs: false, spendingAuthorization: { protocolID: R.PROTOCOL } } });
    if (!t?.txid) throw new Error('Not sent');
    btns.forEach((b) => { b.textContent = 'Public ✓'; const v = out.querySelector(`.vis[data-i="${b.dataset.i}"]`); if (v) v.textContent = 'public'; });
    if (allBtn) allBtn.textContent = 'All public ✓';
  } catch (e) {
    all.forEach((b) => { b.disabled = false; });
    if (!/denied|declin|reject/i.test(String(e?.message))) btns.forEach((b) => { b.textContent = 'Try again'; });
  }
}

/** Called by the claim page once the channel, videos and session key are known. */
export async function initMint(channel, list, identityKey) {
  ch = channel; videos = list || []; key = identityKey || key;
  cfg = await loadCfg();
  $('mintList').onchange = (e) => { const id = e.target.dataset?.id; if (!id) return; e.target.checked ? picked.add(id) : picked.delete(id); paint(); };
  $('mintAll').onclick = () => { const all = videos.every((v) => picked.has(v.id) || done()[v.id]); videos.forEach((v) => all ? picked.delete(v.id) : picked.add(v.id)); paint(); };
  $('dryBtn').onclick = () => run(true);
  $('liveBtn').onclick = () => run(false);
  $('openBtn').onclick = () => readBack();
  paint();
  if (location.hash === '#mint') $('s4').scrollIntoView({ behavior: 'smooth' });
}
export const setKey = (k) => { if (k === key) { if (ch) paint(); return; } key = k; pinned = null; walletKey = null; walletSeen = ''; showErr(''); if (ch) paint(); };
// Wallet reconnected (or switched): forget the old pin answer and check the new wallet straight away.
document.addEventListener('bvideox-wallet', async (e) => {
  pinned = null; walletKey = null; showErr('');
  if (!e.detail?.identityKey || !ch) { if (ch) paint(); return; }
  try { const w = await window.bvxWallet(); pinned = await pins(w); if (pinned === false) showErr(liveBlock() || ''); } catch {}
  paint();
});
