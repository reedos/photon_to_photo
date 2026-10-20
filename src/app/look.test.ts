import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { cutawayGlassMaterial, opticalGlassMaterial, sectionGlassMaterial, sensorArrayMaterial, studioReplacement } from './look';

describe('studio cover glass', () => {
  // The filter stack and the EVF eyepiece now export as dark coated glass with alpha and no transmission
  // (blender/bodykit.py mat_cover_glass, aperture review 10/11/2026), so the studio look keeps them as authored.
  // src/scene/bodies/blender-glb.test.ts holds the GLB itself to that.
  it.each(['filterGlass', 'evfGlass'])('leaves %s as exported', (name) => {
    const source = new THREE.MeshPhysicalMaterial({ name, color: 0x0a0e10, transparent: true, opacity: 0.3, depthWrite: false });
    expect(studioReplacement(source)).toBeNull();
    source.dispose();
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
