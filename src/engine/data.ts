// The one place engine data is imported. Every other engine module takes its data as plain-function/array
// arguments (glass.ts's GlassCatalog, sensor.ts's SensorSpec, color.ts's CMFs/ChannelSensitivities, scene.ts's
// Illuminant/Billboard) so it can be unit-tested with fixtures; this module is where `data/*.json` actually
// gets wired into those shapes for the real app and for camera.ts/render.ts (workstream E4). See docs/ENGINE.md
// and docs/engine/e4.md.
//
// Caching: `getRealizedLens` memoizes per lens id, because `realize()` runs a real-ray survey over the field
// and pupil (docs/engine/e4.md, "realize.ts") that costs on the order of 100 ms — paid once per lens id, not
// once per scenario.

import type { Bins, Fig } from './types';
import type { GlassEntry, LensDesign } from './lens-types';
import type { CfaColor } from './types';
import type { CMFs, ChannelSensitivities } from './color';
import type { SensorSpec, ReadNoiseSpec } from './sensor';
import type { LensInfo, SensorInfo } from './model-types';
import type { Format, FormatId } from './types';

import { makeCatalog, type GlassCatalog, FRAUNHOFER_D_NM } from './glass';
import { loadLens, cardinal, systemAt, type ResolvedLens } from './lens';
import { applyRealization, realize, type Realization, type RealizedLens } from './realize';
import { FORMATS } from './formats';
import { wavelengthColor, type WavelengthColor } from './spectrum';
import { daylightSpd, illuminantSpectralIrradiance } from './scene';
import { photonEnergy, ASSUMED_LENS_TRANSMISSION, METER_CONSTANT_K, ISO_12232_SAT_CONSTANT } from './exposure';

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
const primedRealizations = new Map<string, Realization>();

/**
 * Hands over realize()'s numbers for lens ids, computed ahead by the same code (the app's build does it; see
 * vite.config.ts, p2p-realizations), so the first compute() of each lens skips the real-ray survey. A realization
 * whose surface count does not match the lens is ignored. Nothing in the engine or its tests calls this.
 */
export function primeRealizations(table: Record<string, Realization>): void {
  for (const [id, r] of Object.entries(table)) if (!lensCache.has(id)) primedRealizations.set(id, r);
}

/**
 * loadLens -> realize for a lens id, cached: realize() runs a real-ray field/pupil survey that costs on the
 * order of 100 ms (see realize.ts), so this module pays it once per id rather than once per compute() call.
 */
