// Chrome/WebGPU integration gate for camera context and focus controls.
// Use P2P_URL for an already-built preview, or P2P_PREVIEW_PORT for a private gate port.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${url}?piece=camera&lens=n50&fno=2.8&focus=1.5`);
    await page.waitForFunction(() => !!window.p2p);
    assert.equal(await page.evaluate(() => window.p2p.backend()), 'webgpu');
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('#stage-section').scrollIntoViewIfNeeded();
    await page.locator('#tab-explain').click();
    await page.locator('#parts button[data-part-id="iris"]').click();
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.detail()), 'iris');
    await page.locator('#steps [data-piece="lens"]').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('piece') === 'lens');
    assert.match(await page.locator('.inspection-back').innerText(), /Aperture/);
    assert.equal(new URL(page.url()).searchParams.get('part'), 'iris');
    await page.locator('.inspection-back').click();
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.detail()), 'iris');
    assert.equal(await page.evaluate(() => window.p2p.scenario().focusM), 1.5);
    await page.reload();
    await page.waitForFunction(() => !!window.p2p);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.detail()), 'iris');
    await page.locator('#steps [data-piece="cone"]').click();
    await page.reload();
    await page.waitForFunction(() => !!window.p2p);
    assert.match(await page.locator('.inspection-back').innerText(), /Focus ring/);
    await page.locator('.inspection-back').click();
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.detail()), 'focusRing');
    await page.locator('#steps [data-piece="camera"]').click();
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.detail()), null);
    await page.evaluate(() => window.p2p.set({ lens: 'n500', focusM: 30 }));
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    const slider = page.locator('#sc-focus');
    const before = Number(await slider.inputValue());
    await slider.focus();
    await slider.press('ArrowRight');
    assert.equal(Number(await slider.inputValue()), before + 1);
    const farther = await page.evaluate(() => window.p2p.scenario().focusM);
    assert.ok(farther > 30 && farther < 40, `next finite telephoto distance: ${farther}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#stage-section').getBoundingClientRect().top + scrollY - 70));
    await page.evaluate(() => window.p2p.settle());
    await page.evaluate(() => window.p2p.gpuIdle());
    if (process.env.P2P_SHOTS) await page.screenshot({ path: `${process.env.P2P_SHOTS}/inspection-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS inspection return, share/reload, overview, telephoto focus and width ${viewport.width}`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
