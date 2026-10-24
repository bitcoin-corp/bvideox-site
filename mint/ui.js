// Step 5 on /c/<slug>/claim: mint private video records. Only the identity the channel is claimed to can mint.
// Safety: LIVE + LIVE_LIMIT cap real writes (owner's first test = 3 videos). Real writes also need the wallet to pin
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
const selection = () => videos.filter((v) => picked.has(v.id) && !done()[v.id]);

async function paint() {
  const mine = !!(cfg?.claim?.claimed && key && cfg.claim.identityKey === key);
  $('s4').classList.toggle('mine', mine);
  $('mintBox').hidden = !mine;
  $('mintOff').hidden = mine;
  if (!mine) return;
  const d = done();
  $('mintList').innerHTML = videos.map((v) => `<label class="mv${d[v.id] ? ' minted' : ''}"><input type="checkbox" data-id="${esc(v.id)}"${picked.has(v.id) || d[v.id] ? ' checked' : ''}${d[v.id] ? ' disabled' : ''}><span>${esc(v.title || v.id)}</span>${d[v.id] ? '<em>Minted</em>' : ''}</label>`).join('');
  const sel = selection(), block = liveBlock();
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

async function run(dryRun) {
  if (busy) return;
  const msg = $('mintMsg'); busy = true; paint();
  try {
    const w = await window.bvxWallet();
    walletKey = (await w.getPublicKey({ identityKey: true })).publicKey;
    pinned = await pins(w);
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
    msg.textContent = 'Check your wallet: it asks once to lock your records with your keys' + (dryRun ? '.' : ', then once per batch to pay.');
    await R.runMint({
      wallet: w, channel: ch, videos: sel, dryRun, perTx: cfg.perTx || R.PER_TX, payeeScript, premiumSatsPerItem: p.premiumSatsPerItem,
      done: dryRun ? {} : done(),
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
    msg.textContent = friendly(e);
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
  out.innerHTML = rows.length ? rows.map((r, i) => `<div class="rec"><div><b>${esc(r.record.title || r.record.videoId)}</b><br><span class="mute">${r.dry ? 'Dry run, on this device only' : 'On chain · ' + esc(r.outpoint.slice(0, 10)) + '…'} · private</span></div><button class="btn btn-ghost pubBtn" type="button" data-i="${i}">Make public</button></div>`).join('')
    : '<p class="mute">No minted videos yet.</p>';
  out.onclick = (e) => { const b = e.target.closest('.pubBtn'); if (b) makePublic(rows[Number(b.dataset.i)], b); };
  paint();
}

async function makePublic(r, btn) {
  if (!confirm(`Make "${r.record.title}" public? Its record (title, description, date, link) goes on chain in clear, signed by you. That can't be undone. Your other records stay private.`)) return;
  btn.disabled = true;
  try {
    const w = await window.bvxWallet();
    const script = await R.publicScript(w, r.record, r.kid, r.outpoint);
    if (r.dry || !LIVE || !(await pins(w))) { btn.textContent = `Dry run: ${script.length / 2} bytes, not sent`; return; }
    const t = await w.createAction({ description: 'bVideoX: make one video record public', outputs: [{ lockingScript: script, satoshis: 0, outputDescription: 'Public video record' }], labels: [R.LABEL, 'bvideox public'], options: { randomizeOutputs: false, spendingAuthorization: { protocolID: R.PROTOCOL } } });
    btn.textContent = t?.txid ? 'Public ✓' : 'Not sent';
  } catch (e) { btn.disabled = false; btn.textContent = /denied|declin|reject/i.test(String(e?.message)) ? 'Make public' : 'Try again'; }
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
export const setKey = (k) => { key = k; if (ch) paint(); };
