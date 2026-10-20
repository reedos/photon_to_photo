// The camera model's contract: what compute(scenario) returns and the helper calls the views make. Owned by the
// lead; camera.ts (workstream E4) implements it, the app shell and the set pieces consume it. Units as in types.ts
// (mm, nm, s), except where a name says otherwise (Um = micrometers, Px = sensor pixels, M = meters).

import type { Cardinal, Ev, Fig, Format, PixelState, RayPath, Scenario, TraceSystem, Vec2 } from './types';
import type { RealizedLens } from './realize';

export interface LensInfo {
  id: string;
  name: string;
  focalLength: number;        // nominal class, mm
  efl: number;                // the design's own effective focal length, mm (d line)
  maxFno: number;             // the design's own maximum aperture (patent)
  markedFno: number;          // the class marking (f/1.4 for a design at F1.46)
  elements: number;
  groups: number;
  blades: number;
  rounded: boolean;
  closestFocusMm: number;     // from the sensor, the closest the design reaches
  representativeOf?: string;
  source: { ref: string; url: string; location: string; assignee?: string; published?: string };
  warnings: string[];
}

export interface SensorInfo {
  id: string;
  name: string;               // e.g. "Sony IMX455 (a7R IV)"
  format: Format;
  pitchUm: number;
  widthPx: number;
  heightPx: number;
  fullWellE: number;          // at this ISO's conversion-gain mode
  readNoiseE: number;         // at this ISO (Claff measurements, interpolated)
  unityGainIso: number;
  bits: number;
  /** Electrons at which the raw value clips at this ISO, (2^bits - 1 - black level) / gain (data.ts adcClipElectrons). */
  adcClipE: number;
  /** The body's native and expanded ISO range, when the sensor record cites one (D850, Z8: native 64-25,600). */
  isoRange?: { nativeMin: number; nativeMax: number; expandedMin: number; expandedMax: number };
  readoutS: number;           // electronic-shutter full-frame scan time
  /** The camera's measured saturation-based ISO as a multiple of its setting (D850 0.699, Z8 0.740), when a measurement is cited. */
  measuredIsoFactor?: number;
  figs: Record<string, Fig>;
}

export interface Model {
  scenario: Scenario;         // normalized: fno >= maxFno, focus clamped to the reachable range
  lens: LensInfo;
  realized: RealizedLens;     // the engine lens (surfaces, elements, groups, plates) for drawing
  system: TraceSystem;        // at the current focus; stop sd = the iris radius; iris = the blade polygon test
  cardinal: Cardinal;         // d line, current stop
  iris: {
    radius: number;           // mm, the opening at the stop plane for scenario.fno
    rotation: number;         // radians
    outline: Vec2[];          // the opening (stop-plane mm)
    blades: Vec2[][];         // each blade's outline, schematic
  };
  sensor: SensorInfo;
  focus: {
    distanceMm: number | null;  // from the sensor; null = infinity
    requestedMm: number | null;
    clamped: boolean;
    objectZ: number | null;     // the in-focus object plane's z in system coordinates
    workingFno: number;         // N (1 + |m| / pupilMag)
    magnification: number;
    hyperfocalMm: number;       // from the sensor: nearest focus that keeps infinity within the CoC (camera.ts exactHyperfocalMm, real exit pupil, d line)
    nearMm: number;             // DOF limits from the sensor
    farMm: number;              // Infinity allowed
    cocMm: number;              // the circle of confusion used (assumed rule, see figs.coc)
  };
  diffraction: { airyRadiusUm: number; airyRadiusPx: number; nm: number };
  /** The scene's moving subject's streak on the sensor (SHARED CONTRACT), from the REAL lens's own
   *  magnification at the scene's subject distance (scenes.ts's `sceneSubjectDistanceMm`, not necessarily
   *  the scenario's current focus distance): null when `scenario.motion` is absent or its speed is 0. */
  motion: { speedMps: number; blurMm: number; blurPx: number; ev: Ev } | null;
  exposure: {
    ev100: number;              // of the camera settings (N^2/t at ISO 100): the scene brightness they suit
    /** EV100 of the scene's 18% gray patch by the ISO 2720 meter equation (L = 18% of the scene lux / pi, K = 12.5):
     *  the settings meter that patch correctly when ev100 equals this. */
    sceneEv100: number;
    /** Share of the raw clip a green pixel holds for the 18% gray patch at the CURRENT settings (electronsMidGray /
     *  adcClipE), and at the exposure the meter would pick (the same scaled by 2^(ev100 - sceneEv100); ISO cancels). */
    grayRawFraction: number;
    grayRawFractionMetered: number;
    /** What ISO 12232 expects for a metered 18% gray: H = pi K T / (4 S) at the sensor against H_sat = 78 / S, so
     *  pi K T / (4 * 78) of saturation (T the assumed lens transmission), about 11%. The model sits below it
     *  (the effective-QE figure is the green peak, see data.ts gaussianCameraSensitivities). */
    isoExpectedRawFraction: number;
    sceneLux: number;
    sensorLux: number;          // on axis, image plane
    photonsMidGray: number;     // per pixel, all bins, 18% gray patch, on axis
    electronsMidGray: number;
    /** The analytic SNR of the 18% gray patch from its mean signal (sensor.ts snr(), no clip). It is only meaningful
     *  while `grayClipped` is false: once the patch passes the limit below, the recorded value is the clip, not the mean. */
    snrMidGray: number;
    /** Electrons the pixel can record at this ISO before the recorded value stops following the light: the lower of the
     *  full well and the ADC clip (at high ISO the ADC clips first, so a well can read 19% full while the raw value is
     *  already at its maximum). */
    usableE: number;
    /** Which of the two sets `usableE`. */
    limitedBy: 'well' | 'adc';
    /** The 18% gray patch's mean exceeds `usableE`: the recorded value is clipped, so SNR and fill figures taken from
     *  the unclipped mean do not describe it. */
    grayClipped: boolean;
    /** How much of the recorded signal each wavelength bin carries: the scene illuminant's photons (18% gray) times
     *  the Bayer-averaged sensitivity (R + 2G + B)/4, per BINS center, summing to 1. pointBundle weights the bokeh
     *  disk with it, so a bin the sensor barely records (392.5 nm, 742.5 nm) does not set the disk's size. */
    recordedByBin: { nm: number; w: number }[];
  };
  /** Every number the UI shows, keyed, each with its evidence label. */
  figs: Record<string, Fig>;
}

