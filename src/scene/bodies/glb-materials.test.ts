// Export hygiene for every shipped GLB (score loop r4, 10/11/2026): each primitive names a material, only the
// open planes stay double-sided, and the telephotos stay under a triangle budget. Reads the JSON chunk, which glTF
// requires in the clear even when the geometry is Draco-compressed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

interface GMaterial { name?: string; doubleSided?: boolean }
interface GPrim { attributes: Record<string, number>; indices?: number; material?: number }
interface Gltf { materials?: GMaterial[]; meshes: { name?: string; primitives: GPrim[] }[]; accessors: { count: number }[] }

function readGltf(rel: string): Gltf {
  const b = readFileSync(resolve(ROOT, rel));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

const BODIES = ['public/models/dslr.glb', 'public/models/mirrorless.glb'];
const LENSES = ['m50', 'n50', 'n500', 'n500fl', 's35', 'z35', 'z800'].map((id) => `public/models/lenses/${id}.glb`);

// Materials that may stay double-sided: they are used on a plane or a decal, which has no inside. Everything else is
// a closed solid and is culled (blender/common.py set_backface_culling decides from the mesh itself).
const OPEN_PLANES = new Set(['MirrorSurface', 'PixelArray', 'engraving']);

describe.each([...BODIES, ...LENSES])('%s export hygiene (score loop r4)', (rel) => {
  const g = readGltf(rel);

  it('every primitive names a material (the loader gives a bare one the default white metal)', () => {
    const bare = g.meshes.flatMap((m) => m.primitives.filter((p) => p.material === undefined).map(() => m.name));
    expect(bare).toEqual([]);
  });

  it('only planes and decals are double-sided; closed solids are back-face culled', () => {
    const dbl = (g.materials ?? []).filter((m) => m.doubleSided).map((m) => m.name ?? '');
    expect(dbl.filter((n) => !OPEN_PLANES.has(n))).toEqual([]);
  });
});

describe.each(LENSES)('%s triangle budget (score loop r4)', (rel) => {
  it('stays under 260 thousand triangles, whole and cut-away halves together (329 thousand before)', () => {
    const g = readGltf(rel);
    let tris = 0;
    for (const m of g.meshes) for (const p of m.primitives) {
      tris += (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
    }
    expect(tris).toBeLessThan(260_000);
  });
});
