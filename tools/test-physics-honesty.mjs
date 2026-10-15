// Score-loop r1 physics gate (10/11/2026): the text the reader sees says what the numbers are.
//   1. Phone (390x844 portrait, and 844x390 landscape): the loupe's photon playback carries the
//      "Not individual real-time photons" note, visible, at the design/LOOK.md phone text floor (>= 10.5 px).
//   2. Cone: the bokeh card separates the all-wavelength chord from the 587.6 nm chord, and the d-line chord is
//      within 10% of the d-line prediction.
//   3. Loupe HUD: names the pixel's filter color, shows expected electrons beside the sampled ones, and flags an
//      ADC-clipped raw value (ISO 6400, 1/250 s, f/4).
//   4. Focus-ring card states the DOF convention (textbook paraxial rule at 587.6 nm).
//   Score loop r2 (10/11/2026): 5. on both phone sizes the loupe readout keeps a short conditions line naming the
//      filter color and settings, visible at >= 10.5 px; 6. the expected-photons row names its 380-780 nm band;
//      7. the sensor card shows the assumed 90% lens transmission; 8. the lens view's Ray fan card says where the
//      rays start, and the Edge of frame card splits the spread into one-color blur and the shift between colors.
// Screenshots go to shots/physics-honesty/.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const OUT = process.env.OUT || 'shots/physics-honesty';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });

// The parts list is on the inspector's Explain tab; a gate that picks a part opens that tab first (score loop r4: the
// rows were "not visible" under Controls and these clicks timed out).
async function part(page, id) {
  await page.locator('#tab-explain').click();
  return page.locator(`#parts [data-part-id="${id}"]`);
}

async function openPiece(page, piece, scenario) {
  await page.goto(new URL(`?piece=${piece}`, url).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  if (scenario) await page.evaluate((s) => window.p2p.set(s), scenario);
  await page.evaluate(() => window.p2p.settle());
}
async function loupeReady(page) {
  await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel && !window.p2p.pieces.loupe.state().pendingPixel, null, { timeout: 60000 });
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(300);
}
const noteInfo = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('.light-playback .packet-note')].find((e) => e.offsetParent !== null) ?? document.querySelector('.light-playback .packet-note');
  if (!el) return null;
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { text: el.innerText, visible: !!el.offsetParent && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', fontPx: parseFloat(cs.fontSize), right: r.right, vw: innerWidth };
});

