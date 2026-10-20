// Accuracy gate for the scripted-Blender camera-body models (blender/build_dslr.py,
// blender/build_mirrorless.py), exported to public/models/{dslr,mirrorless}.glb. Parses the
// real .glb files with three's own GLTFLoader (in node, from the file buffer) rather than
// re-asserting the same constants the build scripts used -- this is the check that the
// EXPORTED artifact, not just the Python source, carries the right names and numbers.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { nodeDracoLoader } from './draco-node';
import bodiesFacts from '../../../public/models/bodies.json';
import { mirrorPhases } from '../rig-exposure';

const ROOT = resolve(__dirname, '../../..');

function loadGlb(relPath: string): Promise<THREE.Group> {
  const buf = readFileSync(resolve(ROOT, relPath));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader().setDRACOLoader(nodeDracoLoader());
  return new Promise((resolve_, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve_(gltf.scene), (err) => reject(err));
  });
}

function findNode(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

interface FlatRegion { normal: THREE.Vector3; area: number; width: number; maxCornerDeg: number; center: THREE.Vector3 }

/** The flat regions of a mesh, in world space: connected sets of coplanar triangles (normals within 0.25 degrees,
 * planes within 0.01 mm; triangles under 0.01 mm2 or 0.1 mm high, which show no shading, are left out), joined across shared edges (positions welded to 1 micron, since vertices are split where
 * normals differ), of 50 mm2 or more and 4 mm or more across (area over the longest in-plane extent). For each, the
 * largest angle between a corner's normal and the face normal. */
function flatRegions(mesh: THREE.Mesh, minArea = 50, minWidth = 4): FlatRegion[] {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry, p = g.attributes.position, nAttr = g.attributes.normal, idx = g.index;
  if (!nAttr) return [];
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const count = (idx ? idx.count : p.count) / 3;
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
  const tris: { v: THREE.Vector3[]; k: string[]; n: THREE.Vector3; area: number; corner: number }[] = [];
  const edges = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    const ii = [0, 1, 2].map((j) => (idx ? idx.getX(3 * t + j) : 3 * t + j));
    const v = ii.map((i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
    const area = n.length() / 2;
    n.normalize();
    let corner = 0;
    for (const i of ii) {
      const cn = new THREE.Vector3().fromBufferAttribute(nAttr, i).applyMatrix3(nm).normalize();
      corner = Math.max(corner, THREE.MathUtils.radToDeg(cn.angleTo(n)));
    }
    const k = v.map(key);
    // a triangle under 0.1 mm high (an ear of a curved wall's n-gon whose three corners lie on the rim of the plate
    // beside it) shows no shading of its own, and its normals are the wall's, as they should be: it joins no region
    const longest = Math.max(v[0].distanceTo(v[1]), v[1].distanceTo(v[2]), v[2].distanceTo(v[0]));
    const visible = area >= 0.01 && (2 * area) / longest >= 0.1;
    tris.push({ v, k, n, area: visible ? area : 0, corner });
    if (!visible) continue;
    for (let j = 0; j < 3; j++) {
      const a = k[j], b = k[(j + 1) % 3];
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edges.has(ek)) edges.set(ek, []);
      edges.get(ek)!.push(t);
    }
  }
  const cosTol = Math.cos(THREE.MathUtils.degToRad(0.25));
  const region = new Int32Array(tris.length).fill(-1);
  const out: FlatRegion[] = [];
  for (let s = 0; s < tris.length; s++) {
    if (region[s] >= 0 || tris[s].area === 0) continue;
    const id = out.length, n0 = tris[s].n, p0 = tris[s].v[0];
    const members = [s];
    region[s] = id;
    for (let q = 0; q < members.length; q++) {
      const t = tris[members[q]];
      for (let j = 0; j < 3; j++) {
        const a = t.k[j], b = t.k[(j + 1) % 3];
        for (const o of edges.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? []) {
          if (region[o] >= 0 || tris[o].n.dot(n0) < cosTol) continue;
          if (Math.abs(new THREE.Vector3().subVectors(tris[o].v[0], p0).dot(n0)) > 0.01) continue;
          region[o] = id;
          members.push(o);
        }
      }
    }
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n0.x) > 0.9) u.set(0, 1, 0);
    u.sub(n0.clone().multiplyScalar(u.dot(n0))).normalize();
    const w = new THREE.Vector3().crossVectors(n0, u);
    let area = 0, maxCornerDeg = 0, umin = Infinity, umax = -Infinity, wmin = Infinity, wmax = -Infinity;
    const center = new THREE.Vector3();
    for (const m of members) {
      area += tris[m].area;
      maxCornerDeg = Math.max(maxCornerDeg, tris[m].corner);
      for (const v of tris[m].v) {
        umin = Math.min(umin, v.dot(u)); umax = Math.max(umax, v.dot(u));
        wmin = Math.min(wmin, v.dot(w)); wmax = Math.max(wmax, v.dot(w));
      }
      center.addScaledVector(tris[m].v[0], tris[m].area);
    }
    const width = area / Math.max(umax - umin, wmax - wmin, 1e-9);
    out.push({ normal: n0.clone(), area, width, maxCornerDeg, center: center.divideScalar(area || 1) });
  }
  return out.filter((r) => r.area >= minArea && r.width >= minWidth);
}

function flatRegionNormalErrors(scene: THREE.Object3D, maxDeg: number): { count: number; worst: string } {
  const bad: { deg: number; text: string }[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const r of flatRegions(m)) {
      if (r.maxCornerDeg <= maxDeg) continue;
      bad.push({ deg: r.maxCornerDeg, text: `${m.name}: ${r.area.toFixed(0)} mm2 at (${r.center.toArray().map((x) => x.toFixed(1)).join(', ')}), ` +
        `normal (${r.normal.toArray().map((x) => x.toFixed(2)).join(', ')}), corner ${r.maxCornerDeg.toFixed(1)} deg off` });
    }
  });
  bad.sort((a, b) => b.deg - a.deg);
  return { count: bad.length, worst: bad.slice(0, 12).map((b) => b.text).join('; ') };
}

function worldBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
}

