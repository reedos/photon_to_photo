// Score loop r3 helper: axe violations on the tour's Read the sensor stop (desktop 1440x900 by default).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47834/';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${url}?piece=camera`); await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => window.p2p.pieces.camera.ready());
await page.locator('#learn-launch').click(); await page.locator('#journey-stop').selectOption('7');
await page.addScriptTag({ content: axe });
const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
console.log(JSON.stringify(r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => [n.target, n.failureSummary]) })), null, 1));
await browser.close();
