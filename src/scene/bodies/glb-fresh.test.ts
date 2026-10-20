// The shipped body GLBs match a fresh build of their Blender scripts (score loop r4, 10/11/2026). The bodies run by default where
// Blender is installed (a rebuild takes about 25 s a body; P2P_SKIP_REBUILD_CHECK=1 skips them); the lenses and phone variants are
// opt-in, P2P_REBUILD_CHECK=1 npx vitest run src/scene/bodies/glb-fresh.test.ts
// (or `node tools/check-glb-fresh.mjs`, which also takes lens:<id>). The signature function itself is always tested.
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { findBlender, firstDiff, geometryDiff, glbGeometry, glbSignature } from '../../../tools/check-glb-fresh.mjs';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '../../..');

describe('check-glb-fresh helpers', () => {
  it('firstDiff names the path of a changed label and ignores equal trees', () => {
    const a = { nodes: [{ name: 'a', extras: { label: 'Power switch (the collar around the shutter button)' } }] };
    const b = { nodes: [{ name: 'a', extras: { label: 'Power switch (the collar round the shutter button)' } }] };
    expect(firstDiff(a, a)).toBeNull();
    expect(firstDiff(a, b)).toBe('$.nodes.0.extras.label');
  });

  it('reads the signature of a shipped GLB', () => {
    const s = glbSignature(resolve(ROOT, 'public/models/dslr.glb'));
    expect(s.nodes.length).toBeGreaterThan(50);
    expect(s.materials.length).toBeGreaterThan(10);
  });
});

describe('check-glb-fresh geometry (score loop r5)', () => {
  type Mesh = { name: string; tris: number; min: number[]; max: number[] };
  const shipped: Mesh[] = glbGeometry(resolve(ROOT, 'public/models/lenses/n500fl.glb'));

  it('reads the triangle count of each mesh and bounding box from the shipped file', () => {
    const e4 = shipped.find((m: Mesh) => m.name === 'element04')!;
    expect(e4.tris).toBeGreaterThan(100);
    expect(e4.max[0]).toBeGreaterThan(30);
  });

  it('accepts the same geometry and names an element rim that is a few mm narrower (the stale n500fl)', () => {
    expect(geometryDiff(shipped, shipped)).toBeNull();
    const stale = shipped.map((m: Mesh) => (m.name === 'element04' ? { ...m, max: [m.max[0] - 3.7, m.max[1] - 3.7, m.max[2]], min: [m.min[0] + 3.7, m.min[1] + 3.7, m.min[2]] } : m));
    const d = geometryDiff(stale, shipped);
    expect(d).toContain('element04');
    expect(d).toContain('3.7');
  });

  it('allows the exporter rounding but not a different triangle count', () => {
    const nudged = shipped.map((m: Mesh) => ({ ...m, max: m.max.map((v: number) => v + 0.01) }));
    expect(geometryDiff(nudged, shipped)).toBeNull();
    const retri = shipped.map((m: Mesh, i: number) => (i === 3 ? { ...m, tris: m.tris + 2 } : m));
    expect(geometryDiff(retri, shipped)).toContain('triangles');
  });
});

// the two bodies are checked in the default run wherever Blender is installed (score loop r6, 10/11/2026: both shipped stale
// for two rounds because this was opt-in); P2P_SKIP_REBUILD_CHECK=1 leaves them out for a quick run
describe.skipIf(!findBlender() || !!process.env.P2P_SKIP_REBUILD_CHECK)('shipped bodies are fresh builds', () => {
  it.each(['dslr', 'mirrorless'])('%s.glb matches a rebuild of its script', (id) => {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'tools/check-glb-fresh.mjs'), id], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain(`fresh public/models/${id}.glb`);
    expect(r.status).toBe(0);
  }, 300_000);
});

describe.skipIf(!process.env.P2P_REBUILD_CHECK || !findBlender())('shipped phone variants are fresh builds', () => {
  it.each(['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'])('lenses/%s.lite.glb matches a rebuild with --lite', (id) => {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'tools/check-glb-fresh.mjs'), `lite:${id}`], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain(`fresh public/models/lenses/${id}.lite.glb`);
    expect(r.status).toBe(0);
  }, 300_000);
});

// the lenses too (names, materials and geometry; a few seconds each): P2P_REBUILD_CHECK=1
describe.skipIf(!process.env.P2P_REBUILD_CHECK || !findBlender())('shipped lenses are fresh builds', () => {
  it.each(['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'])('lenses/%s.glb matches a rebuild of its script', (id) => {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'tools/check-glb-fresh.mjs'), `lens:${id}`], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain(`fresh public/models/lenses/${id}.glb`);
    expect(r.status).toBe(0);
  }, 300_000);
});
