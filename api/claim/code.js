// POST /api/claim/code { handle } -> { code, channelId, name, handle, expiresAt, studioUrl }
// Step 2 of the code claim: resolve the channel, then issue a short code bound to this wallet's identity key
// and the channel id (HMAC, CLAIMS_HMAC_SECRET, 30 minutes). The ticket rides back in an HttpOnly cookie.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { codeEnabled, claimsSecret, secret, cookie } from './_claim.js';
import { issueCode, CODE_TTL } from './_code.js';
import { body } from '../bwalletx/_auth.js';
import { resolveHandle, limited } from '../_channels.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!codeEnabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  if (limited(req, 12)) return res.status(429).json({ error: 'Too many tries. Wait a minute, then try again.' });
  const s = await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: secret() });
  const identityKey = s?.sub || null;
  if (!identityKey) return res.status(401).json({ error: 'Connect bWalletX first, so the code is tied to your wallet.', code: 'wallet' });
  const b = await body(req);
  const input = String(b.handle || '').trim().slice(0, 200);
  if (!input) return res.status(400).json({ error: 'Enter your channel handle, like @YourHandle, or its link.' });
  const ch = await resolveHandle(input).catch(() => null);
  if (!ch?.channelId) return res.status(404).json({ error: "We couldn't find that channel on YouTube. Check the handle and try again." });
  const { code, ticket, expiresAt } = issueCode(claimsSecret(), { identityKey, channelId: ch.channelId });
  res.setHeader('Set-Cookie', cookie('bvx_code', ticket, Math.floor(CODE_TTL / 1000)));
  return res.status(200).json({
    code, expiresAt, channelId: ch.channelId, handle: ch.handle || null, name: ch.displayName || null,
    studioUrl: `https://studio.youtube.com/channel/${ch.channelId}/editing/profile`,
  });
}