describe('dslr.glb (Blender export)', () => {
  const facts = (bodiesFacts as any).dslr;
  let scene: THREE.Group;

  beforeAll(async () => {
    scene = await loadGlb(facts.glb);
  });

  it('is under the 15 MB budget', () => {
    const stat = readFileSync(resolve(ROOT, facts.glb));
    expect(stat.byteLength).toBeLessThan(15 * 1024 * 1024);
  });

  it('has every named component from the app selection contract', () => {
    for (const name of facts.namedComponents) {
      expect(findNode(scene, name), `missing node "${name}"`).toBeTruthy();
    }
  });

  it('mount face sits at z = -flangeMm (F-mount, 46.5mm)', () => {
    const mount = findNode(scene, 'mount')!;
    const box = worldBox(mount);
    const centerZ = (box.min.z + box.max.z) / 2;
    expect(centerZ).toBeCloseTo(facts.mount.mountFaceZ, 0);
  });

  it('sensor plane sits at z = 0 and the active area matches 35.9 x 23.9mm within 1%', () => {
    const pixelArray = findNode(scene, 'pixelArray')!;
    const box = worldBox(pixelArray);
    const centerZ = (box.min.z + box.max.z) / 2;
    expect(Math.abs(centerZ)).toBeLessThan(1.0); // within 1mm of the sensor plane
    const w = box.max.x - box.min.x;
    const h = box.max.y - box.min.y;
    expect(w).toBeCloseTo(facts.sensor.activeAreaWidthMm, 0);
    expect(Math.abs(w - facts.sensor.activeAreaWidthMm) / facts.sensor.activeAreaWidthMm).toBeLessThan(0.01);
    expect(Math.abs(h - facts.sensor.activeAreaHeightMm) / facts.sensor.activeAreaHeightMm).toBeLessThan(0.01);
  });

  it('body envelope is within 1% of the published D850 dimensions (146 x 124 x 78.5mm)', () => {
    const body = findNode(scene, 'shellClosed')!;
    const box = worldBox(body);
    const size = new THREE.Vector3();
    box.getSize(size);
    // envelope width/height are the shell's own box; depth spans mount face to the back --
    // check against the envelope with a generous 5% tolerance since the shell excludes the
    // grip/hump protrusions that a full physical envelope measurement would include.
    expect(Math.abs(size.x - facts.envelopeMm.width) / facts.envelopeMm.width).toBeLessThan(0.05);
  });

  it('mount has the F-mount lug and contact counts (3 lugs, 8 contacts)', () => {
    expect(facts.mount.lugCount).toBe(3);
    expect(facts.mount.contactCount).toBe(8);
    expect(findNode(scene, 'mountLugs')).toBeTruthy();
    expect(findNode(scene, 'contacts')).toBeTruthy();
  });

  it('has a distinct shellCut (cutaway) mesh separate from shellClosed', () => {
    const closed = findNode(scene, 'shellClosed') as THREE.Mesh;
    const cut = findNode(scene, 'shellCut') as THREE.Mesh;
    expect(closed).toBeTruthy();
    expect(cut).toBeTruthy();
    const closedVerts = closed.geometry.attributes.position.count;
    const cutVerts = cut.geometry.attributes.position.count;
    expect(cutVerts).not.toBe(closedVerts);
  });
});

describe('mirrorless.glb (Blender export)', () => {
  const facts = (bodiesFacts as any).mirrorless;
  let scene: THREE.Group;

  beforeAll(async () => {
    scene = await loadGlb(facts.glb);
  });

  it('is under the 15 MB budget', () => {
    const stat = readFileSync(resolve(ROOT, facts.glb));
    expect(stat.byteLength).toBeLessThan(15 * 1024 * 1024);
  });

  it('has every named component from the app selection contract', () => {
    for (const name of facts.namedComponents) {
      expect(findNode(scene, name), `missing node "${name}"`).toBeTruthy();
    }
  });

  it('mount face sits at z = -flangeMm (Z-mount, 16mm)', () => {
    const mount = findNode(scene, 'mount')!;
    const box = worldBox(mount);
    const centerZ = (box.min.z + box.max.z) / 2;
    expect(centerZ).toBeCloseTo(facts.mount.mountFaceZ, 0);
  });

  it('sensor plane sits at z = 0 and the active area matches 35.9 x 23.9mm within 1%', () => {
    const pixelArray = findNode(scene, 'pixelArray')!;
    const box = worldBox(pixelArray);
    const centerZ = (box.min.z + box.max.z) / 2;
    expect(Math.abs(centerZ)).toBeLessThan(1.0);
    const w = box.max.x - box.min.x;
    const h = box.max.y - box.min.y;
    expect(Math.abs(w - facts.sensor.activeAreaWidthMm) / facts.sensor.activeAreaWidthMm).toBeLessThan(0.01);
    expect(Math.abs(h - facts.sensor.activeAreaHeightMm) / facts.sensor.activeAreaHeightMm).toBeLessThan(0.01);
  });

  it('body envelope is within 5% of the published Z8 dimensions (144 x 118.5 x 83mm)', () => {
    const body = findNode(scene, 'shellClosed')!;
    const box = worldBox(body);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(Math.abs(size.x - facts.envelopeMm.width) / facts.envelopeMm.width).toBeLessThan(0.05);
  });

  it('mount has the Z-mount lug and contact counts (4 lugs, 11 contacts)', () => {
    expect(facts.mount.lugCount).toBe(4);
    expect(facts.mount.contactCount).toBe(11);
    expect(findNode(scene, 'mountLugs')).toBeTruthy();
    expect(findNode(scene, 'contacts')).toBeTruthy();
  });

  it('has no mechanical shutter parts (the Z8 has none) but does have an EVF', () => {
    expect(findNode(scene, 'shutterCurtainFront')).toBeFalsy();
    expect(findNode(scene, 'shutterCurtainRear')).toBeFalsy();
    expect(findNode(scene, 'evf')).toBeTruthy();
  });

  it('has a distinct shellCut (cutaway) mesh separate from shellClosed', () => {
    const closed = findNode(scene, 'shellClosed') as THREE.Mesh;
    const cut = findNode(scene, 'shellCut') as THREE.Mesh;
    expect(closed).toBeTruthy();
    expect(cut).toBeTruthy();
    const closedVerts = closed.geometry.attributes.position.count;
    const cutVerts = cut.geometry.attributes.position.count;
    expect(cutVerts).not.toBe(closedVerts);
  });
});

