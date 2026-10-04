// Finite navigation coverage: every directed level edge and every part for each
// UI lens, plus URL-only lenses. Natural motion; no forced settle/reduced motion.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './accuracy/png.mjs';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const base = process.env.P2P_URL || server.url;
const backend = process.env.P2P_BACKEND || 'webgpu';
const output = process.env.P2P_AUDIT_OUTPUT || `shots/navigation-matrix-${backend}`;
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { backend, edges: [], parts: [], overviews: [], inside: [], swaps: [], legacy: [], errors: [] };
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(20000);
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const levels = ['camera', 'lens', 'cone', 'loupe'];
// Euler circuit visits each of the twelve directed non-self edges once.
const circuit = ['camera', 'lens', 'camera', 'cone', 'camera', 'loupe', 'lens', 'cone', 'lens', 'loupe', 'cone', 'loupe', 'camera'];
const lineup = (process.env.P2P_LENSES || 's35,n50,n500,n500fl,z35,m50,z800').split(',');
async function rest(piece) {
  await page.waitForFunction(piece => {
    const p = window.p2p;
    return p.framing().piece === piece && !p.framing().moving
      && document.querySelector('#veil').classList.contains('off')
      && (piece !== 'loupe' || (p.pieces.loupe.state().hasPixel && p.pieces.loupe.state().diveStage === 'well'));
  }, piece);
  await page.waitForTimeout(60);
}
async function evidence(name) {
  const clip = await page.locator('#gl').boundingBox();
  const image = decodePng(await page.screenshot({ clip,
    style: '#view > :not(#gl) { opacity:0!important; transition:none!important; animation:none!important; }' }));
  // Inspect the middle of the MAIN viewport, excluding corner insets and HTML.
  // A filled-but-empty scene background must not count as model geometry.
  const bins = new Map(); let bright = 0, total = 0;
  for (let y = Math.floor(image.height * .2); y < image.height * .8; y += 2) {
    for (let x = Math.floor(image.width * .2); x < image.width * .8; x += 2) {
      const i = (y * image.width + x) * image.channels;
      const [r,g,b] = image.data.subarray(i, i + 3);
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1); total++;
      if (Math.max(r,g,b) > 65) bright++;
    }
  }
  const varied = total - Math.max(...bins.values());
  const frame = await page.evaluate(() => window.p2p.framing());
  assert.ok([...frame.position, ...frame.target].every(Number.isFinite), `${name}: finite camera`);
  assert.ok(varied > 100 && bright > 20, `${name}: main-view geometry missing (${varied} varied, ${bright} bright pixels)`);
  return { name, varied, bright, frame };
}
async function level(id) { await page.locator(`#steps [data-piece="${id}"]`).click(); await rest(id); }
try {
  const entry = new URL(`?lens=n50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, base);
  await page.goto(entry.href);
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
  assert.equal(await page.evaluate(() => window.p2p.backend()), backend);
  for (const lens of lineup) {
    await level('camera');
    const body = ['z35','m50','z800'].includes(lens) ? 'mirrorless' : 'dslr';
    await page.locator('#kit-body').selectOption(body);
    await page.locator('#kit-lens').selectOption(lens);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    for (let i = 1; i < circuit.length; i++) {
      await level(circuit[i]);
      report.edges.push(await evidence(`${lens}:${circuit[i-1]}→${circuit[i]}`));
    }
    for (const id of levels) {
      await level(id);
      await page.locator('#tab-explain').click();
      const parts = await page.locator('#parts [data-part-id]').evaluateAll(nodes => nodes.map(n => n.dataset.partId));
      for (const part of parts) {
        await page.locator(`#parts [data-part-id="${part}"]`).click();
        await rest(id);
        assert.equal(await page.evaluate(() => window.p2p.framing().selected), part);
        const shot = await evidence(`${lens}:${id}/${part}`);
        const anchor = await page.evaluate(part => window.p2p.pins().find(p => p.id === part), part);
        assert.ok(anchor?.on, `${lens}:${id}/${part}: selection agrees`);
        const box = await page.locator('#gl').boundingBox();
        assert.ok(anchor.anchorX >= 0 && anchor.anchorX <= box.width && anchor.anchorY >= 0 && anchor.anchorY <= box.height,
          `${lens}:${id}/${part}: true part anchor is in view`);
        if (id !== 'camera') assert.ok(Math.hypot(anchor.anchorX - box.width / 2, anchor.anchorY - box.height / 2) < 3,
          `${lens}:${id}/${part}: camera follows the actual part, not its displaced numbered marker`);
        report.parts.push(shot);
      }
      await page.locator('#part-overview').click();
      await rest(id);
      assert.equal(await page.evaluate(() => window.p2p.framing().selected), null);
      report.overviews.push(await evidence(`${lens}:${id}:overview-after-selection`));
      if (id === 'camera') {
        for (const [part, target] of [['iris','lens'], ['focusRing','cone'], ['sensor','loupe']]) {
          await page.locator(`#parts [data-part-id="${part}"]`).click();
          await page.locator('#card-go').click();
          await rest(target);
          report.inside.push(await evidence(`${lens}:${part}→${target}`));
          await page.locator('.inspection-back').click();
          await rest('camera');
          assert.equal(await page.evaluate(() => window.p2p.framing().selected), part, 'breadcrumb restores parent part');
          await page.locator('#part-overview').click();
          await rest('camera');
        }
      }
    }
    console.log(`${backend}: ${lens}: 12 directed edges and all parts passed`);
  }
  await level('camera');
  await page.locator('#parts [data-part-id="sensor"]').click();
  for (const lens of lineup) {
    const body = ['z35','m50','z800'].includes(lens) ? 'mirrorless' : 'dslr';
    await page.locator('#kit-body').selectOption(body);
    await page.locator('#kit-lens').selectOption(lens);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await rest('camera');
    const result = await evidence(`${lens}:selected-sensor-swap`);
    assert.equal(result.frame.selected, 'sensor');
    const intended = await page.evaluate(() => window.p2p.pieces.camera.partFrame('sensor'));
    assert.ok(Math.hypot(...result.frame.target.map((v,i) => v - intended.target[i])) < .05, 'loaded body follows selected sensor');
    report.swaps.push(result);
    for (const mode of ['outside','cutaway']) {
      await page.locator(`#hud-switches [data-view="${mode}"]`).click();
      await rest('camera');
      assert.equal(await page.evaluate(() => window.p2p.framing().selected), 'sensor');
      await page.locator('#zoom-in').click();
      await page.locator('#reset-view').click();
      await rest('camera');
      report.swaps.push(await evidence(`${lens}:sensor-${mode}-zoom-reset`));
    }
  }
  if (process.env.P2P_SKIP_LEGACY !== '1') {
    for (const lens of ['p20','p24','p28','p35','p50','p85','p105','p135','p200','p300','p400','p500']) {
      await page.evaluate(lens => window.p2p.set({ lens }), lens);
      for (const id of levels) {
        await level(id);
        report.legacy.push(await evidence(`${lens}:${id}`));
      }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ edges: report.edges.length, parts: report.parts.length, legacy: report.legacy.length }));
} catch (error) {
  report.failure = String(error.stack || error);
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server?.close();
}
