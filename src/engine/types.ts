// Shared engine types. Owned by the lead: workstreams import these and never edit this file. If a workstream needs a
// change here, it says so in its report and the lead makes it.
//
// Units, everywhere in the engine unless a name says otherwise:
//   lengths in mm, wavelengths in nm, time in s, angles in radians, scene distances in mm (the UI converts meters).
// Axis: the optical axis is z, light travels toward +z, x is horizontal and y vertical in the frame (y up).
// Distances "from the sensor" are what a camera's focus scale reads (the film-plane mark); closed-form optics takes
// distances from the front principal plane or the entrance pupil, and every function says which.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// ---- evidence ------------------------------------------------------------------------------------------------------
export type Ev = 'spec' | 'vendor' | 'reported' | 'derived' | 'assumed';

/** A number on screen, with where it comes from. `calc` names the engine calculation for derived figures. */
export interface Fig {
  v: number;
  unit: string;
  ev: Ev;
  src?: string;   // source key or URL
  loc?: string;   // location inside the source
  calc?: string;  // e.g. "hyperfocal = f^2 / (N c) + f"
}

// ---- spectrum ------------------------------------------------------------------------------------------------------
/** Wavelength binning for spectral work: bin i covers [edges[i], edges[i+1]] with center centers[i]. */
export interface Bins {
  centers: number[];
  edges: number[];
  weights: number[]; // bin widths or quadrature weights, nm
}

// ---- diffractive (Phase Fresnel / DOE) surfaces ---------------------------------------------------------------------
/**
 * A kinoform/DOE phase profile superimposed on a surface's ordinary (possibly flat) substrate, in the ENGINE's own
 * canonical form (lens-types.ts's `DoeSpec` is the patent-transcription shape data/lenses/*.json actually carries;
 * lens.ts's `normalizeDoe` converts one to the other). The engine implements exactly one physical grating equation
 * (docs/engine/doe.md has the full derivation and citations, and shows every convention seen in data/lenses/*.json
 * so far -- both Nikon Phase Fresnel patents this project transcribes -- normalizes onto it losslessly):
 *   phi(h) = (2*pi/lambda0) * (coeffs[0] h^2 + coeffs[1] h^4 + coeffs[2] h^6 + ...)
 * with h the radial height in mm, lambda0 the design wavelength (converted from lambda0Nm to mm), coeffs in
 * mm^-(2i-1) for the h^(2i) term (i=1,2,3,...; the same "mm, and the polynomial orders scale like an even
 * asphere" convention the rest of the engine uses for surface polynomials), and phi's ORDER-INDEPENDENT: the
 * diffraction order only enters through the grating equation's m*(lambda/2*pi) kick (surface.ts's `diffract`),
 * never through phi itself. This is a fixed, physical (wavelength-independent) grating structure; phi's own
 * wavelength lambda0 only sets which wavelength gets a whole number of 2*pi phase steps per zone at order 1.
 */
export interface Doe {
  /** Free text: which patent formula (and which of the same-shape but not identical conventions documented in
   *  docs/engine/doe.md) these coefficients were normalized FROM, for audit -- not read by any engine code, which
   *  only ever consumes the normalized `coeffs` below. */
  convention: string;
  lambda0Nm: number;   // design/reference wavelength the patent's phase formula is written at, nm
  order: number;       // diffraction order m the tracer uses (the ideal order; typically 1)
  coeffs: number[];    // [C2, C4, C6, ...], mm^-(2i-1), phi(h) = (2*pi/lambda0) * sum coeffs[i] * h^(2*(i+1))
  note?: string;       // patent citation / transcription notes
}

// ---- sequential ray tracing ----------------------------------------------------------------------------------------
/** One surface as the tracer sees it, in absolute coordinates for the current focus. */
export interface TraceSurface {
  z: number;            // vertex position on the axis, mm
  c: number;            // curvature 1/r, 0 for flat
  k: number;            // conic constant (0 = sphere), sag convention in lens-types.ts
  a: number[];          // even asphere coefficients [A4, A6, A8, A10, A12, A14, A16], may be shorter
  sd: number;           // clear semi-aperture, mm: rays hitting outside are vignetted here
  kind: 'refract' | 'stop' | 'image';
  mediumAfter: string;  // 'air' or a glass catalog key
  label?: string;
  coated?: boolean;
  doe?: Doe;             // an optional diffractive (Phase Fresnel) phase profile on this surface, see Doe above
}

