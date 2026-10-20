// Score loop r5: input and level taps while the idle precompile is running. The camera must keep drawing, look exactly as it
// does without the precompile, and a level tapped mid-run must open normally.
//   P2P_URL=http://127.0.0.1:47807/ OUT=shots/r5-interplay node tools/score-loop/r5-interplay.mjs [rate=1]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const OUT = process.env.OUT || 'shots/r5-interplay';
const rate = Number(process.argv[2] || 1);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
const problems = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') { problems.push(m.text().slice(0, 200)); console.log('console', m.type(), m.text().slice(0, 200)); } });
page.on('pageerror', (e) => { problems.push(String(e)); console.log('pageerror', String(e).slice(0, 200)); });
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
// 1. drag the camera while the precompile is in its steps: the frames keep coming
await page.waitForFunction(() => performance.getEntriesByName('p2p:prewarm-lens').length > 0, null, { timeout: 60000 });
const box = await page.locator('#gl').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;
await page.evaluate(() => { window.__frames = []; let last = performance.now(); window.__run = true; const f = (t) => { window.__frames.push(t - last); last = t; if (window.__run) requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.mouse.move(cx, cy); await page.mouse.down();
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < 3000) { i++; await page.mouse.move(cx + Math.sin(i / 6) * box.width * 0.2, cy + Math.cos(i / 9) * 20, { steps: 1 }); }
await page.mouse.up();
const frames = await page.evaluate(() => { window.__run = false; return window.__frames.slice(2); });
const s = [...frames].sort((a, b) => a - b);
console.log('drag during the run: frames', frames.length, 'p50', s[Math.floor(s.length * 0.5)]?.toFixed(1), 'p95', s[Math.floor(s.length * 0.95)]?.toFixed(1), 'max', s.at(-1)?.toFixed(1));
// 2. a level tapped while the run is still going
const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter((m) => /prewarm/.test(m.name)).map((m) => m.name.slice(4)));
console.log('marks at the tap', JSON.stringify(marks));
await page.waitForTimeout(500);
const tapAt = await page.evaluate(() => performance.now());
await page.locator('.step[data-piece="cone"]').first().click();
await page.waitForFunction(() => document.querySelector('.step[aria-current="step"]')?.dataset.piece === 'cone' && document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 });
console.log('cone open', Math.round(await page.evaluate((t) => performance.now() - t, tapAt)), 'ms after the tap');
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/cone-after-midrun-tap.png` });
await page.locator('.step[data-piece="camera"]').first().click();
await page.waitForFunction(() => document.querySelector('.step[aria-current="step"]')?.dataset.piece === 'camera' && document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 });
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/camera-after-midrun-tap.png` });
// the camera after everything has settled and the run has finished
await page.waitForFunction(() => performance.getEntriesByName('p2p:prewarmed-loupe').length > 0, null, { timeout: 90000 }).catch(() => console.log('the run did not finish'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/camera-after-run.png` });
console.log('problems', JSON.stringify(problems));
await browser.close();
