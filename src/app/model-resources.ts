import * as THREE from 'three/webgpu';

/** One request per asset, including while it is still decoding. Failures can retry. */
export function sharedAssetLoader<T>(load: (path: string) => Promise<T>): (path: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return path => {
    const cached = cache.get(path);
    if (cached) return cached;
    const pending = Promise.resolve().then(() => load(path)).catch(error => {
      if (cache.get(path) === pending) cache.delete(path);
      throw error;
    });
    cache.set(path, pending);
    return pending;
  };
}

/** A selection owns its cloned materials, never the shared geometry or textures. */
export function materialHighlight(color: THREE.Color, intensity: number) {
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const copies = new Set<THREE.Material>();
  return {
    add(root: THREE.Object3D) {
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || originals.has(mesh)) return;
        const original = mesh.material;
        originals.set(mesh, original);
        const highlighted = (Array.isArray(original) ? original : [original]).map(source => {
          const copy = source.clone() as THREE.MeshStandardMaterial;
          if ('emissive' in copy) {
            copy.emissive = color.clone();
            copy.emissiveIntensity = intensity;
          }
          copies.add(copy);
          return copy;
        });
        mesh.material = Array.isArray(original) ? highlighted : highlighted[0];
      });
    },
    clear() {
      for (const [mesh, original] of originals) mesh.material = original;
      originals.clear();
      for (const copy of copies) copy.dispose();
      copies.clear();
    },
  };
}
