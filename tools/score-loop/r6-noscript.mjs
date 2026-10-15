// Score loop r6: the three pages with JavaScript off.
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-noscript.mjs out-dir
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const out = process.argv[2] || 'shots/r6-noscript';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
const page = await context.newPage();
for (const path of ['', 'models.html', 'reference.html']) {
  await page.goto(base + path);
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
  console.log(path || 'index.html', '|', text);
  await page.screenshot({ path: `${out}/${(path || 'index').replace('.html', '')}.png` });
}
await browser.close();
