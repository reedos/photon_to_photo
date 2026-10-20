// Score loop r4 (UX): one probe per reviewer finding, printed as JSON, with screenshots for the note.
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r4-ux-probe.mjs before [probe ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe', ...only] = process.argv.slice(2);
const out = 'docs/score-loop/r4-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
const want = (name) => !only.length || only.includes(name);

async function open(width, height, query = '?piece=camera&lens=n50&focus=1.5&iso=400', extra = {}) {
  const phone = width < 760 || height < 500;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, ...extra });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}${query}`);
  await page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(500);
  return { page, context, errors };
}
const rect = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; });
const round = (a) => a.map(v => Math.round(v));
const pose = async (page) => { const f = await page.evaluate(() => window.p2p.framing()); return { position: round(f.position), target: round(f.target), piece: f.piece, selected: f.selected }; };
async function run(name, fn) {
  if (!want(name)) return;
  try { results[name] = await fn(); } catch (e) { results[name] = { error: String(e?.message ?? e).split('\n')[0] }; }
}

// 1. the guided tour re-frames the camera at its first stop, even after the reader orbited
await run('tour', async () => {
  const { page, context } = await open(1440, 900);
  const r = {};
  r.initial = await pose(page);
  await page.mouse.move(600, 450); await page.mouse.down(); await page.mouse.move(420, 380, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(500);
  r.orbited = await pose(page);
  await page.locator('#learn-launch').click(); await page.waitForTimeout(1500);
  r.stop1 = await pose(page);
  await page.screenshot({ path: `${out}/${label}-tour1-after-orbit.png` });
  await page.locator('#journey-next').click(); await page.waitForTimeout(1500);
  r.stop2 = await pose(page);
  await page.locator('#journey-prev').click(); await page.waitForTimeout(1500);
  r.stop1again = await pose(page);
  // Restart after another orbit
  await page.mouse.move(600, 450); await page.mouse.down(); await page.mouse.move(700, 500, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  r.orbitedAgain = await pose(page);
  await page.locator('#journey-restart').click(); await page.waitForTimeout(1500);
  r.afterRestart = await pose(page);
  await context.close();
  return r;
});

// 2. clicking the model itself
await run('pick', async () => {
  const { page, context } = await open(1440, 900);
  const box = await rect(page, '#gl');
  const hits = {};
  const cursors = {};
  const grid = [];
  for (let gy = 1; gy <= 9; gy++) for (let gx = 1; gx <= 11; gx++) grid.push([box.x + (box.w * gx) / 12, box.y + (box.h * gy) / 10]);
  for (const [x, y] of grid) {
    await page.mouse.move(x, y); await page.waitForTimeout(30);
    const cursor = await page.evaluate(() => getComputedStyle(document.getElementById('gl')).cursor);
    cursors[cursor] = (cursors[cursor] ?? 0) + 1;
    await page.mouse.click(x, y); await page.waitForTimeout(120);
    const sel = await page.evaluate(() => window.p2p.framing().selected);
    if (sel) { hits[sel] = (hits[sel] ?? 0) + 1; await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
  }
  await page.screenshot({ path: `${out}/${label}-pick-grid.png` });
  await context.close();
  return { hits, cursors, canvas: box };
});

// 3. the aperture feedback when a photograph's own settings are applied on its lens
await run('aperture', async () => {
  const { page, context } = await open(1440, 900);
  const read = () => page.evaluate(() => { const t = document.querySelector('#toast'); return { toast: t.hidden ? null : t.textContent, slider: document.querySelector('#sc-fno-v').textContent, note: document.querySelector('#sc-fno-note')?.hidden === false ? document.querySelector('#sc-fno-note').textContent : null, valuetext: document.querySelector('#sc-fno').getAttribute('aria-valuetext'), fno: window.p2p.scenario().fno, hud: document.querySelector('#hud-sub')?.textContent }; });
  const r = {};
  await page.evaluate(() => window.p2p.set({ lens: 'n500', fno: 5.6 })); await page.waitForTimeout(700);
  r.n500_f56 = await read();
  await page.screenshot({ path: `${out}/${label}-aperture-n500-f56.png` });
  await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 4 })); await page.waitForTimeout(1500);
  await page.evaluate(() => window.p2p.set({ lens: 'n500', fno: 2.8 })); await page.waitForTimeout(700);
  r.n500_f28 = await read();
  await page.screenshot({ path: `${out}/${label}-aperture-n500-f28.png` });
  await page.evaluate(() => window.p2p.set({ lens: 'n500', fno: 8 })); await page.waitForTimeout(500);
  r.n500_f8 = await read();
  await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 1.8 })); await page.waitForTimeout(1500);
  r.n50_f18 = await read();
  await context.close();
  return r;
});

// 4. phone: Read explanation overflow and the Play the shot chapter tabs
await run('phone-controls', async () => {
  const r = {};
  for (const w of [360, 390, 430]) {
    const { page, context } = await open(w, 844, '?view=photos&photo=flycatcher');
    await page.waitForTimeout(800);
    r[`readexp${w}`] = await page.evaluate(() => { const b = document.querySelector('.rp-read-explanation'); if (!b) return null; const cs = getComputedStyle(b); return { scrollWidth: b.scrollWidth, clientWidth: b.clientWidth, text: b.textContent, padding: cs.padding, visible: b.getClientRects().length > 0 }; });
    if (w === 390) await page.screenshot({ path: `${out}/${label}-readexp-390.png` });
    await context.close();
  }
  const { page, context } = await open(390, 844, '?piece=camera&lens=n50');
  await page.evaluate(() => document.querySelector('.shot-launch')?.click());
  await page.waitForTimeout(1500);
  r.chapters = await page.evaluate(() => [...document.querySelectorAll('.shot-chapters button')].map(b => { const s = b.querySelector('span'); const cs = getComputedStyle(b); const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect(); const br = b.getBoundingClientRect(); return { text: b.textContent, boxW: Math.round(br.width), textW: Math.round(t.width), slack: Math.round(br.width - t.width), pad: cs.paddingLeft, ls: cs.letterSpacing }; }));
  await page.screenshot({ path: `${out}/${label}-shot-chapters-390.png` });
  await context.close();
  return r;
});

// 5. brand and the Models link
await run('links', async () => {
  const r = {};
  const { page, context } = await open(1440, 900, '?piece=camera&lens=z800');
  r.workspace = await page.evaluate(() => ({ brand: document.querySelector('#topbar .brand').getAttribute('href'), models: [...document.querySelectorAll('#topnav a')].map(a => `${a.textContent}=${a.getAttribute('href')}`) }));
  await page.locator('#topnav a', { hasText: 'Models' }).click();
  await page.waitForTimeout(1500);
  r.modelsUrl = page.url().replace(url, '');
  r.modelsPage = await page.evaluate(() => ({ brand: document.querySelector('.brand').getAttribute('href'), title: document.title, sel: document.querySelector('#sel-t')?.textContent, nav: [...document.querySelectorAll('#topnav a')].map(a => `${a.textContent}=${a.getAttribute('href')} ${getComputedStyle(a).color}`) }));
  await page.goto(`${url}reference.html?page=story`); await page.waitForTimeout(800);
  r.reference = await page.evaluate(() => ({ brand: document.querySelector('.brand').getAttribute('href'), nav: [...document.querySelectorAll('#topnav a')].map(a => `${a.textContent}=${a.getAttribute('href')} ${getComputedStyle(a).color}`) }));
  await page.screenshot({ path: `${out}/${label}-reference-nav.png`, clip: { x: 0, y: 0, width: 1440, height: 120 } });
  await context.close();
  return r;
});

// 6. the tour band at 1440x900 and the focus level's two distance sliders
await run('tour-band', async () => {
  const { page, context } = await open(1440, 900);
  const r = {};
  r.viewBefore = await rect(page, '#view');
  await page.locator('#learn-launch').click(); await page.waitForTimeout(1500);
  r.view = await rect(page, '#view'); r.band = await rect(page, '#journey');
  r.bandButtons = await page.evaluate(() => [...document.querySelectorAll('#journey nav button')].map(b => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.y)}`; }));
  r.rows = await page.evaluate(() => { const ys = new Set([...document.querySelectorAll('#journey nav button')].map(b => Math.round(b.getBoundingClientRect().y))); return ys.size; });
  r.teachingLabels = await page.evaluate(() => [...document.querySelectorAll('.rig-tip, .teach, .rig-teach, [class*=teach]')].filter(e => e.getClientRects().length).map(e => `${e.className}:${e.textContent.trim().slice(0, 40)}`));
  await page.screenshot({ path: `${out}/${label}-tour-band-1440.png` });
  // last stop copy
  for (let i = 0; i < 12; i++) { const t = await page.locator('#journey-next').textContent(); if (/Finish/.test(t)) break; await page.locator('#journey-next').click(); await page.waitForTimeout(250); }
  r.lastText = await page.locator('#journey-text').textContent();
  r.shotButton = await page.evaluate(() => document.querySelector('#journey-shot')?.textContent);
  await page.screenshot({ path: `${out}/${label}-tour-last-1440.png` });
  await context.close();
  return r;
});

