import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/loupe-state', { recursive: true });
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // The loupe used to dive from a tapped pixel of the synthetic photo to its well. Since c6209df it opens on the
    // well of one controlled central pixel (pixel-sample.ts), so "ready" means that sample resolved for the live model.
    await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('#kit-body').selectOption('mirrorless');
    await page.locator('#steps [data-piece="loupe"]').click();
    const ready = async () => {
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, undefined, { timeout: 45000 });
      await page.waitForFunction(() => window.p2p.framing().piece === 'loupe' && !window.p2p.framing().moving, undefined, { timeout: 15000 });
      await page.evaluate(() => window.p2p.settle());
    };
    const centralPixel = () => page.evaluate(() => {
      const { targetX, targetY } = window.p2p.pieces.loupe.state(), sensor = window.p2p.model().sensor;
      return { targetX, targetY, x: Math.floor(sensor.widthPx / 2), y: Math.floor(sensor.heightPx / 2) };
    });
    await ready();
    assert.ok(['z35', 'm50', 'z800'].includes((await page.evaluate(() => window.p2p.scenario())).lens));
    const mirrorless = await centralPixel();
    assert.deepEqual([mirrorless.targetX, mirrorless.targetY], [mirrorless.x, mirrorless.y], 'sample is the live sensor central pixel');
    // Change body and lens at the camera level, re-enter, and pick a well part while the new sample may be pending.
    await page.locator('#steps [data-piece="camera"]').click();
    await page.locator('#kit-body').selectOption('dslr');
    await page.locator('#kit-lens').selectOption('n500');
    await page.locator('#steps [data-piece="loupe"]').click();
    await page.locator('#parts [data-part-id="well"]').evaluate((e) => e.click());
    await ready();
    const snapshot = await page.evaluate(() => ({ state: window.p2p.pieces.loupe.state(), frame: window.p2p.framing() }));
    const dslr = await centralPixel();
    assert.deepEqual([dslr.targetX, dslr.targetY], [dslr.x, dslr.y], 'sample follows the new body sensor, not the stale one');
    assert.equal(snapshot.frame.selected, 'well');
    assert.ok(snapshot.frame.position.every(Number.isFinite));
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.locator('#reset-view').click();
    await page.waitForFunction(() => !window.p2p.framing().moving);
    await page.evaluate(() => window.p2p.pieces.loupe.back());
    await page.waitForFunction(() => !window.p2p.framing().moving);
    assert.equal((await page.evaluate(() => window.p2p.framing())).selected, null, 'Back clears the selected well part');
    // Leaving the loupe while its sample is pending must not pull the camera level back to the loupe.
    await page.evaluate(() => { window.p2p.set({ iso: 400 }); window.p2p.piece('camera'); });
    await page.waitForTimeout(900);
    assert.equal((await page.evaluate(() => window.p2p.framing())).piece, 'camera');
    await page.locator('#steps [data-piece="loupe"]').click(); await ready();
    await page.screenshot({ path: `shots/loupe-state/recovery-${reducedMotion}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS loupe ${reducedMotion}: body dropdown, sample follows the sensor, selected well, resize/reset, Back and return`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
