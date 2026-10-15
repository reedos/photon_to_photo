// Score loop r6: every console message a page prints while it loads (the dev server's noise hid real warnings), and the server's own log lines.
//   P2P_URL=http://127.0.0.1:47832/ node tools/score-loop/r6-console.mjs [path=?piece=camera&lens=n50]
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47832/').replace(/\/?$/, '/');
const path = process.argv[2] || '?piece=camera&lens=n50';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const seen = [];
page.on('console', (m) => seen.push(`${m.type()}: ${m.text().slice(0, 220)}`));
page.on('pageerror', (e) => seen.push(`pageerror: ${String(e).slice(0, 220)}`));
await page.goto(base + path);
await page.waitForTimeout(Number(process.env.WAIT || 9000));
console.log(seen.length ? seen.join('\n') : 'no console messages');
await browser.close();
