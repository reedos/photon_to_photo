// Complete learning flow: same-shot tours, real pipeline buffers, render races, experiments, keyboard and layout.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/learning', { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: width < 760, hasTouch: width < 760 });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url); await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.waitForFunction(() => !document.getElementById('pin-photo').disabled, { timeout: 60000 });
    const shot = await page.evaluate(() => window.p2p.scenario());
    await page.locator('#learn-launch').click();
    assert.equal(await page.locator('#journey-play').textContent(), 'Play', 'tour does not auto-start');
    for (let i = 0; i < 8; i++) {
      await page.locator('#journey-stop').selectOption(String(i));
      assert.deepEqual(await page.evaluate(() => window.p2p.scenario()), shot, 'tour preserves all shot settings');
      if (i === 5) {
        assert.equal(await page.getByRole('slider', { name: 'Scan progress', exact: true }).count(), 1);
        assert.equal(await page.getByRole('slider', { name: 'Collected charge', exact: true }).count(), 1);
        assert.ok(await page.locator('#scan-detail').textContent().then(s => s.includes('64.00 ms')));
        await page.locator('#scan-progress').fill('100');
        assert.equal(await page.locator('.scan-row.read').count(), 8);
        await page.locator('#charge-level').fill('100');
        assert.ok((await page.locator('#adc-value').textContent()).includes('DN'));
        await page.screenshot({ path: `shots/learning/readout-${width}.png` });
        await page.locator('#lesson-close').click();
        assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'tour lesson restores visible keyboard focus');
      }
      if (i === 6) {
        await page.locator('#pipeline-stage').selectOption('tone');
        const exact = await page.evaluate(() => {
          const v = window.p2p.render(), c = document.getElementById('pipeline-canvas');
          const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          return data.every((n, i) => n === v.rgba[i]);
        }); assert.ok(exact, 'final pipeline image equals renderer output byte-for-byte');
        await page.locator('#pipeline-stage').selectOption('raw');
        assert.ok(await page.locator('#pipeline-description').textContent().then(s => s.includes('RGGB')));
        const picture = await page.locator('#pipeline-canvas').boundingBox(), explanation = await page.locator('#pipeline-description').boundingBox();
        assert.ok(picture.height > 90 && (explanation.y >= picture.y + picture.height || explanation.x >= picture.x + picture.width), 'pipeline image and explanation have separate readable space');
        await page.screenshot({ path: `shots/learning/pipeline-${width}.png` });
      }
      assert.ok(await page.locator('#journey-next').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'no page overflow');
    }
    await page.locator('#journey-restart').click(); assert.equal(await page.locator('#journey-stop').inputValue(), '0');
    await page.locator('#journey-play').click(); assert.equal(await page.locator('#journey-play').textContent(), 'Pause');
    await page.locator('#journey-play').click();
    await page.locator('#journey-close').click(); assert.equal(await page.locator('#journey').isVisible(), false);
    await page.locator('#pin-photo').click();
    await page.evaluate(() => window.p2p.set({ iso: 200 }));
    assert.equal(await page.locator('#pin-photo').isDisabled(), true, 'stale render cannot be pinned');
    await page.locator('#compare-photo').click();
    assert.ok((await page.locator('#compare-b-caption').textContent()).includes('Updating'));
    await page.waitForFunction(() => !document.getElementById('compare-pin').disabled, { timeout: 60000 });
    assert.ok((await page.locator('#compare-a-caption').textContent()).includes('ISO 100'));
    assert.ok((await page.locator('#compare-b-caption').textContent()).includes('ISO 200'));
    assert.ok((await page.locator('#compare-difference').textContent()).includes('ISO'));
    await page.screenshot({ path: `shots/learning/compare-${width}.png` });
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#compare-dialog').isVisible(), false);
    assert.equal(await page.locator('#compare-photo').evaluate(e => e === document.activeElement), true);
    if (width === 1440) {
      const original = await page.evaluate(() => window.p2p.scenario());
      await page.locator('#compare-photo').click();
      for (const id of ['depth', 'motion', 'noise']) {
        await page.locator('#experiment').selectOption(id); await page.locator('#experiment-start').click();
        await page.waitForFunction(() => !document.getElementById('experiment-next').disabled, { timeout: 120000 });
        const a = await page.locator('#compare-a-caption').textContent();
        await page.locator('#experiment-next').click();
        await page.waitForFunction(() => !document.getElementById('compare-pin').disabled, { timeout: 120000 });
        assert.equal(await page.locator('#compare-a-caption').textContent(), a, 'A is immutable while B renders');
        assert.notEqual(await page.locator('#compare-b-caption').textContent(), a);
        await page.screenshot({ path: `shots/learning/experiment-${id}.png` });
        await page.locator('#compare-pin').click();
        assert.ok(!(await page.locator('#experiment-note').textContent()).includes('A:'), 'repinning cancels the old experimental claim');
      }
      await page.locator('#experiment-restore').click();
      assert.deepEqual(await page.evaluate(() => window.p2p.scenario()), original, 'restore removes experiment-only state');
      await page.locator('#compare-close').click();
      await page.locator('#tab-controls').click(); await page.locator('#open-readout').click();
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#sensor-lesson').isVisible(), false);
      await page.goto(`${url}?tour=1`); await page.waitForFunction(() => window.p2p);
      assert.equal(await page.locator('#journey').isVisible(), true, 'introduction link starts tour');
      await page.evaluate(() => window.p2p.set({ focusM: .1 }));
      await page.waitForFunction(() => !document.getElementById('pin-photo').disabled, { timeout: 60000 });
      assert.ok(await page.evaluate(() => window.p2p.render().scenario.focusM > .1), 'clamped focus can still be pinned');
    }
    assert.deepEqual(errors, []); console.log(`learning ${width}x${height}: passed`); await page.close();
  }
} finally { await browser.close(); await server?.close(); }
