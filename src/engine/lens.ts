// Turns a LensDesign (patent transcription) into a traceable, focusable lens: loadLens() resolves scale and
// glass, and lists elements/cemented groups; systemAt() produces a TraceSystem with the image plane at the fixed
// sensor position for a given focus distance (or infinity).
//
// Data injection stays explicit here too: loadLens takes the GlassCatalog as an argument (built by
// glass.makeCatalog from entries the caller supplies) rather than importing data/glass/catalog.json itself.
// ENGINE.md's module list shows loadLens(design) without a catalog parameter; this file adds one
// (`loadLens(design, catalog)`) because the task brief's data-injection rule requires it — flagged in the E1b
// report for the lead, since it is a difference from ENGINE.md's literal signature.

import type { Asphere, DoeSpec, GlassEntry, LensDesign, Surface, VariableGap } from './lens-types';
import type { Doe, TraceSurface, TraceSystem } from './types';
import { type GlassCatalog, FRAUNHOFER_D_NM, indexAt, resolveGlass } from './glass';
import { cardinal, imageOf } from './paraxial';

// How far a "glass" (nearest-match) resolution may sit from every catalog entry before loadLens refuses to use
// it. Deliberately much looser than the 0.002 / 0.5 accuracy lenses.test.ts asks of a real catalog match — this
// threshold only guards against nonsense (an empty catalog, or a patent glass with no real neighbor), so a
// genuine "fail loudly" rather than a silent bad match. Assumed, not derived from a source.
const FAIL_LOUD_MAX_DND = 0.05;
const FAIL_LOUD_MAX_DVD = 5;

export interface GlassResolution {
  surfaceIndex: number; // index into design.surfaces
  requested: string; // 'glass' or the explicit catalog key the design asked for
  resolvedKey: string; // the key the tracer uses: a catalog key, or a MODEL: key (see modelGlass below)
  matched: boolean; // true when requested === 'glass' (nearest-match was used)
  kind: 'catalog' | 'model';
  baseKey: string; // the nearest catalog glass (the model glass takes its dispersion shape from it)
  nd: number; vd: number; // the design's own stated values
  dnd: number; dvd: number; // stated minus the nearest catalog entry's values
}

// A patent's nd/vd pair matches a catalog glass "exactly" when both agree to the precision patents print (nd to 5
// decimals, vd to 2): then the named catalog glass is used as is. Otherwise the lens gets a MODEL glass, the usual
// lens-design-software treatment of a glass known only by nd and vd: the nearest catalog glass's dispersion curve,
// shifted and scaled so it reproduces the stated nd and vd exactly,
//   n(lambda) = nd + (n_base(lambda) - nd_base) * (nd - 1)/vd / ((nd_base - 1)/vd_base),
// so n(d) = nd and nF - nC = (nd - 1)/vd by construction, and the partial dispersion follows the base glass
// (similar nd and vd, so the same glass family). Evidence: derived (lead, 09/28/2026).
const EXACT_DND = 5e-5;
const EXACT_DVD = 0.05;

export interface Element {
  index: number; // 1-based, front to back
  surfaces: [number, number]; // bounding surface indices into ResolvedLens.surfaces (entry, exit)
  groupId: number | null;
}

export interface CementedGroup {
  id: number; // 0-based
  elements: number[]; // element indices (into ResolvedLens.elements), front to back
  surfaces: [number, number]; // bounding surface indices (entry of the first element, exit of the last)
}

/** A per-surface record carrying the raw (scaled, pre-position) geometry, used to rebuild z for any focus gap. */
interface RawSurface {
  c: number;
  k: number;
  a: number[];
  t: number; // scaled gap to the next surface (or to the sensor, for the last)
  sd: number;
  mediumAfter: string; // resolved: 'air' or a catalog key
  kind: 'refract' | 'stop';
  label?: string;
  coated: boolean;
  doe?: Doe; // scaled diffractive phase profile, see scaleDoe below
}

