// Runs before the page paints, so a dark-mode visit never flashes light. Choice is kept in this browser; the default follows the device.
(() => { let t = null; try { t = localStorage.getItem('warrior.theme'); } catch { /* blocked */ }
  if (t !== 'dark' && t !== 'light') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t; })();
