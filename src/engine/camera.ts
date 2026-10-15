// compute(scenario) -> Model (model-types.ts's contract): the camera model, pure and memoized. Plus
// lensFans (the lens-cutaway ray fans) and pointBundle (the cone-of-focus / bokeh-disk bundle). Workstream
// E4. See docs/engine/e4.md.

import type { Scenario, Vec2, Vec3, TraceSystem, Fig, RayPath, Pupil } from './types';
import type { Model, LensInfo, SensorInfo, FanRequest, FanSet, BundleRequest, Bundle } from './model-types';
import type { RealizedLens } from './realize';

import { getRealizedLens, sensorFor, BINS, V_LAMBDA } from './data';
import { daylightAt, sceneDefaultLux, sceneDefaultCctK, sceneSubjectDistanceMm } from './scenes';
import { cardinal, systemAt } from './lens';
import { stopRadiusFor, irisOutline, irisTest, bladeShapes } from './iris';
import { imageOf } from './paraxial';
import { cocFor } from './dof';
import { airyRadius } from './diffraction';
import { workingFNumber, ev100 as ev100Of, imageIlluminance, photonsPerPixelPerBin, ASSUMED_LENS_TRANSMISSION, ASSUMED_INPUTS_NOTE, METER_CONSTANT_K, ISO_12232_SAT_CONSTANT } from './exposure';
import { expectedElectrons, snr as sensorSnr } from './sensor';
import { fan, spot, entryPlaneZ, aimRay, traceRay, type Field, type PupilGrid, type SpotResult } from './trace';
import { illuminantSpectralIrradiance } from './scene';
import { FRAUNHOFER_D_NM } from './glass';

const GRAY_PATCH_REFLECTANCE = 0.18; // the standard photographic "18% gray" reference reflectance

// ---- memoization -------------------------------------------------------------------------------------------

function scenarioKey(s: Scenario): string {
  return JSON.stringify([
    s.lens, s.fno, s.shutter, s.iso, s.focusM, s.format, s.sensor ?? null, s.shutterType, s.scene, s.lux ?? null,
    s.cct ?? null, s.motion?.speedMps ?? null, s.subjectM ?? null,
  ]);
}

const modelCache = new Map<string, Model>();
// A focus-ring drag creates a distinct model at almost every pointer position.
// Retain nearby/recent settings, not the entire history of an open tab (and worker).
const MODEL_CACHE_LIMIT = 64;

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
 * and this file's own doc comment there derives -- instead of dof.ts's `dofLimits`, which then scaled the ENTRANCE
 * pupil by pupilMag while still measuring distances from the front/rear principal plane (dof.ts is thin-lens only
 * since 10/11/2026). That approximation
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

/**
 * Score-loop r1 (10/11/2026): the hyperfocal distance H, from the sensor, solved with the same exit-pupil blur
 * model as `exactDofNearFar`: the nearest focus distance at which a point at infinity still lands within the CoC,
 * so focusing at H gives far = Infinity by construction. It replaces dof.ts's thin-lens H = f^2 p/(N c) + f, which
 * multiplied the aperture by the pupil magnification p while measuring from the principal plane (n50 f/4: 29.2 m
 * against a true ~23.1 m; n500 f/8: 247 m, and focusing there left a finite far limit of 323 m).
 *
 * For each trial focus s the lens is rebuilt AT s (focus groups and back focus move as they do in compute()), and
 * the blur of the infinity image (F2) on that sensor is 2 xp.r |F2 - z_s| / |F2 - xp.z|. That blur falls
 * monotonically as s grows, so H is bisected on log(s) between the closest focus and 1e9 mm. The returned value is
 * the bracket's far end (blur <= CoC). H does not depend on the current focus, so it is cached per lens, stop and
 * CoC. When even the closest focus keeps infinity sharp (a very short lens stopped far down), H is the closest focus.
 */
