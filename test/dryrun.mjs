// Dry run of the bVideoX mint with a throwaway ProtoWallet: encrypt, build batches, read back, make one public.
// Nothing is broadcast (createAction is a trap that throws). Usage: node test/dryrun.mjs [slug]
import { PrivateKey, ProtoWallet } from '@bsv/sdk';
import * as R from '../mint/records.js';

const slug = process.argv[2] || 'bo4se';
const j = await (await fetch(`https://bvideox.com/api/channel?slug=${slug}`)).json();
const usdPerBsv = j.quote.usdPerBsv;
const fx = await (await fetch('https://api.frankfurter.app/latest?from=GBP&to=USD')).json().catch(() => null);
const usdPerGbp = fx?.rates?.USD || 1.3;
const pw = new ProtoWallet(PrivateKey.fromRandom());
const wallet = { encrypt: (a) => pw.encrypt(a), decrypt: (a) => pw.decrypt(a), getPublicKey: (a) => pw.getPublicKey(a), createSignature: (a) => pw.createSignature(a),
  createAction: () => { throw new Error('createAction called in a dry run'); } };
const payeeScript = await R.p2pkhScriptFor(PrivateKey.fromRandom().toAddress()); // throwaway payee: dry run, never paid
const opts = { satPerKb: j.quote.feeSatPerKb, gbpPerItem: 0.01, usdPerBsv, usdPerGbp };
const p = await R.plan(j.channel, j.videos, opts);
const done = {}; let builtBytes = 0, scripts = [];
await R.runMint({ wallet, channel: j.channel, videos: j.videos, dryRun: true, payeeScript, premiumSatsPerItem: p.premiumSatsPerItem,
  onDry: (b) => { for (const o of b.outputs) builtBytes += 8 + 1 + (o.lockingScript.length / 2 >= 0xfd ? 2 : 0) + o.lockingScript.length / 2; },
  onBatch: (es) => { for (const e of es) { done[e.videoId] = e.outpoint; scripts.push(e); } } });
// resumable: running again does nothing
let again = 0; await R.runMint({ wallet, channel: j.channel, videos: j.videos, dryRun: true, done, onBatch: (es) => { again += es.length; } });
let ok = 0;
for (const e of scripts) { const r = await R.openRecord(wallet, e.script); if (r.record.videoId === e.videoId && await R.checkRecord(r.record)) ok++; }
// other key can't open
const other = new ProtoWallet(PrivateKey.fromRandom());
let leak = 0; try { await R.openRecord(other, scripts[0].script); leak = 1; } catch {}
const first = await R.openRecord(wallet, scripts[0].script);
const pub = await R.publicScript(wallet, first.record, first.kid, scripts[0].outpoint);
const sats = (n) => `${n} sats ($${(n / 1e8 * usdPerBsv).toFixed(4)}, £${(n / 1e8 * usdPerBsv / usdPerGbp).toFixed(4)})`;
console.log({ videos: j.videos.length, txs: p.txs, batches: p.batches.map((b) => b.length), estBytes: p.bytes, builtOutputBytes: builtBytes,
  fee: sats(p.feeSats), premiumPerItem: sats(p.premiumSatsPerItem), premium: sats(p.premiumSats), total: sats(p.totalSats),
  decryptedOk: ok, resumedAgain: again, otherKeyOpened: leak, publicScriptBytes: pub.length / 2, usdPerBsv, usdPerGbp });
const t3 = await R.plan(j.channel, j.videos.slice(0, 3), opts);
console.log('LIVE_LIMIT 3:', { txs: t3.txs, bytes: t3.bytes, fee: sats(t3.feeSats), premium: sats(t3.premiumSats), total: sats(t3.totalSats) });
