// Claimable channels: registry lookup, public YouTube data (RSS first, channel page fallback), mint quote.
// Content is never downloaded or re-hosted: we keep video ids/titles/dates and show YouTube's own player.
import { createHash } from 'node:crypto';
import registry from '../data/channels.json' with { type: 'json' };

export const REGISTRY = registry;
export const findChannel = (slug) => registry.channels.find((c) => c.slug === String(slug || '').toLowerCase()) || null;

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; bVideoX/1.0; +https://bvideox.com)', 'accept-language': 'en' };
const unxml = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function fromRss(id) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { headers: UA });
  if (!r.ok) return null;
  const x = await r.text();
  const entries = [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (e.match(/<yt:videoId>([^<]+)/) || [])[1],
    title: unxml((e.match(/<title>([^<]*)/) || [])[1] || ''),
    published: (e.match(/<published>([^<]+)/) || [])[1] || null,
    dateExact: true,
  })).filter((v) => v.id);
  const name = unxml((x.match(/<author>\s*<name>([^<]+)/) || [])[1] || '');
  return entries.length ? { name, videos: entries, source: 'rss' } : null;
}

// YouTube's RSS endpoint sometimes returns 404 for every channel; the public /videos page has the same list
// with relative dates ("2 weeks ago"), which we turn into an approximate date and label as approximate.
const AGO = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
function ago(t, now) {
  const m = String(t || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  return m ? new Date(now - Number(m[1]) * AGO[m[2]] * 1000).toISOString() : null;
}
async function fromPage(c) {
  const r = await fetch(`https://www.youtube.com/channel/${encodeURIComponent(c.channelId)}/videos`, { headers: UA });
  if (!r.ok) return null;
  const h = await r.text();
  const m = h.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return null;
  let d; try { d = JSON.parse(m[1]); } catch { return null; }
  const out = [];
  (function walk(o) { if (!o || typeof o !== 'object') return; if (o.lockupViewModel) { out.push(o.lockupViewModel); return; } for (const k in o) walk(o[k]); })(d.contents);
  const now = Date.now();
  const videos = out.filter((l) => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' || l.contentId?.length === 11).map((l) => {
    const md = l.metadata?.lockupMetadataViewModel;
    const parts = JSON.stringify(md?.metadata || {});
    const rel = (parts.match(/\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago/) || [])[0] || null;
    return { id: l.contentId, title: md?.title?.content || '', published: ago(rel, now), relative: rel, dateExact: false };
  }).filter((v) => v.id && v.title);
  return videos.length ? { videos, source: 'channel-page' } : null;
}

// Full back catalogue: YouTube Data API uploads playlist (UU…), paginated. Needs YOUTUBE_API_KEY (server-side).
const KEY = () => process.env.YOUTUBE_API_KEY || '';
const MAX_VIDEOS = 2000;
async function fromApi(c) {
  if (!KEY()) return null;
  const ch = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${encodeURIComponent(c.channelId)}&key=${KEY()}`)).json();
  const it = ch.items?.[0];
  if (!it) return null;
  const uploads = it.contentDetails.relatedPlaylists.uploads;
  const videos = [];
  let page = '';
  do {
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}&key=${KEY()}${page ? '&pageToken=' + page : ''}`)).json();
    for (const v of j.items || []) videos.push({ id: v.contentDetails.videoId, title: v.snippet.title, description: v.snippet.description || '', published: v.contentDetails.videoPublishedAt || v.snippet.publishedAt, dateExact: true });
    page = j.nextPageToken || '';
  } while (page && videos.length < MAX_VIDEOS);
  return { name: it.snippet.title, avatar: it.snippet.thumbnails?.high?.url || null, total: Number(it.statistics?.videoCount) || videos.length, videos, source: 'youtube-api' };
}

export async function channelData(c) {
  const api = await fromApi(c).catch(() => null);
  if (api) return api;
  const [feed, pg] = await Promise.all([fromRss(c.channelId).catch(() => null).then((f) => f || fromPage(c).catch(() => null)), pageInfo(c.channelId)]);
  return { name: feed?.name || pg.name || c.displayName, avatar: pg.avatar, total: pg.total, videos: feed?.videos || [], source: feed?.source || 'none' };
}

