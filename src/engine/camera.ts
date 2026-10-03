// compute(scenario) -> Model (model-types.ts's contract): the camera model, pure and memoized. Plus
// lensFans (the lens-cutaway ray fans) and pointBundle (the cone-of-focus / bokeh-disk bundle). Workstream
// E4. See docs/engine/e4.md.

import type { Scenario, Vec2, Vec3, TraceSystem, Fig } from './types';
import type { Model, LensInfo, SensorInfo, FanRequest, FanSet, BundleRequest, Bundle } from './model-types';
import type { RealizedLens } from './realize';

import { getRealizedLens, sensorFor, BINS, V_LAMBDA } from './data';
import { daylightAt, sceneDefaultLux, sceneDefaultCctK, sceneSubjectDistanceMm } from './scenes';
import { cardinal, systemAt } from './lens';
import { stopRadiusFor, irisOutline, irisTest, bladeShapes } from './iris';
import { imageOf } from './paraxial';
import { cocFor, hyperfocal } from './dof';
import { airyRadius } from './diffraction';
import { workingFNumber, ev100 as ev100Of, imageIlluminance, photonsPerPixelPerBin } from './exposure';
import { expectedElectrons, snr as sensorSnr } from './sensor';
import { fan, spot, type Field, type PupilGrid } from './trace';
import { illuminantSpectralIrradiance } from './scene';
import { FRAUNHOFER_D_NM } from './glass';

// A lens's own transmission (coating/element losses) is not modeled per-element anywhere in this engine
// (BRIEF.md lists T-stop/coatings as later work); a single representative value stands in for every lens
// here. 0.9 (about 1/7 stop of loss) is a commonly cited round figure for a modern multi-coated photographic
// lens's overall transmission. Evidence: assumed.
const ASSUMED_LENS_TRANSMISSION = 0.9;

const GRAY_PATCH_REFLECTANCE = 0.18; // the standard photographic "18% gray" reference reflectance

// ---- memoization -------------------------------------------------------------------------------------------

function scenarioKey(s: Scenario): string {
  return JSON.stringify([
    s.lens, s.fno, s.shutter, s.iso, s.focusM, s.format, s.sensor ?? null, s.shutterType, s.scene, s.lux ?? null,
    s.cct ?? null, s.motion?.speedMps ?? null, s.subjectM ?? null,
  ]);
}

const modelCache = new Map<string, Model>();

// ---- small shared geometry helpers --------------------------------------------------------------------------

/**
 * The image-plane z (system coordinates) of the CURRENT focused system -- i.e. where the sensor actually sits for
 * a design whose focus.gaps table moves the back focus itself (n50, s35, p50), not merely the fixed infinity
 * value. F5 (09/30/2026): every distance-from-sensor consumer here used `realized.sensorZ + afOffset` (the
 * INFINITY sensor coordinate) even for these designs, so a "0.45 m" request was actually traced 9.5 mm too far
 * (n50 focuses fine internally -- lens.ts's systemAt already solves against its own current image surface -- but
 * every caller here then measured the requested distance from the wrong, stale coordinate). Reading it straight
 * off the built TraceSystem's own image surface (its last surface, always) is correct for both policies: a
 * !movesBackFocus design's image surface is now pinned at the fixed sensorZ by lens.ts's systemAt itself (see F3),
 * so this returns the same fixed number for those lenses, and the CURRENT (moved) one for the rest.
 */
function sensorZEffective(system: TraceSystem): number {
  return system.surfaces[system.surfaces.length - 1].z;
}

/**
 * Converts a distance measured "from the sensor" (the photographic convention every Scenario/Bundle-request
 * field in types.ts/model-types.ts uses) to the same distance measured from the front principal plane P
 * (the convention dof.ts's formulas are written in — see dof.ts's own module doc). `Infinity` maps to itself.
 *
 * Derivation: object z = sensorZEff - distFromSensor (systemAt's own convention). The same object's distance
 * from P is P_z - object_z = P_z - sensorZEff + distFromSensor = distFromSensor + (P_z - sensorZEff). This is
 * the "convert distances from the sensor to the front principal plane correctly" step the task brief asks
 * for; documented in docs/engine/e4.md alongside the size of the resulting thick-lens correction.
 */