/** A plane-parallel plate (filter, cover glass, drop-in filter): traced, drawn flat, not a lens element. */
export interface Plate {
  kind: 'filter' | 'cover-glass' | 'drop-in-filter';
  surfaces: [number, number];
}

export interface ResolvedLens {
  design: LensDesign;
  catalog: GlassCatalog;
  raw: RawSurface[];
  glassResolutions: GlassResolution[];
  models: Map<string, ModelGlass>; // model glasses built for nd/vd pairs with no exact catalog match
  elements: Element[];
  groups: CementedGroup[];
  plates: Plate[];
  warnings: string[]; // data inconsistencies found while loading (e.g. element counts)
  /** Set by realize.ts: the sensor sits this far (mm, +z = away from the lens) from the paraxial infinity image,
   *  where the best polychromatic on-axis focus is at full aperture (what autofocus does). Undefined = 0. */
  afOffset?: number;
  sensorZ: number; // fixed image-plane z at infinity focus
  index: (medium: string, nm: number) => number;
}

function scaleAsphere(asph: Asphere | undefined, scale: number): { k: number; a: number[] } {
  if (!asph) return { k: 0, a: [] };
  const orderKeys = ['A4', 'A6', 'A8', 'A10', 'A12', 'A14', 'A16'] as const;
  const orders = [4, 6, 8, 10, 12, 14, 16];
  const raw = orderKeys.map((k) => (asph as unknown as Record<string, number | undefined>)[k]);
  let last = -1;
  for (let i = 0; i < raw.length; i++) if (raw[i] !== undefined) last = i;
  const a: number[] = [];
  // Sag z(h) = c h^2/(1+sqrt(1-(1+k)c^2h^2)) + sum A_n h^n. Under a uniform length scale s (h'=s h, z'=s z,
  // c'=c/s), the conic term scales consistently automatically; each A_n must scale as A_n' = A_n / s^(n-1) to
  // keep z'=s z. k itself is a dimensionless shape ratio and does not scale.
  for (let i = 0; i <= last; i++) {
    const v = raw[i] ?? 0;
    a.push(v / scale ** (orders[i] - 1));
  }
  return { k: asph.k, a };
}

/**
 * Scales a Doe's coefficients for a design's `scale` (see LensDesign.scale). phi(h) = (2*pi/lambda0) * sum_i
 * coeffs[i] * h^(2*(i+1)) is dimensionless (radians): the physical requirement is that the ray deflection this
 * grating imparts at a CORRESPONDING (scaled) point of the scaled lens is unchanged (exactly as every other ray
 * angle in a uniformly-scaled lens design is unchanged -- f-number, field angle and every paraxial angle are scale
 * invariant). That deflection depends on grad(phi)(h) = (2*pi/lambda0) * sum_i (2*(i+1)) * coeffs[i] * h^(2i+1)
 * (docs/engine/doe.md derives this in full), a real (unscaled) wavelength lambda, and NOT lambda0 or the order,
 * neither of which is a geometric quantity that scales. Requiring grad(phi)'(s*h) = grad(phi)(h) term-by-term
 * gives coeffs[i]' * s^(2i+1) = coeffs[i], i.e. coeffs[i]' = coeffs[i] / s^(2i+1) -- exactly the same
 * scale^(order-1) rule scaleAsphere uses above (order = 2*(i+1), order-1 = 2i+1), since phi's h^n term behaves
 * under scaling exactly like an even-asphere sag term's h^n does. lambda0Nm, order and convention are physical
 * constants of the design, not scaled.
 */
function scaleDoe(doe: Doe | undefined, scale: number): Doe | undefined {
  if (!doe) return undefined;
  const coeffs = doe.coeffs.map((c, i) => c / scale ** (2 * i + 1));
  return { ...doe, coeffs };
}

