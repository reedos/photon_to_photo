// Synthetic scenes only (BRIEF.md: "Use synthetic scenes only, never Reed's own photos"), built from
// scene.ts's primitives (Billboard/PointHighlight/Scene, siemensStarReflectance, daylightSpd) and
// data.ts's cited spectral tables (the ColorChecker reflectances, the CIE daylight basis). Workstream E4.
// See docs/engine/e4.md, "scenes.ts".

import type { Vec3 } from './types';
import type { Billboard, PointHighlight, Scene } from './scene';
import { siemensStarReflectance, daylightSpd } from './scene';
import { COLOR_CHECKER_NAMES, colorCheckerReflectance, DAYLIGHT_LAMBDAS, DAYLIGHT_S0, DAYLIGHT_S1, DAYLIGHT_S2, tableSpectrum } from './data';

// ---- illuminant: daylight at an arbitrary CCT, built from the real CIE S0/S1/S2 basis ----------------------

/**
 * A relative daylight spectral shape at `cctK`, table-interpolated from the CIE S0/S1/S2 basis functions
 * (data/color/daylight-basis-s0s1s2.json) via scene.ts's own `daylightSpd`. Valid 4000-25000 K (daylightSpd's
 * own range check). Evidence: derived from CIE 015:2018 data, same as scene.ts's own daylight support.
 */
export function daylightAt(cctK: number): (nm: number) => number {
  const values = daylightSpd(cctK, DAYLIGHT_S0, DAYLIGHT_S1, DAYLIGHT_S2);
  return tableSpectrum(DAYLIGHT_LAMBDAS, values);
}

// ---- the ColorChecker billboard ------------------------------------------------------------------------------

/** BabelColor's own 4-row x 6-column layout (data/color/colorchecker24-babelcolor.json's own patch order,
 *  which is that layout, row-major top-to-bottom). */
const COLOR_CHECKER_COLS = 6;
const COLOR_CHECKER_ROWS = 4;

/**
 * A billboard carrying the 24-patch ColorChecker in its standard 4x6 layout, each patch a real, cited
 * reflectance spectrum (data/color/colorchecker24-babelcolor.json). `center`/`widthMm`/`heightMm` place and
 * size it; a small gap between patches (12% of a cell) reads as the physical chart's own grid lines/border.
 */
export function colorCheckerBillboard(id: string, center: Vec3, widthMm: number, heightMm: number): Billboard {
  const cellW = 1 / COLOR_CHECKER_COLS;
  const cellH = 1 / COLOR_CHECKER_ROWS;
  const gap = 0.12; // fraction of a cell left as border/gap between patches, assumed (visual only)
  const patches = COLOR_CHECKER_NAMES.map((name) => colorCheckerReflectance(name));
  const DARK: (nm: number) => number = () => 0.02; // between-patch gap: assumed near-black card stock

  return {
    id,
    center,
    normal: [0, 0, -1], // faces back toward -z, i.e. toward a camera at the origin looking +z
    up: [0, 1, 0],
    widthMm,
    heightMm,
    reflectanceAt: (u: number, v: number) => {
      // u, v in [-0.5, 0.5]; row 0 at the TOP (v = +0.5), matching how the chart is normally printed/read.
      const col = Math.floor((u + 0.5) * COLOR_CHECKER_COLS);
      const row = Math.floor((0.5 - v) * COLOR_CHECKER_ROWS);
      if (col < 0 || col >= COLOR_CHECKER_COLS || row < 0 || row >= COLOR_CHECKER_ROWS) return DARK;
      const fu = (u + 0.5) * COLOR_CHECKER_COLS - col; // 0..1 within the cell
      const fv = (0.5 - v) * COLOR_CHECKER_ROWS - row;
      if (fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap) return DARK;
      return patches[row * COLOR_CHECKER_COLS + col];
    },
  };
}

// ---- the Siemens star billboard ----------------------------------------------------------------------------

// Representative high/low reflectances for the resolution target, flat across wavelength (assumed: the point
// of a Siemens star is spatial resolution, not color, so a neutral, wavelength-flat pair keeps its contrast
// reading the same in every channel).
const STAR_HIGH: (nm: number) => number = () => 0.85;
const STAR_LOW: (nm: number) => number = () => 0.05;

export function siemensStarBillboard(id: string, center: Vec3, sizeMm: number, spokes = 16): Billboard {
  const reflectanceAt = siemensStarReflectance(spokes, STAR_HIGH, STAR_LOW);
  return { id, center, normal: [0, 0, -1], up: [0, 1, 0], widthMm: sizeMm, heightMm: sizeMm, reflectanceAt };
}

