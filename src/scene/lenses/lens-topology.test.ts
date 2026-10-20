// Open edges on the lens models (score loop r5, 10/11/2026). Flat printed decals (the spec text, the distance-scale marks
// and ticks, the front engraving) are open surfaces by design and carry extras.decal = true, so they are left out by
// name and the open-edge counts of the real parts mean something: every solid part is closed, apart from the one place
// named below.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { nodeDracoLoader } from '../bodies/draco-node';
import manifest from '../../../public/models/lenses.json';

const ROOT = resolve(__dirname, '../../..');
const lenses = (manifest as any).lenses as Record<string, any>;

function loadGlb(rel: string): Promise<THREE.Group> {
  const buf = readFileSync(resolve(ROOT, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, bad) => new GLTFLoader().setDRACOLoader(nodeDracoLoader()).parse(ab, '', (g) => ok(g.scene), bad));
}

const WELD = 0.005;  // mm: Draco quantizes each primitive on its own grid (about 0.001 mm on a 13 mm drop-in filter), so a vertex shared by two primitives moves a little

/** Boundary (one-triangle) and non-manifold edges of one part, positions welded within 5 microns (Draco splits vertices wherever
 * normals differ and quantizes each primitive on its own grid). A part with several materials loads as one mesh per
 * primitive, so its meshes are counted together. */
function openEdges(meshes: THREE.Mesh[]) {
  const cell = 0.1, reps: THREE.Vector3[] = [], grid = new Map<string, number[]>();
  const id = (v: THREE.Vector3) => {
    const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const r of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) if (reps[r].distanceTo(v) < WELD) return r;
    }
    reps.push(v.clone());
    const key = `${cx},${cy},${cz}`;
    grid.set(key, [...(grid.get(key) ?? []), reps.length - 1]);
    return reps.length - 1;
  };
  const edges = new Map<string, number>();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const p = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const k = [0, 1, 2].map((j) => id(v.fromBufferAttribute(p, idx ? idx.getX(i + j) : i + j)));
      if (new Set(k).size < 3) continue;
      for (let j = 0; j < 3; j++) {
        const a = k[j], b = k[(j + 1) % 3];
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(ek, (edges.get(ek) ?? 0) + 1);
      }
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  return { boundary, nonManifold };
}

/** Edges allowed beyond a closed solid, by lens and part. n500's cells touch each other along one corner at y 127.46 mm,
 * r 43.3 mm: four edges shared by more than two triangles where the two cells' corners meet, not a hole. */
const OPEN_BY_DESIGN: Record<string, number> = { 'n500:cells': 4 };

describe.each(Object.keys(lenses))('lens %s open edges (score loop r5)', (id) => {
  it('marks its flat printed parts as decals and leaves every solid part closed', async () => {
    const scene = await loadGlb(lenses[id].glb);
    const decals: string[] = [], open: string[] = [];
    const parts = new Map<string, THREE.Mesh[]>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // a multi-material part is a group of one mesh per primitive, named <part>_1, <part>_2 ...
      const part = m.parent && m.parent.type === 'Group' && m.name.startsWith(`${m.parent.name}_`) ? m.parent.name : m.name;
      if (m.userData.decal || m.parent?.userData.decal) { decals.push(part); return; }
      parts.set(part, [...(parts.get(part) ?? []), m]);
    });
    for (const [name, meshes] of parts) {
      const e = openEdges(meshes);
      if (e.boundary + e.nonManifold > (OPEN_BY_DESIGN[`${id}:${name}`] ?? 0)) open.push(`${name} (${e.boundary} open, ${e.nonManifold} non-manifold)`);
    }
    expect(decals, 'the spec text is a decal').toContain('specText');
    expect(decals.some((n) => n === 'frontEngraving')).toBe(true);
    expect(open).toEqual([]);
  });
});
