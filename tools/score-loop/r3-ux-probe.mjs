// Score loop r3 (UX): one probe per reviewer finding, printed as JSON, with screenshots for the note.
//   P2P_URL=http://127.0.0.1:47834/ node tools/score-loop/r3-ux-probe.mjs before [probe ...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47834/';
const [label = 'probe', ...only] = process.argv.slice(2);
const out = 'docs/score-loop/r3-ux';
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
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(400);
  return { page, context, errors };
}
const rect = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; });
const tabs = (page) => page.evaluate(() => ({ controls: document.querySelector('#tab-controls').getAttribute('aria-selected'), parts: document.querySelector('#tab-explain').getAttribute('aria-selected') }));
const params = (page) => Object.fromEntries(new URL(page.url()).searchParams);
const level = async (page, piece) => { await page.locator(`#steps [data-piece="${piece}"]`).click(); await page.waitForTimeout(1500); await page.evaluate(() => window.p2p.settle()).catch(() => {}); };
const selected = (page) => page.evaluate(() => ({ framing: window.p2p.framing().selected, list: document.querySelector('#parts li.sel .pt')?.textContent ?? null, position: document.querySelector('#part-position')?.textContent }));

if (want('probes')) {
  const { page, context } = await open(1440, 900);
  const r = {};
  for (const piece of ['camera', 'lens', 'cone', 'loupe']) {
    await level(page, piece);
    r[piece] = await page.evaluate(() => window.p2p.pins().map(p => `${p.id}:${p.label}`));
  }
  results.probes = r;
  await context.close();
}

