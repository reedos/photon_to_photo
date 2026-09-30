// Astra-6 finding C1: the renderer used to reflect rays off a plane refit through the solidified mirror
// mesh's own min/max vertices, which mixes the 1mm solidify thickness into both the plane's center point
// and its normal (a 3.37deg tilt, landing 0.75mm off the intended screen plane). blender/dslr_v2.py now
// records the mirror's optical FRONT face (the surface SOLIDIFY leaves undisplaced) and the focusing
// screen's own optical plane as glTF extras, in the app's world frame, for camera-rig.ts to read directly.
//
// This test derives the EXPECTED plane independently of both the build script and the app: from the
// physical claim stated in docs/PANE.md and dslr_v2.py's own docstring/comments (a 45deg mirror centered
// 25mm in front of the sensor, and a common.py axis convention of blender (x, y, z) -> app (x, z, -y)),
// not by re-reading the numbers the Python or TypeScript source already computed.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  root.traverse((o) => { if (o.name === name) found = o; });
  return found;
}

describe('dslr.glb mirror/screen optical extras (Astra-6 C1)', () => {
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb('public/models/dslr.glb'); });

  it("carries the mirror's front-face plane as an extra, matching an independently derived 45deg reflector 25mm ahead of the sensor", () => {
    const mirror = findNode(scene, 'mirror')!;
    expect(mirror).toBeTruthy();
    const fp = mirror.userData?.mirrorFrontPlane as number[] | undefined;
    expect(fp, 'mirror is missing the mirrorFrontPlane extra').toBeTruthy();
    expect(fp).toHaveLength(6);

    // Independent derivation, not read from dslr_v2.py's own recorded numbers: a plane whose LOCAL normal
    // is +Z (Blender's own default primitive-plane normal), rotated -45deg about X (docs/PANE.md's stated
    // mirror tilt), centered 25mm in front of the sensor along the optical axis (blender Y = 25, i.e. app
    // z = -25 under common.py's axis convention).
    // Local plane normal (0,0,1) rotated -45deg about Blender's X axis: y' = y*cos - z*sin, z' = y*sin + z*cos.
    const theta = -Math.PI / 4;
    const by = 0 * Math.cos(theta) - 1 * Math.sin(theta);
    const bz = 0 * Math.sin(theta) + 1 * Math.cos(theta);
    const expectedNormal = new THREE.Vector3(0, bz, -by); // app (x, y, z) = blender (x, z, -y)
    const expectedPoint = new THREE.Vector3(0, 0, -25);

    const [px, py, pz, nx, ny, nz] = fp!;
    const actualPoint = new THREE.Vector3(px, py, pz);
    const actualNormal = new THREE.Vector3(nx, ny, nz).normalize();

    expect(actualPoint.distanceTo(expectedPoint)).toBeLessThan(0.01);
    expect(actualNormal.angleTo(expectedNormal) * 180 / Math.PI).toBeLessThan(0.05);

    // The reflection law itself, applied to this recorded plane: an axial incident ray [0,0,1] must reflect
    // to [0,1,0] within 0.05deg (Astra's own tolerance for this finding).
    const d = new THREE.Vector3(0, 0, 1);
    const reflected = d.clone().reflect(actualNormal);
    expect(reflected.angleTo(new THREE.Vector3(0, 1, 0)) * 180 / Math.PI).toBeLessThan(0.05);
  });

  it("carries the focusing screen's own optical plane, the same optical distance from the mirror center as the sensor (within 0.05mm)", () => {
    const mirror = findNode(scene, 'mirror')!;
    const screen = findNode(scene, 'focusingScreen')!;
    expect(screen).toBeTruthy();
    const fp = mirror.userData?.mirrorFrontPlane as number[];
    const screenY = screen.userData?.opticalScreenY as number | undefined;
    expect(typeof screenY, 'focusingScreen is missing the opticalScreenY extra').toBe('number');

    const mirrorZ = fp[2];
    const mirrorY = fp[1];
    const sensorZ = 0; // the app frame's own sensor-plane convention (docs/PANE.md)
    const mirrorToSensor = Math.abs(sensorZ - mirrorZ);
    const mirrorToScreen = Math.abs(screenY! - mirrorY);
    expect(Math.abs(mirrorToScreen - mirrorToSensor)).toBeLessThan(0.05);
  });
});
