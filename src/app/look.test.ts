import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { studioReplacement } from './look';

describe('studio cover glass', () => {
  it.each(['filterGlass', 'evfGlass'])('renders %s without a viewport transmission sampler', (name) => {
    const source = new THREE.MeshPhysicalMaterial({ name, color: 0xc1def2, transmission: 1,
      roughness: 0.04, ior: 1.52, thickness: 1.8, side: THREE.DoubleSide });
    const glass = studioReplacement(source) as THREE.MeshPhysicalMaterial;
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeGreaterThan(0);
    expect(glass.opacity).toBeLessThan(0.5);
    expect(glass.depthWrite).toBe(false);
    expect(glass.color.equals(source.color)).toBe(true);
    expect(glass.roughness).toBe(source.roughness);
    expect(glass.ior).toBe(source.ior);
    expect(glass.side).toBe(source.side);
    expect(studioReplacement(source)).toBe(glass);
    expect(source.transmission).toBe(1);
    expect(source.transparent).toBe(false);
  });
});
