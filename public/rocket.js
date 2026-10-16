// Rocket Mode on the page: its settings, and the launch pad list of brand-new pump.fun coins.
// The rules are in /vendor/lib/rocket.js; the trader in /auto.js places the bets.
import { trader } from '/auto.js';
import { rules } from '/rules.js';
import { guardBuy } from '/care.js';
import { on, emit } from '/bus.js';
import { card } from '/app.js';
import { knob, fact } from '/knobs.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const money = (n) => !Number.isFinite(n) ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const FIELDS = [['betSol', 'Bet per coin (SOL)', 0.02, 1, 0.01], ['targetPct', 'Target (%)', 1, 10000, 1], ['stopPct', 'Stop: sell if it falls this far (%)', 10, 90, 5], ['trailStartPct', 'Trailing stop starts after a gain of (%)', 20, 5000, 10], ['trailGapPct', 'Trailing stop follows this far under the highest price (%)', 5, 90, 5], ['takeOutAtPct', 'Take out what I put in once a bet is up (%; 0 = off)', 0, 1000, 10], ['protectAtPct', 'Protect a profit: move the stop above what I paid once a bet is up (%; 0 = off)', 0, 500, 5], ['sellOffExit', 'Sell when a sell-off starts or the biggest holders sell (1 yes, 0 no)', 0, 1, 1], ['maxPositions', 'Rocket positions at once', 1, 5, 1], ['maxBetsPerDay', 'Rocket bets per day', 1, 100, 1], ['early', 'Bet on coins 1 to 10 minutes old (1 yes, 0 no)', 0, 1, 1], ['earlyMinutes', 'Sell an early bet after this many minutes, whatever happened (0 = no clock)', 0, 240, 1]];
// Switches instead of typing 1 or 0, and a switch for each number that can be off.
const KINDS = {
  takeOutAtPct: { kind: 'optional', on: 100, label: 'Take out what I put in once a bet is up', unit: '%' },
  protectAtPct: { kind: 'optional', on: 30, label: 'Protect a profit: move the stop above what I paid once a bet is up', unit: '%' },
  sellOffExit: { kind: 'switch', label: 'Sell when a sell-off starts or the biggest holders sell' },
  early: { kind: 'switch', label: 'Bet on coins 1 to 10 minutes old' },
  earlyMinutes: { kind: 'optional', on: 15, label: 'Sell an early bet after a set time, whatever happened', unit: 'minutes', off: 'no clock' }
};
// The settings come in four groups; each heading goes above the first setting of its group.
const GROUPS = { betSol: ['The bet', 'The only Rocket number that is yours. The rest is set by your preset (Chill, Balanced or Spicy) and shown below.'], targetPct: ['When a bet is sold'], maxPositions: ['Limits'], early: ['Early launches', 'Coins still on the launch curve. Off in every preset for now: all five early bets on October 14 hit their stop. An early bet is sold by the settings above, the same as any Rocket bet.'] };
const details = $('rocket'); let timer = null, request = 0;

