// GET /api/claim/youtube/start?slug=bsvdata&id=UC… -> redirect to Google consent (read-only YouTube scope)
// GET /api/claim/youtube/start?studio=1          -> same, from the studio: link whichever channel the account owns
import { randomBytes } from 'node:crypto';
import { googleEnabled as enabled, REDIRECT, SCOPE, cookie, seal, secret } from '../_claim.js';

export default function handler(req, res) {
  if (!enabled()) return res.status(503).json({ error: 'Claiming is coming soon', coming: true });
  if (req.query?.studio) {
    const state = randomBytes(18).toString('base64url');
    res.setHeader('Set-Cookie', cookie('bvx_oauth', seal(secret(), { state, studio: true, exp: Date.now() + 600_000 }), 600));
    return res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${consent(state)}` }).end();
  }
  const slug = String(req.query?.slug || '').toLowerCase().replace(/[^\w.-]/g, '').slice(0, 40);
  const id = String(req.query?.id || '');
  if (!slug || !/^UC[\w-]{22}$/.test(id)) return res.status(400).json({ error: 'Bad channel' });
  const state = randomBytes(18).toString('base64url');
  res.setHeader('Set-Cookie', cookie('bvx_oauth', seal(secret(), { state, slug, id, exp: Date.now() + 600_000 }), 600));
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${consent(state)}` }).end();
}
const consent = (state) => new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT(), response_type: 'code', scope: SCOPE, state, access_type: 'online', prompt: 'select_account consent', include_granted_scopes: 'false' });
