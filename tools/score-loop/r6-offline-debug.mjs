// Score loop r6: why an offline reload straight after a first visit fails (debug aid): lists the requests that failed and what the cache holds.
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-offline-debug.mjs
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(60000);
await page.goto(`${base}?sw=1&piece=camera&lens=n50`);
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r?.active && !!navigator.serviceWorker.controller; });
await page.waitForTimeout(8000);
const have = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(k.slice(0, 8) + ' ' + r.url.replace(location.origin, '')); return out; });
console.log(have.length, 'cached');
const res = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name.replace(location.origin, '')));
console.log('resources not cached:', res.filter((r) => !have.some((h) => h.endsWith(r))).join(' | '));
await context.setOffline(true);
page.on('requestfailed', (r) => console.log('FAILED', r.url().replace(base, ''), r.failure()?.errorText));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 160)); });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
await page.reload();
await page.waitForTimeout(8000);
console.log('title', await page.title(), 'loaded', await page.evaluate(() => window.p2p?.pieces.camera.state().loaded));
await browser.close();
