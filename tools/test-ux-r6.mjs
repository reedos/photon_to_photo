// Score loop r6 (UX, navigation and interaction): one gate for what the round fixed.
//   1. Models: the pinned part card is not under the pinned model (elementFromPoint at its title and text) at 390x844 and 320x568,
//      and every part of the DSLR and mirrorless lists has a sentence.
//   2. Camera pins sit on or beside the visible pixels of their part, at four lenses, Outside and Cutaway.
//   3. Phones: the level's reason folds behind Why? and the view keeps at least 250 px on a 360x740 screen; Parts says it is in view.
//   4. The model: the tooltip clears the pins, a click on the shell is not a part, a click on nothing and Esc clear the pick, give the
//      view back and return the Controls tab.
//   5. The shot clock says chapter and seconds left; the address drops tour and shot values that name nothing; Share copies.
//   6. Real photos: the clamped note ends in an ellipsis; a photo whose lens is not modeled says why and offers the 500 mm.
//   7. Optics at 1024x768 fits its lens and keeps every pin; the aperture note is a full-width row; the Camera tab restores the part.
//   P2P_URL=http://127.0.0.1:47804/ node tools/test-ux-r6.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/ux-r6', { recursive: true });
const report = [];
const errors = [];
async function open(query, width, height, extra = {}) {
  const phone = width < 760;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, ...extra });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + query);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
  await page.evaluate(() => window.p2p.settle?.());
  await page.waitForTimeout(1500);
  return { page, context };
}
try {
  // 1. Models
  for (const [w, h] of [[390, 844], [320, 568]]) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}models.html?body=dslr&lens=n50`);
    await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    for (const part of ['releaseModeDial', 'prism', 'contacts']) {
      const row = page.locator(`.parts button[data-part="${part}"]`);
      await row.scrollIntoViewIfNeeded(); await row.click(); await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const onCard = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); const e = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + Math.min(r.height / 2, 8)); return !!e && !!e.closest('#sel'); };
        const view = document.querySelector('#view').getBoundingClientRect(), card = document.querySelector('#sel').getBoundingClientRect();
        return { title: onCard('#sel-t'), text: onCard('#sel-d'), gap: Math.round(card.top - view.bottom), sentence: document.querySelector('#sel-d').textContent.trim().length };
      });
      assert.ok(m.title && m.text, `models ${w}x${h} ${part}: the card's title and text are under the model (${JSON.stringify(m)})`);
      assert.ok(m.gap >= -1, `models ${w}x${h} ${part}: the card starts below the viewer (${m.gap})`);
      assert.ok(m.sentence > 20, `models ${w}x${h} ${part}: the card has a sentence`);
    }
    report.push(`models ${w}x${h}: pinned card clear of the model for three picks`);
    await context.close();
  }
  for (const q of ['body=dslr&lens=n50', 'body=mirrorless&lens=m50', 'body=dslr&lens=n500fl']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${url}models.html?${q}`);
    await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
    const empty = await page.evaluate(() => [...document.querySelectorAll('.parts button')].filter((b) => { b.click(); return !document.getElementById('sel-d').textContent.trim(); }).map((b) => b.dataset.part));
    assert.deepEqual(empty, [], `models ${q}: parts whose card has no sentence`);
    report.push(`models ${q}: every part's card has a sentence`);
    await context.close();
  }

  // 2. Camera pins on their parts
  const BODY = ['shellClosed', 'frontRubber', 'grip', 'rearScreen', 'portDoor', 'strapLug', 'hotShoe', 'topLcd'];
  const PARTS = {
    lens: ['barrel'], focusRing: ['focusRing', 'distanceScale', 'controlRing'], iris: ['irisHousing', 'irisBlades'], glass: ['glass'], mount: ['mount', 'lensMount'],
    sensor: ['pixelArray', 'sensorPackage'], shutter: ['shutter', 'shutterCurtainFront', 'shutterCurtainRear', 'ibisPlate'],
    viewfinder: ['mirror', 'subMirror', 'focusingScreen', 'prism', 'evfPanel', 'evfHousing', 'prismHousing', 'eyecup', 'evfEyecup', 'evfPanelCarrier', 'eyepieceOptics'],
  };
  const HOST = { iris: ['barrel'], glass: ['filterGlass', 'barrel', 'hoodBayonet'], sensor: BODY, shutter: BODY, viewfinder: BODY };
  for (const lens of ['s35', 'n50', 'n500', 'n500fl']) {
    for (const view of ['outside', 'cutaway']) {
      const { page, context } = await open(`?piece=camera&lens=${lens}&focus=15`, 1440, 900);
      if (view === 'cutaway') { await page.locator('#hud-switches [data-view="cutaway"]').click(); await page.waitForTimeout(2800); } else await page.waitForTimeout(1500);
      const bad = await page.evaluate(({ PARTS, HOST, outside }) => {
        const cam = window.p2p.pieces.camera;
        const comp = new Map(); for (const m of cam.visibleMeshes()) comp.set(m.name, m.component || m.name);
        const nearest = (ax, ay, parts) => {
          let best = Infinity;
          for (let dy = -60; dy <= 60; dy += 6) for (let dx = -60; dx <= 60; dx += 6) {
            const d = Math.hypot(dx, dy); if (d >= best) continue;
            const hit = cam.pick(ax + dx, ay + dy)[0]; if (!hit) continue;
            const c = comp.get(hit.name) ?? hit.name;
            if (parts.includes(c) || parts.some((p) => hit.name.startsWith(p) || (p === 'glass' && /^element\d+/.test(c)))) best = d;
          }
          return best;
        };
        return window.p2p.pins().map((p) => ({ id: p.id, gap: nearest(p.anchorX, p.anchorY, [...(PARTS[p.id] ?? [p.id]), ...(outside ? HOST[p.id] ?? [] : [])]) })).filter((p) => p.gap > 20).map((p) => `${p.id}:${p.gap}`);
      }, { PARTS, HOST, outside: view === 'outside' });
      assert.deepEqual(bad, [], `${lens} ${view}: pins more than 20 px from their part`);
      await context.close();
    }
  }
  report.push('camera pins: all eight within 20 px of their part, four lenses, Outside and Cutaway');

  // 3. Phones
  {
    const heights = {};
    for (const level of ['lens', 'cone', 'loupe']) {
      const { page, context } = await open(`?piece=${level}&lens=n50`, 360, 740);
      const m = await page.evaluate(() => ({ view: Math.round(document.querySelector('#gl').getBoundingClientRect().height), why: document.querySelector('#level-why').checkVisibility(), btn: document.querySelector('.inspection-why')?.getAttribute('aria-expanded') }));
      heights[level] = m.view;
      assert.ok(m.view >= 250, `360x740 ${level}: the model view is ${m.view} px (was 195-213)`);
      assert.equal(m.why, false, `360x740 ${level}: the reason is folded`);
      assert.equal(m.btn, 'false');
      await page.locator('.inspection-why').click(); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.querySelector('#level-why').checkVisibility()), true, `${level}: Why? shows the reason`);
      assert.equal(await page.locator('.inspection-why').getAttribute('aria-expanded'), 'true');
      if (level === 'loupe') {
        const pins = await page.evaluate(() => [...document.querySelectorAll('#pins .pin')].filter((p) => p.style.display === 'none').length);
        assert.ok(pins <= 1, `360x740 loupe: ${pins} hidden pins`);
      }
      await context.close();
    }
    const { page, context } = await open('?piece=camera&lens=n50', 390, 844);
    assert.equal(await page.locator('#tab-explain').getAttribute('aria-current'), 'true', 'phone Parts is the pane in view');
    assert.equal(await page.locator('#tab-controls').getAttribute('aria-current'), null);
    await context.close();
    report.push(`phones: 360x740 view heights ${JSON.stringify(heights)}, Why? toggle, Parts aria-current`);
  }

  // 4. Hover, clicks, Esc
  {
    const { page, context } = await open('?piece=camera&lens=n50&focus=1.5', 1440, 900);
    const tipVsPins = async () => page.evaluate(() => {
      const tip = document.querySelector('.rig-tip'); if (!tip || tip.hidden) return null;
      const t = tip.getBoundingClientRect();
      return { text: tip.textContent, over: [...document.querySelectorAll('.pin .num, .pin .lbl')].filter((e) => e.offsetWidth > 0).filter((e) => { const b = e.getBoundingClientRect(); return b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top; }).length };
    });
    for (const [x, y] of [[745, 620], [700, 500], [640, 560], [560, 520]]) {
      await page.mouse.move(x - 30, y - 30); await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(280);
      const t = await tipVsPins();
      if (t) assert.equal(t.over, 0, `hover ${x},${y}: the tooltip "${t.text}" covers a pin`);
    }
    await context.close();
    for (const [x, y] of [[745, 620], [700, 500], [690, 700]]) {
      const c = await open('?piece=camera&lens=n50&focus=1.5', 1440, 900);
      await c.page.mouse.click(x, y); await c.page.waitForTimeout(1500);
      const s = await c.page.evaluate(() => ({ part: new URL(location.href).searchParams.get('part'), cut: document.querySelector('#hud-switches [data-view="cutaway"]')?.getAttribute('aria-pressed') }));
      assert.equal(s.part, null, `a click on the body at ${x},${y} picks no part`);
      assert.equal(s.cut, 'false', `a click on the body at ${x},${y} leaves the view alone`);
      await c.context.close();
    }
    const c = await open('?piece=camera&lens=n50&focus=1.5&part=glass', 1440, 900);
    assert.equal(await c.page.evaluate(() => new URL(location.href).searchParams.get('part')), 'glass');
    await c.page.mouse.click(1050, 320); await c.page.waitForTimeout(1400);
    assert.equal(await c.page.evaluate(() => new URL(location.href).searchParams.get('part')), null, 'a click on empty space clears the pick');
    assert.equal(await c.page.locator('.studio-tabs [role=tab][aria-selected="true"]').textContent(), 'Controls');
    assert.equal(await c.page.locator('#hud-switches [data-view="outside"]').getAttribute('aria-pressed'), 'true', 'the view the pick left comes back');
    await c.context.close();
    const e = await open('?piece=camera&lens=n50&focus=1.5', 1440, 900);
    await e.page.locator('.pin[data-pin-id="sensor"]').click(); await e.page.waitForTimeout(1500);
    assert.equal(await e.page.locator('#hud-switches [data-view="cutaway"]').getAttribute('aria-pressed'), 'true');
    await e.page.keyboard.press('Escape'); await e.page.waitForTimeout(1500);
    assert.equal(await e.page.locator('#hud-switches [data-view="outside"]').getAttribute('aria-pressed'), 'true', 'Esc gives the Outside view back');
    assert.equal(await e.page.locator('.studio-tabs [role=tab][aria-selected="true"]').textContent(), 'Controls', 'Esc returns to Controls');
    assert.equal(await e.page.evaluate(() => !!document.querySelector('#scenario input[type=range]')?.checkVisibility()), true, 'the sliders are back');
    await e.context.close();
    report.push('model: tooltip clear of pins, shell click is no part, blank click and Esc clear the pick, give back the view and Controls');
  }

  // 5. Shot clock, address, Share
  {
    const { page, context } = await open('?lens=n50&part=sensor&lux=7300&cct=4200&tour=77&shot=none', 1440, 900);
    const search = await page.evaluate(() => location.search);
    assert.ok(!/shot=/.test(search), `shot=none is gone from the address (${search})`);
    assert.ok(/tour=10(&|$)/.test(search), `tour=77 became the last stop (${search})`);
    await page.evaluate(() => document.querySelector('#share-btn').click());
    await page.waitForTimeout(500);
    const toast = await page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : null; });
    assert.ok(toast && toast.length < 60 && !/http/.test(toast), `the Share toast is short (${toast})`);
    await context.close();
    const shot = await open('?lens=n50&part=sensor&lux=7300&cct=4200', 1440, 900);
    await shot.page.evaluate(() => window.p2p.pieces.camera.ready());
    await shot.page.locator('.shot-launch').click();
    await shot.page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
    const clock = await shot.page.locator('#shot-clock').textContent();
    assert.match(clock, /Chapter \d of 6 · \d+ s left/, 'the clock says chapter and seconds left');
    await shot.context.close();
    report.push('address and Share: clean, short; shot clock: ' + clock);
  }

  // 6. Real photos
  {
    const { page, context } = await open('?view=photos&photo=bears', 390, 844);
    const m = await page.evaluate(() => {
      const note = document.querySelector('#rp-card .rp-note'); const why = document.querySelector('#rp-match-why'); const alt = document.querySelector('#rp-try-alt');
      return { why: why && !why.hidden ? why.textContent : null, alt: alt && !alt.hidden ? alt.textContent : null, sentence: document.querySelector('#rp-card .rp-side > .note')?.textContent, lc: getComputedStyle(note).webkitLineClamp };
    });
    assert.ok(m.why && /not in the simulator/.test(m.why), 'the unmodeled lens says why, in view');
    assert.ok(m.alt && /500 mm/.test(m.alt), `an alternative is offered (${m.alt})`);
    assert.ok(!/Set the camera to this photo/.test(m.sentence), 'the sentence above no longer promises a match');
    assert.notEqual(m.lc, 'none', 'the note is clamped with an ellipsis');
    await context.close();
    report.push('real photos: reason, alternative and clamped note');
  }

  // 7. Optics at 1024x768, aperture note, Camera tab
  {
    const { page, context } = await open('?piece=lens&lens=n50', 1024, 768);
    const m = await page.evaluate(() => ({ pins: [...document.querySelectorAll('#pins .pin')].map((p) => [p.dataset.pinId, p.style.display, p.classList.contains('dim')]), view: [document.querySelector('#view').clientWidth, document.querySelector('#view').clientHeight], p: window.p2p.pins() }));
    assert.equal(m.pins.filter((p) => p[1] === 'none').length, 0, 'every Optics pin is in view at 1024x768');
    const front = m.p.find((p) => p.id === 'front-element');
    assert.ok(front.x > 60, `the lens front is not cropped (pin at ${front.x})`);
    await page.goto(`${url}?piece=lens&lens=n50&sel=iris`); await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off')); await page.waitForTimeout(1500);
    const dim = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#pins .pin.dim')].filter((p) => p.style.display !== 'none').map((p) => Number(getComputedStyle(p).opacity))));
    assert.ok(dim >= 0.5, `dimmed pins stay readable (${dim})`);
    await context.close();
    const a = await open('?piece=camera&lens=n500fl&focus=15', 1440, 900);
    const g = await a.page.evaluate(() => { const note = document.querySelector('#sc-fno-note'); const groups = [...document.querySelectorAll('#scenario .sc-group')].filter((x) => x.checkVisibility()).slice(0, 2); return { inGroup: !!note.closest('.sc-group'), hs: groups.map((x) => Math.round(x.getBoundingClientRect().height)), shown: !note.hidden }; });
    assert.equal(g.shown, true); assert.equal(g.inGroup, false, 'the cap note is outside the Aperture group'); assert.equal(g.hs[0], g.hs[1], 'Aperture and Focus are the same height');
    await a.context.close();
    const c = await open('?piece=lens&lens=n50&from=iris&sel=iris', 1440, 900);
    await c.page.locator('#steps [data-piece="camera"]').click(); await c.page.waitForTimeout(1800);
    assert.equal(await c.page.evaluate(() => new URL(location.href).searchParams.get('part')), 'iris', 'the Camera tab restores the part the crumb would');
    await c.context.close();
    report.push('optics 1024x768, aperture note row, Camera tab');
  }
  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS test-ux-r6');
  for (const line of report) console.log('  ' + line);
} finally {
  await browser.close();
  await server?.close?.();
}
