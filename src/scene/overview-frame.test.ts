import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { overviewFrame } from './overview-frame';

function rig() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(150, 110, 60));
  const lens = new THREE.Mesh(new THREE.BoxGeometry(65, 65, 180));
  lens.position.set(20, -15, -110);
  root.add(body, lens);
  return root;
}

describe('overview framing', () => {
  it.each([0.6, 1.5, 2.4])('fits transformed component corners within a %s aspect viewport', aspect => {
    const root = rig(); root.position.set(12, 8, -5); root.rotation.y = 0.2;
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 5000);
    const tanV = Math.tan(THREE.MathUtils.degToRad(20)) / 1.08;
    const frame = overviewFrame(root, new THREE.Vector3(-0.62, 0.34, -0.71), tanV * aspect, tanV)!;
    camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
    root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      const box = mesh.geometry.boundingBox!;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1 / 1.08 + 1e-6);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1 / 1.08 + 1e-6);
        expect(point.z).toBeLessThan(1);
      }
    });
  });

  it('ignores hidden ancestor subtrees and edge decoration', () => {
    const root = rig(), direction = new THREE.Vector3(-1, 0.3, -1);
    const before = overviewFrame(root, direction, 0.5, 0.3)!;
    const hidden = new THREE.Group(); hidden.visible = false;
    const far = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000)); far.position.x = 10000;
    hidden.add(far); root.add(hidden);
    const edge = far.clone(); edge.userData.edgeBand = true; root.add(edge);
    const after = overviewFrame(root, direction, 0.5, 0.3)!;
    expect(after.position.distanceTo(before.position)).toBe(0);
    expect(after.target.distanceTo(before.target)).toBe(0);
  });

  it('moves closer than fitting the empty corners around an offset body and lens', () => {
    const root = rig(), direction = new THREE.Vector3(-0.62, 0.34, -0.71);
    const fit = overviewFrame(root, direction, 0.5, 0.3)!;
    const box = new THREE.Box3().setFromObject(root), emptyCorners = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()));
    emptyCorners.position.copy(box.getCenter(new THREE.Vector3()));
    const wholeBox = overviewFrame(emptyCorners, direction, 0.5, 0.3)!;
    expect(fit.position.distanceTo(fit.target)).toBeLessThan(wholeBox.position.distanceTo(wholeBox.target) * 0.95);
    expect(overviewFrame(new THREE.Group(), direction, 0.5, 0.3)).toBeNull();
  });
});
