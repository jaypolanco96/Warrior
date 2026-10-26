# Warrior recovered Claude context ? October 17, 2026

Recovered from Claude memory `warrior-project.md`, `laugh-project.md`, `laugh-deploy-only-by-push.md` and session `10e8542a-57ea-4795-b8c3-d79298479013` under `C:/Users/jorda/.claude/projects/c--Users-jorda-Projects-oakland/`. Latest substantive message: October 16, 2026, 21:53 Eastern (October 17 01:53 UTC). Source checked at Warrior `e3d18b4` and Laugh `79c6ef8`. Historical test reports below were not rerun during recovery. No credentials or account journals are copied here.

## Product and architecture

Warrior lives in `C:/Users/jorda/Projects/Warrior`, repository `jaypolanco96/Warrior`. Claude reports making the repository public on October 16; visibility was not independently queried during recovery. The recorded site is https://warrior-liart.vercel.app; this recovery did not inspect deployment state.

The owner rejected the initial Laugh reskin. Preserve the distinct dense trading desk: rainbow-road colours, South African Zulu shield/spear identity, agent-network centrepiece, order-flow tables, equity curve, dip histogram, ticker, indaba and terminal feed, light/dark themes and phone layouts. Reuse suitable tested internals without turning the UI back into Laugh.

This is static HTML/CSS/browser ES modules plus Vercel functions, not SvelteKit. `public/js/` owns the desk; `lib/` owns shared rules and server helpers; `scripts/build.mjs` bundles Solana locally and generates browser copies in `public/vendor/lib/`. Edit original libraries, not generated copies. Preserve the CSP and avoid third-party runtime scripts on wallet pages.

Six agents are rule modules, not LLMs: Inhloli (scout), Isihlangu (shield), Umkhonto (spear), Izinyoni (smart money), Induna (commander), Umlobi (scribe). `impi.js` runs the desk; `indaba.js` narrates actual decisions and near-misses, including quiet rounds. Indaba is display, not a separate trading brain. Do not claim proven superiority over X trading systems: Claude found no full comparable records.

## Trading and accounting invariants

Practice and live positions, outcomes and learning evidence remain separate. Read current `lib/presets.mjs`, `strategy.mjs`, `risk.mjs` and `public/js/trader.js`; older comments and copied README claims may be stale. Balanced/Spicy use +6/+12% profit steps; Chill does not. Presets currently have trailing start +30%, gap 6%; the app's current rules, not these recovery notes, determine an individual position's behavior.

Keep token/launch/pool checks, round-trip cost checks, per-coin and daily loss limits, reserve, loss cooldown and position-mode selling. Transfers must not masquerade as trading profit or losses. Drained pools cannot execute stops: write-off handling removes unusable holdings from slots/equity, needs deliberate confirmation and records the loss. Preserve partial-sale repricing and honest receipts, including missing historical costs.

`0bd7901` separates estimated refundable token-account rent (`rentSol`) from swapped principal for profit steps/open P&L. Partial sales retain rent in the position; final outcomes retain measured wallet costs and recovered rent. Older positions without `rentSol` keep fallback behavior. Do not treat estimated rent as guaranteed recovery or transplant one app's equity calculation without inspecting it.

Auto-trading is browser-driven. Stops and orders require the tab running; wake lock and service worker do not make an unattended server keeper. Same-browser/cross-device coordination does not coordinate Warrior with Laugh. Wallet reuse does not import position/history/cooldown state; do not run both apps against one wallet concurrently. Never read `.env*`, keys, or real account state to create fixtures.

## Self-ruling and watchtower

`lib/adapt.mjs` is the pure decision code, `lib/presets.mjs` defines ADAPT; `public/js/adapt.js` integrates it and `watch.js` collects evidence. Auto is default; Suggest and Off exist. It checks after sales, changes one dial at a time, compares the next 8 trades against a 10-trade baseline, can undo poor moves and rests an undone dial for 72 hours. Current-mode/current-strength aggregation folds partial sales into completed positions. Preserve profit-per-day probation, evidence thresholds and history explaining moves.

Allowed ranges: hold 2?5 hours; target 15?35%; dip depth 8?12%; loss rebuy wait 120?720 minutes. Self-ruling cannot relax pool/cost/token/launch safety or the stop. The raise-target evidence branch is disabled after harmful replay results; a permitted range does not imply every directional adjustment is supported.

Watchtower measures 6-hour dip weather, 3-hour post-sale outcomes and missed/refused candidates. Weather is report-only by default; optional guard reduces/blocks new exposure. Tracking needs the browser open. Laugh has corresponding modules but its missed ledger follows cost refusals rather than Warrior's indaba near-misses; its learning history is device-local while dial changes sync.

## Latest UI and protections

The replayable first-visit tour spotlights real controls, supports keyboard/navigation and opens folded mobile panels. Care sits horizontally below the live feed on wide screens and stacks on smaller screens. Keep time fields readable. Recent additions include trading-tab coordination, wake-lock reacquisition, add-funds risk checks, honest receipts, optional bedtime and profit sweep, reset-day confirmation, coach notes, device passkeys, throttled visible failures, revenge-trade confirmation and persistent mobile panel folding.

`public/js/care.js` handles buy/sell/pause/problem notifications and service worker registration. `drum.js` synthesizes ngoma-inspired buy/win/loss/alert patterns; drum is on by default with a toggle and test buttons. It needs a user gesture/browser audio permission. It is not a recorded traditional performance and cannot replace the OS notification tone. Background browser execution is not guaranteed. Claude reported that Laugh's alerts skip buys; inspect current Laugh handlers before changing that separately.

## Historical evidence and rejected experiments

Claude reported 89 Warrior and 138 Laugh tests passing after the latest changes; local HEADs contain those changes. This recovery checked source/history, not live trades, device biometrics, notification delivery, wake lock or real SOL sweep. Those remain separate acceptance questions.

October 16 research used 257 coins over roughly two months plus five earlier tuning windows. Aggregated trade percentages are comparisons, not compounded wallet returns or profit forecasts. Self-ruling gains mostly came from clock changes; samples and before/after probation remain noisy. The shallower-entry evidence branch was not established by historical prices.

Rejected in those tests: waiting for a bounce, splitting entries/add-on dips, raising targets from winner-only evidence, automatic pumping overtime, earlier trailing/break-even stops, and a wider stop after equal-risk sizing. Do not silently reintroduce these as proven improvements. Candle ordering/fill ambiguity materially changed trailing-stop totals; require realistic costs/fills, equal risk, unseen periods and cross-checks for new claims. Raw user CSVs and claimed short-term results are not durable proof of an edge.

## Work and deployment

Run `npm test` and `npm run build` for code edits; build before browser suites. There is no global check script. Use synthetic isolated browser storage and practice mode. For responsive changes check 320/390, tablet and desktop widths, light/dark and tour/fold interactions.

Deploy through the existing GitHub?Vercel integration only when the user requests commit/push for the concrete change. Never use direct `vercel deploy` or relink projects. The owner required this after a direct Laugh deployment was overwritten by a scheduled GitHub update, removing safety changes during live trading. Scheduled data workflows can advance main; inspect dirty state and remote divergence before synchronizing. Preserve other agents' edits. Laugh changes do not automatically reach Warrior; inspect and port explicitly when requested. Recovery creates no authorization to trade, transfer, deploy or publish.