if (want('expand')) {
  const { page, context } = await open(1440, 900);
  await page.locator('#expand-model').click();
  await page.waitForTimeout(600);
  const m = { view: await rect(page, '#view'), canvas: await rect(page, '#gl'), body: await rect(page, '.stage .body') };
  await page.screenshot({ path: `${out}/${label}-expand-1440.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  m.afterEscape = await page.evaluate(() => ({ expanded: document.body.classList.contains('model-expanded'), focus: document.activeElement?.id }));
  results.expand = m;
  await context.close();
}

if (want('focus-tab')) {
  const { page, context } = await open(1440, 900);
  const m = { camera: await tabs(page) };
  await level(page, 'cone');
  m.cone = await tabs(page);
  m.focusSliderVisible = await page.locator('#sc-focus').isVisible();
  m.why = await page.locator('#level-why').textContent();
  await page.screenshot({ path: `${out}/${label}-focus-level.png` });
  results.focusTab = m;
  await context.close();
}

if (want('tour')) {
  const { page, context } = await open(1440, 900);
  const before = { mode: await page.evaluate(() => document.body.dataset.modelView), tabs: await tabs(page) };
  await page.locator('#learn-launch').click();
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) { await page.locator('#journey-next').click(); await page.waitForTimeout(700); }
  const stopBefore = await page.locator('#journey-stop').evaluate(s => s.selectedOptions[0].textContent);
  await page.locator('#journey-close').click();
  await page.waitForTimeout(800);
  const after = { mode: await page.evaluate(() => document.body.dataset.modelView), tabs: await tabs(page), params: params(page) };
  await page.screenshot({ path: `${out}/${label}-tour-closed.png` });
  await page.locator('#learn-launch').click();
  await page.waitForTimeout(800);
  const stopAfter = await page.locator('#journey-stop').evaluate(s => s.selectedOptions[0].textContent);
  results.tour = { before, stopBefore, after, stopAfter };
  await context.close();
}

if (want('canvas-focus')) {
  const { page, context } = await open(1440, 900);
  const active = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  await page.keyboard.press('Tab');
  const firstTab = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 40));
  results.canvasFocus = { active, firstTab };
  await context.close();
}

if (want('escape-up')) {
  const { page, context } = await open(1440, 900, '?piece=lens&lens=n50&focus=1.5&iso=400');
  await page.waitForTimeout(1500);
  await page.locator('#gl').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  results.escapeUp = { piece: params(page).piece, glLabel: await page.locator('#gl').getAttribute('aria-label') };
  await context.close();
}

if (want('sel-url')) {
  const { page, context } = await open(1440, 900, '?piece=cone&lens=n50&focus=1.5&iso=400');
  await page.waitForTimeout(1500);
  const pins = await page.evaluate(() => window.p2p.pins().map(p => p.id));
  await page.locator(`.pin[data-pin-id="${pins[1]}"]`).click({ force: true });
  await page.waitForTimeout(800);
  const urlAfterPick = page.url();
  const sel = await selected(page);
  await page.reload();
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.waitForTimeout(2500);
  results.selUrl = { pin: pins[1], sel, urlAfterPick, afterReload: await selected(page) };
  await context.close();
}

if (want('go-inside')) {
  const r = {};
  for (const part of ['iris', 'glass', 'focusRing', 'sensor', 'lens']) {
    const { page, context } = await open(1440, 900, `?piece=camera&lens=n50&focus=1.5&iso=400&part=${part}`);
    await page.waitForTimeout(800);
    const go = page.locator('#card-go');
    if (!(await go.isVisible())) { r[part] = 'no go-inside'; await context.close(); continue; }
    await go.click();
    await page.waitForTimeout(2500);
    r[part] = { piece: params(page).piece, ...(await selected(page)) };
    if (part === 'iris') await page.screenshot({ path: `${out}/${label}-go-inside-iris.png` });
    await context.close();
  }
  results.goInside = r;
}

if (want('tour-lesson')) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const { page, context } = await open(w, h, '?piece=camera&lens=n50&focus=1.5&iso=400&tour=8');
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const L = document.querySelector('#sensor-lesson'); const r = (s) => { const e = document.querySelector(s); if (!e || !e.checkVisibility()) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.y), b: Math.round(b.bottom), h: Math.round(b.height) }; };
      return { lesson: r('#sensor-lesson'), lessonScroll: L ? [L.scrollHeight, L.clientHeight] : null, partNav: r('.part-nav'), zoom: r('.zoom-controls'), journey: r('#journey'), inner: innerHeight };
    });
    await page.screenshot({ path: `${out}/${label}-tour8-${w}x${h}.png` });
    results[`tourLesson${w}`] = m;
    await context.close();
  }
}

if (want('phone-pin')) {
  const { page, context } = await open(390, 844);
  await page.locator('.pin[data-pin-id="lens"]').click({ force: true });
  await page.waitForTimeout(1200);
  results.phonePin = { view: await rect(page, '#view'), go: await page.locator('#card-go').isVisible() ? await rect(page, '#card-go') : null, crumb: await page.locator('.inspection-context, .crumb').first().isVisible().catch(() => false), pin: await page.evaluate(() => window.p2p.pins().find(p => p.id === 'lens')) };
  await page.screenshot({ path: `${out}/${label}-phone-pin.png` });
  await context.close();
}

if (want('back-nav')) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${url}?start=1`);
  await page.waitForTimeout(1500);
  const nav = () => page.evaluate(() => [...document.querySelectorAll('[aria-current="page"], [aria-current="true"]')].filter(e => e.closest('nav')).map(e => e.textContent.trim()));
  const atOpening = await nav();
  const enter = page.locator('a, button').filter({ hasText: /explore the camera/i }).first();
  await enter.click();
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.waitForTimeout(1500);
  const inWorkspace = await nav();
  await page.locator('.pin[data-pin-id="lens"]').click({ force: true });
  await page.waitForTimeout(600);
  await page.goBack();
  await page.waitForTimeout(1200);
  const afterBack = { nav: await nav(), params: params(page), opening: await page.evaluate(() => document.body.className) };
  await page.screenshot({ path: `${out}/${label}-back.png` });
  results.backNav = { atOpening, inWorkspace, afterBack };
  await context.close();
}

if (want('hints')) {
  const { page, context } = await open(1440, 900);
  results.hint = await page.evaluate(() => [...document.querySelectorAll('.hint, .model-gestures, .workspace-views > span')].map(e => ({ cls: e.className, text: e.textContent, shown: e.checkVisibility(), w: Math.round(e.getBoundingClientRect().width) })));
  await context.close();
}

if (want('hint')) {
  const { page, context } = await open(1440, 900);
  results.orbitHint = await page.evaluate(() => { const e = document.querySelector('.orbit-hint'); if (!e) return null; const r = e.getBoundingClientRect(); return { shown: e.checkVisibility(), text: e.textContent, x: Math.round(r.x), r: Math.round(r.right), y: Math.round(r.y) }; });
  await page.screenshot({ path: `${out}/${label}-1440-ready.png` });
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(540, 420); await page.mouse.up();
  await page.waitForTimeout(300);
  results.orbitHintAfterDrag = await page.evaluate(() => document.querySelector('.orbit-hint')?.checkVisibility() ?? null);
  await context.close();
}

if (want('focus-link')) {
  const { page, context } = await open(1440, 900);
  await page.locator('#tab-explain').click();
  await level(page, 'cone');
  const before = await tabs(page);
  await page.locator('#level-why .why-link').click();
  await page.waitForTimeout(300);
  results.focusLink = { before, after: await tabs(page), focus: await page.evaluate(() => document.activeElement?.id), cue: await page.evaluate(() => !!document.querySelector('.tour-cue')) };
  await page.screenshot({ path: `${out}/${label}-focus-link.png` });
  await context.close();
}

if (want('pixel-head')) {
  const { page, context } = await open(1440, 900, '?piece=loupe&lens=n50&focus=1.5&iso=400');
  await page.waitForTimeout(2500);
  results.pixelHead = await page.evaluate(() => [...document.querySelectorAll('.lv-read-h .lv-ctl-k[data-k="heading"]')].filter(e => e.checkVisibility()).map(e => ({ text: e.textContent, h: Math.round(e.getBoundingClientRect().height), clipped: e.scrollWidth > e.clientWidth })));
  await page.screenshot({ path: `${out}/${label}-pixel-level.png` });
  await context.close();
}

if (want('land-pins')) {
  for (const [w, h] of [[844, 390], [740, 360]]) {
    const { page, context } = await open(w, h, '?piece=cone&lens=n50&focus=1.5&iso=400');
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.lv-inset-note')].filter(e => e.checkVisibility()).map(e => e.getBoundingClientRect());
      const pins = [...document.querySelectorAll('.pin')].filter(e => e.checkVisibility() && getComputedStyle(e).visibility !== 'hidden').map(e => ({ id: e.dataset.pinId, r: e.querySelector('.num').getBoundingClientRect() }));
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { notes: notes.map(n => [Math.round(n.left), Math.round(n.top), Math.round(n.right), Math.round(n.bottom)]), overlaps: pins.filter(p => notes.some(n => hit(p.r, n))).map(p => p.id), pins: pins.map(p => p.id) };
    });
    await page.screenshot({ path: `${out}/${label}-focus-${w}x${h}.png` });
    results[`landPins${w}`] = m;
    await context.close();
  }
}

