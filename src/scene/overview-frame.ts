import * as THREE from 'three/webgpu';
import type { CameraFrame } from '../pieces/types';

/** Fit the actual component envelopes, avoiding the empty corners of one large world-axis box.
 * Called only for an automatic overview/reset; manual orbit and selected-part framing stay with their owners. */
export function overviewFrame(root: THREE.Object3D, direction: THREE.Vector3, tanH: number, tanV: number): CameraFrame | null {
  root.updateWorldMatrix(true, true);
  const points: THREE.Vector3[] = [];
  root.traverseVisible(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.edgeBand) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      points.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    }
  });
  if (!points.length || !(tanH > 0 && tanV > 0)) return null;
  const d = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
  const up = new THREE.Vector3().crossVectors(d, right).normalize();
  const origin = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity, near = -Infinity;
  for (const point of points) {
    point.sub(origin);
    const u = point.dot(right), v = point.dot(up), w = point.dot(d);
    // At camera distance D, the permissible target interval is
    // [max(u + tanH*w) - tanH*D, min(u - tanH*w) + tanH*D].
    uLo = Math.min(uLo, u - tanH * w); uHi = Math.max(uHi, u + tanH * w);
    vLo = Math.min(vLo, v - tanV * w); vHi = Math.max(vHi, v + tanV * w);
    near = Math.max(near, w);
  }
  const distance = Math.max(near + 1, (uHi - uLo) / (2 * tanH), (vHi - vLo) / (2 * tanV));
  const target = origin.addScaledVector(right, (uHi + uLo) / 2).addScaledVector(up, (vHi + vLo) / 2);
  return { target, position: target.clone().addScaledVector(d, distance) };
}
