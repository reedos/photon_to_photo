// engine-api.ts: the one door from the views (src/app/**, src/pieces/**) to the physics. compute, lensFans and
// pointBundle come from src/engine/camera.ts, renderImage from src/engine/render.ts (workstream E4); this file adds
// only the UI's own helpers (the lens list, cheap picker labels, and the scenario bounds the controls enforce).
// The app shell's stub adapter lived here until the lead swapped the real engine in (09/28/2026).

import type { Bundle, BundleRequest, FanRequest, FanSet, Model, RenderRequest, RenderResult } from '../engine/model-types';
import type { FormatId, Scenario } from '../engine/types';
import { FORMATS } from '../engine/formats';
import { compute as engineCompute, lensFans as engineLensFans, pointBundle as enginePointBundle } from '../engine/camera';
import { renderImage as engineRenderImage } from '../engine/render';
import { focusRingAngleRad } from '../engine/focus-travel';
import { lensDesign, lensIds, D850_SENSOR_ID, Z8_SENSOR_ID } from '../engine/data';
import { sceneIds, sceneFor } from '../engine/scenes';

export { FORMATS };
// Re-exported so the Settings scene switch (ui.ts) can list what's actually registered (docs/PANE.md contract:
// 'field' joins 'bench' once the scenes stream's own edit to scenes.ts lands) without reaching past this file.
export { sceneIds };

/** The original 12 class-representative primes (docs/BRIEF.md's 20..500 mm list) the free-form scenario
 *  builder picks from, ascending by focal length. The docs/PANE.md lineup lenses (s35, n50, n500, n500fl,
 *  z35, m50, z800), added to data.ts's registry so the one-pane camera-rig scene can load and realize them
 *  through the same engine, are deliberately excluded here: they belong to a fixed two-body/three-lens-each
 *  lineup (PANE_LENS_IDS below), not this open picker, and several share a focal length with a "p" prime
 *  (35, 50, 500) or introduce a new one (800) that this list's own "ascending, one per focal length" test
 *  never expected to hold once mixed in. */
export const LENS_IDS: string[] = lensIds()
  .filter((id) => id.startsWith('p'))
  .sort((a, b) => lensDesign(a).focalLength - lensDesign(b).focalLength);
// the one pane opens on the lineup's 50 mm f/1.8G on the DSLR (a lens Reed owns); the free-form primes stay reachable by URL
export const DEFAULT_LENS_ID = 'n50';

/** The docs/PANE.md camera-rig lineup: DSLR (s35, n50, n500, n500fl on Nikon F) and mirrorless (z35, m50,
 *  z800 on Nikon Z), in the order PANE.md lists them. Used by src/scene/lens-exterior.ts and lens-preview.ts,
 *  not the free-form scenario builder. */
export const PANE_LENS_IDS: string[] = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];

/** Which body a lineup lens mounts on (its mount: Nikon F -> the DSLR, Nikon Z -> the mirrorless). */
export type BodyId = 'dslr' | 'mirrorless';
export const LINEUP: Record<BodyId, string[]> = { dslr: ['s35', 'n50', 'n500', 'n500fl'], mirrorless: ['z35', 'm50', 'z800'] };
export function bodyForLens(id: string): BodyId | null {
  return LINEUP.dslr.includes(id) ? 'dslr' : LINEUP.mirrorless.includes(id) ? 'mirrorless' : null;
}

/** Finding S1: each lineup body's own real sensor (data/d850.json, data/z8.json via src/engine/data.ts), not
 *  the free-form primes' Sony a7R IV stand-in. `normalizeScenario` uses this to pick a lineup lens's default
 *  sensor id; an explicitly supplied `scenario.sensor` (any body, or a free-form prime's own pick) always wins. */
const BODY_SENSOR_ID: Record<BodyId, string> = { dslr: D850_SENSOR_ID, mirrorless: Z8_SENSOR_ID };

/** The focus ring's rotation (radians from infinity) for the model's focus distance: the engine's focus travel
 *  (focus-travel.ts) over the lens's assumed throw. Where the engine's transcribed focus table cannot reach the
 *  distance (n50's rear-focus gaps stop near 1.7 m, so every farther distance reads t = 0 and the ring would not
 *  move), the fraction falls back to thin-lens extension between infinity and the closest focus, the same rule
 *  blender/lens_v2.py uses to engrave that lens's scale, so ring and scale always agree. Evidence: derived. */
