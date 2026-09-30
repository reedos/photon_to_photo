// Lens prescription format shared by data/lenses/*.json, the research notes and the engine.
// Conventions (standard sequential lens data, light travels +z from the object on the left):
// - r: radius of curvature in mm; positive when the center of curvature lies to the right (+z) of the vertex;
//   use null for a flat surface (JSON has no Infinity).
// - t: axial distance from this surface's vertex to the next one's, in mm. The last surface's t is the back focal
//   distance at infinity focus (patent "BF" / "Bf"), unless a cover glass or filter follows (then list them as surfaces).
// - medium: what fills the space AFTER this surface: "air"; a glass key into data/glass/catalog.json when the patent
//   names the glass (e.g. "OHARA:S-FPL51"); or "glass" when only nd/vd are given, in which case the engine resolves
//   the nearest catalog glass by nd/vd and reports the match distance.
// - nd/vd: the patent's own values for that medium (required whenever medium is not "air"), kept for audit even after
//   a catalog glass is matched.
// - sd: clear semi-aperture (half the clear diameter) in mm. Patents rarely list it; when estimated, set sdSource.
// - Scaled designs: `scale` multiplies every r, t and sd from the patent example (e.g. a patent normalized to f=100).
//   Store the patent's raw numbers and let the engine apply the scale, so the data can be checked against the text.

import type { Doe } from './types';

export type EvidenceKind = 'spec' | 'vendor' | 'reported' | 'derived' | 'assumed';

export interface Asphere {
  // Sag z(h) = c h^2 / (1 + sqrt(1 - (1 + k) c^2 h^2)) + A4 h^4 + A6 h^6 + ...  with c = 1/r.
  // Patents differ: some print kappa where kappa = 1 means a sphere (kappa = 1 + k), some print "K". Record the
  // patent's convention in `convention` and store k in the form above (k = 0 is a sphere).
  k: number;
  A4?: number; A6?: number; A8?: number; A10?: number; A12?: number; A14?: number; A16?: number;
  convention: string; // e.g. "patent prints K with K=0 sphere" or "patent prints kappa, k = kappa - 1"
}

export interface Surface {
  r: number | null;
  t: number;
  medium: string;           // "air" or a glass catalog key
  nd?: number;
  vd?: number;
  sd: number;
  sdSource?: 'patent' | 'estimated-from-marginal-ray' | 'estimated-from-drawing';
  stop?: true;              // aperture stop (the iris)
  asph?: Asphere;
  label?: string;           // e.g. "L1 front", "L1 rear", "STO", "cover glass"
  coated?: boolean;         // air-glass surfaces default to coated; a cemented face is never coated
  /** Set on a plate's FRONT surface when the medium after it is a plane-parallel plate that is not a lens element
   *  (a filter, the sensor cover glass, a drop-in filter). Plates are traced like any glass but are not counted in
   *  `elements`/`groups`, and the renderer draws them as flat plates. */
  plate?: 'filter' | 'cover-glass' | 'drop-in-filter';
  /** Set on a layer's FRONT surface when the medium after it is a thin molded resin layer bonded to the element that
   *  follows (a hybrid asphere). Traced like any medium; counted as part of that element, as makers count it. */
  layer?: 'resin';
  /** A diffractive (Phase Fresnel / DOE) phase profile superimposed on this surface, recording the patent's phase
   *  formula (see `DoeSpec` below for the transcription shape, normalized by lens.ts's `normalizeDoe` into
   *  types.ts's `Doe`, the engine's canonical form; loadLens then scales it like an even asphere's -- see lens.ts's
   *  `scaleDoe`). See docs/engine/doe.md for the convention(s) and the derivation. */
  doe?: DoeSpec;
}

