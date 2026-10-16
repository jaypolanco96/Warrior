// Talk to the Warrior bot from a second terminal:  npm run warrior -- <command>
// Read-only commands answer at once. Instructions are left in an inbox that the running bot picks up within 30 seconds;
// the bot is the only thing that trades. Add --live to address the live bot instead of the practice one.
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { searchPools, tokenPools, tokenInfo, prices, coinBasics, SOL } from '../lib/market.mjs';
import { lookupCoin } from '../lib/scan.mjs';
import { resolveRules, describe, PRESETS } from '../lib/presets.mjs';
import { coachBefore, whyNot, coachAfter } from '../lib/coach.mjs';
import { safetyReport } from '../lib/safety.mjs';
import { quote } from '../lib/jupiter.mjs';
import { summarize, tradesCsv } from '../lib/portfolio.mjs';
import { receipt } from '../lib/receipt.mjs';
import { dayStory } from '../lib/story.mjs';
import { mintSafety, isAddress } from '../lib/rpc.mjs';
import { DIR } from './wallet.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--')), flag = (n) => process.argv.includes(`--${n}`), opt = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const MODE = flag('live') ? 'live' : 'paper', STATE = `${DIR}state-${MODE}.json`, INBOX = `${DIR}inbox-${MODE}.jsonl`, [cmd, ...rest] = args;
const usd = (n) => !Number.isFinite(n) ? 'unknown' : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`, sol = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)} SOL`;
const state = () => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
const out = (...lines) => console.log(lines.join('\n'));
function die(message) { console.error(message); process.exit(1); }
// A data source that is busy or down gets a plain sentence, not a stack trace.
const plain = (e) => die(/\(429\)/.test(e?.message ?? '') ? 'The market data source is busy right now (too many requests). Wait a minute and try again.' : `That did not work: ${e?.message ?? e}. Nothing was traded.`);
process.on('unhandledRejection', plain); process.on('uncaughtException', plain);
function leave(instruction) { mkdirSync(DIR, { recursive: true }); appendFileSync(INBOX, JSON.stringify(instruction) + '\n'); const s = state(), fresh = s?.savedAt && Date.now() - s.savedAt < 120_000; out(`Left for the ${MODE === 'live' ? 'LIVE' : 'practice'} bot. ${fresh ? 'It picks this up within 30 seconds and prints the result in its own window.' : `The bot does not seem to be running. Start it with: npm run bot${MODE === 'live' ? ':live' : ''}`}`); }
const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) die(`${name} must be a number above zero.`); return n; };
let rules; try { rules = resolveRules({ preset: opt('preset') ?? 'balanced' }); } catch (e) { die(`${e.message}. Presets: chill, balanced, spicy.`); } // presets only; --set is ignored
/** A coin from an address, or from a name when exactly one busy coin matches. */
async function coinFrom(q) {
  if (!q) die('Give a coin address or name.');
  if (isAddress(q)) { const coin = await coinBasics(q); if (!coin) die('No pool trades that coin against SOL or a dollar coin.'); return coin; }
  const matches = (await searchPools(q)).slice(0, 5); if (!matches.length) die(`Nothing on Solana matches "${q}".`);
  out(`"${q}" matches ${matches.length} coin${matches.length === 1 ? '' : 's'}. Many coins share a name, so use the address:`, ...matches.map((m) => `  ${m.symbol.padEnd(10)} ${m.mint}  traded today $${Math.round(m.volume24hUsd ?? 0).toLocaleString('en-US')}`)); process.exit(0);
}

