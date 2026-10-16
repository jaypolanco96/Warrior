// Warrior Coach and "Why not?". Pure text built from the facts Warrior already has. It explains; it never predicts.

const usd = (n) => !Number.isFinite(n) ? 'an unknown price' : n >= 1 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${n.toPrecision(4)}`;
const GROUPS = { trend: 'trend', momentum: 'momentum', participation: 'volume', structure: 'price structure' };
const NEEDS = {
  trend: 'price above its 20-bar average, with that average above the 50-bar one',
  momentum: 'RSI between 50 and 78 with MACD rising',
  participation: 'a surge to at least 1.3 times its recent average, with price above VWAP',
  structure: 'a close above the last 20 bars\' high, or a bounce off the 20-bar average'
};
const list = (words) => words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/**
 * "Why not?": every rule that said no, what it saw, and what would have to change.
 * `token` is a scanner or lookup result (analysis, optional screen); `rules` is the resolved rule set.
 */
export function whyNot(token, rules) {
  const a = token?.analysis ?? {}, s = rules?.settings ?? {}, r = rules?.risk ?? {}, out = [], add = (rule, said, change) => out.push({ rule, said, change });
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  for (const reason of token?.screen?.reasons ?? []) {
    if (/Liquidity too thin/.test(reason)) add('Safety screen: pool size', `The pool holds ${Number.isFinite(token.liquidityUsd) ? money(token.liquidityUsd) : 'an unknown amount'}.`, `It needs at least ${money(r.minLiquidityUsd)}.`);
    else if (/Volume too low/.test(reason)) add('Safety screen: trading volume', `It traded ${Number.isFinite(token.volume24hUsd) ? money(token.volume24hUsd) : 'an unknown amount'} in 24 hours.`, `It needs at least ${money(r.minVolume24hUsd)}.`);
    else if (/Pool too new/.test(reason)) add('Safety screen: pool age', 'The pool is younger than Warrior allows. Most rug pulls happen in the first hours.', `It has to be at least ${r.minAgeHours} hours old. Waiting fixes this one.`);
    else if (/not locked/.test(reason)) add('Safety screen: pool money', "It trades on pump.fun's exchange but was not launched on pump.fun, so whoever funded its pool can take the money out at any moment.", 'Nothing you or Warrior can do changes this. Warrior will not trade it.');
    else if (/frozen/.test(reason)) add('Safety screen: freeze', 'The creator can freeze this coin in your wallet.', 'Only the creator giving up that power changes this. Warrior will not trade it until then.');
    else if (/mint more/.test(reason)) add('Safety screen: supply', 'The creator can still print more of this coin.', 'Only the creator giving up that power changes this. Warrior will not trade it until then.');
    else if (/unknown/i.test(reason)) add('Safety screen: missing facts', `${reason}.`, 'Warrior treats unknown as unsafe. It needs the data source to report this.');
    else add('Safety screen', `${reason}.`, 'This has to clear before Warrior will trade it.');
  }
  // Warrior is buying it (a trend buy, a deep dip or a smart-wallet buy) and the screen passes: there is no "why not".
  if (a.decision === 'enter' && token?.screen?.ok !== false) return out;
  if (a.quiet) { add('Too quiet', `${a.reasons?.[0] ?? 'Not enough trading in the last hour'}.`, 'It has to trade steadily for an hour first. Busy coins move sooner and cost less to sell.'); return out; }
  if (!a.confirmations) { add('Price history', (a.reasons ?? ['No usable candles'])[0] + '.', /your rules wait/.test(a.reasons?.[0] ?? '') ? 'Wait until the coin is five hours old, or switch young coins on in the strategy dial.' : a.young ? 'A young coin needs about an hour of steady trading before Warrior can read it. Waiting usually fixes this.' : 'Warrior needs at least 60 clean, recent five-minute candles. Waiting usually fixes this.'); return out; }
  if ((a.reasons ?? []).some((x) => /stale/i.test(x))) add('Fresh prices', 'The latest candle is more than 15 minutes old.', 'A new trade has to print. Warrior will not judge a coin on old prices.');
  if (a.regime === 'chaos') add('Regime: chaos', `Each bar swings about ${a.atrPct?.toFixed(1)}% of the price.`, `It has to calm to under ${s.chaosAtrPct}% so a stop can be sized.`);
  if (a.regime === 'downtrend') add('Regime: downtrend', 'The 20-bar average is below the 50-bar average.', 'The short average has to climb back above the long one.');
  if (a.bias === 'bearish') add('Hourly bias', 'The one-hour averages point down.', 'The hourly picture has to turn flat or up.');
  const rsiCap = s.maxEntryRsi ?? 78; if (Number.isFinite(a.rsi) && a.rsi > rsiCap) add(rsiCap >= 78 ? 'Overbought' : 'Your RSI limit', `RSI is ${a.rsi.toFixed(0)}${rsiCap >= 78 ? ': the spike already happened' : `, above your limit of ${rsiCap}`}.`, `RSI has to cool to ${rsiCap} or below.`);
  if (s.maxStretchPct > 0 && Number.isFinite(a.stretchPct) && a.stretchPct > s.maxStretchPct) add('Waiting for a dip', `The price is ${a.stretchPct.toFixed(1)}% above its 20-candle average.`, `It has to come back to within ${s.maxStretchPct}% of that average. That is the dip you asked Warrior to wait for.`);
  if (s.deepDip === 1 && a.decision !== 'enter' && Number.isFinite(a.rsi) && Number.isFinite(a.stretchPct) && a.stretchPct < 0) add('Not a deep dip yet', `RSI ${a.rsi.toFixed(0)}, ${Math.abs(a.stretchPct).toFixed(1)}% under its 20-candle average.`, `A deep dip needs RSI ${s.dipRsi} or under and at least ${s.dipBelowPct}% under the average.`);
  const missing = Object.entries(a.confirmations).filter(([, lit]) => !lit).map(([k]) => k);
  if (Number.isFinite(a.score) && a.score < s.minConfluence) add('Signal groups', `${a.score} of 4 agree; your rules need ${s.minConfluence}. Missing: ${list(missing.map((k) => GROUPS[k]))}.`, `${s.minConfluence - a.score} more must agree. ${missing.map((k) => `${GROUPS[k][0].toUpperCase()}${GROUPS[k].slice(1)} needs ${NEEDS[k]}`).join('. ')}.`);
  if (!out.length && a.decision !== 'enter') for (const reason of a.reasons ?? []) add('Rule', `${reason}.`, 'This has to clear first.');
  return out;
}

/** Before a trade: one sentence on why, one on what would make it wrong. */
export function coachBefore(token, rules) {
  const a = token?.analysis ?? {}, screenOk = token?.screen?.ok !== false;
  if (a.decision === 'enter' && screenOk && a.style === 'smart') return { stance: 'enter', why: `${a.smartNote}. These wallets kept buying just before pumps on other coins; in Warrior's test a pump followed about twice as often when two of them bought.`, wrongIf: `This is wrong if it falls to ${usd(a.stop)} (−${a.stopPct?.toFixed(1)}%). Smart wallets are wrong too, and that is where Warrior gets out.` };
  if (a.decision === 'enter' && screenOk && a.style === 'dip') return { stance: 'enter', why: `${a.dipNote}. Coins this stretched downward bounced more often than not in Warrior's test, though only slightly ahead after costs.`, wrongIf: `This is wrong if it keeps falling to ${usd(a.stop)} (−${a.stopPct?.toFixed(1)}%). That is where Warrior gets out, no arguing.` };
  if (a.decision === 'enter' && screenOk) {
    const lit = Object.entries(a.confirmations ?? {}).filter(([, v]) => v).map(([k]) => GROUPS[k]);
    return {
      stance: 'enter',
      why: `${lit.length ? `${list(lit)[0].toUpperCase()}${list(lit).slice(1)} agree` : 'The signal groups agree'}, in ${a.regime === 'uptrend' ? 'an uptrend' : `a ${a.regime}`} with ${a.bias === 'bullish' ? 'a rising' : 'a flat'} hour behind it.`,
      wrongIf: `This is wrong if the price falls to ${usd(a.stop)} (−${a.stopPct?.toFixed(1)}%). That is where Warrior gets out, no arguing.${a.young ? ' It is a young coin read on one-minute candles, so Warrior trades it at half size.' : ''}`
    };
  }
  const first = whyNot(token, rules)[0];
  return { stance: 'wait', why: first ? `Warrior would wait: ${first.said.replace(/\.$/, '')}.` : 'Warrior would wait: the rules are not met.', wrongIf: first ? `It changes its mind when this does: ${first.change.replace(/\.$/, '')}.` : 'It changes its mind when the rules are met.' };
}

