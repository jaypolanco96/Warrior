# Warrior

An impi of six AI agents (scout, shield, spear, smart money, commander, scribe) trading Solana meme and ecosystem coins, in practice or live from a passphrase-locked trading wallet funded from Phantom. The rules come from tested replays on real Solana prices. No profit is promised.

- Live: https://warrior-liart.vercel.app (deploys from pushes to main)
- `npm run build` bundles the Solana library and the shared rules into public/vendor
- `npm test` runs the rule tests
- [Key protection](docs/key-protection.md) explains backup hiding, safe idle locking, encrypted recovery and the browser-wallet security limits.
- `npm run test:browser` builds first, then runs local UI regressions with synthetic Phantom/API responses and isolated browser storage. Install its browser once with `npx playwright-core install chromium`, or set `WARRIOR_BROWSER` to an existing Chromium executable. Optional `WARRIOR_ARTIFACTS` saves review screenshots. This suite never uses real accounts or sends transactions to a chain.
