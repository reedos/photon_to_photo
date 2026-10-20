// Return visits and no network (score loop r5): the service worker (src/sw/sw-template.js) keeps what the page asked for.
//   1. The build writes sw.js with a real build id.
//   2. A first visit registers it (with ?sw=1: browser automation does not register it otherwise) and the models, chunks and
//      the page itself are on the device afterwards.
//   3. With the network off, a reload still brings the camera up (the code, the two GLBs and the page all come from the device).
//   4. A visit with the network back and the same build asks the network for nothing it has (the GLBs and chunks are not fetched again).
//   P2P_URL=... uses a server that is already running; otherwise this builds and serves its own copy on port 47741.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let server = null, base = process.env.P2P_URL;
if (!base) {
  await build({ build: { outDir: 'dist-sw' }, logLevel: 'warn' });
  server = await preview({ build: { outDir: 'dist-sw' }, preview: { host: '127.0.0.1', port: 47741, strictPort: true }, logLevel: 'warn' });
  base = 'http://127.0.0.1:47741/';
  const sw = readFileSync('dist-sw/sw.js', 'utf8');
  assert.ok(/const BUILD = '[0-9a-f]{12}'/.test(sw), 'sw.js carries a build id');
  console.log('ok   sw.js is emitted with a build id');
}
base = base.replace(/\/?$/, '/');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = `${base}?sw=1&piece=camera&lens=n50`;
  await page.goto(url);
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
  await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r?.active && !!navigator.serviceWorker.controller; }, null, { timeout: 30000 });
  // Score loop r6: the page hands the worker what it loaded, and the site's other pages, once the worker is active, so the first visit is on
  // the device with no second online load (r5 reloaded here first, which hid that offline right after a first visit failed). Wait for it.
  await page.waitForFunction(async () => {
    for (const key of await caches.keys()) {
      if (key === 'p2p-index' || !key.startsWith('p2p-')) continue;
      const urls = (await (await caches.open(key)).keys()).map((r) => r.url);
      if (urls.some((u) => /models\/dslr\.glb/.test(u)) && urls.some((u) => /models\/lenses\/n50\.glb/.test(u)) && urls.some((u) => /\/models\.html$/.test(u)) && urls.some((u) => /\/reference\.html$/.test(u))) return true;
    }
    return false;
  }, null, { timeout: 60000 });
  const names = await page.evaluate(async () => {
    const out = {};
    for (const key of await caches.keys()) out[key] = (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname.replace(/^.*\/(?=assets|models|draco|examples)/, ''));
    return out;
  });
  const build = Object.keys(names).find((k) => k !== 'p2p-index' && k.startsWith('p2p-'));
  console.log('caches', Object.keys(names).join(', '), '|', build ? names[build].length : 0, 'entries');
  assert.ok(build, 'a cache for this build exists');
  assert.ok(names[build].some((n) => n.endsWith('models/dslr.glb')) && names[build].some((n) => /models\/lenses\/n50\.glb$/.test(n)), 'both GLBs are cached');
  assert.ok(names[build].some((n) => n.startsWith('assets/') && n.endsWith('.js')), 'the code is cached');
  assert.ok(names[build].some((n) => /(^|\/)models\.html$/.test(n)) && names[build].some((n) => /(^|\/)reference\.html$/.test(n)), 'the other two pages are cached');
  console.log('ok   the first visit left the page, the code, both GLBs and the other two pages on the device, with no second load');

  // the network off: a reload is answered from the device
  await context.setOffline(true);
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 });
  console.log(`ok   offline reload: the camera is up in ${Date.now() - t0} ms`);
  // the site's other pages, offline, after a first visit to the camera only (r6: each needed a visit of its own)
  const reference = await context.newPage();
  await reference.goto(`${base}reference.html?page=story`);
  await reference.waitForFunction(() => (document.getElementById('reference-main')?.textContent ?? '').length > 200, null, { timeout: 30000 });
  console.log('ok   offline: reference.html draws');
  await reference.close();
  const models = await context.newPage();
  await models.goto(`${base}models.html`);
  await models.waitForFunction(() => !!document.querySelector('.topbar') && !!window.p2pModels, null, { timeout: 30000 });
  console.log('ok   offline: models.html starts');
  await models.close();
  await context.setOffline(false);

  // the same build, the network back: nothing that is on the device is fetched again (counted at the server)
  if (server) {
    const hits = [];
    server.httpServer.on('request', (req) => { if (/\.(glb|js|wasm|webp)(\?|$)/.test(req.url ?? '')) hits.push(req.url); });
    await page.reload();
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
    await page.waitForTimeout(1500);
    assert.deepEqual(hits, [], `the server was asked for nothing it had already sent (${hits.join(', ')})`);
    console.log('ok   a return visit fetches none of its code or models again (the server saw none)');
  }
  assert.deepEqual(errors, [], 'no page errors');
  await context.close();
} catch (error) {
  failed = true;
  console.log('FAIL', error?.message ?? error);
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(failed ? 'FAIL return visits and offline' : 'PASS return visits and offline');
process.exit(failed ? 1 : 0);
