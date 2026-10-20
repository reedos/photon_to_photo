// Score loop r6 (UX): the Play the shot clock against wall time. node tools/score-loop/r6-shot-clock.mjs <label> [w h]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const [label = 'probe', w = 1440, h = 900] = process.argv.slice(2);
const base = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, reducedMotion: 'no-preference' });
await page.goto(`${base}?lens=n50&part=sensor&lux=7300&cct=4200`);
await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => window.p2p.pieces.camera.ready());
await page.locator('.shot-launch').click();
await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
await page.waitForTimeout(600);
const read = () => page.evaluate(() => ({ clock: document.querySelector('#shot-clock').textContent, time: Number(document.querySelector('#shot-time').value) }));
const rows = [{ wall: 0, ...(await read()) }];
if ((await page.locator('#shot-play').textContent()) !== 'Pause') await page.locator('#shot-play').click();
const t0 = Date.now();
for (let i = 0; i < 4; i++) { await page.waitForTimeout(2000); rows.push({ wall: Math.round((Date.now() - t0) / 100) / 10, ...(await read()) }); }
await page.screenshot({ path: `${out}/${label}-shot-clock-${w}x${h}.png` });
writeFileSync(`${out}/${label}-shot-clock-${w}x${h}.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(rows));
await browser.close();
