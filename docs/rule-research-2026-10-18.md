# Rules research · October 18, 2026

Owner requested a 15-minute research pass, implementation of supported improvements, then commit/push. Research began at 03:46 UTC. Baseline: `cbac2a4`. Public Jupiter discovery/chart data only; no wallet, owner trade journal, signing or transfer APIs were used.

## Promoted change

Balanced and Spicy now use a four-hour holding limit instead of three. Chill already used four. Stops, targets, profit steps, sizes, safety checks and ADAPT bounds are unchanged. The existing self-ruling clock can still move between two and five hours with evidence and probation. New versions: Balanced `balanced-f70eb3`, Spicy `spicy-21d477`; Chill remains `chill-772709`.

The main sample contained 375,469 clean five-minute candles from 114 deterministically sampled current coins, covering up to roughly 21 days. An older, non-overlapping check added 178,088 candles from the same frozen discovery sample over roughly 10 days. Not all coins existed throughout both periods. Downloads initially hit HTTP 429; the collector was slowed to one request per 400 ms with 30-second throttle backoff, then incomplete downloads were retried. The final datasets had zero failed requests.

Twelve configurations (baseline plus 11 hypotheses) were replayed for each strength, at 1.5% and 3% assumed round-trip costs and two trailing-stop interpretations. Main data was split by time before comparison, with a separate deterministic coin split. Four-hour holds improved both main time splits and both coin groups, at both costs and both trailing interpretations, and improved the separate older check. Five-hour holds, RSI 30, depth 11%, volume $50K/h, a 5% daily collapse limit, 15% targets, eight-hour loss cooldown and 7%/8% profit steps were not promoted: they failed consistency, generalization, or provided no gain. Adding profit steps to Chill was also rejected.

The table uses the stricter production-style trailing interpretation and 3% assumed costs. Values are average percentage changes on independent replayed positions, not wallet returns.

| Sample / strength | Baseline positions | Baseline average | Four-hour positions | Four-hour average |
| --- | ---: | ---: | ---: | ---: |
| Main / Balanced | 31 | +3.37% | 31 | +4.12% |
| Main / Spicy | 47 | +2.18% | 47 | +2.82% |
| Older / Balanced | 8 | -4.43% | 9 | +1.77% |
| Older / Spicy | 11 | -4.36% | 12 | +1.20% |

A separate one-SOL capital sensitivity used the actual position-size, reserve, slot and daily-loss functions. At 3% costs, main-period final simulated balances changed from 1.1063 to 1.1323 SOL for Balanced and 1.1565 to 1.2099 for Spicy; older-period balances changed from 0.9648 to 1.0156 and 0.9292 to 1.0200 respectively. No candidate was refused for capital/slots in these sparse samples. Partial proceeds were conservatively retained until final exit, and open positions valued at cost, so this is a sensitivity model rather than a reconstruction of live wallet equity or intraday drawdown.

Removing the strongest contributing coin from the combined periods still left a positive comparative gain for both strengths at both costs. An exploratory paired coin-cluster bootstrap (5,000 resamples, seeded LCG 417, multiplier 1664525, increment 1013904223) also gave positive lower bounds for the combined comparison. This does not correct current-list survivorship, cross-coin market correlation, or multiple hypothesis testing; it is supporting evidence, not proof of future profits.

## Replay boundaries

`scripts/research-rules.mjs` freezes the previous three-hour baseline even after this promotion. It calls shared `analyze`, `manage`, `partialDue` and `positionSize` logic. Signals use only completed 200-candle windows; historical hourly volume and 24-hour change come from the preceding candles. A full, contiguous 24-hour history and six-hour forward runway are required. Trades enter at the next bar open with modeled entry costs. Existing stops are checked before targets; stop gaps and target wicks receive adverse market-close fills rather than guaranteed limit fills. Both previously earned and same-bar trailing interpretations are tested. Partial sales use closing quotes after costs. Cooldowns and full-position costs are retained. Incomplete positions are not booked.

Limitations: current discovery lists introduce survivorship/selection bias; historical liquidity, token authorities, executable quotes, activity-ranked scan availability and smart-wallet observations are unavailable. Those production checks are not reproduced. Only the regular five-minute path for coins at least five hours old is studied; young one-minute and Rocket strategies are excluded. Costs are assumptions, not historical quotes, and fixed fees/rent recovery are not reconstructed. Sparse qualifying trades, especially in the older check, limit confidence. The change has no demonstrated live profit result.

Public dataset fingerprints, coverage and all configuration summaries are retained in [rule-research-2026-10-18.json](rule-research-2026-10-18.json). Raw public candles stay in the local research directory to avoid committing large candle files. The existing Jupiter datapi feeds are undocumented and can change.

Reproduce with Node 22+, using a dedicated output directory:

```powershell
node scripts/research-rules.mjs collect "$env:TEMP/warrior-research"
node scripts/research-rules.mjs resume "$env:TEMP/warrior-research"
node scripts/research-rules.mjs run "$env:TEMP/warrior-research"
$env:RESEARCH_LITERAL_TRAILING='1'
node scripts/research-rules.mjs run "$env:TEMP/warrior-research"
node scripts/research-rules.mjs older "$env:TEMP/warrior-research-older" "$env:TEMP/warrior-research"
node scripts/research-rules.mjs run "$env:TEMP/warrior-research-older"
```

## Self-ruling correctness fixes

The audit found that practice/live evidence was filtered, but their dial, proposal, probation and resting state shared the same strength book. These now live separately under `state.adapt.books[mode][preset]`. Unscoped legacy decisions cannot safely be assigned to either mode: original data is retained, history is shown as archived, and each mode starts from tested defaults. A notice explains this in the existing self-ruling panel; no new buttons were added.

New watch observations record the actual rules and mode. Automated proposals use only recent, attributable observations under the active rule version, preventing old outcomes from repeatedly pushing a new dial. Mode-aware missed-candidate deduplication and dip weather prevent practice observations from suppressing live observations or controlling the optional live guard. Historical reports remain available; evidence must accumulate under the new version before it can move that version's dials.

Validation includes shared-engine clock/stop tests, replay fill/cost/gap tests, mode-isolation and legacy-migration tests, plus isolated browser checks that fresh current-rule evidence still proposes a bounded move while stale and cross-mode evidence does not.

Current acceptance: 108 unit tests, production build, and 243 isolated browser checks passed. An additional 88 comparative promotion assertions passed across both datasets, both costs, both trailing interpretations, time/coin splits, exclusion of the two best trades, and the capital sensitivity model. Historical percentage sums are never presented as compounded wallet returns.
