// Body-by-lens clearance (score loop r5, 10/11/2026): a lens fitted to its body must not run into the body's grip.
// Review found the z800's rear collar (r 44 mm) 0.4 mm into the Z8's grip inner flank (x 43.6 to 44.1, 52 triangle
// pairs). Both files are decoded the way the app loads them and sit in one frame (the sensor at z = 0, the lens
// toward -z), so no placement is needed: every point sampled over the grip's triangles must lie outside the lens's
// outer radius at the same axial position.
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

const BIN = 0.5;
/** The lens's outer radius about the axis (z), in 0.5 mm bins along it: the largest radius of any whole (not cut-half) part. */
function outerRadius(lens: THREE.Object3D): Map<number, number> {
  const bins = new Map<number, number>();
  const v = new THREE.Vector3();
  lens.updateMatrixWorld(true);
  lens.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.cutaway === 'half' || m.name === 'floor') return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const k = Math.round(v.z / BIN);
      bins.set(k, Math.max(bins.get(k) ?? 0, Math.hypot(v.x, v.y)));
    }
  });
  return bins;
}

/** How far into the lens the grip reaches: the worst (outer radius - grip radius) over points sampled on every triangle. */
function worstPenetration(grip: THREE.Object3D, radius: Map<number, number>, step = 6) {
  let worst = { mm: -Infinity, at: '' };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  grip.updateMatrixWorld(true);
  grip.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : p.count;
    for (let t = 0; t < n; t += 3) {
      a.fromBufferAttribute(p, idx ? idx.getX(t) : t).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(p, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(p, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
      for (let i = 0; i <= step; i++) {
        for (let j = 0; j <= step - i; j++) {
          const u = i / step, w = j / step;
          q.copy(a).multiplyScalar(1 - u - w).addScaledVector(b, u).addScaledVector(c, w);
          const r = radius.get(Math.round(q.z / BIN));
          if (r === undefined) continue;
          const pen = r - Math.hypot(q.x, q.y);
          if (pen > worst.mm) worst = { mm: pen, at: `z ${q.z.toFixed(1)}, x ${q.x.toFixed(1)}, y ${q.y.toFixed(1)}` };
        }
      }
    }
  });
  return worst;
}

describe.each(['dslr', 'mirrorless'])('%s grip against every lens that mounts on it (score loop r5)', (bodyId) => {
  let body: THREE.Group;
  beforeAll(async () => { body = await loadGlb((bodiesFacts as any)[bodyId].glb); });
  const ids = Object.keys(lenses).filter((id) => lenses[id].body === bodyId);

  it.each(ids)('%s clears the grip by at least 0.05 mm', async (id) => {
    const lens = await loadGlb(lenses[id].glb);
    let grip: THREE.Object3D | undefined;
    body.traverse((o) => { if (o.name === 'grip') grip = o; });
    expect(grip).toBeTruthy();
    const w = worstPenetration(grip!, outerRadius(lens));
    expect(-w.mm, `the grip reaches ${w.mm.toFixed(3)} mm into ${id} at ${w.at}`).toBeGreaterThanOrEqual(0.05);
  }, 60_000);
});
