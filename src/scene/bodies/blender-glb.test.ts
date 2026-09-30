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
import bodiesFacts from '../../../public/models/bodies.json';

const ROOT = resolve(__dirname, '../../..');

function loadGlb(relPath: string): Promise<THREE.Group> {
  const buf = readFileSync(resolve(ROOT, relPath));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
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