function drawSettings(message = '', background = false) {
  const prefs = trader.rocket, box = $('rocket-fields'), typing = background && box.contains(document.activeElement); // the page redraws often; never wipe a number someone is in the middle of typing
  if (!typing) box.replaceChildren(); box.classList.add('knob-list');
  for (const [key, text, min, max, step] of typing ? [] : FIELDS) {
    if (GROUPS[key]) { box.append(el('h4', 'field-group', GROUPS[key][0])); if (GROUPS[key][1]) box.append(el('p', 'muted field-group-note', GROUPS[key][1])); }
    const k = KINDS[key] ?? {}, [label, unit] = k.label ? [k.label, k.unit ?? ''] : [text, ''];
    // Only the bet size is yours; everything else is the preset's plan, shown read-only.
    if (key !== 'betSol') { box.append(fact({ label: k.label ? label : text.replace(/ \((%|[^)]*0 = [^)]*|1 yes, 0 no)\)$/, ''), unit: k.label ? unit : /\(%/.test(text) ? '%' : '', value: prefs[key], kind: k.kind, off: k.off })); continue; }
    box.append(knob({ id: `rocket-${key}`, label, unit, value: prefs[key], min, max, step, kind: k.kind, on: k.on, off: k.off, onChange: (v) => { const refused = trader.setRocket({ [key]: v }); drawSettings(refused.length ? `Not saved: ${refused.join('. ')}.` : 'Saved. It applies to the next Rocket bet; bets already open keep the plan they started with.'); return refused.length ? refused.join('. ') : null; } }));
  }
  $('rocket-on').checked = prefs.on; $('rocket-on').disabled = !prefs.on && !$('rocket-ack').checked;
  const live = trader.mode === 'live';
  $('rocket-summary').textContent = `Each Rocket bet: ${prefs.betSol} SOL${live ? ' of REAL funds' : ' of practice money'}, sold at −${prefs.stopPct}% or +${prefs.targetPct.toLocaleString('en-US')}%. Once it is up ${prefs.trailStartPct}%, the stop follows ${prefs.trailGapPct}% under the highest price. At most ${prefs.maxPositions} at once and ${prefs.maxBetsPerDay} a day. If every bet in a day hit its stop, that would lose about ${(prefs.betSol * prefs.stopPct / 100 * prefs.maxBetsPerDay).toFixed(3)} SOL plus costs; a coin whose price collapses faster than Warrior can sell loses the whole bet.${prefs.targetPct < 15 ? ` A target of ${prefs.targetPct}% is small next to the costs: on the one real trade measured so far, fees and rent took about 5% of the trade, so a win this size can still end as a loss.` : ''}${prefs.targetPct < prefs.trailStartPct ? ' The trailing stop will never start, because the target is reached first.' : ''}`;
  $('rocket-record').textContent = `${rules.choice.preset === 'spicy' ? 'Your strategy dial is on Spicy, so the Rocket screen is at its loosest: more bets get through, and more of them will lose.' : 'The Rocket screen is at its standard strictness. Setting the strategy dial to Spicy loosens it.'} ${trader.rocketRecord}`;
  $('rocket-status').textContent = message || (prefs.on ? `Rocket Mode is ON. Bets are placed only while auto-trading is running${trader.running ? '' : ' (it is not running now)'}.` : 'Rocket Mode is off.');
}
$('rocket-ack').addEventListener('change', () => drawSettings());
$('rocket-on').addEventListener('change', (e) => { const refused = trader.setRocket({ on: e.target.checked }); if (!e.target.checked) $('rocket-ack').checked = false; drawSettings(refused.length ? `Not switched on: ${refused.join('. ')}.` : ''); });

