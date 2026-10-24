// Studios: one per bWalletX identity, at bvideox.com/u/<username>.
// - The wallet's paymail comes from the bWalletX paymail server (public, read-only):
//     GET pay.bwallet.space/api/paymail/lookup?key=<identityKey> -> { paymail, alias, names }
//     GET pay.bwallet.space/api/paymail/id/<alias>@bwalletx.com   -> { pubkey }   (alias -> key)
//     GET pay.bwallet.space/api/paymail/profile/<paymail>          -> { name, avatar }
// - A chosen username / custom domain lives on the bWalletX push server (bitcoin-corp/bwalletx-push,
//   /v1/studios, wallet-signed). Until that endpoint is deployed, every studio uses its paymail alias as
//   its username and saving a new one says "Coming".
import { CLAIMS_API } from '../claim/_claim.js';

export const PAYMAIL_API = () => (process.env.PAYMAIL_API || 'https://pay.bwallet.space/api/paymail').replace(/\/$/, '');
export const PAYMAIL_DOMAIN = 'bwalletx.com';
export const KEY_RE = /^0[23][0-9a-f]{64}$/;
export const NAME_RE = /^[a-z0-9][a-z0-9_.-]{1,39}$/; // what a /u/<name> can look like (paymail aliases may contain '.')

const get = async (url, ms = 2500) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch { return { status: 0, json: null }; }
};

/** The wallet's main paymail and display details, or null when it has none (or the server is down). */
export async function paymailFor(identityKey) {
  const l = await get(`${PAYMAIL_API()}/lookup?key=${identityKey}`);
  if (l.status !== 200 || !l.json?.alias) return null;
  const paymail = String(l.json.paymail || `${l.json.alias}@${PAYMAIL_DOMAIN}`);
  const p = await get(`${PAYMAIL_API()}/profile/${encodeURIComponent(paymail)}`);
  return { paymail, alias: String(l.json.alias), name: p.json?.name || null, avatar: p.json?.avatar || null };
}

/** alias -> identity key, via the paymail's public key. */
export async function keyForAlias(alias) {
  const r = await get(`${PAYMAIL_API()}/id/${encodeURIComponent(alias)}@${PAYMAIL_DOMAIN}`);
  const k = String(r.json?.pubkey || '').toLowerCase();
  return KEY_RE.test(k) ? k : null;
}

/** The push server's studio record. { live:false } when the endpoint isn't deployed yet. */
export async function studioBy(q) {
  const r = await get(`${CLAIMS_API()}/v1/studios?${new URLSearchParams(q)}`);
  if (r.status === 200 && r.json) return { live: true, studio: r.json };
  // A deployed endpoint answers "not found" in JSON; an undeployed route is the server's plain-text 404.
  if (r.status === 404 && r.json) return { live: true, studio: null };
  return { live: false, studio: null };
}

/** Channels this identity has claimed (push /v1/claims). */
export async function claimsFor(identityKey) {
  const r = await get(`${CLAIMS_API()}/v1/claims?identity_key=${identityKey}`);
  return Array.isArray(r.json?.claims) ? r.json.claims : [];
}

/** What a studio shows, for a username or an identity key. Null when nobody has that name. */
export async function loadStudio({ name, identityKey }) {
  let key = identityKey || null, saved = null, live = false;
  if (!key && name) {
    const s = await studioBy({ name });
    live = s.live;
    if (s.studio?.identityKey) { key = s.studio.identityKey; saved = s.studio; }
    else key = await keyForAlias(name);
  }
  if (!key) return null;
  if (!saved) { const s = await studioBy({ identity_key: key }); live = live || s.live; saved = s.studio?.username ? s.studio : null; }
  const [pm, claims] = await Promise.all([paymailFor(key), claimsFor(key)]);
  const username = saved?.username || pm?.alias || null;
  return {
    identityKey: key,
    paymail: pm?.paymail || null, alias: pm?.alias || null, displayName: pm?.name || null, avatar: pm?.avatar || null,
    username, usernameSaved: !!saved?.username, domain: saved?.domain || null,
    settingsLive: live,
    claims: claims.map((c) => ({ platform: c.platform, channelId: c.channelId, slug: c.slug || null, claimedAt: c.claimedAt })),
  };
}
