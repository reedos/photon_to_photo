import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const reports = [];
mkdirSync('shots/learning', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  async function check(name) {
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    reports.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })), incomplete: result.incomplete.map(v => v.id) });
    console.log(`${name}: ${result.violations.length} violations`);
  }
  const cameraUrl = new URL(url); cameraUrl.searchParams.set('piece', 'camera');
  await page.goto(cameraUrl.href); await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await check('workspace');
  await page.locator('#steps [data-piece="loupe"]').click();
  await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, { timeout: 90000 });
  await check('controlled pixel sample');
  await page.locator('#steps [data-piece="camera"]').click();
  await page.locator('#learn-launch').click(); await page.locator('#journey-stop').selectOption('5');
  await check('readout');
  await page.locator('#journey-stop').selectOption('6'); await check('pipeline');
  await page.locator('#journey-close').click();
  await page.locator('#workspace-photos').click();
  await page.waitForFunction(() => document.querySelector('#rp-img')?.complete && document.querySelector('#rp-img')?.naturalWidth > 0);
  await check('real-photo gallery');
  await page.locator('#rp-play').click(); await page.locator('#shot-dialog').waitFor({ state: 'visible' });
  await check('JPEG journey');
  for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement === document.body || document.activeElement.closest('#shot-dialog')), 'shot dialog traps keyboard focus'); }
  await page.keyboard.press('Escape'); await page.locator('#shot-dialog').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 320, height: 740 }); await check('phone gallery');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.goto(`${url}reference.html?page=story`); await check('introduction');
  writeFileSync('shots/learning/accessibility.json', JSON.stringify(reports, null, 2));
  assert.equal(reports.reduce((n, r) => n + r.violations.length, 0), 0, 'see shots/learning/accessibility.json');
} finally { await browser.close(); await server?.close(); }