function row(c, i) {
  const r = el('div', `row-item rocket-row ${c.creator.kind === 'record' ? 'record' : ''} ${c.screen.ok ? '' : 'done'}`), text = el('span', '');
  text.append(el('b', '', `${i + 1}. ${c.symbol}`), ` · ${c.ageMin < 1 ? 'under a minute' : `${Math.round(c.ageMin)} min`} old · worth ${money(c.marketValueUsd)} · pool ${money(c.liquidityUsd)} · ${c.holders ?? '?'} holders · top holders ${c.topHoldersPct === null ? '?' : `${c.topHoldersPct.toFixed(0)}%`} · last 5 min: ${money(c.buyUsd5m)} bought, ${money(c.sellUsd5m)} sold · `);
  text.append(el('span', `verdict ${c.screen.ok || c.early?.ok ? 'enter' : 'exit'}`, c.screen.ok ? 'PASSES THE ROCKET SCREEN' : c.early?.ok ? 'ON THE CURVE: PASSES THE EARLY SCREEN' : `REFUSED: ${c.screen.reasons.slice(0, 3).join(', ').toUpperCase()}`));
  const who = el('p', `creator ${c.creator.kind}`, `${c.creator.kind === 'record' ? '⭐ Creator with a record. ' : c.creator.kind === 'serial' ? '⚠ ' : ''}${c.creator.text}`); text.append(who);
  r.append(text);
  if (c.screen.ok) {
    const live = trader.mode === 'live', b = el('button', 'btn small', live ? 'Rocket bet (REAL funds)' : 'Practice Rocket bet'); b.type = 'button'; let armed = 0;
    b.addEventListener('click', () => { if (live && Date.now() - armed > 6000) { armed = Date.now(); b.textContent = `Tap again: ${trader.rocket.betSol} SOL of real funds`; setTimeout(() => { if (b.isConnected) b.textContent = 'Rocket bet (REAL funds)'; }, 6000); return; } guardBuy({ mint: c.mint, sol: trader.rocket.betSol, practice: !live }, () => { b.disabled = true; emit('rocket-buy', c); }); });
    r.append(b);
  }
  return r;
}
async function load() {
  const mine = ++request, status = $('rocket-list-status'), box = $('rocket-list');
  try {
    const r = await fetch(`/api/coin?what=rocket&level=${rules.choice.preset}`), j = await r.json(); if (mine !== request) return; if (!r.ok) throw new Error(j.error || 'The launch feed is unavailable');
    status.textContent = `${j.seen} launches under ${j.limits.maxAgeMin + 5} minutes old. ${j.passing} pass the Rocket screen right now. ${((n) => `${n} ${n === 1 ? 'comes' : 'come'}`)(j.coins.filter((c) => c.creator.kind === 'record').length)} from a creator with a record. Updated ${new Date(j.at).toLocaleTimeString()}; refreshes every 30 seconds while this is open.`;
    box.replaceChildren(...j.coins.slice(0, 12).map(row)); if (!j.coins.length) box.append(el('p', 'muted', 'No new launches in the feed right now.'));
  } catch (e) { if (mine === request) { status.textContent = `${e.message}`; emit('problem', `Rocket Mode could not read the launch feed (${e.message}). No Rocket bets are placed without it.`); } }
}
details.addEventListener('toggle', () => { clearInterval(timer); if (!details.open) return; drawSettings(); void load(); timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000); });
on('risk', () => { if (details.open) drawSettings($('rocket-status').textContent.startsWith('Not ') || $('rocket-status').textContent.startsWith('Saved') ? $('rocket-status').textContent : '', true); });
drawSettings();

