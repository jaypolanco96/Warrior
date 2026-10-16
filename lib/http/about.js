import { tokenInfo } from '../market.mjs';
import { isAddress } from '../rpc.mjs';
// Read-only: a coin's own "about" text and links, as published by its creator. Warrior passes it on as plain text and
// checks nothing in it. Only https links are passed through.
const link = (label, url) => { try { const u = new URL(url); return u.protocol === 'https:' ? { label, url: u.href.slice(0, 200) } : null; } catch { return null; } };
const handle = (v) => typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : null;
export default async function handler(req, res) {
  const mint = req.query?.mint; if (!isAddress(mint)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Invalid coin address.' }); }
  try {
    const info = await tokenInfo(mint); if (!info) { res.setHeader('Cache-Control', 'public, s-maxage=600'); return res.status(200).json({ mint, name: null, symbol: null, description: null, links: [] }); }
    const links = [...(Array.isArray(info.websites) ? info.websites.slice(0, 2).map((w) => link('Website', w)) : []), handle(info.twitter_handle) ? link('X', `https://x.com/${info.twitter_handle}`) : null, handle(info.telegram_handle) ? link('Telegram', `https://t.me/${info.telegram_handle}`) : null, typeof info.discord_url === 'string' ? link('Discord', info.discord_url) : null].filter(Boolean);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
    res.status(200).json({ mint, name: info.name, symbol: info.symbol, description: typeof info.description === 'string' && info.description.trim() ? info.description.trim().replace(/\s+/g, ' ').slice(0, 1200) : null, links });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The coin\'s details are unavailable right now.' }); }
}