/**
 * Normalizes a patent transcription's `DoeSpec` (lens-types.ts: coefficients keyed "C2", "C4", "C6", ... as the
 * patent itself names them) into the engine's canonical `Doe` (types.ts: an order-independent phi(h) array, see
 * that type's doc). Every convention transcribed into data/lenses/*.json so far (n500.json, m500.json: both
 * Nikon Phase Fresnel patents) writes
 *   psi(h, n) = (2*pi / (n*lambda0)) * (C2 h^2 + C4 h^4),    paraxial power phiD(lambda, n) = -2*C2*n*(lambda/lambda0)
 * i.e. the patent's OWN phase function carries an extra 1/n (order) factor that its OWN power formula does not
 * (docs/engine/doe.md works the full algebra): the grating equation applied to psi(h,n) with order n,
 *   kick = n * (lambda/(2*pi)) * d(psi)/dh = n * (lambda/(2*pi)) * (2*pi/(n*lambda0)) * d/dh(C2 h^2 + C4 h^4)
 *        = (lambda/lambda0) * d/dh(C2 h^2 + C4 h^4),
 * has the order n cancel out of the coefficient entirely -- which is exactly the same result as using THIS
 * engine's order-independent phi(h) = (2*pi/lambda0) * (C2 h^2 + C4 h^4) (no 1/n) with the surface.ts grating
 * kick m*(lambda/2*pi)*grad(phi) at m=n. So the patent's own printed C2/C4 plug directly into `Doe.coeffs`
 * UNCHANGED -- confirmed against the patent's own equation (d) / phiD formula, which is algebraically identical
 * to this engine's `doePower` (paraxial.ts) term for term. Every coefficient key must be "C<even integer>"; a key
 * this engine has not seen a convention define (e.g. an odd order, or a transcription typo) is refused rather
 * than silently dropped.
 */
function normalizeDoe(spec: DoeSpec | undefined): Doe | undefined {
  if (!spec) return undefined;
  const coeffs: number[] = [];
  for (const [key, value] of Object.entries(spec.coeffs)) {
    const m = /^C(\d+)$/.exec(key);
    if (!m) {
      throw new Error(`lens.ts: normalizeDoe: doe.coeffs key "${key}" is not of the form "C<even order>"`);
    }
    const order = parseInt(m[1], 10);
    if (order < 2 || order % 2 !== 0) {
      throw new Error(`lens.ts: normalizeDoe: doe.coeffs key "${key}": order ${order} must be a positive even integer >= 2`);
    }
    coeffs[order / 2 - 1] = value;
  }
  for (let i = 0; i < coeffs.length; i++) if (coeffs[i] === undefined) coeffs[i] = 0;
  return { convention: spec.convention, lambda0Nm: spec.lambda0Nm, order: spec.order, coeffs, note: spec.note };
}

export interface ModelGlass {
  key: string;
  nd: number;
  vd: number;
  base: GlassEntry;
  baseNd: number; // the base glass's nd evaluated from its coefficients (not the catalog's printed nd)
  scale: number; // ((nd - 1)/vd) / (nF - nC)_base, the base dispersion evaluated from its coefficients
}

/** Index of a model glass at a wavelength (see the comment above EXACT_DND). */
export function modelIndexAt(m: ModelGlass, nm: number): number {
  return m.nd + (indexAt(m.base, nm) - m.baseNd) * m.scale;
}

/** nd and vd of a catalog entry evaluated from its coefficients. Catalogs print rounded values (SUMITA prints some
 *  Vd to 1-3 significant figures), so exact-match decisions use these, never the printed ones. */
function evaluatedNdVd(e: GlassEntry): { nd: number; vd: number; dFC: number } {
  const nd = indexAt(e, FRAUNHOFER_D_NM);
  const dFC = indexAt(e, 486.1327) - indexAt(e, 656.2725);
  return { nd, vd: (nd - 1) / dFC, dFC };
}