export function focusRingAngle(model: Model): number {
  return ringAngleAt(model, model.focus.distanceMm);
}

/** The ring's full turn, infinity to the closest focus (radians). */
export function focusRingThrow(model: Model): number {
  return ringAngleAt(model, model.realized.realization.closestFocusMm);
}

/** The inverse, for dragging the ring on the model: the focus distance (mm from the sensor, null = infinity) whose
 *  ring angle is `angle`. Bisection on the monotonic angle(distance), log-spaced between the closest focus and 1 km. */
export function distanceForRingAngle(model: Model, angle: number): number | null {
  if (angle <= 1e-4) return null;
  const closest = model.realized.realization.closestFocusMm;
  let lo = Math.log(closest), hi = Math.log(1e6);
  if (angle >= ringAngleAt(model, closest) - 1e-6) return closest;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ringAngleAt(model, Math.exp(mid)) > angle) lo = mid; else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

function ringAngleAt(model: Model, d: number | null): number {
  const lensId = model.scenario.lens;
  const closest = model.realized.realization.closestFocusMm;
  const full = focusRingAngleRad(model.realized, closest, lensId);
  const probe = focusRingAngleRad(model.realized, Math.max(closest * 1.5, closest + 1), lensId);
  if (probe > 1e-9 || d === null) return d === null ? 0 : focusRingAngleRad(model.realized, d, lensId);
  const f = model.lens.focalLength;
  const ext = (D: number) => (D - Math.sqrt(Math.max(D * D - 4 * D * f, 0))) / 2 - f;
  return full * Math.min(1, ext(Math.max(d, closest)) / ext(closest));
}

/** Cheap, no-physics summary for the lens picker's labels (does not run realize()). */
export function lensSummary(id: string): { id: string; name: string; focalLength: number; maxFno: number; markedFno: number } {
  const d = lensDesign(id);
  return { id: d.id, name: d.name, focalLength: d.focalLength, maxFno: d.maxFno, markedFno: d.markedFno ?? d.maxFno };
}

// f/4, 1/250 s, ISO 100 is a correct exposure for the bench scene (10,000 lux daylight): incident-light EV100 =
// log2(E * 100 / C) = log2(10000 * 100 / 250) = 11.97 with the ISO 2720 incident constant C = 250, and
// log2(4^2 * 250) = 11.97. (ISO 400 here would be two stops over.)
const DEFAULT_SCENARIO: Scenario = {
  lens: DEFAULT_LENS_ID, fno: 4, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff',
  shutterType: 'mechanical', scene: 'bench',
};
const MAX_FNO = 22;

/** Where a lens opens when nothing asks for a focus distance (a UI choice, not physics). The short lenses open at
 *  3 m, the bench charts' plane. The long lenses open at 15 m: their closest focus (3 to 5 m) is where a unit-focusing
 *  prescription pushes its glass furthest out, a poor first frame, and at any distance their narrow view misses the
 *  charts anyway (R1-FID-C, R1-06). */
export const LONG_LENS_MM = 300;
export function defaultFocusM(lensId: string): number {
  return lensDesign(lensId).focalLength >= LONG_LENS_MM ? 15 : DEFAULT_SCENARIO.focusM as number;
}

/** The bench scene's targets (the charts and the foreground card, not the backdrop), for the UI's "is anything in
 *  this frame" check: scene geometry only, mm, camera at the origin looking along +z. */