// ---- a flat-reflectance rectangle (the foreground object, the background backdrop) --------------------------

export function flatBillboard(id: string, center: Vec3, widthMm: number, heightMm: number, reflectance: (nm: number) => number): Billboard {
  return { id, center, normal: [0, 0, -1], up: [0, 1, 0], widthMm, heightMm, reflectanceAt: () => reflectance };
}

// ---- background point highlights (for bokeh) ------------------------------------------------------------

// A warm (3000 K-ish) small bright source, standing in for a distant streetlight/specular glint in the
// background bokeh set piece (BRIEF.md set piece 3). Its spectral SHAPE is a Planckian at HIGHLIGHT_TEMP_K
// (scene.ts's planckianSpectralRadiance is reused via the same daylightAt-style helper is not appropriate
// here since it is not a CIE daylight; a raw Planckian is the right model for an incandescent-like point
// source). Its absolute SCALE is chosen, not measured (evidence: assumed) — calibrated to be about 200x the
// bench scene's own 18%-gray subject radiance under 10,000 lux daylight, i.e. clearly a bright highlight
// against the rest of the scene (the qualitative target BRIEF.md's bokeh set piece names), not a specific
// real light's photometry. Worked calculation, in the doc comment so the constant is auditable:
//   E_radiometric ~= 10,000 lux / 683 (lm/W, peak-efficacy approx, exposure.ts's own convention) ~= 14.6 W/m^2
//   L_18%gray, broadband ~= 0.18 * E / pi ~= 0.84 W/sr/m^2 over the ~400 nm visible span
//   per-nm ~= 0.84 / 400 ~= 0.0021 W/sr/m^2/nm average -> x200 ~= 0.42 W/sr/m^2/nm at the source's own peak.
const HIGHLIGHT_TEMP_K = 3000;
const HIGHLIGHT_PEAK_RADIANCE = 0.4; // W . sr^-1 . m^-2 . nm^-1, at the Planckian's own peak wavelength; assumed

function planckianShape(nm: number, tempK: number): number {
  // Re-implemented locally (not imported from scene.ts, which does not export it under a name this module
  // can call without also importing PLANCK_H/SPEED_OF_LIGHT/BOLTZMANN_K a second time) — same formula,
  // same citation (Hecht, "Optics," 5th ed., section 13.1).
  const PLANCK_H = 6.62607015e-34;
  const SPEED_OF_LIGHT = 299792458;
  const BOLTZMANN_K = 1.380649e-23;
  const lambdaM = nm * 1e-9;
  const c1 = 2 * PLANCK_H * SPEED_OF_LIGHT * SPEED_OF_LIGHT;
  const c2 = (PLANCK_H * SPEED_OF_LIGHT) / BOLTZMANN_K;
  return c1 / (Math.pow(lambdaM, 5) * (Math.exp(c2 / (lambdaM * tempK)) - 1));
}

function highlightRadianceAt(nm: number): number {
  // Normalize the Planckian shape to its own peak (Wien's law: lambda_max = 2.8977721e6 nm.K / T) so
  // HIGHLIGHT_PEAK_RADIANCE is literally the value at that peak, then scale.
  const peakNm = 2.897771955e6 / HIGHLIGHT_TEMP_K;
  const peakShape = planckianShape(peakNm, HIGHLIGHT_TEMP_K);
  return (HIGHLIGHT_PEAK_RADIANCE * planckianShape(nm, HIGHLIGHT_TEMP_K)) / peakShape;
}

