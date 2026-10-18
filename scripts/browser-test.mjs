// Local-only regressions. Every API and Phantom response is synthetic; no real accounts or RPC are used.
// Run after build. Install Chromium with `npx playwright-core install chromium`, or set WARRIOR_BROWSER.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { Transaction, TransactionMessage, TransactionInstruction, VersionedTransaction, PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { createPublicKey, verify } from 'node:crypto';

const root = resolve('public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    for (const group of config.headers ?? []) if (group.source === '/(.*)') for (const h of group.headers) res.setHeader(h.key, h.value);
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
let checks = 0, outcome = 'confirmed';
const artifacts = process.env.WARRIOR_ARTIFACTS; if (artifacts) await mkdir(artifacts, { recursive: true });
const check = (ok, message) => { assert.ok(ok, message); checks++; };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.WARRIOR_BROWSER ? { executablePath: process.env.WARRIOR_BROWSER } : {}) });
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: true });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json = {};
    if (url.pathname === '/api/scan') {
      check(url.searchParams.get('mature') === '1', 'desk and strength scans explicitly include mature coins');
      json = { universe: 3, scanned: 1, results: [{ symbol: 'MATURE', marketType: 'mature', volume1hUsd: 1000000, change: { m5: -2, h1: -5 }, analysis: { decision: 'wait', reasons: [] } }], sources: 2, sourcesFailed: 1, rejected: 1, passedScreen: 2, activity: { matureIncluded: true, sourcesFailed: 1, groups: [{ label: 'Mature', coins: 2, selected: 1, sharePct: 75 }, { label: 'Rocket launches', coins: 1, selected: 0, sharePct: 25 }] } };
    }
    if (url.pathname === '/api/balance') json = { sol: 1, tokenRaw: '0' };
    if (url.pathname === '/api/chain') json = { blockhash: '11111111111111111111111111111111' };
    if (url.pathname === '/api/status') json = { outcome };
    if (url.pathname === '/api/send') {
      const body = route.request().postDataJSON(), tx = Transaction.from(Buffer.from(body.transaction, 'base64'));
      check(tx.verifySignatures(), 'withdrawal signature is valid after private key encapsulation');
      json = { signature: 'synthetic-withdrawal' };
    }
    if (url.pathname === '/api/coin') json = { prices: {}, liquidity: {} };
    if (url.pathname === '/api/manage') json = { results: [] };
    if (url.pathname === '/api/sync') return route.fulfill({ status: 503, json: { setup: true } });
    return route.fulfill({ json });
  });
  await context.addInitScript(() => {
    if (!new URL(location.href).searchParams.has('firstvisit')) localStorage.setItem('warrior.tour.v1', '1');
    localStorage.setItem('warrior.auto.state.v1', JSON.stringify({ positions: [], mode: 'paper', drum: false }));
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const waitIdle = async () => { for (let n = 0; n < 150; n++) { if (await page.evaluate(async () => !(await import('/js/store.js')).lock.busy)) return; await page.waitForTimeout(50); } throw new Error('action did not finish'); };
  page.on('pageerror', (e) => { errors.push(e.message); console.error('BROWSER:', e.message); });
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('equity').textContent.includes('SOL'));
  // A failed Live start must not keep the browser's trading lock.
  const startResult = await page.evaluate(async () => {
    const { state } = await import('/js/store.js'), { start } = await import('/js/impi.js');
    state.mode = 'live'; const why = await start(); state.mode = 'paper';
    const available = await navigator.locks.request('warrior-impi', { ifAvailable: true }, (lock) => !!lock);
    return { why, available };
  });
  check(startResult.why.includes('Make the trading wallet') && startResult.available, 'failed Live start releases/never takes the tab lock');
  const startingResult = await page.evaluate(async () => {
    const { state } = await import('/js/store.js'), { start, stop } = await import('/js/impi.js');
    const original = navigator.locks.request.bind(navigator.locks);
    let release;
    navigator.locks.request = (...args) => new Promise((done) => { release = () => done(original(...args)); });
    try {
      const pending = start(); document.getElementById('mode-live').click();
      const mode = state.mode; release(); const why = await pending; stop(); return { mode, why };
    } finally { navigator.locks.request = original; }
  });
  check(startingResult.mode === 'paper' && startingResult.why === null, 'mode cannot change while the impi is acquiring its trading lock');
  await waitIdle();

  const learning = await page.evaluate(async () => {
    const { state, dials, emit } = await import('/js/store.js');
    const { adaptationBook } = await import('/vendor/lib/adapt.js');
    const { evidence } = await import('/js/adapt.js');
    const { weather, missedByRule } = await import('/js/watch.js');
    const saved = { adapt: state.adapt, watch: state.watch, mode: state.mode, trades: state.trades };
    try {
      state.adapt = { mode: 'off' }; state.watch = {}; state.trades = []; state.mode = 'paper';
      const paper = adaptationBook(state); paper.dials.holdHours = 5;
      paper.probation = { key: 'holdHours', from: 3, to: 5, at: Date.now() };
      state.mode = 'live'; emit('mode'); const liveDials = { ...dials() }, liveProbation = adaptationBook(state).probation;
      state.watch.after = Array.from({ length: 8 }, (_, i) => ({ done: true, mode: 'live', preset: 'balanced', reason: 'time', rules: 'old-rules', at: Date.now()-i*1000, afterMax: 20, afterEnd: 8 }));
      const staleMove = evidence().some(m => m.key === 'holdHours');
      const { resolveRules } = await import('/vendor/lib/presets.js');
      for (const x of state.watch.after) x.rules = resolveRules({ preset: 'balanced' }).version;
      const freshMove = evidence().find(m => m.key === 'holdHours')?.to;
      state.watch.dips = Array.from({ length: 6 }, () => ({ done: true, mode: 'paper', preset: 'balanced', at: Date.now(), bounced: false }));
      const liveWeather = weather();
      const mint = 'synthetic-learning';
      state.mode = 'paper'; emit('missed', { mint, symbol: 'LEARN', price: 2, rule: 'depth', gap: 1 });
      state.mode = 'live'; emit('missed', { mint, symbol: 'LEARN', price: 2, rule: 'depth', gap: 1 });
      const recorded = state.watch.missed.map(x => ({ mode: x.mode, rules: x.rules }));
      for (const x of state.watch.missed) { x.done = true; x.result = 4; }
      const legacyReports = missedByRule();
      state.mode = 'paper'; const paperDials = { ...dials() };
      return { liveDials, liveProbation, staleMove, freshMove, liveWeather, recorded, paperDials, reported: legacyReports.depth?.n };
    } finally { Object.assign(state, saved); emit('mode'); }
  });
  check(Object.keys(learning.liveDials).length === 0 && learning.liveProbation === null, 'practice moves and probation cannot govern live');
  check(learning.paperDials.holdHours === 5, 'switching back retains practice learning');
  check(!learning.staleMove, 'old-rule follow-up prices cannot move current live dials');
  check(learning.freshMove === 5, 'fresh current-rule live evidence still permits a bounded move');
  check(learning.liveWeather.n === 0, 'practice dip outcomes cannot block live exposure');
  check(learning.recorded.length === 2 && learning.recorded.every(x => x.rules), 'both modes record independently with rule provenance');
  check(learning.reported === 1, 'mode-filtered watch reports remain available');

  await page.evaluate(async () => {
    const { emit } = await import('/js/store.js');
    emit('scan', { universe: 3, scanned: 1, results: [{ symbol: 'MATURE', marketType: 'mature', volume1hUsd: 1000000, change: { m5: -2, h1: -5 }, analysis: { decision: 'wait' } }], activity: { matureIncluded: true, sourcesFailed: 1, groups: [{ label: 'Mature', coins: 2, selected: 1, sharePct: 75 }, { label: 'Rocket launches', coins: 1, selected: 0, sharePct: 25 }] } });
  });
  check((await page.locator('#activity-basis').textContent()).includes('not net SOL inflow'), 'activity explains the actual measurement');
  check((await page.locator('#activity-mix').textContent()).includes('Rocket launches: 25.0% · 0 read / 1 seen'), 'unsafe launch interest is visible without a trade');
  check((await page.locator('#flow .coin-type').textContent()) === 'Mature', 'watched coins show their category');

  // Throwaway keys exist only in this isolated context. Phantom never contacts a chain.
  await page.evaluate(async () => {
    const { vault } = await import('/js/wallet.js');
    await vault.create('synthetic browser test passphrase');
    const { state } = await import('/js/store.js'); state.days = { live: { day: new Date().toISOString().slice(0, 10), start: 1 } };
    const { Keypair } = await import('/vendor/solana.js');
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(7));
    window.testSends = 0;
    window.phantom = { solana: {
      connect: async () => ({ publicKey: owner.publicKey }), disconnect: async () => {},
      signAndSendTransaction: async () => { window.testSends++; if (window.holdFunding) await new Promise((done) => { window.releaseFunding = done; }); return { signature: 'synthetic-transfer' }; }
    } };
  });
  await page.locator('#connect').click();
  const fund = () => page.getByRole('button', { name: 'Fund from Phantom', exact: true }).click();
  const close = async () => { await page.locator('#dlg-close').click(); await page.waitForFunction(() => !document.getElementById('dlg').open && !document.querySelector('#dlg-body input')); };
  for (const value of ['0.125', '-1', '']) {
    await fund(); await page.locator('#f-s').fill(value); await close();
    check(await page.locator('#dlg').evaluate((d) => !d.open), `Close works independently of amount ${value}`);
  }
  await fund(); await page.locator('#f-s').fill('0.125');
  check(await page.locator('#f-s').evaluate((i) => i.validity.valid), 'fractional SOL is valid');
  await page.locator('#dlg-go').click();
  await page.waitForFunction(() => document.getElementById('dlg-status').textContent.startsWith('Sent.'));
  await close();
  check(await page.locator('#dlg').evaluate((d) => !d.open), 'confirmed funding dialog closes without clearing the amount');
  check(await page.evaluate(() => window.testSends) === 1, 'funding submits once');
  check(await page.evaluate(async () => (await import('/js/store.js')).state.days.live.start) === 1.125, 'confirmed funding adjusts the daily baseline');
  outcome = 'failed'; await fund(); await page.locator('#f-s').fill('0.01'); await page.locator('#dlg-go').click();
  await page.waitForFunction(() => document.getElementById('dlg-status').textContent.includes('failed on-chain'));
  check(await page.evaluate(async () => (await import('/js/store.js')).state.days.live.start) === 1.125, 'failed funding does not become a deposit');
  check(await page.locator('#dlg-go').isHidden(), 'an on-chain failure does not offer an accidental resend');
  await close(); outcome = 'confirmed';

  // Closing a pending transfer must not let its completion replace a newer dialog.
  await page.evaluate(() => { window.holdFunding = true; });
  await fund(); await page.locator('#f-s').fill('0.05'); await page.locator('#dlg-go').click();
  await page.waitForFunction(() => !!window.releaseFunding); await close();
  await page.locator('#mode-live').click();
  check(await page.evaluate(async () => (await import('/js/store.js')).state.mode) === 'paper', 'mode stays fixed during a transfer');
  await page.getByRole('button', { name: 'Save the backup key (needed for live)', exact: true }).click();
  await page.locator('#f-p').fill('do not replace this dialog');
  await page.evaluate(() => { window.releaseFunding(); window.holdFunding = false; });
  await waitIdle();
  await page.waitForTimeout(100);
  check(await page.locator('#dlg-title').textContent() === 'Your backup key', 'pending completion leaves the new dialog intact');
  check(await page.locator('#f-p').inputValue() === 'do not replace this dialog', 'pending completion preserves the new input');
  check(await page.locator('#dlg-go').isVisible(), 'new dialog action stays usable');
  await close();
  check(await page.locator('#dlg-body input').count() === 0, 'closing clears sensitive dialog contents');
  const baselineBeforeWithdrawal = await page.evaluate(async () => (await import('/js/store.js')).state.days.live.start);
  await page.getByRole('button', { name: 'Send to Phantom', exact: true }).click();
  await page.locator('#f-s').fill('0.01'); await page.locator('#dlg-go').click();
  await page.waitForFunction(() => document.getElementById('dlg-status').textContent === 'Sent.');
  await close();
  check(await page.locator('#dlg').evaluate((d) => !d.open), 'fractional withdrawal dialog also closes after confirmation');
  check(Math.abs(await page.evaluate(async () => (await import('/js/store.js')).state.days.live.start) - (baselineBeforeWithdrawal - 0.01)) < 1e-12, 'confirmed withdrawal adjusts the baseline without recording a trading loss');

  await page.evaluate(async () => {
    const { state, save, emit } = await import('/js/store.js');
    const p = { mint: 'synthetic', symbol: 'SYNTH', solIn: 0.1, tokenRaw: '1000', entry: 1, stop: 0.8, baseStop: 0.8, target: 1.2, last: 1, openedAt: Date.now(), rules: 'balanced-test', auto: {} };
    state.positions = [{ ...p, symbol: 'PAPERCOIN', mode: 'paper' }, { ...p, symbol: 'LIVECOIN', mint: 'live-synthetic', mode: 'live' }];
    save(); emit('positions');
  });
  const liveBefore = await page.evaluate(async () => JSON.stringify((await import('/js/store.js')).state.positions.find((p) => p.mode === 'live')));
  await waitIdle(); await page.locator('[data-preset="spicy"]').click();
  check(await page.evaluate(async () => (await import('/js/store.js')).state.positions.find((p) => p.mode === 'paper').rules.startsWith('spicy')), 'current-mode positions follow the selected strength');
  const liveAfter = await page.evaluate(async () => JSON.stringify((await import('/js/store.js')).state.positions.find((p) => p.mode === 'live')));
  check(liveAfter === liveBefore, 'practice strength changes never rebase live positions');
  await waitIdle();
  await page.locator('#mode-live').click();
  await page.waitForFunction(() => document.getElementById('portfolio').textContent.includes('LIVECOIN'));
  check((await page.locator('#portfolio').textContent()).includes('LIVECOIN') && !(await page.locator('#portfolio').textContent()).includes('PAPERCOIN'), 'portfolio redraws on mode switch');
  await page.locator('#mode-paper').click();

  await page.evaluate(async () => {
    const fetch = window.fetch.bind(window); window.originalTestFetch = fetch;
    window.fetch = async (url, ...args) => {
      if (String(url).startsWith('/api/balance')) return new Promise((done) => { window.releaseBalance = () => done(new Response(JSON.stringify({ sol: 99 }), { headers: { 'Content-Type': 'application/json' } })); });
      return fetch(url, ...args);
    };
  });
  await page.locator('#mode-live').click();
  await page.waitForFunction(() => !!window.releaseBalance);
  await page.locator('#mode-paper').click();
  await page.waitForFunction(() => document.getElementById('pnl-mode').textContent === 'PRACTICE');
  const practiceEquity = await page.locator('#equity').textContent();
  await page.evaluate(() => { window.releaseBalance(); window.fetch = window.originalTestFetch; });
  await page.waitForTimeout(100);
  check(await page.locator('#equity').textContent() === practiceEquity, 'late Live balance cannot overwrite Practice equity');

  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  // Simulate the average moving after an add while this dialog remains open.
  await page.evaluate(async () => { (await import('/js/store.js')).state.positions.find((p) => p.mode === 'paper').entry = 2; });
  await page.getByLabel('My stop (% below what I paid; 0 = break-even)', { exact: true }).fill('20');
  await page.evaluate(async () => { (await import('/js/store.js')).state.positions.find((p) => p.mode === 'paper').last = 2; });
  await page.getByRole('button', { name: 'Save my stop and target', exact: true }).click();
  check(await page.evaluate(async () => (await import('/js/store.js')).state.positions.find((p) => p.mode === 'paper').ownStop) === 1.6, 'Manage uses the updated average after an add');
  await page.locator('#pos-close').click();
  // A returned quote must refresh the portfolio, and an emptied pool must agree with the position table.
  await page.evaluate(async () => {
    const { state, emit } = await import('/js/store.js'); const p = state.positions.find((p) => p.mode === 'paper');
    p.empty = true; p.nowSol = 0.2; emit('positions');
  });
  await page.waitForFunction(() => document.getElementById('positions').textContent.includes('-100.0%'));
  check((await page.locator('#portfolio').textContent()).includes('-100.0%'), 'emptied-pool valuation agrees across portfolio and positions');
  await page.evaluate(async () => { const {state,emit} = await import('/js/store.js'); const p=state.positions.find((p)=>p.mode==='paper'); p.empty=false; p.symbol='LONGCOIN'.repeat(16); emit('positions'); });

  for (const theme of ['light', 'dark']) for (const width of [320, 390, 520, 700, 800, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    // Expand every mobile panel as well as checking the initially collapsed layout.
    await page.evaluate(() => { for (const card of document.querySelectorAll('.card')) window.dispatchEvent(new CustomEvent('warrior-reveal', { detail: card })); });
    await page.waitForTimeout(60);
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, width: innerWidth }));
    check(overflow.body <= overflow.width + 1, `${theme} ${width}px: no page overflow (${JSON.stringify(overflow)})`);
    const portfolioFits = await page.locator('.pf-list').last().evaluate((list) => list.scrollWidth <= list.clientWidth + 1);
    check(portfolioFits, `${theme} ${width}px: long token names leave portfolio values reachable`);
    check(await page.locator('.card.flow').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `${theme} ${width}px: activity report and order flow fit the card`);
    await fund(); await page.locator('#f-s').fill('0.125');
    const rect = await page.locator('#dlg-close').boundingBox();
    check(rect.x >= 0 && rect.x + rect.width <= width + 1, `${theme} ${width}px: dialog Close is reachable`);
    if (artifacts && [390, 1440].includes(width)) await page.screenshot({ path: resolve(artifacts, `fund-${theme}-${width}.png`) });
    await close();
    if (artifacts && [390, 1440].includes(width)) { await page.locator('.card.care').screenshot({ path: resolve(artifacts, `care-${theme}-${width}.png`) }); }
    if (artifacts && [390, 1440].includes(width)) await page.locator('.card.flow').screenshot({ path: resolve(artifacts, `activity-${theme}-${width}.png`) });
  }
  for (const [width, height] of [[320, 800], [390, 800], [1024, 800], [1440, 800], [700, 320]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#tour').click();
    for (let step = 0; step < 21; step++) {
      await page.waitForTimeout(160);
      const card = await page.locator('.tour-card').boundingBox();
      check(card && card.x >= -1 && card.y >= -1 && card.x + card.width <= width + 1 && card.y + card.height <= height + 1, `${width}px tour step ${step + 1} stays on screen`);
      await page.locator('.tour-card').getByRole('button', { name: step === 20 ? 'Finish' : 'Next', exact: true }).click();
    }
  }
  // CSV must not turn an untrusted token symbol into a spreadsheet formula.
  await page.evaluate(async () => { const { state } = await import('/js/store.js'); state.trades = [{ closedAt: Date.now(), mode: 'paper', symbol: '=1+1', solIn: 0.1, solOut: 0.11, pnlSol: 0.01, pnlPct: 10, reason: 'manual' }]; });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#csv').click();
  const download = await downloadPromise, csv = await readFile(await download.path(), 'utf8');
  check(csv.includes("'=1+1"), 'actual desk CSV neutralizes formula symbols');
  await page.evaluate(async () => { const { state } = await import('/js/store.js'); state.orders = [{ id: 1, mode: 'paper', status: 'waiting' }, { id: 2, mode: 'live', status: 'waiting' }]; });
  await page.locator('#reset').click();
  const reset = await page.evaluate(async () => { const { state } = await import('/js/store.js'); return { paper: state.positions.filter((p) => p.mode === 'paper').length, live: state.positions.filter((p) => p.mode === 'live').length, orders: state.orders }; });
  check(reset.paper === 0 && reset.live === 1 && reset.orders.length === 1 && reset.orders[0].mode === 'live', 'Practice reset clears its orders and preserves Live holdings/orders');
  // First-visit autoplay must not intercept keyboard input in a wallet dialog.
  await page.evaluate(() => localStorage.removeItem('warrior.tour.v1'));
  await page.goto(`${base}/?firstvisit`);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForTimeout(1800);
  check(await page.locator('.tour-card:visible').count() === 0, 'first-visit tour does not start over an open wallet dialog');
  await page.locator('#f-p').fill('not a real passphrase');
  await page.keyboard.press('Escape');
  check(await page.locator('#dlg').evaluate((d) => !d.open), 'Escape closes the wallet dialog without tutorial interception');
  // Key protection uses only the existing Unlock, Backup key, Show and Close controls.
  const phrase = 'synthetic browser test passphrase';
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('#f-p').fill(phrase); await page.locator('#dlg-go').click();
  await page.waitForFunction(() => !document.getElementById('dlg').open);
  check(await page.evaluate(async () => { const { vault } = await import('/js/wallet.js'); return vault.unlocked && vault.keypair === undefined && vault.syncKey === undefined; }), 'wallet modules do not export raw signing or encryption keys');
  const walletAddress = await page.evaluate(async () => (await import('/js/wallet.js')).vault.address);
  const fixture = (payer, unexpected = false) => new VersionedTransaction(new TransactionMessage({
    payerKey: new PublicKey(payer), recentBlockhash: '11111111111111111111111111111111',
    instructions: [unexpected ? new TransactionInstruction({ programId: Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey, keys: [], data: Buffer.alloc(0) }) : SystemProgram.transfer({ fromPubkey: new PublicKey(payer), toPubkey: SystemProgram.programId, lamports: 1 })]
  }).compileToV0Message()).serialize();
  const signFixture = (bytes) => page.evaluate(async (bytes) => {
    const { vault } = await import('/js/wallet.js'), { VersionedTransaction } = await import('/vendor/solana.js');
    const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
    try { vault.signTransaction(tx); return { signed: [...tx.serialize()] }; } catch (e) { return { error: e.message }; }
  }, [...bytes]);
  const signedFixture = await signFixture(fixture(walletAddress));
  check(!!signedFixture.signed, 'versioned transactions still sign without exporting the private key');
  const signed = VersionedTransaction.deserialize(Uint8Array.from(signedFixture.signed));
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(walletAddress).toBuffer()]);
  check(verify(null, Buffer.from(signed.message.serialize()), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(signed.signatures[0])), 'versioned signature verifies against the wallet address');
  check(!!(await signFixture(fixture(SystemProgram.programId))).error, 'signer refuses a different fee payer');
  check(!!(await signFixture(fixture(walletAddress, true))).error, 'signer refuses an unexpected program');
  check(await page.evaluate(async () => { const { vault } = await import('/js/wallet.js'); const snapshot = { 'warrior.auto.state.v1': JSON.stringify({ positions: [] }) }; return JSON.stringify(await vault.openSnapshot(await vault.sealSnapshot(snapshot))) === JSON.stringify(snapshot); }), 'encrypted sync round-trips without exporting its encryption key');
  const backupButton = () => page.locator('#w-body').getByRole('button', { name: /^(Backup key|Save the backup key \(needed for live\))$/ }).click();
  const reveal = async () => { await backupButton(); await page.locator('#f-p').fill(phrase); await page.locator('#dlg-go').click(); await page.waitForFunction(() => document.getElementById('dlg-status').textContent.startsWith('Backup key: ')); };
  await page.clock.install();
  await reveal();
  check(await page.locator('#f-p').inputValue() === '', 'backup passphrase input clears immediately after use');
  check(await page.evaluate(() => { const key = document.getElementById('dlg-status').textContent.slice('Backup key: '.length); return !Object.values(localStorage).some((value) => value.includes(key)); }), 'revealed key is not saved in browser storage or logs');
  await page.clock.fastForward(45_001);
  check(!(await page.locator('#dlg-status').textContent()).startsWith('Backup key: '), 'backup key hides after 45 seconds');
  check(await page.locator('#dlg-go').isVisible(), 'existing Show action asks for the passphrase again');
  await close();
  await reveal(); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check(!(await page.locator('#dlg-status').textContent()).startsWith('Backup key: '), 'leaving focus hides the revealed key');
  await close();
  await backupButton(); await page.locator('#f-p').fill(phrase);
  await page.evaluate(() => { document.getElementById('dlg-go').click(); window.dispatchEvent(new Event('blur')); });
  // Let WebCrypto complete without advancing five minutes or starting the trader.
  await page.waitForTimeout(600);
  check(!(await page.locator('#dlg-status').textContent()).startsWith('Backup key: '), 'a pending reveal cannot reshow its key after focus was lost');
  await close();
  await page.evaluate(async () => { const { state } = await import('/js/store.js'); state.mode = 'live'; state.wasRunning = false; state.backedUp = true; const why = await (await import('/js/impi.js')).start(); if (why) throw new Error(why); });
  await waitIdle();
  check(await page.evaluate(async () => { const { vault, checkWalletIdle } = await import('/js/wallet.js'); checkWalletIdle(Date.now() + 300_001); return vault.unlocked; }), 'idle lock preserves the real running Live trader');
  await page.evaluate(async () => (await import('/js/impi.js')).stop());
  await waitIdle();
  const idleChecks = await page.evaluate(async () => {
    const { vault, checkWalletIdle } = await import('/js/wallet.js'), { state, lock } = await import('/js/store.js');
    const future = () => Date.now() + 300_001, result = {};
    state.positions = [{ mode: 'live' }]; checkWalletIdle(future()); result.position = vault.unlocked;
    state.positions = []; state.orders = [{ mode: 'live', status: 'waiting' }]; checkWalletIdle(future()); result.order = vault.unlocked;
    state.orders = []; lock.busy = true; checkWalletIdle(future()); result.pending = vault.unlocked;
    lock.busy = false; state.wasRunning = true; checkWalletIdle(future()); result.locked = !vault.unlocked; // a saved flag is not an active local trader
    state.mode = 'paper'; return result;
  });
  for (const [name, ok] of Object.entries(idleChecks)) check(ok, `idle key handling: ${name}`);
  const lateUnlock = await page.evaluate(async (phrase) => {
    const { vault } = await import('/js/wallet.js');
    const result = vault.unlock(phrase).then(() => false, () => true);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    return await result && !vault.unlocked;
  }, phrase);
  check(lateUnlock, 'page exit cancels pending unlock instead of resurrecting a key');
  await page.evaluate(async (phrase) => { const { vault } = await import('/js/wallet.js'); await vault.unlock(phrase); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); }, phrase);
  check(await page.evaluate(async () => !(await import('/js/wallet.js')).vault.unlocked), 'page exit locks an unlocked wallet, including back-forward cache');
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} local browser checks; no real wallets, transfers or API calls.`);
  await context.close();
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
