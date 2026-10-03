import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';

const { loadAsync } = vi.hoisted(() => ({ loadAsync: vi.fn() }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setDRACOLoader() { return this; }
    loadAsync(url: string) { return loadAsync(url); }
  },
}));

afterEach(() => vi.unstubAllGlobals());

it('retries a failed housing request and then reuses the recovered asset', async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const scene = new THREE.Group();
  const source = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 60), new THREE.MeshStandardMaterial());
  scene.add(source);
  loadAsync.mockRejectedValueOnce(new Error('temporary connection failure')).mockResolvedValue({ scene });
  const { loadGlbBarrel } = await import('./glb-barrel');
  const materialFactory = {
    matteInternalMaterial: () => new THREE.MeshStandardMaterial(),
    rubberGripMaterial: () => new THREE.MeshStandardMaterial(),
  } as unknown as typeof look;

  const failed = await Promise.allSettled([
    loadGlbBarrel('n50', materialFactory), loadGlbBarrel('n50', materialFactory),
  ]);
  expect(failed.every(result => result.status === 'rejected')).toBe(true);
  expect(loadAsync).toHaveBeenCalledTimes(1);

  const recovered = await loadGlbBarrel('n50', materialFactory);
  const another = await loadGlbBarrel('n50', materialFactory);
  expect(loadAsync).toHaveBeenCalledTimes(2);
  expect(recovered?.root.children.length).toBeGreaterThan(0);
  expect(recovered?.outerR).toBe(10);
  expect(another?.root).not.toBe(recovered?.root);
  recovered?.dispose(); another?.dispose();
  source.geometry.dispose(); source.material.dispose();
});
