// The lineup lenses' real barrels (public/models/lenses/<id>.glb, built by blender/lens_v2.py from the makers'
// published diameters, lengths and filter sizes) for the lens cutaway. Only the housing is used here: the GLB's
// own glass and its still iris are hidden, because the cutaway draws the engine's glass (elements.ts) and the
// engine's live iris (iris.ts) at the current focus and f-number. The GLB frame is mm with the sensor plane at
// z = 0 and the lens toward -z (public/models/lenses.json "note"); this piece's frame is the engine's optical z,
// so the caller places the returned root at the image plane's engine z.
//
// Revolved parts come in pairs in the GLB: extras.cutaway "full" (the outside view) and "half" (x >= 0, the
// section capped). The cutaway shows the halves. Their flat cut faces are split off into their own meshes and
// given a lighter section material, the convention of a maker's cutaway photograph, so the wall thickness of
// every ring and cell reads at a glance instead of disappearing into black paint on a black ground.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type * as look from '../../app/look';
import lensFacts from '../../../public/models/lenses.json';

interface LensFact { glb: string; lengthMm: number; diameterMm: number; flangeMm: number; label: string }
const LENSES = (lensFacts as unknown as { lenses: Record<string, LensFact> }).lenses;

export function hasGlb(lensId: string): boolean {
  return Boolean(LENSES[lensId]?.glb);
}

export function lensFact(lensId: string): LensFact | null {
  return LENSES[lensId] ?? null;
}

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<THREE.Group>>();

function getLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader().setDecoderPath(new URL('./draco/', location.href).href).setDecoderConfig({ type: 'js' });
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}

function loadRaw(lensId: string): Promise<THREE.Group> {
  const fact = LENSES[lensId];
  const path = `./${fact.glb.replace(/^public\//, '')}`;
  let p = cache.get(path);
  if (!p) {
    p = getLoader().loadAsync(new URL(path, location.href).href).then((g) => g.scene as unknown as THREE.Group).catch(error => {
      cache.delete(path);
      throw error;
    });
    cache.set(path, p);
  }
  return p;
}

export interface GlbBarrel {
  root: THREE.Group;
  /** The barrel's own outer radius (mm), for framing and pin placement. */
  outerR: number;
  /** z range (GLB frame: sensor at 0, front negative) of the housing. */
  zFront: number;
  zBack: number;
  dispose(): void;
}

interface Mats {
  paint: THREE.Material; paintCut: THREE.Material;
  baffle: THREE.Material; baffleCut: THREE.Material;
  rubber: THREE.Material; rubberCut: THREE.Material;
  chrome: THREE.Material; engraving: THREE.Material; window: THREE.Material; contacts: THREE.Material;
}

function makeMats(lookMod: typeof look): Mats {
  // Satin black paint over aluminum: LOOK.md's anodized barrel, a little less metallic than the table's 1.0 so
  // the upper-hemisphere highlight rakes across it as a soft sheen instead of a mirror streak.
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1a1b1f, metalness: 0.55, roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.32 });
  // The machined section: bare aluminum where the wedge was cut, a dull --metal-cool taken down toward
  // --anodize-black so the section reads as the same black barrel sliced, not a separate blue-gray part (R1-12).
  const paintCut = new THREE.MeshPhysicalMaterial({ color: 0x777d82, metalness: 0.7, roughness: 0.44 });
  const baffle = lookMod.matteInternalMaterial();
  const baffleCut = new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.72, metalness: 0.3 });
  const rubber = lookMod.rubberGripMaterial();
  const rubberCut = new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.85, metalness: 0 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0x80858c, metalness: 1, roughness: 0.34 });
  const engraving = new THREE.MeshStandardMaterial({ color: 0xd1d1cc, roughness: 0.55, metalness: 0 });
  const windowMat = new THREE.MeshPhysicalMaterial({ color: 0xe6ecf2, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.14 });
  const contacts = new THREE.MeshPhysicalMaterial({ color: 0xd4a84a, metalness: 1, roughness: 0.28 });
  return { paint, paintCut, baffle, baffleCut, rubber, rubberCut, chrome, engraving, window: windowMat, contacts };
}

/** Splits `geo`'s triangles into the flat section faces (normal along +-x, lying in the x = 0 cut plane) and
 *  everything else. Non-indexed copies; both halves keep the source normals. */
