# 😂 Warrior

**Site:** https://WARRIOR_HOST

Warrior trades Solana meme coins and pump.fun coins by rule, with an option to include mature coins such as JUP, RAY, BONK and WIF. It only swaps SOL for a coin and back: no borrowing, no leverage.

**Warrior can lose money. It never promises a profit.** Meme coins can fall to nothing in minutes. Only trade what you can afford to lose.

## Three ways to trade

### 1. On the site: you approve each trade

1. Open the site and press **Connect wallet** (Phantom or Solflare).
2. The scanner lists coins with a verdict: **ENTER** or **WAIT**, with the reasons.
3. Press **Trade this signal**, check the amount, then **Approve in wallet**. Your wallet shows exactly what leaves and what arrives.
4. Your position appears under **My positions** with its stop and target. Press **Sell back to SOL** to close it.

The site holds no key and cannot move anything without your approval.

### 2. Auto-trade in the browser tab

The site can trade by itself while its tab is open. It uses a separate small trading wallet that is created in your browser.

1. Practice first. With no wallet at all, press **Practice buy** on any coin, or press **Start practice auto-trading** under **Auto-trade in this tab**. It uses a pretend 0.5 SOL with real prices and real quotes.
2. For real trading, switch the mode to **Live**, press **Create my trading wallet** and choose a passphrase. The passphrase cannot be reset.
3. Press **Save my backup key** and follow the three steps. Funding and live trading stay locked until you do.
4. Connect Phantom, enter an amount and press **Send to trading wallet**, approve in Phantom, tick the acknowledgement and press **Start auto-trading**.
5. **Stop** halts it. **Get me out** (always at the bottom of the screen) stops and sells everything. **Withdraw all SOL to Phantom** sends the money back to the connected wallet.

The trading wallet's key is stored in that browser only, encrypted with your passphrase, and is never sent to a server: the page signs transactions itself and the server only relays the signed result. After a reload the wallet is locked until you type the passphrase (or use a passkey, if you added one). **Restore from a backup key** rebuilds it on another device. **Sweep winnings home** sends spare SOL back to your connected wallet after a sale. Clearing the site's data, losing the device or forgetting the passphrase loses the wallet unless you saved the backup key. Keep the tab open and the device awake; browsers slow down hidden tabs.

### 3. The bot: automatic, on your own computer

A browser wallet asks you to approve every transaction, so it cannot trade while you are away. The bot has its own small wallet on your PC and trades by itself.

```
npm install
npm run wallet               # creates the bot wallet (asks for a passphrase), prints its address
npm run wallet -- --backup   # shows the backup key; save it before funding
```

Send that address some SOL from Phantom. Start small. Then:

```
npm run bot             # practice mode: real market data, pretend 0.5 SOL, nothing is sent
npm run bot:selftest    # practice mode: force one pretend buy and sell to check everything works
npm run bot:live        # live mode: real swaps from the bot wallet
```

Options when starting the bot:

- `--preset=chill`, `balanced` or `spicy`, and `--set=targetPct:15,riskPerTradePct:1` for exact numbers. This is the site's strategy dial.
- `--mature` to also trade established coins, `--interval=120` seconds between scans, `--max-sol=0.3` to cap how much of the wallet the bot may use.
- `--priority=off`, `normal`, `fast` or `turbo`, and `--protect` to send through Jito's block builders.
- `--stop-at=23:00 --close-by=00:00 --wake=07:00` for bedtime rules, in your computer's clock. Leave out `--close-by` to keep positions overnight.
- `--follow=ADDRESS:name` to follow up to three wallets, and `--copy` to also buy what they buy, inside the rules.

Example: `npm run bot:live -- --preset=chill --mature --max-sol=0.3 --stop-at=23:00`.

While the bot runs, use a second terminal to talk to it. Add `--live` to address the live bot.