const hyperfocalCache = new Map<string, number>();
function exactHyperfocalMm(realized: RealizedLens, stopRadius: number, cocMm: number, closestFocusMm: number): number {
  const key = `${realized.design.id}|${stopRadius}|${cocMm}|${closestFocusMm}`;
  const cached = hyperfocalCache.get(key);
  if (cached !== undefined) return cached;
  const blurOfInfinity = (focusMm: number): number => {
    const sys = withStopSd(systemAt(realized, focusMm, { clamp: true }), stopRadius);
    const sz = sensorZEffective(sys);
    const c = cardinal(sys, FRAUNHOFER_D_NM, stopRadius);
    const focusImageZ = imageOf(sys, FRAUNHOFER_D_NM, sz - focusMm).z;
    return (2 * c.xp.r * Math.abs(c.F2 - focusImageZ)) / Math.abs(c.F2 - c.xp.z);
  };
  let H: number;
  if (blurOfInfinity(closestFocusMm) <= cocMm) {
    H = closestFocusMm;
  } else {
    let lo = Math.log(closestFocusMm); // blur > CoC here
    let hi = Math.log(1e9);
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (blurOfInfinity(Math.exp(mid)) > cocMm) lo = mid; else hi = mid;
    }
    H = Math.exp(hi);
  }
  hyperfocalCache.set(key, H);
  if (hyperfocalCache.size > 256) hyperfocalCache.delete(hyperfocalCache.keys().next().value!);
  return H;
}

// ---- compute(scenario) -----------------------------------------------------------------------------------

