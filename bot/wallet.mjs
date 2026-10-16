// The bot's own wallet. The key is created on this computer, saved in .warrior/wallet.json (never committed, never uploaded)
// and used only by the bot. It is stored encrypted with a passphrase, using the same tested code as the website.
// Keep only trading money in it.
//   npm run wallet                         create it if needed (asks for a passphrase), print its address and balance
//   npm run wallet -- --protect            lock an older, unprotected wallet file with a passphrase
//   npm run wallet -- --backup             show the backup key (asks for the passphrase)
//   npm run wallet -- --restore            rebuild the wallet from a backup key
//   npm run wallet -- --withdraw ADDRESS   send all its SOL to ADDRESS (for example your Phantom wallet)
// The bot asks for the passphrase when it starts in live mode. To start it unattended, set WARRIOR_PASSPHRASE in the
// environment; anyone who can read that setting can then open the wallet, so only do it on a computer you trust.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { sealWallet, openWallet, isSealed, passphraseProblems, toBase58, parseBackupKey } from '../lib/vault.mjs';

// WARRIOR_HOME moves the bot's folder (wallet, positions, logs) somewhere else, for a second bot or for tests.
export const DIR = process.env.WARRIOR_HOME ? process.env.WARRIOR_HOME.replace(/[\\/]*$/, '/') : fileURLToPath(new URL('../.warrior/', import.meta.url)), FILE = DIR + 'wallet.json';
export const connection = () => new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

/** Ask a question in the terminal. With `hidden`, what is typed is not shown. Works with piped input too. */
let piped = null;
function ask(question, hidden = false) {
  if (!process.stdin.isTTY) { piped ??= readFileSync(0, 'utf8').split(/\r?\n/); process.stdout.write(question + '\n'); return Promise.resolve(piped.shift() ?? ''); }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true }); let muted = false;
    const write = rl._writeToOutput.bind(rl); rl._writeToOutput = (text) => { if (!muted) write(text); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); }); muted = hidden;
  });
}
async function newPassphrase() {
  for (;;) {
    const first = process.env.WARRIOR_NEW_PASSPHRASE ?? await ask('Choose a passphrase (at least 10 characters; a few random words work well): ', true), problems = passphraseProblems(first);
    if (problems.length) { console.log(`${problems[0]}.`); if (process.env.WARRIOR_NEW_PASSPHRASE || !process.stdin.isTTY) throw new Error('Passphrase refused'); continue; }
    const again = process.env.WARRIOR_NEW_PASSPHRASE ?? await ask('Type it again: ', true); if (again === first) return first;
    console.log('The two passphrases do not match.'); if (!process.stdin.isTTY) throw new Error('Passphrases do not match');
  }
}
const stored = () => existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
function store(value) { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(FILE + '.tmp', FILE); }
async function seal(secret) { const kp = Keypair.fromSecretKey(secret), { record } = await sealWallet(secret, await newPassphrase(), kp.publicKey.toBase58()); store(record); console.log('The wallet is locked with your passphrase. There is no way to reset it: if you forget it, only the backup key brings the wallet back.'); return kp; }
async function open(record) {
  for (let tries = 0; tries < 3; tries++) {
    const pass = process.env.WARRIOR_PASSPHRASE ?? await ask('Wallet passphrase: ', true);
    try { return Keypair.fromSecretKey((await openWallet(record, pass)).secret); } catch (e) { if (process.env.WARRIOR_PASSPHRASE || !process.stdin.isTTY) throw e; console.log('Wrong passphrase.'); }
  }
  throw new Error('Wrong passphrase three times');
}
/** The wallet's public address, without opening it. */
export function walletAddress() { const s = stored(); if (isSealed(s)) return s.address; if (Array.isArray(s) && s.length === 64) return Keypair.fromSecretKey(Uint8Array.from(s)).publicKey.toBase58(); return null; }

/** Load the bot wallet, asking for the passphrase when it is locked. */
export async function loadWallet({ create = false } = {}) {
  const s = stored();
  if (!s) { if (!create) throw new Error('No bot wallet yet. Run: npm run wallet'); console.log('Creating a new bot wallet.'); return seal(Keypair.generate().secretKey); }
  if (isSealed(s)) return open(s);
  if (!Array.isArray(s) || s.length !== 64) throw new Error('Bot wallet file is damaged');
  console.log('NOTE: this wallet file is not protected by a passphrase. Lock it with: npm run wallet -- --protect');
  return Keypair.fromSecretKey(Uint8Array.from(s));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const has = (name) => process.argv.includes(`--${name}`);
  try {
    if (has('restore')) {
      if (stored()) { console.log('A bot wallet already exists here. Move .warrior/wallet.json away first if you really mean to replace it.'); process.exit(1); }
      const secret = parseBackupKey(await ask('Paste the backup key: ', true)); if (!secret) { console.log('That is not a backup key.'); process.exit(1); }
      const kp = await seal(secret); console.log(`Restored. Bot wallet address: ${kp.publicKey.toBase58()}`); process.exit(0);
    }
    if (has('protect')) {
      const s = stored(); if (!s) { console.log('No bot wallet yet. Run: npm run wallet'); process.exit(1); } if (isSealed(s)) { console.log('This wallet is already locked with a passphrase.'); process.exit(0); }
      await seal(Uint8Array.from(s)); console.log('Done. Save the backup key now if you have not: npm run wallet -- --backup'); process.exit(0);
    }
    const wallet = await loadWallet({ create: true });
    if (has('backup')) { console.log('\nBackup key. Anyone who has it controls the wallet. Write it down or put it in a password manager; never paste it into a website, a chat or an email:\n'); console.log(toBase58(wallet.secretKey)); console.log('\nClear this terminal window when you are done.'); process.exit(0); }
    const conn = connection(); let lamports = null; try { lamports = await conn.getBalance(wallet.publicKey); } catch {}
    console.log(`Bot wallet address: ${wallet.publicKey.toBase58()}`); console.log(lamports === null ? 'Balance: could not be read right now.' : `Balance: ${(lamports / 1e9).toFixed(6)} SOL`);
    const i = process.argv.indexOf('--withdraw');
    if (i > 0) {
      if (lamports === null) { console.log('Not withdrawing without knowing the balance. Try again shortly.'); process.exit(1); }
      const to = new PublicKey(process.argv[i + 1] ?? ''), fee = 5000, amount = lamports - fee;
      if (amount <= 0) { console.log('Nothing to withdraw.'); process.exit(0); }
      console.log(`Sending ${(amount / 1e9).toFixed(6)} SOL to ${to.toBase58()} …`);
      const signature = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: to, lamports: amount })), [wallet]);
      console.log(`Done. https://solscan.io/tx/${signature}`);
      console.log('Coins the bot still holds are not sold by this command. Stop the bot only after its positions are closed, or sell them first.');
    } else console.log('\nTo fund the bot, send SOL to that address from Phantom. Start small.\nSave the backup key before you fund it: npm run wallet -- --backup\nThe key file is .warrior/wallet.json on this PC, encrypted with your passphrase. Do not share it.');
  } catch (e) { console.error(`${e.message}. Nothing was changed.`); process.exit(1); }
}
