// Aperture review, 10/11/2026: what realize.ts's physical-edge cap (edges.ts) changed, lens by lens.
//
//   npx tsx tools/review-loop/apertures.ts [summary.json] [full.json]
//
// For every lens in data/lenses it prints the capped surfaces (before and after sd) and, before and after the cap:
// - on-axis pupil pass at full aperture, infinity and closest focus (the stop sets the f-number only if this is 1);
// - the transmitted pupil area at 0, 50, 70, 90 and 100 percent of the design half field (2D Fibonacci pupil,
//   F/d/C), i.e. the mechanical vignetting;
// - an independent crossing scan of every pair of consecutive surfaces with glass between them or air between
//   two glass bodies (the same test as edge-scan.mjs, from the surface data only): minimum edge and air.
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { loadLens, systemAt } from '../../src/engine/lens';
import { makeCatalog } from '../../src/engine/glass';
import { realize } from '../../src/engine/realize';
import type { GlassEntry, LensDesign } from '../../src/engine/lens-types';
import { cardinal } from '../../src/engine/paraxial';
import { aimRay, traceRay, type Field } from '../../src/engine/trace';
import { sag } from '../../src/engine/surface';
import { FRAUNHOFER_D_NM } from '../../src/engine/glass';
import type { RealizedLens } from '../../src/engine/realize';
import type { TraceSystem } from '../../src/engine/types';

const FCd = [486.1327, 587.5618, 656.2725];
const N_PUPIL = 600;
const pupil: [number, number][] = [];
for (let i = 0; i < N_PUPIL; i++) {
  const r = Math.sqrt((i + 0.5) / N_PUPIL), a = i * 2.399963229728653;
  pupil.push([r * Math.cos(a), r * Math.sin(a)]);
}
const rim: [number, number][] = [];
for (let k = 0; k < 72; k++) rim.push([Math.cos((k * Math.PI) / 36), Math.sin((k * Math.PI) / 36)]);

function withSd(lens: RealizedLens, sd: number[]): RealizedLens {
  return { ...lens, raw: lens.raw.map((r, i) => ({ ...r, sd: sd[i] })) };
}

function passFraction(sys: TraceSystem, stopR: number, field: (pupZ: number) => Field, pts: [number, number][]): number {
  const c = cardinal(sys, FRAUNHOFER_D_NM, stopR);
  let ok = 0, n = 0;
  const f = field(c.ep.z);
  for (const nm of FCd) for (const [px, py] of pts) {
    n++;
    if (traceRay(sys, aimRay(sys, c.ep, f, px, py, nm, { realAim: true })).status === 'ok') ok++;
  }
  return ok / n;
}

/** The largest on-axis pupil fraction v whose rim (F/d/C) passes, and the on-axis ray heights at full aperture. */
function axial(sys: TraceSystem, stopR: number, field: Field) {
  const c = cardinal(sys, FRAUNHOFER_D_NM, stopR);
  const passes = (v: number) => {
    for (const nm of FCd) for (const [px, py] of rim) {
      if (traceRay(sys, aimRay(sys, c.ep, field, px * v, py * v, nm, { realAim: true })).status !== 'ok') return false;
    }
    return true;
  };
  let lo = 0, hi = 1;
  if (passes(1)) lo = 1;
  else for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (passes(m)) lo = m; else hi = m; }
  const heights = sys.surfaces.map(() => 0);
  for (const nm of FCd) {
    const p = traceRay(sys, aimRay(sys, c.ep, field, 0, 1, nm, { realAim: true }), { ignoreVignetting: true });
    p.pts.slice(1, sys.surfaces.length + 1).forEach((q, i) => { heights[i] = Math.max(heights[i], Math.hypot(q[0], q[1])); });
  }
  return { v: lo, heights };
}

