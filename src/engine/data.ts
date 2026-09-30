// The one place engine data is imported. Every other engine module takes its data as plain-function/array
// arguments (glass.ts's GlassCatalog, sensor.ts's SensorSpec, color.ts's CMFs/ChannelSensitivities, scene.ts's
// Illuminant/Billboard) so it can be unit-tested with fixtures; this module is where `data/*.json` actually
// gets wired into those shapes for the real app and for camera.ts/render.ts (workstream E4). See docs/ENGINE.md
// and docs/engine/e4.md.
//
// Caching: `getRealizedLens` memoizes per lens id, because `realize()` runs a real-ray survey over the field
// and pupil (docs/engine/e4.md, "realize.ts") that costs on the order of 100 ms — paid once per lens id, not
// once per scenario.

import type { Bins, TraceSurface } from './types';
import type { GlassEntry, LensDesign } from './lens-types';
import type { CfaColor } from './types';
import type { CMFs, ChannelSensitivities } from './color';
import type { SensorSpec, ReadNoiseSpec } from './sensor';
import type { LensInfo, SensorInfo } from './model-types';
import type { Format, FormatId } from './types';

import { makeCatalog, type GlassCatalog, FRAUNHOFER_D_NM } from './glass';
import { loadLens, cardinal, type ResolvedLens } from './lens';
import { realize, type RealizedLens } from './realize';
import { FORMATS } from './formats';

// ---- raw JSON --------------------------------------------------------------------------------------------

import glassCatalogJson from '../../data/glass/catalog.json';

import p20Json from '../../data/lenses/p20.json';
import p24Json from '../../data/lenses/p24.json';
import p28Json from '../../data/lenses/p28.json';
import p35Json from '../../data/lenses/p35.json';
import p50Json from '../../data/lenses/p50.json';
import p85Json from '../../data/lenses/p85.json';
import p105Json from '../../data/lenses/p105.json';
import p135Json from '../../data/lenses/p135.json';
import p200Json from '../../data/lenses/p200.json';
import p300Json from '../../data/lenses/p300.json';
import p400Json from '../../data/lenses/p400.json';
import p500Json from '../../data/lenses/p500.json';

// The PANE.md camera-and-lens lineup (docs/PANE.md): DSLR (s35, n50, n500, n500fl on Nikon F) and mirrorless
// (z35, m50, z800 on Nikon Z), added by the lens-exteriors workstream (09/28/2026) alongside
// data/hardware/lens-exteriors.json and research/exteriors.md's addendum for these seven ids.
import s35Json from '../../data/lenses/s35.json';
import n50Json from '../../data/lenses/n50.json';
import n500Json from '../../data/lenses/n500.json';
import n500flJson from '../../data/lenses/n500fl.json';
import z35Json from '../../data/lenses/z35.json';
import m50Json from '../../data/lenses/m50.json';
import z800Json from '../../data/lenses/z800.json';

import sensorsJson from '../../data/sensors.json';
import readNoiseJson from '../../data/read-noise.json';

// The docs/PANE.md camera-rig lineup's two real bodies (Finding S1): the DSLR (Nikon F lineup lenses) carries
// the D850's sensor, the mirrorless (Nikon Z lineup lenses) the Z8's — not the free-form primes' Sony a7R IV
// stand-in. Each file is its own self-contained sensor + read-noise record (data/d850.json, data/z8.json),
// researched and shaped like data/sensors.json + data/read-noise.json combined, so `sensorFor` below can build
// a SensorBundle from either source uniformly. See BODY_SENSORS.
import d850Json from '../../data/d850.json';
import z8Json from '../../data/z8.json';

import cmf1931Json from '../../data/color/cie1931-2deg-cmf.json';
import d65Json from '../../data/color/illuminant-d65.json';
import daylightBasisJson from '../../data/color/daylight-basis-s0s1s2.json';
import cameraSensGaussianJson from '../../data/color/camera-sensitivity-gaussian-model.json';
import colorCheckerJson from '../../data/color/colorchecker24-babelcolor.json';
import wavelengthBins16Json from '../../data/color/wavelength-bins-16.json';

// ---- small shared helper: a table-lookup spectrum from a (lambdas, values) pair --------------------------

/**
 * Linear-interpolation table lookup, the shape every data/color/*.json file below is sampled as. Clamps to the
 * nearest tabulated value outside the table's range (rather than returning 0), since every use here queries
 * within or very near the tabulated span; a caller that needs an out-of-range failure should check the range
 * itself first.
 */
