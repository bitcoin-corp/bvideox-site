// POST /api/claim/check -> { verified: { slug, channelId, name } } once the code is in the channel description.
// Reads the PUBLIC description (channels.list part=snippet,brandingSettings, YOUTUBE_API_KEY). On success it
// seals the same short-lived bvx_claim proof the Google path seals; /api/claim/bind then needs the wallet's
// signature, unchanged. Rate-limited per IP and per wallet.
import { createHash } from 'node:crypto';
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { codeEnabled, claimsSecret, secret, cookie, read, seal } from './_claim.js';
import { verifyCode } from './_code.js';
import { limited, REGISTRY } from '../_channels.js';

const perKey = new Map();
const keyLimited = (k, max = 10, windowMs = 60_000) => {
  const now = Date.now(), e = perKey.get(k) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; perKey.set(k, e); if (perKey.size > 5000) perKey.clear();
  return e.n > max;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!codeEnabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  if (limited(req, 15)) return res.status(429).json({ error: 'Too many checks. Wait a minute, then press Check again.' });
  const s = await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: secret() });
  const identityKey = s?.sub || null;
  if (!identityKey) return res.status(401).json({ error: 'Connect bWalletX first.', code: 'wallet' });
  if (keyLimited(identityKey)) return res.status(429).json({ error: 'Too many checks. Wait a minute, then press Check again.' });
  const ticket = read(req, 'bvx_code');
  if (!ticket) return res.status(401).json({ error: 'Your code has run out. Get a new code.', code: 'expired' });
  const channelId = ticket.split('.')[0];
  const yt = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&id=${encodeURIComponent(channelId)}&key=${process.env.YOUTUBE_API_KEY}`, { signal: AbortSignal.timeout(6000) })
    .then((r) => r.json()).catch(() => null);
  const it = yt?.items?.[0];
  if (!it) return res.status(502).json({ error: "YouTube didn't answer. Press Check again in a minute." });
  const description = [it.snippet?.description, it.brandingSettings?.channel?.description].filter(Boolean).join('\n');
  const v = verifyCode(claimsSecret(), { ticket, identityKey, channelId, description });
  if (!v.ok) {
    if (v.reason === 'missing') return res.status(409).json({ error: 'We can’t see the code yet. Saved? It can take a minute; press Check again.', code: 'missing' });
    if (v.reason === 'expired') return res.status(401).json({ error: 'Your code has run out (30 minutes). Get a new code.', code: 'expired' });
    return res.status(401).json({ error: 'That code was made for a different wallet or channel. Get a new code.', code: 'expired' });
  }
  const handle = String(it.snippet?.customUrl || '').replace(/^@/, '').toLowerCase().replace(/[^\w.-]/g, '').slice(0, 40);
  const slug = REGISTRY.channels.find((c) => c.channelId === v.channelId)?.slug || handle || v.channelId;
  const now = Date.now();
  const proof = seal(secret(), {
    kind: 'youtube', method: 'code', studio: true, slug, channelId: v.channelId,
    name: String(it.snippet?.title || '').slice(0, 100), identityKey, verifiedAt: now,
    subHash: createHash('sha256').update(`ytcode:${v.channelId}:${identityKey}`).digest('hex'), exp: now + 600_000,
  });
  res.setHeader('Set-Cookie', [cookie('bvx_code', '', 0), cookie('bvx_claim', proof, 600)]);
  return res.status(200).json({ verified: { method: 'code', slug, channelId: v.channelId, name: it.snippet?.title || null } });
}
