// The trading wallet's key, kept safe on this device.
// The key is stored encrypted. It is opened with a passphrase (or a device passkey) and then lives in this tab's memory
// only, until you lock it or close the tab. The key itself is never sent anywhere: the page signs, and only signed
// transactions leave. With sync (public/sync.js), the same locked copy kept here is also kept on Warrior's server, so your
// other devices can open it with your passphrase. The passphrase never leaves the device.
import { Keypair, ed25519 } from '/vendor/solana.js';
import { lookupId, portableRecord } from '/vendor/lib/sync.js';
import { emit } from '/bus.js';
import { sealWallet, openWallet, addDeviceKey, openWithDeviceKey, isSealed, passphraseProblems, toBase58, parseBackupKey } from '/vendor/lib/vault.js';

const WKEY = 'warrior.auto.wallet.v1', $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const b64 = (bytes) => btoa(Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join('')), unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
let record = null, keypair = null, dataKey = null, legacy = false, syncId = null;
// Once the wallet is open: work out the id its locked copy is filed under (needs the passphrase) and tell sync.
const opened = (passphrase) => { emit('vault-open'); if (passphrase) void lookupId(passphrase).then((id) => { syncId = id; emit('vault-sync-id', id); }).catch(() => {}); };
try {
  const raw = JSON.parse(localStorage.getItem(WKEY) ?? 'null');
  if (isSealed(raw)) record = raw;
  // A wallet made before passphrases existed is stored unprotected. It still works for looking, and must be protected before live trading.
  else if (Array.isArray(raw) && raw.length === 64) { keypair = Keypair.fromSecretKey(Uint8Array.from(raw)); legacy = true; }
} catch {}
const store = () => localStorage.setItem(WKEY, JSON.stringify(record));
async function seal(secret, passphrase) { const kp = Keypair.fromSecretKey(secret), made = await sealWallet(secret, passphrase, kp.publicKey.toBase58()); record = made.record; dataKey = made.dataKey; keypair = kp; legacy = false; store(); }
const prfSupported = () => typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;
async function deviceKey(credentialId, salt) {
  const got = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64(credentialId) }], userVerification: 'required', extensions: { prf: { eval: { first: unb64(salt) } } } } });
  const first = got?.getClientExtensionResults?.().prf?.results?.first; if (!first) throw new Error('This device or browser cannot unlock wallets with a passkey');
  return new Uint8Array(first);
}