export function tableSpectrum(lambdas: readonly number[], values: readonly number[]): (nm: number) => number {
  if (lambdas.length !== values.length) {
    throw new Error('data.ts: tableSpectrum: lambdas and values must have the same length');
  }
  return (nm: number): number => {
    const n = lambdas.length;
    if (nm <= lambdas[0]) return values[0];
    if (nm >= lambdas[n - 1]) return values[n - 1];
    // lambdas is sorted ascending in every file this module reads; linear scan is fine at these sizes
    // (<= 531 points), called at most a few thousand times per render, not per inner sample loop.
    let i = 0;
    while (lambdas[i + 1] < nm) i++;
    const t = (nm - lambdas[i]) / (lambdas[i + 1] - lambdas[i]);
    return values[i] * (1 - t) + values[i + 1] * t;
  };
}

// ---- glass catalog (data/glass/catalog.json) --------------------------------------------------------------

/** The full glass catalog, wired once. Every lens load resolves its glasses against this. */
export const GLASS_CATALOG: GlassCatalog = makeCatalog(glassCatalogJson as unknown as GlassEntry[]);

// ---- lenses (data/lenses/*.json), loadLens then realize, cached per id ------------------------------------

const LENS_DESIGNS: Record<string, LensDesign> = {
  p20: p20Json as unknown as LensDesign,
  p24: p24Json as unknown as LensDesign,
  p28: p28Json as unknown as LensDesign,
  p35: p35Json as unknown as LensDesign,
  p50: p50Json as unknown as LensDesign,
  p85: p85Json as unknown as LensDesign,
  p105: p105Json as unknown as LensDesign,
  p135: p135Json as unknown as LensDesign,
  p200: p200Json as unknown as LensDesign,
  p300: p300Json as unknown as LensDesign,
  p400: p400Json as unknown as LensDesign,
  p500: p500Json as unknown as LensDesign,
  s35: s35Json as unknown as LensDesign,
  n50: n50Json as unknown as LensDesign,
  n500: n500Json as unknown as LensDesign,
  n500fl: n500flJson as unknown as LensDesign,
  z35: z35Json as unknown as LensDesign,
  m50: m50Json as unknown as LensDesign,
  z800: z800Json as unknown as LensDesign,
};

export function lensIds(): string[] {
  return Object.keys(LENS_DESIGNS);
}

export function lensDesign(id: string): LensDesign {
  const d = LENS_DESIGNS[id];
  if (!d) throw new Error(`data.ts: lensDesign: unknown lens id "${id}" (known: ${lensIds().join(', ')})`);
  return d;
}

interface LensBundle {
  realized: RealizedLens;
  info: LensInfo;
}

const lensCache = new Map<string, LensBundle>();

/**
 * loadLens -> realize for a lens id, cached: realize() runs a real-ray field/pupil survey that costs on the
 * order of 100 ms (see realize.ts), so this module pays it once per id rather than once per compute() call.
 */
function getLensBundle(id: string): LensBundle {
  const cached = lensCache.get(id);
  if (cached) return cached;
  const design = lensDesign(id);
  const resolved: ResolvedLens = loadLens(design, GLASS_CATALOG);
  const realized = realize(resolved);

  // LensInfo.efl/maxFno are the DESIGN's own values, at infinity focus and the design's own maximum stop —
  // independent of whatever scenario.fno the reader has picked, unlike Model.cardinal (which is the current
  // stop, current focus). Computed once here, at realize()'s own wide-open infinity-focus stop radius.
  const infCardinal = cardinal(
    { surfaces: buildInfinitySurfacesFor(realized), index: realized.index },
    FRAUNHOFER_D_NM,
    realized.realization.stopRadius,
  );

  const info: LensInfo = {
    id: design.id,
    name: design.name,
    focalLength: design.focalLength,
    efl: infCardinal.efl,
    maxFno: design.maxFno,
    markedFno: design.markedFno ?? design.maxFno,
    elements: design.elements,
    groups: design.groups,
    blades: design.iris.blades,
    rounded: design.iris.rounded,
    closestFocusMm: realized.realization.closestFocusMm,
    representativeOf: design.representativeOf,
    source: {
      ref: design.source.ref,
      url: design.source.url,
      location: design.source.location,
      assignee: design.source.assignee,
      published: design.source.published,
    },
    warnings: [...resolved.warnings],
  };

  const bundle: LensBundle = { realized, info };
  lensCache.set(id, bundle);
  return bundle;
}

