// Delay actual worker requests: verify honest loading UI, then real pixel recovery.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/loupe-loading', { recursive: true });
try {
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    page.setDefaultTimeout(45000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.addInitScript(() => {
      const post = Worker.prototype.postMessage;
      window.renderDelay = 0; window.failNextPixel = false;
      Worker.prototype.postMessage = function (...args) {
        const message = args[0];
        if (message?.type === 'pixel' && window.failNextPixel) {
          window.failNextPixel = false;
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', id: message.id, error: 'Injected pixel request failure' },
          })), 100);
        } else if (message?.type === 'render' && window.renderDelay) {
          setTimeout(() => post.apply(this, args), window.renderDelay);
        } else post.apply(this, args);
      };
    });
    const url = new URL(`?piece=loupe&lens=m50${backend === 'webgl2' ? '&gl=webgl2' : ''}`, process.env.P2P_URL || server.url);
    await page.goto(url.href);
    await page.waitForFunction(() => window.p2p?.pieces.loupe.state().hasPixel);
    assert.equal(await page.evaluate(() => window.p2p.backend()), backend);
    await page.waitForFunction(() => !window.p2p.framing().moving);
    await page.evaluate(() => { window.renderDelay = 1800; window.p2p.set({ lens: 'n50' }); });
    await page.locator('#steps [data-piece="camera"]').click();
    await page.locator('#steps [data-piece="loupe"]').click();
    assert.equal(await page.locator('#veil').evaluate(el => el.classList.contains('off')), false);
    assert.match(await page.locator('#veil-msg').textContent(), /Preparing the photo/);
    assert.equal(await page.locator('#pins').evaluate(el => el.classList.contains('held')), true);
    assert.equal(await page.locator('#scale-badge').isVisible(), false);
    await page.screenshot({ path: `shots/loupe-loading/waiting-${backend}.png` });
    await page.waitForFunction(() => window.p2p.render()?.scenario.lens === 'n50' && window.p2p.pieces.loupe.state().hasPixel);
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well' && !window.p2p.framing().moving
      && getComputedStyle(document.getElementById('veil')).opacity === '0');
    assert.equal(await page.locator('#pins').evaluate(el => el.classList.contains('held')), false);
    await page.screenshot({ path: `shots/loupe-loading/recovered-${backend}.png` });
    // A failed pixel query needs an apparent retry, and retry must query the real
    // completed render rather than inventing a sample or requesting new physics.
    await page.evaluate(() => { window.failNextPixel = true; window.p2p.pieces.loupe.tap(150, 90); });
    await page.locator('.lv-status button').waitFor({ state: 'visible' });
    assert.match(await page.locator('.lv-status').textContent(), /could not load/);
    const box = await page.locator('.lv-status').boundingBox(), view = await page.locator('#view').boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - view.y - view.height / 2) < 2, 'error is centered in the inspection');
    await page.locator('.lv-status button').click();
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel);
    assert.equal(await page.locator('.lv-status').isVisible(), false);
    // Leaving pending Pixel must clear only its own veil, even when it completes later.
    await page.evaluate(() => window.p2p.set({ fno: 8 }));
    await page.locator('#steps [data-piece="lens"]').click();
    assert.equal(await page.locator('#veil').evaluate(el => el.classList.contains('off')), true);
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('#veil').evaluate(el => el.classList.contains('off')), true);
    assert.deepEqual(errors, []);
    console.log(`PASS ${backend}: delayed real photo has central loading, matching pixel recovers, query failure retries, hidden work stays isolated`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
