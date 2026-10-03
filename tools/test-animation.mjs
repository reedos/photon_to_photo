import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/animation', { recursive: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width > 760 ? 768 : 844 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.stack || String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // Simulate a frame timestamp slightly earlier than a click in the same refresh interval.
    // Playback must stay nonnegative instead of indexing PIPELINE[-1] and stopping forever.
    await page.addInitScript(() => {
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => frame(timestamp => callback(timestamp - 25));
    });
    await page.goto(process.env.P2P_URL || server.url);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.waitForFunction(() => !document.getElementById('pin-photo').disabled, { timeout: 120000 });
    await page.locator('#learn-launch').click();
    for (const [stop, piece] of [[1, 'lens'], [3, 'cone']]) {
      await page.locator('#journey-stop').selectOption(String(stop));
      await page.waitForFunction(p => window.p2p.pieces[p]?.light, piece);
      assert.equal((await page.evaluate(p => window.p2p.pieces[p].light(), piece)).playing, false);
      await page.locator('.light-playback:visible button').click();
      await page.waitForFunction(p => window.p2p.pieces[p].light().progress > .4, piece);
      await page.locator('.light-playback:visible button').click();
      const frozen = await page.evaluate(p => window.p2p.pieces[p].light().progress, piece);
      await page.waitForTimeout(120); assert.equal(await page.evaluate(p => window.p2p.pieces[p].light().progress, piece), frozen);
      await page.locator('.light-playback:visible input').fill('650');
      assert.equal(await page.evaluate(p => window.p2p.pieces[p].light().progress, piece), .65);
      await page.screenshot({ path: `shots/animation/${piece}-${width}.png` });
    }
    await page.locator('#journey-stop').selectOption('4');
    await page.waitForFunction(() => window.p2p.pieces.loupe?.photons);
    assert.equal((await page.evaluate(() => window.p2p.pieces.loupe.photons())).playing, false);
    await page.locator('.light-playback:visible button').click();
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.p2p.pieces.loupe.photons())).playing, true);
    await page.locator('#journey-stop').selectOption('5');
    assert.equal((await page.evaluate(() => window.p2p.pieces.loupe.photons())).playing, false);
    await page.locator('#lesson-replay').click(); await page.locator('#lesson-play').click();
    await page.waitForFunction(() => Number(document.getElementById('scan-progress').value) > 25);
    await page.locator('#lesson-play').click();
    const scan = await page.locator('#scan-progress').inputValue();
    await page.waitForTimeout(120); assert.equal(await page.locator('#scan-progress').inputValue(), scan);
    await page.locator('#scan-progress').fill('100'); assert.equal(await page.locator('.scan-row.read').count(), 8);
    await page.locator('#sensor-lesson').evaluate(e => e.scrollTop = 0);
    await page.screenshot({ path: `shots/animation/readout-${width}.png` });
    await page.locator('#journey-stop').selectOption('6');
    await page.locator('#lesson-replay').click(); await page.locator('#lesson-play').click();
    await page.waitForFunction(() => document.getElementById('pipeline-stage').value === 'demosaic').catch(async error => {
      console.error({ width, errors, state: await page.evaluate(() => ({ stage: document.getElementById('pipeline-stage').value, button: document.getElementById('lesson-play').textContent, hidden: document.hidden, progress: document.getElementById('pipeline-progress').value })) }); throw error;
    });
    await page.locator('#lesson-play').click();
    await page.locator('#pipeline-progress').fill('233');
    assert.equal(await page.locator('#pipeline-stage').inputValue(), 'demosaic');
    await page.locator('#sensor-lesson').evaluate(e => e.scrollTop = 0);
    await page.screenshot({ path: `shots/animation/pipeline-${width}.png` });
    await page.locator('#pipeline-progress').fill('1000');
    assert.equal(await page.locator('#pipeline-stage').inputValue(), 'tone');
    await page.locator('#pipeline-route [data-stage="wb"]').click();
    assert.ok((await page.locator('#pipeline-progress').getAttribute('aria-valuetext')).includes('White balance'));
    await page.locator('#pipeline-route [data-stage="tone"]').click();
    assert.equal(await page.evaluate(() => { const c = document.getElementById('pipeline-canvas'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.every((v, i) => v === window.p2p.render().rgba[i]); }), true);
    await page.locator('#journey-physics summary').click();
    assert.ok((await page.locator('#journey-use').textContent()).includes('white balance'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []); console.log(`animation ${width}: passed`); await page.close();
  }
} finally { await browser.close(); await server?.close(); }
