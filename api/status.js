import { rpc } from '../lib/rpc.mjs';
// Read-only: has this transaction confirmed, failed, or is it still unknown?
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = req.query?.signature; if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s)) return res.status(400).json({ error: 'Invalid signature.' });
  try {
    const v = (await rpc('getSignatureStatuses', [[s], { searchTransactionHistory: true }])).value[0];
    res.status(200).json({ outcome: !v ? 'unknown' : v.err ? 'failed' : ['confirmed', 'finalized'].includes(v.confirmationStatus) ? 'confirmed' : 'unknown' });
  } catch { res.status(200).json({ outcome: 'unknown' }); }
}
