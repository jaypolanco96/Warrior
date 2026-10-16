// The strategy dial. Three presets in plain words, plus exact numbers for people who want them.
// Every combination resolves to validated settings and gets a version, so a result always belongs to the rules that made it.
import { defaultSettings, validateSettings } from './strategy.mjs';
import { defaultRisk, validateRisk } from './risk.mjs';

// Since October 14, 2026 (the owner's decision) traders pick a preset and nothing else: no exact numbers to type. Every
// number below comes from what was measured on real trades and replays that day:
//   - exits: a third sold at +5%, a third at +10%, the rest on a trailing stop from +8% (gap retuned below). Every trailing-stop
//     and step sale won that afternoon (20 of 20); full stops were the whole loss.
//   - deep dips: RSI 35 or under, 8% under the 20-candle average, not on coins down 20% in a day, once per coin per six
//     hours, with their own 12% stop (replay: +2.37% a trade).
//   - trend buys: three of four groups (RSI and stretch limits retuned below).
// The presets differ in how much they risk, how many coins they hold and how far a winner may run.
// Retuned October 15, 2026 by replaying Warrior's own buy and sell code over 3.5 days of 5-minute prices on 67 coins (1.5%
// costs a trade), one number at a time, keeping only what helped in both halves of the data. "Sell when the trend
// breaks" closed 136 of 235 trades at -2.2% on average and is now off, with a 2-hour limit instead of 6; the trailing
// stop follows 6% under the high instead of 4%; the stop is 1x volatility instead of 1.5x; trend buys need RSI 60 or
// under (was 70) and no more than 1% above the 20-candle average (was 2%). Balanced went from -1.89% to -1.44% a trade
// and Chill from -2.06% to -1.53%. Still below zero in that replay: the gain is in losing less, not a promise of profit.
// Target and widest stop changed nothing there (trades end on the trailing stop first), so they are left as they were.
// October 15, second pass: 150 coins in each of two separate 3.5-day stretches (the latest, and the 3.5 days before).
// Only the trailing stop's start helped in both: from +15% instead of +8% (Balanced -1.61% -> -1.27% and -1.87% -> -1.66%
// a trade). Needing all four signal groups trades 60% less at a better average, so Balanced does too: together -0.83% and
// -1.38% a trade on far fewer trades (total loss down 70-80%). Spicy keeps three groups: it is the preset for more action.
// The buy signal is close to even before costs, so the remaining loss is mostly the 1.5% each trade costs.
// October 15, third pass: four 3.5-day stretches (about two weeks, ~200 coins each), searched in rounds, keeping a change only
// when it lowered the total loss in at least 3 of the 4 stretches and overall. Result: trend buys are out (they lost in
// every stretch, -1.4% to -1.65% a trade); Warrior buys deep dips 10% or more under the 20-candle average with RSI 35 or
// under, skips coins down 10% in a day, and sells at +20%, at a 20% stop or after 3 hours. On the four stretches: +5.3%,
// +4.4% and +2.7% a trade (one stretch +41%, carried by one outlier; +3.7% without its two best trades), about 60% of
// trades winning. On a fifth stretch the search never saw it lost 1.83% a trade, the same as before, but on 80% fewer
// trades, so about a fifth of the total loss. Better, not proven: judge it on real trades.
const EXITS = { stopAtr: 1, trailing: 1, trailStartPct: 30, trailGapPct: 6, trendExit: 0, holdHours: 3, stepPct: 0 };
const ENTRIES = { maxEntryRsi: 50, maxStretchPct: 1, deepDip: 1, dipRsi: 35, dipBelowPct: 10, dipDayDropPct: 10, dipStopPct: 20, smartWallets: 1, smartMin: 2, smartLive: 0 };
export const PRESETS = Object.freeze({
  chill: Object.freeze({
    label: 'Chill', face: '😌', blurb: 'Deep dips only, small bets, three coins at a time. No coins under five hours old.',
    settings: { ...ENTRIES, ...EXITS, minConfluence: 4, targetPct: 20, maxStopPct: 8, youngCoins: 0, minVol1hUsd: 50000,
      // Four hours instead of three (October 16): Chill's dips, bought deeper and on busier coins, often need longer to come
      // back. Replayed on five stretches: +4.28% -> +4.88% a trade, better in four of the five. Tested for Balanced and Spicy
      // too: no gain there, so they keep three hours.
      holdHours: 4 },
    risk: { riskPerTradePct: 1, maxPositionPct: 15, maxOpenPositions: 3, dailyLossLimitPct: 5, minLiquidityUsd: 80000 }
  }),
  balanced: Object.freeze({
    label: 'Balanced', face: '😄', blurb: 'The default. Deep dips only: a third sold at +5%, a third at +10%, the rest at +20%, a 20% stop or after 3 hours. Four coins at a time.',
    settings: { ...ENTRIES, ...EXITS, minConfluence: 4, targetPct: 20, maxStopPct: 10, youngCoins: 1, minVol1hUsd: 20000,
      // Profit in steps like Spicy: a third at +5%, a third at +10%. Replayed: the stretch the dials never saw went from +0.45%
      // to +1.07% a trade (overall +1.89% against +2.67% without the two best trades: steadier, a little lower). Chill was
      // tested the same way and lost about a point with steps, so it keeps selling whole at +20%.
      stepPct: 5 },
    risk: { riskPerTradePct: 2, maxPositionPct: 25, maxOpenPositions: 4, dailyLossLimitPct: 10 }
  }),
  spicy: Object.freeze({
    label: 'Spicy', face: '🌶️', blurb: 'Deep dips from 8% under the average, a third sold at +5% and a third at +10%, bigger bets, five coins at a time.',
    settings: { ...ENTRIES, ...EXITS, minConfluence: 4, targetPct: 20, maxStopPct: 10, youngCoins: 1, minVol1hUsd: 20000,
      // More dips (October 15, the owner: an hour without a trade). 8% under the average instead of 10%: a third more trades,
      // still positive in all five replayed stretches (+0.98% a trade on the one the dials never saw, +2.28% without the two best).
      dipBelowPct: 8,
      // Profit in steps (the owner, October 15: many dips reach +5% and then correct). A third is sold at +5% and a third at
      // +10%; the rest still aims for +20%. Replayed on five stretches: positive in all of them (+1.29% a trade on the one
      // the dials never saw, was +0.98%). A trailing stop from +5% was tested too and lost in every stretch (-2.6% a trade):
      // it sells the rest on the next small wiggle, so it is not used.
      stepPct: 5 },
    risk: { riskPerTradePct: 3, maxPositionPct: 30, maxOpenPositions: 5, dailyLossLimitPct: 15 }
  })
});

