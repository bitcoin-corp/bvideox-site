// GET /api/browse -> the channels people can browse on bVideoX, with a few recent videos each.
// Source: the curated registry (data/channels.json) plus live claim state from the push server. The push server
// only answers per channel or per identity (GET /v1/claims?platform=&channel_id= / ?identity_key=), so a claimed
// channel shows here once it is in the registry. Public and signed-out: no wallet, no cookies.
import { REGISTRY, channelData } from './_channels.js';
import { claimState } from './claim/_claim.js';

const RECENT = 12;

export default async function handler(req, res) {
  const list = REGISTRY.channels.filter((c) => c.status !== 'hidden');
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
