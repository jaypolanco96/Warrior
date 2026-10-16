// How Warrior should feel, as rules. Pure functions: the page decides nothing about emotion by itself.
//  - A celebration happens only when a trade CLOSES with money actually made. Never for buying. Never for a loss.
//  - Practice wins celebrate too, and always say they are practice.
//  - A loss gets a calm, kind message with the facts. No alarm, no blame.
//  - The mascot's mood follows what is really going on.

const fmtSol = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)} SOL`;
const fmtPct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const valid = (t) => !!t && typeof t.symbol === 'string' && Number.isFinite(t.pnlSol) && Number.isFinite(t.pnlPct);
// Smaller than this is a wash, not a win or a loss: fees and rounding can land either side of zero.
export const WASH_SOL = 0.00005;

/** What to show when a trade closes in profit. Returns { kind: 'none' } for anything that is not a real, closed win. */
export function celebrationFor(trade, { firstWin = false } = {}) {
  if (!valid(trade) || trade.closed !== true || trade.pnlSol <= WASH_SOL) return { kind: 'none' };
  const pct = trade.pnlPct, kind = pct >= 8 ? 'roar' : pct >= 2 ? 'warrior' : 'chuckle', practice = trade.practice === true;
  const size = { chuckle: { warriors: 8, hearts: 5 }, warrior: { warriors: 18, hearts: 12 }, roar: { warriors: 36, hearts: 26 } }[kind];
  const cheer = { chuckle: 'A little win is still a win.', warrior: 'That one felt good.', roar: 'Now THAT is a warrior.' }[kind];
  const headline = `${fmtSol(trade.pnlSol)} on ${trade.symbol}`;
  const message = firstWin ? `Your first ${practice ? 'practice ' : ''}win! ${cheer}` : cheer;
  return {
    kind, ...size, practice, firstWin: !!firstWin, headline, message, detail: `${fmtPct(pct)}${practice ? ' · practice money' : ' after costs'}`,
    spoken: `${practice ? 'Practice win. ' : 'Win. '}${trade.symbol} closed ${fmtPct(pct)}, ${fmtSol(trade.pnlSol)}. ${message}`
  };
}

const WHY = { stop: 'It hit the stop', 'trailing-stop': 'The trailing stop caught it', time: 'It ran out of time', 'trend-break': 'The trend broke', manual: 'You closed it', target: 'It reached your target price', order: 'Your sell order filled', 'written-off': 'Its pool was emptied, so it could not be sold', bedtime: 'Your bedtime rule closed it', slice: 'A slice sold', step: 'A take-profit step sold part of it', 'pool-draining': 'Money was leaving its pool, so Warrior got out', 'holders-leaving': 'Its holders were leaving, so Warrior got out', 'profit-lock': 'The stop had moved up and kept part of the gain', 'sell-off': 'Selling took over, so Warrior got out', 'big-holders-selling': 'Its biggest holders were selling, so Warrior got out', 'took-out': 'Your rule took out what you put in', selftest: 'Practice round trip' };
/** What to show when a trade closes at a loss or a wash. Kind, factual, and never shaming. */
export function comfortFor(trade) {
  if (!valid(trade) || trade.closed !== true || trade.pnlSol > WASH_SOL) return { kind: 'none' };
  const practice = trade.practice === true, wash = Math.abs(trade.pnlSol) <= WASH_SOL, why = WHY[trade.reason] ?? 'It closed';
  if (wash) return { kind: 'wash', practice, headline: `${trade.symbol}: about even`, message: `${why}. No harm done.`, detail: practice ? 'practice money' : 'after costs', spoken: `${trade.symbol} closed about even. No harm done.` };
  const protectedByRule = ['stop', 'trailing-stop', 'trend-break', 'time'].includes(trade.reason);
  const message = trade.reason === 'written-off' ? `${why}. That is not a mistake you made: it is the risk every young coin carries, and the reason Warrior keeps each bet small.` : protectedByRule ? `${why}, and that rule did its job: it kept this one small.` : `${why}. Small losses are part of trading.`;
  return {
    kind: 'comfort', practice, headline: `${fmtSol(trade.pnlSol)} on ${trade.symbol}`, message,
    detail: `${fmtPct(trade.pnlPct)}${practice ? ' · practice money, nothing real was lost' : ' after costs'}`,
    spoken: `${trade.symbol} closed ${fmtPct(trade.pnlPct)}, ${fmtSol(trade.pnlSol)}. ${message}`
  };
}

const NAPS = ['Nothing worth chasing right now. I am napping with one eye open.', 'Quiet market. Sitting on our hands is a real strategy.', 'No good setups. I would rather be bored than broke.', 'Everything out there is either overbought or half asleep. Like me.'];
/**
 * The mascot's face and one line, from what is true right now.
 * `recent` is the last closed trade outcome within the past minute, if any: 'win' | 'loss'.
 */
export function moodFor({ scanning = false, failed = false, enters = 0, forming = 0, recent = null, tick = 0 } = {}) {
  if (recent === 'win') return { mood: 'delighted', face: '😂', line: 'Ha! Love that.' };
  if (recent === 'loss') return { mood: 'gentle', face: '🤗', line: 'That is okay. We kept it small.' };
  if (failed) return { mood: 'unsure', face: '😶‍🌫️', line: 'I cannot see the market right now. Trying again shortly.' };
  if (scanning) return { mood: 'looking', face: '🧐', line: 'Looking around…' };
  if (enters > 0) return { mood: 'excited', face: '🤩', line: `${enters} setup${enters === 1 ? '' : 's'} I like. Check the green card${enters === 1 ? '' : 's'}.` };
  if (forming > 0) return { mood: 'curious', face: '👀', line: `${forming} coin${forming === 1 ? ' is' : 's are'} getting interesting. Not yet.` };
  return { mood: 'sleepy', face: '😴', line: NAPS[Math.abs(Math.trunc(tick)) % NAPS.length] };
}

/** Plain-word explanations for every number Warrior shows. */
export const GLOSSARY = Object.freeze({
  Price: 'What one coin costs right now, in US dollars.',
  'Young coin': 'This coin has traded for less than five hours. Warrior reads it on one-minute candles instead of five-minute ones, uses the widest stop your rules allow and trades it at half size. Young coins move fast in both directions and are where most rug pulls happen.',
  'Recent bias': 'The direction of the last fifteen-minute stretches. For young coins this stands in for the hourly bias.',
  '1h': 'How much the price moved in the last hour.',
  Regime: 'The kind of market this coin is in: going up, going down, drifting sideways, or too wild to trade.',
  'Hourly bias': 'Which way the bigger, slower trend is leaning. Warrior avoids buying when it leans down.',
  Liquidity: 'How much money sits in the pool you would trade against. More means you can get in and out without moving the price.',
  '24h volume': 'How much of this coin changed hands in the last day. Low volume means it is hard to sell.',
  Stop: 'The price where Warrior sells to keep a loss small.',
  Target: 'The price where Warrior takes the profit.',
  'Price impact': 'How much your own trade costs you, including the pool fee. On pump.fun pools this is about 1% each way.',
  'Slippage limit': 'The most the price may move against you while the trade goes through. Past that, the trade is cancelled.',
  trend: 'Is the price above its recent averages? That means buyers are in control.',
  momentum: 'Is the move speeding up without being overheated?',
  participation: 'Is real volume behind the move, or just a few trades?',
  structure: 'Did the price break above its recent high, or bounce off its trend line?',
  'At risk': 'The SOL currently sitting in open positions. This is the most those positions could lose if they went to zero.'
});