// Small local helper: the infinity-focus TraceSystem's surfaces for a RealizedLens, without going through
// lens.ts's systemAt (which needs a ResolvedLens, and RealizedLens already carries afOffset-adjusted raw
// surfaces from realize()). Mirrors systemAt(lens, null)'s own surface-building loop.
function buildInfinitySurfacesFor(lens: RealizedLens): TraceSurface[] {
  const out: TraceSurface[] = [];
  let z = 0;
  for (const r of lens.raw) {
    out.push({ z, c: r.c, k: r.k, a: r.a, sd: r.sd, kind: r.kind, mediumAfter: r.mediumAfter, label: r.label, coated: r.coated });
    z += r.t;
  }
  out.push({ z: z + (lens.afOffset ?? 0), c: 0, k: 0, a: [], sd: 1e9, kind: 'image', mediumAfter: 'air' });
  return out;
}

export function getRealizedLens(id: string): RealizedLens {
  return getLensBundle(id).realized;
}

export function getLensInfo(id: string): LensInfo {
  return getLensBundle(id).info;
}

// ---- spectral bins (data/color/wavelength-bins-16.json) ----------------------------------------------------

interface WavelengthBins16Json {
  bins: { edge_low_nm: number; edge_high_nm: number; center_nm: number }[];
}

const bins16 = wavelengthBins16Json as unknown as WavelengthBins16Json;

/** The engine's default 16-bin spectral resolution (BRIEF.md: "at least 16 wavelength bins"), built directly
 *  from data/color/wavelength-bins-16.json's own edges/centers rather than recomputed, so a change to that
 *  file's binning scheme is picked up here automatically. */
export const BINS: Bins = {
  centers: bins16.bins.map((b) => b.center_nm),
  edges: [...bins16.bins.map((b) => b.edge_low_nm), bins16.bins[bins16.bins.length - 1].edge_high_nm],
  weights: bins16.bins.map((b) => b.edge_high_nm - b.edge_low_nm),
};

// ---- CIE color matching functions, D65, daylight basis (data/color/*.json) --------------------------------

interface LambdaValuesJson<V> {
  lambda: number[];
  values: V;
}

const cmfData = cmf1931Json as unknown as LambdaValuesJson<{ x_bar: number[]; y_bar: number[]; z_bar: number[] }>;

/** CIE 1931 2-degree standard observer, table-interpolated from the 1 nm CIE data (360-830 nm). */
export const CMF: CMFs = {
  xbar: tableSpectrum(cmfData.lambda, cmfData.values.x_bar),
  ybar: tableSpectrum(cmfData.lambda, cmfData.values.y_bar),
  zbar: tableSpectrum(cmfData.lambda, cmfData.values.z_bar),
};

/** CIE y-bar doubles as V(lambda), the photopic luminous efficiency function (see docs/engine/e3.md, scene.ts
 *  section: "ybar IS the CIE 1924 photopic luminous efficiency function"). */
export const V_LAMBDA: (nm: number) => number = CMF.ybar;

const d65Data = d65Json as unknown as LambdaValuesJson<number[]>;
/** CIE Standard Illuminant D65's measured relative SPD, table-interpolated. */
export const D65_SPECTRUM: (nm: number) => number = tableSpectrum(d65Data.lambda, d65Data.values);

const daylightData = daylightBasisJson as unknown as LambdaValuesJson<{ S0: number[]; S1: number[]; S2: number[] }>;
export const DAYLIGHT_LAMBDAS: readonly number[] = daylightData.lambda;
export const DAYLIGHT_S0: readonly number[] = daylightData.values.S0;
export const DAYLIGHT_S1: readonly number[] = daylightData.values.S1;
export const DAYLIGHT_S2: readonly number[] = daylightData.values.S2;

// ---- ColorChecker reflectances (data/color/colorchecker24-babelcolor.json) ---------------------------------

interface ColorCheckerJson {
  lambda: number[];
  patches: Record<string, number[]>;
}

const colorCheckerData = colorCheckerJson as unknown as ColorCheckerJson;

/** The 24 ColorChecker patch names, in the file's own order. */
export const COLOR_CHECKER_NAMES: readonly string[] = Object.keys(colorCheckerData.patches);

/** One ColorChecker patch's reflectance (0..1), table-interpolated. Throws on an unknown patch name. */
export function colorCheckerReflectance(name: string): (nm: number) => number {
  const values = colorCheckerData.patches[name];
  if (!values) {
    throw new Error(`data.ts: colorCheckerReflectance: unknown patch "${name}" (known: ${COLOR_CHECKER_NAMES.join(', ')})`);
  }
  return tableSpectrum(colorCheckerData.lambda, values);
}

// ---- camera spectral sensitivities (data/color/camera-sensitivity-*.json) -----------------------------------

interface GaussianCameraSensJson {
  params: Record<CfaColor, { peak_nm: number; sigma_nm: number; amplitude: number }>;
}
const gaussianSensData = cameraSensGaussianJson as unknown as GaussianCameraSensJson;

