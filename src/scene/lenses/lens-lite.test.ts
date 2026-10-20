// The phone variants of the lens models (score loop r5, 10/11/2026): blender/lens_v2.py --lite writes <id>.lite.glb beside
// each lens, with half the segments round the axis. Same parts, same names, same size, about 40% fewer triangles; the
// Models page loads them on a phone-width screen (src/app/models.ts lensFile). The files are Draco-compressed, so this reads
// each accessor's bounding box and index count, as lens-glb.test.ts does.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../../../public/models/lenses.json';
import { glbGeometry } from '../../../tools/check-glb-fresh.mjs';

const ROOT = resolve(__dirname, '../../..');
const lenses = (manifest as any).lenses as Record<string, any>;
type Mesh = { name: string; tris: number; min: number[]; max: number[] };

describe.each(Object.keys(lenses))('lens %s phone variant', (id) => {
  const m = lenses[id];

  it('is listed in the manifest and exists', () => {
    expect(m.glbLite).toBe(`public/models/lenses/${id}.lite.glb`);
    expect(existsSync(resolve(ROOT, m.glbLite))).toBe(true);
  });

  it('has the same parts and size as the full file, with at least 25% fewer triangles', () => {
    const full: Mesh[] = glbGeometry(resolve(ROOT, m.glb));
    const lite: Mesh[] = glbGeometry(resolve(ROOT, m.glbLite));
    expect(lite.map((p) => p.name)).toEqual(full.map((p) => p.name));
    const tris = (a: Mesh[]) => a.reduce((n, p) => n + p.tris, 0);
    expect(tris(lite)).toBeLessThan(tris(full) * 0.75);
    const barrel = (a: Mesh[]) => a.find((p) => p.name === 'barrel')!;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(barrel(lite).max[k] - barrel(full).max[k])).toBeLessThan(0.1);
      expect(Math.abs(barrel(lite).min[k] - barrel(full).min[k])).toBeLessThan(0.1);
    }
    // every glass element keeps its rim within the 40-sided polygon's reach (0.5 mm at the widest, r 67 mm)
    for (const p of full.filter((q) => /^element\d+$/.test(q.name))) {
      const l = lite.find((q) => q.name === p.name)!;
      expect(Math.abs(l.max[0] - p.max[0]), p.name).toBeLessThan(0.5);
    }
  });
});