/** Public channel page: avatar, name, total video count. */
async function pageInfo(id) {
  try {
    const h = await (await fetch(`https://www.youtube.com/channel/${encodeURIComponent(id)}/videos`, { headers: UA })).text();
    const n = (h.match(/\{"text":\{"content":"([\d,.]+K?) videos?"/) || [])[1];
    return {
      avatar: (h.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || null,
      name: unxml((h.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || ''),
      total: n && !/K/.test(n) ? Number(n.replace(/[,.]/g, '')) : null,
    };
  } catch { return {}; }
}

/** Resolve "@Handle" (or a UC… id) to a channel. Data API forHandle if a key exists, else the public handle page. */
export async function resolveHandle(input) {
  let h = String(input || '').trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '').replace(/[/?#].*$/, '');
  if (/^UC[\w-]{22}$/.test(h)) return byId(h);
  h = h.replace(/^@/, '');
  if (!/^[\w.-]{3,30}$/.test(h)) return null;
  if (KEY()) {
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent('@' + h)}&key=${KEY()}`)).json().catch(() => ({}));
    const it = j.items?.[0];
    if (it) return { channelId: it.id, handle: '@' + h, displayName: it.snippet.title };
  }
  const r = await fetch(`https://www.youtube.com/@${encodeURIComponent(h)}`, { headers: UA });
  if (!r.ok) return null;
  const page = await r.text();
  const id = (page.match(/"externalId":"(UC[\w-]{22})"/) || [])[1];
  if (!id) return null;
  return { channelId: id, handle: '@' + h, displayName: unxml((page.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || h) };
}
async function byId(id) { const p = await pageInfo(id); return p.name ? { channelId: id, handle: null, displayName: p.name } : null; }

/** A channel not in the registry, made on the fly: unclaimed, noindex, no held paymail until curated. */
export const adHoc = (r, slug) => ({ slug, platform: 'youtube', channelId: r.channelId, handle: r.handle, displayName: r.displayName, status: 'unclaimed', heldPaymail: null, url: r.handle ? `https://www.youtube.com/${r.handle}` : `https://www.youtube.com/channel/${r.channelId}`, adHoc: true });

/** Best-effort per-instance rate limit (the CDN cache in front absorbs repeats). */
const hits = new Map();
export function limited(req, max = 20, windowMs = 60_000) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now(), e = hits.get(ip) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; hits.set(ip, e);
  if (hits.size > 5000) hits.clear();
  return e.n > max;
}

/** Live rates: USD per BSV (WhatsOnChain) and USD per GBP (ECB via frankfurter.app). Null when unreachable. */
export async function rates() {
  const get = (u, f) => fetch(u, { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).then(f).catch(() => null);
  const [usdPerBsv, usdPerGbp] = await Promise.all([
    get('https://api.whatsonchain.com/v1/bsv/main/exchangerate', (j) => Number(j.rate) || null),
    get('https://api.frankfurter.app/latest?from=GBP&to=USD', (j) => Number(j.rates?.USD) || null),
  ]);
  return { usdPerBsv, usdPerGbp };
}

/** What the channel owner pays per video: the network fee for a private record + b's premium (1p per video). */
export async function mintQuote(videos) {
  const m = registry.mint;
  const { usdPerBsv, usdPerGbp } = await rates();
  const sats = Math.ceil((m.bytesPerItem * m.feeSatPerKb) / 1000);
  const chainUsd = usdPerBsv ? (sats / 1e8) * usdPerBsv : null;
  const premiumUsd = m.premiumGbpPerItem * (usdPerGbp || 1.3);
  const perItemUsd = (chainUsd ?? 0) + premiumUsd;
  return {
    perItem: { sats, chainUsd, premiumGbp: m.premiumGbpPerItem, premiumUsd, usd: perItemUsd },
    all: { count: videos.length, sats: sats * videos.length, usd: perItemUsd * videos.length },
    usdPerBsv, usdPerGbp, feeSatPerKb: m.feeSatPerKb, premiumIsPlaceholder: m.premiumIsPlaceholder,
    whoCanMint: 'only the channel owner',
  };
}

/** The record a mint would carry for one video (and the sha the chain would commit to). */
export function mintRecord(c, v) {
  // Same fields and order as mint/records.js metaFor, so this sha matches the minted record's.
  const meta = { platform: c.platform || 'youtube', channelId: c.channelId, videoId: v.id, title: v.title || '', description: v.description || '', publishedAt: v.published || null, url: `https://www.youtube.com/watch?v=${v.id}` };
  return { ...meta, sha256: createHash('sha256').update(JSON.stringify(meta)).digest('hex') };
}
