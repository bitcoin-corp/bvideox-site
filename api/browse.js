// GET /api/browse -> the channels people can browse on bVideoX, with a few recent videos each.
// Source: the curated registry (data/channels.json) plus live claim state from the push server. The push server
// also lists the newest claims (GET /v1/claims?recent=1), so every claimed channel shows here. Public and signed-out: no wallet, no cookies.
import { REGISTRY, channelData } from './_channels.js';
import { claimState, CLAIMS_API } from './claim/_claim.js';

const RECENT = 12;

export default async function handler(req, res) {
  const list = REGISTRY.channels.filter((c) => c.status !== 'hidden');
  // Plus every channel claimed on the push server (newest first), not just the curated registry.
  const known = new Set(REGISTRY.channels.map((c) => c.channelId));
  const claimed = await fetch(CLAIMS_API() + '/v1/claims?recent=1&limit=100', { signal: AbortSignal.timeout(2500) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const cl of claimed?.claims || []) {
    if (cl.platform !== 'youtube' || known.has(cl.channelId)) continue;
    known.add(cl.channelId);
    list.push({ slug: cl.slug || cl.channelId, channelId: cl.channelId, platform: 'youtube', status: 'claimed' });
  }
  const rows = await Promise.all(list.map(async (c) => {
    const [d, cl] = await Promise.all([channelData(c).catch(() => null), claimState('youtube', c.channelId)]);
    const videos = (d?.videos || []).slice().sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')));
    return {
      slug: c.slug, name: d?.name || c.displayName, handle: c.handle || null, avatar: d?.avatar || null,
      videoCount: d?.total ?? (videos.length || null), minted: Number.isFinite(c.minted) ? c.minted : null,
      claimed: c.status === 'claimed' || !!cl?.claimed,
      recent: videos.slice(0, RECENT).map((v) => ({ id: v.id, title: v.title, published: v.published || null, dateExact: v.dateExact !== false })),
    };
  }));
  const recent = rows.flatMap((r) => r.recent.map((v) => ({ ...v, slug: r.slug, channel: r.name })))
    .sort((a, b) => String(b.published || '').localeCompare(String(a.published || ''))).slice(0, RECENT);
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.status(200).json({ channels: rows.map(({ recent: _, ...r }) => r), recent });
}
