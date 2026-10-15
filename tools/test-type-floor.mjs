// The type floor and the hotspot rings (score loop r1, visual category): on the camera, optics, focus and pixel
// levels at a desktop, a portrait phone and a short landscape phone,
//   - no visible text is set under design/LOOK.md's 10.5 px floor (text hidden with font-size: 0 is not visible);
//   - the camera level's control rings never overlap one another (the shutter button sits on the front dial, so
//     the two share one ring when they would touch);
//   - the pixel level shows the "Not individual real-time photons" note, at 10.5 px or more, on every size
//     (Reed's decision 3 restored it on phones);
//   - a short landscape phone keeps at least 60% of the screen height for the 3D view (decision 3);
//   - no pin's number sits on an inset or on an inset's caption line (score loop r3: on a phone held upright and on
//     its side, pin 4 covered the Optics legend and the Focus level's "1 square = 1 pixel" note).
//   node tools/test-type-floor.mjs            (P2P_URL to use a running server)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gateServer } from './preview.mjs';

const FLOOR = 10.5;
const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const LEVELS = ['camera', 'lens', 'cone', 'loupe'];

const server = await gateServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const failures = [];
const errors = [];
try {
  for (const [size, opts] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ ...opts, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${size}: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${size}: ${m.text()}`); });
    for (const level of LEVELS) {
      await page.goto(new URL(`?piece=${level}&lens=n50`, server.url).href);
      await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
      if (level === 'camera') await page.evaluate(() => window.p2p.pieces.camera.ready());
      await page.evaluate(() => window.p2p.settle());
      await page.waitForTimeout(level === 'loupe' ? 2500 : 1200);
      const r = await page.evaluate((floor) => {
        const small = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent.trim();
          const el = n.parentElement;
          if (!text || !el || el.closest('svg, dialog:not([open]), [hidden]')) continue;
          if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs > 0 && fs < floor) small.push(`${fs}px "${text.slice(0, 40)}"`);
        }
        const rings = [...document.querySelectorAll('.rig-teach')].filter((e) => e.style.display !== 'none' && e.checkVisibility())
          .map((e) => { const b = e.querySelector('i').getBoundingClientRect(); return { text: e.querySelector('span')?.textContent ?? '', l: b.left, t: b.top, r: b.right, b: b.bottom }; });
        const note = [...document.querySelectorAll('.playback-note')].find((e) => /not individual real-time photons/i.test(e.textContent) && e.checkVisibility());
        const gl = document.querySelector('#gl').getBoundingClientRect();
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const captions = [...document.querySelectorAll('.piece-overlay:not([hidden]) .lv-inset-note, .inset-frame')]
          .filter((e) => e.checkVisibility() && e.getBoundingClientRect().width > 2).map((e) => ({ what: e.className, text: (e.textContent || e.dataset.label || '').slice(0, 40), ...box(e) }));
        const pins = [...document.querySelectorAll('.pin')].filter((e) => e.style.display !== 'none' && e.checkVisibility())
          .map((e) => ({ n: e.querySelector('.num')?.textContent, ...box(e.querySelector('.num')) }));
        const pinOnCaption = [];
        for (const p of pins) for (const c of captions) if (p.l < c.r && c.l < p.r && p.t < c.b && c.t < p.b) pinOnCaption.push(`pin ${p.n} on ${c.what} "${c.text}"`);
        return { small: [...new Set(small)], rings, note: note ? parseFloat(getComputedStyle(note).fontSize) : 0, glH: gl.height, pinOnCaption };
      }, FLOOR);
      const where = `${size} ${level}`;
      if (r.small.length) failures.push(`${where}: ${r.small.length} text runs under ${FLOOR} px: ${r.small.slice(0, 6).join('; ')}`);
      for (let i = 0; i < r.rings.length; i++) for (let j = i + 1; j < r.rings.length; j++) {
        const a = r.rings[i], b = r.rings[j];
        if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) failures.push(`${where}: hotspot rings overlap ("${a.text}" and "${b.text}")`);
      }
      if (level === 'camera' && r.rings.length < 2) failures.push(`${where}: expected the focus ring and the shutter/dial rings, saw ${r.rings.length}`);
      if (level === 'loupe' && r.note < FLOOR) failures.push(`${where}: the "not individual real-time photons" note is ${r.note ? r.note + ' px' : 'missing'}`);
      if (r.pinOnCaption.length) failures.push(`${where}: ${r.pinOnCaption.join('; ')}`);
      if (size === 'landscape' && r.glH < 0.6 * 390) failures.push(`${where}: the 3D view is ${Math.round(r.glH)} px tall, under 60% of 390`);
      console.log(`${where}: ${r.small.length} small, ${r.rings.length} rings, ${r.pinOnCaption.length} pins on captions, note ${r.note || '-'} px, view ${Math.round(r.glH)} px`);
    }
    // Score loop r4: the story page's diagrams. Their labels are SVG text in viewBox units, so the rendered size is
    // the font size times the figure's scale; a narrow figure swaps the labels for numbered badges and a key list.
    await page.goto(new URL('reference.html?page=story', server.url).href);
    await page.waitForSelector('#story-illustration svg');
    for (const id of ['photo', 'light', 'lens', 'focus', 'exposure', 'readout', 'final']) {
      await page.locator(`[data-story-chapter="${id}"]`).click();
      const r = await page.evaluate((floor) => {
        const svg = document.querySelector('#story-illustration svg');
        const small = [];
        let shown = 0;
        for (const t of svg.querySelectorAll('text')) {
          if (!t.checkVisibility()) continue;
          shown++;
          const px = parseFloat(getComputedStyle(t).fontSize) * t.getScreenCTM().a;
          if (px < floor - 0.05) small.push(`${px.toFixed(1)}px "${t.textContent.trim().slice(0, 30)}"`);
        }
        const keys = [...document.querySelectorAll('.story-svg-key li')].filter((li) => li.checkVisibility());
        const keyPx = keys.length ? Math.min(...keys.map((li) => parseFloat(getComputedStyle(li).fontSize))) : null;
        return { small, shown, keys: keys.length, keyPx, tags: svg.querySelectorAll('.story-tag').length };
      }, FLOOR);
      const where = `${size} story ${id}`;
      if (r.small.length) failures.push(`${where}: SVG text under ${FLOOR} px: ${r.small.join('; ')}`);
      if (!r.shown) failures.push(`${where}: no visible diagram text`);
      if (r.keys && r.keys !== r.tags) failures.push(`${where}: ${r.tags} labels but ${r.keys} key lines on a narrow figure`);
      if (r.keyPx !== null && r.keyPx < FLOOR) failures.push(`${where}: key lines are ${r.keyPx} px`);
    }
    console.log(`${size} story diagrams: labels and key lines at ${FLOOR} px or more`);
    await ctx.close();
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS type floor 10.5 px, no overlapping hotspot rings, photon note on every size, landscape view >= 60%, no pin on an inset caption');
} finally { await browser.close(); await server.close(); }