function measure(lens: RealizedLens) {
  const r = lens.realization;
  const inf = systemAt(lens, null);
  const close = systemAt(lens, r.closestFocusMm, { clamp: true });
  const objZ = close.surfaces[close.surfaces.length - 1].z - r.closestFocusMm;
  const onAxisInf = Math.min(passFraction(inf, r.stopRadius, () => ({ kind: 'angle', ax: 0, ay: 0 }), pupil),
    passFraction(inf, r.stopRadius, () => ({ kind: 'angle', ax: 0, ay: 0 }), rim));
  const onAxisClose = Math.min(passFraction(close, r.stopRadius, () => ({ kind: 'object', o: [0, 0, objZ] }), pupil),
    passFraction(close, r.stopRadius, () => ({ kind: 'object', o: [0, 0, objZ] }), rim));
  const axInf = axial(inf, r.stopRadius, { kind: 'angle', ax: 0, ay: 0 });
  const axClose = axial(close, r.stopRadius, { kind: 'object', o: [0, 0, objZ] });
  const field: Record<string, number> = {};
  for (const f of [0, 0.5, 0.7, 0.9, 1.0]) {
    const ang = (r.halfFieldDeg * f * Math.PI) / 180;
    field[f.toFixed(1)] = passFraction(inf, r.stopRadius, () => ({ kind: 'angle', ax: 0, ay: ang }), pupil);
  }
  return { onAxisInf, onAxisClose, field, pupilInf: axInf.v, pupilClose: axClose.v,
    axialHeights: axInf.heights.map((h, i) => Math.max(h, axClose.heights[i])) };
}

/** Minimum edge (glass between) and air (between two bodies) over consecutive surfaces, at both foci. */
function scan(lens: RealizedLens) {
  const r = lens.realization;
  const out: { pair: string; medium: string; min: number; at: number; focus: string }[] = [];
  for (const [name, sys] of [['inf', systemAt(lens, null)], ['close', systemAt(lens, r.closestFocusMm, { clamp: true })]] as const) {
    const S = sys.surfaces;
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i], b = S[i + 1];
      if (b.kind === 'image' || a.kind === 'stop' || b.kind === 'stop') continue;
      const before = i === 0 ? 'air' : S[i - 1].mediumAfter;
      const afterB = b.mediumAfter;
      // skip pairs that include a dummy (air on both sides) surface
      if (a.mediumAfter === 'air' && (before === 'air' || afterB === 'air')) {
        if (before === 'air' && i > 0) continue;
        if (afterB === 'air') continue;
      }
      const hMax = Math.min(a.sd, b.sd);
      let worst = Infinity, at = 0;
      for (let k = 0; k <= 400; k++) {
        const h = (hMax * k) / 400;
        const g = b.z + sag(b, h) - (a.z + sag(a, h));
        if (g < worst) { worst = g; at = h; }
      }
      out.push({ pair: `${i}->${i + 1}`, medium: a.mediumAfter, min: worst, at, focus: name });
    }
  }
  return out;
}

