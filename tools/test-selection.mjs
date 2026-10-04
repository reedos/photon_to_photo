// Exercise real animated framing, not just the selected sidebar text.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/selection', { recursive: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width > 760 ? 768 : 844 }, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}?lens=n50&part=sensor`);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    const settled = async () => {
      await page.waitForFunction(() => !window.p2p.framing().moving);
      await page.evaluate(() => window.p2p.settle());
    };
    const cameraMatches = async id => {
      await settled();
      const { actual, want } = await page.evaluate(id => ({ actual: window.p2p.framing(), want: window.p2p.pieces.camera.partFrame(id) }), id);
      assert.equal(actual.selected, id);
      assert.ok(Math.hypot(...actual.position.map((v, i) => v - want.position[i])) < 0.1, `${id}: camera reaches its part frame`);
      assert.ok(Math.hypot(...actual.target.map((v, i) => v - want.target[i])) < 0.1, `${id}: orbit target follows part`);
    };
    await cameraMatches('sensor');
    await page.locator('#parts [data-part-id="iris"]').click();
    await cameraMatches('iris');
    await page.locator('#parts [data-part-id="sensor"]').click();
    await cameraMatches('sensor');
    if (width < 600) await page.locator('#tab-controls').click();
    await page.locator('[data-view="outside"]').click();
    if (width < 600) await page.locator('#phone-settings-close').click();
    await cameraMatches('sensor');
    // Multiple selections during an unfinished animated move: the last one must win.
    await page.evaluate(() => {
      for (const id of ['glass', 'focusRing', 'mount', 'iris']) document.querySelector(`#parts [data-part-id="${id}"]`).click();
    });
    await cameraMatches('iris');
    await page.evaluate(() => window.p2p.set({ focusM: 0.5 })); await cameraMatches('iris');
    // A user's drag takes over an in-flight move; the next part selection must discard its orbit inertia.
    await page.locator('#parts [data-part-id="glass"]').click();
    const canvas = await page.locator('#gl').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.75);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.7, { steps: 6 });
    await page.mouse.up();
    assert.equal((await page.evaluate(() => window.p2p.framing())).moving, false, 'manual orbit interrupts guided flight');
    await page.locator('#parts [data-part-id="sensor"]').click(); await cameraMatches('sensor');
    // Swap the rig while a part is selected, then change selection before its assets arrive.
    await page.evaluate(() => window.p2p.set({ lens: 'z800' }));
    await page.locator('#parts [data-part-id="viewfinder"]').click();
    await page.evaluate(() => window.p2p.pieces.camera.ready()); await cameraMatches('viewfinder');
    await page.evaluate(() => window.p2p.set({ lens: 'n50', focusM: 1.5 }));
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    const colors = new Set();
    for (const piece of ['camera', 'lens', 'cone', 'loupe']) {
      await page.locator(`#steps [data-piece="${piece}"]`).click();
      if (piece === 'loupe') await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well' && window.p2p.pieces.loupe.state().hasPixel);
      await settled();
      colors.add(await page.locator('.hud.tl .sub').evaluate(el => getComputedStyle(el).color));
      if (piece !== 'camera') {
        const ids = await page.locator('#parts button').evaluateAll(els => els.map(el => el.dataset.partId));
        for (const id of ids) {
          await page.locator(`#parts [data-part-id="${id}"]`).click(); await settled();
          const point = await page.evaluate(id => {
            const pin = document.querySelector(`#pins [data-pin-id="${id}"]`);
            const view = document.getElementById('view');
            const anchor = window.p2p.pins().find(p=>p.id===id);
            return { x: anchor.anchorX, y: anchor.anchorY, w: view.clientWidth, h: view.clientHeight, display: pin.style.display };
          }, id);
          assert.notEqual(point.display, 'none', `${piece}/${id}: selected part stays visible`);
          assert.ok(Math.abs(point.x - point.w / 2) < 3 && Math.abs(point.y - point.h / 2) < 3, `${piece}/${id}: view centers selected geometry ${JSON.stringify(point)}`);
        }
        const before = await page.evaluate(() => window.p2p.framing());
        await page.locator('#reset-view').click();
        await settled();
        const after = await page.evaluate(() => window.p2p.framing());
        assert.deepEqual(after.target, before.target, `${piece}: reset keeps selected part`);
        await page.setViewportSize({ width: width + 50, height: width > 760 ? 800 : 900 }); await settled();
        assert.equal((await page.evaluate(() => window.p2p.framing())).selected, ids.at(-1));
        await page.setViewportSize({ width, height: width > 760 ? 768 : 844 }); await settled();
        if (piece === 'cone') {
          await page.locator('#parts [data-part-id="bokeh-disk"]').click(); await settled();
          await page.evaluate(() => window.p2p.pieces.cone.setPoint(1200, 0.3)); await settled();
          const centered = await page.evaluate(() => {
            const pin = document.querySelector('#pins [data-pin-id="bokeh-disk"]');
            const view = document.getElementById('view');
            const anchor = window.p2p.pins().find(p=>p.id==='bokeh-disk');
            return Math.hypot(anchor.anchorX - view.clientWidth / 2, anchor.anchorY - view.clientHeight / 2);
          });
          assert.ok(centered < 3, 'changing the traced point keeps the selected bokeh disk centered');
        }
      }
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }).then(r => r.violations));
      if (violations.length) {
        console.error(JSON.stringify({ width, piece, violations }, null, 2));
        await page.screenshot({ path: `shots/selection/failure-${piece}-${width}.png` });
      }
      assert.deepEqual(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `${piece}: accessibility`);
      await page.screenshot({ path: `shots/selection/${piece}-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    assert.equal(colors.size, 4, 'each inspection has a distinct level accent');
    await page.evaluate(() => window.p2p.pieces.loupe.back()); await settled();
    assert.equal(await page.locator('#parts [aria-pressed="true"]').count(), 0, 'return to photo clears pixel-part selection');
    assert.equal((await page.evaluate(() => window.p2p.framing())).selected, null);
    await page.evaluate(() => { window.p2p.piece('loupe'); window.p2p.pieces.loupe.tap(100, 100); window.p2p.piece('camera'); });
    await page.evaluate(() => window.p2p.pieces.camera.ready()); await settled();
    const returned = await page.evaluate(() => window.p2p.framing());
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => window.p2p.framing()), returned, 'hidden pixel dive cannot steal camera framing');
    assert.deepEqual(errors, []);
    console.log(`PASS selection ${width}: animated framing, mode change, rapid picks, lens/body load, all deep parts, reset/resize, four colors, accessibility`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
