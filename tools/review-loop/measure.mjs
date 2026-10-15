// Correctness review loop, 10/10/2026: drive the live app through setting states, read what is drawn (DOM text,
// drawn geometry, screenshot pixels) and compare it with values recomputed here from first principles
// (tools/review-loop/optics.mjs, CIE data files), never by calling the same engine function.
//
//   P2P_URL=http://127.0.0.1:47630/ node tools/review-loop/measure.mjs [lens,iris,airy,cone,loupe,rain,controls]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { decodePng, pngPixel } from '../accuracy/png.mjs';
import * as O from './optics.mjs';

const base = process.env.P2P_URL || 'http://127.0.0.1:47630/';
const OUT = process.env.OUT || 'docs/review-loop-2026-10-10/correctness';
mkdirSync(OUT, { recursive: true });
const only = new Set((process.argv[2] || 'lens,iris,airy,cone,loupe,rain,controls').split(','));
const results = [];
function check(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name}: ${detail}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function open(piece, scenario) {
  await page.goto(new URL(`?piece=${piece}`, base).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  if (scenario) await page.evaluate((s) => window.p2p.set(s), scenario);
  await page.evaluate(() => window.p2p.settle());
  await page.waitForFunction(() => !window.p2p.framing().moving, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
}
async function setState(scenario) {
  await page.evaluate((s) => window.p2p.set(s), scenario);
  await page.evaluate(() => window.p2p.settle());
  await page.waitForFunction(() => !window.p2p.framing().moving, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** The live model's system as plain data, with each surface's index after it at the wavelengths asked for. */
async function systemData(nms) {
  return page.evaluate((nms) => {
    const m = window.p2p.model();
    const surfaces = m.system.surfaces.map((s) => ({
      z: s.z, c: s.c, k: s.k, a: s.a, sd: s.sd, kind: s.kind, medium: s.mediumAfter,
      doe: s.doe ? { lambda0Nm: s.doe.lambda0Nm, order: s.doe.order, c2: s.doe.coeffs[0], coeffs: s.doe.coeffs.slice() } : null,
      n: Object.fromEntries(nms.map((nm) => { try { return [nm, m.system.index(s.mediumAfter, nm)]; } catch { return [nm, NaN]; } })), // NaN: outside a glass's stated range
    }));
    return {
      scenario: m.scenario, surfaces, iris: { radius: m.iris.radius, blades: m.lens.blades, outlineLen: m.iris.outline.length },
      focus: { distanceMm: m.focus.distanceMm, workingFno: m.focus.workingFno, magnification: m.focus.magnification, objectZ: m.focus.objectZ },
      cardinal: { efl: m.cardinal.efl, ep: m.cardinal.ep, xp: m.cardinal.xp, pupilMag: m.cardinal.pupilMag },
      exposure: m.exposure, sensor: { pitchUm: m.sensor.pitchUm, fullWellE: m.sensor.fullWellE, widthPx: m.sensor.widthPx, heightPx: m.sensor.heightPx },
      diffraction: m.diffraction, lensMaxFno: m.lens.maxFno, lensId: m.lens.id, afOffset: m.realized.realization.afOffset,
    };
  }, nms);
}
const at = (surfs, nm) => surfs.map((s) => ({ ...s, n: s.n[nm], nm }));
const doePowers = (surfs, nm) => surfs.map((s) => (s.doe ? -2 * s.doe.c2 * s.doe.order * (nm / s.doe.lambda0Nm) : 0));
const stopIndex = (surfs) => surfs.findIndex((s) => s.kind === 'stop');
const shot = async (name, opts = {}) => { const path = `${OUT}/${name}.png`; const buf = await page.screenshot({ path, ...opts }); return { path, png: decodePng(buf) }; };

try {
  // ---------------------------------------------------------------------------------------------------------------
  // LENS: ray landing points (rubric: rays at the image plane) and the iris opening.
  if (only.has('lens') || only.has('iris')) {
    await open('lens');
    for (const st of process.env.LENS_STATES ? JSON.parse(process.env.LENS_STATES) : [{ lens: 'n50', fno: 1.8, focusM: 3 }, { lens: 'n50', fno: 8, focusM: 0.45 }, { lens: 's35', fno: 4, focusM: 3 }, { lens: 'z35', fno: 2.8, focusM: 1 }, { lens: 'n500', fno: 8, focusM: 15 }]) {
      await setState(st);
      const probe = await page.evaluate(() => window.p2p.pieces.lens.probe());
      const nms = [...new Set(probe.rays.map((r) => r.nm))];
      const sys = await systemData(nms.concat([587.5618]));
      const tag = `${st.lens}-f${st.fno}-${st.focusM}m`;
      await shot(`lens-${tag}`);
      const png = decodePng(await page.locator('#gl').screenshot());
      const hasDoe = sys.surfaces.some((s) => s.doe);
      if (only.has('lens')) {
        // (1) every drawn ok ray's landing point vs this file's own real trace of the same input ray
        let worst = 0, worstPx = 0, n = 0, failed = 0, offImage = 0, unlit = 0;
        for (const r of probe.rays.filter((r) => r.status === 'ok')) {
          const drawn = r.world[r.world.length - 1], eng = r.engine[r.engine.length - 1];
          const o = r.engine[0], d = [r.engine[1][0] - o[0], r.engine[1][1] - o[1], r.engine[1][2] - o[2]];
          if (Math.hypot(drawn[0] - eng[0], drawn[1] - eng[1], drawn[2] - eng[2]) > 1e-6) offImage++;
          const mine = O.realTrace(at(sys.surfaces, r.nm), o, d);
          if (mine.failed !== null) {
            failed++;
            if (failed <= 40) { const i = mine.failed, e = r.engine[i + 1], prev = mine.pts[mine.pts.length - 1] || o; console.log(`  independent trace stopped at surface ${i} (${sys.surfaces[i].kind}, c ${sys.surfaces[i].c.toFixed(5)}, sd ${sys.surfaces[i].sd.toFixed(2)}); engine hit there at h ${e ? Math.hypot(e[0], e[1]).toFixed(3) : '?'} z ${e ? e[2].toFixed(3) : '?'}; my last point z ${prev[2].toFixed(3)} h ${Math.hypot(prev[0], prev[1]).toFixed(3)}; nm ${r.nm} field ${r.field}`); }
            continue;
          }
          const land = mine.pts[mine.pts.length - 1];
          const err = Math.hypot(land[0] - drawn[0], land[1] - drawn[1]);
          // screen px per mm from the drawn final leg
          const s0 = r.screenFromWorld[r.screenFromWorld.length - 2], s1 = r.screenFromWorld[r.screenFromWorld.length - 1];
          const w0 = r.world[r.world.length - 2];
          const pxPerMm = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) / Math.hypot(drawn[0] - w0[0], drawn[1] - w0[1], drawn[2] - w0[2]);
          worst = Math.max(worst, err); worstPx = Math.max(worstPx, err * pxPerMm); n++;
          // the final leg's midpoint must be lit on screen (the drawn ray is really there)
          const mid = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2];
          let lit = false;
          for (let dx = -2; dx <= 2 && !lit; dx++) for (let dy = -2; dy <= 2 && !lit; dy++) {
            const x = Math.round(mid[0] + dx), y = Math.round(mid[1] + dy);
            if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
            const c = pngPixel(png, x, y); if (Math.max(c[0], c[1], c[2]) > 60) lit = true;
          }
          if (!lit) unlit++;
        }
        check('L1', `${tag} drawn landing = engine landing`, offImage === 0, `${offImage} rays differ`);
        {
          // Score loop r2: DOE lenses are now traced too (optics.mjs realTrace's intrinsic grating step).
          check('L2', `${tag} drawn landing vs independent real trace`, worst < 1e-3 && failed === 0, `${n} rays, max ${(worst * 1000).toFixed(3)} um (${worstPx.toFixed(4)} screen px), ${failed} failed in independent trace (tolerance 1 um)`);
          check('L3', `${tag} final ray legs lit on screen`, unlit <= Math.ceil(n * 0.1), `${n - unlit}/${n} final-leg midpoints lit (others may be hidden behind the barrel cutaway)`);
        }
        // (2) the drawn fan converges where paraxial optics says the image of the focus plane is
        const s587 = at(sys.surfaces, 587.5618), dp = doePowers(sys.surfaces, 587.5618);
        const imgZ = sys.focus.objectZ === null ? O.eflOf(s587, dp).F2 : O.imageZ(s587, sys.focus.objectZ, dp);
        const sensorZ = sys.surfaces[sys.surfaces.length - 1].z;
        // Score loop r5 (10/14/2026): realize.ts solves the best focus per distance (afShift, wide open), so the old check of
        // "paraxial image + one constant afOffset" no longer holds at close focus and failed on a correct engine. This
        // check does not use any of the engine's autofocus numbers: it traces the on-axis point's own rays (wide open, where
        // autofocus runs, in three colors near F, d and C) with this file's Snell trace, finds the plane of least polychromatic
        // RMS blur (the spot variance is exactly quadratic in the plane's z, so the minimum is analytic), and compares the
        // sensor with it. Tolerance 20 um.
        {
          await setState({ ...st, fno: sys.lensMaxFno });
          const wideNm = [486.1327, 587.5618, 656.2725];
          const wide = await systemData(wideNm);
          await setState(st);
          const si = stopIndex(wide.surfaces), stopR = wide.iris.radius, objZ = wide.focus.objectZ;
          const z0 = wide.surfaces[0].z - 20;
          const K = 24; // equal-area rings: the on-axis spot's mean squared radius is the plain mean over these rays
          const pts = [];
          for (const nm of wideNm) {
            const surfs = at(wide.surfaces, nm);
            // launch parameter (slope for a point at a finite distance, ray height for a point at infinity) that puts the ray at height hs in the stop
            const trace = (q) => (objZ === null ? O.realTrace(surfs, [q, 0, z0], [0, 0, 1]) : O.realTrace(surfs, [0, 0, objZ], [q, 0, 1]));
            const at_stop = (q) => { const t = trace(q); return t.failed != null || t.pts.length <= si ? NaN : t.pts[si][0]; };
            for (let k = 0; k < K; k++) {
              const hs = stopR * Math.sqrt((k + 0.5) / K);
              // march the launch parameter up by 5% steps from a small one until the ray reaches height hs in the stop, then bisect
              let lo = 0, hi = objZ === null ? 0.05 : 1e-5, found = false;
              for (let g = 0; g < 400; g++) { const h = at_stop(hi); if (Number.isNaN(h)) break; if (h >= hs) { found = true; break; } lo = hi; hi *= 1.05; }
              if (!found) continue;
              for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (at_stop(mid) < hs) lo = mid; else hi = mid; }
              const t = trace((lo + hi) / 2);
              if (t.failed != null) continue;
              const a = t.pts[t.pts.length - 2], b = t.pts[t.pts.length - 1];
              pts.push({ r: b[0], s: (b[0] - a[0]) / (b[2] - a[2]) });
            }
          }
          let cov = 0, vr = 0;
          for (const q of pts) { cov += q.r * q.s; vr += q.s * q.s; }
          const bestZ = wide.surfaces[wide.surfaces.length - 1].z - cov / vr; // plane z of least RMS blur; z of the sensor plane for the reference
          const res = Math.abs(bestZ - sensorZ);
          check('L4', `${tag} best-focus plane (independent polychromatic RMS minimum, wide open) on the sensor`, pts.length >= 3 * K * 0.8 && res < 0.02, `${pts.length} rays, least-RMS plane z ${bestZ.toFixed(4)} vs sensor z ${sensorZ.toFixed(4)} (residual ${(res * 1000).toFixed(1)} um, tolerance 20 um)`);
        }
      }
      if (only.has('iris')) {
        const s587 = at(sys.surfaces, 587.5618), dp = doePowers(sys.surfaces, 587.5618), si = stopIndex(sys.surfaces);
        // stop radius for the marked f-number is defined at infinity focus: use the JSON-free route, the model's own
        // infinity EFL is not used; compare at the current system only when the stop sits before every moving group
        await setState({ ...st, focusM: null });
        const inf = await systemData([587.5618]);
        const want = O.stopRadiusForFno(at(inf.surfaces, 587.5618), stopIndex(inf.surfaces), sys.scenario.fno, doePowers(inf.surfaces, 587.5618));
        await setState(st);
        // Score loop r2: read the iris after its <=150 ms blade animation finishes (the probe taken before the
        // infinity round trip above could catch it mid-move: 9.982 mm against a settled 10.322 mm).
        await page.waitForFunction(() => { const p = window.p2p.pieces.lens.probe(); return Math.abs(p.iris.drawnRadius - p.iris.modelRadius) < 1e-6; }, null, { timeout: 3000 }).catch(() => {});
        const drawn = (await page.evaluate(() => window.p2p.pieces.lens.probe())).iris.drawnRadius;
        check('I1', `${tag} iris radius vs independent stop radius for f/${sys.scenario.fno}`, Math.abs(drawn / want - 1) < 0.01, `drawn ${drawn.toFixed(4)} mm, model ${sys.iris.radius.toFixed(4)}, independent (infinity system, EPD = EFL/N) ${want.toFixed(4)} (${((drawn / want - 1) * 100).toFixed(2)}%, tolerance 1%; focus moves can change EFL slightly)`);
        const nw = O.workingFno(s587, si, sys.iris.radius, sys.focus.objectZ, dp);
        check('I2', `${tag} working f-number`, Math.abs(sys.focus.workingFno / nw - 1) < 0.01, `engine ${sys.focus.workingFno.toFixed(4)} vs independent 1/(2u') ${nw.toFixed(4)} (${((sys.focus.workingFno / nw - 1) * 100).toFixed(2)}%, tolerance 1%)`);
        writeFileSync(`${OUT}/sys-${tag}.json`, JSON.stringify({ sys: { ...sys, surfaces: sys.surfaces.map((s) => ({ ...s })) }, iris: probe.iris }, null, 1));
      }
    }
  }
  // ---------------------------------------------------------------------------------------------------------------
  // AIRY: the first dark ring on the diffraction canvas vs 1.22 lambda N_w at the sensor's own pitch.
  if (only.has('airy')) {
    await open('lens', { lens: 'n50', fno: 4, focusM: 3 });
    await page.locator('.diffraction-launch:visible button').click();
    const dialog = page.locator('#diffraction-lens');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('.diffraction-ring input').uncheck();
    for (const st of [{ fno: 4, nm: 550 }, { fno: 8, nm: 450 }, { fno: 16, nm: 650 }, { fno: 22, nm: 550 }]) {
      await setState({ fno: st.fno });
      await dialog.evaluate((d, nm) => { const w = d.querySelector('.diffraction-wavelength'); w.value = String(nm); w.dispatchEvent(new Event('input')); }, st.nm);
      await page.waitForFunction((nm) => window.p2p.pieces.lens.diffraction().nm === nm, st.nm);
      await page.waitForTimeout(150);
      const sys = await systemData([587.5618]);
      const s587 = at(sys.surfaces, 587.5618);
      const nw = O.workingFno(s587, stopIndex(sys.surfaces), sys.iris.radius, sys.focus.objectZ, doePowers(sys.surfaces, 587.5618));
      const pitchMm = 35.9 / 8256; // D850 active width / effective columns (data/d850.json, Wikipedia infobox)
      const span = 17 * pitchMm, size = 408;
      const wantRaster = (1.22 * st.nm * 1e-6 * nw) / span * size;
      // walk the canvas's center row outward and find the first local minimum of brightness
      const row = await dialog.evaluate((d) => {
        const c = d.querySelector('.diffraction-pattern'), g = c.getContext('2d');
        const data = g.getImageData(0, 0, c.width, c.height).data, y = c.height / 2;
        return Array.from({ length: c.width / 2 }, (_, i) => { const x = c.width / 2 + i, o = (y * c.width + x) * 4; return Math.max(data[o], data[o + 1], data[o + 2]); });
      });
      // subpixel: first index where brightness stops falling, refined by a parabola through the three samples
      // the 1-pixel grid (408/17 = 24 raster px per sensor pixel) is stroked over the pattern at offsets 12 + 24j
      // from the center; those columns are not pattern samples, so replace them by linear interpolation
      const onGrid = (i) => { const m = (i + 12) % 24; return m <= 1 || m >= 23; };
      for (let i = 1; i < row.length - 1; i++) if (onGrid(i)) row[i] = NaN;
      for (let i = 1; i < row.length - 1; i++) if (Number.isNaN(row[i])) { let l = i - 1, r = i + 1; while (Number.isNaN(row[l])) l--; while (r < row.length - 1 && Number.isNaN(row[r])) r++; row[i] = row[l] + (row[r] - row[l]) * (i - l) / (r - l); }
      let k = 2; while (k < row.length - 1 && !(row[k] <= row[k - 1] && row[k] < row[k + 1])) k++;
      const a = row[k - 1], b = row[k], c = row[k + 1], off = (a - c) / (2 * (a - 2 * b + c) || 1);
      const measured = k + 0.5 + off; // pixel centers sit at x + 0.5 from the canvas center
      const stats = await dialog.locator('.diffraction-stats').innerText();
      const um = Number(/First dark ring · radius\s*([\d.]+) µm/.exec(stats)?.[1]);
      await dialog.screenshot({ path: `${OUT}/airy-f${st.fno}-${st.nm}nm.png` });
      // center-pixel energy: integrate [2 J1(x)/x]^2 over one square pixel (100% fill), J1 from Bessel's integral
      // J1(x) = (1/pi) int_0^pi cos(tau - x sin tau) dtau, normalized by the total 4 lambda^2 N^2 / pi (mm^2)
      const J1 = (x) => { let s = 0; const n = 200; for (let i = 0; i < n; i++) { const t = (i + 0.5) * Math.PI / n; s += Math.cos(t - x * Math.sin(t)); } return s / n; };
      const lam = st.nm * 1e-6, g = 120, h = pitchMm / g;
      let e = 0;
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
        const r = Math.hypot((i + 0.5) * h - pitchMm / 2, (j + 0.5) * h - pitchMm / 2), x = Math.PI * r / (lam * nw);
        const a = x < 1e-9 ? 1 : 2 * J1(x) / x; e += a * a * h * h;
      }
      const wantCenter = e / (4 * lam * lam * nw * nw / Math.PI);
      const shownCenter = Number(/Center pixel collects\s*([\d.]+)%/.exec(stats)?.[1]) / 100;
      check('A3', `Airy center-pixel energy readout, f/${st.fno} ${st.nm} nm`, Math.abs(shownCenter - wantCenter) < 0.0015, `readout ${(shownCenter * 100).toFixed(1)}% vs independent square-pixel integral ${(wantCenter * 100).toFixed(2)}%`);
      check('A1', `Airy first dark ring on canvas, f/${st.fno} ${st.nm} nm`, Math.abs(measured - wantRaster) <= 1.0, `measured ${measured.toFixed(2)} raster px vs independent 1.22*lambda*N_w ${wantRaster.toFixed(2)} (N_w ${nw.toFixed(3)}, pitch ${(pitchMm * 1000).toFixed(3)} um; tolerance 1 raster px)`);
      const wantUm = 1.22 * st.nm * 1e-3 * nw;
      check('A2', `Airy radius readout, f/${st.fno} ${st.nm} nm`, Math.abs(um - wantUm) < 0.01 + 0.005 * wantUm, `readout ${um} um vs independent ${wantUm.toFixed(3)} um`);
    }
    await dialog.locator('.diffraction-close').click();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // CONE: the drawn bokeh disk (geometry mask) vs the paraxial marginal-ray blur diameter at the sensor.
  if (only.has('cone')) {
    const CL = process.env.CONE_LENS || 'n50';
    await open('cone', { lens: CL, fno: 8, focusM: 3 });
    await page.evaluate(() => document.getElementById('reset-view')?.click());
    await page.waitForTimeout(2600);
    for (const st of [{ fno: 8, point: 1500 }, { fno: 4, point: 1500 }, { fno: 8, point: 10000 }, { fno: 2.8, point: 800 }]) {
      await setState({ lens: CL, fno: st.fno, focusM: 3 });
      await page.evaluate(([d]) => window.p2p.pieces.cone.setPoint(d, 0), [st.point]);
      await page.evaluate(() => window.p2p.pieces.cone.geometryMask(true));
      await page.evaluate(() => window.p2p.settle()); await page.evaluate(() => window.p2p.gpuIdle());
      await page.waitForTimeout(200);
      const probe = await page.evaluate(() => window.p2p.pieces.cone.probe());
      const view = await page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; });
      const r = probe.inset.rect;
      const clip = { x: view.x + r.left, y: view.y + (view.height - r.bottom - r.height), width: r.width, height: r.height };
      const buf = await page.screenshot({ clip, path: `${OUT}/cone-f${st.fno}-pt${st.point}.png` });
      await page.evaluate(() => window.p2p.pieces.cone.geometryMask(false));
      const img = decodePng(buf);
      // the DOM's own scale label ("1 square = 1 pixel · X mm across") gives mm per screen pixel without the probe
      const label = await page.evaluate(() => [...document.querySelectorAll('.piece-overlay[data-piece="cone"] .lv-inset-note')].map((e) => e.textContent).find((t) => t && /(mm|µm) across/i.test(t) && /square/i.test(t)) || '');
      const lm = /([\d.]+)\s*(mm|µm) across/i.exec(label);
      const acrossMm = lm ? Number(lm[1]) / (lm[2] === 'µm' ? 1000 : 1) : NaN;
      const mmPerPx = probe.inset.mmPerPixel;
      check('C0', `cone inset scale label f/${st.fno} point ${st.point / 1000} m`, Math.abs(acrossMm / (mmPerPx * clip.width) - 1) < 0.01, `DOM "${lm?.[0]}" vs inset ${(mmPerPx * clip.width).toFixed(4)} mm`);
      let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, nLit = 0;
      // skip the inset's own caption ("ON THE PIXELS", white text in the top-left band)
      for (let y = 26; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const c = pngPixel(img, x, y);
        if (Math.min(c[0], c[1], c[2]) > 110) { nLit++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
      const drawnMm = ((maxX - minX + 1 + maxY - minY + 1) / 2) * mmPerPx;
      const binCenters = Array.from({ length: 16 }, (_, i) => 380 + 25 * (i + 0.5)); // data/color/wavelength-bins-16.json
      const sys = await systemData([587.5618, ...binCenters]);
      const s587 = at(sys.surfaces, 587.5618), dp = doePowers(sys.surfaces, 587.5618);
      const sensorZ = sys.surfaces[sys.surfaces.length - 1].z;
      const objectZ = sensorZ - (probe.pointDistMm ?? st.point); // the slider quantizes the asked distance
      const parax = O.paraxBlurDiameter(s587, stopIndex(sys.surfaces), sys.iris.radius, objectZ, sensorZ, dp);
      // polychromatic: the widest paraxial blur over the 16 bins the cone traces (longitudinal color included)
      const traceable = binCenters.filter((nm) => sys.surfaces.every((x) => Number.isFinite(x.n[nm])));
      const perBin = traceable.map((nm) => O.paraxBlurDiameter(at(sys.surfaces, nm), stopIndex(sys.surfaces), sys.iris.radius, objectZ, sensorZ, doePowers(sys.surfaces, nm)));
      const paraxPoly = Math.max(...perBin);
      check('C5', `cone drawn disk vs independent polychromatic paraxial ${CL} f/${st.fno}, point ${st.point / 1000} m`, Math.abs(((maxX - minX + 1 + maxY - minY + 1) / 2) * probe.inset.mmPerPixel / paraxPoly - 1) < 0.08, `drawn ${(((maxX - minX + 1 + maxY - minY + 1) / 2) * probe.inset.mmPerPixel).toFixed(4)} mm vs widest bin ${paraxPoly.toFixed(4)} mm at ${traceable[perBin.indexOf(paraxPoly)]} nm (${traceable.length} traceable bins) (d line ${parax.toFixed(4)} mm; tolerance 8% for splat size and spherical aberration)`);
      // a thin-lens cross-check with no pupil correction: c = f^2 |s - s_f| / (N s (s_f - f))
      const f = sys.cardinal.efl, s = probe.pointDistMm ?? st.point, sf = 3000;
      const thin = (f * f * Math.abs(s - sf)) / (st.fno * s * (sf - f));
      const rel = drawnMm / parax - 1;
      // independent exit pupil: image of the stop through the surfaces after it (paraxial, d line)
      {
        const si = stopIndex(sys.surfaces), rest = s587.slice(si).filter((x) => x.kind !== 'image');
        const tr = (y0, u0) => { let y = y0, u = u0, n = 1; for (let i = 0; i < rest.length; i++) { if (i > 0) y += u * (rest[i].z - rest[i - 1].z); const phi = i === 0 ? 0 : (rest[i].n - n) * rest[i].c + dp[si + i]; u = (n * u - y * phi) / rest[i].n; n = rest[i].n; } return { y, u, z: rest[rest.length - 1].z }; };
        const c0 = tr(0, 1e-3), zxp = c0.z - c0.y / c0.u;
        const e0 = tr(sys.iris.radius, 0), rxp = Math.abs(e0.y + e0.u * (zxp - e0.z));
        const izp = O.imageZ(s587, objectZ, dp), myPred = 2 * rxp * Math.abs(izp - sensorZ) / Math.abs(izp - zxp);
        const eng = await page.evaluate((d) => { const m = window.p2p.model(); return { sensorZ: m.system.surfaces[m.system.surfaces.length - 1].z, focus: m.focus.distanceMm }; });
        check('C6', `(info) exit pupil ${CL} f/${st.fno}`, true, `engine xp z ${sys.cardinal.xp.z.toFixed(3)} r ${sys.cardinal.xp.r.toFixed(4)} vs independent z ${zxp.toFixed(3)} r ${rxp.toFixed(4)}; similar-triangles with independent pupil and image ${myPred.toFixed(4)} mm; point image z ${izp.toFixed(3)}, sensor z ${sensorZ.toFixed(3)} (model ${eng.sensorZ.toFixed(3)}), objectZ ${objectZ.toFixed(1)}`);
      }
      // R-C1: the engine's closed-form prediction (drawn as the dashed ring) vs this file's paraxial marginal ray
      const predRel = probe.predictedBlurMm / parax - 1;
      check('C3', `cone predicted-blur ring ${CL} f/${st.fno}, point ${st.point / 1000} m (slider ${((probe.pointDistMm ?? st.point) / 1000).toFixed(4)} m)`, Math.abs(predRel) < 0.005, `engine predicted ${probe.predictedBlurMm.toFixed(4)} mm vs independent paraxial ${parax.toFixed(4)} mm (${(predRel * 100).toFixed(2)}%, tolerance 0.5%)`);
      // the drawn disk must be the traced chord plus at most about one splat diameter
      const chordPx = probe.diameterMeasuredMm / mmPerPx, drawnPx = (maxX - minX + 1 + maxY - minY + 1) / 2;
      check('C4', `cone drawn disk vs traced chord ${CL} f/${st.fno}, point ${st.point / 1000} m`, drawnPx >= chordPx * 0.9 && drawnPx <= chordPx * 1.2, `drawn ${drawnPx.toFixed(1)} px vs traced chord ${chordPx.toFixed(1)} px (${((drawnPx / chordPx - 1) * 100).toFixed(1)}%)`);
      check('C1', `(info) cone drawn disk vs d-line-only paraxial ${CL} f/${st.fno}, point ${st.point / 1000} m, focus 3 m`, true, `drawn ${drawnMm.toFixed(4)} mm (${maxX - minX + 1}x${maxY - minY + 1} px at ${(mmPerPx * 1000).toFixed(2)} um/px from the inset), independent paraxial ${parax.toFixed(4)} mm (${(rel * 100).toFixed(1)}%), thin-lens ${thin.toFixed(4)} mm, engine chord ${probe.diameterMeasuredMm.toFixed(4)} / predicted ${probe.predictedBlurMm.toFixed(4)} mm; informational: the drawn disk spans all 16 bins, see C5`);
    }
    // cat's eye at the frame edge, wide open
    await setState({ lens: CL, fno: 1.8, focusM: 3 });
    for (const field of [0, 1]) {
      await page.evaluate(([d, f]) => window.p2p.pieces.cone.setPoint(d, f), [1500, field]);
      await page.evaluate(() => window.p2p.settle());
      const probe = await page.evaluate(() => window.p2p.pieces.cone.probe());
      const xs = probe.landing.map((p) => p.x), ys = probe.landing.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      check('C2', `cone landing extent ${CL} wide open field ${field}`, field === 0 ? Math.abs(w / h - 1) < 0.05 : w / h > 1.2, `sagittal ${w.toFixed(3)} mm x meridional ${h.toFixed(3)} mm (aspect ${(w / h).toFixed(3)}; on axis must be round, the corner a cat's eye narrowed meridionally)`);
    }
  }
  // ---------------------------------------------------------------------------------------------------------------
  // LOUPE: the reference pixel's readouts vs a 1 nm CIE integration, the D850 record, and the drawn well.
  if (only.has('loupe')) {
    const day = JSON.parse(readFileSync('data/color/daylight-basis-s0s1s2.json', 'utf8'));
    const cmf = JSON.parse(readFileSync('data/color/cie1931-2deg-cmf.json', 'utf8'));
    const d850Record = JSON.parse(readFileSync(process.env.SENSOR_JSON || 'data/d850.json', 'utf8'));
    const d850 = d850Record.sensor;
    // The record's own read-noise points (Claff, e- rms by ISO), interpolated log-log at the state's ISO exactly as the
    // model does, so the P5 tolerance uses the real figure (4.11 e- at ISO 100, 1.24 e- at ISO 1600) and not a fixed 3 e-.
    const readNoiseAt = (iso) => {
      const pts = d850Record.readNoise.points;
      if (iso <= pts[0].iso) return pts[0].readNoiseE;
      if (iso >= pts[pts.length - 1].iso) return pts[pts.length - 1].readNoiseE;
      let i = 0; while (pts[i + 1].iso < iso) i++;
      const t = (Math.log2(iso) - Math.log2(pts[i].iso)) / (Math.log2(pts[i + 1].iso) - Math.log2(pts[i].iso));
      return 2 ** (Math.log2(pts[i].readNoiseE) + t * (Math.log2(pts[i + 1].readNoiseE) - Math.log2(pts[i].readNoiseE)));
    };
    const BLACK = d850.blackLevelDn?.v ?? 512; // the record's black level; 512 is the engine's uncited default
    const LL = process.env.LOUPE_LENS || 'n50';
    const lerp = (xs, ys, x) => { let i = xs.findIndex((v) => v >= x); if (i <= 0) return ys[Math.max(0, i)]; const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + t * (ys[i] - ys[i - 1]); };
    // CIE 015:2018 daylight: xD from the cubic in 1/T (4000-7000 K), yD, then M1/M2 rounded to 3 decimals
    const daylight = (T) => {
      const x = 0.244063 + 99.11 / T + 2.9678e6 / T ** 2 - 4.607e9 / T ** 3, y = -3 * x * x + 2.87 * x - 0.275;
      const M = 0.0241 + 0.2562 * x - 0.7341 * y;
      const M1 = Math.round((-1.3515 - 1.7703 * x + 5.9114 * y) / M * 1000) / 1000, M2 = Math.round((0.03 - 31.4424 * x + 30.0717 * y) / M * 1000) / 1000;
      return (nm) => lerp(day.lambda, day.values.S0, nm) + M1 * lerp(day.lambda, day.values.S1, nm) + M2 * lerp(day.lambda, day.values.S2, nm);
    };
    const ybar = (nm) => lerp(cmf.lambda, cmf.values.y_bar, nm);
    const H = 6.62607015e-34, C = 299792458;
    /** photons on one pixel from an 18% Lambertian gray: E_img(l) = rho E(l) T / (4 N_w^2) (camera equation,
     *  cos^4 = 1 on axis), 1 nm steps over 380-780 nm, E(l) scaled so 683 * int E V = lux. */
    const photonsIndependent = ({ lux, cct, T, Nw, pitchUm, t }) => {
      const S = daylight(cct); let lum = 0, ph = 0;
      for (let nm = 380; nm <= 780; nm++) lum += S(nm) * ybar(nm);
      const k = lux / (683 * lum);
      for (let nm = 380; nm <= 780; nm++) ph += (0.18 * k * S(nm) * T / (4 * Nw * Nw)) * (pitchUm * 1e-6) ** 2 * t / (H * C / (nm * 1e-9));
      return ph;
    };
    await open('loupe', { lens: LL, fno: 4, focusM: 3, shutter: 1 / 250, iso: 100 });
    const readLoupe = async () => {
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel, null, { timeout: 60000 });
      await page.waitForTimeout(200);
      return page.evaluate(() => {
        const t = (k) => document.querySelector(`.lv-read [data-k="${k}"]`)?.textContent ?? '';
        const num = (k) => Number((t(k).match(/[\d,.]+/) ?? [''])[0].replace(/,/g, '')); // leading number; the raw value may carry an 'ADC max, clipped' note
        const m = window.p2p.model();
        return { photons: num('photons'), electrons: num('electrons'), fill: num('fill'), dn: num('dn'), cond: t('conditions'),
          pixel: window.p2p.pieces.loupe.probe().pixel, drawn: window.p2p.pieces.loupe.drawnFill(), wellBar: document.querySelector('.lv-read-well i')?.style.width,
          Nw: m.focus.workingFno, pitchUm: m.sensor.pitchUm, fullWell: m.sensor.fullWellE, scenario: m.scenario };
      });
    };
    const runs = [];
    for (const st of [{ iso: 100, shutter: 1 / 250 }, { iso: 1600, shutter: 1 / 250 }, { iso: 100, shutter: 1 / 125 }, { iso: 100, shutter: 1 / 15 }, { iso: 400, shutter: 1 / 2000, fno: 8 }]) {
      await setState({ lens: LL, fno: 4, focusM: 3, ...st });
      const r = await readLoupe(); runs.push({ st, r });
      await shot(`loupe-iso${st.iso}-t${Math.round(1 / st.shutter)}${st.fno ? '-f' + st.fno : ''}`);
      const tag = `ISO ${st.iso}, 1/${Math.round(1 / st.shutter)} s, f/${r.scenario.fno}`;
      const want = photonsIndependent({ lux: 10000, cct: 5500, T: 0.9, Nw: r.Nw, pitchUm: 35.9 / 8256 * 1000, t: r.scenario.shutter });
      check('P1', `loupe expected photons, ${tag}`, Math.abs(r.photons / want - 1) < 0.02, `readout ${r.photons} vs independent 1 nm CIE integration ${want.toFixed(0)} (${((r.photons / want - 1) * 100).toFixed(2)}%; T = 0.9 assumed, N_w ${r.Nw.toFixed(3)}, pitch from 35.9 mm / 8256; tolerance 2%)`);
      const fwc = d850.fullWellElectrons.photonstophotosRN_e.v;
      check('P2', `loupe full well = D850 record, ${tag}`, r.fullWell === fwc, `model ${r.fullWell} e- vs data/d850.json ${fwc} e-`);
      const frac = r.electrons / fwc;
      check('P3', `loupe "Well filled" = electrons / full well, ${tag}`, Math.abs(r.fill - frac * 100) <= 0.051 + 0.001 * frac * 100, `readout ${r.fill}% vs ${r.electrons} / ${fwc} = ${(frac * 100).toFixed(2)}%`);
      // The well draws at least a 0.015-unit sliver (about 0.4% of its height) so a nearly empty well stays visible. When
      // the true fill is under that minimum the check compares against the minimum and says so ('floor applied').
      const floorFrac = 0.015 / r.drawn.wellHeightUnits, floorApplied = frac < floorFrac;
      check('P4', `drawn well height = electrons / full well, ${tag}`, Math.abs(r.drawn.fillHeightUnits / r.drawn.wellHeightUnits - Math.max(frac, floorFrac)) < 0.002, `drawn ${(r.drawn.fillHeightUnits / r.drawn.wellHeightUnits).toFixed(4)} vs ${frac.toFixed(4)}${floorApplied ? ` (floor applied: the true fill is under the ${floorFrac.toFixed(4)} minimum height, so the drawn well is compared with the minimum)` : ''} (bar ${r.wellBar})`);
      // brightness: chargeMaterial multiplies the base color by 0.22 + 0.78 * fill
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const base = await page.evaluate(() => { const m = window.p2p.pieces.loupe.drawnFill(); return m.chargeColor; });
      runs[runs.length - 1].chargeLum = lum(base);
      // DN = (e + read noise) * ISO / unity-gain ISO + black level -> within 4 sigma of read noise. The black level is
      // the sensor record's own (D850: 400 DN, reported; score loop r2, this used to hard-code 512 and failed P5/P6).
      const ug = d850.conversionGain.unityGainIso.v, gain = r.scenario.iso / ug;
      const expDn = Math.min(16383, r.electrons * gain + BLACK); // 14-bit ADC clips at 2^14 - 1
      const rnE = readNoiseAt(r.scenario.iso); // from the record's own points; no fixed fallback
      const rnModel = r.pixel.readNoise;       // what the loupe shows, which must agree with the record
      check('P5', `loupe raw value from electrons, ${tag}`, Math.abs(r.dn - expDn) <= 4 * rnE * gain + 1 && Math.abs(rnModel / rnE - 1) < 0.01, `readout ${r.dn} DN vs ${r.electrons} e- x ${gain.toFixed(4)} DN/e- (ISO ${r.scenario.iso} / unity ${ug}) + ${BLACK} = ${expDn.toFixed(1)} (read noise ${rnE.toFixed(2)} e- from data/d850.json readNoise.points; loupe pixel ${Number(rnModel).toFixed(2)} e-; tolerance 4 sigma = ${(4 * rnE * gain + 1).toFixed(1)} DN)`);
    }
    const [a, b, c2, d] = runs;
    check('P6', 'loupe: ISO 100 -> 1600 leaves photons and electrons, multiplies DN above black by ~16 (or clips at 16383)', a.r.photons === b.r.photons && a.r.electrons === b.r.electrons && (b.r.dn === 16383 || Math.abs((b.r.dn - BLACK) / (a.r.dn - BLACK) / 16 - 1) < 0.05), `photons ${a.r.photons} / ${b.r.photons}, electrons ${a.r.electrons} / ${b.r.electrons}, (DN-${BLACK}) ratio ${((b.r.dn - BLACK) / (a.r.dn - BLACK)).toFixed(2)}`);
    check('P7', 'loupe: doubling the shutter time doubles expected photons', Math.abs(c2.r.photons / a.r.photons - 2) < 0.002, `${a.r.photons} -> ${c2.r.photons} (x${(c2.r.photons / a.r.photons).toFixed(4)})`);
    const fr = (r) => r.r.electrons / r.r.fullWell;
    check('P8', '(info) charge brightness vs fill fraction', true, runs.map((r) => `fill ${(fr(r) * 100).toFixed(1)}% -> color luminance ${r.chargeLum.toFixed(3)}`).join('; ') + ' (chargeMaterial: 0.22 + 0.78 * fill)');
    check('P9', 'loupe: 1/15 s fills the well further (clips at full well)', fr(d) > fr(a), `fill ${(fr(a) * 100).toFixed(1)}% -> ${(fr(d) * 100).toFixed(1)}%`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // RAIN: shot noise in the photon-rain experiment, std of the per-pixel counts vs sqrt(mean).
  if (only.has('rain')) {
    await open('loupe', { lens: 'n50', fno: 4, focusM: 3 });
    const stats = await page.evaluate(async () => {
      const mod = await import('/src/app/photon-rain-model.ts');
      const out = [];
      for (const [mean, seed] of [[6, 37], [96, 37], [6, 11], [1500, 5]]) {
        const ref = mod.dimReference(window.p2p.model());
        const exp = { ...mod.rainExperiment(ref, seed) };
        // scale: rainExperiment reads model.exposure.photonsMidGray; build a model at the asked mean instead
        const api = await import('/src/app/engine-api.ts');
        const unit = api.compute({ ...ref.scenario, lux: ref.scenario.lux * mean / ref.exposure.photonsMidGray });
        const e = mod.rainExperiment(unit, seed);
        const counts = e.samples.map((s) => s.length);
        const mu = counts.reduce((x, y) => x + y, 0) / counts.length;
        const sd = Math.sqrt(counts.reduce((x, y) => x + (y - mu) ** 2, 0) / (counts.length - 1));
        const snap = mod.rainSnapshot(e, 1);
        out.push({ mean: e.mean, mu, sd, sigmaShown: snap.sigma, observedMean: snap.observedMean, dimMean: exp.mean });
      }
      return out;
    });
    for (const s of stats) {
      const tol = 4 * Math.sqrt(s.mean) / Math.sqrt(2 * 255); // 4 standard errors of a sample std over 256 pixels
      check('N1', `photon rain sample std vs sqrt(mean) at mean ${s.mean.toFixed(1)}`, Math.abs(s.sd - Math.sqrt(s.mean)) < tol && Math.abs(s.sigmaShown - Math.sqrt(s.mean)) < 1e-9, `sample std ${s.sd.toFixed(3)} vs sqrt(mean) ${Math.sqrt(s.mean).toFixed(3)} (tolerance ${tol.toFixed(3)} = 4 standard errors); shown sigma ${s.sigmaShown.toFixed(3)}; sample mean ${s.mu.toFixed(2)} = shown ${s.observedMean.toFixed(2)}; dim reference mean ${s.dimMean.toFixed(3)}`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // CONTROLS: each control changes the frame, in the predicted direction.
  if (only.has('controls')) {
    const pix = async () => decodePng(await page.locator('#gl').screenshot());
    const diff = (p, q) => { let n = 0; for (let i = 0; i < p.data.length; i += 4) if (Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]) > 30) n++; return n; };
    await open('lens', { lens: 'n50', fno: 1.8, focusM: 3 });
    const wide = await pix();
    const okWide = await page.evaluate(() => window.p2p.pieces.lens.probe().rays.filter((r) => r.status === 'ok').length);
    await setState({ fno: 11 });
    const narrow = await pix();
    const probe = await page.evaluate(() => window.p2p.pieces.lens.probe());
    check('K1', 'lens: f/1.8 -> f/11 changes the frame and narrows the iris to the f-number ratio', diff(wide, narrow) > 2000 && Math.abs(probe.iris.drawnRadius / probe.iris.modelRadius - 1) < 1e-6, `${diff(wide, narrow)} changed pixels; ok rays ${okWide} -> ${probe.rays.filter((r) => r.status === 'ok').length}`);
    await open('cone', { lens: 'n50', fno: 4, focusM: 3 });
    await page.evaluate(() => window.p2p.pieces.cone.setPoint(1500, 0)); await page.evaluate(() => window.p2p.settle());
    const p4 = await page.evaluate(() => window.p2p.pieces.cone.probe());
    await setState({ fno: 8 });
    const p8 = await page.evaluate(() => window.p2p.pieces.cone.probe());
    check('K2', 'cone: f/4 -> f/8 halves the bokeh disk', Math.abs(p8.diameterMeasuredMm / p4.diameterMeasuredMm - 0.5) < 0.05, `${p4.diameterMeasuredMm.toFixed(4)} -> ${p8.diameterMeasuredMm.toFixed(4)} mm (ratio ${(p8.diameterMeasuredMm / p4.diameterMeasuredMm).toFixed(3)}, expected ~0.5)`);
    await setState({ focusM: 1.5 });
    const pf = await page.evaluate(() => window.p2p.pieces.cone.probe());
    // r3 (10/11/2026): the reported disk is the recorded-light (sensor-weighted, 90% energy) diameter; a point on the
    // focus plane must come out within the circle of confusion, the DOF readout's own sharpness criterion.
    check('K3', 'cone: a point at the focus distance records within the CoC', pf.recordedDiameterMm <= pf.cocMm, `point 1.5 m, focus 1.5 m, f/8: recorded ${(pf.recordedDiameterMm * 1000).toFixed(1)} um vs CoC ${(pf.cocMm * 1000).toFixed(1)} um (widest extent, all colors equally: ${(pf.diameterMeasuredMm * 1000).toFixed(1)} um = ${(pf.diameterMeasuredMm / (pf.pitchUm / 1000)).toFixed(1)} px)`);
    await setState({ fno: 4, focusM: 3 });
    await page.evaluate(() => window.p2p.pieces.cone.setPoint(2980, 0)); await page.evaluate(() => window.p2p.settle());
    const pf4 = await page.evaluate(() => window.p2p.pieces.cone.probe());
    check('K3b', 'cone: n50 f/4, focus 3 m, point 2.98 m (inside the DOF) records within the CoC', pf4.recordedDiameterMm <= pf4.cocMm, `recorded ${(pf4.recordedDiameterMm * 1000).toFixed(1)} um vs CoC ${(pf4.cocMm * 1000).toFixed(1)} um; widest extent ${(pf4.diameterMeasuredMm * 1000).toFixed(1)} um; point ${(pf4.pointDistMm / 1000).toFixed(3)} m`);
  }
  // ---------------------------------------------------------------------------------------------------------------
  // COLOR: the same wavelength drawn as a lens ray and as a photon-rain dot must be pixel-identical (rubric), and
  // the ends of the visible range must stay visible (LOOK.md, display-brightness normalization).
  if (only.has('color')) {
    await open('lens', { lens: 'n50', fno: 1.8, focusM: 3 });
    const nms = [392.5, 442.5, 492.5, 542.5, 592.5, 642.5, 692.5, 742.5, 767.5];
    const rayColors = await page.evaluate((nms) => nms.map((nm) => window.p2p.pieces.lens.wavelengthSrgb255(nm)), nms);
    // the rain canvas: open the dialog, play to the end, collect the distinct dot colors actually painted
    await open('loupe', { lens: 'n50', fno: 4, focusM: 3 });
    const launch = page.getByRole('button', { name: 'Photon rain & noise', exact: true });
    await launch.click();
    await page.locator('#photon-rain').waitFor({ state: 'visible' });
    await page.locator('[data-rain=compare]').click();
    await page.locator('[data-rain=time]').evaluate((el) => { el.value = '1000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    await page.locator('#photon-rain').screenshot({ path: `${OUT}/rain-colors.png` });
    const painted = await page.locator('[data-rain=rain]').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Map();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && Math.max(d[i], d[i + 1], d[i + 2]) > 60) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; seen.set(k, (seen.get(k) || 0) + 1); }
      return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([k, n]) => [k.split(',').map(Number), n]);
    });
    let matched = 0, missing = [];
    for (let i = 0; i < nms.length; i++) {
      const want = rayColors[i];
      const hit = painted.some(([c]) => Math.max(Math.abs(c[0] - want[0]), Math.abs(c[1] - want[1]), Math.abs(c[2] - want[2])) <= 2);
      if (hit) matched++; else missing.push(`${nms[i]} nm ray [${want}]`);
    }
    const commonest = painted.slice(0, 6).map(([c, n]) => `[${c}]x${n}`).join(' ');
    check('S1', 'a photon-rain dot and a lens ray of the same wavelength share one color', missing.length <= 1, `${matched}/${nms.length} ray colors found among the rain's painted dot cores; missing: ${missing.join('; ') || 'none'}; most common rain colors ${commonest}`);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const dark = nms.filter((nm, i) => Math.max(...rayColors[i]) < 128);
    check('S2', 'ray colors stay visible across 392-768 nm (no channel peak below 128/255)', dark.length === 0, rayColors.map((c, i) => `${nms[i]}:[${c}]`).join(' ') + ` (luma ${rayColors.map((c) => lum(c).toFixed(0)).join('/')})`);
    await page.keyboard.press('Escape');
  }
  // ---------------------------------------------------------------------------------------------------------------
  // DOF and EV readouts (rig cards / exposure details) vs independent paraxial solves and the exposure equation.
  if (only.has('dof')) {
    await open('camera');
    for (const st of [{ lens: 'n50', fno: 4, focusM: 3 }, { lens: 'n50', fno: 16, focusM: 1 }, { lens: 's35', fno: 8, focusM: 2 }, { lens: 'z35', fno: 2.8, focusM: 5 }, { lens: 'n500', fno: 8, focusM: 30 }, { lens: 'z800', fno: 11, focusM: 50 }]) {
      await setState({ ...st, shutter: 1 / 250, iso: 400 });
      const sys = await systemData([587.5618]);
      const m = await page.evaluate(() => { const m = window.p2p.model(); return { near: m.focus.nearMm, far: m.focus.farMm, coc: m.focus.cocMm, ev: m.exposure.ev100, fno: m.scenario.fno, t: m.scenario.shutter, iso: m.scenario.iso }; });
      const s = at(sys.surfaces, 587.5618), dp = doePowers(sys.surfaces, 587.5618), si = stopIndex(sys.surfaces);
      const sensorZ = sys.surfaces[sys.surfaces.length - 1].z;
      // the DOF convention: blur measured at the paraxial image of the focus plane, limit where it equals the CoC
      const focusImg = O.imageZ(s, sensorZ - sys.focus.distanceMm, dp);
      const blur = (d) => O.paraxBlurDiameter(s, si, sys.iris.radius, sensorZ - d, focusImg, dp);
      const solve = (lo, hi) => { for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); if ((blur(mid) - m.coc) * (blur(lo) - m.coc) > 0) lo = mid; else hi = mid; } return Math.sqrt(lo * hi); };
      const f = sys.focus.distanceMm;
      const near = solve(f * 0.05 > 200 ? f * 0.05 : 200, f);
      const far = blur(1e9) < m.coc ? Infinity : solve(f, 1e9);
      const rel = (a, b) => (Number.isFinite(a) || Number.isFinite(b) ? Math.abs(a / b - 1) : 0);
      check('D1', `DOF ${st.lens} f/${m.fno} focus ${st.focusM} m`, rel(m.near, near) < 0.01 && (far === Infinity ? !Number.isFinite(m.far) || m.far > 1e8 : rel(m.far, far) < 0.01), `engine ${(m.near / 1000).toFixed(3)}-${Number.isFinite(m.far) ? (m.far / 1000).toFixed(3) : 'inf'} m vs independent paraxial ${(near / 1000).toFixed(3)}-${Number.isFinite(far) ? (far / 1000).toFixed(3) : 'inf'} m (CoC ${(m.coc * 1000).toFixed(1)} um; tolerance 1%)`);
      const ev = Math.log2(m.fno ** 2 / m.t) - Math.log2(m.iso / 100);
      check('E1', `EV100 ${st.lens} f/${m.fno} 1/250 ISO 400`, Math.abs(m.ev - ev) < 1e-9, `engine ${m.ev.toFixed(3)} vs log2(N^2/t) - log2(ISO/100) = ${ev.toFixed(3)}`);
    }
  }
  // ---------------------------------------------------------------------------------------------------------------
  // RIG: the camera's exposure readout after a full shot, and the equal-exposure trade.
  if (only.has('rig')) {
    await open('camera', { lens: 'n50', fno: 4, focusM: 3, shutter: 1 / 250, iso: 100 });
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    const before = await page.evaluate(() => { const m = window.p2p.model(); return { pp: m.exposure.photonsMidGray, e: m.exposure.electronsMidGray, fw: m.sensor.fullWellE, w: m.sensor.widthPx, h: m.sensor.heightPx, fno: m.scenario.fno, t: m.scenario.shutter }; });
    await page.evaluate(() => window.p2p.pieces.camera.fire());
    await page.evaluate(() => window.p2p.pieces.camera.exposureSeek(1));
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => ({ pp: document.querySelector('.rx-pp')?.textContent, all: document.querySelector('.rx-all')?.textContent, well: document.querySelector('.rx-wellk')?.textContent }));
    await shot('rig-exposure-end');
    const pp = Number(String(shown.pp).replace(/,/g, ''));
    check('R1', 'rig photons per pixel at the end of the shot', Math.abs(pp - before.pp) <= 0.5, `shown ${shown.pp} vs model ${before.pp.toFixed(1)}; all pixels "${shown.all}" vs ${(before.pp * before.w * before.h).toExponential(3)} (${before.w} x ${before.h} px); ${shown.well} vs green-channel mean ${(before.e / before.fw * 100).toFixed(2)}%`);
    await page.evaluate(() => window.p2p.pieces.camera.eq(1));
    await page.evaluate(() => window.p2p.settle());
    const after = await page.evaluate(() => { const m = window.p2p.model(); return { pp: m.exposure.photonsMidGray, fno: m.scenario.fno, t: m.scenario.shutter }; });
    check('R2', 'equal-exposure step keeps photons per pixel', Math.abs(after.pp / before.pp - 1) < 0.002, `f/${before.fno} ${before.t.toFixed(5)} s -> f/${after.fno.toFixed(3)} ${after.t.toFixed(5)} s: ${before.pp.toFixed(1)} -> ${after.pp.toFixed(1)} photons (${((after.pp / before.pp - 1) * 100).toFixed(3)}%)`);
  }
} finally {
  console.log('errors', JSON.stringify(errors));
  writeFileSync(`${OUT}/measure-results-${[...only].join('-')}.json`, JSON.stringify({ results, errors }, null, 1));
  await browser.close();
}
