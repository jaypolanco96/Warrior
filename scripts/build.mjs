// Bundles the Solana library into the site so a page that holds a trading key loads no third-party scripts.
// The version is pinned by package-lock.json.
import { build } from 'esbuild';
import { writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/vendor', { recursive: true });
writeFileSync('scripts/.vendor-entry.mjs', "export { Keypair, VersionedTransaction, Transaction, TransactionInstruction, SystemProgram, PublicKey } from '@solana/web3.js';\nexport { ed25519 } from '@noble/curves/ed25519';\n");
await build({ entryPoints: ['scripts/.vendor-entry.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: 'public/vendor/solana.js', define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
// The feel rules are tested in Node (tests/joy.test.mjs) and shipped unchanged, so the page cannot drift from them.
copyFileSync('lib/joy.mjs', 'public/vendor/joy-rules.js');
// The strategy, risk, preset, order and portfolio rules are shipped the same way: one source, tested in Node, used by both
// the server and the page. Imports are rewritten from .mjs to .js so every host serves them as scripts.
mkdirSync('public/vendor/lib', { recursive: true });
for (const name of ['indicators', 'strategy', 'risk', 'presets', 'orders', 'portfolio', 'follow', 'coach', 'receipt', 'mood', 'story', 'scorecard', 'vault', 'rocket', 'sync']) writeFileSync(`public/vendor/lib/${name}.js`, readFileSync(`lib/${name}.mjs`, 'utf8').replace(/(from\s+'\.\/[\w-]+)\.mjs'/g, "$1.js'"));
console.log('Bundled public/vendor/solana.js and copied the feel rules and the trading rules');
