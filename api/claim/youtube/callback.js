// GET /api/claim/youtube/callback?code&state -> exchange code, list the signed-in user's channels (mine=true),
// and accept only if one of them is the channel being claimed. The Google token is used once and dropped.
import { createHash } from 'node:crypto';
import { enabled, REDIRECT, cookie, read, seal, open, secret, maskEmail } from '../_claim.js';

const idClaims = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };

const back = (res, slug, q) => res.writeHead(302, { Location: `/c/${encodeURIComponent(slug || '')}/claim?${q}`, 'Set-Cookie': cookie('bvx_oauth', '', 0) }).end();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  const st = open(secret(), read(req, 'bvx_oauth'));
  if (!st || st.exp < Date.now() || st.state !== req.query?.state) return back(res, st?.slug, 'error=state');
  // Google sends ?error=access_denied both when the user says no and when the app is in testing and the account isn't a test user.
  if (req.query?.error) return back(res, st.slug, `error=${req.query.error === 'access_denied' ? 'denied' : 'google'}`);
  if (!req.query?.code) return back(res, st.slug, 'error=denied');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT(), grant_type: 'authorization_code' }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return back(res, st.slug, 'error=token');
  const who = idClaims(tok.id_token);
  const mine = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50', { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.access_token)}`, { method: 'POST' }).catch(() => {});
  if (mine.error) return back(res, st.slug, `error=${mine.error.code === 403 ? 'scope' : 'youtube'}`);
  const ids = (mine.items || []).map((i) => i.id);
  if (!ids.length) return back(res, st.slug, 'error=no-channel');
  if (!ids.includes(st.id)) return back(res, st.slug, 'error=not-owner');
  const proof = seal(secret(), { kind: 'youtube', slug: st.slug, channelId: st.id, verifiedAt: Date.now(), subHash: who.sub ? createHash('sha256').update('google:' + who.sub).digest('hex') : null, email: maskEmail(who.email), exp: Date.now() + 600_000 });
  res.writeHead(302, { Location: `/c/${encodeURIComponent(st.slug)}/claim?verified=1`, 'Set-Cookie': [cookie('bvx_oauth', '', 0), cookie('bvx_claim', proof, 600)] }).end();
}
