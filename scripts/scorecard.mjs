// The scorecard recorder. Run on a schedule by .github/workflows/scorecard.yml; never edited by hand.
//   1. For every call still open, read the candles since and mark what happened (target, stop or time limit).
//   2. Scan the market under the Balanced rules and write down every new ENTER.
// Read-only market data. No wallet, no trades.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { scan } from '../lib/scan.mjs';
import { candles } from '../lib/market.mjs';
import { resolveRules } from '../lib/presets.mjs';
import { blankCard, recordSignals, resolveSignal, expireSignal, scoreSummary } from '../lib/scorecard.mjs';

const FILE = new URL('../public/scorecard.json', import.meta.url), rules = resolveRules({ preset: 'balanced' }), now = Date.now();
let card = blankCard(); if (existsSync(FILE)) { try { const saved = JSON.parse(readFileSync(FILE, 'utf8')); if (saved?.version === 1 && Array.isArray(saved.signals)) card = saved; } catch { console.error('The scorecard file could not be read. Refusing to overwrite it.'); process.exit(1); } }

let resolved = 0;
for (const [i, s] of card.signals.entries()) {
  if (s.outcome !== 'open') continue;
  try { const next = resolveSignal(s, await candles(s.pool, 400, now, 5, s.mint)); card.signals[i] = next.outcome === 'open' ? expireSignal(next, now) : next; }
  catch { card.signals[i] = expireSignal(s, now); }
  if (card.signals[i].outcome !== 'open') resolved++;
}
let added = 0, scanned = 'no scan';
try {
  const result = await scan({ limit: 6, settings: rules.settings, risk: rules.risk, now });
  // A look where every data source failed saw nothing. It is noted, and not counted as a look at the market.
  if (result.sourcesFailed >= result.sources) throw new Error('every data source failed');
  ({ card, added } = recordSignals(card, result, { now, rulesVersion: rules.version, maxHoldBars: rules.settings.maxHoldBars })); delete card.lastError; scanned = `${result.universe} coins, ${result.scanned} analysed`;
} catch (e) { card = { ...card, updatedAt: new Date(now).toISOString(), lastError: 'The market data source did not answer on the last run.' }; scanned = `scan failed (${e.message})`; }
card.signals = card.signals.slice(-500);
writeFileSync(FILE, JSON.stringify(card, null, 1) + '\n');
const s = scoreSummary(card);
console.log(`Scorecard: ${scanned}. ${added} new ENTER call(s), ${resolved} resolved. Total ${s.total}: ${s.targets} target, ${s.stops} stop, ${s.timeouts} time, ${s.open} open, ${s.unknown} unknown.`);