function resolveMedium(
  s: Surface,
  surfaceIndex: number,
  catalog: GlassCatalog,
  resolutions: GlassResolution[],
  models: Map<string, ModelGlass>,
): string {
  if (s.medium === 'air') return 'air';
  if (s.nd === undefined || s.vd === undefined) {
    throw new Error(
      `lens.ts: loadLens: surface ${surfaceIndex} (medium "${s.medium}") is missing nd/vd, required for any ` +
        `non-air medium`,
    );
  }
  if (s.medium === 'glass') {
    const { entry, dnd, dvd } = resolveGlass(catalog, s.nd, s.vd);
    // A resin layer (s.layer === 'resin': a thin molded material bonded to the element that follows, e.g. a
    // hybrid-asphere coating or one of a close-contact-multilayer DOE's two laminated materials) is not a
    // catalog glass at all and is never expected to sit near one -- the FAIL_LOUD distance guard exists to catch
    // an empty/wrong catalog for ordinary optical glass, not to second-guess a real, patent-stated resin nd/vd.
    // Skip it here (lead instruction, 09/28/2026); the model-glass construction below still reproduces the
    // resin's own stated nd/vd exactly regardless of how far the nearest catalog entry sits, borrowing only that
    // entry's dispersion SHAPE (see the model-glass doc above resolveMedium's neighbor evaluatedNdVd).
    const isResin = s.layer === 'resin';
    if (!isResin && (Math.abs(dnd) > FAIL_LOUD_MAX_DND || Math.abs(dvd) > FAIL_LOUD_MAX_DVD)) {
      throw new Error(
        `lens.ts: loadLens: surface ${surfaceIndex}: nearest catalog glass ${entry.key} (nd=${entry.nd}, ` +
          `vd=${entry.vd}) is too far from the requested nd=${s.nd}, vd=${s.vd} (dnd=${dnd.toFixed(4)}, ` +
          `dvd=${dvd.toFixed(2)}) — catalog looks empty or wrong, refusing to use it`,
      );
    }
    const ev = evaluatedNdVd(entry);
    if (!isResin && Math.abs(s.nd - ev.nd) <= EXACT_DND && Math.abs(s.vd - ev.vd) <= EXACT_DVD) {
      resolutions.push({
        surfaceIndex, requested: 'glass', resolvedKey: entry.key, matched: true, kind: 'catalog', baseKey: entry.key,
        nd: s.nd, vd: s.vd, dnd, dvd,
      });
      return entry.key;
    }
    const key = isResin
      ? `MODEL:resin:${s.nd.toFixed(5)}/${s.vd.toFixed(2)}~${entry.key}`
      : `MODEL:${s.nd.toFixed(5)}/${s.vd.toFixed(2)}~${entry.key}`;
    if (!models.has(key)) {
      // a non-dispersive base (test fixtures) has nF = nC: the model is then a constant index nd
      const scale = ev.dFC !== 0 && Number.isFinite(ev.dFC) ? ((s.nd - 1) / s.vd) / ev.dFC : 0;
      models.set(key, { key, nd: s.nd, vd: s.vd, base: entry, baseNd: ev.nd, scale });
    }
    resolutions.push({
      surfaceIndex, requested: 'glass', resolvedKey: key, matched: true, kind: 'model', baseKey: entry.key,
      nd: s.nd, vd: s.vd, dnd, dvd,
    });
    return key;
  }
  const entry = catalog.get(s.medium);
  if (!entry) {
    throw new Error(`lens.ts: loadLens: surface ${surfaceIndex}: unknown glass key "${s.medium}" (not in catalog)`);
  }
  resolutions.push({
    surfaceIndex, requested: s.medium, resolvedKey: entry.key, matched: false, kind: 'catalog', baseKey: entry.key,
    nd: s.nd, vd: s.vd, dnd: s.nd - entry.nd, dvd: s.vd - entry.vd,
  });
  return entry.key;
}

function mediumBeforeIndex(raw: RawSurface[], i: number): string {
  return i === 0 ? 'air' : raw[i - 1].mediumAfter;
}