// ---- the field scene's own sun-glint highlights (bokeh discs from direct sunlight specular reflections) ----
//
// A field-scene sun glint is NOT a small lamp like the bench highlight above: it stands for a near-mirror
// specular reflection of the sun itself off a wet leaf or dew drop deep in the canopy, at the scene's own
// 5500 K daylight color (FIELD_CCT_K === BENCH_CCT_K), not the bench highlight's assumed 3000 K
// incandescent. Its absolute scale is chosen (evidence: assumed), and deliberately far above the bench
// highlight's "200x an 18% gray patch" convention: a specular highlight reflects the SUN's own radiance,
// not a diffuse surface's -- the sun's own radiance is itself on the order of 10^7 W/sr/m^2 integrated over
// the visible band (a ~5800 K blackbody disc), roughly 10^7 times an ordinary sunlit diffuse surface's, so
// even a small, imperfect specular fleck reflecting a tiny fraction of that is legitimately far brighter
// than the diffuse foliage around it.
//
// The engine's own render pipeline then dilutes that total energy across the highlight's full defocus disk
// (render.ts's point-highlight splat: a flat, aperture-shaped kernel spread over every rendered pixel the
// disk covers) before any one pixel sees it -- so "bright enough to read as a highlight" has to survive
// that dilution, not just outshine the background before it. Checked directly against render.ts's own
// numbers (n500 at f/5.6 focused 30 m on this scene, the SHARED CONTRACT's own default pairing): the
// defocus disk here is about 285 rendered-pixel cells wide (radiusPx ~9.5 px, each cell taking an equal
// ~1/285 share of the highlight's total electrons, `buildKernel`'s flat kernel), and at render.ts's
// MAX_KERNEL_RADIUS_PX cap (18 px, the worst case for a lens whose background lands even more defocused
// than that) a cell's share can be as low as ~1/1,000. FIELD_GLINT_PEAK_RADIANCE below is picked so the
// highlight's peak per-pixel electron contribution still clears the local background's own per-pixel
// electron count by a comfortable double-digit multiple even at that worst-case ~1/1,000 dilution --
// verified directly in scenes.test.ts ("is visibly brighter than the local background"), which measures
// the engine's actual rendered numbers rather than trusting this arithmetic alone.
const FIELD_GLINT_TEMP_K = 5500; // daylight color, not the bench highlight's warm incandescent 3000 K
const FIELD_GLINT_PEAK_RADIANCE = 600; // W . sr^-1 . m^-2 . nm^-1, at the Planckian's own peak wavelength; assumed

function fieldGlintRadianceAt(nm: number): number {
  const peakNm = 2.897771955e6 / FIELD_GLINT_TEMP_K;
  const peakShape = planckianShape(peakNm, FIELD_GLINT_TEMP_K);
  return (FIELD_GLINT_PEAK_RADIANCE * planckianShape(nm, FIELD_GLINT_TEMP_K)) / peakShape;
}

/** A field-scene sun glint: same shape as `pointHighlight` but at the much brighter, daylight-colored scale
 *  this scene's specular highlights need to survive the defocus dilution above (see the doc comment there). */
export function sunGlintHighlight(id: string, position: Vec3, radiusMm = 2): PointHighlight {
  return { id, position, radiusMm, radianceAt: fieldGlintRadianceAt };
}

/** A background point highlight at `position` (mm), `radiusMm` a physically tiny disk (a few mm at tens of
 *  meters is sub-pixel angular size for every lens this project models; any visible blob in a render is
 *  therefore essentially all optical blur, not the source's own true size — see docs/engine/e4.md). */
export function pointHighlight(id: string, position: Vec3, radiusMm = 2): PointHighlight {
  return { id, position, radiusMm, radianceAt: highlightRadianceAt };
}

// ---- the two named scenes --------------------------------------------------------------------------------

export const BENCH_CCT_K = 5500;
export const BENCH_LUX = 10000; // assumed: see the doc comment below for the reasoning
export const DUSK_LUX = 20;

/**
 * `lux` levels: 10,000 lux (bench) and 20 lux (dusk) are round, assumed reference points, not measurements
 * of a specific location. They are chosen to sit in the ranges commonly given for outdoor daylight and deep
 * dusk/early-night respectively in general lighting/photography references (very roughly: overcast daylight
 * in the low thousands of lux, full daylight but not direct sun in the 10,000s, direct sun above 30,000;
 * dusk/twilight in the tens of lux, full moonlight closer to 0.1-1 lux) — no single citation is fetched here
 * for that table, so both figures are labeled `assumed` on any Fig that shows them, per BRIEF.md's evidence
 * discipline, rather than dressed up as `reported` with an invented source.
 */