/**
 * The default camera spectral sensitivity model (BRIEF.md task text: use this by default, since the Jiang
 * 2013 measured set is CC BY-NC-SA and using it needs Reed's own decision — see `jiangCameraSensitivities` in
 * jiang.ts, kept selectable but out of the app bundle). A Gaussian per channel (peak_nm, sigma_nm, amplitude), fitted to a real measured camera
 * (Nikon D700) but carrying no license restriction (data/color/camera-sensitivity-gaussian-model.json's own
 * "derived" evidence note). The fitted amplitudes are normalized to that source curve's own per-channel peak
 * (G's amplitude = 1.0, the largest of the three); `peakQE` rescales the whole triplet so the largest channel
 * peaks at `peakQE` (a sensor's own reported peak-QE spec, data/sensors.json `qe.peakPercent`), which is the
 * only physically meaningful anchor this data gives us for absolute photon-to-electron efficiency. Evidence:
 * derived (a reported peak-QE spec combined with a derived spectral shape fitted to a different camera).
 */
export function gaussianCameraSensitivities(peakQE: number): ChannelSensitivities {
  const scale = peakQE; // source amplitudes already peak at 1.0 (the G channel), see doc comment above
  const out = {} as ChannelSensitivities;
  for (const ch of ['R', 'G', 'B'] as CfaColor[]) {
    const { peak_nm, sigma_nm, amplitude } = gaussianSensData.params[ch];
    const a = amplitude * scale;
    out[ch] = (nm: number) => a * Math.exp(-((nm - peak_nm) ** 2) / (2 * sigma_nm * sigma_nm));
  }
  return out;
}

// The measured Jiang et al. 2013 set lives in src/engine/jiang.ts, outside the app bundle (CC BY-NC-SA 4.0).

// ---- sensors (data/sensors.json + data/read-noise.json) ----------------------------------------------------
//
// Three real, cited sensor picks, one per format (data/sensors.json). Read noise (electrons) and full well
// come from data/read-noise.json's direct read of Bill Claff's photonstophotos.net measured curves — see that
// file's own `meta` for the extraction method. `sensorReadNoiseAtIso` interpolates read noise on Claff's own
// measured points (log-log in ISO, matching how the source chart itself is scaled: log2(ISO) on x, log2(e-)
// on y) rather than using sensor.ts's own two-level lcgE/hcgE step model, which is only a fixed-below/above-
// dcgSwitchIso approximation E3 built before real per-ISO curves were available (see sensor.ts's ReadNoiseSpec
// doc comment). `sensorSpecForIso` below still returns a sensor.ts SensorSpec (so sensor.ts/render.ts need no
// changes — see the E4 workstream report's needs_from_lead), but builds it FOR one specific ISO, with
// `readNoise.lcgE = readNoise.hcgE` both set to the interpolated value at that ISO and `dcgSwitchIso: 0` so
// sensor.ts's own step logic is a no-op and always returns exactly that interpolated figure.

interface SensorsJson {
  sensors: {
    id: string;
    format: string;
    cameraName: string;
    pixelPitchUm: { v: number };
    pixelCount: { effectiveH?: { v: number }; effectiveV?: { v: number } };
    activeArea: { widthMm: { v: number }; heightMm: { v: number } };
    microlensFillFactor: { v: number };
    qe: { peakPercent?: { v: number }; relatedChipPeakPercentIMX571?: { v: number }; relatedChipPeakPercentIMX294color?: { v: number } };
    darkCurrent: Record<string, { v: number } | undefined>;
    adcBitDepthBits?: { v?: number; om1RawFile?: { v: number } };
    rawFileBitDepth?: { uncompressed?: { v: number } };
  }[];
  generic: { darkCurrent: { doublingTemperatureC: { v: number } }; prnu: { typicalPercent: { v: number } } };
}
const sensorsData = sensorsJson as unknown as SensorsJson;

interface ReadNoisePoint { iso: number; readNoiseE: number }
interface ReadNoiseCameraJson {
  fwcElectrons: { v: number };
  unityGainIso: { v: number };
  normalAnalogRangeIso: { v: [number, number] };
  dcgIso: { fromIso: number; toIso: number };
  points: ReadNoisePoint[];
}
interface ReadNoiseJson { cameras: Record<string, ReadNoiseCameraJson> }
const readNoiseData = readNoiseJson as unknown as ReadNoiseJson;