// ---------- the Rocket scanner: the second tab of the scanner panel ----------
// The newest launches as the same cards the Live scanner uses, with the same four buttons: Practice buy, the trade
// button (Phantom, or the Warrior wallet), Why not?, and Safety, watch, orders. Passing coins first, then the live ones
// that miss by the fewest reasons. Nothing is fetched while the Live scanner tab is the one on show.
let scanAll = false, scanSeen = null, scanReq = 0, scanOn = false, scanTimer = null;
/** A launch from the feed, shaped like a scanner coin so the ordinary card and every buy path can take it. */
function asCoin(c) {
  const passes = c.screen.ok, early = !passes && c.early?.ok, why = passes || early ? [] : (c.graduated ? c.screen.reasons : (c.early?.reasons ?? c.screen.reasons)), prefs = trader.rocket, price = c.priceUsd;
  return { mint: c.mint, symbol: c.symbol, pool: c.pool, dex: c.dex || 'pump.fun', pump: true, createdAt: c.createdAt, priceUsd: price, liquidityUsd: c.liquidityUsd, volume24hUsd: null, change: { m5: c.change5mPct },
    // A buy from this card uses your Rocket stop and target.
    analysis: { decision: 'wait', score: 0, reasons: why, confirmations: null, tf: 1, price, stopPct: prefs.stopPct, targetPct: prefs.targetPct, stop: Number.isFinite(price) ? price * (1 - prefs.stopPct / 100) : null, target: Number.isFinite(price) ? price * (1 + prefs.targetPct / 100) : null },
    rocketInfo: { ok: passes || early, label: passes ? 'PASSES THE ROCKET SCREEN' : early ? 'PASSES THE EARLY SCREEN' : `REFUSED · ${why.length} reason${why.length === 1 ? '' : 's'}`, tag: c.graduated ? 'ROCKET' : 'ON THE CURVE', move: c.change5mPct, age: c.ageMin < 1 ? 'under a minute old' : `${Math.round(c.ageMin)} min old`, reasons: why,
      facts: [['Worth', money(c.marketValueUsd)], ['Traders', String(c.traders ?? '?')], ['Holders', String(c.holders ?? '?')], ['Real buying', Number.isFinite(c.organicBuyPct) ? `${c.organicBuyPct.toFixed(1)}%` : 'not reported'], ['Top holders', c.topHoldersPct === null ? '?' : `${c.topHoldersPct.toFixed(0)}%`], ['Last 5 min', `${money(c.buyUsd5m)} bought, ${money(c.sellUsd5m)} sold`], ...why.slice(0, 6).map((r, n) => [n === 0 ? 'Refused' : '', r])],
      note: `${c.creator.kind === 'record' ? '⭐ A creator with a record. ' : c.creator.kind === 'serial' ? '⚠ ' : ''}${c.creator.text}` } };
}
function drawScan() {
  const box = $('rocket-scan'), more = $('rocket-scan-more'), status = $('rocket-scan-status'); if (!box || !scanSeen) return; box.replaceChildren(); more.replaceChildren();
  const j = scanSeen, good = [...j.coins.filter((c) => c.screen.ok), ...(j.early ?? []).filter((c) => !j.coins.some((x) => x.mint === c.mint && x.screen.ok))], seenMints = new Set(good.map((c) => c.mint));
  const near = j.coins.filter((c) => !seenMints.has(c.mint) && Number.isFinite(c.liquidityUsd) && c.liquidityUsd >= 3000).sort((a, b) => a.screen.reasons.length - b.screen.reasons.length), list = [...good, ...near], shown = scanAll ? list : list.slice(0, Math.max(6, good.length));
  status.textContent = `${j.seen} launches up to an hour old. ${j.passing} pass the Rocket screen${rules.choice.preset === 'spicy' ? ' on Spicy' : ''}${(j.early ?? []).length ? `, ${j.early.length} on the launch curve pass the early screen` : ''}. Rocket Mode is ${trader.rocket.on ? 'ON' : 'off'}. Updated ${new Date(j.at).toLocaleTimeString()}; refreshes every 30 seconds.`;
  for (const c of shown) box.append(card(asCoin(c))); if (!list.length) box.append(el('p', 'muted', 'No live launches in the feed right now.'));
  if (list.length > shown.length || scanAll) { const b = el('button', 'btn', scanAll ? 'Show fewer' : `Show all ${list.length} launches`); b.type = 'button'; b.addEventListener('click', () => { scanAll = !scanAll; drawScan(); }); more.append(b); }
}
async function loadScan(force = false) {
  if (!scanOn || (!force && document.visibilityState !== 'visible')) return; const mine = ++scanReq, box = $('rocket-scan');
  try { const r = await fetch(`/api/coin?what=rocket&level=${rules.choice.preset}`), j = await r.json(); if (mine !== scanReq || !scanOn) return; if (!r.ok) throw new Error(j.error || 'The launch feed is unavailable'); scanSeen = j; if (force || !box.querySelector('details[open]')) drawScan(); } // a card you have opened is not redrawn under you
  catch (e) { if (mine === scanReq) $('rocket-scan-status').textContent = `${e.message}`; }
}
on('scanner-tab', (tab) => { scanOn = tab === 'rocket'; clearInterval(scanTimer); if (!scanOn) return; $('rocket-scan-status').textContent = 'Looking at the newest launches…'; void loadScan(true); scanTimer = setInterval(() => void loadScan(), 30_000); });
on('scanner-refresh', () => void loadScan(true)); on('rules-changed', () => void loadScan(true));
