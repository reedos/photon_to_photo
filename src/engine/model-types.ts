// The camera model's contract: what compute(scenario) returns and the helper calls the views make. Owned by the
// lead; camera.ts (workstream E4) implements it, the app shell and the set pieces consume it. Units as in types.ts
// (mm, nm, s), except where a name says otherwise (Um = micrometers, Px = sensor pixels, M = meters).

import type { Cardinal, Fig, Format, PixelState, RayPath, Scenario, TraceSystem, Vec2 } from './types';
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
  readoutS: number;           // electronic-shutter full-frame scan time
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
    hyperfocalMm: number;
    nearMm: number;             // DOF limits from the sensor
    farMm: number;              // Infinity allowed
    cocMm: number;              // the circle of confusion used (assumed rule, see figs.coc)
  };
  diffraction: { airyRadiusUm: number; airyRadiusPx: number; nm: number };
  exposure: {
    ev100: number;
    sceneLux: number;
    sensorLux: number;          // on axis, image plane
    photonsMidGray: number;     // per pixel, all bins, 18% gray patch, on axis
    electronsMidGray: number;
    snrMidGray: number;
  };
  /** Every number the UI shows, keyed, each with its evidence label. */
  figs: Record<string, Fig>;
}

/** Ray fans for the lens cutaway: per field fraction, per wavelength, `rays` meridional rays across the pupil. */
export interface FanRequest { fields: number[]; nms: number[]; rays: number }
export interface FanSet { field: number; fieldDeg: number; paths: RayPath[] }

/** One object point's bundle through the real lens onto the sensor: the cone of focus and the bokeh disk. */
export interface BundleRequest { pointDistMm: number; fieldFrac: number; rays: number; nms: number[] }
export interface Bundle {
  paths: RayPath[];               // every traced ray (status per ray: vignetted rays show where they stop)
  landing: { x: number; y: number; nm: number }[]; // on the sensor plane, mm, rays that arrive
  centroid: Vec2;
  diameterMm: number;             // measured: the landing points' extent across (max chord), the drawn disk
  predictedBlurMm: number;        // closed form (dof.ts blurDiameter, pupil-corrected)
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