function distanceFromSensorToP(distFromSensor: number, pZ: number, sensorZEff: number): number {
  if (!Number.isFinite(distFromSensor)) return Infinity;
  return distFromSensor + (pZ - sensorZEff);
}

/** Inverse of `distanceFromSensorToP`. */
function distanceFromPToSensor(distFromP: number, pZ: number, sensorZEff: number): number {
  if (!Number.isFinite(distFromP)) return Infinity;
  return distFromP - (pZ - sensorZEff);
}

function withStopSd(sys: TraceSystem, sd: number): TraceSystem {
  return { ...sys, surfaces: sys.surfaces.map((s) => (s.kind === 'stop' ? { ...s, sd } : s)) };
}

/**
 * F1 (09/30/2026, Astra-6 review): DOF near/far limits, solved with the REAL exit pupil and the REAL focused/
 * defocused conjugates -- the same similar-triangles physical model `exitPupilBlurDiameterMm` already documents
 * and this file's own doc comment there derives -- instead of dof.ts's `dofLimits`, which scales the ENTRANCE
 * pupil by pupilMag while still measuring distances from the front/rear principal plane. That approximation
 * omits the corresponding pupil-POSITION change (the exit pupil generally sits at a different z than the rear
 * principal plane), which is small for an ordinary lens at ordinary distances but not for a long telephoto at
 * infinity focus (z800: near boundary reported at 434.7 m where the real geometric blur was already 174.5 um,
 * 6x the CoC, instead of the true ~2636 m near boundary).
 *
 * `blurAt(distMm)` is exactly `exitPupilBlurDiameterMm`'s formula (kept local here since that function takes a
 * built `Model`, which does not exist yet while `compute()` is still assembling `focusBlock`). Both limits are
 * bracketed and bisected directly on this blur (monotonic on each side of focus: zero at focus, increasing away
 * from it), rather than solved in closed form, so this makes no assumption about where the exit pupil sits
 * relative to the principal planes at all.
 */
function exactDofNearFar(
  system: TraceSystem,
  xp: { z: number; r: number },
  F2: number,
  sensorZEff: number,
  focusDistMm: number | null,
  cocMm: number,
): { nearMm: number; farMm: number } {
  const imageZOf = (distFromSensor: number | null): number => {
    if (distFromSensor === null || !Number.isFinite(distFromSensor)) return F2;
    return imageOf(system, FRAUNHOFER_D_NM, sensorZEff - distFromSensor).z;
  };
  const focusImageZ = imageZOf(focusDistMm);
  const blurAt = (distMm: number): number => {
    const iz = imageZOf(distMm);
    return (2 * xp.r * Math.abs(iz - focusImageZ)) / Math.abs(iz - xp.z);
  };
  // Bisect blurAt(d) - cocMm = 0. blurAt is 0 at the focus distance itself and increases monotonically moving
  // away from it on either side (no pole like F4's object-side search: the image conjugate stays finite and
  // well-behaved all the way to object-at-infinity), so a bracket only needs one endpoint below the CoC and one
  // above it -- found here by exponential expansion from a starting point, rather than assumed up front.
  const solveOutward = (start: number, direction: 1 | -1, floor: number, ceiling: number): number => {
    let inside = start; // blurAt(inside) - cocMm < 0 (still within the sharp range)
    let outside = start;
    let step = Math.max(Math.abs(start) * 0.5, 1);
    for (let i = 0; i < 200; i++) {
      outside = direction > 0 ? Math.min(ceiling, outside + step) : Math.max(floor, outside - step);
      if (blurAt(outside) - cocMm >= 0) break;
      inside = outside;
      step *= 1.7;
      if (outside === ceiling || outside === floor) break; // hit the search bound
    }
    let a = inside, b = outside;
    for (let i = 0; i < 80; i++) {
      const mid = (a + b) / 2;
      if (blurAt(mid) - cocMm < 0) a = mid; else b = mid;
    }
    return (a + b) / 2;
  };

  if (focusDistMm === null) {
    // Focused at infinity: nothing is ever too far (far = Infinity by definition); the near limit is the only
    // boundary. Start the search from a distance far enough out that its blur is already comfortably under the
    // CoC (pushing it farther first if a very fast/long lens's near limit itself sits beyond the initial guess).
    let start = 1e6;
    while (blurAt(start) >= cocMm && start < 1e11) start *= 10;
    return { nearMm: solveOutward(start, -1, 1e-6, start), farMm: Infinity };
  }
  const nearMm = solveOutward(focusDistMm, -1, 1e-6, focusDistMm);
  // Far is infinite once the blur never reaches the CoC even at the object-at-infinity limit (the classic
  // "focused beyond the hyperfocal distance" case).
  const FAR_CEILING = 1e9;
  const blurAtCeiling = blurAt(FAR_CEILING);
  const farMm = blurAtCeiling < cocMm ? Infinity : solveOutward(focusDistMm, 1, focusDistMm, FAR_CEILING);
  return { nearMm, farMm };
}

