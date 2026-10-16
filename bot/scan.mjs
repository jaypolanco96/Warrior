// Print one market scan. Read-only: no wallet, no trades.
import { scan } from '../lib/scan.mjs';
const r = await scan({ mature: process.argv.includes('--mature'), limit: Number(process.env.SCAN_LIMIT) || 6 });
console.log(`${r.at}  universe ${r.universe}  screened out ${r.rejected}  analysed ${r.scanned}`);
for (const t of r.results) console.log(`${t.analysis.decision === 'enter' ? 'ENTER' : 'wait '}  ${String(t.symbol).padEnd(12)} ${t.dex.padEnd(12)} score ${t.analysis.score}/4  ${t.analysis.regime ?? '-'}/${t.analysis.bias ?? '-'}  liq $${Math.round(t.liquidityUsd ?? 0)}  ${t.analysis.reasons.join('; ')}`);