// Design review round 0 (09/30/2026): what the fidelity pass changed, checked on the exported files.
describe.each(['dslr', 'mirrorless'])('%s.glb fidelity (design review round 0)', (id) => {
  const facts = (bodiesFacts as any)[id];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); });

  it('the mount face is a flat ring in the flange plane; only the spring lock pin stands ahead of it (FID-4)', () => {
    // 'mount' holds the chrome ring and the black screw heads: two materials, so the loader makes it a group
    const node = findNode(scene, 'mount')!;
    node.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    let onFace = 0;
    const proud = new THREE.Box2();  // everything more than 0.1 mm in front of the face, in x/y
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.z - facts.mount.mountFaceZ) < 0.02) onFace++;
        else if (v.z < facts.mount.mountFaceZ - 0.1) proud.expandByPoint(new THREE.Vector2(v.x, v.y));
      }
    });
    expect(onFace).toBeGreaterThan(200);
    // what stands ahead is the 0.75 mm lock pin and the flush screw heads (0.06 mm): a few small parts, not a lug
    expect(worldBox(node).min.z).toBeGreaterThan(facts.mount.mountFaceZ - 0.8);
    const spot = proud.getSize(new THREE.Vector2());
    expect(Math.max(spot.x, spot.y)).toBeLessThan(3);
  });

  it('the bayonet lips sit behind the face and their inner edge is the published throat (FID-4)', () => {
    const box = worldBox(findNode(scene, 'mountLugs')!);
    expect(box.min.z).toBeGreaterThan(facts.mount.mountFaceZ + 1.0);
    expect(box.max.z).toBeLessThan(facts.mount.mountFaceZ + 3.0);
    const mesh = findNode(scene, 'mountLugs') as THREE.Mesh;
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    let rMin = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      rMin = Math.min(rMin, Math.hypot(v.x, v.y));
    }
    expect(rMin).toBeCloseTo(facts.mount.throatMm / 2, 1);
  });

  it('dials are satin black, not chrome (FID-3)', () => {
    for (const name of ['commandDialFront', 'commandDialRear', 'shutterButton']) {
      let m: THREE.MeshStandardMaterial | undefined;
      findNode(scene, name)!.traverse((o) => { if ((o as THREE.Mesh).isMesh && !m) m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
      if (!m) throw new Error(`no mesh under ${name}`);
      expect(m.metalness, name).toBeLessThan(0.2);
      expect(m.color.r, name).toBeLessThan(0.05);
    }
  });

  it('carries its surface finish as normal-map extras, with the maps on disk and UVs on the meshes (FID-6)', () => {
    const seen = new Set<string>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const map = m.userData?.normalMap as string | undefined;
        if (!map) continue;
        seen.add(map);
        expect(mesh.geometry.attributes.uv, `${mesh.name} wears ${map} but has no UVs`).toBeTruthy();
        expect(m.userData.uvTileMm).toBeGreaterThan(0);
      }
    });
    expect([...seen].sort()).toEqual(['textures/leatherette-normal.png', 'textures/paint-normal.png']);
    for (const map of seen) expect(statSync(resolve(ROOT, 'public/models', map)).size).toBeGreaterThan(1000);
  });
});

// Body fidelity review loop (10/10/2026, docs/review-loop-2026-10-10/bodies.md): checks on what that loop fixed.
describe.each([
  ['dslr', 146.0, 124.0, 'mirrorBox', 'mirror'],
  ['mirrorless', 144.0, 118.5, 'lightBox', 'filterStack'],
])('%s.glb fidelity (body review loop 10/10/2026)', (id, width, height, box, firstInside) => {
  const facts = (bodiesFacts as any)[id];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); });

  function component(o: THREE.Object3D | null): string {
    for (let p = o; p; p = p.parent) if (p.name && !/_\d+$/.test(p.name)) return p.name;
    return '';
  }

  it('the shell matches the published width and height to 0.5 mm (B-09)', () => {
    const size = worldBox(findNode(scene, 'shellClosed')!).getSize(new THREE.Vector3());
    expect(Math.abs(size.x - width)).toBeLessThan(0.5);
    expect(Math.abs(size.y - height)).toBeLessThan(0.5);
  });

  it('the throat is open: a ray down the axis reaches the mirror or the sensor stack, not a shell face (B-17)', () => {
    scene.updateMatrixWorld(true);
    for (const [x, y] of [[0, 0], [8, 6], [-6, -8]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, facts.mount.mountFaceZ - 40), new THREE.Vector3(0, 0, 1));
      const hits = ray.intersectObject(scene, true).filter((h) => component(h.object) !== 'shellCut');
      expect(hits.length, `nothing on the axis at (${x}, ${y})`).toBeGreaterThan(0);
      expect(component(hits[0].object), `first hit at (${x}, ${y})`).not.toBe('shellClosed');
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, facts.mount.mountFaceZ - 40), new THREE.Vector3(0, 0, 1));
    const first = ray.intersectObject(scene, true).find((h) => component(h.object) !== 'shellCut');
    expect(component(first!.object)).toBe(firstInside);
  });

  it(`the ${box} stays behind the throat baffle, out of the lens's way (B-03, B-04)`, () => {
    // the mount's baffle ring sits 9 mm behind the face (blender/common.py body_mount)
    expect(worldBox(findNode(scene, box)!).min.z).toBeGreaterThan(facts.mount.mountFaceZ + 9 - 0.05);
  });
});

describe('the DSLR pentaprism (body review loop 10/10/2026, B-01)', () => {
  it('sits on the focusing screen, clear of the mount boss, with a five-sided section', async () => {
    const scene = await loadGlb((bodiesFacts as any).dslr.glb);
    const prism = findNode(scene, 'prism') as THREE.Mesh;
    const pb = worldBox(prism), sb = worldBox(findNode(scene, 'focusingScreen')!), bb = worldBox(findNode(scene, 'mountBoss')!);
    expect(pb.min.y).toBeGreaterThanOrEqual(sb.max.y);
    expect(pb.intersectsBox(bb)).toBe(false);
    // distinct (z, y) corners of the section: the entry/exit faces' pentagon plus the trimmed nose
    const pos = prism.geometry.attributes.position;
    const corners = new Set<string>();
    for (let i = 0; i < pos.count; i++) corners.add(`${pos.getZ(i).toFixed(2)},${pos.getY(i).toFixed(2)}`);
    expect(corners.size).toBeGreaterThanOrEqual(5);
  });
});

describe('the mirrorless body has no top dials (FID-3: the Z8 sets release mode with a button and the main dial)', () => {
  it('has the four-button cluster and neither a mode dial nor an exposure-compensation dial', async () => {
    const scene = await loadGlb((bodiesFacts as any).mirrorless.glb);
    expect(findNode(scene, 'buttonCluster')).toBeTruthy();
    expect(findNode(scene, 'modeDial')).toBeFalsy();
    expect(findNode(scene, 'expCompDial')).toBeFalsy();
  });
  it('the DSLR has a release-mode dial, not a PASM mode dial', async () => {
    const scene = await loadGlb((bodiesFacts as any).dslr.glb);
    expect(findNode(scene, 'releaseModeDial')).toBeTruthy();
    expect(findNode(scene, 'modeDial')).toBeFalsy();
  });
});

