// GET  /api/claim/bind -> { verified: {slug, channelId} | null, identityKey }
// POST /api/claim/bind -> pairs the verified YouTube proof with the bWalletX session (identity key) and returns
// the binding record the wallet signs. Persisting it (and activating the held paymail) is bit-sign's job: see
// /Volumes/2026/Projects/CLAIMABLE-CHANNELS-SPEC.md. Not stored here.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { enabled, read, open, secret } from './_claim.js';
import { findChannel } from '../_channels.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  const proof = open(secret(), read(req, 'bvx_claim'));
  const ok = proof && proof.exp > Date.now() ? proof : null;
  const s = await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: secret() });
  const identityKey = s?.sub || null;
  if (req.method !== 'POST') return res.status(200).json({ verified: ok && { slug: ok.slug, channelId: ok.channelId, email: ok.email || null }, identityKey });
  if (!ok) return res.status(401).json({ error: 'Prove the channel is yours first (Google step)' });
  if (!identityKey) return res.status(401).json({ error: 'Connect bWalletX first' });
  const c = findChannel(ok.slug);
  const binding = {
    type: 'bvideox.channel-claim/v1', platform: 'youtube', channelId: ok.channelId, slug: ok.slug,
    heldPaymail: c?.channelId === ok.channelId ? c.heldPaymail : null,
    identityKey, verifiedAt: new Date(ok.verifiedAt).toISOString(),
  };
  return res.status(200).json({ binding, message: JSON.stringify(binding), persisted: false });
}