function bench(): Scene {
  const illuminantShape = daylightAt(BENCH_CCT_K);
  // Both kept well clear of the optical axis (x = 0) so an on-axis ray, and a modest search box around it
  // (e.g. render.test.ts's "on-axis highlight" golden test), reaches the background highlights untouched:
  // the colorchecker's own near edge sits at atan(225/3000) =~ 4.3 degrees off axis, the star's at
  // atan(450/3000) =~ 8.5 degrees, both comfortably outside the few-degree radius a low-res render's
  // bokeh-highlight splat kernel occupies.
  const colorChecker = colorCheckerBillboard('colorchecker', [-550, 0, 3000], 650, 500);
  const star = siemensStarBillboard('siemens-star', [650, 0, 3000], 400);
  // Kept clear of the optical axis (y = 0) so an on-axis ray reaches the background highlights untouched.
  const foreground = flatBillboard('foreground', [0, -220, 1500], 200, 250, colorCheckerReflectance('orange'));
  const backdrop = flatBillboard('backdrop', [0, 0, 25000], 20000, 14000, () => 0.2);

  const highlights: PointHighlight[] = [
    pointHighlight('bokeh-highlight-0', [0, 0, 25000]),
    pointHighlight('bokeh-highlight-1', [2500, 1200, 24500]),
    pointHighlight('bokeh-highlight-2', [-2200, -800, 25500]),
    pointHighlight('bokeh-highlight-3', [3800, -1500, 26000]),
  ];

  return {
    billboards: [colorChecker, star, foreground, backdrop],
    pointHighlights: highlights,
    illuminant: { spectrum: illuminantShape, lux: BENCH_LUX },
    // The one moving subject a `motion` scenario can shift in this scene (SHARED CONTRACT, engine-scenes
    // workstream): the Siemens star card, chosen over the ColorChecker/foreground because it already sits
    // at the scene's own reference "subject distance" (`sceneSubjectDistanceMm('bench')` below, the same
    // 3 m the bench scene opens focused at) and its fine radial pattern makes a lateral streak visible.
    movingBillboardIds: ['siemens-star'],
  };
}

/** Same geometry as `bench`, at a much lower illuminance (BRIEF.md: "dusk... for shot noise"). */
function dusk(): Scene {
  const b = bench();
  return { ...b, illuminant: { spectrum: b.illuminant.spectrum, lux: DUSK_LUX } };
}

// ---- the 'field' scene: a long-lens subject, 30 m out --------------------------------------------------------

export const FIELD_CCT_K = BENCH_CCT_K; // same daylight color as the bench scene; only the geometry/lux differ
export const FIELD_LUX = 20000; // assumed: daylight, brighter than the bench's overcast-ish 10,000 lux reference
                                 // (see BENCH_LUX's own doc comment above for the same round-number reasoning)
export const FIELD_SUBJECT_DISTANCE_MM = 30_000; // 30 m: the perched subject's own distance

// A warm, mid-value brown standing in for plumage/bark — the ColorChecker's own real, cited "dark skin" and
// "light skin" patches (data/color/colorchecker24-babelcolor.json) are reused rather than invented spectra:
// a tan/brown reflectance is a plausible stand-in for both a small bird's back/wings and a bark-covered
// branch, and a paler patch for its underside — the same "use a real cited patch as a stand-in" choice
// bench()'s own foreground (the ColorChecker's "orange") already makes. Evidence: assumed (a stand-in
// choice, not a measured bird/bark reflectance).
const PLUMAGE_BACK = colorCheckerReflectance('dark skin');
const PLUMAGE_BELLY = colorCheckerReflectance('light skin');
const BARK = colorCheckerReflectance('dark skin');
const FOLIAGE = colorCheckerReflectance('foliage'); // the ColorChecker's own dark, desaturated green patch
const GRASS = colorCheckerReflectance('yellow green');

/**
 * The perched subject: a small (about 250 mm tall) billboard, two-tone (a darker back, a lighter belly,
 * split at `bellyLine` in local v) — a coarse but real spectral stand-in for a bird's plumage, procedural
 * like every reflectance function in this file (never a photo — BRIEF.md).
 */