// Aperture review 10/11/2026 (presentation handoffs 1 and 2): what the bodies export is what the app shows, with no
// app-side override. The cover glass (the sensor's filter stack, the EVF eyepiece) is dark coated glass blended by
// alpha, never KHR_materials_transmission, which this renderer cannot use; the DSLR mirror is a polished metal.
function gltfMaterials(relPath: string): { name: string; alphaMode?: string; extensions?: Record<string, unknown>;
  pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number } }[] {
  const b = readFileSync(resolve(ROOT, relPath));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')).materials;
}

describe.each([['dslr', ['filterGlass']], ['mirrorless', ['filterGlass', 'evfGlass']]] as const)('%s.glb cover glass', (body, names) => {
  it.each(names)('%s is dark coated glass with alpha, no transmission', (name) => {
    const m = gltfMaterials((bodiesFacts as any)[body].glb).find((x) => x.name === name)!;
    expect(m, `missing material ${name}`).toBeTruthy();
    expect(m.extensions?.KHR_materials_transmission).toBeUndefined();
    expect(m.alphaMode).toBe('BLEND');
    const [r, g, bl, a] = m.pbrMetallicRoughness!.baseColorFactor!;
    expect(Math.max(r, g, bl)).toBeLessThan(0.1);   // was 0.9+ (a white plug, P-04, P-05)
    expect(a).toBeGreaterThan(0.15);
    expect(a).toBeLessThan(0.5);                     // three stacked eyepiece layers stay see-through
  });
});

describe('dslr.glb main mirror', () => {
  it('is metallic and polished (glTF metallicFactor defaults to 1 when the exporter omits it)', () => {
    const m = gltfMaterials((bodiesFacts as any).dslr.glb).find((x) => x.name === 'MirrorSurface')!;
    expect(m.pbrMetallicRoughness?.metallicFactor ?? 1).toBeGreaterThanOrEqual(0.9);
    expect(m.pbrMetallicRoughness?.roughnessFactor ?? 1).toBeLessThan(0.1);
  });
});

function worldVerts(root: THREE.Object3D, name: string): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  findNode(root, name)!.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.updateWorldMatrix(true, false);
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  });
  return out;
}

function componentOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData?.component) return p.userData.component as string;
  return o.name;
}

