import test from 'node:test';
import assert from 'node:assert/strict';
import { whyNot, coachBefore, coachAfter } from '../lib/coach.mjs';
import { receipt, entryCosts, addEntryCosts, shareOf, roundUp, roundDown } from '../lib/receipt.mjs';
import { moodCheck, MOOD_CHOICES, validateBedtime, bedtimeState, bedtimeText } from '../lib/mood.mjs';
import { blankDay, recordScan, dayStory, leagueWeek, leagueEntry, leagueCode, readLeagueCode, leagueTable } from '../lib/story.mjs';
import { blankCard, recordSignals, resolveSignal, expireSignal, scoreSummary } from '../lib/scorecard.mjs';
import { resolveRules } from '../lib/presets.mjs';

const rules = resolveRules({}), MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const enter = { symbol: 'AAA', mint: MINT, pool: MINT, analysis: { decision: 'enter', score: 3, confirmations: { trend: true, momentum: true, participation: true, structure: false }, regime: 'uptrend', bias: 'bullish', reasons: [], price: 1, stop: 0.95, target: 1.1, stopPct: 5, targetPct: 10, rsi: 60, atrPct: 2, at: 1000 } };
const wait = { symbol: 'BBB', mint: MINT, liquidityUsd: 9000, volume24hUsd: 500000, analysis: { decision: 'wait', score: 1, confirmations: { trend: true, momentum: false, participation: false, structure: false }, regime: 'downtrend', bias: 'bearish', rsi: 82, atrPct: 3, reasons: ['Short-term downtrend', 'Hourly bias is bearish', 'Overbought: chasing a spike', 'Only 1 of 4 signal groups agree (need 3)'] }, screen: { ok: false, reasons: ['Liquidity too thin', 'Creator can still mint more supply'] } };

test('"Why not?" names every rule that said no and what would change it', () => {
  const items = whyNot(wait, rules), rulesHit = items.map((i) => i.rule);
  for (const expected of ['Safety screen: pool size', 'Safety screen: supply', 'Regime: downtrend', 'Hourly bias', rules.settings.maxEntryRsi >= 78 ? 'Overbought' : 'Your RSI limit', 'Signal groups']) assert.ok(rulesHit.includes(expected), expected);
  assert.ok(items.every((i) => i.said && i.change));
  assert.match(items.find((i) => i.rule === 'Safety screen: pool size').said, /\$9,000/); assert.match(items.find((i) => i.rule === 'Safety screen: pool size').change, /\$40,000/);
  assert.match(items.find((i) => i.rule === 'Signal groups').said, /1 of 4 agree; your rules need 4\. Missing: momentum, volume and price structure/);
  assert.deepEqual(whyNot(enter, rules), [], 'an ENTER has nothing to explain');
  assert.equal(whyNot({ analysis: { decision: 'wait', confirmations: null, reasons: ['Candles unavailable'] } }, rules)[0].rule, 'Price history');
  // Under Chill (all 4 needed) the same 1-of-4 coin still fails, and says 4.
  assert.match(whyNot(wait, resolveRules({ preset: 'chill' })).find((i) => i.rule === 'Signal groups').said, /need 4/);
});

