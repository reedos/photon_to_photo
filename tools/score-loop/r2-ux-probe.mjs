// Score loop r2 (UX): one probe per reviewer finding, printed as JSON, with screenshots for the note.
//   P2P_URL=http://127.0.0.1:47814/ node tools/score-loop/r2-ux-probe.mjs before [probe ...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47814/';
const [label = 'probe', ...only] = process.argv.slice(2);
const out = 'docs/score-loop/r2-ux';
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
  await page.waitForTimeout(300);
  return { page, context, errors };
}
const rect = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; });
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));

if (want('phone-pin')) for (const [w, h] of [[390, 844], [844, 390], [320, 740]]) {
  const { page, context } = await open(w, h);
  await page.locator('.pin').nth(2).click();
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const panel = document.querySelector('#studio-explain'), card = document.querySelector('#card');
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), shown: Math.round(Math.max(0, Math.min(r.bottom, p.bottom, innerHeight) - Math.max(r.top, p.top, 0))) }; };
    const view = document.querySelector('#view').getBoundingClientRect();
    return { panelClient: panel.clientHeight, panelScroll: panel.scrollHeight, cardClient: card.clientHeight, cardScroll: card.scrollHeight,
      title: vis(document.querySelector('#card-t')), body: vis(document.querySelector('#card-b')), specs: vis(document.querySelector('#card-s')),
      viewVisible: Math.round(Math.max(0, Math.min(view.bottom, innerHeight) - Math.max(view.top, 0))), expanded: document.body.classList.contains('inspector-expanded') };
  });
  await page.screenshot({ path: `${out}/${label}-${w}x${h}-pin.png` });
  // closing the card
  await page.locator('#card-x').click().catch(() => {});
  await page.waitForTimeout(300);
  m.afterClose = await page.evaluate(() => ({ expanded: document.body.classList.contains('inspector-expanded') }));
  results[`phone-pin-${w}x${h}`] = m;
  await context.close();
}

if (want('photos-url')) {
  const { page, context } = await open(1440, 900);
  await page.locator('#workspace-photos').click();
  await page.waitForSelector('.rp-pick[data-id="fox-portrait"]');
  const strip = await page.evaluate(() => { const p = document.querySelector('#rp-picks'), r = p.getBoundingClientRect(); const last = p.lastElementChild.getBoundingClientRect(); const s = getComputedStyle(p); return { right: Math.round(r.right), lastRight: Math.round(last.right), scrollW: p.scrollWidth, clientW: p.clientWidth, overflowX: s.overflowX, mask: s.maskImage || s.webkitMaskImage, wrap: s.flexWrap, cols: s.gridTemplateColumns, inner: innerWidth }; });
  await page.screenshot({ path: `${out}/${label}-1440-photos.png` });
  await page.locator('.rp-pick[data-id="fox-portrait"]').click();
  await page.waitForTimeout(300);
  const before = page.url();
  const shareVisible = await page.locator('#share-btn').isVisible();
  await page.locator('.rp-pick[data-id="mallard"]').click();
  await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(400);
  const afterBack = { url: page.url(), title: await page.locator('#rp-h').textContent() };
  await page.reload();
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.waitForTimeout(1200);
  const reload = { url: page.url(), title: await page.locator('#rp-h').textContent(), count: await page.locator('.rp-count').textContent(), view: await page.evaluate(() => document.body.dataset.workspaceView) };
  await page.screenshot({ path: `${out}/${label}-photos-reload.png` });
  // a crop button, then reload keeps it
  const cropBtn = page.locator('.rp-detail-controls button').nth(1);
  let crop = null;
  if (await cropBtn.count()) { await cropBtn.click(); await page.waitForTimeout(500); crop = { url: page.url() }; await page.reload(); await page.waitForFunction(() => window.p2p?.pieces.camera); await page.waitForTimeout(1500); crop.pressed = await page.locator('.rp-detail-controls button[aria-pressed="true"]').textContent().catch(() => null); }
  results['photos-url'] = { urlAfterPick: before, shareVisible, rpShare: await page.locator('#rp-share').isVisible().catch(() => false), afterBack, reload, crop, strip };
  await context.close();
}

if (want('shot-back')) {
  const { page, context } = await open(1440, 900);
  await page.locator('.step[data-piece="lens"]').click(); await page.waitForTimeout(400);
  await page.locator('.step[data-piece="camera"]').click(); await page.waitForTimeout(400);
  await page.locator('.shot-launch').click();
  await page.waitForSelector('#shot-dialog[open]');
  const urlOpen = page.url();
  await page.goBack(); await page.waitForTimeout(600);
  const r = { urlOpen, urlAfterBack: page.url(), dialogOpen: await page.evaluate(() => document.querySelector('#shot-dialog')?.open), piece: await page.evaluate(() => window.p2p.scenario && new URLSearchParams(location.search).get('piece')) };
  await page.goForward(); await page.waitForTimeout(800);
  r.afterForward = { url: page.url(), dialogOpen: await page.evaluate(() => document.querySelector('#shot-dialog')?.open) };
  await page.screenshot({ path: `${out}/${label}-shot-back.png` });
  results['shot-back'] = r;
  await context.close();
}