export const vault = {
  get exists() { return !!record || legacy; }, get address() { return record?.address ?? keypair?.publicKey.toBase58() ?? ''; },
  get protected() { return !!record; }, get unlocked() { return !!keypair; }, get keypair() { return keypair; }, get hasPasskey() { return !!record?.passkey; }, get passkeySupported() { return prfSupported(); },
  async create(passphrase) { if (vault.exists) throw new Error('A trading wallet already exists in this browser'); await seal(Keypair.generate().secretKey, passphrase); opened(passphrase); },
  async protect(passphrase) { if (!legacy || !keypair) throw new Error('Nothing to protect'); await seal(keypair.secretKey, passphrase); opened(passphrase); },
  async restore(text, passphrase) { await vault._restore(text, passphrase); opened(passphrase); },
  async _restore(text, passphrase) { if (vault.exists) throw new Error('A trading wallet already exists in this browser'); const secret = parseBackupKey(text); if (!secret) throw new Error('That is not a backup key. It should be the long key Warrior showed you, or the private key exported from Phantom'); try { Keypair.fromSecretKey(secret); } catch { throw new Error('That key is damaged: its two halves do not match'); } await seal(secret, passphrase); },
  async unlock(passphrase) { const o = await openWallet(record, passphrase); keypair = Keypair.fromSecretKey(o.secret); dataKey = o.dataKey; opened(passphrase); },
  async unlockDevice() { const o = await openWithDeviceKey(record, await deviceKey(record.passkey.id, record.passkey.prfSalt)); keypair = Keypair.fromSecretKey(o.secret); dataKey = o.dataKey; opened(null); },
  lock() { if (!record) return; keypair = null; dataKey = null; syncId = null; emit('vault-locked'); },
  // ---------- for sync ----------
  get syncId() { return syncId; }, get syncKey() { return dataKey; }, get portable() { return record ? portableRecord(record) : null; },
  /** Sign a sync request. Only an unlocked wallet can. Returns base64. */
  sign(text) { if (!keypair) throw new Error('Unlock the wallet first'); const sig = ed25519.sign(new TextEncoder().encode(text), keypair.secretKey.slice(0, 32)); return btoa(String.fromCharCode(...sig)); },
  /** A new device: keep the locked copy found on the server, then open it with the passphrase. */
  async adopt(found, passphrase) { if (vault.exists) throw new Error('A trading wallet already exists in this browser'); const o = await openWallet(found, passphrase); if (Keypair.fromSecretKey(o.secret).publicKey.toBase58() !== found.address) throw new Error('That wallet copy is damaged'); record = { ...found, passkey: null }; store(); keypair = Keypair.fromSecretKey(o.secret); dataKey = o.dataKey; opened(passphrase); },
  /** The backup key, shown only after the passphrase is typed again, even when the wallet is already unlocked. */
  async reveal(passphrase) { if (legacy) return toBase58(keypair.secretKey); return toBase58((await openWallet(record, passphrase)).secret); },
  async addPasskey() {
    if (!record || !dataKey) throw new Error('Unlock the wallet with its passphrase first'); if (!prfSupported()) throw new Error('This browser does not support passkeys');
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const made = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Warrior', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Warrior trading wallet', displayName: 'Warrior trading wallet' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, extensions: { prf: { eval: { first: salt } } } } });
    const ext = made?.getClientExtensionResults?.().prf; if (!made || !ext || ext.enabled === false) throw new Error('This device or browser cannot unlock wallets with a passkey. The passphrase still works');
    const id = b64(made.rawId), key = ext.results?.first ? new Uint8Array(ext.results.first) : await deviceKey(id, b64(salt));
    record = await addDeviceKey(record, dataKey, key, id, b64(salt)); store();
  },
  removePasskey() { if (record?.passkey) { record = { ...record, passkey: null }; store(); } }
};

// ---------- the small dialog every wallet step uses ----------
const dialog = $('vault'), body = $('vault-body'), status = $('vault-status'), go = $('vault-go');
$('vault-close').addEventListener('click', () => dialog.close());
/**
 * Ask for what a step needs. `fields` are inputs; `run(values)` does the work and may return text to show.
 * Returns a promise that settles true when the step succeeded.
 */