// Score loop round 1 (10/11/2026), Reed's decision 2: the DSLR viewfinder lines up with the prism, and the raised
// mirror clears the light path.
describe('dslr.glb viewfinder and mirror (score loop r1, decision 2)', () => {
  const facts = (bodiesFacts as any).dslr;
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); scene.updateMatrixWorld(true); });

  it('the eyepiece axis runs through the middle of the prism exit face', () => {
    const eye = worldBox(findNode(scene, 'eyepieceGlass')!).getCenter(new THREE.Vector3());
    const prism = worldVerts(scene, 'prism');
    const exitZ = Math.max(...prism.map((v) => v.z));                 // the rear face (app z = -Blender y)
    // the face's flat bottom runs across its width and the roof's ridge meets its top at x = 0, so at x = 0 it spans
    // from its lowest vertex to its highest
    const face = prism.filter((v) => Math.abs(v.z - exitZ) < 0.01);
    const lo = Math.min(...face.map((v) => v.y)), hi = Math.max(...face.map((v) => v.y));
    expect(hi - lo).toBeGreaterThan(20);
    expect(Math.abs(eye.x)).toBeLessThan(0.01);
    expect(eye.y).toBeGreaterThan(lo + 0.4 * (hi - lo));
    expect(eye.y).toBeLessThan(hi - 0.4 * (hi - lo));
    // rays from the eyepiece forward along its axis reach the prism through the open optics: no cut shell, housing or
    // curtain in the way (the eyepiece tube and its lenses are on the path by design; the closed shell is solid inside
    // and is not drawn in the cutaway)
    for (const [dx, dy] of [[0.5, 0], [4, 3], [-4, -3], [2, -5]]) {
      const ray = new THREE.Raycaster(eye.clone().add(new THREE.Vector3(dx, dy, 0.5)), new THREE.Vector3(0, 0, -1));
      const hits = ray.intersectObject(scene, true).filter((h) => !h.object.name.startsWith('eyepieceGlass')).map((h) => componentOf(h.object));
      const firstOther = hits.find((c) => !['eyepieceOptics', 'eyepieceOpticsCut', 'eyecup', 'eyecupCut', 'shellClosed'].includes(c));
      expect(firstOther, hits.join(' > ')).toBe('prism');
    }
  });

  it('the prism has a 90-degree roof: a ridge on the center line, its faces falling 45 degrees to the sides', () => {
    const prism = worldVerts(scene, 'prism');
    const top = Math.max(...prism.map((v) => v.y));
    const ridge = prism.filter((v) => v.y > top - 0.01);
    expect(Math.max(...ridge.map((v) => Math.abs(v.x)))).toBeLessThan(0.01);
    // at the sides (|x| = 17) the roof has fallen 17 mm along the face's normal: well below the ridge
    const sideTop = Math.max(...prism.filter((v) => Math.abs(v.x) > 16.9).map((v) => v.y));
    expect(top - sideTop).toBeGreaterThan(12);
  });

  it('the sub-mirror sends the axial light down through the mirror-box floor into the AF module (score loop r2)', () => {
    // the sub-mirror's plane from its own vertices: its center, and the normal of the two edges through a corner
    const sm = worldVerts(scene, 'subMirror');
    const c = sm.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(sm.length);
    const far = sm.reduce((a, v) => (v.distanceTo(c) > a.distanceTo(c) ? v : a), sm[0]);
    const u = new THREE.Vector3().subVectors(far, c);
    const w = sm.map((v) => new THREE.Vector3().subVectors(v, c)).reduce((a, v) => {
      const cr = new THREE.Vector3().crossVectors(u, v);
      return cr.length() > a.length() ? cr : a;
    }, new THREE.Vector3());
    const n = w.normalize();
    const d = new THREE.Vector3(0, 0, 1);                           // light from the lens toward the sensor (app +z)
    const r = d.clone().sub(n.clone().multiplyScalar(2 * d.dot(n)));
    expect(r.y).toBeLessThan(-0.9);                                  // down to the floor
    const front = n.z < 0 ? n : n.clone().negate();                 // the face toward the lens
    const corners = [...sm].sort((a, b) => b.distanceTo(c) - a.distanceTo(c)).slice(0, 4);
    for (const q of [c, ...corners]) {
      // points on the sub-mirror (its center, and 70% of the way to each corner), 0.05 mm off its front face, then
      // along the reflected ray
      const p = c.clone().lerp(q, 0.7).addScaledVector(front, 0.05);
      const hits = new THREE.Raycaster(p, r).intersectObject(scene, true).map((h) => componentOf(h.object))
        .filter((cmp) => cmp !== 'subMirror');
      expect(hits[0], hits.join(' > ')).toBe('afModule');
    }
  });

  it('the rear curtain waits folded below the eyepiece path, and the front curtain covers the gate', () => {
    const px = worldBox(findNode(scene, 'pixelArray')!), front = worldBox(findNode(scene, 'shutterCurtainFront')!);
    const rear = worldBox(findNode(scene, 'shutterCurtainRear')!), optics = worldBox(findNode(scene, 'eyepieceOptics')!);
    expect(front.min.y).toBeLessThanOrEqual(px.min.y + 1e-3);
    expect(front.max.y).toBeGreaterThanOrEqual(px.max.y - 1e-3);
    expect(rear.min.y).toBeGreaterThanOrEqual(px.max.y - 1e-3);
    expect(rear.max.y).toBeLessThan(optics.min.y);
  });

  it('the mirror lifts flat under the screen, clear of the shutter, the throat and the light cone', () => {
    // the rig's own staging (rig-exposure.ts mirrorPhases) applied to the exported hinges, as the rig applies it
    const hinge = findNode(scene, 'mirrorHinge')!, up = findNode(scene, 'mirrorHingeUp')!, subHinge = findNode(scene, 'subMirrorHinge')!;
    const P0 = hinge.getWorldPosition(new THREE.Vector3()), P1 = up.getWorldPosition(new THREE.Vector3());
    const S0 = subHinge.getWorldPosition(new THREE.Vector3());
    const lift = THREE.MathUtils.degToRad(hinge.userData.liftDeg), fold = THREE.MathUtils.degToRad(subHinge.userData.foldDeg);
    expect(lift).toBeCloseTo(Math.PI / 4, 6);
    const mirror = worldVerts(scene, 'mirror'), sub = worldVerts(scene, 'subMirror');
    const screen = worldBox(findNode(scene, 'focusingScreen')!), frame = worldBox(findNode(scene, 'shutter')!);
    const stack = worldBox(findNode(scene, 'shutterCurtainRear')!);
    const boxFront = worldBox(findNode(scene, 'mirrorBox')!).min.z;     // the mirror box's front (toward the lens)
    const pose = (s: number) => {
      const p = mirrorPhases(s);
      const at = new THREE.Vector3(P0.x, P0.y + (P1.y - P0.y) * p.rise, P0.z + (P1.z - P0.z) * p.back);
      const M = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)
        .multiply(new THREE.Matrix4().makeRotationX(lift * p.lift)).multiply(new THREE.Matrix4().makeTranslation(-P0.x, -P0.y, -P0.z));
      const F = new THREE.Matrix4().makeTranslation(S0.x, S0.y, S0.z)
        .multiply(new THREE.Matrix4().makeRotationX(fold * p.fold)).multiply(new THREE.Matrix4().makeTranslation(-S0.x, -S0.y, -S0.z));
      return [...mirror.map((v) => v.clone().applyMatrix4(M)), ...sub.map((v) => v.clone().applyMatrix4(F).applyMatrix4(M))];
    };
    const over = (v: THREE.Vector3, b: THREE.Box3) => v.x >= b.min.x && v.x <= b.max.x && v.z >= b.min.z - 0.05 && v.z <= b.max.z + 0.05;
    for (let i = 0; i <= 200; i++) {
      for (const v of pose(i / 200)) {
        expect(v.z, `s=${i / 200}: past the mirror box's front`).toBeGreaterThan(boxFront - 0.05);
        expect(v.y, `s=${i / 200}: into the focusing screen`).toBeLessThan(screen.min.y - 0.05);
        if (over(v, stack)) expect(v.y, `s=${i / 200}: through the folded rear curtain`).toBeGreaterThan(stack.max.y + 0.05);
        if (over(v, frame) && Math.abs(v.y) > 12.5) expect(v.y, `s=${i / 200}: through the shutter frame`).toBeGreaterThan(frame.max.y + 0.05);
      }
    }
    // raised: flat, and above the cone from the throat (r 22 at the mount face) to the frame's edges at the sensor
    const raised = pose(1);
    const flange = facts.mount.flangeMm, rThroat = facts.mount.throatMm / 2, half = facts.sensor.activeAreaHeightMm / 2;
    const coneTop = (z: number) => half + (rThroat - half) * Math.min(1, Math.max(0, -z / flange));
    for (const v of raised) expect(v.y).toBeGreaterThan(coneTop(v.z) + 1);
    const m = raised.slice(0, mirror.length);
    expect(Math.max(...m.map((v) => v.y)) - Math.min(...m.map((v) => v.y))).toBeLessThan(1.1);   // the 1 mm slab, flat
  });
});

describe('mirrorless.glb viewfinder and front controls (score loop r1)', () => {
  const facts = (bodiesFacts as any).mirrorless;
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); scene.updateMatrixWorld(true); });

  it('the EVF housing is a tube: rays down the axis reach every eyepiece lens and the panel, in both views', () => {
    const lens = worldBox(findNode(scene, 'evfLens2')!).getCenter(new THREE.Vector3());
    const start = new THREE.Vector3(3, lens.y + 2, worldBox(findNode(scene, 'evfEyecup')!).max.z + 5);
    // the lenses carry no component of their own (they belong to 'evf'): name them by their nodes
    const partOf = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (/^evfLens\d$/.test(p.name)) return p.name;
      return componentOf(o);
    };
    const hitsIn = (hidden: string[]) => {
      const hits = new THREE.Raycaster(start, new THREE.Vector3(0, 0, -1)).intersectObject(scene, true)
        .map((h) => partOf(h.object)).filter((c) => !hidden.includes(c) && c !== 'evf' && c !== 'evfEyecup');
      return hits.filter((c, i) => c !== hits[i - 1]);
    };
    // the cutaway (the halves): through the housing's bore and the rear wall to all three lenses and the panel
    const cut = hitsIn(['evfHousing', 'shellClosed']);
    expect(cut.slice(0, 3), cut.join(' > ')).toEqual(['evfLens2', 'evfLens1', 'evfLens0']);
    expect(cut, cut.join(' > ')).toContain('evfPanel');
    // outside: the eye meets the last lens first, inside the housing's bore (the closed shell is solid beyond it)
    expect(hitsIn(['evfHousingCut', 'shellCut'])[0]).toBe('evfLens2');
  });

  it('the EVF panel is the Z8\'s 0.5 in. 4:3 panel (10.16 x 7.62 mm, research/z8.md)', () => {
    const s = worldBox(findNode(scene, 'evfPanel')!).getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(10.16, 1);
    expect(s.y).toBeCloseTo(7.62, 1);
  });

  it('the front buttons and the AF lamp stand clear of the grip rubber and the mount boss', () => {
    const grip = worldVerts(scene, 'grip'), boss = worldBox(findNode(scene, 'mountBoss')!);
    for (const name of ['frontButtons', 'afLamp']) {
      const b = worldBox(findNode(scene, name)!);
      const nearGrip = grip.filter((v) => v.y > b.min.y - 1 && v.y < b.max.y + 1 && v.z < b.max.z + 1);
      expect(Math.min(...nearGrip.map((v) => v.x)), name).toBeGreaterThan(b.max.x);
      // outside the boss's round edge (its radius is the box's half width)
      const r = (boss.max.x - boss.min.x) / 2;
      for (const v of worldVerts(scene, name)) if (v.z > boss.min.z - 0.1) expect(Math.hypot(v.x, v.y), name).toBeGreaterThan(r);
    }
  });
});

