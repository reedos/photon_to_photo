// UX flow gate (score loop r3, 10/11/2026): the ways in, out and back that the round 3 reviewers walked.
//   - Expand model fills a desktop window, and Escape leaves it with the focus on its toggle
//   - entering Focus keeps the reader's Controls tab; the level prompt's link turns to Focus distance
//   - the guided tour resumes at the stop it was closed on, and closing it restores Outside, the tab and the level
//   - a cold load does not put the focus in the model; Escape on the model steps up from a deeper level
//   - a deeper level's part is in the URL (sel=) and survives a reload; Go inside opens the matching part
//   - a tour lesson takes the model's rows (no part navigation under it) and fills a phone's column
//   - a camera part's card is headed by the part's list name; Back to the opening marks Start here as current
// Score loop r4 adds: the tour frames stop 1 after an orbit; taps and hover pick parts on the model; marked-stop apertures are
//   not refusals; brand and Models links agree; the tour band is one row; phone buttons fit; the 1024 hint and the landscape bar show
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const Q = 'lens=n50&focus=1.5&iso=400';
async function open(width, height, query = `?piece=camera&${Q}`) {
  const phone = width < 760 || height < 500;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}${query}`);
  await page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(400);
  return { page, context, errors };
}
const params = page => new URL(page.url()).searchParams;
const tab = page => page.evaluate(() => document.querySelector('.studio-tabs [aria-selected="true"]')?.id);
const picked = page => page.evaluate(() => window.p2p.framing().selected);
const toLevel = async (page, piece) => { await page.locator(`#steps [data-piece="${piece}"]`).click(); await page.waitForTimeout(1500); };