/** Ray fans for the lens cutaway: per field fraction, per wavelength, `rays` meridional rays across the pupil. */
export interface FanRequest { fields: number[]; nms: number[]; rays: number }
export interface FanSet {
  field: number; fieldDeg: number; paths: RayPath[];
  /** Where the fan's rays start, from the sensor (mm): the current focus distance, so the fan converges on the
   *  sensor the way the lens is focused; null when focus is at infinity (rays arrive parallel). Score loop r2. */
  sourceDistMm?: number | null;
}

/** One object point's bundle through the real lens onto the sensor: the cone of focus and the bokeh disk. */
export interface BundleRequest {
  pointDistMm: number; fieldFrac: number; rays: number; nms: number[];
  /** Also trace the same pupil grid at the d line (587.6 nm), the wavelength the paraxial prediction uses, and
   *  report its own measured chord as Bundle.dLineDiameterMm. Not added to `paths`/`landing` (the drawn disk). */
  dLine?: boolean;
}
export interface Bundle {
  paths: RayPath[];               // every traced ray (status per ray: vignetted rays show where they stop)
  landing: { x: number; y: number; nm: number }[]; // on the sensor plane, mm, rays that arrive
  centroid: Vec2;
  diameterMm: number;             // measured: the landing points' extent across (max chord) over EVERY requested wavelength, the drawn disk
  /** Max chord per requested wavelength (same landing points as diameterMm, split by nm). With a 16-bin spectrum the
   *  all-bin chord is usually set by one end of the spectrum (longitudinal color), not by the d line. */
  diameterByNm: { nm: number; diameterMm: number }[];
  /** Measured max chord at 587.6 nm only, when the request set `dLine` (same grid, same lens): the like-for-like
   *  comparison with predictedBlurMm. */
  dLineDiameterMm?: number;
  predictedBlurMm: number;        // paraxial, d line (587.6 nm) only: camera.ts exitPupilBlurDiameterMm (real exit pupil, cut at the sensor)
  /** The disk as the sensor records it: the diameter of the circle, about the weighted centroid, that holds 90% of the
   *  recorded energy of the arriving rays, each ray weighted by its wavelength's share (Model.exposure.recordedByBin,
   *  divided by the rays traced per wavelength). diameterMm stays the unweighted widest extent. */
  recordedDiameterMm: number;
  /** Each requested wavelength's recorded weight relative to the strongest one (max 1), for drawing. */
  recordedWeightByNm: { nm: number; w: number }[];
  cocMm: number;
  pitchMm: number;
}

/** The final image, rendered by the CPU reference renderer (render.ts), and every stage kept for the views. */
export interface RenderRequest { width: number; height: number; seed: number }
export interface RenderResult {
  width: number;
  height: number;
  pixelScale: number;             // how many real sensor pixels one rendered pixel stands for (per axis)
  rgba: Uint8ClampedArray;        // the finished photo, sRGB
  raw: Uint16Array;               // DN per rendered pixel, Bayer mosaic (RGGB)
  stages: Record<string, Float32Array>; // e.g. 'demosaic', 'wb', 'ccm', 'tone' (linear RGB, 3 per pixel)
  /** The model behind one rendered pixel: its photons, electrons and DN, and where it looks in the scene. */
  pixel(x: number, y: number): PixelState & { objectPoint: [number, number, number]; depthMm: number };
  meta: { seed: number; ms: number; notes: string[] };
}
