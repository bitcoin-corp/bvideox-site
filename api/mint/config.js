// GET /api/mint/config?channel_id=UC… -> what the mint step needs, fresh (no CDN cache):
//   { payee, premiumGbpPerItem, perTx, feeSatPerKb, usdPerBsv, usdPerGbp, claim: {claimed, identityKey, claimedAt} }
// payee is the bCorp receive address for b's premium, from BVIDEOX_PREMIUM_ADDRESS (Vercel env, never in source).
// While it is unset, payee is null and the page refuses to write (fails safe).
import { REGISTRY, rates } from '../_channels.js';
import { claimState } from '../claim/_claim.js';

export default async function handler(req, res) {
  const id = String(req.query?.channel_id || '');
  if (!/^UC[\w-]{22}$/.test(id)) return res.status(400).json({ error: 'Give a YouTube channel id' });
  const m = REGISTRY.mint;
  const addr = (process.env.BVIDEOX_PREMIUM_ADDRESS || '').trim();
  const [r, claim] = await Promise.all([rates(), claimState('youtube', id, 2500)]);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    payee: /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr) ? addr : null,
    premiumGbpPerItem: m.premiumGbpPerItem, perTx: m.perTx, feeSatPerKb: m.feeSatPerKb, ...r, claim,
  });
}