/** The numbers each preset sets, with plain labels, shown read-only on the page so traders (and Claude) can see them. */
// kind: 'switch' is on (1) or off (0); 'optional' is a number that can be switched off (0), and `on` is the number it
// starts at when switched on. group: the heading it sits under on the page.
export const TUNABLE = Object.freeze({
  deepDip: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to buy', label: 'Buy deep dips', unit: '' },
  dipRsi: { of: 'settings', min: 15, max: 50, step: 1, group: 'When to buy', label: 'A deep dip: RSI at or under', unit: '' },
  dipDayDropPct: { of: 'settings', min: 0, max: 90, step: 1, kind: 'optional', on: 20, group: 'When to buy', label: 'A deep dip: skip coins down more than this in 24 hours', unit: '%', off: 'no limit' },
  minVol1hUsd: { of: 'settings', min: 0, max: 1e9, step: 1000, kind: 'optional', group: 'When to buy', label: 'Only active coins: traded in the last hour at least', unit: '$', off: 'no minimum' },
  dipStopPct: { of: 'settings', min: 5, max: 30, step: 1, group: 'When to buy', label: 'A deep dip: its stop', unit: '%' },
  dipBelowPct: { of: 'settings', min: 3, max: 40, step: 1, group: 'When to buy', label: 'A deep dip: price under its 20-candle average by at least', unit: '%' },
  smartWallets: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to buy', label: 'Buy when smart wallets buy', unit: '' },
  smartMin: { of: 'settings', min: 1, max: 5, step: 1, group: 'When to buy', label: 'Smart wallets: how many must buy within 15 minutes', unit: '' },
  smartLive: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to buy', label: 'Smart wallet buys with real funds too (off = practice only)', unit: '' },
  minConfluence: { of: 'settings', min: 1, max: 4, step: 1, group: 'When to buy', label: 'Trend buys: signal groups that must agree', unit: 'of 4' },
  targetPct: { of: 'settings', min: 2, max: 100, step: 1, group: 'When to sell', label: 'Target', unit: '%' },
  stopAtr: { of: 'settings', min: 0.5, max: 5, step: 0.1, group: 'When to sell', label: 'Stop distance', unit: '× volatility' },
  maxStopPct: { of: 'settings', min: 3, max: 30, step: 1, group: 'When to sell', label: 'Widest stop allowed', unit: '%' },
  youngCoins: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to buy', label: 'Trade young coins, one to five hours old', unit: '' },
  trailing: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to sell', label: 'Trailing stop', unit: '' },
  trailStartPct: { of: 'settings', min: 0, max: 500, step: 1, kind: 'optional', on: 5, group: 'When to sell', label: 'Trailing stop starts after a gain of', unit: '%', off: 'the stop distance' },
  trailGapPct: { of: 'settings', min: 0, max: 90, step: 1, kind: 'optional', on: 3, group: 'When to sell', label: 'Trailing stop follows this far under the highest price', unit: '%', off: '1.5 × the stop distance' },
  trendExit: { of: 'settings', min: 0, max: 1, step: 1, kind: 'switch', group: 'When to sell', label: 'Sell when the trend breaks (not for dip buys)', unit: '' },
  holdHours: { of: 'settings', min: 0, max: 168, step: 1, kind: 'optional', on: 6, group: 'When to sell', label: 'Sell after this many hours', unit: 'hours', off: 'no time limit' },
  maxEntryRsi: { of: 'settings', min: 40, max: 90, step: 1, group: 'When to buy', label: 'Trend buys: RSI at or under', unit: '' },
  maxStretchPct: { of: 'settings', min: 0, max: 30, step: 0.5, kind: 'optional', on: 2, group: 'When to buy', label: 'Trend buys: no more than this far above the 20-candle average', unit: '%', off: 'no limit' },
  stepPct: { of: 'settings', min: 0, max: 500, step: 1, kind: 'optional', on: 10, group: 'When to sell', label: 'Take profit in steps: a third at this gain, a third at twice it', unit: '%' },
  takeOutAtPct: { of: 'settings', min: 0, max: 1000, step: 1, kind: 'optional', on: 100, group: 'When to sell', label: 'Take out what I put in once a position is up', unit: '%' },
  dipAddPct: { of: 'settings', min: 0, max: 50, step: 1, kind: 'optional', on: 10, group: 'When to sell', label: 'Buy half as much again, once, if a position dips', unit: '%' },
  riskPerTradePct: { of: 'risk', min: 0.25, max: 5, step: 0.25, group: 'Size and limits', label: 'At risk per trade', unit: '% of wallet' },
  maxPositionPct: { of: 'risk', min: 5, max: 50, step: 5, group: 'Size and limits', label: 'Most in one coin', unit: '% of wallet' },
  maxOpenPositions: { of: 'risk', min: 1, max: 6, step: 1, group: 'Size and limits', label: 'Positions at once', unit: '' },
  dailyLossLimitPct: { of: 'risk', min: 2, max: 75, step: 1, group: 'Size and limits', label: 'Stop for the day after losing', unit: '%' },
  slippageBps: { of: 'risk', min: 50, max: 500, step: 10, group: 'Size and limits', label: 'Slippage limit', unit: 'hundredths of a %' }
});

