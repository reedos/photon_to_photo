// Score loop r4: failure states, checked in a browser against a production build.
//   1. a lens swap that fails offline keeps the previous lens on screen, with a banner (message, Retry, Keep current lens)
//   2. "Keep current lens" brings the previous lens back and lifts the banner
//   3. with no WebGL2 and no WebGPU the opening says so, and the start-failure screen has role=alert, hides the Fire /
//      Rays / slider controls and offers the 2D reference
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-failures.mjs [outdir]
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47807/';
const out = process.argv[2] || 'shots/r4';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  // 1 and 2: a swap that fails
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(url + '?piece=camera&lens=n50');
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
    await page.evaluate(() => window.p2p.settle());
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    await page.locator('button[data-lens="n500"]').first().evaluate((b) => b.click());
    await page.locator('#veil.err #veil-reload').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(600);
    const banner = await page.evaluate(() => {
      const v = document.getElementById('veil'), r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { shown: b.width > 0, covered: !!hit && !e.contains(hit) }; };
      return { swap: v.classList.contains('swap'), bg: getComputedStyle(v).backgroundColor, msg: document.getElementById('veil-msg').textContent, keep: r('veil-keep'), retry: r('veil-reload'),
        lens: window.p2p.pieces.camera.state().lens, loaded: window.p2p.pieces.camera.state().loaded };
    });
    console.log('swap failure', JSON.stringify(banner));
    await page.screenshot({ path: `${out}/failed-swap-banner-390.png` });
    assert.equal(banner.swap, true, 'the failed swap shows as a banner');
    assert.equal(banner.bg, 'rgba(0, 0, 0, 0)', 'the veil is transparent, so the previous lens shows');
    assert.ok(banner.keep.shown && !banner.keep.covered && banner.retry.shown && !banner.retry.covered, 'Keep and Retry are reachable');
    assert.equal(banner.lens, 'n50', 'the previous lens is still mounted');
    await page.locator('#veil-keep').click();
    await page.waitForFunction(() => document.getElementById('veil').classList.contains('off') && !document.getElementById('veil').classList.contains('err'), null, { timeout: 30000 });
    const after = await page.evaluate(() => ({ lens: window.p2p.scenario().lens, rig: window.p2p.pieces.camera.state().lens }));
    console.log('after Keep current lens', JSON.stringify(after));
    assert.deepEqual(after, { lens: 'n50', rig: 'n50' });
    await page.screenshot({ path: `${out}/kept-lens-390.png` });
    await context.close();
  }
  // 3: no 3D at all
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl|webgpu/i.test(String(kind)) ? null : getContext.call(this, kind, ...rest); };
      Object.defineProperty(Navigator.prototype, 'gpu', { value: undefined, configurable: true });
      delete Navigator.prototype.gpu;
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(url);
    await page.locator('#opening-explore').waitFor({ state: 'visible' });
    const note = await page.evaluate(() => { const n = document.getElementById('opening-no3d'); return { hidden: n.hidden, text: n.textContent }; });
    console.log('opening note', JSON.stringify(note));
    assert.equal(note.hidden, false, 'the opening says the 3D view is unavailable');
    await page.screenshot({ path: `${out}/nogl-opening-390.png` });
    await page.locator('#opening-explore').click();
    await page.locator('#veil.err').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    const fail = await page.evaluate(() => {
      const shown = (sel) => { const e = document.querySelector(sel); if (!e) return 'none'; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? 'visible' : 'hidden'; };
      return { role: document.getElementById('veil').getAttribute('role'), scenario: shown('#scenario'), rays: shown('#rays-chip'), fire: shown('#compact-fire'), reference: shown('#veil-reference'),
        inertScenario: document.getElementById('scenario').inert };
    });
    console.log('start failure', JSON.stringify(fail));
    await page.screenshot({ path: `${out}/nogl-failure-390.png` });
    assert.equal(fail.role, 'alert');
    assert.equal(fail.scenario, 'hidden'); assert.equal(fail.rays, 'hidden'); assert.equal(fail.fire, 'hidden'); assert.equal(fail.reference, 'visible'); assert.equal(fail.inertScenario, true);
    await context.close();
  }
  console.log('PASS failure states');
} finally { await browser.close(); }