try {
  {
    const { page, context, errors } = await open(1440, 900);
    // a cold load leaves the focus at the top of the page
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'gl', 'cold load focused the model');
    // Expand model
    await page.locator('#expand-model').click(); await page.waitForTimeout(500);
    const w = await page.locator('#view').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(w >= 1430, `expanded view is ${w} px wide in a 1440 px window`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.body.classList.contains('model-expanded')), false, 'Escape leaves Expand model');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'expand-model', 'focus returns to the toggle');
    console.log(`Expand model: ${w} px wide; Escape returns to the toggle`);
    // Focus keeps the Controls tab, and the prompt's link cues Focus distance
    await toLevel(page, 'cone');
    assert.equal(await tab(page), 'tab-controls', 'entering Focus switched the tab');
    await page.locator('#tab-explain').click();
    await page.locator('#level-why .why-link').click(); await page.waitForTimeout(200);
    assert.equal(await tab(page), 'tab-controls'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'sc-focus');
    console.log('Focus level: Controls kept; the prompt link opens Focus distance');
    // sel= and reload
    await page.locator('.pin[data-pin-id="bokeh-disk"]').click({ force: true }); await page.waitForTimeout(600);
    assert.equal(params(page).get('sel'), 'bokeh-disk');
    await page.reload(); await page.waitForFunction(() => window.p2p?.pieces.camera); await page.waitForTimeout(2500);
    assert.equal(await picked(page), 'bokeh-disk', 'the deeper level part survives a reload');
    // Escape steps out: the part, then the level
    await page.locator('#gl').focus();
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    assert.equal(await picked(page), null); assert.equal(params(page).get('piece'), 'cone');
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    assert.equal(params(page).get('piece'), 'camera', 'Escape on the model goes up to the camera');
    console.log('sel= survives a reload; Escape: part, then level');
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const [part, piece, pin] of [['iris', 'lens', 'iris'], ['glass', 'lens', 'front-element'], ['focusRing', 'cone', 'cone'], ['sensor', 'loupe', 'pixel']]) {
    const { page, context } = await open(1440, 900, `?piece=camera&${Q}&part=${part}`);
    const name = await page.locator('#card-t').textContent();
    const listed = await page.locator('#parts li.sel .pt').textContent();
    assert.equal(name, listed, `${part}: the card heading is the list name`);
    await page.locator('#card-go').click(); await page.waitForTimeout(2500);
    assert.equal(params(page).get('piece'), piece); assert.equal(await picked(page), pin, `Go inside from ${part}`);
    console.log(`Go inside: ${part} → ${piece} / ${pin}`);
    await context.close();
  }
  {
    const { page, context } = await open(1440, 900);
    await page.locator('#learn-launch').click(); await page.waitForTimeout(600);
    for (let i = 0; i < 4; i++) { await page.locator('#journey-next').click(); await page.waitForTimeout(600); }
    await page.locator('#journey-close').click(); await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.body.dataset.modelView), 'outside', 'closing the tour restores Outside');
    assert.equal(await tab(page), 'tab-controls', 'closing the tour restores the tab');
    await page.locator('#learn-launch').click(); await page.waitForTimeout(600);
    assert.equal(await page.locator('#journey-stop').inputValue(), '4', 'the tour resumes at stop 5');
    console.log('Tour: resumes at 5 / 10; closing restores Outside and Controls');
    await context.close();
  }
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const { page, context } = await open(w, h, `?piece=camera&${Q}&tour=8`);
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => ({ nav: document.querySelector('.part-nav').checkVisibility(), lesson: document.querySelector('#sensor-lesson').getBoundingClientRect().bottom }));
    assert.equal(m.nav, false, `${w}: the part navigation is hidden under a lesson`);
    assert.ok(m.lesson >= h - 2, `${w}: the lesson reaches the foot of the screen (${m.lesson})`);
    console.log(`${w}x${h}: tour lesson fills down to ${Math.round(m.lesson)} px`);
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${url}?start=1`);
    await page.locator('#opening-explore').click();
    await page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.goBack(); await page.waitForTimeout(800);
    const current = await page.evaluate(() => [...document.querySelectorAll('#topnav [aria-current="page"]')].map(e => e.textContent.trim()));
    assert.deepEqual(current, ['Start here'], 'Back to the opening marks Start here');
    console.log('Back to the opening: Start here is current');
    await context.close();
  }
  // ---- score loop r4 --------------------------------------------------------------------------------------------
  {
    // the tour frames its first stop even after the reader orbited, on Start and on Restart
    const start = async (orbit) => {
      const { page, context } = await open(1440, 900);
      if (orbit) { await page.mouse.move(600, 450); await page.mouse.down(); await page.mouse.move(420, 380, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400); }
      const before = await page.evaluate(() => window.p2p.framing().position);
      await page.locator('#learn-launch').click(); await page.waitForTimeout(1500);
      const first = await page.evaluate(() => window.p2p.framing().position);
      let restarted = null;
      if (orbit) {
        await page.mouse.move(600, 450); await page.mouse.down(); await page.mouse.move(700, 500, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
        await page.locator('#journey-restart').click(); await page.waitForTimeout(1500);
        restarted = await page.evaluate(() => window.p2p.framing().position);
      }
      await context.close();
      return { before, first, restarted };
    };
    const plain = await start(false), orbited = await start(true);
    const near = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    assert.ok(near(orbited.before, plain.before) > 50, 'the orbit moved the camera');
    assert.ok(near(orbited.first, plain.first) < 6, `Start after an orbit frames stop 1 (${orbited.first.map(Math.round)} vs ${plain.first.map(Math.round)})`);
    assert.ok(near(orbited.restarted, plain.first) < 6, `Restart after an orbit frames stop 1 (${orbited.restarted.map(Math.round)})`);
    console.log('Tour: stop 1 is framed after an orbit, on Start and on Restart');
  }
  {
    // tapping the model picks a part; hovering one shows a pointer; a drag orbits and picks nothing
    const { page, context, errors } = await open(1440, 900);
    const box = await page.locator('#gl').boundingBox();
    const parts = new Set(); let pointers = 0, at = null;
    for (let gy = 1; gy <= 9; gy++) for (let gx = 1; gx <= 11; gx++) {
      const x = box.x + box.width * gx / 12, y = box.y + box.height * gy / 10;
      await page.mouse.move(x, y); await page.waitForTimeout(110);
      if (await page.evaluate(() => getComputedStyle(document.getElementById('gl')).cursor) === 'pointer') pointers++;
      await page.mouse.click(x, y); await page.waitForTimeout(100);
      const sel = await picked(page);
      if (sel) { parts.add(sel); at ??= [x, y, sel]; await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
    }
    assert.ok(parts.size >= 4, `taps on the model pick several parts (${[...parts]})`);
    assert.ok(pointers >= 10, `the pointer is a hand over the model's parts (${pointers})`);
    await page.mouse.move(box.x + 6, box.y + box.height - 6); await page.mouse.click(box.x + 6, box.y + box.height - 6); await page.waitForTimeout(150);
    assert.equal(await picked(page), null, 'a tap on empty space picks nothing');
    await page.mouse.move(at[0], at[1]); await page.mouse.down(); await page.mouse.move(at[0] + 60, at[1] + 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    assert.equal(await picked(page), null, 'a drag orbits and picks nothing');
    // the part list follows a tap on the model
    await page.mouse.click(at[0], at[1]); await page.waitForTimeout(500);
    assert.equal(await page.locator('#parts li.sel').count(), 1, 'the part list shows the tapped part');
    console.log(`Model picking: ${[...parts]}; ${pointers} hand-cursor samples`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // a photograph's own recorded stop is a match on its lens, not a refusal; an unreachable one still says so
    const { page, context } = await open(1440, 900);
    const read = () => page.evaluate(() => { const t = document.querySelector('#toast'); const n = document.querySelector('#sc-fno-note'); return { toast: t.hidden ? '' : t.textContent, slider: document.querySelector('#sc-fno-v').textContent, note: n.hidden ? '' : n.textContent }; });
    await page.evaluate(() => window.p2p.set({ lens: 'n500', fno: 5.6 })); await page.waitForTimeout(600);
    let r = await read();
    assert.equal(r.toast, '', `f/5.6 on the 500 mm f/5.6 gives no refusal: ${r.toast}`);
    assert.match(r.slider, /f\/5\.6.*model f\/5\.75/); assert.match(r.note, /widest stop/);
    await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 4 })); await page.waitForTimeout(800);
    await page.evaluate(() => window.p2p.set({ lens: 'n500', fno: 2.8 })); await page.waitForTimeout(500);
    r = await read();
    assert.match(r.toast, /f\/2\.8 is wider than the 500 mm lens opens/);
    await page.evaluate(() => window.p2p.set({ lens: 'n50', fno: 1.8 })); await page.waitForTimeout(800);
    r = await read(); assert.match(r.slider, /f\/1\.8.*model f\/1\.86/);
    console.log('Aperture: marked-stop requests are silent and the readout carries the modeled value; unreachable ones say so');
    await context.close();
  }
  {
    // brand, Models link, titles
    const { page, context } = await open(1440, 900, `?piece=camera&lens=z800`);
    assert.equal(await page.locator('#topbar .brand').getAttribute('href'), './index.html?start=1');
    assert.equal(await page.locator('#topnav a', { hasText: 'Models' }).getAttribute('href'), './models.html?body=mirrorless&lens=z800&view=outside');
    await page.locator('#topnav a', { hasText: 'Models' }).click(); await page.waitForTimeout(1200);
    assert.ok(page.url().includes('body=mirrorless') && page.url().includes('lens=z800'), "Models opens the visitor's camera");
    assert.equal(await page.title(), 'Models · Photon to Photo');
    assert.equal(await page.locator('#sel-t').textContent(), 'Select a part');
    assert.equal(await page.locator('.brand').getAttribute('href'), './index.html?start=1');
    await page.goto(`${url}reference.html?page=story`); await page.waitForTimeout(600);
    assert.equal(await page.locator('.brand').getAttribute('href'), './index.html?start=1');
    assert.match(await page.locator('#topnav a', { hasText: 'Models' }).getAttribute('href'), /lens=z800/);
    const startColor = await page.locator('#topnav a', { hasText: 'Start here' }).evaluate(e => getComputedStyle(e).color);
    const camColor = await page.locator('#topnav a', { hasText: 'The camera' }).evaluate(e => getComputedStyle(e).color);
    assert.equal(startColor, camColor, 'Start here is an ordinary link');
    console.log('Brand and Models links are the same on every page; Models carries the camera over');
    await context.close();
  }
  {
    // the tour band: one row of controls, a real close button, no dial labels, copy that reads
    const { page, context } = await open(1440, 900);
    await page.locator('#learn-launch').click(); await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#journey nav button')].filter(b => b.getClientRects().length);
      const close = document.querySelector('#journey-close').getBoundingClientRect();
      return { ys: [...new Set(btns.map(b => Math.round(b.getBoundingClientRect().y)))], closeW: close.width, band: document.querySelector('#journey').getBoundingClientRect().height, teach: [...document.querySelectorAll('.rig-teach')].some(e => e.checkVisibility()) };
    });
    assert.equal(m.ys.length, 1, `the tour controls make one row (${m.ys})`);
    assert.ok(m.closeW >= 36, `the close button is ${m.closeW} px wide`);
    assert.ok(m.band <= 100, `the band is ${m.band} px tall`);
    assert.equal(m.teach, false, 'the dial labels step aside during the tour');
    await page.locator('#journey-stop').selectOption('9'); await page.waitForTimeout(500);
    assert.match(await page.locator('#journey-text').textContent(), /^Press Play the shot to follow/);
    console.log(`Tour band: one row, band ${m.band} px, close ${m.closeW} px`);
    await context.close();
  }
  {
    // phones: Read explanation fits its box; the shot's chapter tabs have room
    const { page, context } = await open(390, 844, '?view=photos&photo=flycatcher');
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => { const b = document.querySelector('.rp-read-explanation'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
    assert.ok(m.sw <= m.cw, `Read explanation fits: ${m.sw} in ${m.cw}`);
    await context.close();
    const shot = await open(390, 844, '?piece=camera&lens=n50');
    await shot.page.evaluate(() => document.querySelector('.shot-launch')?.click()); await shot.page.waitForTimeout(1500);
    const tabs = await shot.page.evaluate(() => [...document.querySelectorAll('.shot-chapters button')].map(b => { const r = document.createRange(); r.selectNodeContents(b); const t = r.getBoundingClientRect(), bb = b.getBoundingClientRect(); return { text: b.textContent, slack: Math.round(bb.width - t.width) }; }));
    for (const t of tabs) assert.ok(t.slack >= 12, `chapter tab "${t.text}" has ${t.slack} px of side room`);
    console.log('Phone: Read explanation fits; chapter tabs have side room (' + tabs.map(t => t.slack).join(', ') + ')');
    await shot.context.close();
  }
  {
    // 1024: the first-look hint is whole; a landscape phone shows the perspective bar
    const { page, context } = await open(1024, 768);
    const h = await page.evaluate(() => { const e = document.querySelector('.orbit-hint'); const r = e.getBoundingClientRect(); return { clipped: e.scrollWidth > e.clientWidth + 1, right: r.right, bottom: r.bottom }; });
    assert.equal(h.clipped, false, 'the first-look hint is not clipped at 1024'); assert.ok(h.right <= 1024 && h.bottom <= 768);
    await context.close();
    const ls = await open(844, 390, '?piece=camera&lens=n50'); await ls.page.waitForTimeout(1500);
    const e = await ls.page.evaluate(() => { const r = document.querySelector('#model-experiments').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
    assert.ok(e.top >= 0 && e.bottom <= e.h + 1, `Focal length & perspective is in view on a landscape phone (${e.top}-${e.bottom} of ${e.h})`);
    console.log('1024 hint whole; landscape phone shows the perspective bar');
    await ls.context.close();
  }
  // ---- score loop r5 -----------------------------------------------------------------------------------------------------
  {
    // the first-run coach ring reaches the control it marks: a drag from its center turns the dial (and does not orbit),
    // a click fires; its tooltip says so
    const { page, context } = await open(1440, 900);
    await page.waitForFunction(() => [...document.querySelectorAll('.rig-teach.pair')].some(e => e.style.display !== 'none'), null, { timeout: 20000 });
    const ring = await page.evaluate(() => { const e = [...document.querySelectorAll('.rig-teach.pair')].find(x => x.style.display !== 'none'); const b = e.querySelector('i').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: e.querySelector('span').textContent }; });
    assert.match(ring.text, /Click: fire/);
    assert.match(ring.text, /Drag: aperture/);
    await page.mouse.move(ring.x, ring.y); await page.waitForTimeout(300);
    assert.match(await page.locator('.rig-tip').first().textContent(), /Click: fire · Drag: aperture/);
    const f0 = await page.evaluate(() => window.p2p.scenario().fno), pose0 = await page.evaluate(() => window.p2p.framing().position);
    await page.mouse.down(); await page.mouse.move(ring.x + 40, ring.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
    const f1 = await page.evaluate(() => window.p2p.scenario().fno), pose1 = await page.evaluate(() => window.p2p.framing().position);
    assert.notEqual(f1, f0, 'a drag from the ring center turned the front dial');
    assert.ok(Math.hypot(...pose1.map((v, i) => v - pose0[i])) < 1, 'and did not orbit the camera');
    const status0 = await page.evaluate(() => window.p2p.pieces.camera.exposure().status);
    await page.mouse.click(ring.x, ring.y); await page.waitForTimeout(600);
    assert.notEqual(await page.evaluate(() => window.p2p.pieces.camera.exposure().status), status0, 'a click at the ring center fired the shutter');
    console.log(`Coach ring: drag f/${f0} -> f/${f1} with no orbit; click fires`);
    await context.close();
  }
  {
    // Reset settings, the focus notice on a lens switch, Controls on a lens change, from= instead of part=, the start link
    const { page, context } = await open(1440, 900, '?piece=camera&lens=n50');
    await page.evaluate(() => window.p2p.set({ fno: 8, iso: 800, shutter: 1 / 1000, focusM: 1.5 })); await page.waitForTimeout(300);
    await page.locator('#sc-reset').click(); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => { const s = window.p2p.scenario(); return [s.fno, s.iso, s.focusM]; }), [4, 100, 3], 'Reset settings restores the defaults');
    assert.equal(await page.locator('#sc-reset').isDisabled(), true, 'and is quiet while they are in place');
    await page.locator('#tab-explain').click();
    await page.evaluate(() => document.querySelector('#sc-lens [data-lens="n500"]').click()); await page.waitForTimeout(500);
    assert.match(await page.locator('#toast').textContent(), /Focus set to 15\.0 m for this lens/);
    assert.equal(await page.locator('#tab-controls').getAttribute('aria-selected'), 'true', 'a lens change returns the panel to Controls');
    await page.locator('.start-entry').click();
    assert.match(await page.locator('#start-here [data-start="shot"] b').textContent(), /Play the shot/);
    await context.close();
    const o = await open(1440, 900, '?piece=camera&lens=n50&part=iris');
    await toLevel(o.page, 'lens');
    assert.equal(params(o.page).get('from'), 'iris'); assert.equal(params(o.page).get('part'), null, 'a level with nothing selected writes no part=');
    await o.context.close();
    const f = await open(1024, 768, '?piece=cone&lens=n50');
    assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.orbit-hint')).display), 'none', 'the first-look hint stays off the Focus level at 1024');
    await f.context.close();
    console.log('Reset settings, focus notice, Controls on lens change, from=, start link, 1024 Focus hint');
  }
  {
    // Play the shot keeps its controls where they are across the six chapters, and a phone's chips carry names
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { page, context } = await open(w, h, '?piece=camera&lens=n50');
      await page.evaluate(() => document.querySelector('.shot-launch')?.click());
      await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
      const tops = [];
      for (let i = 0; i < 6; i++) { await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(300); tops.push(await page.evaluate(() => Math.round(document.querySelector('.shot-chapters').getBoundingClientRect().top))); }
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, `chapter chips stay put at ${w}: ${tops}`);
      if (w < 440) {
        const names = await page.evaluate(() => [...document.querySelectorAll('.shot-chapters .shot-chip-short')].map(e => ({ t: e.textContent, ok: getComputedStyle(e).display !== 'none' && e.scrollWidth <= e.parentElement.clientWidth })));
        assert.ok(names.length === 6 && names.every(n => n.ok), `phone chips show their names: ${JSON.stringify(names)}`);
      }
      await context.close();
    }
    console.log('Play the shot: chips stay put; phone chips named');
  }
  {
    // Models: the picked part is shown (pinned card, name on the model), the list row follows a pick on the model, a phone keeps the model in view
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const phone = w < 760;
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
      const page = await context.newPage();
      await page.goto(`${url}models.html?body=dslr&lens=n50`);
      await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
      const b = page.locator('.parts button[data-part="prism"]'); await b.scrollIntoViewIfNeeded(); await b.click(); await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.height > 0; };
        return { card: vis(document.querySelector('#sel')), view: document.querySelector('#view').getBoundingClientRect().height > 200 && vis(document.querySelector('#view')), label: !document.querySelector('#mv-label').hidden && document.querySelector('#mv-label span').textContent.length > 0 };
      });
      assert.ok(m.card && m.view && m.label, `Models ${w}: card, model and name on the part stay in view after a list pick (${JSON.stringify(m)})`);
      await page.locator('#clear').click(); await page.waitForTimeout(300);
      // the prism pick opened the cutaway; the centre of the cutaway is a gap in the model, so go back to the outside shell before picking on it
      await page.locator('[data-view="outside"]').click(); await page.waitForTimeout(1200);
      const box = await page.locator('#gl').boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45); await page.waitForTimeout(900);
      const row = await page.evaluate(() => { const r = document.querySelector('.parts button[aria-pressed="true"]')?.getBoundingClientRect(); return r ? r.top >= 0 && r.bottom <= innerHeight : null; });
      assert.equal(row, true, `Models ${w}: the row for a part picked on the model is scrolled into view`);
      await context.close();
    }
    console.log('Models: pinned card, labeled part, row follows a pick on the model');
  }
  console.log('PASS test-ux-flow');
} finally {
  await browser.close();
  await server?.close();
}