export function compute(scenario: Scenario): Model {
  const key = scenarioKey(scenario);
  const cached = modelCache.get(key);
  if (cached) {
    modelCache.delete(key);
    modelCache.set(key, cached);
    return cached;
  }

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
    const { nearMm } = exactDofNearFar(system, card.xp, card.F2, sensorZEff, null, cocMm);
    focusBlock = {
      distanceMm: null,
      requestedMm: null,
      clamped: false,
      objectZ: null,
      workingFno,
      magnification: 0,
      hyperfocalMm: exactHyperfocalMm(realized, stopRadius, cocMm, closestFocusMm),
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

    const { nearMm, farMm } = exactDofNearFar(system, card.xp, card.F2, sensorZEff, clampedFocusMm, cocMm);

    focusBlock = {
      distanceMm: clampedFocusMm,
      requestedMm,
      clamped: focusClamped,
      objectZ,
      workingFno,
      magnification,
      hyperfocalMm: exactHyperfocalMm(realized, stopRadius, cocMm, closestFocusMm),
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

  // Score loop r3 (10/11/2026): the bokeh disk used to be the widest chord over 16 equally weighted bins, so an
  // in-focus point read 3-4x the CoC, set by 392.5 nm light the sensor barely records. Each bin's share of the
  // recorded signal: scene photons times the Bayer-averaged sensitivity (one red, two green, one blue per 2x2).
  const recordedRaw = BINS.centers.map((nm, i) => photonsByBin[i] * (sensorSpec.qe.R(nm) + 2 * sensorSpec.qe.G(nm) + sensorSpec.qe.B(nm)) / 4);
  const recordedSum = recordedRaw.reduce((a, b) => a + b, 0);
  const recordedByBin = BINS.centers.map((nm, i) => ({ nm, w: recordedSum > 0 ? recordedRaw[i] / recordedSum : 1 / BINS.centers.length }));

  // Score loop r4 (10/12/2026): the settings' EV100 and the scene's are different things; show both, and the raw level
  // the model gives a metered 18% gray against what ISO 12232 expects (data.ts gaussianCameraSensitivities).
  const sceneEv100 = Math.log2((grayLuminance * 100) / METER_CONSTANT_K);
  const grayRawFraction = electronsMidGray / sensorInfo.adcClipE;
  const grayRawFractionMetered = grayRawFraction * 2 ** (ev100 - sceneEv100);
  // Score loop r6: a camera's measured (saturation-based) ISO is its setting times a factor (D850 0.699, Z8 0.740, Claff's
  // DxOMark-derived Measured ISO chart), so the same metered exposure sits at that fraction of the nominal expectation.
  const measuredIsoFactor = sensorInfo.measuredIsoFactor ?? 1;
  const isoExpectedRawFraction = measuredIsoFactor * (Math.PI * METER_CONSTANT_K * ASSUMED_LENS_TRANSMISSION) / (4 * ISO_12232_SAT_CONSTANT);
  // Score loop r5 (10/14/2026): fill and SNR are only real below the pixel's usable limit, the lower of the full well and the
  // ADC clip. Above it the recorded value is the clip, and the analytic snr() (no clip) would make a blown patch look clean.
  const usableE = Math.min(sensorInfo.fullWellE, sensorInfo.adcClipE);
  const limitedBy: 'well' | 'adc' = sensorInfo.adcClipE < sensorInfo.fullWellE ? 'adc' : 'well';
  const grayClipped = electronsMidGray >= usableE;
  const exposure = { ev100, sceneEv100, grayRawFraction, grayRawFractionMetered, isoExpectedRawFraction, sceneLux, sensorLux, photonsMidGray, electronsMidGray, snrMidGray, usableE, limitedBy, grayClipped, recordedByBin };

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
    shutter: { v: scenario.shutter, unit: 's', ev: 'assumed', src: 'Selected scenario exposure time' },
    iso: { v: scenario.iso, unit: 'ISO', ev: 'assumed', src: 'Selected scenario ISO setting' },
    workingFno: { v: workingFno, unit: 'f-stop', ev: 'derived', calc: focusBlock.distanceMm === null ? 'the set f-number (infinity focus: magnification 0)' : 'N_focused x (1 + |m|/pupilMag), exposure.ts workingFNumber, where N_focused = EFL/EPD of the system at this focus (paraxial.ts cardinal().fno), not the set f-number: the paraxial f-number of the image-side cone. An internally focusing lens shortens its focal length as it focuses closer, so N_focused can be below the set value and N_w can even come out slightly under it.' },
    efl: { v: card.efl, unit: 'mm', ev: 'derived', calc: 'paraxial.ts cardinal(), current focus and stop' },
    maxFno: { v: design.maxFno, unit: 'f-stop', ev: 'spec', src: design.source.url, loc: design.source.location },
    hyperfocalM: { v: focusBlock.hyperfocalMm / 1000, unit: 'm', ev: 'derived', calc: 'camera.ts exactHyperfocalMm(): nearest focus (from the sensor) at which a point at infinity stays within the CoC, real exit pupil, d line' },
    nearM: { v: focusBlock.nearMm / 1000, unit: 'm', ev: 'derived', calc: 'camera.ts exactDofNearFar(): paraxial d-line conjugates, real exit pupil, blur = CoC' },
    farM: { v: focusBlock.farMm / 1000, unit: 'm', ev: 'derived', calc: 'camera.ts exactDofNearFar(): paraxial d-line conjugates, real exit pupil, blur = CoC' },
    cocMm: { v: cocMm, unit: 'mm', ev: 'assumed', calc: 'dof.ts cocFor(), format diagonal / 1500' },
    airyRadiusUm: { v: diffraction.airyRadiusUm, unit: 'um', ev: 'derived', calc: '1.22 * 550nm * workingFno' },
    airyRadiusPx: { v: diffraction.airyRadiusPx, unit: 'px', ev: 'derived', calc: 'Airy radius in micrometers / pixel pitch in micrometers' },
    ev100: { v: ev100, unit: 'EV', ev: 'derived', calc: 'exposure.ts ev100(fno, shutter, iso): the camera settings\' own EV at ISO 100, the scene brightness they suit' },
    sceneEv100: { v: sceneEv100, unit: 'EV', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'ISO 2720 meter equation on the 18% gray patch: log2(L x 100 / K), L = 0.18 x scene lux / pi (cd/m2), K = 12.5' },
    grayRawFractionMetered: { v: grayRawFractionMetered, unit: 'ratio', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'electronsMidGray / adcClipE, scaled to the exposure the meter picks (x 2^(settings EV100 - scene EV100)); a green pixel, ISO cancels' },
    isoExpectedRawFraction: { v: isoExpectedRawFraction, unit: 'ratio', ev: 'derived', calc: measuredIsoFactor === 1 ? 'pi x K x T / (4 x 78): sensor exposure H = pi K T / (4 S) of a metered exposure (ISO 2720, T the assumed lens transmission) against H_sat = 78 / S (ISO 12232 saturation-based speed)' : `pi x K x T / (4 x 78) x ${measuredIsoFactor}: sensor exposure H = pi K T / (4 S) of a metered exposure (ISO 2720, T the assumed lens transmission) against H_sat = 78 / S_measured, where this camera's measured saturation-based ISO is ${measuredIsoFactor} x its setting (Claff, DxOMark-derived Measured ISO)` },
    sceneLux: { v: sceneLux, unit: 'lux', ev: 'assumed', src: scenario.lux !== undefined ? 'Selected scenario illuminance override' : 'src/engine/scenes.ts preset illuminance' },
    sensorLux: { v: exposure.sensorLux, unit: 'lux', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'exposure.ts imageIlluminance(), 18% gray, on axis' },
    photonsMidGray: { v: photonsMidGray, unit: 'photons/px', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'Sum spectral irradiance * pixel area * exposure time / photon energy over wavelength bins; camera.ts photonsByBin' },
    electronsMidGray: { v: electronsMidGray, unit: 'e-', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'sensor.ts expectedElectrons(), photon bins weighted by quantum efficiency and green filter transmission' },
    lensTransmission: { v: ASSUMED_LENS_TRANSMISSION, unit: 'ratio', ev: 'assumed', src: 'exposure.ts ASSUMED_LENS_TRANSMISSION: one round figure for a modern multi-coated lens (about 1/7 stop of loss); no per-element coating data. Every photon, electron, well, raw-value and preview figure includes it. The photon and electron readouts are for the frame center, where cos^4 = 1; the preview applies cos^4 falloff off axis.' },
    snrMidGray: { v: snrMidGray, unit: 'ratio', ev: 'assumed', src: ASSUMED_INPUTS_NOTE, calc: 'sensor.ts snr(): mean / standard deviation across a uniform green 18% gray patch (spatial SNR), from shot noise, dark current, read noise and PRNU. PRNU is fixed-pattern, so one pixel’s frame-to-frame (temporal) SNR is a little higher.' },
    prnuPercent: { v: sensorSpec.prnuStdDev * 100, unit: '% RMS', ev: 'assumed', src: 'data/sensors.json generic.prnu: Jim Kasson’s flat-field measurements of other full-frame cameras (Nikon D4 0.3-0.4%, Sony a9 0.3-0.4%, Nikon D5 under 0.2%), blog.kasson.com; no D850 or Z8 figure was found, so this stands in for them' },
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
  if (modelCache.size > MODEL_CACHE_LIMIT) modelCache.delete(modelCache.keys().next().value!);
  return model;
}

// ---- lensFans ------------------------------------------------------------------------------------------------

/**
 * Meridional ray fans for the lens cutaway (BRIEF.md set piece 2): per field fraction, per wavelength.
 *
 * Score loop r2 (10/11/2026): the fans start from a point on the plane the lens is focused on (the current focus
 * distance, from the sensor), the same object-height construction pointBundle uses, so each fan converges on the
 * sensor and what is left of its landing spread is aberration plus color, not defocus. Before, they always came
 * from infinity: n50 f/1.8 focused at 3 m landed its on-axis d-line fan over 373 um (15 um at infinity focus), and
 * n500 focused at 8.91 m over 3.8 mm. Only an infinity focus still traces angle fields (parallel rays).
 *
 * Each finite-object ray is aimed from the object itself, then its origin is moved forward along its own straight
 * line (in air) to the same entry plane an infinity ray starts from, so the drawn fan keeps its length; every
 * point after that is the trace's own.
 */
export function lensFans(model: Model, req: FanRequest): FanSet[] {
  const halfFieldDeg = model.realized.realization.halfFieldDeg;
  const ep = model.cardinal.ep;
  const sourceDistMm = model.focus.distanceMm;
  const sensorZEff = sensorZEffective(model.system);
  const zStart = entryPlaneZ(model.system);
  const objectZ = sourceDistMm === null ? null : sensorZEff - sourceDistMm;
  const finite = objectZ !== null && objectZ < zStart;
  return req.fields.map((f) => {
    const fieldDeg = f * halfFieldDeg;
    const ang = (fieldDeg * Math.PI) / 180;
    const field: Field = finite
      ? { kind: 'object', o: [0, (objectZ! - ep.z) * Math.tan(ang), objectZ!] }
      : { kind: 'angle', ax: 0, ay: ang };
    const paths = finite
      ? finiteFan(model.system, ep, field, req.rays, req.nms, zStart)
      : fan(model.system, ep, field, req.rays, req.nms, 'y', { realAim: true });
    return { field: f, fieldDeg, paths, sourceDistMm: finite ? sourceDistMm : null };
  });
}

/** trace.ts fan()'s meridional sampling (wavelength outermost, pupil y from -1 to 1), for a finite object point,
 *  with each aimed ray's origin moved forward along its own straight line in air to z = zStart before tracing. */
function finiteFan(sys: TraceSystem, ep: Model['cardinal']['ep'], field: Field, n: number, nms: number[], zStart: number): RayPath[] {
  const out: RayPath[] = [];
  for (const nm of nms) {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
      const ray = aimRay(sys, ep, field, 0, u, nm, { realAim: true });
      const t = (zStart - ray.o[2]) / ray.d[2];
      const o: Vec3 = t > 0 ? [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, zStart] : ray.o;
      out.push(traceRay(sys, { ...ray, o }));
    }
  }
  return out;
}

// ---- pointBundle -----------------------------------------------------------------------------------------

/** The share of recorded energy the bokeh disk's reported diameter holds (Bundle.recordedDiameterMm). 90%: a
 *  defocused uniform disk then reads sqrt(0.9) = 0.95 of its full diameter, while a faint rim or halo carrying a few
 *  percent of the light does not set the size. A reporting choice, not a measured quantity. */
export const RECORDED_ENERGY_FRACTION = 0.9;

/** Diameter of the circle about the weighted centroid that holds `fraction` of the total weight. */
export function enclosedDiameter(points: { x: number; y: number; w: number }[], fraction: number): number {
  const total = points.reduce((a, p) => a + p.w, 0);
  if (!(total > 0)) return 0;
  const cx = points.reduce((a, p) => a + p.w * p.x, 0) / total;
  const cy = points.reduce((a, p) => a + p.w * p.y, 0) / total;
  const byR = points.map((p) => ({ r: Math.hypot(p.x - cx, p.y - cy), w: p.w })).sort((a, b) => a.r - b.r);
  let acc = 0;
  for (const p of byR) {
    acc += p.w;
    if (acc >= fraction * total) return 2 * p.r;
  }
  return 2 * byR[byR.length - 1].r;
}

/**
 * The largest distance between any two of the points (the disk's diameter). The farthest pair is always on the convex
 * hull, so the hull is found first (monotone chain, O(n log n)) and only its few vertices are compared, by squared
 * distance, with one square root at the end. The old all-pairs loop with Math.hypot was O(n^2) on up to ~2,000 landing
 * points and 940 ms of a Focus slider event on a 4x phone (score loop r6).
 */
export function maxChord(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  const cross = (o: number, a: number, b: number) =>
    (points[a].x - points[o].x) * (points[b].y - points[o].y) - (points[a].y - points[o].y) * (points[b].x - points[o].x);
  const hull: number[] = [];
  for (const i of idx) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop();
  let best = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = points[hull[i]];
    for (let j = i + 1; j < hull.length; j++) {
      const b = points[hull[j]];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = dx * dx + dy * dy;
      if (d > best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * The closed-form image-side blur-disk diameter, pupil-corrected, but referenced to the REAL exit pupil
 * (`Cardinal.xp`) rather than dof.ts's `blurDiameter` approximation.
 *
 * (History: dof.ts's `blurDiameter` used to take a `pupilMag` argument; it was removed 10/11/2026 and dof.ts is now
 * thin-lens only. The reasoning below is why.) That form scaled the entrance-pupil aperture by `pupilMag` but
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
 * from a circular aperture of the exit pupil's own radius, converging toward the paraxial image of the
 * defocused point, cut by the sensor plane where it actually sits (the current system's image surface) — but
 * plugs in the real exit pupil
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

  // R-C1 (10/10/2026 correctness review): the cone is cut at the sensor itself, not at the paraxial image of the
  // focus distance. realize.ts places the full-aperture best focus on the sensor (paraxial image + afOffset, e.g.
  // n50's -104 um), so the two planes differ; measuring from the paraxial focus image predicted zero blur at the
  // focus distance and was up to 4x off near focus against the traced disk at f/16, where aberrations are small.
  const vSensor = sensorZEff - xp.z;
  const vPoint = imageZOf(pointDistMm) - xp.z;
  return (2 * xp.r * Math.abs(vPoint - vSensor)) / Math.abs(vPoint);
}

/** One object point's bundle through the real lens onto the sensor (BRIEF.md set pieces 3 and 6/9: the cone
 *  of focus and the bokeh disk). `req.pointDistMm` and the model's own current focus distance are both "from
 *  the sensor" (Scenario's own convention); `req.fieldFrac` is a fraction of the realized half field. */
export function pointBundle(model: Model, req: BundleRequest): Bundle {
  const t = bundleTrace(model, req);
  return assembleBundle(model, req, spot(model.system, t.ep, t.field, t.grid, req.nms, { realAim: true }),
    req.dLine ? spot(model.system, t.ep, t.field, t.grid, [FRAUNHOFER_D_NM], { realAim: true }) : undefined);
}

/**
 * The same bundle as pointBundle, traced a few wavelengths at a time with `yieldToMain()` awaited between the slices, so a
 * 450 ms trace on a 4x-throttled phone is several short tasks the browser can paint and take input between (score loop r6). The
 * wavelengths are traced independently of each other, so the result is identical to pointBundle's. `cancelled()` is checked
 * after every yield; a cancelled trace resolves to null.
 */
export async function pointBundleSliced(
  model: Model, req: BundleRequest,
  opts: { sliceNms?: number; yieldToMain(): Promise<void>; cancelled?(): boolean },
): Promise<Bundle | null> {
  const t = bundleTrace(model, req);
  const per = Math.max(1, opts.sliceNms ?? 2);
  const results: SpotResult[] = [];
  for (let i = 0; i < req.nms.length; i += per) {
    if (i > 0) { await opts.yieldToMain(); if (opts.cancelled?.()) return null; }
    results.push(...spot(model.system, t.ep, t.field, t.grid, req.nms.slice(i, i + per), { realAim: true }));
  }
  let dl: SpotResult[] | undefined;
  if (req.dLine) {
    await opts.yieldToMain();
    if (opts.cancelled?.()) return null;
    dl = spot(model.system, t.ep, t.field, t.grid, [FRAUNHOFER_D_NM], { realAim: true });
  }
  await opts.yieldToMain();
  if (opts.cancelled?.()) return null;
  return assembleBundle(model, req, results, dl);
}

function bundleTrace(model: Model, req: BundleRequest): { ep: Pupil; field: Field; grid: PupilGrid } {
  const sensorZEff = sensorZEffective(model.system);
  const halfFieldDeg = model.realized.realization.halfFieldDeg;
  const ang = (halfFieldDeg * req.fieldFrac * Math.PI) / 180;
  const objectZ = sensorZEff - req.pointDistMm;
  const ep = model.cardinal.ep;
  const field: Field = { kind: 'object', o: [0, (objectZ - ep.z) * Math.tan(ang), objectZ] };
  return { ep, field, grid: { kind: 'fibonacci', n: req.rays } };
}

function assembleBundle(model: Model, req: BundleRequest, results: SpotResult[], dl: SpotResult[] | undefined): Bundle {
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
  const diameterByNm = req.nms.map((nm) => ({ nm, diameterMm: maxChord(landing.filter((p) => p.nm === nm)) }));

  // The recorded disk: each wavelength weighted by its share of the recorded signal (nearest bin), per ray traced.
  const binWeight = (nm: number): number => {
    const bins = model.exposure.recordedByBin;
    let best = bins[0];
    for (const b of bins) if (Math.abs(b.nm - nm) < Math.abs(best.nm - nm)) best = b;
    return best.w;
  };
  const wByNm = new Map(req.nms.map((nm) => [nm, binWeight(nm)]));
  const wMax = Math.max(1e-300, ...wByNm.values());
  const recordedWeightByNm = req.nms.map((nm) => ({ nm, w: wByNm.get(nm)! / wMax }));
  const recordedDiameterMm = enclosedDiameter(landing.map((p) => ({ x: p.x, y: p.y, w: wByNm.get(p.nm)! })), RECORDED_ENERGY_FRACTION);

  // Score-loop r1 (10/11/2026): the all-wavelength chord above is not like-for-like with the paraxial prediction,
  // which is for the d line only. At p50/n50 f/4 with a 1.5 m point the gap was ~+24%, nearly all of it the
  // 392.5 nm bin focusing behind the sensor (longitudinal color), not monochromatic aberration.
  let dLineDiameterMm: number | undefined;
  if (dl) {
    const pts: { x: number; y: number }[] = [];
    for (const r of dl) for (const smp of r.samples) {
      if (smp.path.status === 'ok') {
        const q = smp.path.pts[smp.path.pts.length - 1];
        pts.push({ x: q[0], y: q[1] });
      }
    }
    dLineDiameterMm = maxChord(pts);
  }

  const cocMm = cocFor(model.sensor.format);
  const pitchMm = model.sensor.pitchUm / 1000;
  const predictedBlurMm = exitPupilBlurDiameterMm(model, req.pointDistMm);

  return { paths, landing, centroid, diameterMm, diameterByNm, dLineDiameterMm, predictedBlurMm, cocMm, pitchMm, recordedDiameterMm, recordedWeightByNm };
}

export { distanceFromSensorToP, distanceFromPToSensor, sensorZEffective };