function birdBillboard(id: string, center: Vec3, widthMm: number, heightMm: number): Billboard {
  // A perched songbird's silhouette in mm about the billboard center (x right, y up), facing right: an egg-shaped
  // body, a round head, a short beak, a tail angled down behind, a darker folded wing and a dark eye. Procedural
  // and illustrative (evidence: assumed); the proportions are a generic passerine's, not any one species.
  const mm = (u: number, v: number) => [u * widthMm, v * heightMm] as const;
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const dx = x - cx, dy = y - cy;
    const a = (dx * c + dy * s) / rx, b = (-dx * s + dy * c) / ry;
    return a * a + b * b <= 1;
  };
  const body = (x: number, y: number) => inEllipse(x, y, -4, -8, 52, 74, -0.28);
  const head = (x: number, y: number) => inEllipse(x, y, 18, 78, 34, 32);
  const beak = (x: number, y: number) => x >= 46 && x <= 70 && Math.abs(y - 76) <= 7 * (1 - (x - 46) / 24);
  const tail = (x: number, y: number) => {
    // a tapering wedge from under the body's back down and to the left
    const t = (y + 60) / -62; // 0 at y = -60, 1 at y = -122
    return t >= 0 && t <= 1 && Math.abs(x - (-30 - 22 * t)) <= 16 - 7 * t;
  };
  const wing = (x: number, y: number) => inEllipse(x, y, -16, 2, 36, 50, -0.45);
  const eye = (x: number, y: number) => inEllipse(x, y, 30, 84, 5, 5);
  const EYE = () => 0.03;
  return {
    id,
    center,
    normal: [0, 0, -1],
    up: [0, 1, 0],
    widthMm,
    heightMm,
    coverage: (u: number, v: number) => {
      const [x, y] = mm(u, v);
      return body(x, y) || head(x, y) || beak(x, y) || tail(x, y);
    },
    reflectanceAt: (u: number, v: number) => {
      const [x, y] = mm(u, v);
      if (eye(x, y)) return EYE;
      if (beak(x, y)) return BARK;
      if (wing(x, y) || tail(x, y)) return BARK;
      // the pale breast on the front-lower half of the body, the darker back and crown elsewhere
      return x > -10 && y < 40 ? PLUMAGE_BELLY : PLUMAGE_BACK;
    },
  };
}

/** A branch: a tapered, gently curving band with one side twig (evidence: assumed, illustrative). */
function branchBillboard(id: string, center: Vec3, widthMm: number, heightMm: number, reflectance: (nm: number) => number): Billboard {
  return {
    id, center, normal: [0, 0, -1], up: [0, 1, 0], widthMm, heightMm,
    coverage: (u: number, v: number) => {
      const mid = 0.1 * Math.sin(u * 5.5);
      const half = 0.26 - 0.16 * Math.abs(u);
      const twig = u > 0.18 && u < 0.36 && Math.abs(v - (mid + (u - 0.18) * 2.2)) < 0.07;
      return Math.abs(v - mid) < half || twig;
    },
    reflectanceAt: () => reflectance,
  };
}

/** Grass: ragged blades rising from the bottom edge (evidence: assumed, illustrative). */
function grassBillboard(id: string, center: Vec3, widthMm: number, heightMm: number, reflectance: (nm: number) => number): Billboard {
  return {
    id, center, normal: [0, 0, -1], up: [0, 1, 0], widthMm, heightMm,
    coverage: (u: number, v: number) => {
      const top = -0.2 + 0.7 * Math.abs(Math.sin(u * 61) * Math.sin(u * 23 + 1.3));
      return v < top;
    },
    reflectanceAt: () => reflectance,
  };
}

/**
 * A large, dappled background canopy: `FOLIAGE`'s own reflectance modulated by a coarse, purely cosmetic
 * two-frequency pattern in (u, v) standing in for light/shade mottling through leaves (evidence: assumed,
 * visual only — the same role bench()'s ColorChecker inter-patch gaps play). The modulation never drops
 * below 55% of the patch's own reflectance, so the canopy stays a plausible foliage color throughout, not a
 * black-and-green checkerboard.
 */
function dappledFoliageBillboard(id: string, center: Vec3, widthMm: number, heightMm: number): Billboard {
  return {
    id,
    center,
    normal: [0, 0, -1],
    up: [0, 1, 0],
    widthMm,
    heightMm,
    reflectanceAt: (u: number, v: number) => {
      const dapple = 0.775 + 0.225 * Math.sin(u * 37) * Math.cos(v * 29 + u * 11);
      return (nm: number) => dapple * FOLIAGE(nm);
    },
  };
}

/**
 * The `field` scene (SHARED CONTRACT): a bird-sized (about 25 cm) subject perched on a branch at 30 m, a
 * dappled foliage background at about 150 m carrying a few sun-glint point highlights (so bokeh disks show
 * behind it), and an out-of-focus foreground grass strip at about 12 m. Framing: a subject about 250 mm tall
 * at 30,000 mm is, by the simple pinhole relation this engine's renderer itself uses (image size = object
 * size * efl / distance — render.ts's `traceSource`), about 4.2 mm tall on the sensor at 500 mm EFL (about
 * 17% of full frame's 24 mm height) and about 6.7 mm (about 28%) at 800 mm EFL: "a sensible part of the
 * frame" at both the lineup's long lenses, per this scene's own brief.
 */
