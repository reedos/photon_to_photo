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
  };
}

/** Same geometry as `bench`, at a much lower illuminance (BRIEF.md: "dusk... for shot noise"). */
function dusk(): Scene {
  const b = bench();
  return { ...b, illuminant: { spectrum: b.illuminant.spectrum, lux: DUSK_LUX } };
}

export const SCENES: Record<string, () => Scene> = { bench, dusk };

export function sceneDefaultLux(sceneId: string): number {
  if (sceneId === 'bench') return BENCH_LUX;
  if (sceneId === 'dusk') return DUSK_LUX;
  throw new Error(`scenes.ts: sceneDefaultLux: unknown scene id "${sceneId}"`);
}

export function sceneDefaultCctK(_sceneId: string): number {
  return BENCH_CCT_K; // both named scenes share the same illuminant color, only lux differs
}

export function getScene(id: string): Scene {
  const build = SCENES[id];
  if (!build) throw new Error(`scenes.ts: getScene: unknown scene id "${id}" (known: ${Object.keys(SCENES).join(', ')})`);
  return build();
}

export function sceneIds(): string[] {
  return Object.keys(SCENES);
}
