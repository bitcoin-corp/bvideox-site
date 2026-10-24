// GET /api/studio/profile?name=<username>  -> a public studio (anyone)
// GET /api/studio/profile?me=1             -> the signed-in wallet's own studio
//   -> { studio: {paymail, alias, displayName, avatar, username, usernameSaved, domain, settingsLive, claims[]},
//        isOwner, signedIn }
// The identity key is never shown in the page's main UI; it is returned only so the owner's page can check
// that the wallet in the browser is the same one.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { secret } from '../bwalletx/_auth.js';
import { loadStudio, NAME_RE } from './_studio.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = secret();
  const me = s ? (await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: s }))?.sub || null : null;
  let studio = null;
  if (req.query?.me) {
    if (!me) return res.status(200).json({ studio: null, signedIn: false, isOwner: false });
    studio = await loadStudio({ identityKey: me });
  } else {
    const name = String(req.query?.name || '').toLowerCase().replace(/^[$@]/, '');
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'That is not a studio name.' });
    studio = await loadStudio({ name });
    if (!studio) return res.status(404).json({ error: 'No studio has that name yet.', signedIn: !!me });
  }
  const isOwner = !!(me && studio && studio.identityKey === me);
  return res.status(200).json({ studio, signedIn: !!me, isOwner });
}
