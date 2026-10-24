// Prove a YouTube channel with a pasted code instead of Google sign-in (no sensitive scope, no "unverified app").
// The server issues a short code bound to (wallet identity key, channel id, issue time) with HMAC over
// CLAIMS_HMAC_SECRET. The owner pastes it in the channel description; /api/claim/code/check reads the public
// description with YOUTUBE_API_KEY and, if the code is there, seals the same proof the Google path seals.
// A code copied from someone's description is useless to anyone else: it recomputes only for that key + channel.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CODE_TTL = 30 * 60_000;
const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/o/1/l/i: easy to read back
const mac = (s, ...parts) => createHmac('sha256', s).update(['bvideox claim code v1', ...parts].join('\n')).digest();

/** The code shown to the user: bvx-xxxxxxxx (8 chars from the HMAC, ~40 bits). */
export function codeFor(s, identityKey, channelId, issuedAt) {
  const d = mac(s, 'code', identityKey, channelId, String(issuedAt));
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHA[d[i] % ALPHA.length];
  return 'bvx-' + out;
}

/** Issue a code plus a ticket the browser carries back (channelId.issuedAt.mac). Nothing is stored. */
export function issueCode(s, { identityKey, channelId, now = Date.now() }) {
  if (!s || !identityKey || !/^UC[\w-]{22}$/.test(String(channelId))) throw new Error('bad input');
  const sig = mac(s, 'ticket', identityKey, channelId, String(now)).toString('base64url');
  return { code: codeFor(s, identityKey, channelId, now), ticket: `${channelId}.${now}.${sig}`, expiresAt: now + CODE_TTL };
}

/** Check a ticket for this wallet. Returns { ok, code, channelId, issuedAt } or { ok:false, reason }. */
export function openTicket(s, ticket, identityKey, now = Date.now()) {
  const [channelId, t, sig] = String(ticket || '').split('.');
  const issuedAt = Number(t);
  if (!s || !identityKey || !/^UC[\w-]{22}$/.test(channelId || '') || !Number.isFinite(issuedAt) || !sig) return { ok: false, reason: 'bad' };
  const want = mac(s, 'ticket', identityKey, channelId, String(issuedAt));
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad' };
  if (issuedAt > now + 60_000 || now - issuedAt > CODE_TTL) return { ok: false, reason: 'expired' };
  return { ok: true, channelId, issuedAt, code: codeFor(s, identityKey, channelId, issuedAt) };
}

/** Full check: ticket valid for this key and channel, and the code appears in the description text. */
export function verifyCode(s, { ticket, identityKey, channelId, description, now = Date.now() }) {
  const t = openTicket(s, ticket, identityKey, now);
  if (!t.ok) return t;
  if (channelId && t.channelId !== channelId) return { ok: false, reason: 'channel' };
  if (!String(description || '').toLowerCase().includes(t.code)) return { ok: false, reason: 'missing', code: t.code };
  return { ok: true, channelId: t.channelId, code: t.code, issuedAt: t.issuedAt };
}