```
npm run warrior -- help                                  # every command
npm run warrior -- lookup bonk                           # verdict, coach and "why not?"
npm run warrior -- safety COIN_ADDRESS
npm run warrior -- status                                # positions, orders, slices, results
npm run warrior -- buy-below COIN_ADDRESS 0.000021 0.05  # buy 0.05 SOL if it gets cheaper
npm run warrior -- sell-above BONK 0.000030 50           # sell half if it gets dearer
npm run warrior -- exits BONK --stop=0.000018 --target=0.000035
npm run warrior -- slices-buy COIN_ADDRESS 0.3 3 10      # 3 buys, 10 minutes apart
npm run warrior -- slices-sell BONK 2 10
npm run warrior -- history --csv=trades.csv
npm run warrior -- receipt                               # the honest receipt for the latest trade
npm run warrior -- story                                 # today, as a short story
npm run warrior -- get-me-out                            # sell everything now
```

The bot picks up instructions within 30 seconds and prints the result in its own window.

Stop it with Ctrl+C. Open positions stay open until you start it again. To take your money back:

```
npm run wallet -- --withdraw YOUR_PHANTOM_ADDRESS
```

That sends the bot wallet's SOL. Coins it still holds are not sold by this command, so let the bot close its positions first.

The bot wallet's key is the file `.warrior/wallet.json` on your PC, encrypted with your passphrase. It is never uploaded or committed. The bot asks for the passphrase when it starts in live mode. `npm run wallet -- --protect` locks a wallet file made before passphrases existed, and `npm run wallet -- --restore` rebuilds the wallet from its backup key. Keep only trading money in it. For faster, more reliable trading, copy `.env.example` to `.env` and set `SOLANA_RPC_URL` to a dedicated RPC.

## The tools

Everything below works with practice money first. Orders, slices, your own stops and alerts run only while a Warrior tab is open on your device.

