// Score loop r6 helper: open the app at a size, run one JS expression in the page, print the JSON.
//   node tools/score-loop/r6-eval.mjs 360 740 "?piece=lens&lens=n50" "document.title" [shot.png] [--mouse]
import { chromium } from 'playwright';
const [w, h, query, expr, shot] = process.argv.slice(2);
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const desktop = process.argv.includes('--desktop') || Number(w) >= 900;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, reducedMotion: 'reduce', isMobile: !desktop, hasTouch: !desktop, deviceScaleFactor: desktop ? 1 : 2 });
const page = await context.newPage();
if (process.env.CONSOLE) page.on('console', (m) => { if (m.text().includes(process.env.CONSOLE)) console.log('[console]', m.text()); });
await page.goto(url + (query || ''));
const models = (query || '').startsWith('models');
await page.waitForFunction(() => (window.p2p && document.querySelector('#veil')?.classList.contains('off')) || (window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off')), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const result = await page.evaluate(`(async () => (${expr}))()`);
console.log(JSON.stringify(result));
if (shot && shot.endsWith('.png')) await page.screenshot({ path: shot });
await browser.close();
