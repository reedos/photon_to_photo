import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startPreview } from './preview.mjs';
import { decodePng } from './accuracy/png.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/phone-navigation';
const backend = process.env.P2P_BACKEND || 'webgpu';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { backend, checks: [], geometry: [], errors: [] };
async function requireGeometry(page, name) {
  const clip = await page.locator('#gl').boundingBox();
  const image = decodePng(await page.screenshot({ clip,
    style: '#view > :not(#gl) { opacity:0!important; transition:none!important; animation:none!important; }' }));
  const bins = new Map(); let total = 0, bright = 0;
  for (let y = Math.floor(image.height * .2); y < image.height * .8; y += 2) {
    for (let x = Math.floor(image.width * .2); x < image.width * .8; x += 2) {
      const i = (y * image.width + x) * image.channels;
      const [r,g,b] = image.data.subarray(i, i + 3);
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1); total++;
      if (Math.max(r,g,b) > 65) bright++;
    }
  }
  const varied = total - Math.max(...bins.values());
  assert.ok(varied > 100 && bright > 20, `${name}: phone main-view geometry missing (${varied} varied, ${bright} bright)`);
  report.geometry.push({ name, varied, bright });
}
// Every pin's number must be on screen and on top (review loop 10/11/2026: the deep levels' insets and cards hid
// half the pins on phones). The loupe's stack pins appear once its controlled pixel sample is ready.
async function requirePins(page, name, level) {
  if (level === 'loupe') await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && document.querySelector('.lv-read.lv-status')?.hidden !== false, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const pins = await page.evaluate(() => [...document.querySelectorAll('#pins .pin')].map(pin => {
    const n = pin.querySelector('.num').getBoundingClientRect();
    const top = n.width ? document.elementFromPoint(n.x + n.width / 2, n.y + n.height / 2) : null;
    return { id: pin.dataset.pinId, ok: !!top && pin.contains(top) };
  }));
  const hidden = pins.filter(pin => !pin.ok).map(pin => pin.id);
  assert.ok(pins.length > 0, `${name}: no pins`);
  assert.deepEqual(hidden, [], `${name}: pins hidden or covered: ${hidden.join(', ')}`);
  report.checks.push(`${name}: all ${pins.length} pins on screen and clickable`);
}
const waitLevel = page => page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving);
// Review loop r1 (10/11/2026). Every visible control is on screen or inside something a finger can scroll (the page or
// an overflow:auto box): landscape phones used to clip the playback, experiment and navigation rows inside
// overflow:hidden boxes (WCAG 1.3.4, 1.4.10). No visible text under design/LOOK.md's 10.5 px floor. The view keeps
// 220 px, and the lens level keeps every pin (a pin under the inset counts as hidden).
async function layoutChecks(page, name, level) {
  const r = await page.evaluate(() => {
    const vis = (el) => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none') return false; const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return false; for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return false; return true; };
    const W = innerWidth, H = innerHeight;
    const docScroll = document.documentElement.scrollHeight > H + 1 && getComputedStyle(document.body).overflowY !== 'hidden' && getComputedStyle(document.documentElement).overflowY !== 'hidden';
    const unreachable = [];
    for (const el of document.querySelectorAll('button, input, select, a[href], [role=tab]')) {
      if (!vis(el) || el.closest('dialog:not([open]), #phone-settings, #veil, #photo-opening, .pins, .sr-only, .skip-link')) continue;
      const b = el.getBoundingClientRect();
      let l = Math.max(b.left, 0), t = Math.max(b.top, 0), rr = Math.min(b.right, W), bb = Math.min(b.bottom, H), scrolls = docScroll;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        if ((/auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) || (/auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1)) scrolls = true;
        const ab = a.getBoundingClientRect();
        l = Math.max(l, ab.left); t = Math.max(t, ab.top); rr = Math.min(rr, ab.right); bb = Math.min(bb, ab.bottom);
      }
      if (Math.max(0, rr - l) * Math.max(0, bb - t) < b.width * b.height * 0.5 && !scrolls) unreachable.push(el.id || el.textContent.trim().slice(0, 30));
    }
    const small = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || !vis(el) || el.closest('#photo-opening, #veil, dialog:not([open]), [aria-hidden="true"]')) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size > 0 && size < 10.5) small.add(`${size}px ${n.textContent.trim().slice(0, 30)}`);
    }
    const view = document.querySelector('#view').getBoundingClientRect();
    const pins = [...document.querySelectorAll('#pins .pin')];
    const shown = pins.filter((p) => {
      if (p.style.display === 'none') return false;
      const b = p.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (y < 0 || y > H) return false;
      // the inset is drawn into the canvas and its frame lets clicks through, so test its box as well
      if ([...document.querySelectorAll('.inset-frame')].some((f) => { const q = f.getBoundingClientRect(); return q.width && x > q.left && x < q.right && y > q.top && y < q.bottom; })) return false;
      const top = document.elementFromPoint(x, y);
      return !!top && (top === p || p.contains(top));
    }).length;
    return { unreachable, small: [...small], viewW: view.width, viewH: view.height, pins: pins.length, shown };
  });
  assert.deepEqual(r.unreachable, [], `${name}: controls clipped where a finger cannot scroll to them`);
  assert.deepEqual(r.small, [], `${name}: text under the 10.5 px floor`);
  assert.ok(r.viewH >= 220, `${name}: the model view is ${r.viewH} px tall`);
  // Every lens pin, except that on a view under 400 px wide beside the inspector (568x320) the edge-of-frame pin may
  // sit under the very inset that magnifies it.
  if (level === 'lens') assert.ok(r.shown >= r.pins - (r.viewW < 400 && r.viewH < 300 ? 1 : 0), `${name}: ${r.shown} of ${r.pins} lens pins visible`);
  report.checks.push(`${name}: view ${Math.round(r.viewH)} px, ${r.shown}/${r.pins} pins, nothing clipped, no text under 10.5 px`);
  return r;
}
// Score loop r3 (WCAG 1.4.10): on a touch screen the part row's buttons are 44 px wide, and at 320 px (and in the
// ~340 px model column of a 568x320 phone on its side) Zoom in was pushed past the edge and clipped. Every visible
// part-row and zoom button must lie inside the viewport and inside every ancestor that clips its overflow.
async function requireRowInClip(page, name) {
  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#hud-btns-phone button, .part-nav button, .zoom-controls button')].filter(b => b.checkVisibility()).map(b => {
      let l = 0, r = vw;
      for (let a = b.parentElement; a; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') { const q = a.getBoundingClientRect(); l = Math.max(l, q.left); r = Math.min(r, q.right); }
      }
      const box = b.getBoundingClientRect();
      return { id: b.id, box: [Math.round(box.left), Math.round(box.right)], clip: [Math.round(l), Math.round(r)] };
    }).filter(b => b.box[0] < b.clip[0] - 0.5 || b.box[1] > b.clip[1] + 0.5);
  });
  assert.deepEqual(out, [], `${name}: control-row buttons outside their clip: ${JSON.stringify(out)}`);
}
try {
  // Landscape phones (the orientation pass, review loop r1): the page scrolls, and the model and the inspector sit
  // side by side under the level tabs. Each level is checked with the tabs snapped to the top.
  for (const viewport of [{ width:844, height:390 }, { width:740, height:360 }, { width:568, height:320 }]) {
    const page = await browser.newPage({ viewport, hasTouch:true, reducedMotion:'no-preference' });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(new URL(`?lens=m50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
    for (const level of ['camera','lens','cone','loupe']) {
      await page.locator(`#steps [data-piece="${level}"]`).click();
      await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving);
      // the tabs at the top of the screen and the model column scrolled back to its view (the previous level's
      // checks scrolled it to the playback row)
      await page.locator('#steps').evaluate(el => { el.scrollIntoView({ block:'start' }); document.querySelector('#viewer').scrollTop = 0; });
      await page.waitForTimeout(400);
      await requireGeometry(page, `${viewport.width}x${viewport.height}/${level}`);
      await layoutChecks(page, `${viewport.width}x${viewport.height}/${level}`, level);
      await requireRowInClip(page, `${viewport.width}x${viewport.height}/${level}`);
      // the controls that used to sit under the fold are really usable: the playback button takes a tap
      const play = page.locator('.light-playback:not([hidden]) button').first();
      if (level !== 'camera') { await play.scrollIntoViewIfNeeded(); await play.click({ trial:true, timeout:3000 }); }
      for (const id of ['part-next','zoom-in']) { await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await page.locator(`#${id}`).click({ trial:true, timeout:3000 }); }
      await page.screenshot({ path:`${output}/${viewport.width}x${viewport.height}-${level}.png` });
    }
    await page.close();
  }
  for (const viewport of [{ width:390, height:844 }, { width:360, height:780 }, { width:360, height:640 }, { width:320, height:568 }]) {
    // a touch screen (score loop r3): the coarse-pointer rules widen the part row's buttons, which a mouse pass missed
    const page = await browser.newPage({ viewport, hasTouch:true, reducedMotion:'no-preference' });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(new URL(`?lens=m50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
    assert.equal(await page.evaluate(() => window.p2p.backend()), backend);
    for (const level of ['camera','lens','cone','loupe']) {
      if (await page.locator('#inspector-size').getAttribute('aria-expanded') === 'true') await page.locator('#inspector-size').click();
      await page.locator(`#steps [data-piece="${level}"]`).click();
      await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving);
      await page.waitForTimeout(100);
      await requireGeometry(page, `${viewport.width}/${level}`);
      // Score loop r2: on the smallest phones the loupe's reading is one line under its heading, so at least four of
      // the stack's six pins show in the 240 px view (one did, under the two-column strip).
      const smallLoupe = level === 'loupe' && viewport.width <= 340;
      if (smallLoupe) {
        await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, null, { timeout: 30000 });
        await page.locator('#steps').evaluate(el => el.scrollIntoView({ block:'start' }));
        await page.waitForTimeout(500);
      }
      const layout = await layoutChecks(page, `${viewport.width}x${viewport.height}/${level}`, level);
      await requireRowInClip(page, `${viewport.width}x${viewport.height}/${level}`);
      if (smallLoupe) {
        // score loop r3: all six, the arriving photons' pin included (design/LOOK.md's phone rules keep it)
        assert.equal(layout.shown, layout.pins, `${viewport.width}x${viewport.height}/loupe: only ${layout.shown} of ${layout.pins} stack pins visible`);
        const read = await page.locator('.lv-read:not(.lv-status)').evaluate(el => ({ h: el.getBoundingClientRect().height, view: document.querySelector('#view').getBoundingClientRect().height }));
        assert.ok(read.h <= read.view * 0.25, `${viewport.width}x${viewport.height}/loupe: the reading takes ${read.h} of ${read.view} px`);
        // Details opens the full reading and closes it again
        await page.locator('.lv-read-more').click();
        assert.equal(await page.locator('.lv-read-more').getAttribute('aria-expanded'), 'true');
        assert.ok(await page.locator('.lv-read-mean').isVisible(), 'Details shows the expected electrons');
        await page.locator('.lv-read-more').click();
        assert.equal(await page.locator('.lv-read-more').getAttribute('aria-expanded'), 'false');
        report.checks.push(`${viewport.width}x${viewport.height}/loupe: ${layout.shown}/${layout.pins} pins beside a ${Math.round(read.h)} px reading; Details opens and closes`);
      }
      // every pin on screen and on top (ux); a phone 680 px tall or less scrolls its model workspace instead (access)
      if (viewport.height > 680) await requirePins(page, `${viewport.width}x${viewport.height}/${level}`, level);
      // a phone 680 px tall or less scrolls instead and has no inspector size button (studio-shell.css, review loop r1)
      const sizeButton = await page.locator('#inspector-size').isVisible();
      if (sizeButton && await page.locator('#inspector-size').getAttribute('aria-expanded') !== 'true') await page.locator('#inspector-size').click();
      for (const id of ['part-prev','part-overview','part-next','reset-view','zoom-in','zoom-out']) {
        const hit = await page.locator(`#${id}`).evaluate(el => {
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return { hits: top === el || el.contains(top), top:top?.id, y:r.y, height:r.height };
        });
        assert.ok(hit.hits, `${viewport.width}/${level}/${id} is covered by ${hit.top}`);
        await page.locator(`#${id}`).click({ timeout:3000 });
      }
      report.checks.push(`${viewport.width}/${level}: ${sizeButton ? 'expanded inspector leaves ' : ''}all six navigation/zoom controls clickable`);
      await page.screenshot({ path:`${output}/${viewport.width}-${level}-expanded.png` });
    }
    await page.locator('#workspace-photos').click();
    assert.equal(await page.locator('#inspector-size').getAttribute('aria-expanded'), 'false');
    await page.locator('#workspace-model').click();
    await page.locator('#part-overview').click({ timeout:3000 });
    if (!await page.locator('#inspector-size').isVisible()) { await page.close(); continue; }
    await page.locator('#inspector-size').click();
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(() => document.querySelector('#inspector-size').getAttribute('aria-expanded') === 'false');
    await page.setViewportSize(viewport);
    await page.locator('#part-next').click({ timeout:3000 });
    report.checks.push(`${viewport.width}: Photos return and rotation clear stale expansion`);
    await page.close();
  }
  // A phone on its side (review loop 10/11/2026): the model gets at least 60% of the screen once the level row is
  // scrolled under the bar, every pin and navigation control is reachable, and Expand model fills the screen.
  for (const viewport of [{ width:844, height:390 }, { width:667, height:375 }]) {
    const context = await browser.newContext({ viewport, isMobile:true, hasTouch:true, reducedMotion:'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(new URL(`?lens=m50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
    const name = `${viewport.width}x${viewport.height}`;
    for (const level of ['camera','lens','cone','loupe']) {
      await page.locator(`#steps [data-piece="${level}"]`).click();
      await waitLevel(page);
      // Score loop r2: a level change brings the level tabs to the top of the screen by itself, so the model and its
      // controls start in view (the view used to start about 230 px down a 390 px screen).
      await page.waitForTimeout(200);
      const tabsTop = await page.locator('#steps').evaluate(el => el.getBoundingClientRect().top);
      assert.ok(Math.abs(tabsTop) <= 1, `${name}/${level}: the level tabs are at y=${tabsTop} after a level change, not at the top`);
      // Integration (score loop r1): the landscape layout is access's, whose top bar scrolls away and whose level tabs
      // snap to the top with the model band one screen tall under them; the model keeps at least 220 px there.
      await page.locator('#steps').evaluate(el => { el.scrollIntoView({ block:'start' }); document.querySelector('#viewer').scrollTop = 0; });
      await page.waitForTimeout(300);
      const view = await page.locator('#view').evaluate(el => { const r = el.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height }; });
      assert.ok(view.height >= 220, `${name}/${level}: model view is only ${view.height}px of ${viewport.height}`);
      assert.ok(view.top >= 0 && view.bottom <= viewport.height + 1, `${name}/${level}: model view is not fully on screen (${view.top}-${view.bottom})`);
      await requireGeometry(page, `${name}/${level}`);
      await requirePins(page, `${name}/${level}`, level);
      for (const id of ['part-prev','part-overview','part-next','reset-view','zoom-in','zoom-out']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        const hit = await page.locator(`#${id}`).evaluate(el => {
          const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return { hits: top === el || el.contains(top), top:top?.id };
        });
        assert.ok(hit.hits, `${name}/${level}/${id} is covered by ${hit.top}`);
      }
      await page.locator('#part-overview').click({ timeout:3000 });
      await page.screenshot({ path:`${output}/${name}-${level}.png` });
      report.checks.push(`${name}/${level}: ${Math.round(view.height)}px model, pins and navigation reachable`);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#expand-model').click();
    await page.waitForTimeout(500);
    const expanded = await page.evaluate(() => {
      const v = document.querySelector('#view').getBoundingClientRect(), b = document.querySelector('#expand-model').getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { height:v.height, top:v.top, button: top === document.querySelector('#expand-model'), pressed: document.querySelector('#expand-model').getAttribute('aria-pressed') };
    });
    assert.equal(expanded.pressed, 'true');
    assert.ok(expanded.height >= viewport.height - 60 && expanded.top >= -1, `${name}: Expand model leaves the model only ${expanded.height}px`);
    assert.ok(expanded.button, `${name}: Show controls is not reachable in the expanded view`);
    await requireGeometry(page, `${name}/expanded`);
    await page.screenshot({ path:`${output}/${name}-expanded.png` });
    await page.locator('#expand-model').click();
    assert.equal(await page.locator('#expand-model').getAttribute('aria-pressed'), 'false');
    assert.ok(await page.locator('#workspace-model').isVisible(), `${name}: the workspace rows return after Show controls`);
    report.checks.push(`${name}: Expand model gives the model ${Math.round(expanded.height)}px and returns`);
    await context.close();
  }
  // Tablets in portrait (score loop r2): the model column is 458-510 px wide, so the Optics and Focus insets take the
  // compact top-right place (phone-frame.ts compactView). The Focus level's traced-point card must not overlap the
  // "On the pixels" inset, and every Optics and Focus pin shows.
  for (const viewport of [{ width:768, height:1024 }, { width:820, height:1180 }]) {
    const page = await browser.newPage({ viewport, hasTouch:true, reducedMotion:'no-preference' });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(new URL(`?lens=m50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
    const name = `${viewport.width}x${viewport.height}`;
    for (const level of ['lens','cone']) {
      await page.locator(`#steps [data-piece="${level}"]`).click();
      await waitLevel(page);
      await requirePins(page, `${name}/${level}`, level);
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.lv-ctl, .inset-frame')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, l:r.left, t:r.top, r:r.right, b:r.bottom }; }));
      const ctl = boxes.find(b => /lv-ctl/.test(b.cls)), inset = boxes.find(b => /inset-frame/.test(b.cls));
      assert.ok(inset, `${name}/${level}: the inset is not on screen`);
      if (level === 'cone') {
        assert.ok(ctl, `${name}/cone: the traced-point card is not on screen`);
        const overlap = Math.max(0, Math.min(ctl.r, inset.r) - Math.max(ctl.l, inset.l)) * Math.max(0, Math.min(ctl.b, inset.b) - Math.max(ctl.t, inset.t));
        assert.equal(overlap, 0, `${name}/cone: the traced-point card covers ${overlap} px² of the inset`);
      }
      await page.screenshot({ path:`${output}/${name}-${level}.png` });
      report.checks.push(`${name}/${level}: all pins visible${level === 'cone' ? ', the card clear of the inset' : ''}`);
    }
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.checks.length} phone navigation groups`);
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report,null,2));
  await browser.close(); await server?.close();
}