/** Maps a Format id to its data/sensors.json id and its data/read-noise.json camera key. */
const SENSOR_BY_FORMAT: Record<FormatId, { sensorId: string; readNoiseKey: string }> = {
  ff: { sensorId: 'full-frame-a7r4-imx455', readNoiseKey: 'Sony a7R IV (ILCE-7RM4)' },
  apsc: { sensorId: 'apsc-a6x00-family', readNoiseKey: 'Sony a6400 (ILCE-6400)' },
  mft: { sensorId: 'mft-om1-and-em1iii', readNoiseKey: 'OM System OM-1' },
};

/** The inverse of SENSOR_BY_FORMAT's sensorId -> readNoiseKey pairing, so `sensorFor` can look up the right
 *  read-noise camera for an EXPLICITLY supplied sensor id, not just the caller's format default (Finding S1:
 *  the old code always used `pick.readNoiseKey`, i.e. the format's default camera, even when a different
 *  sensor id was requested). Covers the three data/sensors.json picks; the two body records below
 *  (BODY_SENSORS) carry their own read-noise points directly and never consult this map. */
const REVERSE_READNOISE_KEY: Record<string, string> = Object.fromEntries(
  Object.values(SENSOR_BY_FORMAT).map((p) => [p.sensorId, p.readNoiseKey]),
);

/**
 * Read noise (e- rms) at an arbitrary ISO, log-log-interpolated between Bill Claff's own measured points
 * (data/read-noise.json). Both axes are logged before interpolating because that is the scale the source
 * chart itself plots in (ISO on log2, read-noise-in-electrons on log2) and read noise vs ISO is much closer
 * to piecewise-linear on that scale than on a linear one (see e.g. the DCG step, a near-vertical drop on
 * linear axes but a clean corner on log-log). Clamped to the table's own endpoints outside its ISO range.
 */
export function sensorReadNoiseAtIso(readNoiseKey: string, iso: number): number {
  const cam = readNoiseData.cameras[readNoiseKey];
  if (!cam) throw new Error(`data.ts: sensorReadNoiseAtIso: unknown camera "${readNoiseKey}"`);
  return interpolateReadNoise(cam.points, iso);
}

/** The log-log interpolation `sensorReadNoiseAtIso` documents above, factored out so the D850/Z8 body
 *  records (their own `points` array, read directly from data/d850.json and data/z8.json rather than
 *  data/read-noise.json) can share it. See that function's doc comment for the method and citation. */
function interpolateReadNoise(pts: readonly ReadNoisePoint[], iso: number): number {
  const n = pts.length;
  if (iso <= pts[0].iso) return pts[0].readNoiseE;
  if (iso >= pts[n - 1].iso) return pts[n - 1].readNoiseE;
  let i = 0;
  while (pts[i + 1].iso < iso) i++;
  const x0 = Math.log2(pts[i].iso), x1 = Math.log2(pts[i + 1].iso);
  const y0 = Math.log2(pts[i].readNoiseE), y1 = Math.log2(pts[i + 1].readNoiseE);
  const t = (Math.log2(iso) - x0) / (x1 - x0);
  return Math.pow(2, y0 + t * (y1 - y0));
}

/** Dark current (e-/s/pix) extrapolated from a vendor figure at temperature `fromC` to a representative
 *  in-camera operating temperature `toC` (default 60C, the reference condition data/sensors.json's own
 *  full-frame record uses for the same extrapolation), via the generic doubling-temperature relation
 *  data/sensors.json.generic.darkCurrent carries. Evidence: derived, same method the sensor-research pass
 *  already used once (data/sensors.json, full-frame record); applied here uniformly to all three picks for
 *  consistency rather than leaving two of them at a 0C/-20C cooled-astro-camera figure that understates
 *  in-camera dark current by two-plus orders of magnitude. This is a rough order-of-magnitude estimate, not a
 *  measurement — see docs/engine/e4.md, "Known limits."
 */
function extrapolateDarkCurrent(v0: number, fromC: number, toC: number = 60): number {
  const doublingC = sensorsData.generic.darkCurrent.doublingTemperatureC.v;
  return v0 * Math.pow(2, (toC - fromC) / doublingC);
}

function darkCurrentEPerS(rec: SensorsJson['sensors'][number]): number {
  const dc = rec.darkCurrent;
  if (dc.derivedAtTj60C) return dc.derivedAtTj60C.v; // already extrapolated to 60C by the sensor-research pass
  if (dc.relatedChipVendorIMX571_0C) return extrapolateDarkCurrent(dc.relatedChipVendorIMX571_0C.v, 0);
  if (dc.relatedChipVendorIMX294mono_neg20C) return extrapolateDarkCurrent(dc.relatedChipVendorIMX294mono_neg20C.v, -20);
  throw new Error('data.ts: darkCurrentEPerS: no recognized dark-current field on this sensor record');
}

