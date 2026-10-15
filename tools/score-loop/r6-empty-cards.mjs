// Score loop r6 (UX): which Models parts give a card with a title and nothing else?
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-empty-cards.mjs before
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe'] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const q of ['body=dslr&lens=n50', 'body=dslr&lens=n500', 'body=dslr&lens=s35', 'body=dslr&lens=n500fl', 'body=dslr&lens=none', 'body=mirrorless&lens=m50', 'body=mirrorless&lens=z800', 'body=mirrorless&lens=z35']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${url}models.html?${q}`);
  await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const parts = await page.evaluate(() => [...document.querySelectorAll('.parts button')].map((b) => ({ part: b.dataset.part, text: b.textContent.trim().replace(/\s+/g, ' ') })));
  const empty = [];
  for (const p of parts) {
    const t = await page.evaluate((part) => { document.querySelector(`.parts button[data-part="${part}"]`).click(); return { title: document.getElementById('sel-t').textContent, desc: document.getElementById('sel-d').textContent }; }, p.part);
    if (!t.desc.trim()) empty.push({ part: p.part, row: p.text, title: t.title });
  }
  results[q] = { total: parts.length, empty };
  await context.close();
}
await browser.close();
writeFileSync(`${out}/${label}-empty-cards.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
