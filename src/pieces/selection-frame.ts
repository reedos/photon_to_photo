import * as THREE from 'three/webgpu';
import type { CameraFrame } from './types';

/** Focus from a stable overview, never from a half-finished flight or a previous selection. */
export function selectionFrame(base: CameraFrame, anchor: THREE.Vector3, scale = 0.8): CameraFrame {
  const offset = base.position.clone().sub(base.target).multiplyScalar(scale);
  return { position: anchor.clone().add(offset), target: anchor.clone() };
}
