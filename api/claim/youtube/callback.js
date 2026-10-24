// GET /api/claim/youtube/callback?code&state -> exchange code, list the signed-in user's channels (mine=true),
// and accept only if one of them is the channel being claimed. The Google token is used once and dropped.
import { enabled, REDIRECT, cookie, read, seal, open, secret } from '../_claim.js';

const back = (res, slug, q) => res.writeHead(302, { Location: `/c/${encodeURIComponent(slug || '')}/claim?${q}`, 'Set-Cookie': cookie('bvx_oauth', '', 0) }).end();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  const st = open(secret(), read(req, 'bvx_oauth'));
  if (!st || st.exp < Date.now() || st.state !== req.query?.state) return back(res, st?.slug, 'error=state');
  if (!req.query?.code) return back(res, st.slug, 'error=denied');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT(), grant_type: 'authorization_code' }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return back(res, st.slug, 'error=token');
  const mine = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50', { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.access_token)}`, { method: 'POST' }).catch(() => {});
  const ids = (mine.items || []).map((i) => i.id);
  if (!ids.includes(st.id)) return back(res, st.slug, 'error=not-owner');
  const proof = seal(secret(), { kind: 'youtube', slug: st.slug, channelId: st.id, verifiedAt: Date.now(), exp: Date.now() + 1_800_000 });
  res.writeHead(302, { Location: `/c/${encodeURIComponent(st.slug)}/claim?verified=1`, 'Set-Cookie': [cookie('bvx_oauth', '', 0), cookie('bvx_claim', proof, 1800)] }).end();
}