const HELP = `Warrior, from the terminal.  npm run warrior -- <command>   (add --live for the live bot)

Look, without trading:
  lookup <name or address>            Warrior's verdict, the coach's two sentences, and "why not?" if it is a WAIT
  safety <address>                    holders, creator share, launch, depth
  status                              positions, orders, slices, watchlist and results
  history [--csv=file.csv]            closed trades; --csv writes a spreadsheet file
  receipt [number]                    the honest receipt for a closed trade (default: the latest)
  story                               today as a short story
  rules                               the strategy dial's presets

Instructions for the running bot:
  watch <address>   |  unwatch <address or name>
  buy-below <address> <price> <sol>       buy if it gets cheaper
  sell-above <coin> <price> <percent>     sell part or all of a position if it gets dearer
  exits <coin> [--stop=price] [--target=price]   your own stop and target (leave one out for none)
  slices-buy <address> <total sol> <slices> <minutes apart>
  slices-sell <coin> <slices> <minutes apart>
  cancel <number>                     cancel a waiting order or a running slice plan
  write-off <coin>                    remove a position whose pool was emptied, recording the loss
  add <coin> <sol>                    add funds to an open position
  sell <coin> [percent]               sell a position now, or part of it
  take-out <coin>                     sell enough to get back what you put in; the rest rides
  steps <coin> [p1 p2 p3]             take profit in steps: a third at each gain (default 25 50 100 %)
  break-even <coin>                   move your stop to the price you paid
  reset-day                           start today's count again (daily loss limit, Rocket's daily limits); history is kept
  get-me-out                          sell everything now

Rocket Mode is set when the bot starts. Its plan (target, stop, trailing stop, bets per day) comes from the preset;
only the bet size is yours:
  npm run bot -- --preset=spicy --rocket --rocket-bet=0.02

The strategy dial, bedtime, priority fee, protected sending and wallet following are set when the bot starts:
  npm run bot -- --preset=chill --stop-at=23:00 --close-by=00:00 --follow=ADDRESS:name --copy`;

