// The cut faces of the cutaway (score loop r4). The export bisects each part at x = 0.05 and fills the hole, so a cut half
// carries a flat cap that shares its part's material. Lit head-on by the key and fill, a chrome or paint cap came out as the
// brightest flat plane in the view (the prism roof wedge, the hot shoe, the focusing screen, the shell's rim: close to white
// on the mirrorless body), which read as flat paint. The cap is split into its own child mesh here, so it can take a darker,
// slightly metallic section material and fade with its part. Drawing only: the geometry is not changed, only which
// triangles carry which material.
import * as THREE from 'three/webgpu';

/** The normal's x below which a triangle faces the removed half squarely. */
const CAP_NORMAL_X = -0.97;
/** How far (mm) a cap's corners may stray from its plane, and how close that plane lies to the part's cut edge. */
const FLAT = 0.06;

/** The section material for a cap: the part's own hue, held to a peak of `peak` (linear) with a satin metal finish. */
export function sectionCapMaterial(src: THREE.Material, peak = 0.16): THREE.MeshStandardMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const color = s.color ? s.color.clone() : new THREE.Color(0.2, 0.2, 0.2);
  const top = Math.max(color.r, color.g, color.b, 1e-6);
  // a dark part keeps its own tone; only a pale one comes down to the cap
  if (top > peak) color.multiplyScalar(peak / top);
  const m = new THREE.MeshStandardMaterial({ name: 'cutCap', color, metalness: 0.45, roughness: 0.52, envMapIntensity: 0.9 });
  if (s.envMap) m.envMap = s.envMap;
  return m;
}

/** The indices (in groups of three) of `mesh`'s triangles that are cut faces: facing -x, flat in x, lying on the part's
 *  minimum x in the space of `mesh.matrixWorld`. */
export function findCapTriangles(mesh: THREE.Mesh): number[] {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return [];
  const index = g.getIndex();
  const count = index ? index.count : pos.count;
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const at = (i: number) => (index ? index.getX(i) : i);
  // the part's minimum x
  let minX = Infinity;
  for (let i = 0; i < pos.count; i++) minX = Math.min(minX, a.fromBufferAttribute(pos, i).applyMatrix4(m).x);
  const caps: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    a.fromBufferAttribute(pos, at(t)).applyMatrix4(m);
    b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(m);
    c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(m);
    if (Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x) > FLAT) continue;
    if (Math.min(a.x, b.x, c.x) - minX > 0.1) continue;
    n.crossVectors(e.subVectors(b, a), c.clone().sub(a));
    const len = n.length();
    if (len < 1e-12 || n.x / len > CAP_NORMAL_X) continue;
    caps.push(t);
  }
  return caps;
}

/** Moves the cut-face triangles of `mesh` into a child mesh with `capMat`; returns it, or null when the part has none. The
 *  parent keeps its other triangles and its material. Run with the mesh's world matrix up to date. */
export function splitSectionCap(mesh: THREE.Mesh, capMat: THREE.Material): THREE.Mesh | null {
  const caps = findCapTriangles(mesh);
  if (!caps.length) return null;
  const g = mesh.geometry;
  const index = g.getIndex();
  const total = index ? index.count : g.getAttribute('position').count;
  const at = (i: number) => (index ? index.getX(i) : i);
  const isCap = new Set(caps);
  const rest: number[] = [], cap: number[] = [];
  for (let t = 0; t + 2 < total; t += 3) {
    const out = isCap.has(t) ? cap : rest;
    out.push(at(t), at(t + 1), at(t + 2));
  }
  const share = (indices: number[]) => {
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
    geo.setIndex(indices);
    return geo;
  };
  mesh.geometry = share(rest);
  const child = new THREE.Mesh(share(cap), capMat);
  child.name = `${mesh.name}Cap`;
  child.userData.cutCap = true;
  child.renderOrder = mesh.renderOrder;
  mesh.add(child);
  return child;
}

/** Gives the cut faces of every cutaway half under `root` (a part flagged cutaway 'half', or the cut shell) their own section
 *  material. `skip` names a material to leave alone (the cutaway glass). Run once per loaded model. */
export function capCutParts(root: THREE.Object3D, skip?: THREE.Material | null): void {
  root.updateMatrixWorld(true);
  const isCutPart = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.userData?.cutaway === 'half' || n.userData?.component === 'shellCut') return true; return false; };
  const parts: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.userData.cutCap || !isCutPart(m)) return;
    if (/^(lensGlass|pfLayer|cutGlass|glassSheen|cutCap)/.test(m.material.name ?? '') || m.material === skip) return;
    if (!('color' in m.material)) return;
    parts.push(m);
  });
  // The cut shell's own walls (score loop r4): its wide flat inner faces mirrored the key softbox through the paint's clearcoat
  // and read as one flat near-white plane (the wedge inside the viewfinder hump sampled luma 0.8). The shell is seen only in the
  // cutaway, so its paint is a copy without the clearcoat, rougher and with less reflection: the faces keep a tone of their own.
  const calmed = new Map<THREE.Material, THREE.Material>();
  for (const m of parts) {
    let shell = false;
    for (let n: THREE.Object3D | null = m; n; n = n.parent) if (n.userData?.component === 'shellCut') shell = true;
    if (!shell) continue;
    let c = calmed.get(m.material as THREE.Material);
    if (!c) {
      const s = (m.material as THREE.MeshPhysicalMaterial).clone();
      s.name = `${s.name}Cut`;
      if ('clearcoat' in s) s.clearcoat = 0;
      s.roughness = Math.max(s.roughness ?? 0, 0.6);
      s.envMapIntensity = Math.min(s.envMapIntensity ?? 1, 0.85);
      c = s;
      calmed.set(m.material as THREE.Material, c);
    }
    m.material = c;
  }
  const made = new Map<THREE.Material, THREE.Material>();
  for (const m of parts) {
    let cap = made.get(m.material as THREE.Material);
    if (!cap) { cap = sectionCapMaterial(m.material as THREE.Material); made.set(m.material as THREE.Material, cap); }
    splitSectionCap(m, cap);
  }
}