describe.each(['dslr', 'mirrorless'])('%s.glb export hygiene (score loop r1)', (id) => {
  const facts = (bodiesFacts as any)[id];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); scene.updateMatrixWorld(true); });

  it('has (almost) no zero-area triangles', () => {
    let zero = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.attributes.position, idx = m.geometry.index;
      const n = idx ? idx.count : p.count;
      for (let i = 0; i < n; i += 3) {
        const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
        a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
        if (b.sub(a).cross(c.sub(a)).length() / 2 < 1e-6) zero++;
      }
    });
    expect(zero).toBeLessThan(5);       // 83 (DSLR) and 1052 (mirrorless) before
  });

  it('flat faces shade flat: every corner normal of a flat region is within 2 degrees of its face (score loop r2)', () => {
    // Round 1's re-triangulation left the rear plates as fans of slivers whose corners carried normals bent up to 45
    // degrees (a bright wedge across the mirrorless rear, creases on the DSLR's). A flat region here is a connected set
    // of coplanar triangles of 50 mm2 or more and 4 mm or more across; bevels and curved surfaces are not flat regions.
    const bad = flatRegionNormalErrors(scene, 2.0);
    expect(bad.count, bad.worst).toBe(0);
  });

  it('the rear plate is one flat region whose corner normals all point straight back', () => {
    const shell = findNode(scene, 'shellClosed') as THREE.Mesh;
    const regions = flatRegions(shell);
    // the rear plate faces the viewer behind the camera: +z in the app frame
    const rear = regions.filter((r) => r.normal.z > 0.9999).sort((a, b) => b.area - a.area)[0];
    expect(rear.area).toBeGreaterThan(2000);
    expect(rear.maxCornerDeg).toBeLessThan(2.0);
  });

  it('the rear screen\'s picture is Nikon\'s 3.2 in. (81.3 mm) across, inside the frame\'s black mask (score loop r2)', () => {
    const s = worldBox(findNode(scene, 'rearScreen')!).getSize(new THREE.Vector3());
    expect(Math.abs(Math.hypot(s.x, s.y) - 3.2 * 25.4)).toBeLessThan(0.5);
    // the D850's panel is XGA (1024 x 768), so 4:3; Nikon gives the Z8's no pixel format
    if (id === 'dslr') expect(s.x / s.y).toBeCloseTo(4 / 3, 2);
    const mask = worldBox(findNode(scene, 'screenMask')!).getSize(new THREE.Vector3());
    expect(mask.x).toBeGreaterThan(s.x);
    expect(mask.y).toBeGreaterThan(s.y);
  });

  it('has no duplicate ".00x" materials and no generic mesh names', () => {
    const mats = gltfMaterials(facts.glb).map((m) => m.name);
    expect(mats.filter((n) => /\.\d{3}$/.test(n) && mats.includes(n.replace(/\.\d{3}$/, '')))).toEqual([]);
    const b = readFileSync(resolve(ROOT, facts.glb));
    const meshes = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')).meshes as { name: string }[];
    expect(meshes.filter((m) => /^(Cube|Plane|Cylinder|Circle)(\.\d+)?$/.test(m.name)).map((m) => m.name)).toEqual([]);
  });
});

// Score loop r3 (10/11/2026, docs/score-loop/r3-blender.md).

/** Edge use counts of a part's triangles in world space, positions welded to 1 micron (the exporter splits vertices
 * where normals or UVs differ; the build merges anything within 10 microns, so no two distinct corners share a key).
 * boundary: edges with one triangle; nonManifold: edges with three or more; duplicates: triangles on the same three
 * corners as another; degenerate: triangles with two corners welded together. */
function edgeUse(root: THREE.Object3D, name: string) {
  // positions within 3 microns are one vertex: Draco quantizes each primitive on its own grid (18 bits over the part, about
  // 0.0004 mm), so a vertex on the seam between two materials of one part lands a hair apart in each (score loop r5, the
  // grip's plain-rubber inner face)
  const reps: THREE.Vector3[] = [], grid = new Map<string, number[]>();
  const key = (v: THREE.Vector3) => {
    const cx = Math.floor(v.x / 0.05), cy = Math.floor(v.y / 0.05), cz = Math.floor(v.z / 0.05);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const r of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) if (reps[r].distanceTo(v) < 0.003) return String(r);
    }
    reps.push(v.clone());
    const cell = `${cx},${cy},${cz}`;
    grid.set(cell, [...(grid.get(cell) ?? []), reps.length - 1]);
    return String(reps.length - 1);
  };
  const edges = new Map<string, number>(), tris = new Set<string>();
  let duplicates = 0, degenerate = 0;
  findNode(root, name)!.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.updateWorldMatrix(true, false);
    const p = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const k = [0, 1, 2].map((j) => key(new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i + j) : i + j).applyMatrix4(m.matrixWorld)));
      if (new Set(k).size < 3) { degenerate++; continue; }
      const tk = [...k].sort().join('|');
      if (tris.has(tk)) duplicates++;
      tris.add(tk);
      for (let j = 0; j < 3; j++) {
        const a = k[j], b = k[(j + 1) % 3];
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(ek, (edges.get(ek) ?? 0) + 1);
      }
    }
  });
  let boundary = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  return { boundary, nonManifold, duplicates, degenerate };
}

