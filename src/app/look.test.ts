import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { cutawayGlassMaterial, opticalGlassMaterial, sectionGlassMaterial, sensorArrayMaterial, studioReplacement } from './look';

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

describe('inspection material framebuffer safety', () => {
  it('keeps every polished and sectioned glass variant independent of viewport transmission', () => {
    const materials = [opticalGlassMaterial(true), opticalGlassMaterial(false),
      cutawayGlassMaterial(1.52, false), cutawayGlassMaterial(1.8, true),
      sectionGlassMaterial(false), sectionGlassMaterial(true)];
    for (const material of materials) {
      expect(material.transmission).toBe(0);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(0.5);
      material.dispose();
    }
  });

  it('shares the same sensor finish between camera replacement and optical inspection', () => {
    const source = new THREE.MeshPhysicalMaterial({ name: 'PixelArray' });
    const camera = studioReplacement(source) as THREE.MeshPhysicalMaterial;
    const inspection = sensorArrayMaterial();
    expect(camera.color.equals(inspection.color)).toBe(true);
    expect(camera.iridescenceThicknessRange).toEqual(inspection.iridescenceThicknessRange);
    expect(camera.transmission).toBe(0);
    expect(inspection.transmission).toBe(0);
    expect(camera.transparent).toBe(false);
    expect(inspection.transparent).toBe(false);
    inspection.dispose(); source.dispose();
  });
});