if (want('hint')) {
  results.hint = {};
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    const { page, context } = await open(w, h);
    const hint = await page.locator('.workspace-views > span').evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), r: Math.round(r.right), y: Math.round(r.y), b: Math.round(r.bottom), visible: getComputedStyle(el).display !== 'none' && r.width > 0, text: el.textContent, clipped: el.scrollWidth > el.clientWidth }; });
    const share = await rect(page, '#share-btn');
    results.hint[w] = { hint, share, overlapPx2: hint.visible ? overlap(hint, share) : 0 };
    if (w === 1440) await page.screenshot({ path: `${out}/${label}-1440-toolbar.png`, clip: { x: 0, y: 0, width: w, height: 160 } });
    await context.close();
  }
}

if (want('use-settings')) {
  const { page, context } = await open(1440, 900, '?piece=camera&lens=n500&fno=4&focus=10&iso=400');
  const startFno = await page.evaluate(() => window.p2p.scenario().fno);
  await page.locator('#workspace-photos').click();
  await page.waitForSelector('.rp-pick[data-id="fox-portrait"]');
  // a lens change is what triggers the notice: switch to the 50 first, then use a 500 mm photo
  await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 4 }));
  await page.locator('.rp-pick[data-id="fox-portrait"]').click();
  await page.locator('#rp-match').click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ toast: document.querySelector('#toast').hidden ? null : document.querySelector('#toast').textContent, slider: document.querySelector('#sc-fno-v').textContent, url: location.search, fno: window.p2p.scenario().fno }));
  r.startFno = startFno;
  if (r.toast) { r.toastRect = await rect(page, '#toast'); r.hudTitle = await rect(page, '#hud-title').catch(() => null); }
  await page.screenshot({ path: `${out}/${label}-use-settings.png` });
  // a plain lens switch that does limit the aperture: where its message sits
  await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 4 })); await page.waitForTimeout(800);
  await page.locator('#kit-lens').selectOption('n500'); await page.waitForTimeout(600);
  r.lensSwitch = await page.evaluate(() => { const t = document.querySelector('#toast'); const R = e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom) }; }; return { toast: t.hidden ? null : t.textContent, rect: R(t), title: R(document.querySelector('#hud-title')), sub: R(document.querySelector('#hud-sub')), slider: document.querySelector('#sc-fno-v').textContent }; });
  await page.screenshot({ path: `${out}/${label}-lens-switch.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });
  results['use-settings'] = r;
  await context.close();
}

if (want('tour')) {
  const { page, context } = await open(1440, 900);
  await page.locator('#learn-launch').click();
  for (let i = 0; i < 3; i++) { await page.locator('#journey-next').click(); await page.waitForTimeout(150); }
  const beforeReload = { url: page.url(), stop: await page.locator('#journey-stop').inputValue() };
  await page.reload();
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.waitForTimeout(1500);
  const afterReload = { url: page.url(), stop: await page.locator('#journey-stop').inputValue().catch(() => null), open: await page.locator('#journey').isVisible() };
  await page.goBack(); await page.waitForTimeout(500);
  const afterBack = { url: page.url(), open: await page.locator('#journey').isVisible() };
  results.tour = { beforeReload, afterReload, afterBack };
  await context.close();
}

if (want('arrows')) {
  const { page, context } = await open(1440, 900);
  const detail = () => page.evaluate(() => window.p2p.pieces.camera.detail());
  await page.locator('.pin').nth(0).click(); const p1 = await detail();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200); const p2 = await detail();
  await page.locator('#part-next').click(); const p3 = await detail();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200); const p4 = await detail();
  const focused = await page.evaluate(() => document.activeElement?.className + ' ' + (document.activeElement?.getAttribute('aria-label') ?? ''));
  // a slider still uses its own arrows
  await page.locator('#tab-controls').click();
  await page.locator('#sc-iso').focus(); const iso0 = await page.evaluate(() => window.p2p.scenario().iso);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  const iso1 = await page.evaluate(() => window.p2p.scenario().iso); const p5 = await detail();
  results.arrows = { afterPinClick: p1, arrowAfterPin: p2, afterNext: p3, arrowAfterNext: p4, focused, sliderIso: [iso0, iso1], partAfterSlider: p5 };
  await context.close();
}

if (want('crowding')) {
  const { page, context } = await open(1440, 900);
  const ids = await page.evaluate(() => window.p2p.pins().map(p => p.id));
  const door = ids.indexOf('sensor') >= 0 ? ids.indexOf('sensor') : 5;
  await page.locator('.pin').nth(door).click(); await page.waitForTimeout(800);
  const goInside = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter(b => /go inside/i.test(b.textContent) && b.checkVisibility()).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, cls: b.className, x: Math.round(r.x), y: Math.round(r.y) }; }));
  await page.screenshot({ path: `${out}/${label}-1440-go-inside.png` });
  // tour stop 1: pins against the hotspot labels
  await page.locator('#card-x').click().catch(() => {});
  await page.locator('#learn-launch').click(); await page.waitForTimeout(1200);
  const hits = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.hotspot, [class*="hotspot"], .ring-label, .dial-label')].filter(e => e.checkVisibility());
    const pins = [...document.querySelectorAll('.pin')].filter(e => e.checkVisibility());
    const R = e => e.getBoundingClientRect();
    const out = [];
    for (const l of labels) for (const p of pins) { const a = R(l), b = R(p.querySelector('.num') || p); const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 0 && oy > 0) out.push({ label: l.className + ':' + l.textContent.trim().slice(0, 20), pin: p.dataset.pinId }); }
    return { labels: labels.map(l => l.className + ':' + l.textContent.trim().slice(0, 24)), overlaps: out };
  });
  await page.screenshot({ path: `${out}/${label}-1440-tour-1.png` });
  results.crowding = { goInside, tour1: hits };
  await context.close();
}

if (want('pages')) {
  const { page, context } = await open(1440, 900);
  const r = {};
  for (const p of ['reference.html?page=story', 'models.html', 'lens-preview.html']) {
    await page.goto(`${url}${p}`); await page.waitForTimeout(1500);
    r[p] = await page.evaluate(() => ({ start: [...document.querySelectorAll('a, button')].filter(a => /start here/i.test(a.textContent)).map(a => a.getAttribute('href') ?? a.tagName), links: document.querySelectorAll('a[href]').length, robots: document.querySelector('meta[name=robots]')?.content ?? null, brand: document.querySelector('.brand, a.logo, header a')?.getAttribute('href') ?? null }));
  }
  await page.goto(`${url}index.html?piece=camera`); await page.waitForFunction(() => window.p2p?.pieces.camera);
  r.workspaceBrand = await page.evaluate(() => { const a = document.querySelector('#top a.brand, .brand, header a'); return a ? { tag: a.tagName, href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 30) } : null; });
  results.pages = r;
  await context.close();
}

if (want('tablet')) {
  const { page, context } = await open(768, 1024);
  const r = await page.evaluate(() => [...document.querySelectorAll('#compact-fire, .shot-launch')].map(b => { const s = getComputedStyle(b); return { id: b.id || b.className, h: Math.round(b.getBoundingClientRect().height), lines: Math.round(b.getBoundingClientRect().height / parseFloat(s.lineHeight || '16')), text: b.innerText.replace(/\n/g, ' / ') }; }));
  await page.screenshot({ path: `${out}/${label}-768-toolbar.png`, clip: { x: 0, y: 0, width: 768, height: 360 } });
  results.tablet = r;
  await context.close();
}

if (want('teach')) {
  results.teach = {};
  for (const [w, h, q, tour] of [[1440, 900, '?piece=camera&lens=n50&focus=1.5&iso=400', false], [1440, 900, '?piece=camera&lens=n50&focus=1.5&iso=400', true], [1280, 720, '?piece=camera', true], [390, 844, '?piece=camera', false]]) {
    const { page, context } = await open(w, h, q);
    if (tour) { await page.locator('#learn-launch').click(); }
    // the outside view shows the teaching marks
    await page.locator('#hud-switches [data-view="outside"]').click().catch(() => {});
    await page.waitForTimeout(2500);
    const hits = await page.evaluate(() => {
      const R = e => e.getBoundingClientRect();
      const marks = [...document.querySelectorAll('.rig-teach i, .rig-teach span')].filter(e => e.checkVisibility({ opacityProperty: true }) && R(e).width > 0);
      const pins = [...document.querySelectorAll('.pin')].filter(e => e.checkVisibility({ opacityProperty: true }));
      const out = [];
      for (const m of marks) for (const p of pins) { const a = R(m), b = R(p.querySelector('.num') || p); const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 0 && oy > 0) out.push({ mark: m.tagName + ':' + m.textContent.trim().slice(0, 20), pin: p.dataset.pinId, ox: Math.round(ox), oy: Math.round(oy) }); }
      return { marks: marks.length, pins: pins.length, overlaps: out };
    });
    await page.screenshot({ path: `${out}/${label}-${w}x${h}-teach${tour ? '-tour' : ''}.png` });
    results.teach[`${w}x${h}${tour ? '-tour' : ''}`] = hits;
    await context.close();
  }
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
