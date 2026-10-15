// Body fit and finish (score loop r6, 10/11/2026), the review's measurements as tests:
//  - the body's mount ring ends at the flange plane, so nothing of it runs into a mounted lens's rear plate (the review found
//    the lock pin and screw heads 0.06 to 0.75 mm proud of the face: 292 triangle pairs on the DSLR, 1,436 on the Z8);
//  - the DSLR's cutaway hump keeps to the prism (the review found 27 to 32 mm of air between the inner roof and the prism
//    housing at the rear and middle);
//  - no large triangle of either shell carries a corner normal far off its own face (the hump top's streaks);
//  - the parting line is dark (a gasket in the groove), and a part of its own, so the shell stays one mesh of one material.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { nodeDracoLoader } from './draco-node';
import manifest from '../../../public/models/lenses.json';
import bodiesFacts from '../../../public/models/bodies.json';

const ROOT = resolve(__dirname, '../../..');
const lenses = (manifest as any).lenses as Record<string, any>;

function loadGlb(rel: string): Promise<THREE.Group> {
  const buf = readFileSync(resolve(ROOT, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, bad) => new GLTFLoader().setDRACOLoader(nodeDracoLoader()).parse(ab, '', (g) => ok(g.scene), bad));
}

function named(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
}

function worldPoints(o: THREE.Object3D): THREE.Vector3[] {
  o.updateWorldMatrix(true, true);
  const out: THREE.Vector3[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  });
  return out;
}

describe.each([['dslr', 'n50'], ['mirrorless', 'm50']])('%s mount ring against the %s lens mount (score loop r6)', (bodyId, lensId) => {
  let body: THREE.Group, lens: THREE.Group;
  const flange = (bodiesFacts as any)[bodyId].mount.flangeMm as number;
  beforeAll(async () => {
    body = await loadGlb((bodiesFacts as any)[bodyId].glb);
    lens = await loadGlb(lenses[lensId].glb);
  });

  it('has nothing of the ring past the flange plane, so the lens seats on its face', () => {
    // app frame: the sensor at z = 0, the lens toward -z, the mount face at z = -flange
    const ring = worldPoints(named(body, 'mount')[0]);
    const front = Math.min(...ring.map((p) => p.z));
    expect(front, `the ring reaches z ${front.toFixed(3)} against the face at ${-flange}`).toBeGreaterThanOrEqual(-flange - 0.005);
    // the face itself is on the plane: the ring is a flat polished annulus whose front IS the mount face
    expect(front).toBeLessThanOrEqual(-flange + 0.005);
  });

  it('shares no volume with the lens mount plate: no lens vertex lies inside the ring, no ring vertex inside the plate', () => {
    const ring = worldPoints(named(body, 'mount')[0]);
    const rr = ring.map((p) => Math.hypot(p.x, p.y));
    const rIn = Math.min(...rr), rOut = Math.max(...rr);
    const zBack = Math.max(...ring.map((p) => p.z));              // the ring's rear face
    const plate = worldPoints(named(lens, 'lensMount')[0]);
    const inside = plate.filter((p) => { const r = Math.hypot(p.x, p.y); return r > rIn + 0.01 && r < rOut - 0.01 && p.z > -flange + 0.005 && p.z < zBack - 0.005; });
    expect(inside.length, `${inside.length} lens-mount vertices inside the ring slab (r ${rIn.toFixed(1)}-${rOut.toFixed(1)}, z ${(-flange).toFixed(2)} to ${zBack.toFixed(2)})`).toBe(0);
    const plateFront = Math.max(...plate.filter((p) => { const r = Math.hypot(p.x, p.y); return r > rIn && r < rOut; }).map((p) => p.z));
    expect(plateFront, 'the lens plate starts at the flange plane').toBeLessThanOrEqual(-flange + 0.005);
  });
});

describe('dslr cutaway hump keeps to the prism (score loop r6)', () => {
  let body: THREE.Group;
  beforeAll(async () => { body = await loadGlb((bodiesFacts as any).dslr.glb); });

  /** The inner roof of the cut shell and the top of the prism housing along a vertical ray at app (x, z): blender y = -z. */
  function roofGap(x: number, yBlender: number) {
    const cut = named(body, 'shellCut')[0];
    const ph = named(body, 'prismHousing')[0];
    cut.updateWorldMatrix(true, true); ph.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 140, -yBlender), new THREE.Vector3(0, -1, 0), 0, 300);
    const side = (o: THREE.Object3D) => { o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).side = THREE.DoubleSide; }); };
    side(cut); side(ph);
    const hits = ray.intersectObject(cut, true).map((h) => h.point.y).sort((a, b) => b - a);
    const prism = ray.intersectObject(ph, true).map((h) => h.point.y).sort((a, b) => b - a);
    // hits[0] is the outer roof, hits[1] the roof of the hollow (the pocket's ceiling)
    return { outer: hits[0], inner: hits[1], prismTop: prism[0] };
  }

  it.each([14, 24, 34])('at y = %d mm the inner roof is within 8 mm of the prism housing (it was 27 to 32 mm at the rear and middle)', (y) => {
    const g = roofGap(8, y);
    expect(g.prismTop, 'the ray finds the prism housing').toBeTruthy();
    expect(g.inner, 'the ray finds the cavity roof').toBeTruthy();
    expect(g.inner - g.prismTop, `inner roof ${g.inner.toFixed(1)}, prism housing top ${g.prismTop.toFixed(1)}`).toBeLessThanOrEqual(8);
    expect(g.inner - g.prismTop).toBeGreaterThanOrEqual(0.5);        // and it still clears the housing
  });

  it('the hump keeps a wall of at least 2.4 mm over the pocket', () => {
    for (const y of [14, 24, 34]) {
      const g = roofGap(8, y);
      expect(g.outer - g.inner, `outer ${g.outer.toFixed(1)} inner ${g.inner.toFixed(1)}`).toBeGreaterThanOrEqual(2.4);
    }
  });
});

