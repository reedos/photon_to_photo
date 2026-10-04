// Browser fallback/reflow checks. CPU throttling is a stress test, not a substitute for physical-device QA.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/learning', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const errors = [], workers = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('worker', worker => workers.push(worker.url()));
  const cameraUrl = new URL(url); cameraUrl.searchParams.set('piece', 'camera'); cameraUrl.searchParams.set('gl', 'webgl2');
  await page.goto(cameraUrl.href); await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  assert.equal(await page.evaluate(() => window.p2p.backend()), 'webgl2');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('#steps [data-piece="loupe"]').click();
  await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.p2p.pieces.loupe.state().hasPixel), true, 'controlled pixel sample is ready');
  await page.locator('#steps [data-piece="camera"]').click();
  await page.locator('#learn-launch').click(); await page.locator('#journey-stop').selectOption('5');
  await page.locator('#lesson-readout').focus(); await page.keyboard.press('f');
  assert.equal(await page.evaluate(() => window.p2p.pieces.camera.exposure().running), false, 'hidden exposure does not fire behind a lesson');
  await page.locator('#journey-stop').selectOption('6');
  await page.waitForFunction(() => document.querySelector('#pipeline-canvas').getAttribute('aria-label').startsWith('Illustrative test sample'), { timeout: 90000 });
  await page.locator('#pipeline-stage').selectOption('tone');
  await page.locator('#journey-close').click();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // Equivalent CSS viewport to a laptop at 200% zoom; vertical scrolling is expected, horizontal is not.
  await page.setViewportSize({ width: 683, height: 384 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 683);
  await page.locator('#workspace-photos').click();
  await page.waitForFunction(() => document.querySelector('#rp-img')?.complete && document.querySelector('#rp-img')?.naturalWidth > 0);
  assert.ok(await page.locator('#rp-card').evaluate(e => e.scrollWidth <= e.clientWidth), 'photo gallery fits the 200% reflow viewport');
  await page.locator('#workspace-model').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const lens of ['n500', 'z800']) {
    await page.evaluate(lens => window.p2p.set({ lens, sensor: undefined, focusM: lens === 'n500' ? 8.9 : 30, fno: lens === 'n500' ? 5.6 : 6.3, iso: 400, shutter: 1 / 1000 }), lens);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.evaluate(() => window.p2p.settle());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `shots/learning/field-${lens}.png` });
    await page.locator('#steps [data-piece="loupe"]').click();
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.p2p.pieces.loupe.state().hasPixel), true);
    console.log(`${lens} controlled pixel sample / WebGL2: passed`);
    await page.locator('#steps [data-piece="camera"]').click();
  }
  await page.goto(`${url}?lesson=readout`); await page.waitForFunction(() => window.p2p);
  await page.locator('#lesson-close').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'learn-launch', 'direct lesson link returns focus to Learn');
  assert.deepEqual(errors, []); assert.equal(workers.some(url => /render-worker|example-worker/.test(url)), false, 'no synthetic-render workers start');
  console.log('WebGL2, controlled pixel sample, 4× CPU stress, lessons, JPEG gallery and 200% reflow: passed');
} finally { await browser.close(); await server?.close(); }