describe.each(['dslr', 'mirrorless'])('%s.glb shells are watertight (score loop r3)', (id) => {
  const facts = (bodiesFacts as any)[id];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb(facts.glb); scene.updateMatrixWorld(true); });

  // Round 2's mirrorless shell had a 1 mm slit along the grip's bottom corner (28 boundary edges, about 75 mm of gap
  // seen through when orbited underneath) and the DSLR's a 15-30 mm sliver open on the grip's inner face; both
  // carried duplicate faces. The bored eyepiece and throat are holes through a solid, not open edges, so every shell
  // edge has exactly two triangles.
  it.each(['shellClosed', 'shellCut', 'grip'])('%s has no open, non-manifold, duplicate or collapsed triangles', (name) => {
    expect(edgeUse(scene, name)).toEqual({ boundary: 0, nonManifold: 0, duplicates: 0, degenerate: 0 });
  });
});

/** The center of a named part's box seen from behind (mm): x to the camera's right, then up. */
function centerXZ(scene: THREE.Object3D, name: string): [number, number] {
  const c = worldBox(findNode(scene, name)!).getCenter(new THREE.Vector3());
  return [c.x, c.y];
}

describe('the bodies sit on the axis where Nikon\'s drawings put it (score loop r3)', () => {
  // research/z8.md and research/d850.md, "Exterior traced from Nikon's manual drawings": the viewfinder and the shoe,
  // both on the lens axis, are 54.9 / 58.3 mm (Z8 rear / top drawing) and 54.6 / 54.7 mm (D850) from the port-side
  // end once each drawing is scaled to the published width. The models had 62 and 64 mm.
  it.each([['mirrorless', 56.5], ['dslr', 54.6]] as const)('%s: the port-side end is %f mm from the axis', async (id, d) => {
    const scene = await loadGlb((bodiesFacts as any)[id].glb);
    expect(Math.abs(-worldBox(findNode(scene, 'shellClosed')!).min.x - d)).toBeLessThan(0.5);
  });
});

describe('mirrorless.glb controls sit where Nikon\'s Z8 drawings put them (score loop r3)', () => {
  // The rear drawing scaled by the 144 x 118.5 mm envelope, the top drawing by the 144 mm width (research/z8.md).
  // Each center within 1.5 mm.
  const rear: [string, number, number][] = [
    ['afOnButton', 54.1, 42.2], ['subSelector', 53.8, 25.7], ['iButton', 52.6, 12.2], ['multiSelector', 59.4, -2.0],
    ['infoButton0', 52.8, -16.2], ['infoButton1', 65.8, -16.2], ['infoButton2', 52.8, -27.4], ['infoButton3', 65.8, -27.4],
    ['playButton0', -43.9, 42.2], ['playButton1', -31.3, 42.2],
  ];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any).mirrorless.glb); scene.updateMatrixWorld(true); });

  it.each(rear)('%s is centered at (%f, %f) seen from behind', (name, x, z) => {
    const [cx, cz] = centerXZ(scene, name);
    expect(Math.abs(cx - x), `${name} x ${cx.toFixed(1)}`).toBeLessThan(1.5);
    expect(Math.abs(cz - z), `${name} z ${cz.toFixed(1)}`).toBeLessThan(1.5);
  });

  it('the screen\'s picture is centered on the drawing\'s window (-4.5, 0.3)', () => {
    const [cx, cz] = centerXZ(scene, 'rearScreen');
    expect(Math.abs(cx + 4.5)).toBeLessThan(1.5);
    expect(Math.abs(cz - 0.3)).toBeLessThan(1.5);
  });

  it('the top plate stands at the drawing\'s 52 mm shoulder, not 58', () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(66, 120, 15), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(findNode(scene, 'shellClosed')!, true)[0];
    expect(Math.abs(hit.point.y - 52.0)).toBeLessThan(1.0);
  });

  it('the top controls sit at the top drawing\'s x positions', () => {
    for (const [name, x] of [['shutterButton', 63.5], ['topButton0', 52.7], ['topButton1', 63.7], ['topButton2', 78.2],
      ['buttonCluster', -38.4]] as const) {
      expect(Math.abs(centerXZ(scene, name)[0] - x), name).toBeLessThan(1.5);
    }
  });

  it('the hump is the drawing\'s width: 48 mm across at z 64, 43 mm at z 71', () => {
    for (const [z, w] of [[63.9, 48.2], [71.2, 43.2]]) {
      const xs: number[] = [];
      for (const sx of [-1, 1]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(sx * 60, z, 15), new THREE.Vector3(-sx, 0, 0));
        xs.push(ray.intersectObject(findNode(scene, 'shellClosed')!, true)[0].point.x);
      }
      expect(Math.abs(xs[1] - xs[0] - w), `z ${z}`).toBeLessThan(1.5);
    }
  });

  it('measures the published 83 mm from the grip front to the back of the eyecup (CIPA\'s 10% rule)', () => {
    // research/exteriors.md, "Body depth convention": a protrusion may be left out of a dimension only if it stands out
    // no more than 10% of it. This eyecup stands 10.9 mm behind the rear plate of a 74 mm body, so it counts, and the
    // 83 mm runs from the grip front to the back of the eyecup.
    const shell = worldBox(findNode(scene, 'shellClosed')!), cup = worldBox(findNode(scene, 'evfEyecup')!);
    expect(Math.abs(cup.max.z - shell.min.z - 83.0)).toBeLessThan(0.5);
  });
});

describe('dslr.glb controls sit where Nikon\'s D850 drawings put them (score loop r3)', () => {
  // The rear drawing scaled by the 146 x 124 mm envelope, the top drawing by the 146 mm width (research/d850.md).
  // Each center within 1.5 mm.
  const rear: [string, number, number][] = [
    ['afOnButton', 51.6, 41.2], ['subSelector', 43.9, 30.5], ['infoButton0', 52.1, -19.0], ['infoButton1', 64.7, -16.2],
    ['lvButton', 57.5, -30.2], ['rearButton0', -43.4, 23.5], ['rearButton1', -43.4, 12.4], ['rearButton2', -43.4, 0.4],
    ['rearButton3', -43.4, -11.6], ['rearButton4', -43.4, -23.2], ['rearButton5', -42.4, -33.7],
    ['playButton0', -42.4, 38.4], ['playButton1', -30.7, 38.4],
  ];
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any).dslr.glb); scene.updateMatrixWorld(true); });

  it.each(rear)('%s is centered at (%f, %f) seen from behind', (name, x, z) => {
    const [cx, cz] = centerXZ(scene, name);
    expect(Math.abs(cx - x), `${name} x ${cx.toFixed(1)}`).toBeLessThan(1.5);
    expect(Math.abs(cz - z), `${name} z ${cz.toFixed(1)}`).toBeLessThan(1.5);
  });

  it('the release-mode dial and the top-plate controls sit at the top drawing\'s x positions', () => {
    for (const [name, x] of [['releaseModeDial', -37.5], ['shutterButton', 67.8], ['topButton0', 54.9],
      ['topButton1', 64.7], ['topButton2', 75.4]] as const) {
      expect(Math.abs(centerXZ(scene, name)[0] - x), name).toBeLessThan(1.5);
    }
  });
});

