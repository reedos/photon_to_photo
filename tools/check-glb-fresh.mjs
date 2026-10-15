// Rebuilds a body (or lens) GLB from its Blender script into a scratch folder and compares the result with the shipped
// file's JSON chunk: node tree, extras (labels), materials, mesh names and scenes. A label edited in a script and not
// re-exported shows up here (score loop r4, 10/11/2026: the shipped dslr.glb still said "round the shutter button").
// It compares the JSON, not the bytes: Draco buffer sizes of the lens GLBs differ from build to build.
//
// It also compares geometry (score loop r5, 10/11/2026): the JSON names and materials cannot tell a lens built from
// older clear apertures from a current one (the shipped n500fl had elements 4.6 mm narrower than its prescription and
// every name and material matched). Each mesh's position bounding box (the accessor min/max, which the exporter writes
// from the source vertices, not the Draco-quantized ones) must agree with the rebuild to GEOMETRY_TOL_MM, and its
// triangle count exactly.
//
//   node tools/check-glb-fresh.mjs [dslr] [mirrorless] [lens:z800 ...] [lite:z800 ...]     (default: both bodies)
//   BLENDER=/path/to/blender node tools/check-glb-fresh.mjs
//
// Exits 1 when a shipped file differs from a fresh build, 2 when Blender cannot be found.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
].filter(Boolean);

export function findBlender() {
  return CANDIDATES.find((p) => existsSync(p));
}

/** The JSON chunk of a GLB, reduced to what a script edit can change and a rebuild reproduces exactly. */
export function glbSignature(path) {
  const b = readFileSync(path);
  const g = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  return {
    scenes: g.scenes,
    nodes: g.nodes,
    materials: g.materials,
    meshNames: (g.meshes ?? []).map((m) => m.name),
    primitiveMaterials: (g.meshes ?? []).map((m) => m.primitives.map((p) => p.material ?? null)),
  };
}

/** How far a mesh's bounding box may differ from a rebuild's (mm): the exporter's own rounding, not the Draco step. */
export const GEOMETRY_TOL_MM = 0.05;

/** Per mesh, in file order: name, triangle count and position bounding box (mm, the file's own frame). */
export function glbGeometry(path) {
  const b = readFileSync(path);
  const g = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  return (g.meshes ?? []).map((m) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    for (const p of m.primitives) {
      const a = g.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k]);
        max[k] = Math.max(max[k], a.max[k]);
      }
      tris += p.indices === undefined ? a.count / 3 : g.accessors[p.indices].count / 3;
    }
    return { name: m.name, tris, min, max };
  });
}

/** A sentence naming the first mesh whose triangle count or bounding box differs between two glbGeometry lists, or null. */
export function geometryDiff(a, b, tolMm = GEOMETRY_TOL_MM) {
  if (a.length !== b.length) return `mesh count ${a.length} against ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.name !== y.name) return `mesh ${i} is ${x.name} against ${y.name}`;
    if (x.tris !== y.tris) return `${x.name}: ${x.tris} triangles against ${y.tris}`;
    for (let k = 0; k < 3; k++) {
      for (const side of ['min', 'max']) {
        const d = Math.abs(x[side][k] - y[side][k]);
        if (d > tolMm) return `${x.name}: bounding box ${side}[${'xyz'[k]}] ${x[side][k].toFixed(3)} against ${y[side][k].toFixed(3)} (${d.toFixed(3)} mm)`;
      }
    }
  }
  return null;
}

/** The path of the first difference between two JSON values, or null when they are equal. */
export function firstDiff(a, b, at = '$') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return at;
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : at;
}

function build(blender, target, out) {
  const [kind, id] = target.split(':');
  const lens = kind === 'lens' || kind === 'lite';       // lite:<id> is the phone variant (lens_v2.py --lite)
  const script = lens ? 'blender/lens_v2.py' : kind === 'dslr' ? 'blender/dslr_v2.py' : 'blender/mirrorless_v2.py';
  const args = ['--background', '--factory-startup', '--python', join(ROOT, script), '--', ...(lens ? ['--lens', id] : []), ...(kind === 'lite' ? ['--lite'] : []), '--export', out];
  const r = spawnSync(blender, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`Blender failed for ${target}:\n${(r.stdout ?? '').slice(-2000)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const blender = findBlender();
  if (!blender) {
    console.error('Blender not found (set BLENDER)');
    process.exit(2);
  }
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['dslr', 'mirrorless'];
  let bad = 0;
  for (const t of targets) {
    const shipped = t.startsWith('lens:') ? `public/models/lenses/${t.slice(5)}.glb` : t.startsWith('lite:') ? `public/models/lenses/${t.slice(5)}.lite.glb` : `public/models/${t}.glb`;
    const dir = mkdtempSync(join(tmpdir(), 'p2p-fresh-'));
    try {
      const out = join(dir, 'fresh.glb');
      build(blender, t, out);
      const d = firstDiff(glbSignature(join(ROOT, shipped)), glbSignature(out));
      const geo = d ? null : geometryDiff(glbGeometry(join(ROOT, shipped)), glbGeometry(out));
      console.log(d ? `STALE ${shipped}: differs at ${d}` : geo ? `STALE ${shipped}: geometry differs, ${geo}` : `fresh ${shipped}`);
      if (d || geo) bad++;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  process.exit(bad ? 1 : 0);
}