export function sceneTargets(sceneId: string, subjectM?: number): { id: string; x0: number; x1: number; y0: number; y1: number; z: number }[] {
  return sceneFor(sceneId, subjectM).billboards.filter((b) => b.id !== 'backdrop').map((b) => ({
    id: b.id, x0: b.center[0] - b.widthMm / 2, x1: b.center[0] + b.widthMm / 2,
    y0: b.center[1] - b.heightMm / 2, y1: b.center[1] + b.heightMm / 2, z: b.center[2],
  }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fills defaults and applies the controls' bounds, so the UI and the URL show the normalized value at once.
 *  compute() applies the physics bounds (the lens's own maximum aperture, its reachable closest focus). */
// The scene/focus defaults a long lens opens on (SHARED CONTRACT): a lens whose class focal length is >= this
// reaches far enough that the bench scene's near charts fall outside a sensible frame (R1-FID-C, R1-06, the
// same finding LONG_LENS_MM/defaultFocusM above already acted on for the bench scene) -- 200 mm, not 300 mm,
// since the contract's own field scene is meant for every lens the field brief calls "long", not only the
// three lineup 500s and the 800.
const FIELD_SCENE_MIN_MM = 200;

/** The scene a bare scenario (no explicit `scene`) opens on: 'field' for a long lens, 'bench' otherwise. An
 *  explicit `scene` always wins (normalizeScenario below never calls this when `input.scene` is a known id). */
function defaultSceneId(lensId: string): string {
  return lensDesign(lensId).focalLength >= FIELD_SCENE_MIN_MM ? 'field' : 'bench';
}

/** The focus distance a bare scenario (no explicit `focusM`) opens at, once its scene is known (SHARED
 *  CONTRACT: "field defaults to its subject distance (30 m) and bench keeps 3 m"). Any other scene (e.g.
 *  'dusk', bench's own low-light twin) falls back to the pre-existing long/short-lens rule above. */
function defaultFocusForScene(sceneId: string, lensId: string): number {
  if (sceneId === 'field') return 30;
  if (sceneId === 'bench') return 3;
  return defaultFocusM(lensId);
}

export function normalizeScenario(input: Partial<Scenario>): Scenario {
  // the free-form primes and the lineup both resolve; anything else falls back to the default
  const lens = input.lens && (LENS_IDS.includes(input.lens) || PANE_LENS_IDS.includes(input.lens)) ? input.lens : DEFAULT_SCENARIO.lens;
  const design = lensDesign(lens);
  const fno = clamp(Math.max(input.fno ?? DEFAULT_SCENARIO.fno, design.maxFno), design.maxFno, MAX_FNO);
  const shutter = clamp(input.shutter ?? DEFAULT_SCENARIO.shutter, 1 / 8000, 30);
  const iso = clamp(input.iso ?? DEFAULT_SCENARIO.iso, 100, 51200);
  const format: FormatId = input.format && input.format in FORMATS ? input.format : DEFAULT_SCENARIO.format;
  const shutterType = input.shutterType ?? DEFAULT_SCENARIO.shutterType;
  const scene = input.scene && sceneIds().includes(input.scene) ? input.scene : defaultSceneId(lens);
  const focusM = input.focusM === undefined ? defaultFocusForScene(scene, lens) : input.focusM;
  // Finding S1: an explicitly supplied sensor id always wins; otherwise a lineup lens defaults to its own
  // body's real sensor (D850/Z8), and a free-form prime keeps falling back to sensorFor's per-format default
  // (undefined here, same as before this fix).
  const body = bodyForLens(lens);
  const sensor = input.sensor ?? (body ? BODY_SENSOR_ID[body] : undefined);
  // SHARED CONTRACT: a positive, finite speed only -- 0, negative or non-finite all normalize to "still"
  // (undefined), same as an absent `motion` altogether, so callers never have to special-case a zero speed.
  const motion = input.motion && Number.isFinite(input.motion.speedMps) && input.motion.speedMps > 0
    ? { speedMps: input.motion.speedMps }
    : undefined;
  const subjectM = input.subjectM !== undefined && Number.isFinite(input.subjectM) && input.subjectM > 0 ? input.subjectM : undefined;
  return { lens, fno, shutter, iso, focusM, format, shutterType, scene, lux: input.lux, cct: input.cct, sensor, motion, subjectM };
}

export function compute(scenarioInput: Partial<Scenario>): Model {
  return engineCompute(normalizeScenario(scenarioInput));
}

export function lensFans(model: Model, req: FanRequest): FanSet[] {
  return engineLensFans(model, req);
}

export function pointBundle(model: Model, req: BundleRequest): Bundle {
  return enginePointBundle(model, req);
}

export function renderImage(model: Model, req: RenderRequest): RenderResult {
  return engineRenderImage(model, req);
}
