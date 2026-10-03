// Full-project regression checks added by the October audit: recovery, exact links, body physics and reference pages.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/audit', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker; let fail = true;
    window.Worker = class extends OriginalWorker {
      constructor(source, options) { super(source, options); this.photo = String(source).includes('render-worker'); if (this.photo) window.auditWorker = this; }
      postMessage(message, ...args) {
        if (this.photo && fail && message.type === 'render') {
          fail = false;
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected worker failure', cancelable: true })), 10);
          return;
        }
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.goto(url + '?gl=webgl2');
  await page.waitForFunction(() => window.p2p);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.locator('#finalimg-retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.finalimg-card').evaluate(el => el.classList.contains('rendering')), false);
  assert.equal(await page.locator('#finalimg-canvas').getAttribute('aria-busy'), 'false');
  await page.locator('#finalimg-retry').click();
  await page.waitForFunction(() => window.p2p.render(), null, { timeout: 60000 });
  // A worker can also fail after delivering a photo: its old pixel buffer must not appear inspectable.
  await page.evaluate(() => window.auditWorker.dispatchEvent(new ErrorEvent('error', { message: 'Injected completed-worker failure', cancelable: true })));
  await page.locator('#finalimg-retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pin-photo').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.p2p.render()), null);
  await page.locator('#finalimg-retry').click();
  await page.waitForFunction(() => window.p2p.render(), null, { timeout: 60000 });
  await page.locator('#kit-body').selectOption('mirrorless');
  assert.equal(await page.evaluate(() => window.p2p.model().scenario.sensor), 'full-frame-z8');
  assert.match(await page.evaluate(() => window.p2p.model().sensor.name), /Z8/);
  for (const [id, output] of [['sc-fno', 'sc-fno-v'], ['sc-shutter', 'sc-shutter-v'], ['sc-iso', 'sc-iso-v']]) {
    assert.equal(await page.locator('#' + id).getAttribute('aria-valuetext'), await page.locator('#' + output).textContent());
  }
  await page.evaluate(() => window.p2p.set({ shutter: 16 / 60, focusM: 4.123456789, subjectM: 8.123456789, fno: 2 ** (5 / 6), shutterType: 'electronic', lux: 987.654, cct: 5456.78 }));
  const before = await page.evaluate(() => window.p2p.scenario());
  const shared = page.url(); assert.ok(shared.includes('gl=webgl2'));
  // A clean context models a recipient who has no saved session state.
  const restored = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  await restored.goto(shared); await restored.waitForFunction(() => window.p2p);
  assert.deepEqual(await restored.evaluate(() => window.p2p.scenario()), before);
  await restored.close();
  await page.screenshot({ path: 'shots/audit/workspace.png' });
  console.log('PASS live worker crash/retry, body sensor, spoken control values, exact shared shot');

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['story', 'evidence', 'method', 'glossary', 'parts']) {
      await page.goto(`${url}reference.html?page=${name}`);
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
      assert.deepEqual(violations, [], `${name} at ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.map(a => a.getAttribute('href').slice(1)).filter(id => id && !document.getElementById(decodeURIComponent(id))));
      assert.deepEqual(broken, [], `${name} internal anchors`);
    }
    console.log(`PASS all reference pages: ${width}px, accessibility, links, overflow`);
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${url}models.html?gl=webgl2`); await page.waitForFunction(() => window.p2pModels?.ready);
  let releaseFailure;
  const held = new Promise(resolve => { releaseFailure = resolve; });
  await page.route('**/models/lenses/z800.glb', async route => { await held; await route.abort('failed'); });
  await page.locator('[data-body="mirrorless"]').click();
  await page.locator('#lens-seg [data-lens="z800"]').dispatchEvent('click');
  await page.locator('[data-body="dslr"]').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off'));
  releaseFailure(); await page.waitForTimeout(1500);
  assert.equal(await page.locator('#veil').evaluate(e => e.classList.contains('err')), false, 'stale failure must not replace current model');
  await page.unroute('**/models/lenses/z800.glb');
  await page.route('**/models/lenses/n500fl.glb', route => route.abort('failed'));
  await page.locator('#lens-seg [data-lens="n500fl"]').click();
  await page.locator('#model-retry').waitFor({ state: 'visible' });
  await page.unroute('**/models/lenses/n500fl.glb');
  await page.locator('#model-retry').click();
  await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off'));
  assert.equal(await page.locator('#model-retry').isVisible(), false);
  await page.addScriptTag({ content: axe });
  const modelViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
  assert.deepEqual(modelViolations, [], 'Models accessibility');
  await page.screenshot({ path: 'shots/audit/models.png' });
  const desktopDistance = await page.evaluate(() => window.p2pModels.camera.position.length());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300); // ResizeObserver and the menu's responsive transition.
  assert.ok(await page.evaluate(() => window.p2pModels.camera.position.length()) > desktopDistance, 'portrait resize refits a long lens');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: 'shots/audit/models-phone.png' });
  assert.deepEqual(errors, []);
  console.log('PASS Models: late failure isolation, retry, accessibility, portrait refit, phone layout');

  const failed = await browser.newPage();
  await failed.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgpu' || type.startsWith('webgl')) return null;
      return context.call(this, type, ...args);
    };
  });
  await failed.goto(url + '?gl=webgl2');
  await failed.locator('#veil.err #veil-reload').waitFor({ state: 'visible' });
  await Promise.all([failed.waitForEvent('domcontentloaded'), failed.locator('#veil-reload').click()]);
  await failed.close();
  console.log('PASS startup failure retains working Reload');
} finally { await browser.close(); await server?.close(); }
