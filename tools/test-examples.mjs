// Browser check for the real-photo gallery and JPEG journey.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], workers = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('worker', worker => workers.push(worker.url()));
    const cameraUrl = new URL(url);
    cameraUrl.searchParams.set('piece', 'camera');
    await page.goto(cameraUrl.href);
    await page.waitForFunction(() => window.p2p, null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('#workspace-photos').click();
    await page.locator('#rp-picks button').first().waitFor({ state: 'attached' });
    assert.equal(await page.locator('#rp-canvas, .rp-render, #rp-prediction').count(), 0, 'gallery has no synthetic preview');
    assert.equal(await page.locator('#rp-img').getAttribute('src'), 'examples/flycatcher.jpg', 'gallery displays the supplied JPEG');
    const picks = page.locator('#rp-picks button');
    const initialSrc = await page.locator('#rp-img').getAttribute('src');
    const initialTitle = await page.locator('#rp-h').textContent();
    await picks.nth(1).click();
    await page.waitForFunction(() => document.querySelector('#rp-img').getAttribute('src') !== 'examples/flycatcher.jpg');
    assert.notEqual(await page.locator('#rp-h').textContent(), initialTitle, 'selecting a gallery item updates its title');
    const selectedSrc = await page.locator('#rp-img').getAttribute('src');
    await page.locator('#rp-match').click();
    if (await page.locator('#phone-settings').isVisible()) await page.locator('#phone-settings-close').click();
    await page.locator('#workspace-photos').click();
    assert.equal(await page.locator('#rp-img').getAttribute('src'), selectedSrc, 'matching settings preserves the selected photo');
    assert.notEqual(selectedSrc, initialSrc);
    await page.locator('#rp-play').click();
    await page.locator('#shot-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#shot-status').textContent(), /Supplied JPEG|Loading your photograph/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    assert.equal(workers.some(url => url.includes('example-worker')), false, 'gallery does not create a synthetic-render worker');
    console.log(`examples ${width}: passed`);
    await context.close();
  }
} finally { await browser.close(); await server?.close(); }