const report: Record<string, unknown> = {};
const fmt = (x: number, d = 3) => x.toFixed(d);
const catalog = makeCatalog(JSON.parse(readFileSync('data/glass/catalog.json', 'utf8')) as GlassEntry[]);
const ids = readdirSync('data/lenses').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
for (const id of ids) {
  const design = JSON.parse(readFileSync(`data/lenses/${id}.json`, 'utf8')) as LensDesign;
  const after = realize(loadLens(design, catalog));
  const r = after.realization;
  const before = withSd(after, r.sdSurveyed);
  const mb = measure(before), ma = measure(after);
  const sb = scan(before), sa = scan(after);
  const crossB = sb.filter((x) => x.min < -1e-3).length;
  const crossA = sa.filter((x) => x.min < -1e-3).length;
  const glassMinA = Math.min(...sa.filter((x) => x.medium !== 'air').map((x) => x.min));
  console.log(`\n== ${id} (${after.design.maxFno}, half field ${fmt(r.halfFieldDeg, 2)} deg): ${r.capped.length} surfaces capped; crossings ${crossB} -> ${crossA}; thinnest edge after ${fmt(glassMinA)} mm`);
  for (const c of r.capped) {
    const ax = Math.max(mb.axialHeights[c.surface], 0);
    console.log(`  s${c.surface} (element ${c.element ?? 'plate'}): ${fmt(c.before)} -> ${fmt(c.after)} mm (-${fmt(c.before - c.after)}) [${c.rule}${c.relaxed ? ', RELAXED to hold the axial bundle' : ''}${c.axialCut ? ', AXIAL CUT' : ''}] on-axis marginal ${fmt(ax)}${ax > c.after ? ' CUTS AXIAL' : ''}; ${c.reason}`);
  }
  for (const x of sa.filter((x) => x.medium !== 'air' && x.min < 0.5 && x.focus === 'inf')) console.log(`  thin glass after: ${x.pair} ${x.medium} min ${fmt(x.min)} at h ${fmt(x.at)}`);
  for (const x of sa.filter((x) => x.medium === 'air' && x.min < 0.1)) console.log(`  close air after: ${x.pair} (${x.focus}) min ${fmt(x.min)} at h ${fmt(x.at)}`);
  console.log(`  on-axis largest passing pupil fraction inf ${fmt(mb.pupilInf, 4)} -> ${fmt(ma.pupilInf, 4)}, close ${fmt(mb.pupilClose, 4)} -> ${fmt(ma.pupilClose, 4)}; f-number ${after.design.maxFno} -> f/${fmt(after.design.maxFno / Math.min(ma.pupilInf, 1), 3)} (inf), f/${fmt(after.design.maxFno / Math.min(ma.pupilClose, 1), 3)} (close, nominal)`);
  console.log(`  on-axis pass inf ${fmt(mb.onAxisInf, 4)} -> ${fmt(ma.onAxisInf, 4)}, close ${fmt(mb.onAxisClose, 4)} -> ${fmt(ma.onAxisClose, 4)}`);
  console.log(`  field pass ${Object.keys(mb.field).map((k) => `${k}: ${fmt(mb.field[k])} -> ${fmt(ma.field[k])}`).join(', ')}`);
  // which cap costs the corner: give one element back its surveyed sds at a time and re-measure the corner
  const cornerCost: Record<string, number> = {};
  if (r.capped.length) {
    const ang = (r.halfFieldDeg * Math.PI) / 180;
    const corner = (lens: RealizedLens) => passFraction(systemAt(lens, null), r.stopRadius, () => ({ kind: 'angle', ax: 0, ay: ang }), pupil);
    const groups = new Map<string, number[]>();
    for (const c of r.capped) {
      const k = c.element === null ? 'plate' : `element ${c.element}`;
      groups.set(k, [...(groups.get(k) ?? []), c.surface]);
    }
    for (const [k, surfs] of groups) {
      const sd = r.sdRealized.slice();
      for (const s of surfs) sd[s] = r.sdSurveyed[s];
      cornerCost[k] = corner(withSd(after, sd)) - ma.field['1.0'];
    }
    console.log(`  corner pupil area regained by un-capping one element: ${Object.entries(cornerCost).map(([k, v]) => `${k} +${fmt(v)}`).join(', ')}`);
  }
  // element sections (z, r) for the before/after drawings (apertures-sections.py): each surface follows its
  // prescription out to its sd and is flat-ground from there to the element's rim, as blender/lens_v2.py draws it
  const inf = systemAt(after, null);
  const sections = (sd: number[]) => after.elements.map((e) => {
    const [f, b] = e.surfaces;
    const rim = Math.max(sd[f], sd[b]);
    const prof = (s: number) => Array.from({ length: 41 }, (_, k) => {
      const h = (rim * k) / 40;
      return [inf.surfaces[s].z + sag(inf.surfaces[s], Math.min(h, sd[s])), h];
    });
    return { element: e.index, front: prof(f), back: prof(b), capped: r.capped.some((c) => c.surface === f || c.surface === b) };
  });
  const stop = inf.surfaces.find((s) => s.kind === 'stop')!;
  const drawing = { id, stop: [stop.z, r.stopRadius], sensorZ: inf.surfaces[inf.surfaces.length - 1].z, before: sections(r.sdSurveyed), after: sections(r.sdRealized) };
  report[id] = { maxFno: after.design.maxFno, halfFieldDeg: r.halfFieldDeg, capped: r.capped, before: mb, after: ma, crossingsBefore: crossB, crossingsAfter: crossA, thinnestEdgeAfter: glassMinA, cornerCost, drawing };
}
// argv[2]: the summary (committed as evidence); argv[3]: the same plus the section outlines, for apertures-sections.py
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, (k, v) => (k === 'drawing' ? undefined : v), 1) + '\n');
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report) + '\n');
