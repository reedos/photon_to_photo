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
    await page.goto(url); await page.waitForFunction(() => window.p2p?.render());
    await page.locator('#kit-body').selectOption('mirrorless');
    await page.locator('#steps [data-piece="loupe"]').click();
    const ready = async () => {
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && window.p2p.render().scenario.lens === window.p2p.scenario().lens, undefined, { timeout: 45000 });
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well' && !window.p2p.framing().moving, undefined, { timeout: 15000 });
      await page.evaluate(() => window.p2p.settle());
    };
    await ready();
    assert.ok(['z35', 'm50', 'z800'].includes((await page.evaluate(() => window.p2p.scenario())).lens));
    // Save an edge target, change body/lens, then re-enter before the new photo finishes.
    await page.evaluate(() => window.p2p.pieces.loupe.tap(550, 330));
    await page.locator('#steps [data-piece="camera"]').click();
    await page.locator('#kit-body').selectOption('dslr');
    await page.locator('#kit-lens').selectOption('n500');
    await page.locator('#steps [data-piece="loupe"]').click();
    await page.locator('#parts [data-part-id="well"]').click();
    await ready();
    const snapshot = await page.evaluate(() => ({ state: window.p2p.pieces.loupe.state(), frame: window.p2p.framing(), render: window.p2p.render().renderId }));
    assert.equal(snapshot.state.targetRenderId, snapshot.render);
    assert.equal(snapshot.state.targetX, 550); assert.equal(snapshot.state.targetY, 330);
    assert.ok(snapshot.frame.position.every(Number.isFinite));
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.locator('#reset-view').click();
    await page.waitForFunction(() => !window.p2p.framing().moving);
    await page.evaluate(() => window.p2p.pieces.loupe.back());
    await page.waitForFunction(() => !window.p2p.framing().moving);
    assert.equal((await page.evaluate(() => window.p2p.pieces.loupe.state())).diveStage, 'photo');
    await page.evaluate(() => { window.p2p.pieces.loupe.tap(120, 80); window.p2p.piece('camera'); });
    await page.waitForTimeout(900);
    assert.equal((await page.evaluate(() => window.p2p.framing())).piece, 'camera');
    await page.locator('#steps [data-piece="loupe"]').click(); await ready();
    await page.screenshot({ path: `shots/loupe-state/recovery-${reducedMotion}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS loupe ${reducedMotion}: body dropdown, pending render, stale tap, selected well, resize/reset, Back and return`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