function splitCut(geo: THREE.BufferGeometry): { rest: THREE.BufferGeometry; cut: THREE.BufferGeometry | null } {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nrm) return { rest: src, cut: null };
  const restP: number[] = [], restN: number[] = [], cutP: number[] = [], cutN: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    let isCut = true;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(nrm.getX(t + k)) < 0.985 || Math.abs(pos.getX(t + k)) > 0.35) { isCut = false; break; }
    }
    const P = isCut ? cutP : restP, N = isCut ? cutN : restN;
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      N.push(nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k));
    }
  }
  const mk = (P: number[], N: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.computeBoundingSphere();
    return g;
  };
  return { rest: mk(restP, restN), cut: cutP.length ? mk(cutP, cutN) : null };
}

function worldCenterX(o: THREE.Object3D): number {
  const b = new THREE.Box3().setFromObject(o);
  return (b.min.x + b.max.x) / 2;
}

/** Loads (cached) and prepares a fresh housing for `lensId`. Resolves null if the lens has no GLB. */
export async function loadGlbBarrel(lensId: string, lookMod: typeof look): Promise<GlbBarrel | null> {
  if (!hasGlb(lensId)) return null;
  const raw = await loadRaw(lensId);
  const src = raw.clone(true);
  src.updateMatrixWorld(true);
  const mats = makeMats(lookMod);
  const root = new THREE.Group();
  root.name = `lens-housing-${lensId}`;
  const made: THREE.BufferGeometry[] = [];

  // Decide visibility per node from its GLB extras, walking parents for the "full"/"half" tag.
  const tagOf = (o: THREE.Object3D): { cutaway?: string; component?: string } => {
    let cur: THREE.Object3D | null = o;
    let cutaway: string | undefined;
    let component: string | undefined;
    while (cur) {
      const ud = cur.userData ?? {};
      if (!cutaway && ud.cutaway) cutaway = ud.cutaway;
      if (!component && ud.component) component = ud.component;
      cur = cur.parent;
    }
    return { cutaway, component };
  };

  const meshes: THREE.Mesh[] = [];
  src.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    const { cutaway, component } = tagOf(mesh);
    if (cutaway === 'full') continue;
    if (component === 'glass' || /^element\d+/.test(component ?? '') || component === 'irisBlades' || component === 'irisBladesCut') continue;
    const matName = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
    if (/^lensGlass|^pfLayer|^irisBlade/.test(matName)) continue;
    // Parts with no section of their own (switches, lugs, marks) are kept only on the half that stays.
    if (cutaway !== 'half' && worldCenterX(mesh) < -2) continue;

    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    let body: THREE.Material, section: THREE.Material | null = null;
    if (/^barrelPaint|^knurlPlastic/.test(matName)) { body = mats.paint; section = mats.paintCut; }
    else if (/^lensBaffle/.test(matName)) { body = mats.baffle; section = mats.baffleCut; }
    else if (/^ringRubber/.test(matName)) { body = mats.rubber; section = mats.rubberCut; }
    else if (/^mountChrome/.test(matName)) { body = mats.chrome; section = mats.paintCut; }
    else if (/^engraving/.test(matName)) body = mats.engraving;
    else if (/^windowGlass/.test(matName)) body = mats.window;
    else if (/^lensContacts/.test(matName)) body = mats.contacts;
    else body = mats.paint;

    if (cutaway === 'half' && section) {
      const { rest, cut } = splitCut(geo);
      geo.dispose();
      const a = new THREE.Mesh(rest, body);
      a.frustumCulled = false;
      root.add(a);
      made.push(rest);
      if (cut) {
        const c = new THREE.Mesh(cut, section);
        c.frustumCulled = false;
        root.add(c);
        made.push(cut);
      }
    } else {
      const a = new THREE.Mesh(geo, body);
      a.frustumCulled = false;
      root.add(a);
      made.push(geo);
    }
  }
  box.setFromObject(root);
  const outerR = Math.max(Math.abs(box.min.y), Math.abs(box.max.y), box.max.x);
  return {
    root,
    outerR,
    zFront: box.min.z,
    zBack: box.max.z,
    dispose() {
      for (const g of made) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