function buildElementsAndGroups(raw: RawSurface[], surfaces: LensDesign['surfaces']): {
  elements: Element[]; groups: CementedGroup[]; plates: Plate[];
} {
  const elements: Element[] = [];
  const plates: Plate[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i].mediumAfter === 'air') {
      i++;
      continue;
    }
    const kind = surfaces[i].plate;
    if (kind) {
      plates.push({ kind, surfaces: [i, i + 1] }); // traced, not counted as a lens element
      i++;
      continue;
    }
    // Absorb this glass segment, then keep absorbing forward across any joint bonded by a resin layer (a
    // molded/laminated hybrid-asphere coating, or either material of a close-contact-multilayer DOE -- n500.json's
    // has two, back to back) on EITHER side of that joint: a bonded layer is never its own separate "lens" the
    // way two merely-cemented elements are (which DO stay separate elements here, merged into a group below); it
    // counts as part of whatever it is laminated to, front or back, so a run of them merges transitively with
    // their host element until a non-bonded joint or air. A joint never extends across real air (that is simply
    // where the whole assembly ends), which the `raw[rear].mediumAfter !== 'air'` guard enforces regardless of
    // either side's own layer marking. See lens-types.ts's `layer` doc (main, commit 0e7117c) and the lead's
    // 09/28/2026 instruction to extend the original single-layer rule to a run of consecutive ones.
    let rear = i + 1;
    while (
      rear < raw.length &&
      raw[rear].mediumAfter !== 'air' &&
      (surfaces[rear - 1]?.layer === 'resin' || surfaces[rear]?.layer === 'resin')
    ) {
      rear++;
    }
    elements.push({ index: elements.length + 1, surfaces: [i, rear], groupId: null });
    i = rear;
  }
  const groups: CementedGroup[] = [];
  let gi = 0;
  while (gi < elements.length) {
    const start = gi;
    let end = gi;
    while (end + 1 < elements.length && elements[end].surfaces[1] === elements[end + 1].surfaces[0]) end++;
    const id = groups.length;
    for (let j = start; j <= end; j++) elements[j].groupId = id;
    groups.push({
      id,
      elements: elements.slice(start, end + 1).map((e) => e.index),
      surfaces: [elements[start].surfaces[0], elements[end].surfaces[1]],
    });
    gi = end + 1;
  }
  return { elements, groups, plates };
}

