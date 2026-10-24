// YouTube channel claim: Google OAuth (youtube.readonly) -> channels.list mine=true -> compare channel id.
// Off unless CLAIM_YOUTUBE=on and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / BWALLETX_SESSION_SECRET exist.
// Nothing is stored here (bvideox has no DB): a verified claim is sealed into a short-lived HttpOnly cookie,
// and /api/claim/bind pairs it with the bWalletX session. Persisting the binding is the bit-sign server's job.
import { seal, open, secret, ORIGIN } from '../bwalletx/_auth.js';

export const enabled = () => process.env.CLAIM_YOUTUBE === 'on' && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET && !!secret();
export const REDIRECT = () => `${ORIGIN}/api/claim/youtube/callback`;
export const SCOPE = 'openid email https://www.googleapis.com/auth/youtube.readonly';
export const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${ORIGIN.startsWith('https') ? '; Secure' : ''}`;
export const read = (req, name) => (String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '=')) || '').slice(name.length + 1);
export { seal, open, secret };

// The binding is stored on the bWalletX push server (bitcoin-corp/bwalletx-push, POST/GET /v1/claims).
// bvideox seals the passed ownership check with CLAIMS_HMAC_SECRET (shared with push only) and forwards it
// with the wallet's signature. Env: CLAIMS_HMAC_SECRET (32+ chars), CLAIMS_API (default push.bwalletx.com).
import { createHmac } from 'node:crypto';
export const CLAIMS_API = () => (process.env.CLAIMS_API || 'https://push.bwalletx.com').replace(/\/$/, '');
export const claimsSecret = () => { const s = process.env.CLAIMS_HMAC_SECRET || ''; return s.length >= 32 ? s : null; };
export function sealClaim(s, p) {
  const body = Buffer.from(JSON.stringify({ aud: 'bwalletx-push/claims/v1', ...p }), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', s).update(body).digest('hex')}`;
}
/** Live claim state from push: { claimed, identityKey?, claimedAt? }, or null when push can't be reached. */
export async function claimState(platform, channelId, ms = 1500) {
  if (!channelId) return null;
  try {
    const r = await fetch(`${CLAIMS_API()}/v1/claims?platform=${encodeURIComponent(platform)}&channel_id=${encodeURIComponent(channelId)}`, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
/** r•••@gmail.com */
export const maskEmail = (e) => { const m = /^([^@])[^@]*@(.+)$/.exec(String(e || '')); return m ? `${m[1]}•••@${m[2]}` : null; };