function field(): Scene {
  const illuminantShape = daylightAt(FIELD_CCT_K);

  const subject = birdBillboard('field-subject', [0, 20, FIELD_SUBJECT_DISTANCE_MM], 180, 250);
  // The perch: a horizontal bark-colored strip just below the subject, wide enough to read as a branch
  // under it at every focal length this scene targets.
  const branch = branchBillboard('field-branch', [0, -110, FIELD_SUBJECT_DISTANCE_MM + 40], 900, 70, BARK);

  const backgroundDistMm = 150_000; // 150 m
  const background = dappledFoliageBillboard('field-background', [0, 0, backgroundDistMm], 150_000, 100_000);

  // Sun glints in the background canopy, for bokeh disks (same `pointHighlight` emitter bench() uses for its
  // own background lights) — kept off-axis so the on-axis ray path (the subject itself) reaches the subject,
  // not a highlight, same reasoning as bench()'s own doc comment. Positions are bounded so they actually land
  // inside the rendered frame for BOTH real lineup lenses this scene defaults into (the >=200mm rule's only
  // two members, n500 at an EFL of about 465mm and z800 at about 702mm — see data/lenses/*.json for the
  // as-built EFLs, which run a bit long of their nominal focal lengths): at this 150m-ish background
  // distance the binding case is the longer z800 EFL, whose half-frame angle caps an off-axis point at
  // roughly |x| < 3,375mm, |y| < 2,250mm (derived from render.ts's own projectToRenderedPixel: sensorXmm =
  // x*efl/z must stay inside the sensor's +-18mm half-width, +-12mm half-height on this engine's 36x24mm
  // full-frame format). The three positions below were checked with that exact function, at both lenses, at
  // 600x400 render resolution, and land at roughly (170, 262), (412, 148), (207, 133) px for n500 and (105,
  // 293), (470, 122), (160, 99) px for z800 -- all well inside [0,600) x [0,400), spread around the subject
  // rather than stacked on it.
  const glints: PointHighlight[] = [
    sunGlintHighlight('field-glint-0', [2500, 1200, backgroundDistMm - 300]),
    sunGlintHighlight('field-glint-1', [-2200, -1000, backgroundDistMm + 600]),
    sunGlintHighlight('field-glint-2', [1800, -1300, backgroundDistMm + 150]),
  ];

  // An out-of-focus grass foreground, kept within the narrowest lineup lens's (800 mm) field of view at its
  // own 12 m distance (half-height there is about 180 mm; this strip sits at y = -150 mm, within that).
  const foreground = grassBillboard('field-foreground', [0, -150, 12_000], 2000, 250, GRASS);

  return {
    billboards: [subject, branch, background, foreground],
    pointHighlights: glints,
    illuminant: { spectrum: illuminantShape, lux: FIELD_LUX },
    movingBillboardIds: ['field-subject'],
  };
}

export const SCENES: Record<string, () => Scene> = { bench, dusk, field };

export function sceneDefaultLux(sceneId: string): number {
  if (sceneId === 'bench') return BENCH_LUX;
  if (sceneId === 'dusk') return DUSK_LUX;
  if (sceneId === 'field') return FIELD_LUX;
  throw new Error(`scenes.ts: sceneDefaultLux: unknown scene id "${sceneId}"`);
}

export function sceneDefaultCctK(_sceneId: string): number {
  return BENCH_CCT_K; // every named scene shares the same illuminant color, only lux (and geometry) differ
}

/**
 * The scene's own moving subject's distance from the sensor, mm (SHARED CONTRACT: "the engine's own
 * magnification at the subject distance") — the bench/dusk Siemens star's own 3 m, the field scene's 30 m
 * perch. Used by camera.ts to compute `model.motion`'s blur figures at the subject's own distance, which is
 * not necessarily the scenario's current focus distance.
 */
export function sceneSubjectDistanceMm(sceneId: string): number {
  if (sceneId === 'bench' || sceneId === 'dusk') return 3000;
  if (sceneId === 'field') return FIELD_SUBJECT_DISTANCE_MM;
  throw new Error(`scenes.ts: sceneSubjectDistanceMm: unknown scene id "${sceneId}"`);
}

export function getScene(id: string): Scene {
  const build = SCENES[id];
  if (!build) throw new Error(`scenes.ts: getScene: unknown scene id "${id}" (known: ${Object.keys(SCENES).join(', ')})`);
  return build();
}

export function sceneIds(): string[] {
  return Object.keys(SCENES);
}