test('Coach: two sentences before, two after, and no promises', () => {
  const b = coachBefore(enter, rules); assert.equal(b.stance, 'enter'); assert.match(b.why, /^Trend, momentum and volume agree, in an uptrend/); assert.match(b.wrongIf, /\$0\.9500 \(−5\.0%\)/);
  const w = coachBefore(wait, rules); assert.equal(w.stance, 'wait'); assert.match(w.why, /^Warrior would wait:/); assert.match(w.wrongIf, /^It changes its mind when/);
  assert.equal(coachBefore({ ...enter, screen: { ok: false, reasons: ['Pool too new'] } }, rules).stance, 'wait', 'a failed screen overrides an ENTER');
  const won = coachAfter({ pnlSol: 0.01, pnlPct: 8, reason: 'target', openedAt: 0, closedAt: 42 * 60_000, mode: 'paper' }); assert.match(won.happened, /It reached the target after 42 minutes: \+0\.0100 SOL \(\+8\.0%\), practice money\./);
  const lost = coachAfter({ pnlSol: -0.004, pnlPct: -3.2, reason: 'stop', mode: 'live' }); assert.match(lost.happened, /It hit the stop: −0\.0040 SOL/); assert.match(lost.learned, /stop did its job/);
  for (const text of [b.why, b.wrongIf, w.why, won.happened, won.learned, lost.learned, coachAfter({ pnlSol: 1, pnlPct: 50, reason: 'manual' }).learned]) assert.doesNotMatch(text, /guarantee|will (rise|win|profit|moon)|can't lose|sure thing|stupid|idiot|your fault/i);
  assert.ok(coachAfter(null).happened);
});

test('Receipt: costs round up, results round down, and missing costs are said to be missing', () => {
  assert.equal(roundUp(0.0000001), 0.000001); assert.equal(roundDown(0.0000019), 0.000001); assert.equal(roundDown(-0.0000011), -0.000002, 'a loss is never rounded smaller');
  const entry = addEntryCosts(entryCosts({ requestedSol: 0.1, spentSol: 0.1021, impactPct: 1 }), entryCosts({ requestedSol: 0.1, spentSol: 0.1001, impactPct: 2 }));
  assert.ok(Math.abs(entry.impactSol - 0.003) < 1e-12); assert.ok(Math.abs(entry.extraSol - 0.0022) < 1e-12); assert.ok(Math.abs(shareOf(entry, 0.5).impactSol - 0.0015) < 1e-12);
  const live = receipt({ mode: 'live', solIn: 0.2022, solOut: 0.215, costs: { entry, exitImpactPct: 1, exitQuotedSol: 0.2155 } });
  assert.equal(live.complete, true); assert.equal(live.resultSol, 0.0128); assert.deepEqual(live.lines.map((l) => l.kind), ['in', 'cost', 'cost', 'cost', 'cost', 'fee', 'out']);
  assert.ok(Math.abs(live.costsSol - (0.003 + 0.0022 + roundUp(0.2155 * 1 / 99) + 0.0005)) < 2e-6); assert.ok(live.beforeCostsSol > live.resultSol);
  const paper = receipt({ mode: 'paper', solIn: 0.1, solOut: 0.0992, costs: { entry: entryCosts({ requestedSol: 0.1, spentSol: 0.1, impactPct: 0.5 }), exitImpactPct: 0.4, exitQuotedSol: 0.0992 } });
  assert.ok(paper.resultSol < 0); assert.ok(paper.lines.some((l) => l.label === 'Network fees' && l.sol === 0 && /practice sends no transaction/.test(l.note)));
  const old = receipt({ mode: 'paper', solIn: 0.1, solOut: 0.11 }); assert.equal(old.complete, false); assert.equal(old.resultSol, 0.01); assert.match(old.note, /minimum/); assert.ok(old.lines.some((l) => l.text === 'not recorded'));
  const noImpact = receipt({ mode: 'paper', solIn: 0.1, solOut: 0.11, costs: { entry: entryCosts({ requestedSol: 0.1, spentSol: 0.1, impactPct: NaN }), exitImpactPct: NaN, exitQuotedSol: 0.11 } }); assert.equal(noImpact.complete, false);
  const own = receipt({ mode: 'wallet', solIn: 0.1, solOut: 0.11, costs: { entry: entryCosts({ requestedSol: 0.1, spentSol: 0.1, impactPct: 1 }), exitImpactPct: 1, exitQuotedSol: 0.11 } });
  assert.equal(own.complete, false, 'a trade sent by your own wallet is never called fully measured'); assert.ok(own.lines.some((l) => /Not measured/.test(l.note))); assert.match(own.note, /close but not exact/);
  assert.ok([live, paper, old, own].every((r) => r.lines.some((l) => l.kind === 'fee' && l.sol === 0 && /charges no fee/.test(l.note))), 'the fee line is always printed, even at zero');
  assert.equal(receipt({ mode: 'live', solIn: 1, solOut: 1.1, warriorFeeSol: 0.001, costs: { entry: entryCosts({ requestedSol: 1, spentSol: 1, impactPct: 0 }), exitImpactPct: 0, exitQuotedSol: 1.1 } }).costsSol, 0.001, 'a fee, if there ever is one, counts as a cost');
  assert.equal(receipt(null).complete, false);
});

test('Mood guard: notices the three patterns, stays quiet otherwise, and never pressures', () => {
  const now = 10_000_000, m = 60_000;
  assert.equal(moodCheck({ trades: [], proposed: { mint: MINT, sol: 0.1 }, now }), null);
  assert.equal(moodCheck({ trades: [{ mint: MINT, pnlSol: 0.01, solIn: 0.1, closedAt: now - m }], proposed: { mint: MINT, sol: 0.1 }, now }), null, 'a win is not a reason');
  assert.equal(moodCheck({ trades: [{ mint: MINT, pnlSol: -0.01, solIn: 0.1, closedAt: now - 5 * m }], proposed: { mint: MINT, sol: 0.1 }, now }).kind, 'revenge');
  assert.equal(moodCheck({ trades: [{ mint: MINT, pnlSol: -0.01, solIn: 0.1, closedAt: now - 30 * m }], proposed: { mint: MINT, sol: 0.1 }, now }), null, 'same coin, but half an hour later');
  assert.equal(moodCheck({ trades: [{ mint: 'x', pnlSol: -0.01, solIn: 0.1, closedAt: now - 20 * m }, { mint: 'y', pnlSol: -0.01, solIn: 0.1, closedAt: now - 40 * m }], proposed: { mint: MINT, sol: 0.1 }, now }).kind, 'streak');
  const down = [{ mint: 'x', pnlSol: -0.02, solIn: 0.1, closedAt: now - 3 * 60 * m }, { mint: 'y', pnlSol: 0.005, solIn: 0.1, closedAt: now - 4 * 60 * m }];
  assert.equal(moodCheck({ trades: down, proposed: { mint: MINT, sol: 0.2 }, now }).kind, 'size'); assert.equal(moodCheck({ trades: down, proposed: { mint: MINT, sol: 0.12 }, now }), null);
  // Pressure check: both answers exist, neither is belittled, and no message shames, threatens or sets a deadline.
  assert.deepEqual(Object.keys(MOOD_CHOICES), ['rest', 'go']); assert.equal(MOOD_CHOICES.go, 'Go ahead');
  for (const kind of [[{ mint: MINT, pnlSol: -1, solIn: 1, closedAt: now - m }], [{ mint: 'x', pnlSol: -1, solIn: 1, closedAt: now - m }, { mint: 'y', pnlSol: -1, solIn: 1, closedAt: now - 2 * m }]]) assert.doesNotMatch(moodCheck({ trades: kind, proposed: { mint: MINT, sol: 1 }, now }).message, /stupid|idiot|loser|must|have to|forbidden|locked|last chance|hurry|only \d+ (seconds|minutes) left/i);
});

test('Bedtime rules: plain words, windows across midnight, and a rule that is off does nothing', () => {
  const b = { on: true, stopAt: '23:00', closeAt: '00:00', wakeAt: '07:00' }, at = (h, m = 0) => h * 60 + m;
  assert.equal(validateBedtime(b).ok, true); assert.equal(bedtimeText(b), 'Stop opening trades at 11 pm, close everything by 12 am, and start again at 7 am.');
  assert.deepEqual([bedtimeState(b, at(22, 59)).canOpen, bedtimeState(b, at(23)).canOpen, bedtimeState(b, at(23, 30)).mustClose, bedtimeState(b, at(0)).mustClose, bedtimeState(b, at(6, 59)).mustClose, bedtimeState(b, at(7)).canOpen, bedtimeState(b, at(7)).mustClose], [true, false, false, true, true, true, false]);
  const keep = { on: true, stopAt: '22:30', closeAt: '', wakeAt: '06:00' }; assert.equal(bedtimeState(keep, at(2)).mustClose, false); assert.equal(bedtimeState(keep, at(2)).canOpen, false); assert.match(bedtimeText(keep), /10:30 pm, keep open positions overnight, and start again at 6 am/);
  const day = { on: true, stopAt: '12:00', closeAt: '12:30', wakeAt: '14:00' }; assert.equal(bedtimeState(day, at(13)).mustClose, true); assert.equal(bedtimeState(day, at(15)).canOpen, true);
  assert.equal(bedtimeState({ ...b, on: false }, at(2)).canOpen, true); assert.equal(bedtimeState(null, at(2)).canOpen, true);
  assert.equal(validateBedtime({ on: true, stopAt: '23:00', closeAt: '12:00', wakeAt: '07:00' }).ok, false, 'closing at noon is outside the night');
  assert.equal(validateBedtime({ on: true, stopAt: '25:00', wakeAt: '07:00' }).ok, false); assert.equal(validateBedtime({ on: true, stopAt: '07:00', wakeAt: '07:00' }).ok, false);
  assert.equal(bedtimeState({ on: true, stopAt: 'x', wakeAt: 'y' }, at(2)).canOpen, true, 'a broken rule never blocks trading silently');
});

test('Day story is built only from what was recorded', () => {
  let d = blankDay('2026-10-12'); assert.equal(dayStory(d).length, 1); assert.match(dayStory(d)[0].title, /quiet/i);
  d = recordScan(d, { universe: 37, rejected: 16, results: [enter, wait, { analysis: { decision: 'wait', reasons: ['Only 2 of 4 signal groups agree (need 3)'] } }] }); d = recordScan(d, null); d = recordScan(d, { universe: 30, rejected: 12, results: [wait] });
  assert.deepEqual([d.scans, d.failedScans, d.coinsSeen, d.screenedOut, d.enters, d.analysed], [2, 1, 37, 16, 1, 4]); assert.equal(d.waits['Short-term downtrend'], 2); assert.equal(d.waits['Too few signal groups agree'], 1);
  const quiet = dayStory(d, []); assert.match(quiet.find((s) => s.title === 'What I watched').text, /2 times.*37 coins.*1 scan failed/); assert.match(quiet.find((s) => s.title === 'What I liked').text, /ENTER 1 time/); assert.match(quiet.find((s) => s.title === 'What you traded').text, /Nothing closed/);
  const busy = dayStory(d, [{ symbol: 'A', pnlSol: 0.02 }, { symbol: 'B', pnlSol: -0.01 }]); assert.match(busy.find((s) => s.title === 'What you traded').text, /2 trades closed: 1 up, 1 not\. Together \+0\.0100 SOL of practice money\. Best: A \+0\.0200 SOL\. Worst: B −0\.0100 SOL/);
});

test('Practice league: practice trades only, this week only, codes survive a round trip and tampering is caught', () => {
  const now = Date.UTC(2026, 9, 14, 12), week = leagueWeek(now); assert.equal(week, '2026-10-12'); assert.equal(leagueWeek(Date.UTC(2026, 9, 18, 23)), '2026-10-12'); assert.equal(leagueWeek(Date.UTC(2026, 9, 19)), '2026-10-19');
  const trades = [{ mode: 'paper', pnlSol: 0.05, closedAt: now - 1000 }, { mode: 'paper', pnlSol: -0.01, closedAt: now - 2000 }, { mode: 'live', pnlSol: 9, closedAt: now - 1000 }, { mode: 'paper', pnlSol: 9, closedAt: Date.UTC(2026, 9, 5) }];
  const me = leagueEntry('  Jay  ', trades, now); assert.deepEqual(me, { v: 1, name: 'Jay', week, trades: 2, wins: 1, returnPct: 8 });
  const code = leagueCode(me); assert.match(code, /^WARRIOR-/); assert.deepEqual(readLeagueCode(code), me); assert.deepEqual(readLeagueCode(leagueCode({ ...me, name: 'José 😂' })).name, 'José 😂');
  assert.equal(readLeagueCode(code.replace(/.-/, 'x-')), null); assert.equal(readLeagueCode('hello'), null); assert.equal(readLeagueCode(code.slice(0, -1) + (code.at(-1) === 'a' ? 'b' : 'a')), null);
  const table = leagueTable([me, { ...me, name: 'Ana', returnPct: 12 }, { ...me, name: 'Bo', returnPct: 8 }, { ...me, name: 'Old', week: '2026-10-05' }], week);
  assert.deepEqual(table.rows.map((r) => `${r.place} ${r.name}`), ['1 Ana', '2 Bo', '2 Jay']); assert.equal(table.old.length, 1);
});

test('Scorecard: records ENTERs once, resolves them from later candles, and counts losers', () => {
  let { card, added } = recordSignals(blankCard(), { results: [enter, wait] }, { now: 5000 }); assert.equal(added, 1); assert.equal(card.signals[0].outcome, 'open'); assert.equal(card.samples, 1);
  ({ card, added } = recordSignals(card, { results: [enter] }, { now: 6000 })); assert.equal(added, 0, 'a coin already tracked is not recorded twice'); assert.equal(card.samples, 2);
  const s = card.signals[0], bar = (i, o, h, l, c) => ({ t: 1000 + i * 300_000, open: o, high: h, low: l, close: c });
  assert.equal(resolveSignal(s, [bar(0, 1, 2, 0.5, 1)]).outcome, 'open', 'the signal bar itself does not count');
  assert.deepEqual([resolveSignal(s, [bar(1, 1, 1.05, 0.99, 1.04), bar(2, 1.04, 1.12, 1.03, 1.1)]).outcome, resolveSignal(s, [bar(1, 1, 1.05, 0.99, 1.04), bar(2, 1.04, 1.12, 1.03, 1.1)]).resultPct], ['target', 10]);
  assert.deepEqual([resolveSignal(s, [bar(1, 1, 1.01, 0.94, 0.96)]).outcome, resolveSignal(s, [bar(1, 1, 1.01, 0.94, 0.96)]).resultPct], ['stop', -5]);
  assert.equal(resolveSignal(s, [bar(1, 1, 1.2, 0.9, 1.1)]).outcome, 'stop', 'a bar that touches both counts as the stop');
  assert.equal(resolveSignal(s, [bar(1, 0.9, 0.92, 0.88, 0.9)]).resultPct, -10, 'a gap below the stop is counted at the gap, not at the stop');
  const slow = resolveSignal({ ...s, maxHoldBars: 2 }, [bar(1, 1, 1.01, 0.99, 1.0), bar(2, 1, 1.03, 0.99, 1.02)]); assert.deepEqual([slow.outcome, slow.resultPct], ['time', 2]);
  assert.equal(expireSignal(s, 5000 + 86_400_000).outcome, 'open'); assert.equal(expireSignal(s, 5000 + 3 * 86_400_000).outcome, 'unknown');
  const sum = scoreSummary({ samples: 9, signals: [{ outcome: 'target', resultPct: 10 }, { outcome: 'stop', resultPct: -5 }, { outcome: 'stop', resultPct: -4 }, { outcome: 'time', resultPct: 1 }, { outcome: 'open' }, { outcome: 'unknown' }] });
  assert.deepEqual([sum.total, sum.closed, sum.wins, sum.losses, sum.open, sum.unknown, sum.winRatePct, sum.averagePct], [6, 4, 2, 2, 1, 1, 50, 0.5]);
  assert.equal(scoreSummary(blankCard()).winRatePct, null);
});
