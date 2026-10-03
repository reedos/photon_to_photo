import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { sharedAssetLoader, materialHighlight } from './model-resources';

describe('model asset lifetime', () => {
  it('shares concurrent decoding and keeps the completed asset', async () => {
    let finish!: (asset: object) => void;
    const decoder = vi.fn(() => new Promise<object>(resolve => { finish = resolve; }));
    const load = sharedAssetLoader(decoder);
    const first = load('body.glb'), repeated = load('body.glb');
    expect(repeated).toBe(first);
    await Promise.resolve();
    expect(decoder).toHaveBeenCalledTimes(1);
    const body = {};
    finish(body);
    expect(await first).toBe(body);
    expect(await repeated).toBe(body);
    expect(load('body.glb')).toBe(first);
  });

  it('shares a failure but permits a fresh explicit retry', async () => {
    const asset = {};
    const decoder = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(asset);
    const load = sharedAssetLoader(decoder);
    const outcomes = await Promise.allSettled([load('lens.glb'), load('lens.glb')]);
    expect(outcomes.every(value => value.status === 'rejected')).toBe(true);
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(await load('lens.glb')).toBe(asset);
    expect(decoder).toHaveBeenCalledTimes(2);
  });
});

describe('model selection lifetime', () => {
  it('releases every temporary material across repeated selections without disposing shared assets', () => {
    const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
    const originalColor = material.emissive.clone(), geometry = new THREE.BoxGeometry();
    const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, [material, material]);
    const root = new THREE.Group(); root.add(first, second);
    const highlight = materialHighlight(new THREE.Color(0xe6ba82), .14);
    let released = 0, assetsReleased = 0;
    for (const asset of [texture, material, geometry]) asset.addEventListener('dispose', () => assetsReleased++);
    for (let cycle = 0; cycle < 60; cycle++) {
      highlight.add(root);
      const selected = [first.material, ...second.material] as THREE.MeshStandardMaterial[];
      highlight.add(first); // Overlapping groups must not clone the same mesh twice.
      expect(first.material).toBe(selected[0]);
      for (const copy of selected) {
        expect(copy).not.toBe(material);
        expect(copy.map).toBe(texture);
        copy.addEventListener('dispose', () => released++);
      }
      highlight.clear();
      expect(first.material).toBe(material);
      expect(second.material).toEqual([material, material]);
    }
    highlight.clear();
    expect(released).toBe(180);
    expect(assetsReleased).toBe(0);
    expect(material.emissive).toEqual(originalColor);
  });
});
