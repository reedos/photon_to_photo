// The CPU reference renderer: renderImage(model, req) -> RenderResult (model-types.ts's contract). Pure,
// seeded, low-resolution, runnable in a worker (no DOM). Workstream E4. See docs/engine/e4.md, "render.ts",
// for the full design writeup (the binning scheme, the splat/blur design, and every documented
// approximation this module makes).

import type { Vec3 } from './types';
import type { Model, RenderRequest, RenderResult } from './model-types';
import type { SensorSpec } from './sensor';

import { BINS, V_LAMBDA, sensorFor, colorCheckerReflectance, COLOR_CHECKER_NAMES } from './data';
import { getScene, sceneFor, daylightAt, sceneDefaultLux, sceneDefaultCctK } from './scenes';
import { radiance, shiftBillboards, illuminantSpectralIrradiance } from './scene';
import { exitPupilBlurDiameterMm } from './camera';
import { airyRadius } from './diffraction';
import { imageIrradiance, photonEnergy } from './exposure';
import { expectedElectrons, varianceE, readout, samplePixel, fullWellAtIso, maxDn } from './sensor';
import { makeRng } from './rng';
import {
  makePlane,
  cfaColorAt,
  blackLevelSubtract,
  demosaicMalvarHeCutler,
  applyWhiteBalance,
  clipHighlightsToNeutral,
  applyColorMatrix,
  applyToneCurve,
  srgbToneCurve,
  encodeRGB8,
  type Plane,
  type RgbPlanes,
} from './pipeline';
import { fitCameraToXYZ, whiteBalanceGains, reflectanceToXYZ, spectrumToCameraRGB, mat3Multiply, XYZ_TO_LINEAR_SRGB, type Mat3, type ChannelSensitivities } from './color';
import { CMF } from './data';
import type { CfaColor } from './types';

// Same representative lens-transmission stand-in camera.ts uses (no per-element coating data in this engine
// yet). Evidence: assumed. Kept as its own constant here (not imported from camera.ts, which does not export
// it) so render.ts's own dependency on it is visible at a glance.
const ASSUMED_LENS_TRANSMISSION = 0.9;

const CHANNELS: CfaColor[] = ['R', 'G', 'B'];

// A ray that hits nothing is given a large, finite "sky" distance rather than Infinity, so depthMm/objectPoint
// stay finite numbers a caller can plot; 1,000 m is comfortably beyond every scene distance this project uses
// (BRIEF.md's farthest scene element is the 25 m backdrop). Evidence: assumed (a rendering convenience, not a
// physical distance).
const MISS_DEPTH_MM = 1_000_000;

// Caps the splat kernel's radius in RENDERED pixels, so a single extremely defocused source pixel (a fast
// lens, a very close point, or a background near infinity at a long focal length) cannot blow the render's
// time budget open. BRIEF.md's own accuracy bar ("Target: 600 x 400 in under 3 s in node") is a hard budget,
// not a suggestion; a capped kernel radius means very extreme defocus renders slightly sharper than the true
// physics for that one pixel, which is a documented, bounded, honest tradeoff (see docs/engine/e4.md) rather
// than an uncontrolled slowdown.
const MAX_KERNEL_RADIUS_PX = 18;

interface KernelCell { dx: number; dy: number; w: number }

