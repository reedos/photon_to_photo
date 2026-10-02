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
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}?gl=webgl2`); await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  assert.equal(await page.evaluate(() => window.p2p.backend()), 'webgl2');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('#learn-launch').click(); await page.locator('#journey-stop').selectOption('5');
  await page.locator('#lesson-readout').focus(); await page.keyboard.press('f');
  assert.equal(await page.evaluate(() => window.p2p.pieces.camera.exposure().running), false, 'hidden exposure does not fire behind a lesson');
  await page.locator('#journey-stop').selectOption('6');
  await page.waitForFunction(() => !document.getElementById('pin-photo').disabled, { timeout: 90000 });
  await page.locator('#pipeline-stage').selectOption('tone');
  await page.locator('#compare-photo').click(); await page.locator('#compare-pin').click();
  await page.keyboard.press('Escape'); await page.locator('#journey-close').click();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // Equivalent CSS viewport to a laptop at 200% zoom; vertical scrolling is expected, horizontal is not.
  await page.setViewportSize({ width: 683, height: 384 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 683);
  await page.locator('#compare-photo').click();
  assert.ok(await page.locator('#compare-dialog').evaluate(e => e.scrollWidth <= e.clientWidth));
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const lens of ['n500', 'z800']) {
    await page.evaluate(lens => window.p2p.set({ lens, sensor: undefined, scene: 'field', focusM: lens === 'n500' ? 8.9 : 30, subjectM: lens === 'n500' ? 8.9 : 30, fno: lens === 'n500' ? 5.6 : 6.3, iso: 400, shutter: 1 / 1000 }), lens);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.waitForFunction(() => !document.getElementById('pin-photo').disabled, { timeout: 90000 });
    await page.evaluate(() => window.p2p.settle());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `shots/learning/field-${lens}.png` });
    await page.locator('#finalimg-canvas').screenshot({ path: `shots/learning/field-photo-${lens}.png` });
    assert.ok(await page.evaluate(() => window.p2p.render().meta.notes.some(n => n.includes('silhouette antialiasing'))));
    console.log(`${lens} field / WebGL2: passed`);
  }
  await page.goto(`${url}?lesson=readout`); await page.waitForFunction(() => window.p2p);
  await page.locator('#lesson-close').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'learn-launch', 'direct lesson link returns focus to Learn');
  assert.deepEqual(errors, []); console.log('WebGL2, 4× CPU stress, keyboard overlay isolation and 200% reflow: passed');
} finally { await browser.close(); await server?.close(); }
