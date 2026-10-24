// Shared mint rules for the claim page (mint/ui.js) and the studio (mint/studio.js).
// Safety: LIVE + LIVE_LIMIT cap real writes (owner's first test = 3 videos). Real writes also need the wallet to pin
// [2,'bvideox records'] to bvideox.com (getVersion().pinnedProtocols >= PIN_VERSION, or a "+pN" version suffix) and
// the premium payee set on the server. Any check failing = the page refuses to write.
import * as R from './records.js';

export const LIVE = true;
export const LIVE_LIMIT = 3;

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
export const videosN = (n) => `${n} video${n === 1 ? '' : 's'}`;
export const txN = (n) => `${n} transaction${n === 1 ? '' : 's'}`;
export const money = (sats, cfg) => {
  if (!cfg.usdPerBsv) return `${sats.toLocaleString()} sats`;
  const usd = (sats / 1e8) * cfg.usdPerBsv, gbp = cfg.usdPerGbp ? usd / cfg.usdPerGbp : null;
  if (gbp == null) return usd < 0.001 ? 'under $0.001' : `$${usd.toFixed(3)}`;
  const p = gbp * 100;
  return p < 0.1 ? 'under 0.1p' : p < 10 ? `${p.toFixed(1).replace(/\.0$/, '')}p` : p < 100 ? `${Math.round(p)}p` : `£${gbp.toFixed(2)}`;
};

/** Videos this identity has minted for this channel (outpoints), kept on this device. */
export const doneKey = (channelId, key) => `bvx-mint-${channelId}-${key}`;
export const doneFor = (channelId, key) => ls.get(doneKey(channelId, key)) || {};

/** Fresh config + live rates. Null (no quote, no writes) when either rate is missing. */
export async function loadCfg(channelId) {
  const c = await fetch('/api/mint/config?channel_id=' + encodeURIComponent(channelId), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!c || !c.usdPerBsv || !c.usdPerGbp) return null;
  return { ...c, gbpPerItem: c.premiumGbpPerItem, satPerKb: c.feeSatPerKb };
}

/** Does the wallet keep bvideox records locked to this site? -> { ok, seen } */
export async function pinCheck(w) {
  try {
    const v = await w.getVersion({});
    // Pin level from the field, or from a `+pN` version suffix (bwallet #64: the connect binary wire carries only `version`).
    const m = v && typeof v.version === 'string' ? v.version.match(/\+p(\d+)\b/) : null;
    const lock = Math.max(Number(v && v.pinnedProtocols) || 0, m ? Number(m[1]) : 0);
    return { ok: lock >= R.PIN_VERSION, seen: `${(v && v.version) || 'unknown version'}${lock ? `, lock v${lock}` : ', no lock'}` };
  } catch (e) { return { ok: false, seen: `no answer (${(e && e.message) || 'error'})` }; }
}

/** Why a real write is refused right now, or null. */
export function liveBlock({ cfg, key, walletKey, pinned, seen, doneCount }) {
  if (!LIVE) return 'Real minting is off. Dry run only.';
  if (!cfg) return 'Prices are still loading.';
  if (!cfg.claim) return "We couldn't check the claim just now. Try again in a minute.";
  if (!cfg.claim.claimed || cfg.claim.identityKey !== key) return 'Only the bWalletX this channel is claimed to can mint.';
  if (walletKey && walletKey !== key) return 'The wallet in this browser is a different identity from the one signed in. Reconnect bWalletX.';
  if (pinned === false) return `Your bWalletX needs an update that keeps these records locked to bvideox.com (the connected wallet reports: ${seen}). Reload your wallet, or use web.bwalletx.com, then reconnect.`;
  if (!cfg.payee) return 'Real minting opens shortly (payments are being set up). Dry run works now.';
  if (doneCount >= LIVE_LIMIT) return `Test run done: ${LIVE_LIMIT} videos minted. The rest open after we check them.`;
  return null;
}

/** "Your wallet said no" etc., in plain words. */
export const friendly = (e) => /denied|declin|reject|cancel|permission/i.test(String(e?.message)) ? 'Your wallet said no, so nothing was written. Try again when you’re ready.'
  : e?.code === 'NOT_FOUND' ? 'Your wallet is not connected in this browser any more. Press Connect bWalletX, then try again.'
  : (e?.message || 'It stopped. Try again: it carries on from the last saved batch.');
