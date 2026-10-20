// Score loop r3 helper: open the app at a size and query, optionally click a selector, then print an expression's value.
//   node tools/score-loop/r3-eval.mjs 1440x900 '?piece=camera' '#expand-model' 'expr'
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47834/';
const [size, query, click, expr, shot] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const phone = width < 760 || height < 500;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
const page = await context.newPage();
page.on('pageerror', e => console.log('pageerror', String(e)));
await page.goto(`${url}${query}`);
await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => window.p2p.pieces.camera.ready());
await page.waitForTimeout(1200);
for (const sel of (click || '').split(';;').filter(Boolean)) {
  if (sel.startsWith('key:')) await page.keyboard.press(sel.slice(4));
  else if (sel.startsWith('wait:')) await page.waitForTimeout(Number(sel.slice(5)));
  else await page.locator(sel).first().click({ force: true });
  await page.waitForTimeout(700);
}
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
if (shot) await page.screenshot({ path: shot });
await browser.close();
