// GET /api/claim/youtube/callback?code&state -> exchange code, list the signed-in user's channels (mine=true),
// and accept only if one of them is the channel being claimed. The Google token is used once and dropped.
import { createHash } from 'node:crypto';
import { enabled, REDIRECT, cookie, read, seal, open, secret, maskEmail } from '../_claim.js';

const idClaims = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };

const studioBack = (res, q, extra = []) => res.writeHead(302, { Location: `/studio?${q}#youtube`, 'Set-Cookie': [cookie('bvx_oauth', '', 0), ...extra] }).end();
const back = (res, slug, q) => res.writeHead(302, { Location: `/c/${encodeURIComponent(slug || '')}/claim?${q}`, 'Set-Cookie': cookie('bvx_oauth', '', 0) }).end();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  const st = open(secret(), read(req, 'bvx_oauth'));
  if (!st || st.exp < Date.now() || st.state !== req.query?.state) return st?.studio ? studioBack(res, 'yt=state') : back(res, st?.slug, 'error=state');
  if (st.studio) return studio(req, res);
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

// Studio: link whichever channel this Google account owns. Same checks and the same sealed proof as a claim,
// then /studio asks the wallet to sign the bind (POST /api/claim/bind).
async function studio(req, res) {
  if (req.query?.error) return studioBack(res, `yt=${req.query.error === 'access_denied' ? 'denied' : 'google'}`);
  if (!req.query?.code) return studioBack(res, 'yt=denied');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT(), grant_type: 'authorization_code' }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return studioBack(res, 'yt=token');
  const who = idClaims(tok.id_token);
  const mine = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics,status&mine=true&maxResults=50', { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.access_token)}`, { method: 'POST' }).catch(() => {});
  if (mine.error) return studioBack(res, `yt=${mine.error.code === 403 ? 'scope' : 'youtube'}`);
  const it = (mine.items || [])[0];
  if (!it) return studioBack(res, 'yt=no-channel');
  const handle = String(it.snippet?.customUrl || '').replace(/^@/, '').toLowerCase().replace(/[^\w.-]/g, '').slice(0, 40);
  const slug = handle || it.id;
  const hidden = it.statistics?.hiddenSubscriberCount === true;
  const videos = Number(it.statistics?.videoCount) || 0;
  const proof = seal(secret(), { kind: 'youtube', studio: true, slug, channelId: it.id, name: String(it.snippet?.title || '').slice(0, 100), verifiedAt: Date.now(), subHash: who.sub ? createHash('sha256').update('google:' + who.sub).digest('hex') : null, email: maskEmail(who.email), exp: Date.now() + 600_000 });
  const q = new URLSearchParams({ linked: '1' });
  if (!videos) q.set('hint', 'no-videos'); else if (it.status?.privacyStatus && it.status.privacyStatus !== 'public') q.set('hint', 'private');
  if ((mine.items || []).length > 1) q.set('many', String(mine.items.length));
  if (hidden) q.set('subs', 'hidden');
  return studioBack(res, q.toString(), [cookie('bvx_claim', proof, 600)]);
}
