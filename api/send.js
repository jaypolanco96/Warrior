import { rpc, sendProtected } from '../lib/rpc.mjs';
// Relays a transaction that was ALREADY SIGNED in the visitor's browser. The server never sees a key and cannot change
// the transaction: any change would invalidate the signature.
// With `protect`, it goes to Jito's block builders only, not the public queue, so bots watching that queue cannot see it
// first. A protected send is never retried through the public route: that would undo the protection.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Only Warrior's own pages may use this relay. A browser always sends Origin on a cross-site POST.
  const origin = req.headers?.origin; if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'This relay only serves Warrior.' }); } catch { return res.status(403).json({ error: 'This relay only serves Warrior.' }); } }
  const tx = req.body?.transaction, protect = req.body?.protect === true;
  if (req.method !== 'POST' || typeof tx !== 'string' || tx.length > 2000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(tx)) return res.status(400).json({ error: 'Invalid transaction.' });
  try {
    if (protect) return res.status(200).json({ signature: await sendProtected(tx), protected: true });
    res.status(200).json({ signature: await rpc('sendTransaction', [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]), protected: false });
  } catch (e) { res.status(502).json({ error: protect ? 'The protected route refused the transaction. Nothing was sent.' : 'The network refused the transaction. Nothing was sent.', detail: typeof e.rpc?.message === 'string' ? e.rpc.message.slice(0, 160) : null }); }
}
