// Score loop round 6: the Method page's live figure at three slider values (and a phone), as screenshots of the figure card.
//   OUT=dir P2P_PORT=47802 node tools/score-loop/r6-ref.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const { createServer } = await import('vite');
const port = Number(process.env.P2P_PORT || 47802);
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, open: false } });
await dev.listen();
const OUT = process.env.OUT || 'shots/r6';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, vp] of [['desk', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/reference.html?page=method`);
    await page.waitForSelector('[data-ray-slider]');
    const card = page.locator('.ref-card:has([data-ray-slider])');
    for (const v of [330, 189, 105]) {
      await page.locator('[data-ray-slider]').evaluate((el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${OUT}/method-fig-${name}-${v}.png` });
      console.log(name, v, await page.locator('[data-ray-note]').textContent());
    }
    if (errors.length) console.log('ERR', errors.join(' | '));
  }
} finally { await browser.close(); await dev.close(); process.exit(0); }
