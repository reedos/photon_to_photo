import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
import { textEdges, textOverlaps } from './text-edges.mjs';
const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const reports = [];
mkdirSync('shots/learning', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  async function check(name) {
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    reports.push({ name, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })), incomplete: result.incomplete.map(v => v.id) });
    console.log(`${name}: ${result.violations.length} violations`);
  }
  const cameraUrl = new URL(url); cameraUrl.searchParams.set('piece', 'camera');
  await page.goto(cameraUrl.href); await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await check('workspace');
  await page.locator('#steps [data-piece="loupe"]').click();
  await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, { timeout: 90000 });
  await check('controlled pixel sample');
  await page.locator('#steps [data-piece="camera"]').click();
  await page.locator('#learn-launch').click(); await page.locator('#journey-stop').selectOption('7');
  await check('readout');
  await page.locator('#journey-stop').selectOption('8'); await check('pipeline');
  await page.locator('#journey-close').click();
  // Score loop r2 (WCAG 2.4.3): closing the tour, by its button or by Escape, returns focus to the Guided tour
  // button once the tour's history entry has been stepped out of (Chrome cleared it to <body> after that popstate).
  const settled = () => page.waitForFunction(() => document.activeElement?.id === 'learn-launch', null, { timeout: 3000 }).catch(() => {});
  await settled();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'learn-launch', 'the tour close button returns focus to Guided tour');
  await page.locator('#learn-launch').click(); await page.locator('#journey-stop').waitFor({ state: 'visible' });
  await page.locator('#journey-stop').focus(); await page.keyboard.press('Escape');
  await page.locator('#journey').waitFor({ state: 'hidden' }); await settled();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'learn-launch', 'Escape returns focus to Guided tour');
  // the 3D view is announced with a role and a name when it takes focus
  assert.deepEqual(await page.evaluate(() => { const g = document.querySelector('#gl'); return [g.getAttribute('role'), g.getAttribute('aria-roledescription'), !!g.getAttribute('aria-label')]; }), ['application', '3D model', true]);
  await page.locator('#workspace-photos').click();
  await page.waitForFunction(() => document.querySelector('#rp-img')?.complete && document.querySelector('#rp-img')?.naturalWidth > 0);
  await check('real-photo gallery');
  await page.locator('#rp-play').click(); await page.locator('#shot-dialog').waitFor({ state: 'visible' });
  await check('JPEG journey');
  for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement === document.body || document.activeElement.closest('#shot-dialog')), 'shot dialog traps keyboard focus'); }
  await page.keyboard.press('Escape'); await page.locator('#shot-dialog').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 320, height: 740 }); await check('phone gallery');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.goto(`${url}reference.html?page=story`); await check('introduction');
  assert.equal(await page.title(), 'The story · Photon to Photo');
  // Review loop r1 (10/11/2026): the models page and the reference pages failed contrast only below desktop, which
  // this gate never visited. Every page at a phone and a tablet width, and the four camera levels on a phone.
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${url}models.html`);
    await page.waitForFunction(() => document.querySelector('#parts-out li'), null, { timeout: 90000 });
    await check(`models ${viewport.width}`);
    assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('main').length, document.querySelector('h1')?.textContent]), [1, 'Camera models']);
    for (const ref of ['story', 'evidence', 'method', 'glossary', 'parts']) {
      await page.goto(`${url}reference.html?page=${ref}`); await check(`reference ${ref} ${viewport.width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(cameraUrl.href); await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 });
  for (const level of ['camera', 'lens', 'cone', 'loupe']) {
    await page.locator(`#steps [data-piece="${level}"]`).click();
    await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 });
    await check(`phone ${level}`);
  }
  // Score loop r3. On Focus the sliders speak their shown values, and the outputs beside them are not read twice.
  await page.locator('#steps [data-piece="cone"]').click();
  await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && document.getElementById('cone-dist'), null, { timeout: 90000 });
  assert.deepEqual(await page.evaluate(() => ['cone-dist', 'cone-field'].map(id => document.getElementById(id).getAttribute('aria-valuetext') === document.getElementById(`${id}-v`).textContent && document.getElementById(`${id}-v`).getAttribute('aria-hidden'))), ['true', 'true']);
  assert.deepEqual(await page.evaluate(() => ['fno', 'focus', 'shutter', 'iso'].map(k => document.getElementById(`sc-${k}-v`).getAttribute('aria-hidden'))), ['true', 'true', 'true', 'true']);
  // A phone's Settings opens a dialog without an unresolvable aria-controls; Parts takes focus into the parts list.
  assert.deepEqual(await page.evaluate(() => { const b = document.getElementById('tab-controls'); return [b.getAttribute('aria-haspopup'), b.hasAttribute('aria-controls')]; }), ['dialog', false]);
  await page.locator('#tab-explain').click();
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#parts')), 'Parts on a phone moves focus into the parts list');
  // The menu: opening it moves focus to its first link, and Tab stays in the menu instead of going on into the
  // page under the open panel (WCAG 2.4.3, 2.4.11).
  await page.locator('#menu-btn').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.closest('#topnav'), null, { timeout: 3000 });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#topnav, #menu-btn')), `Tab ${i + 1} from the open menu stays in it`);
  }
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => [document.activeElement?.id, document.querySelector('#menu-btn').getAttribute('aria-expanded'), document.querySelector('#stage-section').closest('[inert]') === null]), ['menu-btn', 'false', true]);
  // The models page's selection title is the h2 under its h1 (axe heading-order)
  await page.goto(`${url}models.html`);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3')].slice(0, 2).map(h => h.tagName === 'H1' ? 'H1' : `${h.tagName}:${h.id}`)), ['H1', 'H2:sel-t']);
  // the standalone lens preview page has a main landmark and a heading too (score loop r2)
  await page.goto(`${url}lens-preview.html`);
  assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('main').length, document.querySelector('h1')?.textContent]), [1, 'Lens exterior preview']);
  await page.goto(cameraUrl.href); await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 });
  // a skip link past the toolbar and real headings for the view and the inspector
  assert.deepEqual(await page.evaluate(() => [document.querySelector('a.skip-link')?.getAttribute('href'),
    [...document.querySelectorAll('h2')].map(h => h.textContent).filter(t => t === '3D view' || t === 'Camera controls and parts').length]), ['#stage-section', 2]);
  // ---- Score loop r4 (access): what the collapsed-state passes above could not see ----------------------------------------------
  // The first reviewers' axe run opened every details and found color-contrast failures at tablet and desktop widths that this
  // gate, which never expanded them, reported as clean; nothing checked label in name, text spacing at 320 px or a button's text
  // running out of its box. Each of those is checked here, on all four levels.
  const settle = () => page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 });
  const openLevel = async (level) => { await page.locator(`#steps [data-piece="${level}"]`).click(); await settle(); await page.waitForTimeout(500); };
  const loadCamera = async (viewport) => {
    await page.setViewportSize(viewport); await page.goto(cameraUrl.href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 }); await settle();
  };
  // text cut off by its own box: overflow hidden or an ellipsis, with the text wider or taller than the box
  const clippedText = (root = 'body') => page.evaluate((root) => [...document.querySelectorAll(`${root} *`)].filter((e) => {
    if (!e.checkVisibility() || !e.textContent.trim() || e.closest('svg,canvas,select,.sr-only,#pins,.pin') || getComputedStyle(e).clipPath !== 'none') return false;
    const c = getComputedStyle(e);
    if (!(['clip', 'hidden'].includes(c.overflowX) || ['clip', 'hidden'].includes(c.overflowY) || c.textOverflow === 'ellipsis')) return false;
    if (c.position === 'absolute' && e.offsetWidth < 4) return false;
    return e.scrollWidth > e.clientWidth + 1 || (['clip', 'hidden'].includes(c.overflowY) && e.scrollHeight > e.clientHeight + 1);
  }).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} "${e.textContent.trim().slice(0, 40)}" ${e.scrollWidth}/${e.clientWidth}`), root);
  // a visible button whose own text is wider than its box
  const buttonsOverflowing = () => page.evaluate(() => [...document.querySelectorAll('button, a.btn, [role=tab], summary')]
    .filter((b) => b.checkVisibility() && !b.closest('.sr-only,[inert],.pin') && getComputedStyle(b).display !== 'inline' && b.scrollWidth > b.clientWidth + 1)
    .map((b) => `${b.id || b.className || b.tagName} "${b.textContent.trim().slice(0, 24)}" ${b.scrollWidth}/${b.clientWidth}`));
  // WCAG 2.5.3: a short visible label must be part of the accessible name (punctuation aside)
  const labelsNotInNames = () => page.evaluate(() => {
    const norm = (t) => t.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return [...document.querySelectorAll('button[aria-label], a[aria-label], [role=tab][aria-label]')].filter((e) => e.checkVisibility() && !e.closest('[inert]'))
      .map((e) => ({ id: e.id || e.className, vis: norm(e.innerText || ''), name: norm(e.getAttribute('aria-label')) }))
      .filter((x) => x.vis && x.vis.length <= 14 && !x.name.includes(x.vis)).map((x) => `${x.id}: "${x.vis}" is not in "${x.name}"`);
  });
  const SPACING = '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}';

  // 1. axe with every details open, at a tablet and a desktop width, on every level (1.4.3 failed here only)
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
    await loadCamera(viewport);
    for (const level of ['camera', 'lens', 'cone', 'loupe']) {
      if (level !== 'camera') await openLevel(level);
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await check(`open details ${viewport.width} ${level}`);
    }
  }

  // 2. label in name and buttons that hold their text, at 320, 360 and 390 px and a tablet, on every level
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await loadCamera(viewport);
    for (const level of ['camera', 'lens', 'cone', 'loupe']) {
      if (level !== 'camera') await openLevel(level);
      assert.deepEqual(await labelsNotInNames(), [], `visible labels are in the accessible names (${viewport.width} ${level})`);
      if (viewport.width <= 390) assert.deepEqual(await buttonsOverflowing(), [], `no button's text runs out of its box (${viewport.width} ${level})`);
    }
  }

  // 3. WCAG 1.4.12 text spacing at 320 px: the Focus sliders and the Pixel reading (closed and with Details open) lose no text
  for (const [level, details] of [['cone', false], ['loupe', false], ['loupe', true]]) {
    await loadCamera({ width: 320, height: 568 }); await openLevel(level);
    if (details) await page.locator('.lv-read-more').click();
    const style = await page.addStyleTag({ content: SPACING }); await page.waitForTimeout(400);
    assert.deepEqual(await clippedText(), [], `text spacing at 320 px clips nothing (${level}${details ? ', details' : ''})`);
    await style.evaluate((node) => node.remove());
  }

  // 4. the Play the shot dialog's six chapter buttons hold their labels at 320, 360 and 390 px
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 }); await page.goto(`${cameraUrl.href}&view=photos`);
    await page.locator('#rp-play').waitFor({ state: 'visible', timeout: 60000 }); await page.locator('#rp-play').click(); await page.locator('#shot-dialog').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-shot-chapter]')].filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent)), [], `chapter buttons hold their labels at ${width} px`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-shot-chapter]').length), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'the dialog adds no sideways scroll');
    await page.keyboard.press('Escape'); await page.locator('#shot-dialog').waitFor({ state: 'hidden' });
  }

  // 5. orientation for a screen reader, on a phone and a tablet
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await loadCamera(viewport);
    assert.equal(await page.title(), 'The camera · Photon to Photo');
    await openLevel('lens');
    assert.equal(await page.title(), 'The lens · Photon to Photo');
    assert.equal(await page.evaluate(() => document.getElementById('level-heading').tagName + ':' + document.getElementById('level-heading').textContent), 'H3:The lens', 'the level title is a heading');
    await page.waitForFunction(() => /^Optics level: The lens, \d+ parts$/.test(document.getElementById('sr-announce').textContent), null, { timeout: 3000 });
    if (!(await page.locator('#studio-explain').isVisible())) await page.locator('#tab-explain').click();
    await page.locator('#parts button[data-part-id]:not([data-part-id=overview])').nth(1).click();
    await page.waitForFunction(() => /^Part 2 of \d+: \S/.test(document.getElementById('sr-announce').textContent), null, { timeout: 3000 });
    const part = await page.evaluate(() => document.querySelector('#parts li.sel button').dataset.partId);
    await page.locator('#card-x').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.partId), part, 'closing the part card returns focus to its part button');
  }

  // 6. the phone Settings sheet is modal for a screen reader too: aria-modal, and the page behind it is inert until it closes
  {
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const phone = await touch.newPage();
    await phone.goto(cameraUrl.href); await phone.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 });
    await phone.locator('#tab-controls').click(); await phone.waitForSelector('#phone-settings[open]');
    assert.deepEqual(await phone.evaluate(() => { const d = document.getElementById('phone-settings'); return [d.getAttribute('aria-modal'), [...document.body.children].filter((c) => c !== d && !['SCRIPT', 'DIALOG'].includes(c.tagName)).every((c) => c.inert)]; }), ['true', true]);
    // 7. a tap-only way to turn and tip the model (2.5.7): the Rotate buttons are in the sheet and move the camera
    const before = await phone.evaluate(() => window.p2p.framing().position);
    await phone.getByRole('button', { name: 'Turn right' }).click(); await phone.waitForTimeout(600);
    await phone.getByRole('button', { name: 'Tilt up' }).click(); await phone.waitForTimeout(600);
    const after = await phone.evaluate(() => window.p2p.framing().position);
    assert.ok(before.some((v, i) => Math.abs(v - after[i]) > 1e-3), 'Turn right and Tilt up move the camera');
    await phone.locator('#phone-settings-close').click(); await phone.waitForTimeout(300);
    assert.equal(await phone.evaluate(() => [...document.body.children].filter((c) => c.inert).length), 0, 'closing the sheet frees the page');
    // 8. the opening has its own main landmark, and the brand link leads to something that shows
    await touch.close();
    for (const [width, height] of [[390, 844], [844, 390]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
      const opening = await ctx.newPage(); await opening.goto(url); await opening.waitForSelector('#photo-opening:not([hidden])'); await opening.waitForTimeout(300);
      assert.deepEqual(await opening.evaluate(() => [[...document.querySelectorAll('main')].filter((m) => m.checkVisibility()).map((m) => m.id), document.querySelector(document.querySelector('.brand').getAttribute('href'))?.checkVisibility()]), [['photo-opening'], true]);
      assert.deepEqual(await opening.evaluate((h) => ['opening-explore', 'opening-follow', 'opening-photos'].map((id) => document.getElementById(id).getBoundingClientRect().bottom <= h), height), [true, true, true], `all three ways in show on the first ${width}x${height} screen`);
      await ctx.close();
    }
  }

  // 9. the Focal length & perspective slider speaks its value and is a 44 px target
  await loadCamera({ width: 390, height: 844 });
  await page.locator('.perspective-launch').first().click(); await page.locator('#perspective-dialog').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => { const r = document.getElementById('perspective-range'); return [r.getAttribute('aria-valuetext'), r.getAttribute('aria-label'), r.getBoundingClientRect().height >= 44, document.getElementById('perspective-focal').getAttribute('aria-hidden')]; }), ['50 mm', 'Focal length', true, 'true']);
  await page.keyboard.press('Escape');

  // 10. touch targets: with a touch screen, every control in the phone studio either has a 44 px box or is the element under the
  // finger for 44 px (the transparent hit areas of studio-shell.css), except the parts list's rows and inline links
  {
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const phone = await touch.newPage();
    await phone.goto(cameraUrl.href); await phone.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 });
    await phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off'), null, { timeout: 90000 });
    for (const level of ['camera', 'lens']) {
      if (level !== 'camera') { await phone.locator(`#steps [data-piece="${level}"]`).click(); await phone.waitForTimeout(1500); }
      const small = await phone.evaluate(() => [...document.querySelectorAll('button, input[type=range], select')].filter((e) => e.checkVisibility() && !e.closest('.pin,#pins,[inert],.sr-only,#parts,.why-link') && !e.classList.contains('why-link')).map((e) => {
        const r = e.getBoundingClientRect(); if (r.height === 0 || r.top < 0 || r.bottom > innerHeight) return null;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const owns = (y) => y >= 0 && y < innerHeight && !!document.elementFromPoint(cx, y) && (document.elementFromPoint(cx, y) === e || e.contains(document.elementFromPoint(cx, y)));
        let up = 0, down = 0; while (up < 30 && owns(cy - up - 1)) up++; while (down < 30 && owns(cy + down + 1)) down++;
        return { s: `${e.id || e.className || e.tagName} ${Math.round(r.height)}`, hit: Math.max(r.height, up + down + 1) };
      }).filter((x) => x && x.hit < 36).map((x) => x.s));
      assert.deepEqual(small, [], `no touch control under about 36 px effective height at 390 px (${level})`);
    }
    await touch.close();
  }
  // ---- Score loop r5 (access): the Optics inset's words, the tour's controls, the menu's landmarks, the pins and the fold -------------
  // 11. WCAG 1.4.4 and 1.4.10: no visible text passes the screen's edge, and the Optics inset's caption ("Magnified 1,100×", whose
  // figure was lost) and legend ("bar = one color's spread", which ran off the screen) stay inside the inset, at 320, 360, 390 and on its side
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 780 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await loadCamera(viewport); await openLevel('lens');
    assert.deepEqual(await textEdges(page), [], `no text runs past the screen or out of the Optics inset (${viewport.width}x${viewport.height})`);
    assert.match(await page.evaluate(() => document.querySelector('.inset-frame')?.dataset.label ?? ''), /\d[\d,.]*×$/, 'the caption ends with its magnification');
  }

  // touch contexts: the coarse-pointer hit areas and the phone's fold only exist with a touch screen
  const touchPage = async (width, height, query = cameraUrl.search) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    const phone = await context.newPage();
    await phone.goto(new URL(query, cameraUrl).href); await phone.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 });
    await phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 });
    return { context, phone };
  };
  // 12. the tour's controls (open) hold their text and are 44 px tall targets at 320, 360 and 390; "Next stop" keeps its words in its name
  for (const [width, height] of [[320, 568], [360, 780], [390, 844]]) {
    const { context, phone } = await touchPage(width, height);
    await phone.locator('#learn-launch').click(); await phone.locator('#journey-stop').waitFor({ state: 'visible' }); await phone.waitForTimeout(800);
    assert.deepEqual(await phone.evaluate(() => [...document.querySelectorAll('#journey button, #journey summary')].filter((b) => b.checkVisibility() && b.scrollWidth > b.clientWidth + 1)
      .map((b) => `${b.id || b.tagName} "${b.textContent.trim()}" ${b.scrollWidth}/${b.clientWidth}`)), [], `no tour control's text runs out of its box (${width})`);
    assert.deepEqual(await phone.evaluate(() => [...document.querySelectorAll('#journey nav .btn')].filter((b) => b.checkVisibility()).map((b) => {
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const owns = (y) => { const t = document.elementFromPoint(cx, y); return !!t && (t === b || b.contains(t)); };
      let up = 0, down = 0; while (up < 30 && owns(cy - up - 1)) up++; while (down < 30 && owns(cy + down + 1)) down++;
      return up + down + 1 >= 44 ? null : `${b.id} ${up + down + 1}`;
    }).filter(Boolean)), [], `every tour control is the element under the finger for 44 px (${width})`);
    assert.deepEqual(await phone.evaluate(() => { const n = document.getElementById('journey-next'); return [n.getAttribute('aria-label'), n.innerText.replace(/\s+/g, ' ')]; }).then(([name, text]) => [name.toLowerCase().includes(text.replace(/[^\p{L} ]+/gu, '').trim().toLowerCase())]), [true], 'the Next button\'s name holds its visible words');
    await context.close();
  }

  // 13. the menu, open: the main landmark and the h1 stay out of the inert region (axe landmark-one-main, page-has-heading-one)
  {
    const { context, phone } = await touchPage(390, 844);
    const inertBefore = await phone.evaluate(() => document.querySelectorAll('[inert]').length);
    await phone.locator('#menu-btn').click(); await phone.waitForFunction(() => document.querySelector('#menu-btn').getAttribute('aria-expanded') === 'true'); await phone.waitForTimeout(400);
    await phone.addScriptTag({ content: axe });
    assert.deepEqual(await phone.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['landmark-one-main', 'page-has-heading-one'] } })).violations.map((v) => v.id)), [], 'the open menu leaves a main landmark and an h1');
    assert.equal(await phone.evaluate(() => [document.querySelector('#steps'), document.querySelector('#stage-section')].every((e) => e.closest('[inert]'))), true, 'the rest of the page is still inert while the menu is open');
    await phone.keyboard.press('Escape'); await phone.waitForTimeout(300);
    assert.equal(await phone.evaluate(() => document.querySelectorAll('[inert]').length), inertBefore, 'closing the menu frees the page');
    await context.close();
  }

  // 14. the 3D pins' touch area: every pin is the element under the finger for 40 px each way, on every level at 320 and 390
  for (const [width, height] of [[390, 844], [320, 568]]) {
    const { context, phone } = await touchPage(width, height);
    for (const level of ['camera', 'lens', 'cone', 'loupe']) {
      if (level !== 'camera') { await phone.locator(`#steps [data-piece="${level}"]`).click(); await phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 }); await phone.waitForTimeout(600); }
      assert.deepEqual(await phone.evaluate(() => [...document.querySelectorAll('#pins .pin')].filter((p) => p.checkVisibility()).map((p) => {
        const n = p.querySelector('.num') || p, r = n.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const owns = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && p.contains(t); };
        let l = 0, rr = 0, u = 0, d = 0; while (l < 30 && owns(cx - l - 1, cy)) l++; while (rr < 30 && owns(cx + rr + 1, cy)) rr++; while (u < 30 && owns(cx, cy - u - 1)) u++; while (d < 30 && owns(cx, cy + d + 1)) d++;
        return Math.min(l + rr + 1, u + d + 1) >= 40 ? null : `${p.textContent.trim().slice(0, 12)} ${l + rr + 1}x${u + d + 1}`;
      }).filter(Boolean)), [], `every pin has a 40 px touch area (${width} ${level})`);
    }
    await context.close();
  }

  // 15. the smallest phone's first screen holds the Settings and Parts tabs (they began at y 538 to 654 of 568)
  for (const level of ['camera', 'lens', 'cone', 'loupe']) {
    const { context, phone } = await touchPage(320, 568);
    if (level !== 'camera') { await phone.locator(`#steps [data-piece="${level}"]`).click(); await phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 }); await phone.waitForTimeout(600); }
    assert.deepEqual(await phone.evaluate(() => ['tab-controls', 'tab-explain'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })), [true, true], `Settings and Parts show on the first 320x568 screen (${level})`);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the fixed row adds no sideways scroll');
    await context.close();
  }

  // 16. the phone captions have a dark backing over the picture, and the Models page's controls leave the model clear
  {
    const { context, phone } = await touchPage(320, 568);
    await phone.locator('#steps [data-piece="cone"]').click(); await phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 }); await phone.waitForTimeout(600);
    assert.ok(await phone.evaluate(() => { const f = document.querySelector('.inset-frame'); return f && /rgba\(0, 0, 0, 0?\.[3-9]/.test(getComputedStyle(f.querySelector('.inset-label')).backgroundColor); }), 'the Focus inset caption has a dark backing at 320 px');
    await context.close();
    for (const [width, height] of [[320, 568], [390, 844]]) {
      const models = await browser.newContext({ viewport: { width, height }, hasTouch: true });
      const mp = await models.newPage(); await mp.goto(new URL('models.html', url).href);
      await mp.waitForFunction(() => document.querySelector('#parts-out li'), null, { timeout: 90000 }); await mp.waitForTimeout(1500);
      assert.equal(await mp.evaluate(() => { const c = document.querySelector('#gl').getBoundingClientRect(); return [...document.querySelectorAll('.hud.tr .mode')].filter((m) => m.checkVisibility()).map((m) => m.getBoundingClientRect()).filter((r) => r.bottom > c.top + 1 && r.top < c.bottom - 1 && r.right > c.left && r.left < c.right).length; }), 0, `the Models page's controls do not overlay the model (${width})`);
      await models.close();
    }
  }
  // ---- Score loop r6 (access): names, overlaps, the veil, the part cue, forced colors, the zoom case ------------------------------------------
  const levelSettled = (phone) => phone.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving, null, { timeout: 90000 });
  const gotoLevel = async (phone, level) => { if (level !== 'camera') { await phone.locator(`#steps [data-piece="${level}"]`).click(); await levelSettled(phone); await phone.waitForTimeout(700); } };
  // 17. WCAG 4.1.2: every slider on screen has an accessible name in the browser's own accessibility tree, and a spoken value that is not a bare
  // step number. axe passed the Focus sliders because the input sat inside a <label>, but the label's control was the <output> before it.
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    const { context, phone } = await touchPage(width, height);
    const cdp = await context.newCDPSession(phone);
    for (const level of ['camera', 'lens', 'cone', 'loupe']) {
      await gotoLevel(phone, level);
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const sliders = nodes.filter((n) => n.role?.value === 'slider' && !n.ignored);
      assert.deepEqual(sliders.filter((n) => !String(n.name?.value ?? '').trim()).map((n) => n.backendDOMNodeId), [], `every slider has an accessible name (${width} ${level})`);
      if (level === 'cone') assert.deepEqual(['Point distance', 'Off center'].filter((name) => !sliders.some((n) => n.name?.value === name)), [], 'the Focus sliders are named by their words');
      assert.deepEqual(await phone.evaluate(() => [...document.querySelectorAll('input[type=range]')].filter((e) => e.checkVisibility() && !e.getAttribute('aria-valuetext')).map((e) => e.id || e.getAttribute('aria-label'))), [], `every slider speaks a value, not its step number (${width} ${level})`);
    }
    await context.close();
  }

  // 18. no two pieces of visible text print on top of each other in the 3D view, on every level, at six sizes (the Focus inset note ran onto the
  // "Center" value of the sliders at 320x568, 360x780 and on a phone's side), and with WCAG 1.4.12 text spacing on Focus and Pixel at 360 and 390
  for (const [width, height] of [[320, 568], [360, 780], [390, 844], [568, 320], [667, 375], [844, 390]]) {
    const { context, phone } = await touchPage(width, height);
    for (const level of ['camera', 'lens', 'cone', 'loupe']) {
      await gotoLevel(phone, level);
      assert.deepEqual(await textOverlaps(phone), [], `no text prints over other text in the view (${width}x${height} ${level})`);
      if ((width === 360 || width === 390) && (level === 'cone' || level === 'loupe')) {
        const spacing = await phone.addStyleTag({ content: SPACING }); await phone.waitForTimeout(600);
        assert.deepEqual(await textOverlaps(phone), [], `no text prints over other text with text spacing (${width}x${height} ${level})`);
        await spacing.evaluate((node) => node.remove());
      }
    }
    await context.close();
  }

  // 19. the loading veil leaves the accessibility tree once the view is ready (it read "Preparing the view" mid-page on every level)
  {
    const { context, phone } = await touchPage(390, 844);
    for (const level of ['camera', 'cone']) {
      await gotoLevel(phone, level); await phone.waitForTimeout(900);
      assert.equal(await phone.evaluate(() => getComputedStyle(document.getElementById('veil')).visibility), 'hidden', `the veil is hidden from the page and the accessibility tree once it has faded (${level})`);
      assert.ok(!(await phone.locator('body').ariaSnapshot()).includes('Preparing'), `no loading words stay in the accessibility tree (${level})`);
    }
    await context.close();
  }

  // 20. on a short phone a chosen part's card is not left unseen: a "Details below" cue shows under the model while the card is off screen,
  // and its button brings the card up and moves focus to its heading
  for (const [width, height] of [[320, 568], [360, 640]]) {
    const { context, phone } = await touchPage(width, height);
    await phone.locator('#tab-explain').click(); await phone.waitForTimeout(400);
    await phone.locator('#parts button[data-part-id]:not([data-part-id=overview])').nth(1).click();
    await phone.locator('.card-cue').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await phone.locator('.card-cue').textContent(), 'Details below', `the cue says where the card is (${width})`);
    await phone.locator('.card-cue').click(); await phone.waitForTimeout(900);
    assert.deepEqual(await phone.evaluate(() => { const c = document.getElementById('card').getBoundingClientRect(), row = document.querySelector('.inspector-tab-row'); const floor = getComputedStyle(row).position === 'fixed' ? row.getBoundingClientRect().top : innerHeight; return [c.top >= 0 && c.top < floor - 40, document.activeElement?.id, document.querySelector('.card-cue').hidden]; }), [true, 'card-t', true], `the cue brings the card on screen and focuses its heading (${width})`);
    await context.close();
  }
  {
    const { context, phone } = await touchPage(390, 844);
    await phone.locator('#tab-explain').click(); await phone.waitForTimeout(400);
    await phone.locator('#parts button[data-part-id]:not([data-part-id=overview])').nth(1).click(); await phone.waitForTimeout(1400);
    assert.equal(await phone.locator('.card-cue').isVisible(), false, 'a phone that shows the card needs no cue (390x844)');
    await context.close();
  }

  // 21. forced colors (Windows high contrast): the Focus sliders keep a visible track and thumb. The slider pseudo-elements have no computed
  // style to read, so the slider's own picture is counted: a flat panel with only a thumb has a few hundred ink pixels, the track adds a line.
  {
    const forced = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, forcedColors: 'active' });
    const phone = await forced.newPage();
    await phone.goto(cameraUrl.href); await phone.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 90000 }); await levelSettled(phone);
    await gotoLevel(phone, 'cone');
    const png = (await phone.locator('#cone-dist').screenshot()).toString('base64');
    const inkPixels = await phone.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), cx = canvas.getContext('2d'); cx.drawImage(bitmap, 0, 0);
      const d = cx.getImageData(0, 0, bitmap.width, bitmap.height).data, bg = [d[0], d[1], d[2]];
      let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 150) n++;
      return n;
    }, png);
    assert.ok(inkPixels > 700, `the Focus slider's track is drawn in forced colors (${inkPixels} ink pixels)`);
    await forced.close();
  }

  // 22. the Real photos note ends in an ellipsis, not mid-sentence, when its box is short (a line clamp on the phone), at 320, 360 and 390
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 }); await page.goto(`${cameraUrl.href}&view=photos`);
    await page.locator('#rp-note').waitFor({ state: 'visible', timeout: 60000 }); await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => { const n = document.getElementById('rp-note'), c = getComputedStyle(n); return [n.scrollHeight > n.clientHeight + 1 ? c.webkitLineClamp !== 'none' : true, document.querySelector('.rp-read-explanation').checkVisibility()]; }), [true, true], `a note that does not fit is clamped with an ellipsis and has Read explanation beside it (${width})`);
  }

  // 23. WCAG 1.4.10 at 400% zoom (a 320x256 window): it is one column with the phone's scrolling page, the Focus labels hold their words and
  // nothing prints over other text, and a bit under 150 px of the model shows between the level tabs and the fixed tab row
  for (const level of ['camera', 'lens', 'cone', 'loupe']) {
    const { context, phone } = await touchPage(320, 256);
    await gotoLevel(phone, level);
    await phone.evaluate(() => document.getElementById('view').scrollIntoView({ block: 'start', behavior: 'instant' })); await phone.waitForTimeout(400);
    const facts = await phone.evaluate(() => {
      const v = document.getElementById('view').getBoundingClientRect(), row = document.querySelector('.inspector-tab-row');
      const floor = getComputedStyle(row).position === 'fixed' ? row.getBoundingClientRect().top : innerHeight;
      return { visible: Math.round(Math.min(v.bottom, floor, innerHeight) - Math.max(v.top, 0)), width: v.width, sw: document.documentElement.scrollWidth,
        labels: [...document.querySelectorAll('.lv-ctl-l')].filter((e) => e.checkVisibility()).map((e) => [e.textContent, e.getBoundingClientRect().width, e.getBoundingClientRect().height]) };
    });
    assert.equal(facts.width, 320, `the model view is the full width at 400% zoom (${level})`);
    assert.ok(facts.sw <= 320, `no sideways scroll at 400% zoom (${level})`);
    assert.ok(facts.visible >= 140, `at least 140 px of the model shows at 400% zoom (${level}: ${facts.visible})`);
    assert.deepEqual(facts.labels.filter(([, w, h]) => w < 60 || h > 3 * 15 + 2).map(([text]) => text), [], `the Focus labels never wrap letter by letter (${level})`);
    assert.deepEqual(await textOverlaps(phone), [], `no text prints over other text at 400% zoom (${level})`);
    await context.close();
  }

  // 24. a touch phone's Parts rows are 44 px tall, and a tablet's Focus sliders are 40 px (the 24 px floor of WCAG 2.5.8 still holds elsewhere)
  {
    const { context, phone } = await touchPage(390, 844);
    assert.deepEqual(await phone.evaluate(() => [...document.querySelectorAll('#parts button')].filter((b) => b.checkVisibility()).map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h < 44)), [], 'every Parts row is 44 px tall on a touch phone');
    await context.close();
    const tablet = await touchPage(768, 1024);
    await gotoLevel(tablet.phone, 'cone');
    assert.deepEqual(await tablet.phone.evaluate(() => ['cone-dist', 'cone-field'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height))), [40, 40], 'the Focus sliders are 40 px tall on a touch tablet');
    await tablet.context.close();
  }

  // 25. the legends set on the 3D picture have a dark backing, dark enough that the muted 11 px text keeps 4.5:1 even over a pure white pixel (alpha .75 or more)
  for (const [width, height, level] of [[390, 844, 'cone'], [390, 844, 'lens'], [768, 1024, 'cone']]) {
    const { context, phone } = await touchPage(width, height);
    await gotoLevel(phone, level);
    const alpha = await phone.evaluate(() => { const n = [...document.querySelectorAll('.piece-overlay:not([hidden]) .lv-inset-note')].find((e) => e.checkVisibility()); const m = n && getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/); return m ? Number(m[1].split(',')[3] ?? 1) : 0; });
    assert.ok(alpha >= 0.75, `the inset legend has a dark backing (${width} ${level}: alpha ${alpha})`);
    await context.close();
  }
  writeFileSync('shots/learning/accessibility.json', JSON.stringify(reports, null, 2));
  assert.equal(reports.reduce((n, r) => n + r.violations.length, 0), 0, 'see shots/learning/accessibility.json');
} finally { await browser.close(); await server?.close(); }
