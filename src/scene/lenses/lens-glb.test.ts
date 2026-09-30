// Accuracy gate for the scripted-Blender lens models (blender/lens_v2.py -> public/models/lenses/<id>.glb). The
// files are Draco-compressed, which node cannot decode without a worker, so this reads what glTF requires every
// file to state in the clear: each accessor's min/max and each node's transform. That is enough to check the
// EXPORTED artifact against the published exterior and the engine's own prescription.
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import manifest from '../../../public/models/lenses.json';
import exteriors from '../../../data/hardware/lens-exteriors.json';

const ROOT = resolve(__dirname, '../../..');

interface GNode { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown> }
interface Gltf { nodes: GNode[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min?: number[]; max?: number[] }[]; scenes: { nodes: number[] }[] }

function readGltf(rel: string): Gltf {
  const b = readFileSync(resolve(ROOT, rel));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** Every named node's world bounding box (from accessor min/max through the node transforms) and world position. */
function boxes(g: Gltf) {
  const out = new Map<string, { box: THREE.Box3; pos: THREE.Vector3; extras: Record<string, unknown> }>();
  const walk = (i: number, parent: THREE.Matrix4) => {
    const n = g.nodes[i];
    const local = new THREE.Matrix4();
    if (n.matrix) local.fromArray(n.matrix);
    else local.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    const box = new THREE.Box3();
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh].primitives) {
        const a = g.accessors[p.attributes.POSITION];
        box.union(new THREE.Box3(new THREE.Vector3(...a.min!), new THREE.Vector3(...a.max!)).applyMatrix4(world));
      }
    }
    if (n.name) out.set(n.name, { box, pos: new THREE.Vector3().setFromMatrixPosition(world), extras: n.extras ?? {} });
    for (const c of n.children ?? []) walk(c, world);
  };
  for (const r of g.scenes[0].nodes) walk(r, new THREE.Matrix4());
  return out;
}

const lenses = (manifest as any).lenses as Record<string, any>;

describe.each(Object.keys(lenses))('lens %s (Blender export)', (id) => {
  const m = lenses[id];
  const g = readGltf(m.glb);
  const b = boxes(g);
  const optics = JSON.parse(readFileSync(resolve(ROOT, `blender/data/${id}-optics.json`), 'utf8'));

  it('is under 1.5 MB (the phone loads it over the tailnet)', () => {
    expect(statSync(resolve(ROOT, m.glb)).size).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('has the named parts, and a cutaway half for each revolved one', () => {
    for (const name of ['lens', 'mountFace', 'barrel', 'focusRing', 'lensMount', 'lensLugs', 'lensContacts', 'glass', 'irisBlades', 'cells']) {
      expect(b.has(name), `missing ${name}`).toBe(true);
    }
    for (const name of ['barrel', 'focusRing', 'lensMount', 'element01']) {
      expect(b.get(name)!.extras.cutaway).toBe('full');
      expect(b.get(name + 'Cut')?.extras.cutaway, `missing ${name}Cut`).toBe('half');
    }
  });

  it('seats its mount face exactly at the flange distance in front of the sensor', () => {
    expect(b.get('mountFace')!.pos.z).toBeCloseTo(-m.flangeMm, 2);
  });

  it('matches the published length (mount face to front) within 0.5% and diameter within 1%', () => {
    const box = b.get('barrel')!.box;
    const length = -box.min.z - m.flangeMm;
    expect(Math.abs(length - m.lengthMm) / m.lengthMm).toBeLessThan(0.005);
    const dia = box.max.x - box.min.x;
    expect(Math.abs(dia - m.diameterMm) / m.diameterMm).toBeLessThan(0.01);
    // the rings sit flush: no ring stands proud of the published diameter
    for (const ring of ['focusRing', 'controlRing']) {
      const r = b.get(ring);
      if (r) expect(r.box.max.x - r.box.min.x).toBeLessThanOrEqual(m.diameterMm + 0.05);
    }
  });

  it('carries every element of the prescription, each at the engine\'s own vertex positions', () => {
    const els = optics.elements.filter((e: any) => -e.zFrontWorld - m.flangeMm > -8);
    expect(els.length).toBe(m.elements);
    els.forEach((e: any, k: number) => {
      const name = `element${String(k + 1).padStart(2, '0')}`;
      const box = b.get(name)?.box;
      expect(box, `missing ${name}`).toBeTruthy();
      // both vertices lie within the element's own extent along the axis (0.05 mm: Draco quantization)
      for (const z of [e.zFrontWorld, e.zBackWorld]) {
        expect(z).toBeGreaterThanOrEqual(box!.min.z - 0.05);
        expect(z).toBeLessThanOrEqual(box!.max.z + 0.05);
      }
      // and inside the barrel
      expect(box!.max.x).toBeLessThan(m.diameterMm / 2);
    });
  });

  it('reports each element the barrel had to clip, and only those', () => {
    const barrelR = m.diameterMm / 2;
    for (const c of m.clipped) expect(c.sd).toBeGreaterThan(c.shown);
    const clippedIdx = new Set(m.clipped.map((c: any) => c.element));
    for (const e of optics.elements) {
      if (e.maxSd >= barrelR) expect(clippedIdx.has(e.index), `element ${e.index} (sd ${e.maxSd}) exceeds the barrel but is not reported`).toBe(true);
    }
  });
  it('carries the front-ring engraving (design review FID-18)', () => {
    expect(b.has('frontEngraving')).toBe(true);
    // on the front face, not floating in front of it
    expect(Math.abs(b.get('frontEngraving')!.box.min.z - (-m.flangeMm - m.lengthMm))).toBeLessThan(0.2);
  });

  it('a tripod foot, where there is one, reaches below the barrel so the lens rests on it (FID-11)', () => {
    const foot = b.get('tripodFoot');
    if (!foot) return;
    expect(foot.box.min.y).toBeLessThan(-m.diameterMm / 2);
  });

  it('the super-teles stand on their foot, its plate well clear of a fitted hood (R1-FID-G)', () => {
    const foot = b.get('tripodFoot');
    if (!['n500fl', 'z800'].includes(id)) return;
    expect(foot).toBeTruthy();
    // underside 16 mm below the 140 mm front barrel: a slip-on hood rides a few mm outside the barrel
    expect(foot!.box.min.y).toBeLessThan(-m.diameterMm / 2 - 12);
  });

  it('has a tripod collar exactly when lens-exteriors.json says the lens ships with one (R1-FID-H)', () => {
    const ext = (exteriors as any).lenses[id];
    expect(b.has('tripodCollar'), 'tripodCollar').toBe(!!ext.tripodCollar?.v);
    expect(b.has('tripodFoot'), 'tripodFoot').toBe(!!ext.tripodCollar?.v);
  });

  it('the super-telephotos carry four focus-function buttons ahead of the focus ring (FID-10)', () => {
    const fn = b.get('focusFnButtons');
    if (!['n500fl', 'z800'].includes(id)) { expect(fn).toBeFalsy(); return; }
    expect(fn).toBeTruthy();
    expect(fn!.box.min.z).toBeLessThan(b.get('focusRing')!.box.min.z);
  });
});
