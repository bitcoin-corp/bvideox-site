// GET  /api/claim/bind -> { verified: {slug, channelId, email, verifiedAt} | null, identityKey, claim }
// POST /api/claim/bind { timestamp, signature } -> forwards to the push server (POST /v1/claims), which checks
// the wallet's BRC-100 signature over "bvideox claim youtube <channelId> <identityKey> <timestamp>" and stores
// the binding. The held paymail stays non-payable until the paymail server activates it (spec §5/§6).
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { enabled, read, open, secret, claimsSecret, sealClaim, CLAIMS_API, claimState } from './_claim.js';
import { body } from '../bwalletx/_auth.js';
import { findChannel } from '../_channels.js';

const TEN_MIN = 600_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  const proof = open(secret(), read(req, 'bvx_claim'));
  const ok = proof && proof.exp > Date.now() ? proof : null;
  const s = await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: secret() });
  const identityKey = s?.sub || null;
  if (req.method !== 'POST') {
    const claim = ok ? await claimState('youtube', ok.channelId) : null;
    return res.status(200).json({ verified: ok && { slug: ok.slug, channelId: ok.channelId, email: ok.email || null, verifiedAt: ok.verifiedAt }, identityKey, claim });
  }
  if (!ok) return res.status(401).json({ error: 'Prove the channel is yours first (Google step)', code: 'reverify' });
  if (!identityKey) return res.status(401).json({ error: 'Connect bWalletX first' });
  if (Date.now() - ok.verifiedAt > TEN_MIN || !ok.subHash) return res.status(401).json({ error: 'Your Google check is more than 10 minutes old. Sign in with Google again, then bind.', code: 'reverify' });
  const key = claimsSecret();
  if (!key) return res.status(503).json({ error: 'Saving claims is not switched on yet.' });
  const b = await body(req);
  const c = findChannel(ok.slug);
  const token = sealClaim(key, {
    site: 'bvideox.com', platform: 'youtube', channelId: ok.channelId, slug: ok.slug,
    heldPaymail: c?.channelId === ok.channelId ? c.heldPaymail || null : null,
    identityKey, subHash: ok.subHash, verifiedAt: ok.verifiedAt,
  });
  let r, j;
  try {
    r = await fetch(`${CLAIMS_API()}/v1/claims`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof: token, timestamp: Number(b.timestamp), signature: b.signature }), signal: AbortSignal.timeout(8000) });
    j = await r.json().catch(() => ({}));
  } catch { return res.status(502).json({ error: 'Could not reach the claims server. Try again shortly.' }); }
  if (r.status === 409) return res.status(409).json({ error: 'This channel is already claimed by another wallet. If it is yours, ask for a dispute review in Ask b.', dispute: true });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ error: j.error || 'The claim was not accepted.', code: j.expired ? 'reverify' : undefined });
  return res.status(200).json({ ...j, persisted: true });
}
