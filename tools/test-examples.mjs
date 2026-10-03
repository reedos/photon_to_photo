// Optional P2P_BASELINE_URL compares the unchanged prediction pixels/figures with a previously deployed build.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
async function fingerprint(page) {
  return page.evaluate(async () => {
    const c = document.getElementById('rp-canvas'), bytes = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    return { hash, figures: [...document.querySelectorAll('#rp-specs dt, #rp-specs dd')].map(e => e.textContent.trim()) };
  });
}
try {
  let baseline;
  if (process.env.P2P_BASELINE_URL) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(process.env.P2P_BASELINE_URL); await page.waitForFunction(() => window.p2p, null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('#rp-card').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#rp-specs dt').length === 4);
    baseline = await fingerprint(page); console.log('Baseline:', JSON.stringify(baseline)); await page.close();
  }
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], workers = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('worker', worker => { if (worker.url().includes('example-worker')) workers.push(worker.url()); });
    await page.goto(url); await page.waitForFunction(() => window.p2p, null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.waitForFunction(() => window.p2p.render());
    await page.locator('#rp-picks button').first().waitFor({ state: 'attached' });
    assert.equal(workers.length, 0, 'offscreen comparison must not create a worker');
    assert.equal(await page.locator('#rp-img').getAttribute('src'), null, 'full example photo is also deferred');
    const shot = await page.evaluate(() => ({ id: window.p2p.render().renderId, scenario: window.p2p.scenario() }));
    // Touch the viewport boundary exactly, then enter it: threshold-zero observers can miss this transition.
    await page.evaluate(() => window.scrollTo(0, document.getElementById('rp-card').getBoundingClientRect().top + scrollY - innerHeight));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollBy(0, 24));
    await page.waitForFunction(() => document.getElementById('rp-canvas').getAttribute('aria-busy') === 'true');
    await page.evaluate(() => { window.heartbeat = []; let last = performance.now(); window.beatTimer = setInterval(() => { const now = performance.now(); window.heartbeat.push(now - last); last = now; }, 20); });
    await page.locator('#rp-card').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getElementById('rp-canvas').dataset.example === 'flycatcher', null, { timeout: 90000 });
    const gap = await page.evaluate(() => { clearInterval(window.beatTimer); return Math.max(...window.heartbeat); });
    assert.ok(gap < 1000, `example render must not block the page for seconds: max gap ${gap} ms`);
    const first = await fingerprint(page);
    if (baseline) assert.deepEqual(first, baseline, 'worker preserves every output byte and figure');
    assert.deepEqual(await page.evaluate(() => ({ id: window.p2p.render().renderId, scenario: window.p2p.scenario() })), shot, 'example does not replace the live photo or scenario');
    const picks = page.locator('#rp-picks button');
    const lastId = await picks.last().getAttribute('data-id');
    await picks.nth(1).click(); await picks.last().click();
    await page.waitForFunction(id => document.getElementById('rp-canvas').dataset.example === id, lastId, { timeout: 90000 });
    await picks.first().click();
    assert.deepEqual(await fingerprint(page), first, 'cached selection restores the original pixels');
    const count = workers.length;
    await picks.last().click();
    assert.equal(workers.length, count, 'completed examples reuse the cache');
    assert.equal(await page.locator('#rp-canvas').getAttribute('data-example'), lastId, 'canceled intermediate selection never replaces the requested one');
    // A failed worker is recoverable without reloading the camera.
    await context.route('**/example-worker-*.js', route => route.abort());
    await picks.nth(2).click(); await page.locator('#rp-retry').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#rp-canvas').getAttribute('data-example'), null, 'failed request does not show stale pixels');
    await context.unroute('**/example-worker-*.js'); await page.locator('#rp-retry').click();
    const retryId = await picks.nth(2).getAttribute('data-id');
    await page.waitForFunction(id => document.getElementById('rp-canvas').dataset.example === id, retryId, { timeout: 90000 });
    assert.equal(await page.locator('#rp-canvas').getAttribute('aria-busy'), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []); console.log(`examples ${width}: passed; largest main-thread interval ${gap.toFixed(0)} ms`);
    await context.close();
  }
} finally { await browser.close(); await server?.close(); }