export function loadLens(design: LensDesign, catalog: GlassCatalog): ResolvedLens {
  if (design.surfaces.length === 0) throw new Error(`lens.ts: loadLens: ${design.id} has no surfaces`);
  const scale = design.scale;
  if (!(scale > 0)) throw new Error(`lens.ts: loadLens: ${design.id}: scale must be positive, got ${scale}`);

  const glassResolutions: GlassResolution[] = [];
  const models = new Map<string, ModelGlass>();
  const raw: RawSurface[] = design.surfaces.map((s, i) => {
    const mediumAfter = resolveMedium(s, i, catalog, glassResolutions, models);
    const { k, a } = scaleAsphere(s.asph, scale);
    const doe = scaleDoe(normalizeDoe(s.doe), scale);
    return {
      c: s.r === null ? 0 : 1 / (s.r * scale),
      k,
      a,
      t: s.t * scale,
      sd: s.sd * scale,
      mediumAfter,
      kind: s.stop ? 'stop' : 'refract',
      label: s.label,
      coated: s.coated ?? false, // default resolved below, once we know the neighboring media
      doe,
    };
  });
  // Coating default: air-glass surfaces default to coated; a cemented (glass-glass) face is never coated. Honor
  // an explicit surface.coated when the design states one.
  design.surfaces.forEach((s, i) => {
    if (s.coated !== undefined) return; // explicit value already carried through
    const before = mediumBeforeIndex(raw, i);
    const after = raw[i].mediumAfter;
    raw[i].coated = !(before !== 'air' && after !== 'air');
  });

  const index = (medium: string, nm: number): number => {
    if (medium === 'air') return 1;
    const model = models.get(medium);
    if (model) return modelIndexAt(model, nm);
    const entry = catalog.get(medium);
    if (!entry) throw new Error(`lens.ts: system.index: "${medium}" did not resolve during loadLens`);
    return indexAt(entry, nm);
  };

  // sensorZ at infinity focus: cumulative z from the raw surfaces' t's, plus the last surface's t (the design's
  // stated back focal distance to the image plane at infinity focus).
  let z = 0;
  for (let i = 0; i < raw.length - 1; i++) z += raw[i].t;
  const lastZ = z;
  const sensorZ = lastZ + raw[raw.length - 1].t;

  const { elements, groups, plates } = buildElementsAndGroups(raw, design.surfaces);

  // A count that disagrees with the file is a documentation problem, not a physics one: report it (lenses.test.ts
  // fails on it) instead of refusing to load the lens.
  const warnings: string[] = [];
  if (elements.length !== design.elements) {
    warnings.push(`counted ${elements.length} elements from the surface list, design states ${design.elements}`);
  }
  if (groups.length !== design.groups) {
    warnings.push(`counted ${groups.length} groups, design states ${design.groups}`);
  }
  if (design.focus.method !== 'unit' && !(design.focus.gaps?.length)) {
    warnings.push(`focus method "${design.focus.method}" lists no variable gaps; focusing by unit extension (schematic)`);
  }

  return { design, catalog, raw, glassResolutions, models, elements, groups, plates, sensorZ, index, warnings };
}

/** Builds z positions for the raw surfaces given a (possibly per-surface) set of gap overrides, then the surfaces. */
function buildSurfaces(lens: ResolvedLens, tOverride: (i: number, base: number) => number): TraceSurface[] {
  const out: TraceSurface[] = [];
  let z = 0;
  for (let i = 0; i < lens.raw.length; i++) {
    const r = lens.raw[i];
    out.push({
      z, c: r.c, k: r.k, a: r.a, sd: r.sd,
      kind: r.kind, mediumAfter: r.mediumAfter, label: r.label, coated: r.coated, doe: r.doe,
    });
    z += tOverride(i, r.t);
  }
  // The image plane never vignettes: the sensor's own edges (the format) are applied by whoever reads the landing
  // points. It used to inherit the last element's sd, which threw away every ray landing beyond ~13 mm.
  out.push({ z: z + (lens.afOffset ?? 0), c: 0, k: 0, a: [], sd: 1e9, kind: 'image', mediumAfter: 'air' });
  return out;
}

function toSystem(lens: ResolvedLens, surfaces: TraceSurface[]): TraceSystem {
  return { surfaces, index: lens.index };
}

/** Solves f(x)=0 by Newton's method with a numerical derivative. Throws if it fails to converge. */
function solveNewton(f: (x: number) => number, x0: number, opts: { h: number; tol: number; maxIter: number; label: string }): number {
  let x = x0;
  for (let iter = 0; iter < opts.maxIter; iter++) {
    const fx = f(x);
    if (Math.abs(fx) < opts.tol) return x;
    const fxh = f(x + opts.h);
    const deriv = (fxh - fx) / opts.h;
    if (deriv === 0) break;
    x = x - fx / deriv;
  }
  const residual = f(x);
  if (Math.abs(residual) < opts.tol * 50) return x; // accept a slightly loose but reasonable converge
  throw new Error(`lens.ts: systemAt: ${opts.label} did not converge (residual ${residual.toFixed(6)} mm)`);
}

