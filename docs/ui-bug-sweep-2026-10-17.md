# Warrior funding dialog and UI bug sweep

October 17, 2026. Local review started at 22:14 Eastern and continued for approximately 15 minutes before commit/push. No owner wallet, keys, account journal, live transfer or live trade was used.

The funding dialog's Close button implicitly submitted its form. Browser number validation rejected fractional SOL because the input's default step was one; closing therefore required clearing the amount. Close now directly dismisses the dialog independently of validation. SOL fields accept decimals, and closing clears the dialog contents. An older pending action cannot replace the contents/actions of a newer dialog. Transfer failures are distinguished from confirmed sends, with outcomes retained in the feed.

Additional fixes:

- Mode/strength/reset actions wait for trading or transfer actions and startup to finish. Failed startup does not strand the browser trading lock. Strength changes rebase positions only in the selected mode.
- Mode/strength changes redraw portfolio, orders, watchtower, self-ruling and scorecard views. A late balance response cannot overwrite figures from a newer mode/draw.
- Portfolio valuation uses available sale quotes, keeps refundable rent separate from swapped principal, and values emptied pools at zero consistently with the position list. Position updates refresh portfolio figures.
- Manage uses the current average entry after an add when setting custom exits or percentage-based sell orders.
- Practice reset removes practice orders while preserving Live data. CSV export uses the shared formula-safe cell encoder.
- Long token names wrap without pushing portfolio amounts/buttons off phone layouts. First-visit tutorial autoplay yields to an open wallet dialog.

Validation: `npm test` (92 passing), `npm run build`, and the local browser suite (188 passing checks) in `scripts/browser-test.mjs`. The suite mocks every API and Phantom response, uses throwaway generated keys and isolated storage, and aborts requests to external origins. It exercises confirmed/failed fractional funding, withdrawal, pending-dialog races, daily-baseline adjustments, startup locks, mode separation, delayed balances, emptied-pool display, changed average prices, resets and exported CSV. Layout checks cover light/dark at 320, 390, 520, 700, 800, 1024, 1280, 1440 and 1920 pixels; all 21 tour steps are checked at phone/tablet/desktop and 700x320 landscape. Review screenshots of the funding/Care panels were inspected locally.

These checks do not establish real Phantom approval behavior, device notification/passkey/wake-lock acceptance or profitable trading. Publishing uses the existing GitHub-to-Vercel integration.