- **Trending now.** The coins the most people are trading over the last 5 minutes, hour, 6 hours or day, hottest first, each marked as passing or failing the safety screen. Trending is not a signal. Press **Warrior's verdict** on any of them for the full reading.
- **Look up any coin.** Type a name or ticker, or paste a coin address. You get the same verdict the scanner gives, with reasons and the safety screen's answer.
- **Safety check.** On any coin, press **Safety check, watch, orders**. It shows how much the top 10 holders own, what the creator still holds, how the coin launched, whether it can be frozen or printed, the pool's age and size, and what a 1 SOL and a 5 SOL buy would cost. Anything Warrior cannot read is shown as unknown. Earlier coins by the same creator are not available yet.
- **Watchlist.** Up to eight coins, re-checked every two minutes. Warrior tells you when one turns into an ENTER.
- **Your own orders.** From a coin: **buy if it gets cheaper** (a price below today's and an amount). From a position: **sell if it gets dearer**, and **my stop and target**, which work alongside Warrior's automatic ones. Orders wait up to seven days.
- **Slices.** Buy in 2 to 12 equal parts over time, or sell a position the same way. A late slice never bunches up with the next one.
- **Strategy dial.** **Chill**, **Balanced** or **Spicy** set how many signal groups must agree, the target, the stop and the size of each bet. **Exact numbers** lets you change them one by one. Every trade is stamped with a rules version such as `balanced-73bdb3`. The cost limits and the safety screen are not on the dial.
- **Position details.** Every position card shows the coin's full address (with Copy and a Solscan link), when and why it was opened, and a fold-out **About this coin** with the creator's own description and links when the data source has them. That text is the creator's, not Warrior's, and is not checked.
- **Portfolio and results.** What you hold, what it cost, about what it is worth, closed results, and a trade history you can download as a spreadsheet file. Trading-wallet results are measured from the wallet's balance, so every fee is included.
- **Alerts.** Always shown on the page. Turn on **Alerts** to also get a browser notification when the tab is in the background.
- **Follow a wallet.** Paste a public wallet address. Warrior lists what it bought and gives its verdict on each buy. Copying is off unless you switch it on. In practice it copies coins that pass the safety screen; with real funds it copies only when Warrior also says ENTER.
- **Coin account rent.** Solana sets aside about 0.002 SOL the first time a wallet buys a coin. Switch on **close the coin's empty account** under the trading wallet (or start the bot with `--reclaim`) to get it back after each full sale, or press **Close my empty coin accounts now**. Not used with real funds yet.
- **How trades are sent.** A priority fee setting and **protected sending** (straight to block builders through Jito) for the trading wallet. Protected sending has not been used with real funds yet.

## Things only Warrior has

- **Warrior Coach.** Every coin card has two sentences: why Warrior would trade or wait, and what would make that wrong. After a trade closes, two more: what happened and what it teaches.
- **Why not?** On any coin Warrior will not call, a button lists each rule that said no and what would have to change.
- **Honest receipt.** Every closed trade has a receipt: what you put in, the cost of buying, the cost of selling, network fees, what you got out and the true result. Costs are rounded up and results are rounded down. For the trading wallet the fees are measured from its balance. For a trade you approved in Phantom they are marked "not measured".
- **Public scorecard.** A recorder looks at the market every hour, writes down every ENTER call, and later marks whether the price reached the target, hit the stop or ran out of time. Losers stay on it. It measures the call before costs; it is not anyone's profit.
- **Mood guard.** If you buy by hand right after losses, go straight back into a coin you just lost on, or bet much bigger while down for the day, Warrior says so and offers a 10-minute breather. "Go ahead" is always there and nothing is locked.
- **Bedtime rules.** "Stop opening trades at 11 pm, close everything by midnight, start again at 7 am." It applies to everything Warrior does by itself while a tab is open (or in the terminal bot).
- **My day.** A short story of the day: what Warrior watched, what it skipped and why, what you traded.
- **Warrior cards.** A picture of a winning trade with the true numbers on it, clearly marked practice or real.
- **Practice league.** Swap codes with friends and compare practice results each week. There is no real-money table, on purpose. Codes run on honour.

## Trust

- **Status line.** The top of the site says whether each service Warrior depends on is answering. When one is down, Warrior waits; it does not guess. Anything that fails in the background is listed there.
- **Monitor.** Every hour a job checks the live site and its data sources. If something is wrong the job fails and GitHub emails the repository owner.
- **Plain-language pages.** [The risks](https://WARRIOR_HOST/risk), [terms](https://WARRIOR_HOST/terms) and [privacy](https://WARRIOR_HOST/privacy). They are drafts: a lawyer has not reviewed them.
- **Install like an app.** Use the browser's Install or Add to Home Screen. It opens without a connection, but only trades and alerts while it is open.
- **How did that feel?** A one-tap comfort check that stays on the device unless the person copies their answers.
- **No fee.** Warrior charges nothing. Every receipt has a "Warrior's fee" line so that could never change unseen.
- **Not yet done:** an independent security review, a lawyer's review, and any trade with real money. See [docs/owner-checklist.md](docs/owner-checklist.md) and [docs/security-self-review.md](docs/security-self-review.md).

## The rules

- **Four signal groups; three must agree.** Trend (price above the 20 and 50 averages), momentum (RSI 50–78 with MACD rising), volume (a surge with price over VWAP), structure (a breakout or a bounce off the trend line).
- **Regime and bias.** No entries in a downtrend, in wild volatility, when the hourly bias is bearish, or when a coin is already overbought.
- **Rocket Mode** (off by default, under Auto-trade). Small bets on pump.fun coins one to sixty minutes old, aiming for a very large gain (the default target is +1,000%). A strict screen refuses anything that is not a real pump.fun launch, has a creator who can print or freeze, concentrated holders, heavy sniper, insider or bundled-wallet holdings, too few holders, a tiny pool, more selling than buying, or a creator who launches coins by the dozen. Creators with at least three earlier coins, half of them graduated, are highlighted; that is a record, not trust. Each bet has its own stop, target and trailing stop, and there are caps on open bets and bets per day. Most Rocket bets lose. Rules in `lib/rocket.mjs`; the terminal bot takes `--rocket`.
- **Young coins.** A coin with one to five hours of trading is read on one-minute candles: the same four signal groups, the widest stop the rules allow and half the usual size. Chill leaves them alone. Coins under an hour old are never traded.
- **Pool money must be locked where Warrior can tell.** A coin that trades on pump.fun's exchange but was not launched on pump.fun is refused: whoever funded that pool can empty it. (A coin of this kind passed the screen on October 12, 2026 and its pool was emptied twenty minutes after Warrior bought it.) For other exchanges the free data does not say whether a pool is locked.
- **Live-price checks.** Every 30 seconds Warrior compares each open position with the live price and pool. It sells at the stop or target without waiting for a candle (after two looks agree), and it says loudly when a held coin's pool has been emptied and cannot be sold.
- **Risk screen.** At least $40k liquidity, $100k daily volume, one hour of pool age (two on Chill). Warrior also refuses coins the creator can freeze or mint more of, coins on the newer token type (Token-2022, used by most new pump.fun coins) whose extras could take your coins or block a sale (`lib/token.mjs`), and coins that would lose more than 6% on an immediate round trip.
- **Position rules.** Risk 2% of the wallet per trade, at most 25% in one coin, three positions at once, 0.03 SOL kept for fees. Stop loss sized from volatility (3% to 12%), 10% target, trailing stop after the trade is up by its own risk, six-hour time limit, and no new trades after losing 10% in a day. Under **Exact numbers** the trailing stop can be switched off or given its own start and following distance, the trend-break exit can be switched off, and the time limit can be changed or removed.
- **Costs.** pump.fun pools charge about 1% each way, so a round trip costs roughly 2% before the price moves.

These are the **Balanced** numbers. Chill and Spicy change them; the presets are in `lib/presets.mjs`. Defaults live in `lib/strategy.mjs` (`defaultSettings`) and `lib/risk.mjs` (`defaultRisk`). A coin you pick yourself (a practice buy, an order, slices, a copied buy) keeps its stop and target, but Warrior does not sell it for a broken trend or the time limit: those two exits are for Warrior's own signals.

## Development

`npm test` runs the rule tests. `npm run scan` prints one live scan. `npm run build` bundles the Solana library and copies the tested rule files from `lib/` into `public/vendor/` so the page and the server use the same rules. The site is static files in `public/` with small serverless functions in `api/`; `vercel dev` runs it locally.

Candles come from Jupiter's chart feed first and GeckoTerminal second. Jupiter's feed is the one behind its own charts: it is free, quick and has not throttled a scan, but it is not a documented public service and may change without notice, which is why GeckoTerminal stays as the fallback. The scanner reads eight coins at a time. When both sources refuse, candles read in the last few minutes are reused. With `COINGECKO_API_KEY` set (untested), the paid GeckoTerminal endpoint is used instead of Jupiter.

The hosting plan allows 12 serverless functions and the site uses 11. Coin facts (lookup, safety, prices, token check) share one function, `api/coin.js`, whose handlers live in `lib/http/`.

The scorecard is written by `scripts/scorecard.mjs`, run every hour by `.github/workflows/scorecard.yml`, which commits `public/scorecard.json`. Do not edit that file by hand. The hosting plan only deploys commits authored by the project owner, so the recorder commits in the owner's name with "automated" in the message. Setting `WARRIOR_HOME` moves the bot's folder, for a second bot or for tests.

Optional server settings for speed: `SOLANA_RPC_URL` (a dedicated Solana connection), `JUPITER_API_KEY` (higher quote allowance) and `COINGECKO_API_KEY` (paid market data; untested).

The first build plan is in [docs/build-prompt.md](docs/build-prompt.md). The four-phase plan and its evidence are in [docs/rcb-phases.md](docs/rcb-phases.md).
