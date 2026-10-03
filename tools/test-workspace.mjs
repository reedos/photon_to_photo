// Verify the default working surface fits, and compact controls retain real engine actions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce',
      isMobile: width < 760, hasTouch: width < 760 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${url}?piece=camera&lens=n50`);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    for (const selector of ['#kit-body', '#kit-lens', '#kit-scene', '#finalimg-canvas', '#sc-fno', '#sc-focus', '#sc-shutter', '#sc-iso', '.rx-fire']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${selector} fits ${width}×${height}: ${JSON.stringify(box)}`);
    }
    await page.locator('#kit-body').selectOption('mirrorless');
    assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'm50');
    assert.equal(await page.evaluate(() => window.p2p.model().scenario.sensor), 'full-frame-z8');
    await page.locator('#kit-lens').selectOption('z800');
    assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'z800');
    await page.locator('#kit-scene').selectOption('bench');
    assert.equal(await page.evaluate(() => window.p2p.scenario().scene), 'bench');
    const before = await page.evaluate(() => window.p2p.scenario().iso);
    await page.locator('#sc-iso').focus();
    await page.locator('#sc-iso').press('ArrowRight');
    assert.ok(await page.evaluate(value => window.p2p.scenario().iso > value, before));
    await page.locator('#tab-controls').focus();
    await page.locator('#tab-controls').press('ArrowRight');
    assert.equal(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#studio-explain').isVisible(), true);
    await page.locator('#parts button[data-part-id="iris"]').click();
    assert.equal(await page.locator('#card').isVisible(), true);
    const photo = await page.locator('#finalimg-canvas').boundingBox();
    assert.ok(photo.y >= 0 && photo.y + photo.height <= height, 'photo stays in view while reading a part');
    assert.equal(await page.locator('#finalimg-canvas').evaluate(canvas => {
      const box = canvas.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === canvas;
    }), true, 'part explanation does not cover the photo');
    await page.locator('#steps [data-piece="camera"]').click();
    assert.equal(await page.locator('#studio-explain').isVisible(), true, 'overview does not hide the parts pane');
    await page.locator('#tab-controls').click();
    await page.locator('.rx-fire').click();
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.exposure().status), 'paused');
    assert.equal(await page.locator('.rx-scrub').isVisible(), true);
    await page.locator('#finalimg-canvas').focus();
    await page.locator('#finalimg-canvas').press('Enter');
    assert.equal(new URL(page.url()).searchParams.get('piece'), 'loupe');
    assert.equal(await page.locator('#finalimg-canvas').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS workspace ${width}×${height}: visible controls/photo, selectors, keyboard tabs, part return, playback, pixel inspection`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
