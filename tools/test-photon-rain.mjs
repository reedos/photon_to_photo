import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
import { decodePng } from './accuracy/png.mjs';

function accumulatedPhotonPixels(dataUrl) {
  const image = decodePng(Buffer.from(dataUrl.split(',')[1], 'base64'));
  let pixels = 0;
  const y0 = Math.floor(image.height * .70), y1 = Math.floor(image.height * .88);
  for (let y = y0; y < y1; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * image.channels;
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    if (Math.max(r, g, b) > 90 && Math.max(r, g, b) - Math.min(r, g, b) > 18) pixels++;
  }
  return pixels;
}

const out = 'shots/photon-rain'; mkdirSync(out, { recursive: true });
const server = process.env.P2P_URL ? null : await startPreview();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const reports = [];
try {
  for (const [width, height, reducedMotion] of [[1366,900,'no-preference'], [390,844,'no-preference'], [320,740,'reduce']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion,
      ...(width === 1366 ? { recordVideo: { dir: `${out}/video`, size: { width, height } } } : {}) });
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      const arc = CanvasRenderingContext2D.prototype.arc;
      window.__rainArcDraws = 0;
      CanvasRenderingContext2D.prototype.arc = function (...args) {
        if (this.canvas?.dataset?.rain === 'rain') window.__rainArcDraws++;
        return arc.apply(this, args);
      };
    });
    const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${process.env.P2P_URL || server.url}?piece=camera&lens=m50`);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('#steps [data-piece="loupe"]').click();
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel);
    await page.evaluate(() => window.p2p.settle());
    const original = await page.evaluate(() => window.p2p.scenario());
    const launch = page.getByRole('button', { name: 'Photon rain & noise', exact: true });
    await launch.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/${width}-before.png` });
    await launch.focus(); await page.keyboard.press('Enter');
    const dialog = page.locator('#photon-rain'); await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.rain-well-note').innerText(), 'Newest 20 per pixel retained; counts include all arrivals.');
    const playbackBounds = await page.locator('[data-rain=play]').boundingBox();
    assert.ok(playbackBounds.y >= 0 && playbackBounds.y + playbackBounds.height <= height, 'playback must be visible without scrolling');
    assert.ok(Math.abs(Number(await dialog.getAttribute('data-mean')) - 6) < .0001);
    assert.equal(Number(await dialog.locator('[data-rain=aperture]').inputValue()), original.fno);
    assert.equal(Number(await dialog.locator('[data-rain=shutter]').inputValue()), original.shutter);
    const scrub = async value => page.locator('[data-rain=time]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    if (reducedMotion === 'reduce') assert.equal(await dialog.getAttribute('data-playing'), 'false');
    else { await page.waitForTimeout(1500); assert.ok(Number(await dialog.getAttribute('data-progress')) > .1); }
    await scrub(0);
    const emptyArrivalBand = await page.locator('[data-rain=rain]').evaluate(canvas => canvas.toDataURL());
    await scrub(460); await page.screenshot({ path: `${out}/${width}-rain.png` });
    const noOverflow = await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1); assert.ok(noOverflow, 'dialog must fit width');
    await scrub(1000);
    const fullArrivalBand = await page.locator('[data-rain=rain]').evaluate(canvas => canvas.toDataURL());
    const initialDots = accumulatedPhotonPixels(emptyArrivalBand), finalDots = accumulatedPhotonPixels(fullArrivalBand);
    assert.ok(finalDots > initialDots + 40, `100% arrivals must remain visible as accumulated spectral dots (${initialDots} → ${finalDots})`);
    await page.screenshot({ path: `${out}/${width}-complete.png` });
    const sample = await page.locator('[data-rain=stats]').innerText();
    if (width < 600) await page.locator('[data-rain=noise-tab]').click();
    await page.locator('[data-rain=noise]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/${width}-dim.png` });
    await scrub(200); await scrub(1000); assert.equal(await page.locator('[data-rain=stats]').innerText(), sample, 'scrub must preserve sample');
    await page.locator('[data-rain=compare]').click(); await scrub(1000);
    assert.ok(Math.abs(Number(await dialog.getAttribute('data-mean')) - 96) < .001);
    const bright = await page.locator('[data-rain=stats]').innerText(); assert.match(bright, /10\.2%/);
    await page.locator('[data-rain=noise]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/${width}-bright.png` });
    const shutter = page.locator('[data-rain=shutter]');
    const longest = await shutter.locator('option').last().getAttribute('value');
    await shutter.selectOption(longest);
    const maxMean = Number(await dialog.getAttribute('data-mean'));
    assert.ok(maxMean > 20, `maximum shutter and 16× light should retain full counts above the visual cap (mean ${maxMean})`);
    await page.evaluate(() => { window.__rainArcDraws = 0; }); await scrub(1000);
    const maxVisibleDots = await page.evaluate(() => window.__rainArcDraws);
    assert.ok(maxVisibleDots > 0 && maxVisibleDots <= 8 * 20, `at most 20 retained dots per each of eight wells, got ${maxVisibleDots}`);
    const observedAtMax = Number((await page.locator('[data-rain=stats] > span').nth(1).locator('b').textContent()).replaceAll(',', ''));
    assert.ok(observedAtMax > 20, `sample statistics must include arrivals beyond the 20-dot cap, got ${observedAtMax}`);
    await page.locator('[data-rain=light]').selectOption('1');
    const aperture = page.locator('[data-rain=aperture]'); const stops = await aperture.locator('option').evaluateAll(options => options.map(o => o.value));
    await aperture.selectOption(stops.at(-1)); assert.ok(Number(await dialog.getAttribute('data-mean')) < 6);
    await aperture.selectOption(String(original.fno));
    const fastest = await shutter.locator('option').first().getAttribute('value');
    await shutter.selectOption(fastest); assert.ok(Number(await dialog.getAttribute('data-mean')) < 6);
    await shutter.selectOption(String(original.shutter));
    await page.locator('[data-rain=new]').click(); assert.equal(await dialog.getAttribute('data-seed'), '38');
    assert.deepEqual(await page.evaluate(() => window.p2p.scenario()), original, 'local experiment must not mutate workspace');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await launch.waitFor({ state: 'visible' });
    await launch.evaluate(el => new Promise((resolve,reject)=>{const end=performance.now()+2000;const check=()=>document.activeElement===el?resolve():performance.now()>end?reject(new Error('Photon launcher did not regain focus')):requestAnimationFrame(check);check()}));
    // The previous freeze involved mirrorless → Pixel → body/lens change → Pixel.
    await page.evaluate(() => { window.p2p.piece('camera'); window.p2p.set({ lens: 'n500' }); });
    await page.waitForFunction(() => window.p2p.model().scenario.lens === 'n500');
    await page.evaluate(async () => { await window.p2p.pieces.camera.ready(); await window.p2p.settle(); });
    await page.locator('#steps [data-piece="loupe"]').click();
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel); await page.evaluate(() => window.p2p.settle());
    await launch.click(); await dialog.waitFor({ state: 'visible' });
    await page.evaluate(() => window.p2p.piece('camera')); await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.p2p.settle()); await page.waitForTimeout(300); assert.deepEqual(errors, []);
    reports.push({ width, reducedMotion, dim: sample, bright, errors }); console.log(`PASS photon rain ${width} ${reducedMotion}`);
    await context.close();
  }
} finally { writeFileSync(`${out}/report.json`, JSON.stringify(reports, null, 2)); await browser.close(); await server?.close(); }