/**
 * A diffractive (Phase Fresnel / DOE) phase profile exactly as a patent transcription records it: `coeffs` keyed
 * by the patent's own coefficient names ("C2", "C4", "C6", ... for the h^2, h^4, h^6, ... terms), and `convention`
 * as free text (the patent's phase-difference-function formula, verbatim, plus enough of its own paraxial-power
 * formula to cross-check the sign and units -- see data/lenses/n500.json's and m500.json's own `doe.convention`
 * fields for the worked examples this project has transcribed so far). lens.ts's `normalizeDoe` turns this into
 * the engine's canonical, order-independent `Doe.coeffs` array (docs/engine/doe.md derives why that normalization
 * is lossless for every convention seen so far, including one with an extra 1/order factor baked into the
 * patent's own phase function that cancels against its own power formula).
 */
export interface DoeSpec {
  convention: string;
  lambda0Nm: number;
  order: number;
  coeffs: Record<string, number>; // e.g. { C2: -4.25304e-05, C4: 3.0e-10 }
  note?: string;
}

export interface VariableGap {
  surface: number;          // index into surfaces whose t changes with focus
  atInfinity: number;       // mm, raw (before scale)
  atClose: number;          // mm, raw, at the patent's close-focus condition
  closeObjectDistance: number; // mm from the first surface (or as the patent defines it; say so in note)
  note?: string;
}

export interface PatentStated {
  // What the patent text itself states for this example, raw (before scale). The engine's paraxial trace must
  // reproduce f and BF from the surfaces; tests fail when it does not.
  f: number;
  fno: number;
  halfFieldDeg?: number;    // omega
  imageHeight?: number;     // Y, mm
  bf?: number;
  totalLength?: number;
}

export interface LensDesign {
  id: string;               // "p20", "p24", ... "p500"
  focalLength: number;      // nominal marketed class, mm (20 ... 500)
  maxFno: number;           // the design's own maximum aperture (from the patent): the physics uses this
  markedFno?: number;       // the maximum aperture the product name or class marks (f/1.4 for a design at F1.46)
  name: string;             // plain label, e.g. "50 mm f/1.4 double-Gauss (patent example)"
  representativeOf?: string;// commercial lens a public source ties it to, only when a source says so
  representativeSource?: string;
  source: {
    kind: 'patent' | 'textbook' | 'representative';
    ref: string;            // "US 9,123,456 B2, Example 1" or similar
    url: string;
    assignee?: string;
    published?: string;     // M/D/Y
    accessed: string;       // M/D/Y
    location: string;       // "Table 1, col. 12" / "Numerical Example 1"
  };
  scale: number;            // 1 when the example is already at its real focal length
  surfaces: Surface[];
  stated: PatentStated;
  focus: {
    method: 'unit' | 'front-group' | 'inner' | 'rear' | 'floating';
    gaps?: VariableGap[];
    minFocusM: number;      // closest focus of the design or its representative lens, meters from the sensor
    minFocusSource: string;
    /** Set when the patent tabulates the gaps only down to a farther condition than the product focuses: closer
     *  requests continue the same gap motion linearly (t > 1) down to minFocusM. An assumption, stated in `note`. */
    extrapolate?: { note: string; ev: 'assumed' };
  };
  iris: { blades: number; rounded: boolean; source: string; ev: EvidenceKind };
  elements: number;
  groups: number;
  imageCircleMm: number;    // 43.27 for full frame
  notes?: string[];         // transcription notes, known issues, glass-match notes
}

export interface GlassEntry {
  key: string;              // "SCHOTT:N-BK7", "OHARA:S-LAH55V", ...
  catalog: string;
  name: string;
  nd: number;
  vd: number;
  formula: 'sellmeier3' | 'schott' | 'other';
  coef: number[];           // sellmeier3: [B1, C1, B2, C2, B3, C3] with C in um^2, lambda in um
  range: [number, number];  // valid wavelengths, um
  source: string;           // where the coefficients come from, e.g. refractiveindex.info database file + upstream catalog
  accessed: string;
}