function hash(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6); }

/** Turn a dial choice into exact, validated rules. Throws on an unknown preset, an unknown number or a value out of range. */
export function resolveRules({ preset = 'balanced', custom = {} } = {}) {
  const base = PRESETS[preset]; if (!base) throw new Error('Unknown preset');
  // Presets only: numbers typed in earlier versions (custom) are ignored, never an error.
  const settings = { ...base.settings }, risk = { ...base.risk }, changed = {};
  for (const [key, value] of Object.entries({})) {
    const t = TUNABLE[key]; if (!t) throw new Error(`Unknown setting: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < t.min || value > t.max) throw new Error(`${t.label} must be ${t.min} to ${t.max}`);
    if (key === 'maxStretchPct' && value !== 0 && value < 0.5) throw new Error(`${t.label} must be 0, or 0.5 and above`);
    if (key === 'stepPct' && value !== 0 && value < 2) throw new Error(`${t.label} must be 0, or 2 and above`);
    if (key === 'takeOutAtPct' && value !== 0 && value < 5) throw new Error(`${t.label} must be 0, or 5 and above`);
    if (key === 'dipAddPct' && value !== 0 && value < 3) throw new Error(`${t.label} must be 0, or 3 and above`);
    if ((key === 'trailStartPct' || key === 'trailGapPct') && value !== 0 && value < 1) throw new Error(`${t.label} must be 0, or 1 and above`);
    if (t.step === 1 && !Number.isInteger(value)) throw new Error(`${t.label} must be a whole number`);
    (t.of === 'settings' ? settings : risk)[key] = value; changed[key] = value;
  }
  if (settings.maxStopPct !== undefined && settings.maxStopPct < defaultSettings.minStopPct) throw new Error('Widest stop is below the tightest stop');
  // Young coins need an hour of trading to be read at all, so that is the age floor when they are allowed. Otherwise two hours.
  const s = validateSettings(settings); risk.minAgeHours = s.youngCoins === 1 ? 1 : 2;
  const r = validateRisk(risk);
  // The three part-exit rules only count toward the version when switched on, so existing rule versions keep their names.
  const tuned = Object.keys(TUNABLE).filter((k) => !['dipRsi', 'dipBelowPct', 'dipDayDropPct', 'dipStopPct'].includes(k) || s.deepDip === 1).filter((k) => (!['stepPct', 'takeOutAtPct', 'dipAddPct', 'maxStretchPct'].includes(k) || s[k] !== 0) && !(k === 'maxEntryRsi' && s[k] === 78)).map((k) => `${k}=${(TUNABLE[k].of === 'settings' ? s : r)[k]}`).join(';');
  const isCustom = Object.keys(changed).length > 0;
  return Object.freeze({ preset, custom: Object.freeze(changed), isCustom, settings: s, risk: r, version: `${preset}${isCustom ? '+' : ''}-${hash(tuned)}` });
}

/** The same choice as a short query string, so a scan can be cached per rule set. */
export function toQuery({ preset = 'balanced', custom = {} } = {}) {
  const c = Object.entries(custom ?? {}).filter(([k]) => TUNABLE[k]).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join(',');
  return `preset=${encodeURIComponent(preset)}${c ? `&c=${encodeURIComponent(c)}` : ''}`;
}
/** Read a choice back from a request query. Bad input throws; callers answer 400. */
export function fromQuery(query = {}) {
  const preset = typeof query.preset === 'string' && query.preset ? query.preset : 'balanced', custom = {};
  if (typeof query.c === 'string' && query.c) {
    if (query.c.length > 300) throw new Error('Settings too long');
    for (const part of query.c.split(',')) { const [k, v] = part.split(':'); if (!k || v === undefined || v === '' || !/^-?\d+(\.\d+)?$/.test(v)) throw new Error('Invalid setting'); custom[k] = Number(v); }
  }
  return resolveRules({ preset, custom });
}
/** How a position can be sold besides its stop and target, in plain words. */
export function exits(s) {
  const trail = s.trailing === 1 ? `The trailing stop starts after a gain of ${s.trailStartPct > 0 ? `${s.trailStartPct}%` : 'one stop distance'} and follows ${s.trailGapPct > 0 ? `${s.trailGapPct}%` : 'one and a half stop distances'} under the highest price` : 'The trailing stop is off';
  const parts = [s.stepPct > 0 ? `A third is sold at +${s.stepPct}% and another third at +${s.stepPct * 2}%` : null, s.takeOutAtPct > 0 ? `What you put in is taken out once a position is up ${s.takeOutAtPct}%` : null, s.dipAddPct > 0 ? `Half as much again is bought, once, if a position dips ${s.dipAddPct}%` : null].filter(Boolean).join('. ');
  return `${parts ? `${parts}. ` : ''}${trail}. ${s.timeLimit === 1 ? `Positions are sold after ${s.holdHours} hours` : 'There is no time limit'}. ${s.trendExit === 1 ? 'A broken trend sells Warrior\'s own picks' : 'A broken trend does not sell'}.`;
}
/** One plain sentence describing a resolved rule set. */
export function describe(rules) {
  const s = rules.settings, r = rules.risk;
  return `${s.deepDip === 1 ? `Buys deep dips (RSI ${s.dipRsi} or under and ${s.dipBelowPct}% or more under the 20-candle average) as well as trends; for a trend buy, ` : ''}${s.minConfluence} of 4 signal groups must agree. Target +${s.targetPct}%. Stop between ${s.minStopPct}% and ${s.maxStopPct}%. Risk ${r.riskPerTradePct}% of the wallet per trade, at most ${r.maxPositionPct}% in one coin, ${r.maxOpenPositions} position${r.maxOpenPositions === 1 ? '' : 's'} at once. No new trades after losing ${r.dailyLossLimitPct}% in a day. ${s.youngCoins === 1 ? 'Young coins (one to five hours old) are traded at half size with the widest stop.' : 'Coins under five hours old are left alone.'} ${exits(s)}`;
}