function pointInPolygonUnit(poly: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > y !== yj > y;
    if (crosses) {
      const xCross = xi + ((y - yi) / (yj - yi)) * (xj - xi);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Builds (and the caller caches by rounded radius) the splat kernel for one blur radius, shaped by the
 *  current iris outline (BRIEF.md: "scattering each source pixel into its blur disk shaped by the iris
 *  outline"). Weights are uniform over the covered cells and sum to 1 (energy-conserving: see e4.md). */
function buildKernel(unitOutline: readonly [number, number][], radiusPx: number, capPx = MAX_KERNEL_RADIUS_PX): KernelCell[] {
  if (radiusPx < 0.5) return [{ dx: 0, dy: 0, w: 1 }];
  // Past the cap the outline is drawn AT the cap: the same iris shape, just smaller than the physics. Testing the
  // capped box against the full radius instead put every cell inside the outline and stamped a hard square (a
  // background glint at 9 m focus on the 500 mm, found 09/30/2026 in the real-photo comparison).
  const r = Math.min(radiusPx, capPx);
  const R = Math.ceil(r);
  const cells: { dx: number; dy: number }[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (pointInPolygonUnit(unitOutline, dx / r, dy / r)) cells.push({ dx, dy });
    }
  }
  if (cells.length === 0) cells.push({ dx: 0, dy: 0 });
  const w = 1 / cells.length;
  return cells.map((c) => ({ ...c, w }));
}

/** Photon count per bin from an already-computed image-plane irradiance (W . m^-2 . nm^-1), i.e. the same
 *  final step exposure.ts's `photonsPerPixelPerBin` takes after its own internal `imageIrradiance` call —
 *  reimplemented directly here because this module calls `imageIrradiance` itself, once per source pixel,
 *  BEFORE the blur splat (see e4.md), and must not apply the camera equation a second time. */
function photonsFromIrradiance(irradiancePerBin: number[], binCentersNm: number[], binWeightsNm: number[], pixelAreaM2: number, exposureS: number): number[] {
  const out = new Array<number>(irradiancePerBin.length);
  for (let i = 0; i < irradiancePerBin.length; i++) {
    const energyJ = irradiancePerBin[i] * pixelAreaM2 * exposureS * binWeightsNm[i];
    out[i] = energyJ / photonEnergy(binCentersNm[i]);
  }
  return out;
}

/** One source (pre-blur) sample at rendered-pixel (bx, by): the primary ray, what it hits, and the resulting
 *  per-channel expected electrons for a single real pixel there. Shared by the main render pass and by the
 *  lazily-recomputed `pixel()` accessor (see e4.md, "render.ts"). */
export interface SourceSample {
  dir: Vec3;
  depthMm: number;
  hitId: string | null;
  objectPoint: Vec3;
  cosTheta: number;
  photonsByBinSharp: number[];
  channelElectronsSharp: [number, number, number]; // R, G, B
}

function traceSource(
  bx: number,
  by: number,
  width: number,
  height: number,
  blockPitchMm: number,
  efl: number,
  workingFno: number,
  sceneObj: ReturnType<typeof getScene>,
  spec: SensorSpec,
  exposureS: number,
  preparedIrradiance?: readonly number[],
): SourceSample {
  const halfW = width / 2;
  const halfH = height / 2;
  // Rendered pixels are in PHOTO orientation (upright, as a camera's readout and its raw file present the frame).
  // The lens forms the image on the sensor rotated 180 degrees, so a photo pixel right of and above center sits on
  // the sensor left of and below its center: both sensor coordinates are the photo's, negated. (Until 09/30/2026
  // the rendered image was the raw sensor image, i.e. the final photo came out upside down; see
  // projectToRenderedPixel, which must stay this function's exact inverse.)
  const sensorXmm = -(bx + 0.5 - halfW) * blockPitchMm;
  const sensorYmm = -(halfH - (by + 0.5)) * blockPitchMm;
  // Rectilinear pinhole projection from the real efl and sensor geometry (BRIEF.md: "acceptable for the
  // prototype"): no lens distortion, no entrance-pupil offset, image inversion via the leading minus signs.
  const dir: Vec3 = normalize3([-sensorXmm / efl, -sensorYmm / efl, 1]);
  const origin: Vec3 = [0, 0, 0];

  const hit = radiance(sceneObj, origin, dir, BINS, V_LAMBDA, preparedIrradiance);
  const cosTheta = dir[2];
  const depthMm = hit.depthMm ?? MISS_DEPTH_MM;
  const objectPoint: Vec3 = [origin[0] + dir[0] * depthMm, origin[1] + dir[1] * depthMm, origin[2] + dir[2] * depthMm];

  const irradiance = hit.radianceByBin.map((L) => imageIrradiance(L, ASSUMED_LENS_TRANSMISSION, workingFno, cosTheta));
  const pixelAreaM2 = (spec.pitchUm * 1e-6) ** 2; // um -> m
  const photonsByBinSharp = photonsFromIrradiance(irradiance, BINS.centers, BINS.weights, pixelAreaM2, exposureS);
  const channelElectronsSharp = CHANNELS.map((c) => expectedElectrons(spec, photonsByBinSharp, BINS.centers, c)) as [number, number, number];

  return { dir, depthMm, hitId: hit.hitId, objectPoint, cosTheta, photonsByBinSharp, channelElectronsSharp };
}

// ---- motion blur: average several sub-exposure time samples of the moving subject's billboard(s) -------------

// How many instants across the exposure the moving subject is sampled at, averaged into one source sample.
// Evidence: assumed (a rendering-time/smoothness tradeoff, like MAX_KERNEL_RADIUS_PX above): only paid when
// `scenario.motion` is set and the scene names a moving billboard (SHARED CONTRACT) -- a still scenario calls
// `traceSource` exactly once per rendered pixel, same as before this feature existed, so the render time
// budget (docs/BRIEF.md: "600 x 400 in under 3 s") is unaffected for every scenario that does not opt in.
const MOTION_TIME_SAMPLES = 16;

/** The mean of several `SourceSample`s' own per-bin photon counts and per-channel electron counts (the
 *  quantities a moving billboard's own shifted position changes); every other field (direction, depth, hit
 *  id, object point, cosTheta) is taken from the temporal MIDDLE sample, representative since only the
 *  moving billboard's x position differs between samples -- its z (hence depth/defocus) does not. */
function averageSourceSamples(samples: SourceSample[]): SourceSample {
  const mid = samples[Math.floor(samples.length / 2)];
  const nBins = mid.photonsByBinSharp.length;
  const photonsByBinSharp = new Array<number>(nBins).fill(0);
  const channelElectronsSharp: [number, number, number] = [0, 0, 0];
  for (const s of samples) {
    for (let i = 0; i < nBins; i++) photonsByBinSharp[i] += s.photonsByBinSharp[i] / samples.length;
    for (let c = 0; c < 3; c++) channelElectronsSharp[c] += s.channelElectronsSharp[c] / samples.length;
  }
  return { ...mid, photonsByBinSharp, channelElectronsSharp };
}

/**
 * `traceSource`, but for a scene carrying a moving subject (SHARED CONTRACT: `scenario.motion` plus the
 * scene's own `movingBillboardIds`): each of `MOTION_TIME_SAMPLES` instants t in [0, exposureS) (sampled at
 * its interval's own midpoint, so the exposure's own two ends are each covered by half an interval, not
 * double-counted or left out) shifts the moving billboard(s) by `speedMps * t` (m -> mm) along +x before
 * tracing, per the scenario's own `motion.speedMps`; comment on scenario.shutter's own role here: this is the
 * scenario's REQUESTED exposure time, used as the shutter's open interval -- rolling/curtain skew across the
 * frame is not modeled (every pixel's exposure is treated as the same [0, exposureS) interval), documented
 * here rather than in a return value since it changes no number this function returns, only what a real
 * rolling-shutter camera would additionally skew. When `motion` is absent, 0, or the scene names no moving
 * billboard, this falls straight through to a single `traceSource` call -- the exact pre-motion-blur code
 * path, so a still render's cost is unchanged.
 */
function traceSourceWithMotion(
  bx: number,
  by: number,
  width: number,
  height: number,
  blockPitchMm: number,
  efl: number,
  workingFno: number,
  sceneObj: ReturnType<typeof getScene>,
  spec: SensorSpec,
  exposureS: number,
  motion: { speedMps: number } | undefined,
  movingBillboardIds: readonly string[],
  prepared?: { irradiance: readonly number[]; scenes: ReturnType<typeof getScene>[] },
): SourceSample {
  if (!motion || motion.speedMps === 0 || movingBillboardIds.length === 0) {
    return traceSource(bx, by, width, height, blockPitchMm, efl, workingFno, sceneObj, spec, exposureS, prepared?.irradiance);
  }
  const samples: SourceSample[] = [];
  for (let i = 0; i < MOTION_TIME_SAMPLES; i++) {
    const t = ((i + 0.5) / MOTION_TIME_SAMPLES) * exposureS;
    const dxMm = motion.speedMps * 1000 * t; // m/s * 1000 mm/m * s -> mm
    const shifted = prepared?.scenes[i] ?? shiftBillboards(sceneObj, movingBillboardIds, dxMm);
    samples.push(traceSource(bx, by, width, height, blockPitchMm, efl, workingFno, shifted, spec, exposureS, prepared?.irradiance));
  }
  return averageSourceSamples(samples);
}

/** The rectilinear-pinhole projection of a world point (mm, same origin/axes as `traceSource`'s primary
 *  rays) to a (possibly fractional) rendered-pixel position — the exact inverse of the sensorXmm/sensorYmm
 *  math `traceSource` uses, so a point highlight's own splat lands exactly where a primary ray aimed at it
 *  would have. Exported for tests that need to locate a known scene point at a given render resolution. */
export function projectToRenderedPixel(efl: number, blockPitchMm: number, width: number, height: number, x: number, y: number, z: number) {
  const depthMm = Math.hypot(x, y, z);
  const cosTheta = z / depthMm;
  const sensorXmm = (-x * efl) / z;
  const sensorYmm = (-y * efl) / z;
  // photo orientation: the sensor image rotated back upright (traceSource's exact inverse)
  const bx = -sensorXmm / blockPitchMm + width / 2 - 0.5;
  const by = height / 2 + sensorYmm / blockPitchMm - 0.5;
  return { bx, by, depthMm, cosTheta };
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

function interleaveRgb(planes: RgbPlanes): Float32Array {
  const { width, height } = planes.R;
  const out = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    out[i * 3] = planes.R.data[i];
    out[i * 3 + 1] = planes.G.data[i];
    out[i * 3 + 2] = planes.B.data[i];
  }
  return out;
}

function planesFromRaw(raw: Uint16Array, width: number, height: number): Plane {
  const p = makePlane(width, height);
  for (let i = 0; i < raw.length; i++) p.data[i] = raw[i];
  return p;
}

/**
 * Finding S2: `sens` (`spec.qe`) is per-PHOTON quantum efficiency (electrons generated per incident photon —
 * `sensor.ts`'s own `SensorSpec.qe` doc comment), but `spectrumToCameraRGB`/`whiteBalanceGains` integrate
 * spectrum(nm) * sens(nm) directly, i.e. treat `sens` as a per-ENERGY (per-watt) responsivity. The real
 * sensor stage never makes that mistake: `photonsFromIrradiance` (this file) and `photonsPerBin` (exposure.ts)
 * both convert each bin's ENERGY to photons by dividing by that bin's photon energy (`photonEnergy`, hc/lambda)
 * BEFORE `expectedElectrons` (sensor.ts) applies photon QE — so response is proportional to
 * integral(power(lambda) * lambda * QE(lambda) dlambda) (EMVA 1288 release 3.1, pp. 5-6, eqs. (1), (2), (6):
 * photons = energy * lambda/(hc), electrons = photons * QE; hc is a fixed constant that cancels out of every
 * ratio white balance and the color-matrix fit use it for, so only the wavelength factor needs to be applied
 * here, not the full hc/lambda conversion). Calibration (white balance, color-matrix training) must apply the
 * SAME lambda weighting to its energy-spectrum integrals, or it trains against a different spectral response
 * than the sensor stage renders with — see color.test.ts's own `spectrumToCameraRGB`/`whiteBalanceGains`
 * tests, which stay energy-only (color.ts takes no data/units stance; see its header), and XYZ integration
 * below (`reflectanceToXYZ`), which stays in energy units per CIE 15:2004's own definition.
 */
function photonWeightedQe(sens: ChannelSensitivities): ChannelSensitivities {
  return { R: (nm) => nm * sens.R(nm), G: (nm) => nm * sens.G(nm), B: (nm) => nm * sens.B(nm) };
}

/**
 * A cam-RGB -> linear-sRGB color matrix fitted on the 24 ColorChecker patches (data/color's real, cited
 * reflectances) under the scene's own illuminant shape and this sensor's own QE curves — reused from
 * color.ts's `fitCameraToXYZ`, composed with the standard XYZ -> linear sRGB matrix.
 *
 * Both the training camera-RGB values (white-balanced, per `wbGains`, matching the pipeline's own stage
 * order: WB runs before the color matrix) and the training XYZ values are normalized to a spectrally-flat
 * reference reflector (rho = 1 under the same illuminant, mapping to white-balanced RGB = (1,1,1) and to
 * Y = 1) BEFORE the least-squares fit. This is what keeps the fitted matrix's own scale a pure chromaticity
 * transform, independent of the illuminant's/QE's arbitrary absolute units — `spectrumToCameraRGB`'s raw
 * spectral integral and the real pipeline's normalized-[0,1]-DN values differ by several orders of
 * magnitude, and fitting directly on the former (an earlier version of this function did) bakes that huge,
 * physically meaningless scale factor into the matrix, crushing every real rendered pixel toward black once
 * it is applied to actual (normalized) pipeline data. A linear matrix's own overall scale is otherwise
 * arbitrary — M and M/k both preserve every patch's chromaticity equally well — so anchoring it at the
 * reflectance-1 reference point (the one physically meaningful anchor common to both sides) is what makes
 * "fit under one scale, apply under another" work out correctly for whatever the scene's real exposure is
 * (a dark scene still comes out dark and correctly colored, not black).
 */
function fitColorMatrix(illuminantShape: (nm: number) => number, wbGains: readonly [number, number, number], spec: SensorSpec): Mat3 {
  const qe = photonWeightedQe(spec.qe); // Finding S2: train against the same photon-weighted response the sensor renders with
  const whiteRGB = spectrumToCameraRGB(illuminantShape, BINS, qe);
  const whiteRGBWb: [number, number, number] = [whiteRGB[0] * wbGains[0], whiteRGB[1] * wbGains[1], whiteRGB[2] * wbGains[2]];
  // whiteBalanceGains normalizes to G = 1 and equalizes R/G/B for a flat reflector, so every component of
  // whiteRGBWb is (to numerical precision) the same value; any one of them is the reference scale.
  const whiteScale = whiteRGBWb[1];
  const whiteXyzY = reflectanceToXYZ(() => 1, illuminantShape, BINS, CMF)[1]; // Y for a perfect reflector

  const cameraRGBs: [number, number, number][] = [];
  const xyzs: [number, number, number][] = [];
  for (const name of COLOR_CHECKER_NAMES) {
    const reflectance = colorCheckerReflectance(name);
    const litSpectrum = (nm: number) => reflectance(nm) * illuminantShape(nm);
    const rgb = spectrumToCameraRGB(litSpectrum, BINS, qe);
    cameraRGBs.push([(rgb[0] * wbGains[0]) / whiteScale, (rgb[1] * wbGains[1]) / whiteScale, (rgb[2] * wbGains[2]) / whiteScale]);
    const xyz = reflectanceToXYZ(reflectance, illuminantShape, BINS, CMF);
    xyzs.push([xyz[0] / whiteXyzY, xyz[1] / whiteXyzY, xyz[2] / whiteXyzY]);
  }
  const camToXyz = fitCameraToXYZ(cameraRGBs, xyzs);
  return mat3Multiply(XYZ_TO_LINEAR_SRGB, camToXyz);
}

/** Everything renderImage derives from `model` + a requested width/height before tracing a single pixel.
 *  Exported so tests (and any other caller wanting to trace individual sample points the exact way
 *  renderImage does, e.g. to locate a known scene feature at a given resolution) do not have to duplicate
 *  this setup. */
export interface RenderSetup {
  spec: SensorSpec;
  pixelScale: number;
  blockPitchMm: number;
  sampleScale: number;
  offsetX: number;
  offsetY: number;
  sceneObj: ReturnType<typeof getScene>;
  efl: number;
  workingFno: number;
  exposureS: number;
  iso: number;
  motion: { speedMps: number } | undefined;
  movingBillboardIds: string[];
  prepared: { irradiance: number[]; scenes: ReturnType<typeof getScene>[] };
}

export function renderSetup(model: Model, width: number, height = Math.round(width * 2 / 3)): RenderSetup {
  const { spec } = sensorFor(model.scenario.format, model.scenario.iso, model.scenario.sensor);
  const pitchMm = spec.pitchUm / 1000;

  // Fit a centered window of the requested aspect inside the active sensor. Spatial sample spacing is
  // continuous; round only the Bayer block used to approximate averaged noise, never the field of view.
  const sampleScale = Math.min(model.sensor.widthPx / width, model.sensor.heightPx / height);
  const pixelScale = Math.max(2, 2 * Math.floor(sampleScale / 2));
  const blockPitchMm = pitchMm * sampleScale;
  const offsetX = (model.sensor.widthPx - width * sampleScale) / 2;
  const offsetY = (model.sensor.heightPx - height * sampleScale) / 2;

  const cctK = model.scenario.cct ?? sceneDefaultCctK(model.scenario.scene);
  const lux = model.scenario.lux ?? sceneDefaultLux(model.scenario.scene);
  const baseScene = sceneFor(model.scenario.scene, model.scenario.subjectM);
  const illuminantShape = daylightAt(cctK);
  const sceneObj = { ...baseScene, illuminant: { spectrum: illuminantShape, lux } };
  // Render-local exact caches: no spectral resampling, rounding, or changed temporal sample order.
  const irradiance = illuminantSpectralIrradiance(illuminantShape,lux,BINS,V_LAMBDA);
  const prepared = { irradiance:BINS.centers.map(irradiance), scenes:Array.from({length:MOTION_TIME_SAMPLES},(_,i)=>
    shiftBillboards(sceneObj,sceneObj.movingBillboardIds??[],(model.scenario.motion?.speedMps??0)*1000*(((i+.5)/MOTION_TIME_SAMPLES)*model.scenario.shutter))) };

  return {
    spec,
    pixelScale,
    blockPitchMm,
    sampleScale, offsetX, offsetY,
    sceneObj,
    prepared,
    efl: model.cardinal.efl,
    workingFno: model.focus.workingFno,
    exposureS: model.scenario.shutter,
    iso: model.scenario.iso,
    motion: model.scenario.motion,
    movingBillboardIds: sceneObj.movingBillboardIds ?? [],
  };
}

export function renderImage(model: Model, req: RenderRequest): RenderResult {
  const t0 = Date.now();
  const notes: string[] = [];
  const { width, height, seed } = req;

  const { spec, pixelScale, blockPitchMm, sampleScale, offsetX, offsetY, sceneObj, efl, workingFno, exposureS, iso, motion, movingBillboardIds, prepared } = renderSetup(model, width, height);
  notes.push(`pixelScale=${pixelScale} (each rendered pixel stands for a ${pixelScale}x${pixelScale} block of real sensor pixels)`);
  notes.push(`centered sensor window ${width * blockPitchMm}x${height * blockPitchMm} mm; sample spacing ${sampleScale} sensor pixels; Bayer blocks approximate local averaging`);

  const unitOutline: [number, number][] = model.iris.outline.map(([x, y]) => [x / model.iris.radius, y / model.iris.radius]);
  const kernelCache = new Map<number, KernelCell[]>();
  const kernelFor = (radiusPx: number): KernelCell[] => {
    // Beyond a couple of times the cap, buildKernel's own R = min(ceil(radiusPx), cap) means the resulting
    // kernel shape is already indistinguishable (dx/radiusPx ~ 0 for every dx in the capped box, so it is
    // effectively a full box regardless of exactly how much bigger radiusPx still is) — clamping the CACHE
    // KEY here too avoids rebuilding that same effective kernel over and over for many different very large
    // radii (a fast lens focused close with a background near infinity produces a wide range of them).
    const clamped = Math.min(radiusPx, MAX_KERNEL_RADIUS_PX);
    const key = Math.round(clamped * 4) / 4; // cache at quarter-rendered-pixel resolution
    let k = kernelCache.get(key);
    if (!k) {
      k = buildKernel(unitOutline, key);
      kernelCache.set(key, k);
    }
    return k;
  };

  const n = width * height;
  const destChannel = new Float32Array(n * 3); // accumulated (blurred) expected electrons per real pixel, R/G/B

  const diffractionDiameterMm = 2 * airyRadius(550, workingFno);
  let kernelClamped = false;

  // At field silhouettes, integrate four spatial samples BEFORE blur, retaining each sample's own depth.
  // Averaging foreground and background depths would invent a false blur disk along bird/branch edges.
  // Three cached center rows identify boundaries cheaply; interiors retain the single-sample fast path.
  const edgeSampling = model.scenario.scene === 'field' || model.scenario.scene === 'flight';
  const centerRows = new Map<number, SourceSample[]>();
  const centerRow = (y: number) => {
    const rowY = Math.max(0, Math.min(height - 1, y));
    let row = centerRows.get(rowY);
    if (!row) {
      row = Array.from({ length: width }, (_, x) => traceSourceWithMotion(x, rowY, width, height, blockPitchMm, efl, workingFno, sceneObj, spec, exposureS, motion, movingBillboardIds, prepared));
      centerRows.set(rowY, row);
    }
    return row;
  };
  let sampledEdges = 0;

  for (let by = 0; by < height; by++) {
    const row = edgeSampling ? centerRow(by) : null;
    const above = edgeSampling ? centerRow(by - 1) : null;
    const below = edgeSampling ? centerRow(by + 1) : null;
    for (let bx = 0; bx < width; bx++) {
      const center = row ? row[bx] : traceSourceWithMotion(bx, by, width, height, blockPitchMm, efl, workingFno, sceneObj, spec, exposureS, motion, movingBillboardIds, prepared);
      const boundary = row && [row[Math.max(0, bx - 1)], row[Math.min(width - 1, bx + 1)], above![bx], below![bx]].some(s => s.hitId !== center.hitId);
      const samples = boundary ? [-0.25, 0.25].flatMap(dy => [-0.25, 0.25].map(dx => traceSourceWithMotion(bx + dx, by + dy, width, height, blockPitchMm, efl, workingFno, sceneObj, spec, exposureS, motion, movingBillboardIds, prepared))) : [center];
      if (boundary) sampledEdges++;
      for (const src of samples) {
        // exitPupilBlurDiameterMm's pointDistMm is the object's AXIAL distance from the sensor (the distance to
        // its z-plane), not the ray's Euclidean hit distance (src.depthMm, which is larger for every off-axis
        // pixel by 1/cosTheta) — see camera.ts's own pointBundle convention and paraxial.ts's imageOf doc
        // comment, both cited in e4.md. src.objectPoint[2] is that hit point's own axial z, already computed.
        const defocusDiameterMm = exitPupilBlurDiameterMm(model, src.objectPoint[2]);
        const combinedDiameterMm = Math.hypot(defocusDiameterMm, diffractionDiameterMm); // RSS combination, assumed
        const radiusPx = combinedDiameterMm / blockPitchMm / 2;
        if (radiusPx > MAX_KERNEL_RADIUS_PX) kernelClamped = true;
        const kernel = kernelFor(radiusPx);

        for (const cell of kernel) {
          const ddx = bx + cell.dx;
          const ddy = by + cell.dy;
          if (ddx < 0 || ddx >= width || ddy < 0 || ddy >= height) continue;
          const didx = (ddy * width + ddx) * 3;
          destChannel[didx] += src.channelElectronsSharp[0] * cell.w / samples.length;
          destChannel[didx + 1] += src.channelElectronsSharp[1] * cell.w / samples.length;
          destChannel[didx + 2] += src.channelElectronsSharp[2] * cell.w / samples.length;
        }
      }
    }
    centerRows.delete(by - 1);
  }
  if (edgeSampling) notes.push(`${model.scenario.scene} silhouette antialiasing: four depth-preserving subpixel samples at ${sampledEdges} boundary pixels; fine features smaller than the sampling grid remain approximate`);
  if (kernelClamped) notes.push(`some source pixels' blur exceeded the ${MAX_KERNEL_RADIUS_PX}-rendered-pixel kernel cap and render slightly sharper than the true physics there (see e4.md)`);

  // ---- point highlights: splat directly, by projection, not by hoping a per-pixel primary ray hits them ----
  // A physically tiny emitter (BRIEF.md set piece 3's background bokeh lights; scenes.ts's own doc comment
  // sizes them at a few mm) subtends a FAR smaller angle than one rendered pixel at any resolution this
  // module targets (e.g. a 2 mm source at 25 m is about 240x narrower, in angle, than one rendered pixel at
  // 600x400 on this lens) — so a single primary ray per rendered pixel has essentially zero chance of ever
  // landing on one (see docs/engine/e4.md, "Known limits"). Point highlights are therefore rendered as a
  // second, direct pass: project each one to its own (sub-pixel-precise) rendered-pixel position and splat
  // its own radiance through the SAME camera equation and the SAME blur kernel machinery the main loop uses,
  // added on top of whatever the main loop already put there (the background behind/around it) — the correct
  // composite for a source much smaller than the sensing/blur footprint around it.
  for (const hl of sceneObj.pointHighlights ?? []) {
    const [X, Y, Z] = hl.position;
    if (Math.hypot(X, Y, Z) < 1e-6) continue;
    const { bx: bxf, by: byf, cosTheta } = projectToRenderedPixel(efl, blockPitchMm, width, height, X, Y, Z);

    const radianceByBin = BINS.centers.map((nm) => hl.radianceAt(nm));
    const irradiance = radianceByBin.map((L) => imageIrradiance(L, ASSUMED_LENS_TRANSMISSION, workingFno, cosTheta));
    const pixelAreaM2 = (spec.pitchUm * 1e-6) ** 2;
    const photonsByBin = photonsFromIrradiance(irradiance, BINS.centers, BINS.weights, pixelAreaM2, exposureS);
    const channelE = CHANNELS.map((c) => expectedElectrons(spec, photonsByBin, BINS.centers, c)) as [number, number, number];

    // Same axial-vs-Euclidean distinction as the main loop above: Z (the highlight's own world z, already in
    // scope from hl.position) is the axial distance exitPupilBlurDiameterMm requires, not the projection's
    // Euclidean depthMm.
    const defocusDiameterMm = exitPupilBlurDiameterMm(model, Z);
    const combinedDiameterMm = Math.hypot(defocusDiameterMm, diffractionDiameterMm);
    const radiusPx = combinedDiameterMm / blockPitchMm / 2;
    // A handful of highlights, not a pixel each: they get their true disk size, uncapped (up to a frame-sized
    // bound), so a far glint behind a close subject reads as the big soft disk it is.
    const kernel = buildKernel(unitOutline, radiusPx, Math.max(width, height) / 2);
    const bx0 = Math.round(bxf);
    const by0 = Math.round(byf);
    for (const cell of kernel) {
      const ddx = bx0 + cell.dx;
      const ddy = by0 + cell.dy;
      if (ddx < 0 || ddx >= width || ddy < 0 || ddy >= height) continue;
      const didx = (ddy * width + ddx) * 3;
      destChannel[didx] += channelE[0] * cell.w;
      destChannel[didx + 1] += channelE[1] * cell.w;
      destChannel[didx + 2] += channelE[2] * cell.w;
    }
  }

  // ---- raw Bayer mosaic: each rendered pixel's own block-average real pixel, per e4.md's binning design ----
  const raw = new Uint16Array(n);
  const halfBlock = pixelScale / 2;
  const nSameColorInBlock = { R: halfBlock * halfBlock, G: 2 * halfBlock * halfBlock, B: halfBlock * halfBlock } as const;
  const fullWell = fullWellAtIso(spec, iso);

  // Finding S3: the block's mean electron count must include the mean dark charge (darkCurrentEPerS *
  // exposureS), same as samplePixel's own step 4 (sensor.ts) — otherwise the binned raw image (what a
  // caller reads as "the picture") and the per-pixel loupe draw (samplePixel) disagree on mean charge even
  // though they already share the dark SHOT-NOISE variance term (varianceE bakes it into varOfBlockMean
  // below). photoMeanE stays dark-free for the variance call (that formula's own shot-noise/PRNU terms are
  // photo-electron-only; darkMeanE is added back to the block's total mean here, and varianceE already adds
  // its own dark-shot-noise term separately — see sensor.ts's varianceE doc comment).
  const darkMeanE = spec.darkCurrentEPerS * exposureS;

  for (let by = 0; by < height; by++) {
    for (let bx = 0; bx < width; bx++) {
      const idx = by * width + bx;
      const cfa = cfaColorAt('RGGB', bx, by);
      const ci = cfa === 'R' ? 0 : cfa === 'G' ? 1 : 2;
      const photoMeanE = destChannel[idx * 3 + ci];
      const nSame = nSameColorInBlock[cfa];
      const varOfBlockMean = varianceE(spec, photoMeanE, exposureS, iso) / nSame;
      const rng = makeRng(seed, blockStream(bx, by));
      let sampled = photoMeanE + darkMeanE + rng.normal() * Math.sqrt(Math.max(0, varOfBlockMean));
      sampled = Math.min(fullWell, Math.max(0, sampled));
      raw[idx] = readout(spec, sampled, iso, 0);
    }
  }

  // ---- pixel(x, y): a fresh, full-statistics single real pixel at the block's center -------------------
  function pixel(bx: number, by: number) {
    if (!Number.isInteger(bx) || !Number.isInteger(by) || bx < 0 || bx >= width || by < 0 || by >= height) throw new RangeError('Rendered pixel is outside the photo.');
    const idx = by * width + bx;
    const realX = Math.min(model.sensor.widthPx - 1, Math.floor(offsetX + (bx + 0.5) * sampleScale));
    const realY = Math.min(model.sensor.heightPx - 1, Math.floor(offsetY + (by + 0.5) * sampleScale));
    const cfa = cfaColorAt('RGGB', realX, realY);
    const ci = cfa === 'R' ? 0 : cfa === 'G' ? 1 : 2;

    // Recompute this pixel's own (sharp, unblurred) spectrum on demand — "the ray bundle that fed that
    // pixel is traced from the matching object point through the lens" (BRIEF.md set piece 9) — then scale
    // its overall brightness to match the properly BLURRED per-channel mean already accumulated above, so
    // the well-fill level shown still reflects real defocus/diffraction mixing from neighboring points, not
    // just this one sharp sample. See e4.md, "render.ts", for why this is a documented approximation (the
    // spectral SHAPE shown is this point's own; only the TOTAL is blur-corrected).
    const src = traceSourceWithMotion(bx, by, width, height, blockPitchMm, efl, workingFno, sceneObj, spec, exposureS, motion, movingBillboardIds, prepared);
    const sharpChannelE = src.channelElectronsSharp[ci];
    const blurredChannelE = destChannel[idx * 3 + ci];
    const scale = sharpChannelE > 1e-12 ? blurredChannelE / sharpChannelE : 0;
    const photonsByBin = src.photonsByBinSharp.map((v) => v * scale);

    const rng = makeRng(seed, pixelStream(bx, by));
    const state = samplePixel(spec, rng, { x: realX, y: realY, cfa, photonsByBin, binCentersNm: BINS.centers, exposureS, iso });
    return { ...state, objectPoint: [src.objectPoint[0], src.objectPoint[1], src.objectPoint[2]] as [number, number, number], depthMm: src.depthMm };
  }

  // ---- pipeline stages: black level -> normalize -> demosaic -> white balance -> color matrix -> tone -----
  const rawPlane = planesFromRaw(raw, width, height);
  const blDn = spec.blackLevelDn;
  const fullScaleDn = maxDn(spec) - blDn;
  const blSubtracted = blackLevelSubtract(rawPlane, blDn);
  const normalized: Plane = { width, height, data: Float32Array.from(blSubtracted.data, (v) => Math.max(0, v) / fullScaleDn) };
  const demosaic = demosaicMalvarHeCutler(normalized, 'RGGB');

  const illuminantShape = sceneObj.illuminant.spectrum;
  const wbGains = whiteBalanceGains(illuminantShape, BINS, photonWeightedQe(spec.qe)); // Finding S2
  const wb = applyWhiteBalance(demosaic, wbGains);
  // Clip to a common, per-channel-equal ceiling BEFORE the color matrix mixes the three channels -- see
  // pipeline.ts's clipHighlightsToNeutral doc comment for why doing this after the matrix (or not at all,
  // relying on encodeRGB8's own implicit per-channel clamp) lets a genuinely blown, physically-neutral
  // highlight take on a pink/magenta cast from the white-balance gains' own imbalance.
  const clipped = clipHighlightsToNeutral(wb, wbGains);

  const ccm = fitColorMatrix(illuminantShape, wbGains, spec);
  const colorMatrixed = applyColorMatrix(clipped, ccm);

  const tone = applyToneCurve(colorMatrixed, srgbToneCurve);
  const encoded = encodeRGB8(tone);

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = encoded.data[i * 3];
    rgba[i * 4 + 1] = encoded.data[i * 3 + 1];
    rgba[i * 4 + 2] = encoded.data[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }

  const stages: Record<string, Float32Array> = {
    demosaic: interleaveRgb(demosaic),
    wb: interleaveRgb(clipped),
    ccm: interleaveRgb(colorMatrixed),
    tone: interleaveRgb(tone),
  };

  notes.push('rectilinear pinhole projection from the real EFL (no lens distortion, no entrance-pupil offset)');
  notes.push('defocus and diffraction blur combined in quadrature (RSS) into one splat kernel, shaped by the current iris outline');
  notes.push(`raw[] holds each block's average real pixel (noise reduced by sqrt(N), N = same-CFA-color pixels per block); pixel(x,y) samples one fresh, full-statistics real pixel at the block center`);

  const ms = Date.now() - t0;
  return {
    width,
    height,
    pixelScale,
    rgba,
    raw,
    stages,
    pixel,
    meta: { seed, ms, notes },
  };
}

function blockStream(bx: number, by: number): number {
  return (((by * 2654435761) ^ (bx * 40503)) >>> 0) * 2; // even -> a stream distinct from pixelStream's odd
}

function pixelStream(bx: number, by: number): number {
  return blockStream(bx, by) + 1; // odd, guaranteed distinct from any blockStream() value
}

export { traceSource, traceSourceWithMotion };