function peakQE(rec: SensorsJson['sensors'][number]): number {
  const v = rec.qe.peakPercent?.v ?? rec.qe.relatedChipPeakPercentIMX571?.v ?? rec.qe.relatedChipPeakPercentIMX294color?.v;
  if (v === undefined) throw new Error('data.ts: peakQE: no recognized QE field on this sensor record');
  return v / 100;
}

function rawFileBits(rec: SensorsJson['sensors'][number]): number {
  return rec.rawFileBitDepth?.uncompressed?.v ?? rec.adcBitDepthBits?.om1RawFile?.v ?? 14;
}

// ---- the two real lineup bodies (Finding S1): D850 (DSLR) and Z8 (mirrorless) ------------------------------
//
// data/d850.json and data/z8.json are each a self-contained sensor + read-noise + body record (see either
// file's own `meta.scope`), not an entry in data/sensors.json/data/read-noise.json's shared tables — so they
// get their own small loader here rather than being shoehorned into `SensorsJson`/`ReadNoiseCameraJson`'s
// shapes, which don't match (e.g. their top-level `readNoise.fwcElectrons` is a plain number, not `{ v }`).

interface BodySensorJson {
  sensor: {
    id: string;
    cameraName: string;
    pixelPitchUm: { v: number };
    pixelCount: { effectiveH: { v: number }; effectiveV: { v: number } };
    microlensFillFactor: { v: number };
    qe: { dxomarkDerivedPeakPercent: { v: number } };
    adcBitDepthBits?: { rawUncompressed?: { v: number }; raw?: { v: number } };
  };
  readNoise: {
    fwcElectrons: number;
    unityGainIso: number;
    normalAnalogRangeIso: [number, number];
    dcgIso: { fromIso: number; toIso: number };
    points: ReadNoisePoint[];
  };
}

/** Nikon D850 (docs/PANE.md's DSLR body: s35, n50, n500, n500fl mount on Nikon F). */
export const D850_SENSOR_ID = 'full-frame-d850';
/** Nikon Z8 (docs/PANE.md's mirrorless body: z35, m50, z800 mount on Nikon Z). */
export const Z8_SENSOR_ID = 'full-frame-z8';

const BODY_SENSORS: Record<string, BodySensorJson> = {
  [D850_SENSOR_ID]: d850Json as unknown as BodySensorJson,
  [Z8_SENSOR_ID]: z8Json as unknown as BodySensorJson,
};

/** Neither data/d850.json nor data/z8.json publishes a dark-current figure (both files' own `meta` carry no
 *  `darkCurrent` field — every source checked for either camera stopped at read noise/full well/QE). Rather
 *  than leave the body sensors with no dark-current term at all (which would silently zero out Finding S3's
 *  fix for these two cameras), this borrows the representative full-frame BSI estimate data/sensors.json's
 *  own full-frame pick already carries (a same-class, same-generation-of-process sensor's own doubling-
 *  temperature extrapolation — see `extrapolateDarkCurrent`). Evidence: assumed; a same-format stand-in, not
 *  a D850/Z8-specific measurement or vendor figure.
 */
function assumedBodyDarkCurrentEPerS(): number {
  const rec = sensorsData.sensors.find((s) => s.id === 'full-frame-a7r4-imx455');
  if (!rec) throw new Error('data.ts: assumedBodyDarkCurrentEPerS: fallback full-frame record missing');
  return darkCurrentEPerS(rec);
}