/** An optical system ready to trace: the surfaces in order, ending with the image (sensor) plane. */
export interface TraceSystem {
  surfaces: TraceSurface[];
  /** Refractive index of a medium at a wavelength (air = 1, relative indices as in the maker catalogs). */
  index: (medium: string, nm: number) => number;
  /** Iris test at the stop surface, in the stop plane's x/y (mm). Absent means a circular stop of the stop's sd. */
  iris?: (x: number, y: number) => boolean;
}

export interface Ray {
  o: Vec3;   // origin, mm
  d: Vec3;   // unit direction
  nm: number;
}

export type RayStatus = 'ok' | 'vignetted' | 'iris' | 'tir' | 'missed';

/** The path of one ray, surface by surface: pts[0] is the origin, then one point per surface reached. */
export interface RayPath {
  nm: number;
  pts: Vec3[];
  status: RayStatus;
  blockedAt?: number;   // surface index where the ray died, when status is not 'ok'
  dirOut?: Vec3;        // direction after the last surface reached
}

/** Where a ray enters the system: paraxial entrance pupil, from the paraxial module. */
export interface Pupil {
  z: number;  // axial position, mm (same coordinates as TraceSurface.z)
  r: number;  // radius, mm
}

// ---- paraxial ------------------------------------------------------------------------------------------------------
export interface Cardinal {
  nm: number;
  efl: number;          // effective focal length, mm
  bfd: number;          // back focal distance: last refracting surface to the rear focal point, mm
  ffd: number;          // front focal distance: first surface to the front focal point (negative when in front), mm
  P: number;            // front principal plane z
  P2: number;           // rear principal plane z
  F: number;            // front focal point z
  F2: number;           // rear focal point z
  ep: Pupil;            // entrance pupil for the current stop radius
  xp: Pupil;            // exit pupil
  pupilMag: number;     // xp.r / ep.r
  fno: number;          // efl / (2 ep.r), the infinity f-number for the current stop radius
  petzvalRadius?: number;
}

// ---- formats -------------------------------------------------------------------------------------------------------
export type FormatId = 'ff' | 'apsc' | 'mft';

export interface Format {
  id: FormatId;
  name: string;
  w: number;            // mm
  h: number;            // mm
  diag: number;         // mm
  crop: number;         // full-frame diagonal / this diagonal
}

// ---- scenario (the reader's settings) ------------------------------------------------------------------------------
export interface Scenario {
  lens: string;                 // lens id, 'p20' ... 'p500'
  fno: number;                  // set f-number, >= the lens's maximum aperture
  shutter: number;              // exposure time, s
  iso: number;
  focusM: number | null;        // focus distance from the sensor plane, meters; null = infinity
  format: FormatId;
  sensor?: string;              // sensor id from data/sensors.json; defaults per format
  shutterType: 'mechanical' | 'electronic';
  scene: string;                // synthetic scene id
  lux?: number;                 // scene illuminance override
  cct?: number;                 // illuminant color temperature override, K
  /** The scene's moving subject (scenes.ts's own `movingBillboardIds`), shifting laterally (+x, image
   *  horizontal) at this speed during the exposure. Absent, or 0, means the scene is still. */
  motion?: { speedMps: number };
  /** Where the scene's subject stands, meters (scenes.ts's `sceneFor`): the subject, its perch and the foreground
   *  move out together, the far background stays. Absent = the scene's own layout (3 m bench, 30 m field). */
  subjectM?: number;
}

// ---- sensor --------------------------------------------------------------------------------------------------------
export type CfaColor = 'R' | 'G' | 'B';

/** One pixel's journey, as the loupe shows it. Means are model expectations; samples are one seeded draw. */
export interface PixelState {
  x: number; y: number;             // pixel column and row
  cfa: CfaColor;
  photonsMean: number;              // photons reaching the pixel's area during the exposure (all bins)
  photonsByBin?: number[];          // per wavelength bin
  electronsMean: number;            // after QE and fill factor, before clipping
  electrons: number;                // sampled, clipped at full well
  fullWell: number;
  readNoise: number;                // e- rms at this ISO
  dn: number;                       // raw digital number after gain, offset and quantization
  saturated: boolean;
}

// ---- deterministic randomness ----------------------------------------------------------------------------------------
export interface Rng {
  next(): number;                   // uniform [0, 1)
  normal(): number;                 // standard normal
  poisson(mean: number): number;
}