if (!cmd || cmd === 'help') out(HELP);
else if (cmd === 'rules') out(...Object.entries(PRESETS).map(([id, p]) => `${p.face} ${id.padEnd(9)} ${p.blurb}\n   ${describe(resolveRules({ preset: id }))}  [${resolveRules({ preset: id }).version}]`), '', 'Exact numbers: --set=targetPct:15,riskPerTradePct:1');
else if (cmd === 'lookup') {
  const coin = await coinFrom(rest.join(' ')), t = await lookupCoin(coin.mint, rules, mintSafety), c = coachBefore(t, rules);
  out(`${t.symbol}  ${usd(t.priceUsd)}  ${t.dex}${t.pump ? ' (pump.fun)' : ''}`, `Warrior says ${t.analysis.decision === 'enter' && t.screen.ok ? 'ENTER' : 'WAIT'} under ${rules.version}: ${t.analysis.score ?? 0}/4 signal groups agree, ${t.analysis.regime ?? 'regime unknown'}, hourly bias ${t.analysis.bias ?? 'unknown'}.`, `Coach: ${c.why} ${c.wrongIf}`);
  const no = whyNot(t, rules); if (no.length) out('', 'Why not?', ...no.map((n) => `  ${n.rule}: ${n.said}\n    What would change it: ${n.change}`));
} else if (cmd === 'safety') {
  const mint = rest[0]; if (!isAddress(mint)) die('Give the coin address.');
  const pools = await tokenPools(mint), depth = async (s) => { try { const q = await quote({ inputMint: SOL, outputMint: mint, amountRaw: String(s * 1e9), apiKey: process.env.JUPITER_API_KEY }); return { sol: s, impactPct: Math.abs(Number(q.priceImpactPct)) * 100 }; } catch { return { sol: s, impactPct: NaN }; } };
  const r = safetyReport({ info: await tokenInfo(mint).catch(() => null), token: pools[0] ?? null, depth: [await depth(1), await depth(5)] });
  out(`${pools[0]?.symbol ?? mint}: ${r.counts.bad} warning(s), ${r.counts.watch} worth a look, ${r.counts.unknown} unknown, ${r.counts.good} fine.`, ...r.items.map((i) => `  ${({ bad: '✖', watch: '!', unknown: '?', good: '✔' })[i.level]} ${i.label}: ${i.value}${i.note ? `\n      ${i.note}` : ''}`));
} else if (cmd === 'status' || cmd === 'history' || cmd === 'receipt' || cmd === 'story') {
  const s = state(); if (!s) die(`No ${MODE === 'live' ? 'live' : 'practice'} bot records yet. Start the bot first.`);
  if (cmd === 'status') {
    const mints = [...new Set([...s.positions.map((p) => p.mint), ...s.orders.filter((o) => o.status === 'waiting').map((o) => o.mint)])], px = mints.length ? await prices(mints).catch(() => ({})) : {};
    const sum = summarize({ positions: s.positions.map((p) => ({ ...p, mode: MODE })), trades: s.trades.map((t) => ({ ...t, mode: MODE })), prices: px, mode: MODE });
    out(`${MODE === 'live' ? 'LIVE' : 'PRACTICE'} bot · rules ${s.rules?.version ?? 'unknown'} · last heard from ${s.savedAt ? `${Math.round((Date.now() - s.savedAt) / 1000)} seconds ago` : 'never'}${MODE === 'paper' ? ` · practice balance ${s.paperSol.toFixed(4)} SOL` : ''}`, '',
      `Holding: ${sum.holdings.length ? `${sum.holdings.length} coin(s), cost ${sum.costSol.toFixed(4)} SOL, worth about ${sum.valueSol.toFixed(4)} SOL (${sol(sum.unrealizedSol)})` : 'nothing'}`,
      ...sum.holdings.map((h) => `  ${h.symbol.padEnd(10)} cost ${h.costSol.toFixed(4)}  ${h.priced ? `now ${sol(h.pnlSol)} (${h.pnlPct.toFixed(1)}%)` : 'no price'}  stop ${usd(h.stop)} target ${usd(h.target)}${h.ownStop || h.ownTarget ? `  yours: ${h.ownStop ? usd(h.ownStop) : 'no stop'} / ${h.ownTarget ? usd(h.ownTarget) : 'no target'}` : ''}`),
      `Closed: ${sum.closed ? `${sum.closed} trade(s), ${sum.wins} won, ${sum.losses} lost, ${sol(sum.realizedSol)}` : 'none yet'}`, '',
      'Orders and slices:', ...(s.orders.length || s.plans.length ? [...s.orders.slice(-10).map((o) => `  #${o.id} ${o.kind === 'buy-below' ? `buy ${o.sol} SOL of ${o.symbol} at or below ${usd(o.price)}` : `sell ${Math.round(o.fraction * 100)}% of ${o.symbol} at or above ${usd(o.price)}`} · ${o.status}${o.status === 'waiting' ? ` · now ${usd(px[o.mint])}` : ''}${o.note ? ` · ${o.note}` : ''}`), ...s.plans.slice(-6).map((p) => `  #${p.id} ${p.side} ${p.symbol} in ${p.slices} slices${p.side === 'buy' ? ` of ${p.solEach} SOL` : ''} · ${p.status} · ${p.done} of ${p.slices} done`)] : ['  none']), '',
      `Watching: ${s.watch.length ? s.watch.map((w) => `${w.symbol} (${w.last === 'enter' ? 'ENTER' : 'wait'})`).join(', ') : 'nothing'}`);
  } else if (cmd === 'history') {
    const trades = s.trades.map((t) => ({ ...t, mode: MODE })); if (!trades.length) { out('No closed trades yet.'); process.exit(0); }
    const file = opt('csv'); if (file) { writeFileSync(file, tradesCsv(trades)); out(`Wrote ${trades.length} trade(s) to ${file}.`); }
    else out(...trades.slice(-20).map((t, i, a) => `  ${String(s.trades.length - a.length + i + 1).padStart(3)}  ${new Date(t.closedAt).toISOString().slice(0, 16).replace('T', ' ')}  ${t.symbol.padEnd(10)} ${t.solIn.toFixed(4)} → ${t.solOut.toFixed(4)}  ${sol(t.pnlSol)} (${t.pnlPct.toFixed(1)}%)  ${t.reason}  ${t.rulesVersion ?? ''}`), '', 'The number on the left works with: npm run warrior -- receipt <number>');
  } else if (cmd === 'receipt') {
    if (!s.trades.length) { out('No closed trades yet.'); process.exit(0); }
    const n = rest[0] ? Number(rest[0]) : s.trades.length, t = s.trades[n - 1]; if (!t) die(`There is no trade number ${rest[0]}.`);
    const r = receipt({ ...t, mode: MODE }), c = coachAfter({ ...t, mode: MODE });
    out(`Receipt for trade ${n}: ${t.symbol}, closed ${new Date(t.closedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC (${t.reason})${MODE === 'paper' ? ' — PRACTICE' : ''}`, ...r.lines.map((l) => `  ${l.label.padEnd(48)} ${l.text.padStart(16)}${l.note ? `   ${l.note}` : ''}`), `  ${'Costs you paid, in total'.padEnd(48)} ${`${r.complete ? '' : 'at least '}${r.costsSol.toFixed(6)} SOL`.padStart(16)}`, `  ${'TRUE RESULT'.padEnd(48)} ${`${r.resultSol >= 0 ? '+' : ''}${r.resultSol.toFixed(6)} SOL`.padStart(16)}   ${r.resultPct}%`, '', r.note, `Coach: ${c.happened} ${c.learned}`);
  } else { const today = new Date().toISOString().slice(0, 10), from = Date.parse(`${today}T00:00:00Z`); out(...dayStory(s.dayRecord?.day === today ? s.dayRecord : null, s.trades.filter((t) => t.closedAt >= from), { practice: MODE === 'paper' }).map((sl) => `${sl.face}  ${sl.title}\n    ${sl.text}`)); }
} else if (cmd === 'watch') { const c = await coinFrom(rest[0]); leave({ do: 'watch', coin: { mint: c.mint, symbol: c.symbol, pool: c.pool } }); }
else if (cmd === 'unwatch') leave({ do: 'unwatch', mint: rest[0] ?? die('Give the coin.') });
else if (cmd === 'buy-below') { const c = await coinFrom(rest[0]), price = num(rest[1], 'Price'), amount = num(rest[2], 'Amount'); if (Number.isFinite(c.priceUsd) && price >= c.priceUsd) die(`A buy-below price must be under the current price (${usd(c.priceUsd)}).`); leave({ do: 'buy-below', coin: { mint: c.mint, symbol: c.symbol, pool: c.pool }, price, sol: amount, priceNow: c.priceUsd }); }
else if (cmd === 'sell-above') leave({ do: 'sell-above', key: rest[0] ?? die('Give the coin.'), price: num(rest[1], 'Price'), percent: num(rest[2] ?? '100', 'Percent') });
else if (cmd === 'exits') { const stop = opt('stop'), target = opt('target'); leave({ do: 'exits', key: rest[0] ?? die('Give the coin.'), stop: stop ? num(stop, 'Stop') : null, target: target ? num(target, 'Target') : null }); }
else if (cmd === 'slices-buy') { const c = await coinFrom(rest[0]); leave({ do: 'slices-buy', coin: { mint: c.mint, symbol: c.symbol, pool: c.pool }, totalSol: num(rest[1], 'Total'), slices: num(rest[2], 'Slices'), everyMinutes: num(rest[3], 'Minutes apart') }); }
else if (cmd === 'slices-sell') leave({ do: 'slices-sell', key: rest[0] ?? die('Give the coin.'), slices: num(rest[1], 'Slices'), everyMinutes: num(rest[2], 'Minutes apart') });
else if (cmd === 'cancel') leave({ do: 'cancel', id: num(rest[0], 'Number') });
else if (cmd === 'sell') leave({ do: 'sell', key: rest[0] ?? die('Give the coin.'), ...(rest[1] ? { percent: num(rest[1], 'Percent') } : {}) });
else if (cmd === 'add') leave({ do: 'add', key: rest[0] ?? die('Give the coin.'), sol: num(rest[1], 'Amount') });
else if (cmd === 'take-out') leave({ do: 'take-out', key: rest[0] ?? die('Give the coin.') });
else if (cmd === 'steps') leave({ do: 'steps', key: rest[0] ?? die('Give the coin.'), percents: [num(rest[1] ?? '25', 'Step 1'), num(rest[2] ?? '50', 'Step 2'), num(rest[3] ?? '100', 'Step 3')] });
else if (cmd === 'break-even') leave({ do: 'break-even', key: rest[0] ?? die('Give the coin.') });
else if (cmd === 'write-off') leave({ do: 'write-off', key: rest[0] ?? die('Give the coin.') });
else if (cmd === 'reset-day') leave({ do: 'reset-day' });
else if (cmd === 'get-me-out') leave({ do: 'get-me-out' });
else die(`Unknown command "${cmd}".\n\n${HELP}`);
