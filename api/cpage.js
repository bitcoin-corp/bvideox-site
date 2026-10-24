// /c/:slug and /c/:slug/claim -> the channel/claim HTML with per-channel title, OG and robots.
// Registry (curated) channels are indexable; on-the-fly channels from the handle box are noindex until claimed or curated.
import { readFileSync } from 'node:fs';
import { findChannel, resolveHandle } from './_channels.js';
import { claimState } from './claim/_claim.js';

const T = {
  channel: readFileSync(new URL('../c/channel.html', import.meta.url), 'utf8'),
  claim: readFileSync(new URL('../c/claim.html', import.meta.url), 'utf8'),
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export default async function handler(req, res) {
  const slug = (s => /^UC[\w-]{22}$/.test(s) ? s : s.toLowerCase())(String(req.query?.slug || '')).replace(/[^\w.-]/g, '').slice(0, 40);
  const page = req.query?.page === 'claim' ? 'claim' : 'channel';
  const c = findChannel(slug);
  // Handles not in the registry (e.g. /c/bo4se) are resolved to their channel here, so a live claim shows in
  // the initial HTML (robots meta + X-Robots-Tag), not only after the page's JS runs.
  const r = !c && slug && !/^UC[\w-]{22}$/.test(slug)
    ? await Promise.race([resolveHandle(slug).catch(() => null), new Promise((ok) => setTimeout(ok, 2500, null))]) : null;
  const name = c?.displayName || r?.displayName || (slug ? '@' + slug : 'Channel');
  const id = c?.channelId || r?.channelId || (/^UC[\w-]{22}$/.test(slug) ? slug : null);
  const claimed = c?.status === 'claimed' || !!(await claimState('youtube', id))?.claimed;
  const curated = (!!c && c.status !== 'hidden') || claimed;
  const title = page === 'claim' ? `Claim ${name} · bVideoX` : `${name} · ${claimed ? 'on' : 'unclaimed channel on'} bVideoX`;
  const desc = page === 'claim'
    ? `Is ${name} your YouTube channel? Prove it with Google, connect bWalletX, then mint your videos' records in your own name.`
    : `${name}'s videos, played with YouTube's own player. ${claimed ? '' : 'Unclaimed and reserved for the owner, who can claim it and mint every video’s record.'}`;
  const html = T[page]
    .replaceAll('{{TITLE}}', esc(title)).replaceAll('{{DESC}}', esc(desc))
    .replaceAll('{{ROBOTS}}', curated && page === 'channel' ? 'index,follow' : 'noindex,follow')
    .replaceAll('{{CANON}}', `https://bvideox.com/c/${encodeURIComponent(slug)}${page === 'claim' ? '/claim' : ''}`)
    .replaceAll('{{OG}}', `https://bvideox.com${c?.og || '/og-bvideox-v1.png'}?v=1`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!curated) res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