// ---- compute(scenario) -----------------------------------------------------------------------------------

export function compute(scenario: Scenario): Model {
  const key = scenarioKey(scenario);
  const cached = modelCache.get(key);
  if (cached) return cached;

  const realized = getRealizedLens(scenario.lens);
  const design = realized.design;

  // ---- normalize: fno >= maxFno, focus clamped to the realized closest focus -------------------------------
  const fno = Math.max(scenario.fno, design.maxFno);
  const requestedMm = scenario.focusM === null ? null : scenario.focusM * 1000;
  const closestFocusMm = realized.realization.closestFocusMm;
  const clampedFocusMm = requestedMm === null ? null : Math.max(requestedMm, closestFocusMm);
  const focusClamped = requestedMm !== null && clampedFocusMm !== requestedMm;

  // ---- system, stop, iris, cardinal (current focus, current stop) -----------------------------------------
  const stopRadius = stopRadiusFor(realized, fno);
  const baseSystem = systemAt(realized, clampedFocusMm, { clamp: true });
  const rotation = 0; // no scenario field for iris rotation (see docs/engine/e4.md, "Known limits")
  const irisFn = irisTest(design.iris.blades, stopRadius, design.iris.rounded, rotation);
  const system: TraceSystem = { ...withStopSd(baseSystem, stopRadius), iris: irisFn };

  // F5: read from the CURRENT built system's own image surface, not the stale infinity coordinate -- see
  // sensorZEffective's doc above.
  const sensorZEff = sensorZEffective(system);

  const card = cardinal(system, FRAUNHOFER_D_NM, stopRadius);
  const principalPlaneToSensor = card.P - sensorZEff;

  const irisOutlinePts: Vec2[] = irisOutline(design.iris.blades, stopRadius, design.iris.rounded, rotation);
  const irisBlades: Vec2[][] = bladeShapes(design.iris.blades, stopRadius, design.iris.rounded, rotation);

  // ---- sensor -----------------------------------------------------------------------------------------------
  const { spec: sensorSpec, info: sensorInfo } = sensorFor(scenario.format, scenario.iso, scenario.sensor);
  const pitchMm = sensorSpec.pitchUm / 1000;

  // ---- focus block ---------------------------------------------------------------------------------------
  const cocMm = cocFor(sensorInfo.format);
  let focusBlock: Model['focus'];
  let workingFno: number;

  if (clampedFocusMm === null) {
    workingFno = fno; // infinity focus: magnification 0
    const hyperfocalFromP = hyperfocal(card.efl, fno, cocMm, card.pupilMag);
    const { nearMm } = exactDofNearFar(system, card.xp, card.F2, sensorZEff, null, cocMm);
    focusBlock = {
      distanceMm: null,
      requestedMm: null,
      clamped: false,
      objectZ: null,
      workingFno,
      magnification: 0,
      hyperfocalMm: distanceFromPToSensor(hyperfocalFromP, card.P, sensorZEff),
      nearMm,
      farMm: Infinity,
      cocMm,
    };
  } else {
    const objectZ = sensorZEff - clampedFocusMm;
    const img = imageOf(system, FRAUNHOFER_D_NM, objectZ);
    const magnification = img.magnification;
    // F2 (09/30/2026, Astra-6 review): workingFNumber's classical N*(1+|m|/p) bellows-factor formula assumes N is
    // the CURRENT system's own f-number -- exact for a simple unit-focusing lens, where card.fno stays equal to
    // the requested `fno` at every focus distance since neither efl nor the entrance pupil moves. It is not exact
    // for an internally-focused design (z800): its internal groups shift with focus, breathing card.efl and the
    // entrance pupil independently of the classical bellows-extension picture, so feeding the FIXED infinity `fno`
    // into the same formula double-counts that breathing on top of the magnification term (z800 at 5 m, f/8 came
    // out Nw=19.5, 2.4x too dark, instead of ~8.0). card.fno already reflects the current efl/pupil geometry (it
    // is exactly the image-space-cone f-number at this focus), so it is the correct base N for every design here.
    workingFno = workingFNumber(card.fno, magnification, card.pupilMag);

    const hyperfocalFromP = hyperfocal(card.efl, fno, cocMm, card.pupilMag);
    const { nearMm, farMm } = exactDofNearFar(system, card.xp, card.F2, sensorZEff, clampedFocusMm, cocMm);

    focusBlock = {
      distanceMm: clampedFocusMm,
      requestedMm,
      clamped: focusClamped,
      objectZ,
      workingFno,
      magnification,
      hyperfocalMm: distanceFromPToSensor(hyperfocalFromP, card.P, sensorZEff),
      nearMm,
      farMm,
      cocMm,
    };
  }

  // ---- diffraction (550 nm, working f-number) -----------------------------------------------------------
  const airyMm = airyRadius(550, workingFno);
  const diffraction = { airyRadiusUm: airyMm * 1000, airyRadiusPx: airyMm / pitchMm, nm: 550 };

  // ---- motion blur (SHARED CONTRACT) --------------------------------------------------------------------
  // The moving subject's own streak length on the sensor: speed * shutter * |magnification|, with the
  // magnification taken from the REAL lens (paraxial.ts's imageOf, the same call focusBlock's own
  // magnification above uses) at the scene's own subject distance (scenes.ts's sceneSubjectDistanceMm) --
  // NOT model.focus.magnification, which is at whatever distance the scenario happens to be focused, and can
  // differ from the subject's own distance (the reader is free to focus the field scene's foreground grass,
  // say, while its bird subject still moves at its own 30 m). See camera.test.ts for the check of this
  // magnification against the simple thin-lens f/(d-f) approximation (within 2%, since this uses the real
  // lens's own paraxial solve, not that approximation itself).
  let motion: Model['motion'] = null;
  if (scenario.motion && scenario.motion.speedMps > 0) {
    const subjectDistMm = sceneSubjectDistanceMm(scenario.scene, scenario.subjectM);
    const subjectObjectZ = sensorZEff - subjectDistMm;
    const subjectImg = imageOf(system, FRAUNHOFER_D_NM, subjectObjectZ);
    const blurMm = scenario.motion.speedMps * 1000 * scenario.shutter * Math.abs(subjectImg.magnification);
    motion = { speedMps: scenario.motion.speedMps, blurMm, blurPx: blurMm / pitchMm, ev: 'derived' };
  }

  // ---- exposure -------------------------------------------------------------------------------------------
  const sceneLux = scenario.lux ?? sceneDefaultLux(scenario.scene);
  const cctK = scenario.cct ?? sceneDefaultCctK(scenario.scene);
  const illuminantShape = daylightAt(cctK);
  const irradiance = illuminantSpectralIrradiance(illuminantShape, sceneLux, BINS, V_LAMBDA);
  const grayRadianceByBin = BINS.centers.map((nm) => (GRAY_PATCH_REFLECTANCE * irradiance(nm)) / Math.PI);
  const photonGeom = {
    T: ASSUMED_LENS_TRANSMISSION,
    workingFNo: workingFno,
    cosTheta: 1, // on-axis
    pixelPitchMm: pitchMm,
    exposureS: scenario.shutter,
  };
  const photonsByBin = photonsPerPixelPerBin(BINS, grayRadianceByBin, photonGeom);
  const photonsMidGray = photonsByBin.reduce((a, b) => a + b, 0);
  const electronsMidGray = expectedElectrons(sensorSpec, photonsByBin, BINS.centers, 'G');
  const snrMidGray = sensorSnr(sensorSpec, electronsMidGray, scenario.shutter, scenario.iso);
  const grayLuminance = (GRAY_PATCH_REFLECTANCE * sceneLux) / Math.PI; // cd/m^2, Lambertian
  const sensorLux = imageIlluminance(grayLuminance, ASSUMED_LENS_TRANSMISSION, workingFno, 1);
  const ev100 = ev100Of(fno, scenario.shutter, scenario.iso);

  const exposure = { ev100, sceneLux, sensorLux, photonsMidGray, electronsMidGray, snrMidGray };

  // ---- lens info --------------------------------------------------------------------------------------------
  const lensInfo: LensInfo = {
    id: design.id,
    name: design.name,
    focalLength: design.focalLength,
    efl: card.efl, // current (focused) EFL; near-identical to the infinity design EFL for all but close-focus
    maxFno: design.maxFno,
    markedFno: design.markedFno ?? design.maxFno,
    elements: design.elements,
    groups: design.groups,
    blades: design.iris.blades,
    rounded: design.iris.rounded,
    closestFocusMm,
    representativeOf: design.representativeOf,
    source: {
      ref: design.source.ref,
      url: design.source.url,
      location: design.source.location,
      assignee: design.source.assignee,
      published: design.source.published,
    },
    warnings: [],
  };

  // ---- figs -------------------------------------------------------------------------------------------------
  const figs: Record<string, Fig> = {
    fno: { v: fno, unit: 'f-stop', ev: 'derived', calc: 'max(scenario.fno, lens.maxFno)' },
    shutter: { v: scenario.shutter, unit: 's', ev: 'derived' },
    iso: { v: scenario.iso, unit: 'ISO', ev: 'derived' },
    workingFno: { v: workingFno, unit: 'f-stop', ev: 'derived', calc: 'N(1+|m|/pupilMag), exposure.ts workingFNumber' },
    efl: { v: card.efl, unit: 'mm', ev: 'derived', calc: 'paraxial.ts cardinal(), current focus and stop' },
    maxFno: { v: design.maxFno, unit: 'f-stop', ev: 'spec', src: design.source.url, loc: design.source.location },
    hyperfocalM: { v: focusBlock.hyperfocalMm / 1000, unit: 'm', ev: 'derived', calc: 'dof.ts hyperfocal(), front-principal-plane distances' },
    nearM: { v: focusBlock.nearMm / 1000, unit: 'm', ev: 'derived', calc: 'dof.ts dofLimits()' },
    farM: { v: focusBlock.farMm / 1000, unit: 'm', ev: 'derived', calc: 'dof.ts dofLimits()' },
    cocMm: { v: cocMm, unit: 'mm', ev: 'assumed', calc: 'dof.ts cocFor(), format diagonal / 1500' },
    airyRadiusUm: { v: diffraction.airyRadiusUm, unit: 'um', ev: 'derived', calc: '1.22 * 550nm * workingFno' },
    airyRadiusPx: { v: diffraction.airyRadiusPx, unit: 'px', ev: 'derived' },
    ev100: { v: ev100, unit: 'EV', ev: 'derived', calc: 'exposure.ts ev100(fno, shutter, iso)' },
    sceneLux: { v: sceneLux, unit: 'lux', ev: scenario.lux !== undefined ? 'derived' : 'assumed', src: 'src/engine/scenes.ts' },
    sensorLux: { v: exposure.sensorLux, unit: 'lux', ev: 'derived', calc: 'exposure.ts imageIlluminance(), 18% gray, on axis' },
    photonsMidGray: { v: photonsMidGray, unit: 'photons/px', ev: 'derived' },
    electronsMidGray: { v: electronsMidGray, unit: 'e-', ev: 'derived' },
    snrMidGray: { v: snrMidGray, unit: 'ratio', ev: 'derived', calc: 'sensor.ts snr()' },
    pitchUm: sensorInfo.figs.pitchUm,
    fullWellE: sensorInfo.figs.fullWellE,
    readNoiseE: sensorInfo.figs.readNoiseE,
  };
  if (motion) {
    figs.motionBlurPx = { v: motion.blurPx, unit: 'px', ev: 'derived', calc: 'speedMps * shutter * |magnification| * 1000 / pitchMm, magnification at the scene\'s own subject distance' };
  }

  const model: Model = {
    scenario: { ...scenario, fno, focusM: clampedFocusMm === null ? null : clampedFocusMm / 1000 },
    lens: lensInfo,
    realized,
    system,
    cardinal: card,
    iris: { radius: stopRadius, rotation, outline: irisOutlinePts, blades: irisBlades },
    sensor: sensorInfo,
    focus: focusBlock,
    diffraction,
    motion,
    exposure,
    figs,
  };

  modelCache.set(key, model);
  return model;
}

