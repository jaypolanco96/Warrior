// Alerts (from Laugh): a phone or desktop notification when Warrior buys, sells, pauses, hits the daily limit or meets a
// problem, so you hear about it with the tab in the background. Phones only show notifications through an installed
// helper, so the offline helper (sw.js) is registered here too; it never stores anything from /api.
import { state, save, on, emit } from './store.js';

const $ = (id) => document.getElementById(id);
const supported = () => typeof Notification !== 'undefined';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* alerts still show on the page */ });

function draw() {
  const b = $('alerts-toggle'); if (!b) return;
  const blocked = supported() && Notification.permission === 'denied', on_ = !!state.alerts && supported() && Notification.permission === 'granted';
  b.textContent = on_ ? 'Alerts on' : 'Alerts off'; b.setAttribute('aria-pressed', String(on_)); b.disabled = !supported() || blocked;
  $('alerts-note').textContent = !supported() ? 'This browser does not support notifications. Everything still shows in the live feed.'
    : blocked ? 'Notifications are blocked for this site in your browser settings. Everything still shows in the live feed.'
    : on_ ? 'You get a notification for every buy and sale, a pause, the daily limit and any problem, while Warrior is in the background.'
    : 'Turn on to get a notification for buys, sales, pauses and problems while Warrior is in the background.';
}
function systemNote(title, body) {
  if (!state.alerts || !supported() || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const direct = () => { try { new Notification(title, { body, icon: '/icon-192.png' }); } catch { /* the feed has it */ } };
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png' })).catch(direct); else direct();
}
$('alerts-toggle')?.addEventListener('click', async () => {
  if (state.alerts && Notification.permission === 'granted') { state.alerts = false; save(); draw(); return; }
  let permission = Notification.permission; if (permission === 'default') { try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; } }
  state.alerts = permission === 'granted'; save(); draw();
  if (state.alerts) emit('say', { who: 'umlobi', text: 'Alerts are on: you will get a notification for trades, pauses and problems while Warrior is in the background.' });
});
on('trade', ({ side, symbol, sol, pnl, reason } = {}) => {
  if (side === 'buy') systemNote(`Warrior bought ${symbol}`, `${Number(sol).toFixed(4)} SOL${state.mode === 'live' ? '' : ' (practice)'}`);
  else if (side === 'sell' && Number.isFinite(pnl)) systemNote(`Warrior sold ${symbol}: ${pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(4)} SOL`, `${reason ?? ''}${state.mode === 'live' ? '' : ' (practice)'}`);
});
on('alert', ({ title, body } = {}) => systemNote(title, body));
on('synced', draw);
draw();
