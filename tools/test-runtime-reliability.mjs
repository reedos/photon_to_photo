// Normal-motion regressions: never settle away the transition being inspected.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false, watch: null, hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/runtime-reliability', { recursive: true });
const close = (a, b) => Math.hypot(...a.map((v, i) => v - b[i])) < 1e-4;
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`${url}/?piece=lens&lens=m50`);
  await page.waitForFunction(() => window.p2p?.render());
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !window.p2p.framing().moving);
  // A piece entry must establish its own coordinate system synchronously, before
  // its first draw. Warm assets remove network timing from the assertion.
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
    await page.locator('#view').scrollIntoViewIfNeeded();
    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => window.p2p.piece('loupe'));
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well');
      await page.waitForFunction(() => !window.p2p.framing().moving);
      const staleBadge = await page.evaluate(() => {
        window.p2p.piece('camera');
        return document.getElementById('scale-badge').hidden;
      });
      assert.equal(staleBadge, true, 'camera cannot inherit the Pixel magnification/photon badge');
      const entry = await page.evaluate(() => {
        window.p2p.piece('lens');
        return { frame: window.p2p.framing(), expected: window.p2p.pieces.lens.camera() };
      });
      assert.equal(entry.frame.moving, false, 'entry must not fly from the previous level’s units');
      assert.ok(close(entry.frame.position, entry.expected.want), 'first Optics frame fits the incoming lens');
      assert.ok(close(entry.frame.target, entry.expected.target), 'first Optics target belongs to incoming lens');
      await page.screenshot({ path: `shots/runtime-reliability/entry-${width}-${round}.png` });
      // Interrupt an in-piece camera move by navigating to another inspection.
      await page.locator('#tab-explain').click();
      await page.locator('#parts button').first().click();
      await page.evaluate(() => window.p2p.piece('cone'));
      assert.equal(await page.evaluate(() => window.p2p.framing().moving), false);
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => window.p2p.piece('lens'));
  await page.waitForFunction(() => !window.p2p.framing().moving);
  // Modal and full-view lesson coverage pause the GPU scene. Force a frame while
  // covered to verify deterministic snapshot requests still resolve.
  const paused = await page.evaluate(async () => {
    const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.showModal();
    const before = window.p2p.framing();
    await new Promise(r => setTimeout(r, 350));
    const { emit } = await import('/src/app/bus.ts'); emit('select-part', { id: 'iris' });
    await new Promise(r => setTimeout(r, 350));
    const during = window.p2p.framing();
    await window.p2p.settle();
    dialog.close(); dialog.remove();
    await new Promise(r => setTimeout(r, 150));
    return { before, during, resumed: window.p2p.framing() };
  });
  assert.ok(close(paused.before.position, paused.during.position), 'covered scene must not animate behind a dialog');
  assert.ok(!close(paused.before.position, paused.resumed.position), 'navigation requested while covered must resume without a future-dated freeze');
  await page.waitForFunction(() => !window.p2p.framing().moving);
  // Exercise real geometry ownership directly: all replaced buffers must dispose,
  // including second/subsequent rebuilds (the old bug only disposed initial stubs).
  const leaked = await page.evaluate(async () => {
    const [{ build }, look, bus, THREE] = await Promise.all([
      import('/src/pieces/cone.ts'), import('/src/app/look.ts'), import('/src/app/bus.ts'),
      import('/node_modules/three/build/three.webgpu.js'),
    ]);
    const overlay = document.createElement('div'); document.getElementById('view').append(overlay);
    const camera = new THREE.PerspectiveCamera(40, 1.5, .01, 100000);
    const handle = build({ renderer: { domElement: document.getElementById('gl') }, look, bus, camera,
      scene: new THREE.Scene(), overlay, dive() {}, badge: { show() {}, hide() {} },
      labels: { set() {}, remove() {}, clear() {} } });
    const model = window.p2p.model(); handle.update(model, model.scenario);
    const leaks = [];
    for (let pass = 0; pass < 3; pass++) {
      const owned = [];
      handle.group.traverse(o => { if (o.geometry) {
        const record = { name: o.name, geometry: o.geometry, disposed: false };
        o.geometry.addEventListener('dispose', () => { record.disposed = true; }); owned.push(record);
      } });
      handle.hooks.setPoint(2000 + pass * 250, .2 + pass * .1);
      const current = new Set(); handle.group.traverse(o => { if (o.geometry) current.add(o.geometry); });
      for (const item of owned) if (!current.has(item.geometry) && !item.disposed) leaks.push(item.name);
    }
    handle.dispose(); overlay.remove(); return leaks;
  });
  assert.deepEqual(leaked, [], 'every replaced cone geometry must be released');
  assert.deepEqual(errors, []);
  console.log('PASS normal-motion level entry, interrupted navigation, covered-stage pause/resume, forced snapshots, repeated cone buffer disposal');
} finally {
  await browser.close(); await server.close();
}