// ---- lensFans ------------------------------------------------------------------------------------------------

/** Meridional ray fans for the lens cutaway (BRIEF.md set piece 2): per field fraction, per wavelength. */
export function lensFans(model: Model, req: FanRequest): FanSet[] {
  const halfFieldDeg = model.realized.realization.halfFieldDeg;
  return req.fields.map((f) => {
    const fieldDeg = f * halfFieldDeg;
    const field: Field = { kind: 'angle', ax: 0, ay: (fieldDeg * Math.PI) / 180 };
    const paths = fan(model.system, model.cardinal.ep, field, req.rays, req.nms, 'y', { realAim: true });
    return { field: f, fieldDeg, paths };
  });
}

// ---- pointBundle -----------------------------------------------------------------------------------------

function maxChord(points: { x: number; y: number }[]): number {
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > best) best = d;
    }
  }
  return best;
}

/**
 * The closed-form image-side blur-disk diameter, pupil-corrected, but referenced to the REAL exit pupil
 * (`Cardinal.xp`) rather than dof.ts's `blurDiameter` approximation.
 *
 * dof.ts's `blurDiameter(f, N, focus, point, pupilMag)` scales the entrance-pupil aperture by `pupilMag` but
 * (its own doc comment says so directly) "ignores the ... axial offset between the rear principal plane and
 * the actual exit pupil." For most lenses, at ordinary (non-macro) defocus distances, that offset is small
 * relative to the image-side conjugate distances involved and the approximation is fine. It is NOT fine here:
 * for p50 at f/2, defocused from a 3 m focus to a 1 m point, the rear principal plane P2 and the exit pupil
 * xp.z sit about 16 mm apart while the image-side conjugate distances themselves are only about 50 mm — a
 * ~30% axial mismatch — and `blurDiameter`'s approximation duly overshoots the real (ray-traced) blur diameter
 * by about 35% in that case (measured while building this module's golden test; see docs/engine/e4.md,
 * "Known limits", and this workstream's needs_from_lead: dof.ts's `blurDiameter` could take an optional
 * exit-pupil z to fix this without reworking its API).
 *
 * This function keeps the SAME similar-triangles physical model dof.ts's own doc comment derives — a cone
 * from a circular aperture of the exit pupil's own radius, converging toward the image of the in-focus
 * object, cut by the sensor sitting at the image of the defocused point — but plugs in the real exit pupil
 * position and the real paraxial image positions (`paraxial.ts`'s `imageOf`, already tested elsewhere in this
 * engine) instead of assuming the exit pupil sits at the rear principal plane. Checked against real ray
 * tracing (this file's own pointBundle test) to within 5% on the exact case above, against dof.ts's ~35%.
 */
