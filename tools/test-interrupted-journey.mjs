// Independent real-input stress journey. No reduced-motion override or p2p.settle():
// those can conceal a blank intermediate frame, late callback or interrupted camera flight.
// P2P_URL can point at a production candidate; P2P_CPU_RATE=4 simulates CPU contention,
// not a physical phone GPU. Screenshots and telemetry remain reviewable on failure.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
import { decodePng } from './accuracy/png.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/interrupted-journey';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { url, requestedBackend: process.env.P2P_BACKEND || 'default', cpuRate: Number(process.env.P2P_CPU_RATE || 1), samples: [], errors: [] };
let page;
let injectingHousingFailure = false;
const sleep = ms => page.waitForTimeout(ms);
function pixels(buffer) {
  const png = decodePng(buffer), bins = new Map();
  let bright = 0;
  for (let i = 0; i < png.data.length; i += png.channels * 4) {
    const [r, g, b] = png.data.subarray(i, i + 3);
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
    if (Math.max(r, g, b) > 65) bright++;
  }
  const total = [...bins.values()].reduce((a, b) => a + b, 0);
  return { brightFraction: bright / total, variedFraction: 1 - Math.max(...bins.values()) / total };
}
function geometryPixels(actual, backdrop) {
  const a = decodePng(actual), b = decodePng(backdrop);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changed = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    let difference = 0;
    for (let c = 0; c < 3; c++) difference += Math.abs(a.data[i * a.channels + c] - b.data[i * b.channels + c]);
    if (difference > 35) changed++;
  }
  return changed;
}
async function sample(name, capture = true) {
  const data = await page.evaluate(() => {
    const frame = window.p2p.framing();
    return {
    frame, backend: window.p2p.backend(), lens: window.p2p.scenario().lens,
    viewport: [innerWidth, innerHeight],
    canvas: { width: document.querySelector('#gl').width, height: document.querySelector('#gl').height },
    veil: !document.querySelector('#veil').classList.contains('off'),
    lesson: !!document.querySelector('#view.show-lesson'),
    modal: document.querySelector('dialog[open]')?.id || null,
    inert: [...document.querySelectorAll('#view > [inert]')].map(el => el.id || el.className),
    loupe: frame.piece === 'loupe' ? window.p2p.pieces.loupe.state() : null,
    time: performance.now(),
  }; });
  assert.ok([...data.frame.position, ...data.frame.target].every(Number.isFinite), `${name}: finite camera`);
  if (capture) {
    // Make HTML labels transparent only for this screenshot: a forest of pins must
    // not masquerade as geometry. Opacity preserves layout AND stage chrome fitting.
    await page.locator('#gl').scrollIntoViewIfNeeded();
    const rect = await page.locator('#gl').boundingBox();
    const buffer = await page.screenshot({ path: `${output}/${name}.png`, clip: rect,
      style: '#view > :not(#gl) { transition: none !important; animation: none !important; opacity: 0 !important; }' });
    data.pixels = pixels(buffer);
    // A CSS background is not evidence of a working renderer. Compare the actual
    // canvas with the same rectangle without the canvas; pins are hidden in both.
    const backdrop = await page.screenshot({ clip: rect,
      style: '#view > :not(#gl) { transition: none !important; animation: none !important; opacity: 0 !important; } #gl { opacity: 0 !important; }' });
    data.pixels.geometryPixels = geometryPixels(buffer, backdrop);
  }
  report.samples.push({ name, ...data });
  console.log(name, JSON.stringify({ piece: data.frame.piece, moving: data.frame.moving, pixels: data.pixels }));
  if (capture && !data.veil && !data.modal && !data.lesson && !data.frame.moving)
    assert.ok(data.pixels.geometryPixels > 100, `${name}: active view contains rendered geometry, not just pins/background`);
}
async function piece(id) { await page.locator(`#steps [data-piece="${id}"]`).click(); }
async function naturalRest() {
  await page.waitForFunction(() => !window.p2p.framing().moving && document.querySelector('#veil').classList.contains('off')
    && getComputedStyle(document.querySelector('#veil')).opacity === '0', null, { timeout: 20000 });
}
try {
  page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const expected = injectingHousingFailure && (
      m.text().startsWith('lens.ts: the housing failed to load') ||
      (m.text().includes('net::ERR_FAILED') && m.location().url.endsWith('/models/lenses/n50.glb')));
    if (expected) (report.expectedErrors ||= []).push(m.text());
    else report.errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.audit = { frames: [], tasks: [] };
    let previous;
    function frame(now) { if (previous) window.audit.frames.push(now - previous); previous = now; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    new PerformanceObserver(list => window.audit.tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  });
  if (report.cpuRate !== 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: report.cpuRate });
  const entry = new URL('?lens=m50&piece=camera', url);
  if (process.env.P2P_BACKEND === 'webgl2') entry.searchParams.set('gl', 'webgl2');
  await page.goto(entry.href);
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  if (report.requestedBackend === 'webgl2') assert.equal(await page.evaluate(() => window.p2p.backend()), 'webgl2');
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await naturalRest();
  await sample('00-camera');
  for (const [i, id] of ['loupe', 'lens', 'cone', 'camera', 'loupe', 'camera'].entries()) {
    await piece(id);
    await sample(`01-transition-${i}-${id}`);
    // Deliberately select before the preceding transition has finished.
    await page.locator('#part-next').click();
    await sleep(80);
    await sample(`02-interrupted-${i}-${id}`);
  }
  await naturalRest();
  await sample('03-returned-camera');
  await page.locator('.shot-launch').click();
  await page.locator('#shot-dialog').waitFor({ state: 'visible' });
  await page.locator('#shot-close').click();
  await page.locator('.shot-launch').click();
  await page.waitForFunction(() => document.querySelector('#shot-dialog')?.dataset.ready === 'true');
  await page.locator('[data-shot-chapter="4"]').click();
  await page.locator('#shot-play').click();
  await sleep(500);
  await page.locator('#shot-close').click();
  await piece('loupe');
  await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel);
  await page.locator('.rain-launch').click();
  await page.locator('[data-rain="close"]').click();
  await page.locator('.rain-launch').click();
  await page.keyboard.press('Escape');
  await sleep(50);
  await sample('04-modal-return');
  await page.locator('#tab-controls').click();
  await page.locator('#open-pipeline').click();
  await page.locator('#lesson-play').click();
  await sleep(250);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#view.show-lesson'));
  assert.equal(await page.locator('#view > [inert]').count(), 0, 'lesson restores stage interaction');
  await piece('camera');
  const choices = await page.locator('#kit-body option').evaluateAll(nodes => nodes.map(n => n.value));
  for (const body of [...choices, choices[0]]) {
    await page.locator('#kit-body').selectOption(body);
    await piece('loupe'); await piece('lens'); await piece('camera');
  }
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await naturalRest();
  await sample('05-body-return');
  await page.setViewportSize({ width: 390, height: 844 });
  await piece('loupe');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(150);
  await page.locator('#stage-section').scrollIntoViewIfNeeded();
  await page.locator('#part-next').click();
  await naturalRest();
  await sample('06-phone-scroll-return');
  await page.setViewportSize({ width: 1366, height: 900 });
  await piece('camera');
  await naturalRest();
  await sample('07-final-camera');
  report.telemetry = await page.evaluate(() => window.audit);
  if (process.env.P2P_TEST_HOUSING_RETRY === '1') {
    report.journeyTelemetry = report.telemetry;
    let housingAttempts = 0;
    injectingHousingFailure = true;
    await page.route('**/models/lenses/n50.glb', route => ++housingAttempts === 1 ? route.abort('failed') : route.continue());
    const retryEntry = new URL('?lens=n50&piece=lens', url);
    if (report.requestedBackend === 'webgl2') retryEntry.searchParams.set('gl', 'webgl2');
    await page.goto(retryEntry.href);
    await page.waitForFunction(() => !!window.p2p);
    await page.waitForFunction(() => document.querySelector('#steps [data-piece="lens"]')?.getAttribute('aria-current') === 'step');
    await sleep(300);
    assert.equal(housingAttempts, 1, 'one intentionally aborted housing request');
    await naturalRest();
    await sample('08-failed-housing-schematic');
    await piece('cone');
    const retried = page.waitForResponse(r => r.url().endsWith('/models/lenses/n50.glb') && r.status() === 200);
    await piece('lens');
    await (await retried).finished();
    assert.equal(housingAttempts, 2, 'revisiting Optics retries a failed housing');
    await sleep(500);
    await naturalRest();
    await sample('09-recovered-housing');
    injectingHousingFailure = false;
    assert.ok(report.expectedErrors.some(e => e.startsWith('lens.ts: the housing failed to load')), 'intentional housing error was handled by the fallback');
  }
  assert.deepEqual(report.errors, [], 'no runtime or GPU errors');
  console.log('PASS interrupted journey; inspect captured transient geometry and telemetry.');
} finally {
  if (page && !page.isClosed()) report.telemetry = await page.evaluate(() => window.audit).catch(() => null);
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.close();
}
