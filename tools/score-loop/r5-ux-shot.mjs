// One screenshot of a URL at a size: node tools/score-loop/r5-shot.mjs <w> <h> "<query>" <out.png>   (P2P_URL for the server)
import { chromium } from 'playwright';
const [w, h, query, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
const base = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const phone = w < 760;
const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
const page = await context.newPage();
await page.goto(base + query);
await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
await page.evaluate(() => window.p2p.pieces.camera?.ready?.()).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
