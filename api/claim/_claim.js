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

/** r•••@gmail.com */
export const maskEmail = (e) => { const m = /^([^@])[^@]*@(.+)$/.exec(String(e || '')); return m ? `${m[1]}•••@${m[2]}` : null; };
