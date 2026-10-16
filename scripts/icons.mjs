// Render the PNG icons (favicon, app icons, maskable icon, Apple touch icon) from public/logo.svg with headless Chrome.
// Run once after changing the logo: node scripts/icons.mjs  (needs playwright-core and Chrome; not part of the build).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
// A maskable icon must keep its picture inside the middle 80%, on a full-bleed background.
const sheet = (size, pad, bg) => `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${bg};display:flex;align-items:center;justify-content:center">
  <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`;
const BEAD = 'linear-gradient(135deg,#fff8ec 0%,#ffe8c2 100%)';
for (const [file, size, pad, bg] of [['favicon-32.png', 32, 0, 'transparent'], ['icon-192.png', 192, 8, BEAD], ['icon-512.png', 512, 20, BEAD], ['icon-maskable-512.png', 512, 70, BEAD], ['apple-touch-icon.png', 180, 12, BEAD]]) {
  await page.setViewportSize({ width: size, height: size }); await page.setContent(sheet(size, pad, bg));
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), omitBackground: bg === 'transparent' });
  console.log('wrote', file);
}
await browser.close();