export function exitPupilBlurDiameterMm(model: Model, pointDistMm: number): number {
  const sensorZEff = sensorZEffective(model.system);
  const xp = model.cardinal.xp;

  const imageZOf = (distFromSensor: number | null): number => {
    if (distFromSensor === null) return model.cardinal.F2; // infinity focus: paraxial image at the rear focal point
    const objectZ = sensorZEff - distFromSensor;
    return imageOf(model.system, FRAUNHOFER_D_NM, objectZ).z;
  };

  const vFocus = imageZOf(model.focus.distanceMm) - xp.z;
  const vPoint = imageZOf(pointDistMm) - xp.z;
  return (2 * xp.r * Math.abs(vPoint - vFocus)) / Math.abs(vPoint);
}

/** One object point's bundle through the real lens onto the sensor (BRIEF.md set pieces 3 and 6/9: the cone
 *  of focus and the bokeh disk). `req.pointDistMm` and the model's own current focus distance are both "from
 *  the sensor" (Scenario's own convention); `req.fieldFrac` is a fraction of the realized half field. */
export function pointBundle(model: Model, req: BundleRequest): Bundle {
  const realized = model.realized;
  const sensorZEff = sensorZEffective(model.system);
  const halfFieldDeg = realized.realization.halfFieldDeg;
  const ang = (halfFieldDeg * req.fieldFrac * Math.PI) / 180;

  const objectZ = sensorZEff - req.pointDistMm;
  const ep = model.cardinal.ep;
  const field: Field = { kind: 'object', o: [0, (objectZ - ep.z) * Math.tan(ang), objectZ] };

  const grid: PupilGrid = { kind: 'fibonacci', n: req.rays };
  const results = spot(model.system, ep, field, grid, req.nms, { realAim: true });

  const paths = results.flatMap((r) => r.samples.map((s) => s.path));
  const landing: Bundle['landing'] = [];
  for (const r of results) {
    for (const s of r.samples) {
      if (s.path.status === 'ok') {
        const p = s.path.pts[s.path.pts.length - 1];
        landing.push({ x: p[0], y: p[1], nm: r.nm });
      }
    }
  }

  let centroid: Vec2 = [0, 0];
  if (landing.length > 0) {
    const cx = landing.reduce((a, p) => a + p.x, 0) / landing.length;
    const cy = landing.reduce((a, p) => a + p.y, 0) / landing.length;
    centroid = [cx, cy];
  }
  const diameterMm = maxChord(landing);

  const cocMm = cocFor(model.sensor.format);
  const pitchMm = model.sensor.pitchUm / 1000;
  const predictedBlurMm = exitPupilBlurDiameterMm(model, req.pointDistMm);

  return { paths, landing, centroid, diameterMm, predictedBlurMm, cocMm, pitchMm };
}

export { distanceFromSensorToP, distanceFromPToSensor, sensorZEffective };
