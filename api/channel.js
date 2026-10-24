// GET /api/channel?slug=bsvdata   -> registry channel
// GET /api/channel?handle=@Name   -> any YouTube channel, resolved on the fly (unclaimed, noindex)
// Returns registry entry + YouTube public data + mint quote. Cached at the CDN; rate-limited per IP.
import { claimState } from './claim/_claim.js';
import { findChannel, channelData, mintQuote, mintRecord, resolveHandle, adHoc, limited } from './_channels.js';

export default async function handler(req, res) {
  let c = findChannel(req.query?.slug);
  if (!c) {
    const raw = String(req.query?.handle || req.query?.slug || '');
    if (!raw) return res.status(400).json({ error: 'Give a slug or a YouTube handle' });
    if (limited(req)) return res.status(429).json({ error: 'Too many lookups. Try again in a minute.' });
    const r = await resolveHandle(raw).catch(() => null);
    if (!r) { res.setHeader('Cache-Control', 'public, s-maxage=300'); return res.status(404).json({ error: 'No YouTube channel found for that handle' }); }
    c = findChannel(r.handle?.slice(1)) || registryById(r.channelId) || adHoc(r, r.handle ? r.handle.slice(1).toLowerCase() : r.channelId);
  }
  const d = await channelData(c);
  const [quote, cl] = await Promise.all([mintQuote(d.videos), claimState('youtube', c.channelId)]);
  if (cl?.claimed) c = { ...c, status: 'claimed', claimedAt: cl.claimedAt };
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  return res.status(200).json({
    channel: { ...c, payable: false /* TODO(paymail): true once the paymail server activates the held paymail (spec §5/§6) */, name: d.name, avatar: d.avatar, total: d.total ?? null, index: !c.adHoc || c.status === 'claimed' },
    videos: d.videos.map((v) => ({ ...v, sha256: mintRecord(c, v).sha256 })),
    source: d.source,
    complete: d.source === 'youtube-api' || (d.total != null && d.videos.length >= d.total),
    quote,
  });
}
import { REGISTRY } from './_channels.js';
const registryById = (id) => REGISTRY.channels.find((x) => x.channelId === id) || null;