const minutes = (ms) => { const m = Math.round(ms / 60_000); return m < 1 ? 'under a minute' : m < 90 ? `${m} minute${m === 1 ? '' : 's'}` : `${(m / 60).toFixed(1)} hours`; };
/** After a trade: one sentence on what happened, one on what was learned. No blame, no bragging. */
export function coachAfter(trade) {
  if (!trade || !Number.isFinite(trade.pnlSol) || !Number.isFinite(trade.pnlPct)) return { happened: 'The trade closed.', learned: 'There is not enough on record to say more.' };
  const up = trade.pnlSol > 0, amount = `${up ? '+' : '−'}${Math.abs(trade.pnlSol).toFixed(4)} SOL (${up ? '+' : '−'}${Math.abs(trade.pnlPct).toFixed(1)}%)`;
  const held = Number.isFinite(trade.openedAt) && Number.isFinite(trade.closedAt) && trade.closedAt > trade.openedAt ? ` after ${minutes(trade.closedAt - trade.openedAt)}` : '';
  const how = { target: 'It reached the target', stop: 'It hit the stop', 'trailing-stop': 'The trailing stop closed it', time: 'It ran out of time', 'trend-break': 'The trend broke and Warrior got out', manual: 'You closed it yourself', order: 'Your sell order filled', slice: 'A slice was sold', step: 'Your take-profit step sold part of it', 'pool-draining': 'Money was leaving its pool, so Warrior got out', 'holders-leaving': 'Its holders were leaving, so Warrior got out', 'profit-lock': 'It gave back part of its gain, and the stop that had moved up kept the rest', 'sell-off': 'Selling took over, so Warrior got out', 'big-holders-selling': 'Its biggest holders were selling, so Warrior got out', 'took-out': 'Your rule took out what you put in', 'written-off': 'Its pool was emptied and it was written off', bedtime: 'Your bedtime rule closed it', selftest: 'The practice round trip finished' }[trade.reason] ?? 'It closed';
  const learned = {
    target: up ? 'The plan worked as written. One win proves little; the scorecard is what counts.' : 'It reached the price you set, which was below what you paid. A small planned loss beats hoping.',
    stop: 'The stop did its job and kept this one small. Small losses are the price of finding winners.',
    'trailing-stop': up ? 'Letting it run while moving the stop up kept part of the move.' : 'The stop had moved up to protect you, and still cost a little. That is normal.',
    time: 'Nothing much happened in the time allowed. Money that sits still is better moved.',
    'trend-break': 'When the reason for a trade goes away, leaving beats hoping.',
    manual: up ? 'You took the gain yourself. Check the receipt to see what the rules would have waited for.' : 'You cut it yourself. Getting out when unsure is never a mistake.',
    order: 'You set the price ahead of time and stuck to it. Deciding before the moment is the whole trick.',
    slice: 'Selling in parts means no single moment decides your result.',
    step: 'Part of the gain is now real money, and the rest is still in the trade.',
    'profit-lock': 'Once a bet has been well up, its stop moves above what you paid, so it should not end as a real loss. Selling costs can still leave it a little under.',
    'sell-off': 'Far more money was selling than buying and the price was falling. Leaving then costs less than waiting for the stop.',
    'big-holders-selling': 'The wallets holding the most were cutting their share. When they leave, the price usually follows.',
    'holders-leaving': 'When four in ten of the people who held a coin have gone, the price usually follows. Leaving early costs less than leaving last.',
    'pool-draining': 'When the money that lets you sell starts leaving, waiting for the stop can mean there is nothing left to sell into.',
    'took-out': 'What you put in is back in the wallet. Whatever happens to the rest, this trade cannot cost you your stake.',
    'written-off': 'No stop can sell into an empty pool. What limited the damage was the size of the bet, which is why Warrior keeps bets small.',
    bedtime: 'You decided this before you were tired. Sleeping with nothing open is a result too.'
  }[trade.reason] ?? 'Every closed trade goes on your record, good or bad.';
  return { happened: `${how}${held}: ${amount}${trade.practice || trade.mode === 'paper' ? ', practice money' : ''}.`, learned };
}
