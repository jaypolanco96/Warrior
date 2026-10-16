import lookup from '../lib/http/lookup.js';
import safety from '../lib/http/safety.js';
import prices from '../lib/http/prices.js';
import mint from '../lib/http/mint.js';
import trending from '../lib/http/trending.js';
import about from '../lib/http/about.js';
import rocket from '../lib/http/rocket.js';
import audit from '../lib/http/audit.js';
import chart from '../lib/http/chart.js';
// Read-only facts about coins, behind one address so the site stays inside the hosting plan's function limit.
//   what=lookup  a name, ticker or address -> matches, or Warrior's full verdict
//   what=safety  the deeper safety panel for one coin
//   what=prices  current prices for a short list of coins
//   what=mint    can the creator freeze the coin or print more of it?
//   what=trending  what is hot right now, with the safety screen's answer for each
//   what=about   the coin's own description and links, as its creator published them
//   what=audit   does a coin's launch look staged? (bundled buy-up, the same name launched and dumped before)
//   what=rocket  brand-new pump.fun launches with the Rocket screen's answer and the creator's record
//   what=chart   the last hour of one-minute prices for one coin, for the line on a position card
const handlers = { lookup, safety, prices, mint, trending, about, rocket, audit, chart };
export default async function handler(req, res) {
  const run = handlers[req.query?.what];
  if (!run) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Unknown request.' }); }
  return run(req, res);
}
