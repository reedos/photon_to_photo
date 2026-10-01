// Regression check for the phone grid and first-visit labels; also captures the revised model exteriors.
// Each run builds its own preview. P2P_PREVIEW_PORT=47693 node tools/polish-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const out = 'shots/polish/verified';
mkdirSync(out, { recursive: true });
const { url, close } = await startPreview();
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const [width, lens, focus] of [[320, 'm50', 3], [390, 'n50', 1.5], [390, 'z800', 30],
    [390, 'n500fl', 4], [768, 'n50', 3], [1600, 'm50', 3], [1600, 'n500fl', 4]]) {
    const phone = width < 760;
    const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 1000 },
      isMobile: phone, hasTouch: phone, colorScheme: 'dark' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${url}?piece=camera&lens=${lens}&focus=${focus}`);
      await page.waitForFunction(() => window.p2p?.pieces.camera);
      await page.waitForSelector('#rp-picks .rp-pick');
      await page.locator('#stage-section').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.p2p.pieces.camera.ready());
      await page.waitForFunction(() => document.querySelectorAll('.rig-teach:not(.gone)').length === 3);
      await page.evaluate(() => window.p2p.gpuIdle());
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const view = rect(document.querySelector('#view'));
        const camera = window.p2p.pieces.camera.camDebug();
        const [xmin, xmax, ymin, ymax] = camera.ndc;
        const w = view.r - view.l, h = view.b - view.t;
        return { viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          backend: window.p2p.backend(), view, model: { l: view.l + (xmin + 1) * w / 2,
            r: view.l + (xmax + 1) * w / 2, t: view.t + (1 - ymax) * h / 2, b: view.t + (1 - ymin) * h / 2 },
          labels: [...document.querySelectorAll('.rig-teach:not(.gone) span')].filter(e => !e.hidden).map(rect) };
      });
      assert.equal(metrics.backend, 'webgpu');
      assert.equal(metrics.viewport, width);
      assert.ok(metrics.scroll <= width + 1, `page widened to ${metrics.scroll}px at ${width}px`);
      if (phone) {
        assert.equal(metrics.labels.length, 3, 'all three control hints remain visible');
        const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        metrics.labels.forEach((label, i) => {
          assert.ok(label.l >= metrics.view.l && label.r <= metrics.view.r && label.t >= metrics.view.t && label.b <= metrics.view.b, 'label within stage');
          assert.ok(!overlap(label, metrics.model), 'label clear of projected model');
          assert.ok(!metrics.labels.slice(i + 1).some(other => overlap(label, other)), 'labels do not overlap');
        });
      }
      await page.locator('#view').screenshot({ path: `${out}/${width}-${lens}.png` });
      if (phone) {
        await page.locator('.exposure-details summary').click();
        const button = page.locator('.rx-eq-close');
        const before = await button.evaluate(e => getComputedStyle(e).backgroundColor);
        await button.tap();
        await page.waitForTimeout(250);
        assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), before, 'touch does not leave a filled hover');
      }
      if (lens === 'n500fl' && !phone) {
        await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
        await page.locator('#stage-section').scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.locator('#view').screenshot({ path: `${out}/1600-n500fl-cutaway.png` });
        await page.evaluate(() => window.p2p.set({ scene: 'bench' }));
        await page.waitForFunction(() => document.querySelector('#finalimg-cap').textContent.includes('small foreground swatch'), null, { timeout: 60000 });
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px ${lens}: page width, ${phone ? 'hints, touch hover, ' : ''}no page errors`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await close(); }