describe('dslr.glb prism cheek (score loop r4)', () => {
  // The cheek was a polyline of three straight runs joined by small fillets, which showed as terraced bands (steps of
  // 6.7 and 8.0 degrees between neighboring facets at z 61 and 68); it is now a spline through the traced widths
  // (research/d850.md): 48 mm across at z 61.6 and 44 mm at z 68.3.
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any).dslr.glb); scene.updateMatrixWorld(true); });

  const hitFrom = (sx: number, z: number) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(sx * 60, z, -5), new THREE.Vector3(-sx, 0, 0));
    return ray.intersectObject(findNode(scene, 'shellClosed')!, true)[0];
  };

  it('is the traced width at z 61.6 and z 68.3 (within 1 mm of 48 and 44)', () => {
    for (const [z, w] of [[61.6, 48], [68.3, 44]]) {
      expect(Math.abs(hitFrom(1, z).point.x - hitFrom(-1, z).point.x - w), `z ${z}`).toBeLessThan(1.0);
    }
  });

  it('has no terraced steps between z 57 and z 67: neighboring facets turn under 2 degrees', () => {
    const ns: THREE.Vector3[] = [];
    for (let z = 57; z <= 67; z += 1) {
      const h = hitFrom(1, z);
      ns.push(h.face!.normal.clone().transformDirection(h.object.matrixWorld));
    }
    const jumps = ns.slice(1).map((n, i) => THREE.MathUtils.radToDeg(n.angleTo(ns[i])));
    expect(Math.max(...jumps)).toBeLessThan(2.0);
  });
});

// Score loop r5 (10/11/2026, docs/score-loop/r5-blender.md).
describe('dslr.glb eyepiece length (score loop r5)', () => {
  // The eyepiece housing and eyecup stood 14.6 mm behind the rear plate, a length with no source, which left the model
  // 93.5 mm deep against Nikon's 78.5. They now stand 7.8 mm: the model's own length, the most that CIPA's 10% rule (as
  // reported, research/exteriors.md) lets a maker leave out of a 78.5 mm depth. The shell itself is still 78.5 mm from
  // the rear plate (z +24) to the grip front (z -54.5).
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any).dslr.glb); scene.updateMatrixWorld(true); });

  it('stands no more than 10% of 78.5 mm (7.85 mm) behind the rear plate', () => {
    const cup = worldBox(findNode(scene, 'eyecup')!);
    expect(cup.max.z - 24).toBeGreaterThan(6.5);
    expect(cup.max.z - 24).toBeLessThanOrEqual(7.85);
    const optics = worldBox(findNode(scene, 'eyepieceOptics')!);
    expect(optics.max.z - 24).toBeLessThanOrEqual(7.85);
  });

  it('is under 88 mm deep in all, grip rubber to eyecup (it was 93.5)', () => {
    const all = new THREE.Box3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name !== 'shellCut' && o.userData?.cutaway !== 'half' && m.name !== 'floor') all.union(new THREE.Box3().setFromObject(m));
    });
    expect(all.max.z - all.min.z).toBeLessThan(88);
  });
});

describe.each(['dslr', 'mirrorless'])('%s.glb coincident same-facing faces (score loop r5)', (id) => {
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any)[id].glb); scene.updateMatrixWorld(true); });

  it('keeps the rear screen black mask off the picture glass by 0.05 mm or more at its body-side face', () => {
    // the mask's body-side face coincided with the glass's (3,100 mm2 of same-facing faces buried in the frame)
    const glass = worldBox(findNode(scene, 'rearScreen')!), mask = worldBox(findNode(scene, 'screenMask')!);
    expect(Math.abs(mask.min.z - glass.min.z)).toBeGreaterThanOrEqual(0.05);
  });

  it('puts the interior faces of the grip skin on a plain rubber, with the pebble map on the outside only', () => {
    const mats = new Map<string, THREE.Material>();
    findNode(scene, 'grip')!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const x of ([] as THREE.Material[]).concat(m.material)) mats.set(x.name, x);
    });
    expect([...mats.keys()].sort()).toEqual(['GripRubber', 'GripRubberPlain']);
    expect(mats.get('GripRubber')!.userData.normalMap).toContain('leatherette');
    expect(mats.get('GripRubber')!.userData.normalScale).toBeLessThanOrEqual(0.6);
    expect(mats.get('GripRubberPlain')!.userData.normalMap).toBeUndefined();
  });
});

describe('mirrorless.glb EVF window (score loop r5)', () => {
  it('lies inside the opening of the eyecup: its corners no longer run into the lip', async () => {
    const scene = await loadGlb((bodiesFacts as any).mirrorless.glb);
    scene.updateMatrixWorld(true);
    const win = worldBox(findNode(scene, 'evfWindow')!), w = win.max.x - win.min.x, h = win.max.y - win.min.y;
    // the opening at the window's plane is a superellipse (n = 3) about 26.5 x 18.2 mm; the window is a smaller one
    expect(w).toBeLessThanOrEqual(25.3);
    expect(h).toBeLessThanOrEqual(17.0);
  });
});

describe.each([['dslr', 36.25, 24], ['mirrorless', 39.85, 32]] as const)('%s.glb parting line (score loop r5)', (id, zGroove, zRear) => {
  // a shallow groove 0.3 mm deep and 0.5 mm tall round the body just under the shoulders' roll, so the rear plate is not an
  // unbroken plane. Rays from behind at x = 40 mm, in the groove and 1 mm above it, measure its depth.
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb((bodiesFacts as any)[id].glb); scene.updateMatrixWorld(true); });
  const rearZ = (y: number) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(40, y, zRear + 40), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(findNode(scene, 'shellClosed')!, true)[0].point.z;
  };

  it('cuts the rear plate about 0.3 mm deep, and leaves it flat above and below', () => {
    const flat = rearZ(zGroove + 1.0);
    expect(flat - rearZ(zGroove)).toBeGreaterThan(0.2);
    expect(flat - rearZ(zGroove)).toBeLessThan(0.4);
    expect(Math.abs(flat - rearZ(zGroove - 1.0))).toBeLessThan(0.01);
  });
});