if (want('card')) {
  const { page, context } = await open(1440, 900, '?piece=camera&lens=n50&focus=1.5&iso=400&part=iris');
  await page.waitForTimeout(800);
  const iris = await page.evaluate(() => ({ k: document.querySelector('#card-k').textContent, t: document.querySelector('#card-t').textContent, sub: document.querySelector('#card-sub').textContent, list: document.querySelector('#parts li.sel .pt')?.textContent }));
  await page.goto(`${url}?piece=camera&lens=n50&focus=1.5&iso=400&part=sensor`);
  await page.waitForFunction(() => window.p2p?.pieces.camera); await page.evaluate(() => window.p2p.pieces.camera.ready()); await page.waitForTimeout(800);
  const sensor = await page.evaluate(() => ({ k: document.querySelector('#card-k').textContent, t: document.querySelector('#card-t').textContent, sub: document.querySelector('#card-sub').textContent, list: document.querySelector('#parts li.sel .pt')?.textContent }));
  await page.screenshot({ path: `${out}/${label}-card-sensor.png` });
  results.card = { iris, sensor };
  await context.close();
}

if (want('tour-phone')) {
  const { page, context } = await open(360, 740, '?piece=camera&lens=n50&focus=1.5&iso=400&tour=1');
  await page.waitForTimeout(1200);
  results.tourPhone = { next: await rect(page, '#journey-next'), text: await page.locator('#journey-next').textContent() };
  await page.screenshot({ path: `${out}/${label}-tour-360.png` });
  await context.close();
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
