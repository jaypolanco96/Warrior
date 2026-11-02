# SOL economy rules research · November 2, 2026

The owner asked Warrior to trade only good SOL economy coins from a market-cap floor, and for tests to find better rules. **No candidate rule cleared the bar, so the buy and sell rules did not change.** The universe did.

## What changed

Warrior's scan now reads only Jupiter-verified coins with at least $10M market cap and $250K 24-hour volume, excluding dollar coins, staked SOL, tokenised shares, wrapped outside coins and pool tokens (`lib/market.mjs`, `ECONOMY`). Trending, pump.fun and launch feeds no longer reach the scan. The floor is a product choice supported by, not proven by, this test: all three finalists used it, and floors from $5M to $25M scored similarly before the holdout.

## Method

The bar and three finalists were locked before the holdout was read. 258 coins, about 94 days of 15-minute public candles, next-bar-open entry, stop first within a bar, one position per coin, 1.5% round-trip costs with a 3% stress. Train and validation chose from 1,170 entry, regime and exit combinations, then 4,500 exit variants, then 108 floor variants, covering RSI and stretch dips, Bollinger dips, volume capitulation, RSI reclaim, trend pullbacks, breakouts, relative strength, MACD turns, and SOL and breadth regimes. The holdout was the last 19 days. Scripts: `scripts/research-economy/`. Figures: [the JSON](sol-economy-research-2026-11-02.json).

## Holdout result (last 19 days, SOL -11.7%)

| Rule | Trades | Mean | Win | Mean at 3% cost | Failed |
|---|---|---:|---:|---:|---|
| F1: RSI ≤35, 8% under EMA20, stop 20, target 12, 96h | 23 | +2.87% | 74% | +2.10% | Under 40 trades; one coin bucket negative |
| F2: F1 with SOL above its 4h EMA50 | 3 | -10.01% | 33% | -10.69% | Nearly everything |
| F3: RSI ≤25, 8% under EMA20, stop 15, target 8, 48h | 17 | +2.75% | 76% | -0.49% | Under 40 trades; negative at 3% cost |
| Current Balanced rule, 5-minute replay | 15 | +0.66% | 67% | -0.92% | Comparison only |
| Random daily entry, F1 exit | 170 | -3.26% | 39% | | Comparison only |

F1 is the lead to keep watching: it was positive in all three periods and beat both comparisons, but its holdout sample is too small and rests on few coins. It needs roughly 62% wins just to break even.

## Limits

Survivorship flatters every figure, most of all wide stops, because the coin list holds only coins alive today. Historical market cap uses today's supply. Candles cannot reproduce quotes or slippage. Thousands of variants were searched before selection, and the periods overlap one market only. None of this is a return forecast or a promise of profit. A coin's Jupiter verification is not a safety certification; the shield still applies.
