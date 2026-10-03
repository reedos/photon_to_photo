// Exercise the real stage and source event bus without adding production-only test hooks.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false, watch: null, hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${url}/?lens=n50&piece=camera&part=sensor`);
  await page.waitForFunction(() => !!window.p2p);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.locator('#stage-section').scrollIntoViewIfNeeded();
  const settle = () => page.evaluate(() => window.p2p.settle());
  const framing = () => page.evaluate(() => window.p2p.framing());
  const emitLoading = event => page.evaluate(async event => {
    const { emit } = await import('/src/app/bus.ts');
    emit('piece-loading', event);
  }, event);
  const veil = () => page.locator('#veil').evaluate(el => ({
    hidden: el.classList.contains('off'), error: el.classList.contains('err'),
    held: document.getElementById('pins').classList.contains('held'),
    text: document.getElementById('veil-msg').textContent,
  }));
  const closeEnough = (a, b, label) => {
    for (const key of ['position', 'target'])
      assert.ok(Math.hypot(...a[key].map((v, i) => v - b[key][i])) < 1e-4, label);
  };

  await page.evaluate(() => window.p2p.piece('lens'));
  await settle();
  await emitLoading({ id: 'camera', loading: false, error: 'Synthetic delayed camera failure' });
  assert.equal((await veil()).hidden, true, 'a hidden camera failure cannot veil Optics');
  assert.equal((await veil()).error, false, 'a hidden failure cannot change active error styling');
  assert.equal((await veil()).held, false, 'a hidden failure cannot disable active pins');
  await page.evaluate(() => window.p2p.piece('camera'));
  assert.deepEqual(await veil(), { hidden: false, error: true, held: true, text: 'Synthetic delayed camera failure' });
  await emitLoading({ id: 'camera', loading: true, progress: 0.4, label: 'Retrying camera' });
  assert.deepEqual(await veil(), { hidden: false, error: false, held: true, text: 'Retrying camera' });
  await emitLoading({ id: 'camera', loading: false });
  assert.equal((await veil()).hidden, true, 'success clears the veil immediately');
  assert.equal((await veil()).error, false, 'success clears stale error styling');
  assert.equal((await veil()).held, false, 'success restores part pins');

  // Body changes and inspection transitions overlap outstanding asset work.
  await page.evaluate(() => {
    window.p2p.set({ lens: 'm50' });
    window.p2p.piece('lens');
    window.p2p.set({ lens: 'n500' });
    window.p2p.piece('cone');
    window.p2p.set({ lens: 'm50' });
    window.p2p.piece('camera');
  });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await settle();
  assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'm50');
  assert.equal(await page.evaluate(() => window.p2p.pieces.camera.state().body), 'mirrorless');
  assert.equal((await framing()).selected, 'focusRing');
  assert.equal((await veil()).hidden, true);

  // Every inspection owns its camera and resets to its selected part, including after resize.
  for (const piece of ['lens', 'cone', 'loupe']) {
    console.log(`Inspecting ${piece}`);
    await page.evaluate(piece => window.p2p.piece(piece), piece);
    await page.waitForLoadState('networkidle');
    if (piece === 'loupe') {
      await page.waitForFunction(() => window.p2p.render()?.scenario.lens === 'm50');
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well');
    }
    await page.locator('#tab-explain').click();
    const first = page.locator('#parts button').first();
    await first.click();
    await settle();
    const picked = await framing();
    assert.equal(picked.piece, piece);
    assert.equal(picked.selected, await first.getAttribute('data-part-id'));
    assert.ok([...picked.position, ...picked.target].every(Number.isFinite));
    const canvas = await page.locator('#gl').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.65, { steps: 8 });
    await page.mouse.up();
    await settle();
    assert.notDeepEqual((await framing()).position, picked.position, `${piece} responds to orbit`);
    if (!await page.locator('.view-menu').evaluate(el => el.open)) await page.locator('.view-menu summary').click();
    await page.locator('#reset-view').click();
    if (await page.locator('.view-menu').evaluate(el => el.open)) await page.locator('.view-menu summary').click();
    await settle();
    closeEnough(await framing(), picked, `${piece} reset restores the selected part`);
    await page.setViewportSize({ width: 390, height: 844 });
    console.log(`${piece}: phone resize`);
    await settle();
    assert.equal((await framing()).selected, picked.selected, `${piece} resize retains selection`);
    assert.ok([...(await framing()).position, ...(await framing()).target].every(Number.isFinite));
    await page.setViewportSize({ width: 1366, height: 900 });
    console.log(`${piece}: desktop resize`);
    await settle();
    closeEnough(await framing(), picked, `${piece} resize restores desktop framing`);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.evaluate(() => Promise.all([window.p2p.settle(), window.p2p.settle()]));
  assert.deepEqual(errors, []);
  console.log('PASS stage: hidden loading/error isolation, retry, rapid body/piece changes, orbit/reset/resize, selected framing and offscreen settle');
} finally {
  await browser?.close();
  await server.close();
}