describe.each(['dslr', 'mirrorless'])('%s shells shade smoothly (score loop r6)', (bodyId) => {
  let body: THREE.Group;
  beforeAll(async () => { body = await loadGlb((bodiesFacts as any)[bodyId].glb); });

  it.each(['shellClosed', 'shellCut'])('%s: no triangle over 40 mm2 has a corner normal more than 20 degrees off its face', (name) => {
    const bad: string[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cn = new THREE.Vector3();
    for (const node of named(body, name)) {
      node.updateWorldMatrix(true, true);
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const p = m.geometry.attributes.position, nrm = m.geometry.attributes.normal, idx = m.geometry.index;
        const count = (idx ? idx.count : p.count) / 3;
        for (let t = 0; t < count; t++) {
          const ii = [0, 1, 2].map((j) => (idx ? idx.getX(3 * t + j) : 3 * t + j));
          a.fromBufferAttribute(p, ii[0]); b.fromBufferAttribute(p, ii[1]); c.fromBufferAttribute(p, ii[2]);
          n.subVectors(b, a).cross(c.clone().sub(a));
          const area = n.length() / 2;
          if (area <= 40) continue;
          n.normalize();
          for (const i of ii) {
            cn.fromBufferAttribute(nrm, i).normalize();
            const dev = THREE.MathUtils.radToDeg(cn.angleTo(n));
            if (dev > 20) bad.push(`${area.toFixed(0)} mm2 at (${a.x.toFixed(1)}, ${a.y.toFixed(1)}, ${a.z.toFixed(1)}), ${dev.toFixed(0)} deg`);
          }
        }
      });
    }
    expect(bad.length, bad.slice(0, 8).join('; ')).toBe(0);
  });
});

describe.each(['dslr', 'mirrorless'])('%s parting line (score loop r6)', (bodyId) => {
  let body: THREE.Group;
  beforeAll(async () => { body = await loadGlb((bodiesFacts as any)[bodyId].glb); });

  it('is dark: a flat near-black gasket in the groove, whole for the closed shell and cut in half for the cutaway', () => {
    const whole = named(body, 'seamGasket')[0] as THREE.Mesh, half = named(body, 'seamGasketCut')[0] as THREE.Mesh;
    expect(whole?.userData.cutaway).toBe('full');
    expect(half?.userData.cutaway).toBe('half');
    for (const g of [whole, half]) {
      const mat = (Array.isArray(g.material) ? g.material[0] : g.material) as THREE.MeshStandardMaterial;
      expect(mat.name).toBe('seamShadow');
      const lum = 0.2126 * mat.color.r + 0.7152 * mat.color.g + 0.0722 * mat.color.b;
      expect(lum).toBeLessThan(0.01);
    }
    // the half lies on the cut shell's side only
    const xs = worldPoints(half).map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.1);
  });

  it('leaves each shell one mesh of one material (the app picks, highlights and cuts the shell as one)', () => {
    for (const name of ['shellClosed', 'shellCut']) {
      const node = named(body, name)[0];
      const mats = new Set<string>();
      let meshes = 0;
      node.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm.name); } });
      expect(meshes, name).toBe(1);
      expect(mats.size, `${name}: ${[...mats]}`).toBe(1);
    }
  });
});

describe.each(['dslr', 'mirrorless'])('%s part labels need no runtime fix (score loop r6)', (bodyId) => {
  it('the filter stack is labeled as exported: IR cut and cover glass, no low-pass filter (neither body has one)', async () => {
    const body = await loadGlb((bodiesFacts as any)[bodyId].glb);
    expect(named(body, 'filterStack')[0]?.userData.label).toBe('Filter stack (IR cut, cover glass)');
    let all = '';
    body.traverse((o) => { if (typeof o.userData?.label === 'string') all += `${o.userData.label}\n`; });
    expect(all).not.toMatch(/low-pass/i);
  });
});
