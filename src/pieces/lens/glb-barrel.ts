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
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { BlendedLineMaterial } from '../blended-line-material';
import { dracoLoader } from '../../scene/draco';
import { takePrefetched } from '../../app/warm';
import { lensGlbPath } from '../../app/lens-file';
import type * as look from '../../app/look';
import lensFacts from 'virtual:p2p-facts/lenses';

interface LensFact { glb: string; glbLite?: string; lengthMm: number; diameterMm: number; flangeMm: number; label: string }
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
    const draco = dracoLoader();
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}

function loadRaw(lensId: string): Promise<THREE.Group> {
  const fact = LENSES[lensId];
  const path = `./${lensGlbPath(fact)}`;   // the phone variant on a phone-width screen (score loop r6)
  let p = cache.get(path);
  if (!p) {
    const url = new URL(path, location.href).href;
    // bytes the opening fetched ahead (src/app/warm.ts) are parsed from memory; a failed prefetch fetches again
    const ahead = takePrefetched(url);
    p = (ahead ? ahead.then(buf => getLoader().parseAsync(buf, THREE.LoaderUtils.extractUrlBase(url)), () => getLoader().loadAsync(url)) : getLoader().loadAsync(url)).then((g) => g.scene as unknown as THREE.Group).catch(error => {
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
  /** Each material with the studio reflection strength it takes (lens.ts hands them the shared studio). */
  studioMats: [THREE.MeshStandardMaterial, number][];
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
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x24303c, vertexColors: true, metalness: 0.6, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  // The machined section: bare aluminum where the wedge was cut, a dull --metal-cool taken down toward
  // --anodize-black so the section reads as the same black barrel sliced, not a separate blue-gray part (R1-12).
  // Score loop r2: with the camera studio's panels to reflect (lens.ts), the section reads as machined aluminum, and a
  // thin clear coat lifts its edges; under the dim stage dome alone it rendered one flat slate tone.
  const paintCut = new THREE.MeshPhysicalMaterial({ color: 0x8e99a1, vertexColors: true, metalness: 0.8, roughness: 0.34, clearcoat: 0.2, clearcoatRoughness: 0.3 });
  // The spacers and baffles inside the barrel: anodized black aluminum (LOOK.md --anodize-black) at roughness 0.5,
  // so they take the studio's soft highlights instead of reading as near-black boxes in the open cutaway (r2). Their
  // cut faces are the same metal, bare, a step lighter.
  // score loop r6: a step lighter than --anodize-black (0x17181b), with a gradient along the barrel (gradeByDepth), so the
  // interior behind the rear groups reads as a dark anodized wall and not as a black ellipse
  const baffle = new THREE.MeshPhysicalMaterial({ color: 0x6a707a, vertexColors: true, metalness: 0.35, roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.3 });
  const baffleCut = new THREE.MeshPhysicalMaterial({ color: 0x5a6068, vertexColors: true, metalness: 0.7, roughness: 0.4 });
  // score loop r4: a machined texture on the section faces (look.ts machinedSectionTexture, mapped planar in splitCut), so each is a
  // lit surface with a sheen and a lathe grain and not one flat tone
  const machined = lookMod.machinedSectionTexture();
  if (machined) { (paintCut as THREE.MeshPhysicalMaterial).map = machined; (baffleCut as THREE.MeshPhysicalMaterial).map = machined; }
  const rubber = lookMod.rubberGripMaterial();
  // score loop r6: the focus ring's bore is seen from inside in the cutaway and read as a black ellipse (0x0a0a0c); a graphite rubber
  // with the studio on it (studioMats) shows its curve
  rubber.color.set(0x2a2d33); rubber.roughness = 0.62;
  const rubberCut = new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.85, metalness: 0 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0x80858c, metalness: 1, roughness: 0.34 });
  const engraving = new THREE.MeshStandardMaterial({ color: 0xd1d1cc, roughness: 0.55, metalness: 0 });
  const windowMat = new THREE.MeshPhysicalMaterial({ color: 0xe6ecf2, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.14 });
  const contacts = new THREE.MeshPhysicalMaterial({ color: 0xd4a84a, metalness: 1, roughness: 0.28 });
  return { paint, paintCut, baffle, baffleCut, rubber, rubberCut, chrome, engraving, window: windowMat, contacts };
}


/** Writes a per-vertex brightness (score loop r6) so the housing is not one flat tone: the interior grows darker toward
 *  the rear groups (deep in the barrel), a little lighter toward the top (the key light), and a cut face takes a soft
 *  top-front to bottom-rear gradient, so each section reads as a lit machined face. Linear in position, so it
 *  interpolates exactly across a face's few triangles. */
function gradeColors(geo: THREE.BufferGeometry, zFront: number, zBack: number, section: boolean): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const span = Math.max(1, zBack - zFront);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getZ(i) - zFront) / span, 0, 1.2);
    const v = THREE.MathUtils.clamp(pos.getY(i) / 36, -1, 1);
    const f = section ? 0.8 + 0.2 * v - 0.18 * t : (1 - 0.5 * t) * (0.9 + 0.1 * v);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.max(0.2, f);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** The boundary edges of a cut face (the edges only one triangle uses), each with the in-plane direction pointing out of the
 *  face, as [x1,y1,z1,x2,y2,z2,outY,outZ]. */
