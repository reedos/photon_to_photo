// Loupe loading and recovery: the controlled pixel sample settles on both backends, follows a lens change, shows a
// centered error with a working Retry when a sample fails, and leaves no veil behind when the reader moves on.
// Until c6209df this delayed a synthetic-photo render worker; the loupe now samples one controlled pixel in the page
// (src/pieces/pixel-sample.ts), so the failure is injected through the loupe's own failNextSample() test hook.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/loupe-loading', { recursive: true });
try {
  for (const backend of ['webgpu', 'webgl2']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    page.setDefaultTimeout(45000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    const ready = () => page.waitForFunction(() => {
      const s = window.p2p.pieces.loupe.state(), veil = document.getElementById('veil');
      return s.hasPixel && !s.pendingPixel && !window.p2p.framing().moving
        && veil.classList.contains('off') && getComputedStyle(veil).opacity === '0';
    });
    const url = new URL(`?piece=loupe&lens=m50${backend === 'webgl2' ? '&gl=webgl2' : ''}`, process.env.P2P_URL || server.url);
    await page.goto(url.href);
    await page.waitForFunction(() => window.p2p?.pieces.loupe.state().hasPixel);
    assert.equal(await page.evaluate(() => window.p2p.backend()), backend);
    await ready();
    const before = await page.evaluate(() => window.p2p.pieces.loupe.sample());
    // A lens change invalidates the sample; re-entering resolves a new one with no held pins left behind.
    await page.evaluate(() => window.p2p.set({ lens: 'n50' }));
    await page.locator('#steps [data-piece="camera"]').click();
    await page.locator('#steps [data-piece="loupe"]').click();
    await ready();
    assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'n50');
    assert.equal(await page.locator('#pins').evaluate(el => el.classList.contains('held')), false);
    const after = await page.evaluate(() => window.p2p.pieces.loupe.sample());
    assert.notEqual(after.photonsMean, before.photonsMean, 'the n50 sample is recomputed, not the m50 one reused');
    await page.screenshot({ path: `shots/loupe-loading/recovered-${backend}.png` });
    // A failed sample needs an apparent, centered error and a Retry that recomputes the real sample.
    await page.evaluate(() => window.p2p.pieces.loupe.failNextSample());
    await page.locator('.lv-status button').waitFor({ state: 'visible' });
    assert.match(await page.locator('.lv-status').textContent(), /could not be calculated/);
    assert.equal(await page.evaluate(() => window.p2p.pieces.loupe.state().hasPixel), false, 'no stale pixel shown beside the error');
    const box = await page.locator('.lv-status').boundingBox(), view = await page.locator('#view').boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - view.y - view.height / 2) < 2, 'error is centered in the inspection');
    await page.screenshot({ path: `shots/loupe-loading/error-${backend}.png` });
    await page.locator('.lv-status button').click();
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel);
    assert.equal(await page.locator('.lv-status').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.p2p.pieces.loupe.sample()), after, 'Retry yields the same seeded sample');
    // Leaving the loupe right after a change must clear only its own veil, even if work completes later.
    await page.evaluate(() => window.p2p.set({ fno: 8 }));
    await page.locator('#steps [data-piece="lens"]').click();
    // Score loop r3: a first visit to a level may veil it while its pipelines compile ahead ("Preparing the view",
    // stage.ts warmPiece). That veil is the lens level's own and lifts; the loupe's sampling veil must never show here.
    const veilNow = () => page.evaluate(() => ({ off: document.getElementById('veil').classList.contains('off'), text: document.getElementById('veil-msg').textContent }));
    const first = await veilNow();
    assert.ok(first.off || /preparing the view/i.test(first.text), `no loupe veil over the lens level: ${JSON.stringify(first)}`);
    await page.waitForFunction(() => document.getElementById('veil').classList.contains('off'), null, { timeout: 15000 });
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('#veil').evaluate(el => el.classList.contains('off')), true);
    assert.deepEqual(errors, []);
    console.log(`PASS ${backend}: sample settles, follows a lens change, failure shows a centered Retry that recovers, hidden work stays isolated`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