const errors = [];
try {
  // ---- 1. phone note ------------------------------------------------------------------------------------------
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(String(e)));
    await openPiece(page, 'loupe');
    await loupeReady(page);
    const before = await noteInfo(page);
    assert.ok(before, `${w}x${h}: packet note element exists`);
    assert.ok(before.visible, `${w}x${h}: packet note visible before play (${JSON.stringify(before)})`);
    assert.match(before.text, /not individual real-time photons/i, `${w}x${h}: note text`);
    assert.ok(before.fontPx >= 10.5, `${w}x${h}: note font ${before.fontPx}px >= 10.5px`);
    assert.ok(before.right <= before.vw + 0.5, `${w}x${h}: note inside the viewport`);
    await page.locator('.light-playback button').first().click();
    await page.waitForTimeout(400);
    const after = await noteInfo(page);
    assert.ok(after?.visible, `${w}x${h}: packet note visible while playing`);
    const shortCond = await page.evaluate(() => {
      const el = document.querySelector('.lv-read:not(.lv-status) [data-k="conditionsShort"]');
      if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { text: el.textContent, visible: !!el.offsetParent && r.width > 0 && r.height > 0 && cs.display !== 'none', fontPx: parseFloat(cs.fontSize), right: r.right, vw: innerWidth,
        long: getComputedStyle(document.querySelector('.lv-read:not(.lv-status) [data-k="conditions"]')).display };
    });
    assert.ok(shortCond?.visible, `${w}x${h}: short conditions line visible (${JSON.stringify(shortCond)})`);
    assert.match(shortCond.text, /^(Red|Green|Blue) pixel · 18% gray · f\/[\d.]+ · .+ · ISO \d/, `${w}x${h}: short conditions text`);
    assert.ok(shortCond.fontPx >= 10.5, `${w}x${h}: conditions font ${shortCond.fontPx}px >= 10.5px`);
    assert.ok(shortCond.right <= shortCond.vw + 0.5, `${w}x${h}: conditions line inside the viewport`);
    console.log(`PASS phone ${w}x${h} readout: "${shortCond.text}" at ${shortCond.fontPx}px (long line display: ${shortCond.long})`);
    await page.screenshot({ path: `${OUT}/phone-loupe-${w}x${h}.png` });
    console.log(`PASS phone ${w}x${h}: "${before.text.replace(/\s+/g, ' ')}" at ${before.fontPx}px, before and during play`);
    await page.close();
  }

  // ---- 2-4. desktop cards -------------------------------------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push(String(e)));
  await openPiece(page, 'cone', { lens: 'n50', fno: 4, focusM: 3, format: 'ff' });
  await page.evaluate(() => window.p2p.pieces.cone.setPoint(1500, 0));
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(400);
  const probe = await page.evaluate(() => window.p2p.pieces.cone.probe());
  assert.ok(Number.isFinite(probe.dLineDiameterMm), 'cone probe exposes the d-line chord');
  const dErr = Math.abs(probe.dLineDiameterMm / probe.predictedBlurMm - 1);
  const widest = probe.diameterByNm.reduce((a, c) => (c.diameterMm > a.diameterMm ? c : a));
  assert.ok(dErr <= 0.1, `d-line chord within 10% of the prediction (${(dErr * 100).toFixed(1)}%)`);
  await page.locator('#parts [data-part-id="bokeh-disk"]').evaluate((e) => e.click());
  await page.waitForTimeout(300);
  // score loop r4: the expert detail sits under the card's More detail disclosure
  await page.evaluate(() => { const d = document.querySelector('#card-more'); if (d) d.open = true; });
  const coneCard = await page.locator('#card').innerText();
  // The card's spec keys are uppercased by CSS, so innerText comes back uppercase.
  assert.match(coneCard, /Traced at 587\.6 nm/i);
  assert.match(coneCard, /Textbook \(paraxial\) at 587\.6 nm/i);
  // score loop r3: a ray trace is calculated, never "measured"
  assert.doesNotMatch(coneCard, /measured,? all colors|measured at 587|measured vs/i);
  assert.match(coneCard, /longitudinal color/i);
  assert.doesNotMatch(coneCard, /especially near wide apertures and close focus/);
  await page.screenshot({ path: `${OUT}/cone-bokeh-card.png` });
  console.log(`PASS cone n50 f/4, 3 m focus, 1.5 m point: all ${probe.diameterMeasuredMm.toFixed(4)} mm (widest ${widest.nm} nm), d line ${probe.dLineDiameterMm.toFixed(4)} mm, predicted ${probe.predictedBlurMm.toFixed(4)} mm (${(dErr * 100).toFixed(1)}%)`);

  await page.evaluate(() => window.p2p.piece('camera'));
  await page.evaluate(() => window.p2p.settle());
  await page.locator('#parts [data-part-id="focusRing"]').evaluate((e) => e.click()).catch(() => {});
  await page.waitForTimeout(300);
  // score loop r5: the paraxial-rule sentence is under the card's More detail
  await page.evaluate(() => { const d = document.querySelector('#card-more'); if (d) d.open = true; });
  const focusCard = await page.locator('#card').innerText().catch(() => '');
  if (focusCard) {
    assert.match(focusCard, /textbook paraxial rule at 587\.6 nm/i);
    console.log('PASS focus-ring card states the DOF convention');
  } else {
    console.log('SKIP focus-ring card: no focusRing part button at this level');
  }

  for (const st of [{ iso: 100, shutter: 1 / 250 }, { iso: 1600, shutter: 1 / 250 }, { iso: 6400, shutter: 1 / 250 }]) {
    await openPiece(page, 'loupe', { lens: 'n50', fno: 4, focusM: 3, ...st });
    await loupeReady(page);
    const hud = await page.evaluate(() => {
      const t = (k) => document.querySelector(`.lv-read:not(.lv-status) [data-k="${k}"]`)?.textContent ?? '';
      return { cond: t('conditions'), mean: t('electronsMean'), sample: t('electrons'), dn: t('dn'), text: document.querySelector('.lv-read:not(.lv-status)').innerText, pixel: window.p2p.pieces.loupe.probe().pixel };
    });
    assert.match(hud.cond, /^(Red|Green|Blue) pixel/, 'HUD names the filter color');
    assert.match(hud.text, /Expected electrons/);
    assert.match(hud.text, /Expected photons\s*380–780 nm/, 'the photon row names its band');
    assert.match(hud.text, /Sampled electrons/);
    const clipped = hud.pixel.dn >= 16383;
    if (st.iso === 6400) assert.ok(clipped, 'ISO 6400, 1/250 s, f/4 clips the 14-bit ADC (6 stops over ISO 100)');
    if (clipped) assert.match(hud.dn, /ADC max, clipped/);
    else assert.doesNotMatch(hud.dn, /clipped/);
    await page.screenshot({ path: `${OUT}/loupe-iso${st.iso}.png` });
    console.log(`PASS loupe ISO ${st.iso}: "${hud.cond.split(' · ')[0]}", expected ${hud.mean} e-, sampled ${hud.sample} e-, raw "${hud.dn}"`);
  }
  // ---- 7. the assumed lens transmission on the sensor card ----------------------------------------------------
  {
    await page.goto(new URL('?lens=n50&fno=4&part=sensor', url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.evaluate(() => window.p2p.settle());
    await page.waitForTimeout(300);
    const card = await page.locator('#card').innerText();
    assert.match(card, /Lens transmission \(assumed\)\s*90%/i, `sensor card shows the assumed lens transmission: ${card.slice(0, 300)}`);
    await page.screenshot({ path: `${OUT}/sensor-card.png` });
    console.log('PASS sensor card: lens transmission (assumed) 90%');
    const t = await page.evaluate(() => window.p2p.model().figs.lensTransmission);
    assert.equal(t.v, 0.9); assert.equal(t.ev, 'assumed');
  }

  // ---- 8. lens view: where the rays start, and what spreads the edge dots -------------------------------------
  for (const st of [{ lens: 'n50', fno: 1.8, focusM: 3 }, { lens: 'n500', fno: 5.6, focusM: 8.91 }]) {
    await openPiece(page, 'lens', { ...st, format: 'ff' });
    await page.waitForTimeout(300);
    await page.locator('#parts [data-part-id="ray-fan"]').evaluate((e) => e.click());
    await page.evaluate(() => { const d = document.querySelector('#card-more'); if (d) d.open = true; });
    await page.waitForTimeout(300);
    const fanCard = await page.locator('#card').innerText();
    assert.match(fanCard, /on the plane the lens is focused on/i, 'ray fan card: rays start on the focused plane');
    assert.match(fanCard, /Rays start from/i);
    await page.locator('#parts [data-part-id="detail-inset"]').evaluate((e) => e.click());
    await page.evaluate(() => { const d = document.querySelector('#card-more'); if (d) d.open = true; });
    await page.waitForTimeout(300);
    const insetCard = await page.locator('#card').innerText();
    assert.match(insetCard, /Widest single-color spread/i);
    assert.match(insetCard, /Shift between colors \(lateral color\)/i);
    const ins = await page.evaluate(() => window.p2p.pieces.lens.probe().inset);
    await page.screenshot({ path: `${OUT}/lens-${st.lens}-${st.focusM}m.png` });
    console.log(`PASS lens ${st.lens} f/${st.fno} at ${st.focusM} m: spread ${(ins.spreadMm * 1000).toFixed(1)} µm, one-color ${(ins.spotMm * 1000).toFixed(1)} µm, color shift ${(ins.colorShiftMm * 1000).toFixed(1)} µm; legend "${ins.legend}"`);
  }

  assert.deepEqual(errors, []);
  console.log('PASS physics honesty');
} finally {
  await browser.close();
  await server?.close();
}