function ask({ title, text, fields = [], action, run, after }) {
  return new Promise((resolve) => {
    $('vault-title').textContent = title; body.replaceChildren(el('p', '', text)); status.textContent = ''; go.textContent = action; go.hidden = false; go.disabled = false;
    const inputs = {}; let form = null; for (const f of fields) { const wrap = el('div', 'fieldwrap'), l = el('label', '', f.label), i = el(f.type === 'textarea' ? 'textarea' : 'input'); if (f.type !== 'textarea') { if (f.type) i.type = f.type; else if (f.save) { i.type = 'password'; i.name = 'password'; } else secretField(i); } i.id = `vault-${f.id}`; l.htmlFor = i.id; if (!i.classList.contains('masked')) i.autocomplete = f.autocomplete ?? 'off'; i.spellcheck = false; if (f.rows) i.rows = f.rows; wrap.append(l, i);
      if (f.save) { // TEMPORARY, while Warrior is being built: let the browser's password manager save and fill this passphrase.
        form = el('form', 'vault-form'); form.autocomplete = 'on'; const who = el('input', 'pm-user'); who.type = 'text'; who.name = 'username'; who.autocomplete = 'username'; who.value = 'Warrior trading wallet'; who.readOnly = true; who.tabIndex = -1; who.setAttribute('aria-hidden', 'true'); const enter = el('button', 'pm-user'); enter.type = 'submit'; enter.tabIndex = -1; enter.setAttribute('aria-hidden', 'true'); form.append(who, wrap, enter); body.append(form); } // the unseen button lets Enter submit the form
      else body.append(wrap);
      inputs[f.id] = i; }
    let done = false; const finish = (ok) => { if (done) return; done = true; dialog.removeEventListener('close', onClose); resolve(ok); }, onClose = () => finish(false);
    const submit = async () => {
      go.disabled = true; status.textContent = 'Working…';
      try { const shown = await run(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); if (form) { const gone = form; setTimeout(() => gone.remove(), 400); } else for (const i of Object.values(inputs)) i.value = ''; if (after) { await after(shown, { body, status, go, finish, close: () => dialog.close() }); return; } finish(true); dialog.close(); }
      catch (e) { status.textContent = `${e?.name === 'NotAllowedError' ? 'The passkey prompt was cancelled' : e?.message ?? 'That did not work'}.`; go.disabled = false; }
    };
    // A real form submit is what tells the browser a password was used, so it can offer to save it.
    go.onclick = () => { if (form) form.requestSubmit(); else void submit(); }; if (form) form.addEventListener('submit', (e) => { e.preventDefault(); void submit(); });
    dialog.addEventListener('close', onClose); if (!dialog.open) dialog.showModal(); (Object.values(inputs)[0] ?? go).focus();
  });
}
// TEMPORARY EXCEPTION (owner's choice, October 13, 2026, while Warrior is being built): the Unlock dialog alone uses a real
// password field in a real form (`save: true`), so Chrome can save and fill the passphrase. This is less safe: anyone
// who can open this browser profile's saved passwords can read it. Remove `save: true` from `unlock` to undo it.
// The passphrase unlocks a wallet. It is not a website login, and it should not end up in a browser's password manager or
// synced to an account. A real password field makes Chrome offer to save it every time something else on the page is
// edited. On a computer the field is therefore a plain text box whose characters are drawn as dots, which browsers do not
// treat as a login. On phones and in browsers that cannot draw the dots, it stays a real password field, because a plain
// text box there could let the keyboard learn the passphrase.
const canMask = typeof CSS !== 'undefined' && CSS.supports?.('-webkit-text-security', 'disc') && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
function secretField(i) {
  if (!canMask) { i.type = 'password'; return; }
  i.type = 'text'; i.classList.add('masked'); i.autocomplete = 'off'; i.setAttribute('autocorrect', 'off'); i.setAttribute('autocapitalize', 'off'); i.setAttribute('data-lpignore', 'true'); i.setAttribute('data-1p-ignore', 'true'); i.setAttribute('data-form-type', 'other');
}
const twice = [{ id: 'pass', label: 'Passphrase (at least 10 characters; a few random words work well)', autocomplete: 'new-password' }, { id: 'again', label: 'Type it again', autocomplete: 'new-password' }];
function checked({ pass, again }) { const problems = passphraseProblems(pass); if (problems.length) throw new Error(problems[0]); if (pass !== again) throw new Error('The two passphrases do not match'); return pass; }
const FORGET = 'There is no way to reset it. If you forget the passphrase, only the backup key can bring the wallet back.';

