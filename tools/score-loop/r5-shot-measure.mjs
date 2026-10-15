// Measures Play the shot's canvas and explanation column at a size: node tools/score-loop/r5-shot-measure.mjs <w> <h>
import { chromium } from 'playwright';
const [w, h] = [Number(process.argv[2]), Number(process.argv[3])];
const base = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
await page.goto(`${base}?lens=n50&part=sensor&lux=7300&cct=4200`);
await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => window.p2p.pieces.camera.ready());
await page.locator('.shot-launch').click();
await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
await page.waitForTimeout(800);
const rows = [];
for (let i = 0; i < 6; i++) {
  await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(300);
  rows.push(await page.evaluate(() => {
    const r = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
    const d = document.querySelector('#shot-dialog');
    return { canvas: r('#shot-canvas'), aside: r('.shot-explanation'), main: r('.shot-main'), story: r('.shot-story'), measures: r('#shot-measures'), sh: d.scrollHeight, ch: d.clientHeight, minH: document.querySelector('.shot-explanation').style.minHeight };
  }));
}
console.log(JSON.stringify(rows));
await browser.close();
