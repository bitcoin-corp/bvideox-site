// POST /api/studio/settings { username, domain, timestamp, signature }
// Forwards to the push server (POST /v1/studios), which checks the wallet's BRC-100 signature over
//   "bvideox studio <identityKey> <username> <domain|-> <timestamp>"  (protocol [2,'bvideox studio'], keyID 'settings')
// so only the key holder can name a studio. The identity key comes from the signed-in session, never the body.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { body, originOk, secret } from '../bwalletx/_auth.js';
import { CLAIMS_API } from '../claim/_claim.js';

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Wrong origin.' });
  const s = secret();
  const me = s ? (await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: s }))?.sub || null : null;
  if (!me) return res.status(401).json({ error: 'Connect bWalletX first.' });
  const b = await body(req);
  const username = String(b.username || '').trim().toLowerCase();
  const domain = b.domain ? String(b.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Use 3 to 30 letters, numbers, - or _. Start with a letter or number.' });
  if (domain && !DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'That doesn’t look like a domain. Try something like videos.example.com.' });
  if (!Array.isArray(b.signature) || !Number.isInteger(b.timestamp)) return res.status(400).json({ error: 'Sign with your wallet first.' });
  let r, j;
  try {
    r = await fetch(`${CLAIMS_API()}/v1/studios`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identityKey: me, username, domain, timestamp: b.timestamp, signature: b.signature }),
      signal: AbortSignal.timeout(8000),
    });
    j = await r.json().catch(() => null);
  } catch { return res.status(502).json({ error: 'Could not reach the server. Try again shortly.' }); }
  // Not deployed yet: plain 404 / 405 from the push server.
  if (!j && (r.status === 404 || r.status === 405)) return res.status(503).json({ error: 'Saving your own name opens shortly. Your studio uses your paymail name until then.', coming: true });
  if (!r.ok) return res.status(r.status === 409 ? 409 : r.status === 400 ? 400 : r.status === 401 ? 401 : 502).json({ error: j?.error || 'That was not saved.' });
  return res.status(200).json(j);
}