function getLensBundle(id: string): LensBundle {
  const cached = lensCache.get(id);
  if (cached) return cached;
  const design = lensDesign(id);
  const resolved: ResolvedLens = loadLens(design, GLASS_CATALOG);
  const primed = primedRealizations.get(id);
  const realized = primed && primed.afShift && primed.sdRealized.length === resolved.raw.length ? applyRealization(resolved, primed) : realize(resolved);

  // LensInfo.efl/maxFno are the DESIGN's own values, at infinity focus and the design's own maximum stop —
  // independent of whatever scenario.fno the reader has picked, unlike Model.cardinal (which is the current
  // stop, current focus). Computed once here, at realize()'s own wide-open infinity-focus stop radius.
  // r4 (10/12/2026): the system comes from systemAt(lens, null) so each surface keeps its diffractive spec; the
  // helper that rebuilt the surfaces here dropped it, and n500 read 538.94 mm (traced 489.71), z800 859.05 (780.01).
  const infCardinal = cardinal(systemAt(realized, null), FRAUNHOFER_D_NM, realized.realization.stopRadius);

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

/** The site's one spectral display color (design/LOOK.md's spectral color rule), from the cited 1 nm CIE 1931
 *  table rather than spectrum.ts's analytic fit: look.ts colors every ray, dot and swatch with this. */
export function spectralColor(nm: number): WavelengthColor {
  return wavelengthColor(nm, CMF);
}

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
    qe: { dxomarkDerivedPeakPercent: { v: number; includesFillFactor?: boolean; definition?: { src: string; loc: string } } };
    adcBitDepthBits?: { rawUncompressed?: { v: number }; raw?: { v: number } };
    readout: { electronicFullFrameMs: { v: number; src: string; confidence: string } };
    /** The camera's measured (DxOMark, saturation-based) ISO as a multiple of the ISO setting (Claff's Measured ISO chart). */
    measuredIso?: { factor: { v: number; src: string; loc: string; factorEv: number } };
    /** A cited raw black level, when one exists (D850: Kasson's dark-frame measurement). 14-bit DN. */
    blackLevelDn?: { v: number; src: string; loc: string; validIsoBelow?: number };
    isoRange?: { nativeMin: number; nativeMax: number; expandedMin: number; expandedMax: number; src: string; loc: string };
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

/**
 * Each color channel's own peak quantum efficiency. `qePeak` (the sensor's figure) is the strongest channel's peak (green);
 * the red and blue filters peak lower (amplitudes 0.7337 and 0.984 of green's in the D700-fitted Gaussian model), so a
 * red pixel's photodiode card must not show the green figure (score loop r4, 10/12/2026: it showed 44% for red, about 32%).
 */
function channelPeakFigs(qe: ChannelSensitivities, qePeak: Fig): Record<'qePeakR' | 'qePeakG' | 'qePeakB', Fig> {
  const peak = (f: (nm: number) => number): number => { let m = 0; for (let nm = 380; nm <= 780; nm++) m = Math.max(m, f(nm)); return m; };
  const mk = (ch: 'R' | 'G' | 'B'): Fig => ({
    v: peak(qe[ch]), unit: 'fraction', ev: 'derived', src: qePeak.src, loc: qePeak.loc,
    calc: `${qePeak.calc ? qePeak.calc + '; ' : ''}the ${ch} channel's Gaussian peak: the sensor figure times the ${ch} amplitude over the strongest channel's, from data/color/camera-sensitivity-gaussian-model.json`,
  });
  return { qePeakR: mk('R'), qePeakG: mk('G'), qePeakB: mk('B') };
}

/** The reference light for the ISO calibration: 5500 K daylight (the bench scene's own illuminant, BENCH_CCT_K in scenes.ts). */
const CALIBRATION_CCT_K = 5500;

/**
 * Score loop r6 (10/14/2026): the green raw level, as a share of the ADC clip, that a metered 18% gray (or any metered exposure
 * of a daylight scene) reaches with this sensor's QE curves. The sensor-plane exposure the meter picks is H = pi K T / (4 S)
 * lux s (ISO 2720; T the assumed lens transmission); its spectrum is 5500 K daylight, normalized to that illuminance. Photons
 * per bin x the green sensitivity x the fill factor is the electron count; the ISO setting cancels, since the clip (adcClipE)
 * and the exposure both scale as 1 / ISO. Same arithmetic as camera.ts's grayRawFractionMetered, without a scenario.
 */
export function meteredGreenRawFraction(spec: SensorSpec, iso: number): number {
  const spectrum = tableSpectrum(DAYLIGHT_LAMBDAS, daylightSpd(CALIBRATION_CCT_K, DAYLIGHT_S0, DAYLIGHT_S1, DAYLIGHT_S2));
  const perLux = illuminantSpectralIrradiance(spectrum, 1, BINS, V_LAMBDA); // W / m^2 / nm for 1 lux
  const exposureLuxS = (Math.PI * METER_CONSTANT_K * ASSUMED_LENS_TRANSMISSION) / (4 * iso);
  const pixelAreaM2 = (spec.pitchUm * 1e-6) ** 2;
  let electrons = 0;
  for (let i = 0; i < BINS.centers.length; i++) {
    const nm = BINS.centers[i];
    electrons += (perLux(nm) * exposureLuxS * pixelAreaM2 * BINS.weights[i] / photonEnergy(nm)) * spec.qe.G(nm);
  }
  return (spec.fillFactor * electrons) / adcClipElectrons(spec, iso);
}

/**
 * The green sensitivity peak that puts a metered 18% gray where ISO 12232's saturation-based speed puts it at the camera's
 * MEASURED ISO: the nominal expectation (pi K T / (4 x 78), 11.3% of the raw clip) times the measured-to-nominal ISO factor.
 * The peak starts from `startPeak` (Claff's effective QE); the engine's own metered gray fraction there, and the target, fix the scale. The
 * sensitivity amplitudes scale together (red, green and blue keep their ratios), so the gray fraction scales linearly.
 */
export function calibratedGreenPeak(startPeak: number, spec: SensorSpec, iso: number, measuredIsoFactor: number): number {
  const target = measuredIsoFactor * (Math.PI * METER_CONSTANT_K * ASSUMED_LENS_TRANSMISSION) / (4 * ISO_12232_SAT_CONSTANT);
  return startPeak * target / meteredGreenRawFraction(spec, iso);
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
  // Score loop r2 (10/11/2026): Claff's DxOMark-derived QE is "something more like the product of QE and fill
  // factor" (his DxOMark Gain Analysis page, recorded in qe.dxomarkDerivedPeakPercent.definition), so the assumed
  // microlens fill factor is not applied on top of it again.
  const qeDef = rec.qe.dxomarkDerivedPeakPercent;
  const fillInQe = qeDef.includesFillFactor === true;
  const darkCurrentEPerSVal = assumedBodyDarkCurrentEPerS();
  // Score-loop r1 (10/11/2026): the D850 carries a reported black level (Kasson, 400 DN at base ISO). It is labeled
  // reported only below the ISO where Kasson saw it move lower (by an amount he does not give). The Z8 has no cited
  // figure, so it keeps the project's assumed 512 DN at 14 bits, scaled to the bit depth.
  const cited = rec.blackLevelDn;
  const blackDn = cited ? Math.round(cited.v * ((2 ** bits - 1) / (2 ** 14 - 1))) : Math.round(512 * ((2 ** bits - 1) / (2 ** 14 - 1)));
  const blackCitedHere = !!cited && (cited.validIsoBelow === undefined || iso < cited.validIsoBelow);

  const claffPeak = qePeak;
  const spec: SensorSpec = {
    pitchUm,
    fillFactor: fillInQe ? 1 : rec.microlensFillFactor.v,
    qe: gaussianCameraSensitivities(claffPeak),
    fullWellE,
    darkCurrentEPerS: darkCurrentEPerSVal,
    readNoise: { lcgE: rnE, hcgE: rnE },
    dcgSwitchIso: 0, // this ISO's own interpolated read noise is already baked into both modes above
    unityGainIso,
    bitDepth: bits,
    blackLevelDn: blackDn,
    prnuStdDev: sensorsData.generic.prnu.typicalPercent.v / 100,
    baseIso: rn.normalAnalogRangeIso[0],
  };

  // Score loop r6: with a measured saturation-based ISO on file, the sensitivity amplitudes are scaled to it; without one the
  // effective-QE reading of Claff's figure stands (the earlier rounds' behavior, 0.8 EV under the label).
  const measured = rec.measuredIso?.factor;
  const calibratedPeak = measured ? calibratedGreenPeak(claffPeak, spec, iso, measured.v) : claffPeak;
  if (measured) spec.qe = gaussianCameraSensitivities(calibratedPeak);

  const srcFile = rec.id === D850_SENSOR_ID ? 'data/d850.json' : 'data/z8.json';
  const info: SensorInfo = {
    id: rec.id,
    name: rec.cameraName,
    format: FORMATS[format],
    pitchUm,
    // Smaller formats are centered crops of this body, retaining its real pixel pitch and noise model.
    widthPx: Math.min(rec.pixelCount.effectiveH.v, 2 * Math.floor(FORMATS[format].w * 1000 / pitchUm / 2)),
    heightPx: Math.min(rec.pixelCount.effectiveV.v, 2 * Math.floor(FORMATS[format].h * 1000 / pitchUm / 2)),
    fullWellE,
    readNoiseE: rnE,
    unityGainIso,
    bits,
    adcClipE: adcClipElectrons(spec, iso),
    ...(rec.isoRange ? { isoRange: { nativeMin: rec.isoRange.nativeMin, nativeMax: rec.isoRange.nativeMax, expandedMin: rec.isoRange.expandedMin, expandedMax: rec.isoRange.expandedMax } } : {}),
    readoutS: rec.readout.electronicFullFrameMs.v / 1000,
    ...(measured ? { measuredIsoFactor: measured.v } : {}),
    figs: {
      ...(rec.isoRange ? { isoNativeMax: { v: rec.isoRange.nativeMax, unit: 'ISO', ev: 'reported' as const, src: rec.isoRange.src, loc: `${srcFile} sensor.isoRange: ${rec.isoRange.loc}` } } : {}),
      adcClipE: { v: adcClipElectrons(spec, iso), unit: 'e-', ev: 'derived', src: srcFile, calc: `(2^${bits} - 1 - ${spec.blackLevelDn} DN black level) / gain, gain = ISO ${iso} / unity-gain ISO ${unityGainIso} DN per electron: the electron count at which the raw value clips at this ISO` },
      readoutS: { v: rec.readout.electronicFullFrameMs.v / 1000, unit: 's', ev: 'reported', src: rec.readout.electronicFullFrameMs.src, loc: `sensor.readout.electronicFullFrameMs; ${/^low/i.test(rec.readout.electronicFullFrameMs.confidence ?? '') ? 'secondary sources only, low confidence (not read from a primary table). ' : /^secondary/i.test(rec.readout.electronicFullFrameMs.confidence ?? '') ? 'secondary source only (a third-party measured list, not Nikon or a primary table). ' : ''}${rec.readout.electronicFullFrameMs.confidence}` },
      pitchUm: { v: pitchUm, unit: 'um', ev: 'reported', src: srcFile, loc: 'sensor.pixelPitchUm' },
      fullWellE: { v: fullWellE, unit: 'e-', ev: 'reported', src: srcFile, loc: 'readNoise.fwcElectrons', calc: 'Claff RN_e.htm series fwc field' },
      readNoiseE: { v: rnE, unit: 'e- rms', ev: 'derived', src: srcFile, loc: 'readNoise.points', calc: `log-log interpolation of Claff's measured points at ISO ${iso}` },
      unityGainIso: { v: unityGainIso, unit: 'ISO', ev: 'reported', src: srcFile, loc: 'readNoise.unityGainIso' },
      dcgSwitchIso: { v: dcgSwitchIso, unit: 'ISO', ev: 'derived', src: srcFile, loc: 'readNoise.dcgIso', calc: 'steepest adjacent-point drop in log2(read noise) vs log2(ISO)' },
      qePeak: measured
        ? { v: calibratedPeak, unit: 'fraction', ev: 'derived', src: `${srcFile} + data/color/camera-sensitivity-gaussian-model.json`, loc: `sensor.measuredIso.factor (${measured.v}, ${measured.factorEv} EV); sensor.qe.dxomarkDerivedPeakPercent (${Math.round(claffPeak * 100)}%)`, calc: `calibrated to the measured ISO: the Gaussian sensitivity model's amplitudes are scaled so a metered 18% gray in 5500 K daylight lands at ${(100 * measured.v * Math.PI * METER_CONSTANT_K * ASSUMED_LENS_TRANSMISSION / (4 * ISO_12232_SAT_CONSTANT)).toFixed(1)}% of the raw clip, ISO 12232's saturation-based expectation (pi K T / (4 x 78) = 11.3%) times this camera's measured-to-nominal ISO factor ${measured.v}; Claff's DxOMark-derived ${Math.round(claffPeak * 100)}% effective QE (QE x fill factor) is the starting scale and a cross-check, and the calibrated green peak is ${calibratedPeak.toFixed(2)} (a derived effective figure, not a published peak QE)` }
        : { v: qePeak, unit: 'fraction', ev: 'derived', src: `${srcFile} + data/color/camera-sensitivity-gaussian-model.json`, loc: 'sensor.qe.dxomarkDerivedPeakPercent', calc: fillInQe ? "Claff's effective QE (QE x fill factor, DxOMark-derived) scales the Gaussian sensitivity model as the green peak (see gaussianCameraSensitivities); the peak reading is this project's interpretation" : 'sensor peak-QE spec scales the Gaussian sensitivity model (see gaussianCameraSensitivities)' },
      fillFactor: fillInQe
        ? { v: 1, unit: 'fraction', ev: 'reported', src: qeDef.definition?.src ?? srcFile, loc: `${srcFile} sensor.qe.dxomarkDerivedPeakPercent.definition: already inside the effective QE (${qeDef.definition?.loc ?? 'Claff'}); not applied again` }
        : { v: rec.microlensFillFactor.v, unit: 'fraction', ev: 'assumed', src: srcFile, loc: 'sensor.microlensFillFactor: no camera-specific figure published; BSI fill factor "approaches 100%"' },
      darkCurrentEPerS: { v: darkCurrentEPerSVal, unit: 'e-/s/pix', ev: 'assumed', src: 'data/sensors.json (full-frame-a7r4-imx455)', loc: 'no dark-current figure is published for either the D850 or Z8; borrows the same-format full-frame BSI stand-in already used elsewhere' },
      blackLevelDn: cited
        ? (blackCitedHere
          ? { v: spec.blackLevelDn, unit: 'DN', ev: 'reported', src: cited.src, loc: `${srcFile} sensor.blackLevelDn: ${cited.loc}` }
          : { v: spec.blackLevelDn, unit: 'DN', ev: 'assumed', src: cited.src, loc: `${srcFile} sensor.blackLevelDn: measured ${cited.v} DN below ISO ${cited.validIsoBelow}; at this ISO the source reports a lower, unstated value, so ${cited.v} DN is kept as an assumption` })
        : { v: spec.blackLevelDn, unit: 'DN', ev: 'assumed', src: 'src/engine/fixtures/e3-sensor.ts convention', loc: 'no cited black-level figure for this sensor (searched 10/11/2026)' },
    },
  };

  info.figs = { ...info.figs, ...channelPeakFigs(spec.qe, info.figs.qePeak) };
  return { spec, info };
}

/** Electrons at which the raw value reaches the ADC's top code at this ISO: (2^bits - 1 - black level) / gain, with
 *  gain = ISO / unityGainIso DN per electron (sensor.ts analogGain). Below the full well at every ISO for the D850
 *  and Z8, including base ISO 64 (about 1.6% below the D850's 59,126 e-), so the raw value clips before the well
 *  fills. */
export function adcClipElectrons(spec: SensorSpec, iso: number): number {
  return ((2 ** spec.bitDepth - 1 - spec.blackLevelDn) * spec.unityGainIso) / iso;
}

export interface SensorBundle {
  spec: SensorSpec;
  info: SensorInfo;
}

const sensorCache = new Map<string, SensorBundle>();
// ISO accepts continuous values (including physical-dial drags). Keep a bounded
// recent history rather than retaining QE closures for every ISO ever visited.
const SENSOR_CACHE_LIMIT = 128;
function cacheSensor(key: string, bundle: SensorBundle): SensorBundle {
  sensorCache.set(key, bundle);
  if (sensorCache.size > SENSOR_CACHE_LIMIT) sensorCache.delete(sensorCache.keys().next().value!);
  return bundle;
}

/**
 * A SensorSpec + SensorInfo for one format at one ISO (see the section header above for why ISO is baked in).
 * Format, sensor ID and ISO key the cache: realistic scenarios re-request the same handful of combinations
 * so this avoids re-interpolating Claff's curve and rebuilding the QE closures on every call.
 */
export function sensorFor(format: FormatId, iso: number, sensorId?: string): SensorBundle {
  const pick = SENSOR_BY_FORMAT[format];
  const id = sensorId ?? pick.sensorId;
  const key = `${format}:${id}@${iso}`;
  const cached = sensorCache.get(key);
  if (cached) {
    sensorCache.delete(key);
    sensorCache.set(key, cached);
    return cached;
  }

  // Finding S1: the lineup lenses' two real bodies (D850, Z8) each carry their own complete sensor + read-
  // noise bundle, sourced from their own file rather than data/sensors.json's free-form-primes stand-in.
  const body = BODY_SENSORS[id];
  if (body) {
    const bundle = buildBodySensorBundle(body, format, iso);
    return cacheSensor(key, bundle);
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
    adcClipE: adcClipElectrons(spec, iso),
    readoutS: 0.05, // placeholder scan time; no per-format figure is wired here (out of E4's own path list)
    figs: {
      readoutS: { v: 0.05, unit: 's', ev: 'assumed', loc: 'Illustrative 50 ms scan; no camera-specific value is wired for this sensor.' },
      pitchUm: { v: pitchUm, unit: 'um', ev: 'reported', src: 'data/sensors.json', loc: `${rec.id}.pixelPitchUm` },
      fullWellE: { v: fullWellE, unit: 'e-', ev: 'reported', src: 'data/read-noise.json', loc: `${readNoiseKey}.fwcElectrons`, calc: 'Claff RN_e.htm series fwc field' },
      readNoiseE: { v: rn, unit: 'e- rms', ev: 'derived', src: 'data/read-noise.json', loc: `${readNoiseKey}.points`, calc: `log-log interpolation of Claff's measured points at ISO ${iso}` },
      unityGainIso: { v: unityGainIso, unit: 'ISO', ev: 'reported', src: 'data/read-noise.json', loc: `${readNoiseKey}.unityGainIso` },
      dcgSwitchIso: { v: dcgSwitchIso, unit: 'ISO', ev: 'derived', src: 'data/read-noise.json', loc: `${readNoiseKey}.dcgIso`, calc: 'steepest adjacent-point drop in log2(read noise) vs log2(ISO)' },
      qePeak: { v: qePeak, unit: 'fraction', ev: 'derived', src: 'data/sensors.json + data/color/camera-sensitivity-gaussian-model.json', loc: `${rec.id}.qe`, calc: 'sensor peak-QE spec scales the Gaussian sensitivity model (see gaussianCameraSensitivities)' },
      fillFactor: { v: rec.microlensFillFactor.v, unit: 'fraction', ev: 'assumed', src: 'data/sensors.json', loc: `${rec.id}.microlensFillFactor: no sensor-specific figure published` },
      darkCurrentEPerS: { v: spec.darkCurrentEPerS, unit: 'e-/s/pix', ev: 'derived', src: 'data/sensors.json', loc: `${rec.id}.darkCurrent`, calc: 'doubling-temperature extrapolation to a representative 60C in-camera operating point' },
      blackLevelDn: { v: spec.blackLevelDn, unit: 'DN', ev: 'assumed', src: 'src/engine/fixtures/e3-sensor.ts convention', loc: 'no cited black-level figure for these sensors' },
    },
  };

  info.figs = { ...info.figs, ...channelPeakFigs(spec.qe, info.figs.qePeak) };
  const bundle: SensorBundle = { spec, info };
  return cacheSensor(key, bundle);
}

export function defaultSensorId(format: FormatId): string {
  return SENSOR_BY_FORMAT[format].sensorId;
}