await run('focus-sliders', async () => {
  const { page, context } = await open(1440, 900, '?piece=cone&lens=n50&focus=1.5&iso=400');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter(i => i.getClientRects().length).map(i => `${i.id}:${i.getAttribute('aria-label') ?? document.querySelector(`label[for="${i.id}"]`)?.textContent ?? i.closest('label')?.textContent.trim().slice(0, 40)}`));
  await page.screenshot({ path: `${out}/${label}-focus-1440.png` });
  await context.close();
  return r;
});

// 7. short and narrow windows
await run('landscape', async () => {
  const { page, context } = await open(844, 390, '?piece=camera&lens=n50');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: innerHeight, scrollY: Math.round(scrollY), header: document.querySelector('#topbar')?.getBoundingClientRect().height }));
  r.view = await rect(page, '#view'); r.viewer = await rect(page, '.viewer'); r.experiments = await rect(page, '#model-experiments'); r.tools = await rect(page, '#model-tools');
  await page.screenshot({ path: `${out}/${label}-landscape-844.png` });
  await context.close();
  return r;
});
await run('hint-1024', async () => {
  const { page, context } = await open(1024, 768);
  const r = await page.evaluate(() => { const h = document.querySelector('.orbit-hint'); const b = h.getBoundingClientRect(); const bar = document.querySelector('.hud-btns-phone').getBoundingClientRect(); return { text: h.textContent, scrollWidth: h.scrollWidth, clientWidth: h.clientWidth, w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y), barY: Math.round(bar.y), position: getComputedStyle(h).position, visible: h.getClientRects().length > 0 }; });
  await page.screenshot({ path: `${out}/${label}-hint-1024.png` });
  await context.close();
  return r;
});

console.log(JSON.stringify(results, null, 1));
writeFileSync(`${out}/${label}.json`, JSON.stringify(results, null, 1));
await browser.close();