function buildBodySensorBundle(body: BodySensorJson, format: FormatId, iso: number): SensorBundle {
  const { sensor: rec, readNoise: rn } = body;
  const rnE = interpolateReadNoise(rn.points, iso);
  const fullWellE = rn.fwcElectrons;
  const unityGainIso = rn.unityGainIso;
  const dcgSwitchIso = rn.dcgIso.toIso;
  const bits = rec.adcBitDepthBits?.rawUncompressed?.v ?? rec.adcBitDepthBits?.raw?.v ?? 14;
  const pitchUm = rec.pixelPitchUm.v;
  const qePeak = rec.qe.dxomarkDerivedPeakPercent.v / 100;
  const darkCurrentEPerSVal = assumedBodyDarkCurrentEPerS();

  const spec: SensorSpec = {
    pitchUm,
    fillFactor: rec.microlensFillFactor.v,
    qe: gaussianCameraSensitivities(qePeak),
    fullWellE,
    darkCurrentEPerS: darkCurrentEPerSVal,
    readNoise: { lcgE: rnE, hcgE: rnE },
    dcgSwitchIso: 0, // this ISO's own interpolated read noise is already baked into both modes above
    unityGainIso,
    bitDepth: bits,
    blackLevelDn: Math.round(512 * ((2 ** bits - 1) / (2 ** 14 - 1))), // same assumed convention as the other picks
    prnuStdDev: sensorsData.generic.prnu.typicalPercent.v / 100,
    baseIso: rn.normalAnalogRangeIso[0],
  };

  const srcFile = rec.id === D850_SENSOR_ID ? 'data/d850.json' : 'data/z8.json';
  const info: SensorInfo = {
    id: rec.id,
    name: rec.cameraName,
    format: FORMATS[format],
    pitchUm,
    widthPx: rec.pixelCount.effectiveH.v,
    heightPx: rec.pixelCount.effectiveV.v,
    fullWellE,
    readNoiseE: rnE,
    unityGainIso,
    bits,
    readoutS: 0.05, // placeholder scan time; same convention as the other picks (see below)
    figs: {
      pitchUm: { v: pitchUm, unit: 'um', ev: 'reported', src: srcFile, loc: 'sensor.pixelPitchUm' },
      fullWellE: { v: fullWellE, unit: 'e-', ev: 'reported', src: srcFile, loc: 'readNoise.fwcElectrons', calc: 'Claff RN_e.htm series fwc field' },
      readNoiseE: { v: rnE, unit: 'e- rms', ev: 'derived', src: srcFile, loc: 'readNoise.points', calc: `log-log interpolation of Claff's measured points at ISO ${iso}` },
      unityGainIso: { v: unityGainIso, unit: 'ISO', ev: 'reported', src: srcFile, loc: 'readNoise.unityGainIso' },
      dcgSwitchIso: { v: dcgSwitchIso, unit: 'ISO', ev: 'derived', src: srcFile, loc: 'readNoise.dcgIso', calc: 'steepest adjacent-point drop in log2(read noise) vs log2(ISO)' },
      qePeak: { v: qePeak, unit: 'fraction', ev: 'derived', src: `${srcFile} + data/color/camera-sensitivity-gaussian-model.json`, loc: 'sensor.qe.dxomarkDerivedPeakPercent', calc: 'sensor peak-QE spec scales the Gaussian sensitivity model (see gaussianCameraSensitivities)' },
      darkCurrentEPerS: { v: darkCurrentEPerSVal, unit: 'e-/s/pix', ev: 'assumed', src: 'data/sensors.json (full-frame-a7r4-imx455)', loc: 'no dark-current figure is published for either the D850 or Z8; borrows the same-format full-frame BSI stand-in already used elsewhere' },
      blackLevelDn: { v: spec.blackLevelDn, unit: 'DN', ev: 'assumed', src: 'src/engine/fixtures/e3-sensor.ts convention', loc: 'no cited black-level figure for this sensor' },
    },
  };

  return { spec, info };
}

export interface SensorBundle {
  spec: SensorSpec;
  info: SensorInfo;
}

const sensorCache = new Map<string, SensorBundle>();

/**
 * A SensorSpec + SensorInfo for one format at one ISO (see the section header above for why ISO is baked in).
 * `sensorId`/`iso` together key the cache: realistic scenarios re-request the same handful of (format, ISO)
 * pairs, so this avoids re-interpolating Claff's curve and rebuilding the QE closures on every call.
 */