export const walletSteps = {
  create: () => ask({ title: 'Create your trading wallet', text: `Choose a passphrase. It locks this wallet on this device. ${FORGET}`, fields: twice, action: 'Create wallet', run: async (v) => vault.create(checked(v)) }),
  protect: () => ask({ title: 'Protect this wallet', text: `This wallet was made before Warrior used passphrases, so its key sits in this browser unlocked. Choose a passphrase to lock it. ${FORGET}`, fields: twice, action: 'Lock it', run: async (v) => vault.protect(checked(v)) }),
  restore: () => ask({ title: 'Restore a wallet from its backup key', text: 'Paste the backup key and choose a passphrase for this device. The key is checked and encrypted here; it is not sent anywhere.', fields: [{ id: 'key', label: 'Backup key', type: 'textarea', rows: 3 }, ...twice], action: 'Restore wallet', run: async (v) => vault.restore(v.key, checked(v)) }),
  unlock: () => ask({ title: 'Unlock your trading wallet', text: 'Type the passphrase. The wallet stays unlocked in this tab until you lock it or close the tab.', fields: [{ id: 'pass', label: 'Passphrase', autocomplete: 'current-password', save: true }], action: 'Unlock', run: async (v) => vault.unlock(v.pass) }),
  unlockDevice: async () => { try { await vault.unlockDevice(); return true; } catch (e) { return ask({ title: 'Passkey did not work', text: `${e?.name === 'NotAllowedError' ? 'The passkey prompt was cancelled' : e?.message ?? 'That did not work'}. Use the passphrase instead.`, fields: [{ id: 'pass', label: 'Passphrase', autocomplete: 'current-password' }], action: 'Unlock', run: async (v) => vault.unlock(v.pass) }); } },
  /** A new device: find the locked wallet your other device synced, by your passphrase, and open it here. */
  fromOtherDevice: () => ask({ title: 'Open your wallet from another device', text: 'Type the passphrase of the trading wallet on your other device. Warrior finds the locked copy that device synced and opens it here. Your passphrase is not sent anywhere; only an id made from it is.', fields: [{ id: 'pass', label: 'Passphrase', autocomplete: 'current-password', save: true }], action: 'Find and open', run: async (v) => {
    const id = await lookupId(v.pass), r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'find', id }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'Sync is unavailable right now');
    if (!j.record) throw new Error('No synced wallet uses that passphrase. Open Warrior on the device that has the wallet, unlock it once with its passphrase so it can sync, then try again here');
    await vault.adopt(j.record, v.pass);
  } }),
  addPasskey: () => ask({ title: 'Add a passkey for this device', text: 'A passkey lets this device unlock the wallet with your fingerprint, face or screen lock. Your passphrase keeps working, and the backup key is still the only way back if this device is lost.', action: 'Add passkey', run: async () => vault.addPasskey() }),
  /** Guided backup: show the key only after the passphrase, then prove it was saved by typing its last four characters. */
  backup: () => ask({
    title: 'Save your backup key', text: vault.protected ? 'Step 1 of 3. Type your passphrase to show the backup key.' : 'Step 1 of 3. Show the backup key.', fields: vault.protected ? [{ id: 'pass', label: 'Passphrase', autocomplete: 'current-password' }] : [], action: 'Show backup key',
    run: async (v) => vault.reveal(v.pass),
    after: (key, ui) => {
      const box = el('textarea'); box.readOnly = true; box.rows = 3; box.value = key; box.setAttribute('aria-label', 'Backup key. Keep it secret.');
      const wrap = el('div', 'fieldwrap'), l = el('label', '', 'Step 3 of 3. Type the LAST FOUR characters of the key you saved'), check = el('input'); check.type = 'text'; check.id = 'vault-check'; check.autocomplete = 'off'; check.spellcheck = false; check.maxLength = 4; l.htmlFor = check.id; wrap.append(l, check);
      ui.body.replaceChildren(el('p', '', 'Step 2 of 3. Write this key down or put it in a password manager. Anyone who has it controls the wallet, so never paste it into a website, a chat or an email. In Phantom it restores the wallet through Add account, Import private key.'), box, wrap);
      ui.status.textContent = ''; ui.go.textContent = 'I saved it'; ui.go.disabled = false; check.focus();
      ui.go.onclick = () => { if (check.value.trim() !== key.slice(-4)) { ui.status.textContent = 'Those are not the last four characters. Check what you saved against the key above.'; return; } box.value = ''; ui.finish(true); ui.close(); };
    }
  })
};
