// Score loop r6 (UX): what a hover and a click on the camera model do. Hover tooltip against the pins, body clicks, blank clicks,
// Escape and the view mode and panel tab afterwards.
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-click-probe.mjs before
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe'] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = { hover: [], click: [] };
async function open(query = '?piece=camera&lens=n50&focus=1.5') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url + query);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.settle?.());
  await page.waitForTimeout(2500);
  return { page, context };
}
const state = (page) => page.evaluate(() => {
  const u = new URL(location.href);
  const tip = document.querySelector('.rig-tip');
  const pressed = [...document.querySelectorAll('#hud-switches [data-view][aria-pressed="true"]')].map((b) => b.dataset.view);
  const tab = [...document.querySelectorAll('.studio-tabs [role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
  return { part: u.searchParams.get('part'), view: pressed[0] ?? null, tab, tip: tip && !tip.hidden ? tip.textContent : null, card: !document.querySelector('#card')?.hidden, slider: !!document.querySelector('#scenario input[type=range]')?.checkVisibility?.() };
});
{
  const { page, context } = await open();
  // hover over the glass, the grip, the body wall, and a few pin neighbors: does the tip cover a pin?
  const view = await page.locator('#gl').boundingBox();
  for (const [x, y] of [[745, 620], [700, 500], [690, 700], [600, 470], [500, 450], [640, 560], [820, 560], [560, 520]]) {
    await page.mouse.move(x - 40, y - 40);
    await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(260);
    const m = await page.evaluate(({ x, y }) => {
      const tip = document.querySelector('.rig-tip');
      if (!tip || tip.hidden) return { tip: null };
      const t = tip.getBoundingClientRect();
      const over = [...document.querySelectorAll('.pin .num, .pin .lbl')].filter((e) => e.offsetWidth > 0).map((e) => ({ e, b: e.getBoundingClientRect() }))
        .filter(({ b }) => b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top).map(({ e, b }) => `${e.className}:${e.closest('.pin').dataset.pinId}:${Math.round((Math.min(b.right, t.right) - Math.max(b.left, t.left)) * (Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top)))}`);
      const labels = [...document.querySelectorAll('.pin .lbl')].filter((e) => e.offsetWidth > 0).map((e) => e.textContent);
      return { tip: tip.textContent, overlapsPins: over, visiblePinLabels: labels };
    }, { x, y });
    results.hover.push({ at: [x, y], ...m });
    if (x === 745) await page.screenshot({ path: `${out}/${label}-hover-${x}-${y}.png` });
  }
  await context.close();
}
for (const [x, y] of [[745, 620], [700, 500], [690, 700], [1000, 300]]) {
  const { page, context } = await open();
  const before = await state(page);
  await page.mouse.click(x, y);
  await page.waitForTimeout(1800);
  results.click.push({ at: [x, y], before, after: await state(page) });
  await page.screenshot({ path: `${out}/${label}-click-${x}-${y}.png` });
  await context.close();
}
{
  // a part is picked, then a click on empty space
  const { page, context } = await open('?piece=camera&lens=n50&focus=1.5&part=glass');
  const picked = await state(page);
  await page.mouse.click(1050, 320);
  await page.waitForTimeout(1500);
  results.blank = { picked, afterBlankClick: await state(page) };
  await context.close();
}
{
  // a pick that switches to the cutaway, then Escape: view mode and tab
  const { page, context } = await open('?piece=camera&lens=n50&focus=1.5');
  const start = await state(page);
  await page.locator('.pin[data-pin-id="sensor"]').click();
  await page.waitForTimeout(1800);
  const picked = await state(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const afterEsc = await state(page);
  results.escape = { start, picked, afterEsc, apertureSliderVisible: await page.evaluate(() => !!document.querySelector('#scenario input[type=range]')?.checkVisibility()) };
  await page.screenshot({ path: `${out}/${label}-escape.png` });
  await context.close();
}
await browser.close();
writeFileSync(`${out}/${label}-click.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