/**
 * A TraceSystem for this lens, with the image plane at the fixed infinity-focus sensor position.
 * focusFromSensorMm === null gives the infinity-focus system unmodified. Otherwise it is the object distance
 * from the (fixed) sensor plane, in mm, clamped to the design's minimum focus.
 *
 * 'unit' focus moves every surface forward (toward the object, away from the sensor) by a solved extension;
 * every other method interpolates the design's declared variable gaps (design.focus.gaps) by a single solved
 * parameter t in [0,1] (0 = infinity, 1 = the design's stated close-focus condition). Both are solved paraxially
 * at the d line so the object images onto the fixed sensor (Newton's method; see paraxial.imageOf).
 */
export function systemAt(lens: ResolvedLens, focusFromSensorMm: number | null, opts?: { clamp?: boolean }): TraceSystem {
  const infinitySurfaces = buildSurfaces(lens, (_i, t) => t);
  if (focusFromSensorMm === null) return toSystem(lens, infinitySurfaces);

  const minFocusMm = lens.design.focus.minFocusM * 1000;
  const clamped = Math.max(focusFromSensorMm, minFocusMm);
  // Distances are measured from the physical sensor (paraxial image + afOffset). The focus solve still puts the
  // PARAXIAL image at lens.sensorZ, so the best focus (paraxial + afOffset) lands on the sensor, as autofocus does.
  const objectZ = lens.sensorZ + (lens.afOffset ?? 0) - clamped;
  const nm = FRAUNHOFER_D_NM;

  // A design that names another focus method but lists no variable gaps (the patent gave none) focuses by unit
  // extension here, a schematic stand-in; loadLens records a warning.
  if (lens.design.focus.method === 'unit' || !(lens.design.focus.gaps?.length)) {
    const shifted = (e: number) => buildSurfaces(lens, (_i, t) => t).map((s) => (s.kind === 'image' ? s : { ...s, z: s.z - e }));
    // Rebuild the image surface at the fixed sensorZ regardless of e (unit focus moves the barrel, not the sensor).
    const systemFor = (e: number): TraceSystem => {
      const surfaces = shifted(e).map((s) => (s.kind === 'image' ? { ...s, z: lens.sensorZ + (lens.afOffset ?? 0) } : s));
      return toSystem(lens, surfaces);
    };
    const f = (e: number) => imageOf(systemFor(e), nm, objectZ).z - lens.sensorZ;
    const e = solveNewton(f, 0, { h: 0.01, tol: 1e-6, maxIter: 40, label: `unit-focus extension for ${lens.design.id}` });
    return systemFor(e);
  }

  const gaps: VariableGap[] = lens.design.focus.gaps ?? [];
  if (gaps.length === 0) {
    throw new Error(
      `lens.ts: systemAt: ${lens.design.id}: focus method "${lens.design.focus.method}" needs design.focus.gaps`,
    );
  }
  const scale = lens.design.scale;
  // Only a table that lists the back-focus gap itself (the last raw surface's gap) moves the sensor this way; the
  // rest keep the fixed sensorZ they were transcribed against (see sensorOf's doc below). F3 (09/30/2026): this
  // policy must hold for the SYSTEM buildSurfaces() actually returns, not only for the solve's own internal target.
  // buildSurfaces() always places the image at the cumulative sum of every raw gap; when an interior gap (not the
  // last one) changes with focus, that cumulative sum drifts even though the physical sensor has not moved. For a
  // !movesBackFocus design, the last (back-focus) air gap absorbs that drift here, so the RETURNED image surface
  // -- what every consumer (trace.ts, iris.ts, pointBundle) actually reads -- lands exactly on the fixed sensor,
  // matching what the solve below already (correctly) aimed at. Without this, p35/p85's solved conjugate and their
  // returned image plane silently disagreed by several mm (F3's 7-8 mm image-surface mismatch).
  const movesBackFocus = gaps.some((g) => g.surface === lens.raw.length - 1);
  const systemFor = (t: number): TraceSystem => {
    const overrideMap = new Map<number, number>();
    for (const g of gaps) {
      overrideMap.set(g.surface, (g.atInfinity + t * (g.atClose - g.atInfinity)) * scale);
    }
    if (!movesBackFocus) {
      const lastIdx = lens.raw.length - 1;
      let throughPenultimate = 0;
      for (let i = 0; i < lastIdx; i++) throughPenultimate += overrideMap.get(i) ?? lens.raw[i].t;
      overrideMap.set(lastIdx, lens.sensorZ - throughPenultimate);
    }
    const surfaces = buildSurfaces(lens, (i, base) => overrideMap.get(i) ?? base);
    return toSystem(lens, surfaces);
  };
  // The sensor is the system's own image surface when a design's gap table includes the back focus (the gap from
  // the last surface to the image: n50, s35, p50): growing it means the glass moved forward away from a fixed
  // sensor, which in these front-vertex coordinates shows up as the image surface moving back. Both the target
  // (the paraxial image at the sensor, less the autofocus offset, as at infinity) and the object's position
  // (measured from the sensor) therefore follow that surface.
  const sensorOf = (sys: TraceSystem) => (movesBackFocus ? sys.surfaces[sys.surfaces.length - 1].z - (lens.afOffset ?? 0) : lens.sensorZ);
  const f = (t: number) => {
    const sys = systemFor(t);
    const sensor = sensorOf(sys);
    return imageOf(sys, nm, sensor + (lens.afOffset ?? 0) - clamped).z - sensor;
  };
  const t = solveNewton(f, 0.5, { h: 1e-4, tol: 1e-6, maxIter: 60, label: `${lens.design.focus.method} focus parameter for ${lens.design.id}` });
  // t is documented (see this function's doc comment) as living in [0,1]: 0 = infinity, 1 = the design's stated
  // close-focus condition. Newton's method itself has no notion of that bound -- it happily extrapolates past
  // t=1 (and, pushed further, into a negative group-to-group gap: the rear group solved to sit axially in front
  // of the front group it is supposed to follow, a geometry that cannot physically exist) for a focus request
  // the design's focus.gaps table cannot actually reach. That range is real: focus.minFocusM is an independently
  // sourced value (often a patent's stated closest-focus spec) with no code-enforced relationship to the
  // separately authored/estimated focus.gaps table, so a minFocusM tighter than what the gaps table reaches at
  // t=1 leaves requests in between un-clamped. Rather than silently return that impossible geometry, fail loudly
  // -- consistent with solveNewton's own non-convergence throw just above, and with this module's documented
  // "throws with a residual rather than returning a silently wrong focus position" contract (see
  // docs/engine/e1b.md, "Known limits").
  const T_EPS = 1e-6;
  // With opts.clamp (the camera model), a request the gaps cannot reach focuses as close as they can: t = 1.
  // A design that opts into extrapolation (focus.extrapolate) continues the tabulated motion past t = 1.
  const tMax = lens.design.focus.extrapolate ? Infinity : 1;
  if (opts?.clamp && (t < -T_EPS || t > tMax + T_EPS)) return systemFor(Math.min(tMax, Math.max(0, t)));
  if (t < -T_EPS || t > tMax + T_EPS) {
    throw new Error(
      `lens.ts: systemAt: ${lens.design.focus.method} focus parameter t=${t.toFixed(4)} for ${lens.design.id} ` +
        `is outside the documented range [0,1] (0 = infinity, 1 = the design's stated close-focus condition) -- ` +
        `the requested focus distance (${clamped.toFixed(2)}mm from the sensor) is closer than design.focus.gaps ` +
        `can reach even though it is farther than design.focus.minFocusM (${minFocusMm.toFixed(2)}mm); the ` +
        `design's focus.gaps and focus.minFocusM disagree`,
    );
  }
  return systemFor(t);
}

export function sensorZ(lens: ResolvedLens): number {
  return lens.sensorZ;
}

// Re-exported so callers (iris.ts, lenses.test.ts) can compute pupils/fno on a built system without a second
// import of paraxial.ts's cardinal for the common case of "at this lens's infinity focus".
export { cardinal };
