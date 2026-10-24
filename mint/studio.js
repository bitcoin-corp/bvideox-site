// Studio minting: one video, a picked few, or the whole channel. Same records, same rules and the same
// on-device progress as the claim page (mint/core.js), so a video minted in either place shows as minted in both.
import * as R from './records.js';
import { LIVE_LIMIT, ls, doneKey, doneFor, loadCfg, pinCheck, liveBlock, money, videosN, txN, friendly } from './core.js';

export { LIVE_LIMIT, doneFor, money, videosN, txN };

/** Price for these videos (unminted only): { n, text } or null while prices load. */
export async function quote(channel, videos, cfg) {
  if (!cfg || !videos.length) return null;
  const p = await R.plan(channel, videos, cfg);
  return { n: videos.length, p, text: `1p per video + network fee (${money(p.feeSats, cfg)}) = about ${money(p.totalSats, cfg)} for ${videosN(videos.length)}` };
}

export { loadCfg };

/** Why minting can't start right now for this identity (before touching the wallet), or null. */
export function gate(cfg, key, channelId) {
  return liveBlock({ cfg, key, walletKey: null, pinned: null, seen: '', doneCount: Object.keys(doneFor(channelId, key)).length });
}

/**
 * Mint `videos` for `channel` with the connected wallet. Mints up to the live cap and returns
 * { minted, skipped: number left over because of the cap, outpoints }. Throws a plain-words Error otherwise.
 */
export async function mint({ channel, videos, key, onStatus = () => {} }) {
  try {
    const w = await window.bvxWallet();
    const walletKey = (await w.getPublicKey({ identityKey: true })).publicKey;
    const pin = await pinCheck(w);
    const cfg = await loadCfg(channel.channelId);
    const done = doneFor(channel.channelId, key);
    const block = liveBlock({ cfg, key, walletKey, pinned: pin.ok, seen: pin.seen, doneCount: Object.keys(done).length });
    if (block) throw new Error(block);
    const todo = videos.filter((v) => !done[v.id]);
    if (!todo.length) throw new Error('Those videos are already minted.');
    const room = Math.max(0, LIVE_LIMIT - Object.keys(done).length);
    const sel = todo.slice(0, room);
    const p = await R.plan(channel, sel, cfg);
    const payeeScript = await R.p2pkhScriptFor(cfg.payee);
    onStatus('Check your wallet: it asks once to lock your records with your keys, then once per batch to pay.');
    let n = 0;
    await R.runMint({
      wallet: w, channel, videos: sel, dryRun: false, perTx: cfg.perTx || R.PER_TX, payeeScript, premiumSatsPerItem: p.premiumSatsPerItem,
      done,
      onBatch: (es) => {
        const d = doneFor(channel.channelId, key);
        for (const e of es) d[e.videoId] = { outpoint: e.outpoint, kid: e.kid };
        ls.set(doneKey(channel.channelId, key), d);
        n += es.length;
        onStatus(`${n} of ${videosN(sel.length)} written…`);
      },
    });
    return { minted: n, skipped: todo.length - sel.length, cost: money(p.totalSats, cfg), txs: txN(p.txs) };
  } catch (e) {
    throw new Error(friendly(e));
  }
}
