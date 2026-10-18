# Trading-wallet key protection

The wallet remains a browser hot wallet. This hardening reduces accidental disclosure, idle exposure and recovery-record tampering; it is not an independent security audit or protection against a compromised device, browser extension or deployed application.

## Existing controls, shorter exposure

- Backup keys require the passphrase and hide after 45 seconds, on loss of window focus, on backgrounding, on wallet lock, and on page exit. Showing one again uses the existing Show action and requires the passphrase again. A pending reveal cannot display after it has been hidden or cancelled.
- Sensitive fields clear on submission, closing or loss of focus. The restore-key field is masked, with autocomplete/correction disabled. Backup output does not announce itself through the status live region. No automatic clipboard copying or new buttons were added.
- The wallet locks after five idle minutes, checked every 15 seconds, when no local Live trader/startup, live position, waiting live order or pending wallet/trading action needs the key. Persisted `wasRunning` flags do not keep keys unlocked after a refresh. Backgrounding alone does not interrupt live position management.
- Page exit locks the wallet, including back-forward cache transitions. Pending unlock/create/passkey actions cannot resurrect key material after lock. A live trader stops if its wallet is explicitly locked and must be restarted after unlocking.

## Key handling and encrypted recovery

The signing secret and sync encryption key stay private to the wallet module. Callers receive signed transactions or encrypted/decrypted snapshots rather than raw key getters. Transaction signing retains fee-payer, signature-count and program checks. Managed secret byte buffers and temporary decrypted/signing buffers are overwritten where practical; JavaScript cannot guarantee complete memory erasure, especially for strings, library internals and garbage-collected copies.

Wallet operations are serialized so overlapping create/restore/unlock operations cannot replace one another. A decrypted secret must derive the public address in its record. AES-256-GCM, random salts/nonces and the 600,000-round PBKDF2 default are retained. Stored records reject excessive KDF work and malformed ciphertext sizes. New/restored wallet passphrases require at least 15 normalized characters and reject a small local common-password list. Existing shorter passphrases still decrypt; they are not automatically made stronger. Recovery lookup remains derived from the passphrase, so a strong unique passphrase matters for offline-guessing resistance as well.

New recovery-record signatures bind the exact encrypted record contents. An existing recovery lookup cannot be overwritten by a different wallet, even with that other wallet's valid signature. Existing encrypted records remain readable. Older tabs must refresh to register new recovery records under the strengthened signature protocol; unsigned legacy record writes are rejected rather than accepted as a fallback.

## Verification and limits

`npm test`: 95 passing tests, including ciphertext tampering, different-wallet substitution, legacy passphrase compatibility, KDF bounds and idle-lock policy. Build completed before the browser suite. `scripts/browser-test.mjs`: 208 passing local checks with synthetic API/Phantom responses, isolated storage and throwaway keys. Both legacy and versioned signatures verify, sync encryption round-trips, timeout/blur/pending-reveal handling works, and active live trading/positions/orders are preserved by idle locking. No real account or live transfer was used. Real device passkey prompts remain a separate acceptance check.

Security references: [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [key management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html), and [browser storage risks](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).