function boundaryEdges(geo: THREE.BufferGeometry): number[][] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const key = (i: number) => `${Math.round(pos.getY(i) * 400)},${Math.round(pos.getZ(i) * 400)}`;
  const edges = new Map<string, { a: number; b: number; n: number; cy: number; cz: number }>();
  for (let t = 0; t < pos.count; t += 3) {
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      const a = t + k, b = t + ((k + 1) % 3);
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(id);
      if (e) e.n++; else edges.set(id, { a, b, n: 1, cy, cz });
    }
  }
  const out: number[][] = [];
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const y1 = pos.getY(e.a), z1 = pos.getZ(e.a), y2 = pos.getY(e.b), z2 = pos.getZ(e.b);
    let ny = z2 - z1, nz = -(y2 - y1); // a normal to the edge in the (y, z) plane
    const len = Math.hypot(ny, nz);
    if (len < 1e-6) continue;
    ny /= len; nz /= len;
    if (ny * (((y1 + y2) / 2) - e.cy) + nz * (((z1 + z2) / 2) - e.cz) < 0) { ny = -ny; nz = -nz; } // point away from the face
    out.push([pos.getX(e.a), y1, z1, pos.getX(e.b), y2, z2, ny, nz]);
  }
  return out;
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
    // planar texture coordinates in the cut plane (u along the axis z, v up y; one repeat per 20 mm), for the section's finish
    const uv: number[] = [];
    for (let i = 0; i < P.length; i += 3) uv.push(P[i + 2] / 20, P[i + 1] / 20);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
  // the barrel's own z range (paint and baffle halves), for the interior's depth gradient
  let zFrontAll = Infinity, zBackAll = -Infinity;
  for (const mesh of meshes) {
    const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';
    if (!/^barrelPaint|^lensBaffle/.test(name)) continue;
    const b = new THREE.Box3().setFromObject(mesh);
    zFrontAll = Math.min(zFrontAll, b.min.z); zBackAll = Math.max(zBackAll, b.max.z);
  }
  if (!isFinite(zFrontAll)) { zFrontAll = -100; zBackAll = 0; }
  const bright: number[] = [], dark: number[] = [], mid: number[] = [];
  const vcMats = new Set<THREE.Material>([mats.paint, mats.paintCut, mats.baffle, mats.baffleCut]);
  const graded = (g: THREE.BufferGeometry, m: THREE.Material, section: boolean) => { if (vcMats.has(m)) gradeColors(g, zFrontAll, zBackAll, section); };
  // A fine pale line around every section face, like the inked edge of a maker's cutaway, so each ring and cell reads
  // as a machined part (score loop r2). Drawn a hair toward the viewer (-x) so it never fights the face for depth.
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
      graded(rest, body, false);
      const a = new THREE.Mesh(rest, body);
      a.frustumCulled = false;
      root.add(a);
      made.push(rest);
      if (cut) {
        graded(cut, section, true);
        const c = new THREE.Mesh(cut, section);
        c.frustumCulled = false;
        root.add(c);
        made.push(cut);
        // score loop r6: a bevel on every section face. Each boundary edge of the face is drawn as a pale line where it faces
        // the key light (up and toward the front) and a dark one where it faces away, a little toward the viewer so it never
        // fights the face for depth, so the ring and spacer profiles read as chamfered metal and not as flat gray cut-outs.
        for (const [x1, y1, z1, x2, y2, z2, ny, nz] of boundaryEdges(cut)) {
          const lit = 0.8 * ny - 0.6 * nz; // light from above and the front (-z)
          const seg = [x1 - 0.05, y1, z1, x2 - 0.05, y2, z2];
          if (lit > 0.2) bright.push(...seg);
          else if (lit < -0.2) dark.push(...seg);
          else mid.push(...seg);
        }
      }
    } else {
      graded(geo, body, false);
      const a = new THREE.Mesh(geo, body);
      a.frustumCulled = false;
      root.add(a);
      made.push(geo);
    }
  }
  const bevelMats: THREE.Material[] = [];
  for (const [pts, color, opacity, width] of [[bright, 0xe4ecf2, 0.55, 1.3], [mid, 0xaab6bf, 0.3, 1], [dark, 0x06080b, 0.6, 1.3]] as const) {
    if (!pts.length) continue;
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array(pts));
    const m = new BlendedLineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const l = new LineSegments2(g, m);
    l.frustumCulled = false;
    l.renderOrder = 3;
    root.add(l);
    made.push(g as unknown as THREE.BufferGeometry);
    bevelMats.push(m);
  }
  box.setFromObject(root);
  const outerR = Math.max(Math.abs(box.min.y), Math.abs(box.max.y), box.max.x);
  return {
    root,
    outerR,
    zFront: box.min.z,
    zBack: box.max.z,
    studioMats: [
      [mats.paint as THREE.MeshStandardMaterial, 1.5], [mats.paintCut as THREE.MeshStandardMaterial, 1.7],
      [mats.baffle as THREE.MeshStandardMaterial, 1.3], [mats.baffleCut as THREE.MeshStandardMaterial, 1.4],
      [mats.rubber as THREE.MeshStandardMaterial, 1.8], [mats.rubberCut as THREE.MeshStandardMaterial, 1.0],
      [mats.chrome as THREE.MeshStandardMaterial, 1.3], [mats.contacts as THREE.MeshStandardMaterial, 1.2],
    ],
    dispose() {
      for (const g of made) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
      for (const m of bevelMats) m.dispose();
    },
  };
}