export function sensorFor(format: FormatId, iso: number, sensorId?: string): SensorBundle {
  const pick = SENSOR_BY_FORMAT[format];
  const id = sensorId ?? pick.sensorId;
  const key = `${id}@${iso}`;
  const cached = sensorCache.get(key);
  if (cached) return cached;

  // Finding S1: the lineup lenses' two real bodies (D850, Z8) each carry their own complete sensor + read-
  // noise bundle, sourced from their own file rather than data/sensors.json's free-form-primes stand-in.
  const body = BODY_SENSORS[id];
  if (body) {
    const bundle = buildBodySensorBundle(body, format, iso);
    sensorCache.set(key, bundle);
    return bundle;
  }

  const rec = sensorsData.sensors.find((s) => s.id === id);
  if (!rec) throw new Error(`data.ts: sensorFor: no sensor record for format "${format}" (id "${id}")`);

  // Finding S1: look up read noise for the ACTUAL sensor id in play, not unconditionally the format's own
  // default camera — a caller (or normalizeScenario) can request a sensor id that differs from the format's
  // default `pick.sensorId` (e.g. the free-form primes explicitly requesting a non-default pick), and the
  // read-noise camera must follow that choice.
  const readNoiseKey = REVERSE_READNOISE_KEY[id] ?? pick.readNoiseKey;
  const readNoiseCam = readNoiseData.cameras[readNoiseKey];
  const rn = sensorReadNoiseAtIso(readNoiseKey, iso);
  const fullWellE = readNoiseCam.fwcElectrons.v;
  const unityGainIso = readNoiseCam.unityGainIso.v;
  const dcgSwitchIso = readNoiseCam.dcgIso.toIso;
  const bits = rawFileBits(rec);
  // No cited per-DCG-mode full-well figure exists for any of the three picks (data/sensors.json's own
  // openProblems); fullWellHcgE is left unset, so sensor.ts's fullWellAtIso falls back to fullWellE in both
  // modes (see docs/engine/e4.md, "Known limits" — this is a documented simplification, not an invented one).
  const readNoise: ReadNoiseSpec = { lcgE: rn, hcgE: rn };
  const pitchUm = rec.pixelPitchUm.v;
  const qePeak = peakQE(rec);
  const qeCurves = gaussianCameraSensitivities(qePeak);

  const spec: SensorSpec = {
    pitchUm,
    fillFactor: rec.microlensFillFactor.v,
    qe: qeCurves,
    fullWellE,
    darkCurrentEPerS: darkCurrentEPerS(rec),
    readNoise,
    dcgSwitchIso: 0, // see the section header: this ISO's own interpolated value is already in both modes
    unityGainIso,
    bitDepth: bits,
    // No cited black-level figure for these sensors; 512 DN at 14-bit (~3.1% of full code range) is the
    // commonly-cited representative raw black level this project's own E3 fixture (fixtures/e3-sensor.ts)
    // already uses, scaled proportionally to this sensor's own bit depth. Evidence: assumed.
    blackLevelDn: Math.round(512 * ((2 ** bits - 1) / (2 ** 14 - 1))),
    prnuStdDev: sensorsData.generic.prnu.typicalPercent.v / 100,
    baseIso: readNoiseCam.normalAnalogRangeIso.v[0],
  };

  const widthPx = rec.pixelCount.effectiveH?.v ?? Math.round((rec.activeArea.widthMm.v * 1000) / pitchUm);
  const heightPx = rec.pixelCount.effectiveV?.v ?? Math.round((rec.activeArea.heightMm.v * 1000) / pitchUm);

  const info: SensorInfo = {
    id: rec.id,
    name: rec.cameraName,
    format: FORMATS[format],
    pitchUm,
    widthPx,
    heightPx,
    fullWellE,
    readNoiseE: rn,
    unityGainIso,
    bits,
    readoutS: 0.05, // placeholder scan time; no per-format figure is wired here (out of E4's own path list)
    figs: {
      pitchUm: { v: pitchUm, unit: 'um', ev: 'reported', src: 'data/sensors.json', loc: `${rec.id}.pixelPitchUm` },
      fullWellE: { v: fullWellE, unit: 'e-', ev: 'reported', src: 'data/read-noise.json', loc: `${readNoiseKey}.fwcElectrons`, calc: 'Claff RN_e.htm series fwc field' },
      readNoiseE: { v: rn, unit: 'e- rms', ev: 'derived', src: 'data/read-noise.json', loc: `${readNoiseKey}.points`, calc: `log-log interpolation of Claff's measured points at ISO ${iso}` },
      unityGainIso: { v: unityGainIso, unit: 'ISO', ev: 'reported', src: 'data/read-noise.json', loc: `${readNoiseKey}.unityGainIso` },
      dcgSwitchIso: { v: dcgSwitchIso, unit: 'ISO', ev: 'derived', src: 'data/read-noise.json', loc: `${readNoiseKey}.dcgIso`, calc: 'steepest adjacent-point drop in log2(read noise) vs log2(ISO)' },
      qePeak: { v: qePeak, unit: 'fraction', ev: 'derived', src: 'data/sensors.json + data/color/camera-sensitivity-gaussian-model.json', loc: `${rec.id}.qe`, calc: 'sensor peak-QE spec scales the Gaussian sensitivity model (see gaussianCameraSensitivities)' },
      darkCurrentEPerS: { v: spec.darkCurrentEPerS, unit: 'e-/s/pix', ev: 'derived', src: 'data/sensors.json', loc: `${rec.id}.darkCurrent`, calc: 'doubling-temperature extrapolation to a representative 60C in-camera operating point' },
      blackLevelDn: { v: spec.blackLevelDn, unit: 'DN', ev: 'assumed', src: 'src/engine/fixtures/e3-sensor.ts convention', loc: 'no cited black-level figure for these sensors' },
    },
  };

  const bundle: SensorBundle = { spec, info };
  sensorCache.set(key, bundle);
  return bundle;
}

export function defaultSensorId(format: FormatId): string {
  return SENSOR_BY_FORMAT[format].sensorId;
}
