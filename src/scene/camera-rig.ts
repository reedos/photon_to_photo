// The camera: docs/PANE.md's one scene. The body and the lens are the scripted-Blender models (public/models), both
// built in the frame the engine's optics map into (sensor plane at z = 0, lens toward -z, mount face at -flange), so
// the engine's own numbers place everything inside them with no fitting:
//   - each glass element moves with focus by exactly the engine's surface displacement from infinity focus;
//   - the iris is the engine's opening outline (model.iris), rebuilt on every aperture change;
//   - the focus ring and its distance scale turn by the engine's focus travel (engine-api focusRingAngle);
//   - the light is the engine's traced ray fans, entering the front element and landing on the sensor;
//   - the rays arriving in front of the lens fill the entrance pupil (model.cardinal.ep): their spread IS the aperture.
// The piece draws; the engine computes (src/pieces/types.ts). Detail modes (iris, focus cone, sensor dive, mirror,
// shutter) come next and re-house the first-pass pieces.
import { compileInSteps, type AsyncCompiler } from './compile-steps';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dracoLoader } from './draco';
import { prefetchNeighbours, prefetchOnIntent, takePrefetched } from '../app/warm';
import type { BuildPiece, CameraFrame, PartCard, PieceProbe } from '../pieces/types';
import type { FanSet, Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { buildRays } from '../pieces/lens/rays';
import { marginalAwareFans } from '../pieces/lens/marginal-rays';
import { bodyForLens, compute, distanceForRingAngle, lensFans, pointBundle, focusRingAngle, focusRingThrow, lensSummary, type BodyId } from '../app/engine-api';
import { createExposure } from './rig-exposure';
import { overviewFrame } from './overview-frame';
import { capCutParts } from './section-caps';
import { apertureSteps, THIRD_STOP_SHUTTER } from '../app/stops';
import { LENS_FACTS as LENSES, partCard, partLabel, type PartId } from '../app/rig-cards';
import bodyFacts from 'virtual:p2p-facts/bodies';
import { lensGlbPath } from '../app/lens-file';

type View = 'outside' | 'cutaway';

// three wavelengths for the fans (blue, green, red) keep the picture readable; the spectral spread still shows
const FAN_NMS = [460, 550, 640];
const FAN_FIELDS = [0, 0.7];
const FAN_RAYS = 7;
// The glass seen from outside (FID-1): dark and deep, the coating's sheen at an angle, never a milky plug. The front
// element carries a touch more than the ones behind it so a stack of 7 to 22 elements does not add up to white; a PF
// layer looks like any other glass from outside. Blackened element edges are drawn as thin bands (see edgeBands).
let SHEEN: THREE.MeshPhysicalMaterial | null = null;
let FRONT_GLASS: THREE.MeshPhysicalMaterial | null = null;
let INNER_GLASS: THREE.MeshPhysicalMaterial | null = null;
let EDGE: THREE.MeshStandardMaterial | null = null;
let CUT_GLASS: THREE.MeshPhysicalMaterial | null = null;
// what the rest of the camera fades to while one part is picked (UI-14): see-through, never hidden
const FADE_OPACITY = 0.25;
// the brightest base color (linear) a faded part keeps, near the studio paint's own level (P-08)
const FADE_COLOR_CAP = 0.06;
// the traced light while a part is picked: there, but behind the part (R1-04)
const RAYS_DETAIL_OPACITY = 0.35;

function centerX(o: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(o);
  return (b.min.x + b.max.x) / 2;
}

/** Drawing only: the engine traces from its entry plane; the incoming ray is a straight line in air, so the view
 *  extends each ray's first segment backward along its own direction, out to `reach` mm in front of the front glass.
 *  A path whose first segment does not run forward (a ray the engine clipped at the front surface, whose two points
 *  can step backward) is left out of the drawing: extending it would throw a line far behind the camera (R2-FID-1).
 *  The extension never runs farther than reach + the lens length, whatever the direction. */
export function extendEntryPaths(fans: FanSet[], frontZ: number, reach: number, lensLengthMm: number): FanSet[] {
  const maxBack = reach + lensLengthMm;
  return fans.map((f) => ({
    ...f,
    paths: f.paths.flatMap((p) => {
      if (p.pts.length < 2) return [p];
      const [a, b] = p.pts;
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d.lengthSq() < 1e-18) return [];
      d.normalize();
      if (d.z <= 1e-3) return [];
      const back = Math.min(maxBack, Math.max(0, (a[2] - (frontZ - reach)) / d.z));
      const start: [number, number, number] = [a[0] - d.x * back, a[1] - d.y * back, a[2] - d.z * back];
      return [{ ...p, pts: [start, ...p.pts] }];
    }),
  }));
}

/** Drawing only: the kept half (x >= 0) of the blade annulus for the cutaway, so the live iris is sectioned with the
 *  barrel and the glass instead of standing whole across the cut (presentation review P-07). The opening is the
 *  engine's outline exactly; only the part on the removed half is left out. The outline is star-shaped about the
 *  axis (every iris opening is), so its x >= 0 part runs between its crossings of the y axis. */
export function halfIrisShape(outline: [number, number][], rOuter: number): THREE.Shape {
  const n = outline.length;
  // where a ray from the axis at angle t crosses the outline
  const cross = (t: number): [number, number] => {
    const dx = Math.cos(t), dy = Math.sin(t);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % n];
      const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
      if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, s);
    }
    return Number.isFinite(best) ? [dx * best, dy * best] : [0, 0];
  };
  const inner = outline.filter(([x]) => x > 0).map((p) => ({ p, a: Math.atan2(p[1], p[0]) })).sort((a, b) => b.a - a.a);
  const shape = new THREE.Shape();
  shape.moveTo(0, -rOuter);
  shape.absarc(0, 0, rOuter, -Math.PI / 2, Math.PI / 2, false);
  const top = cross(Math.PI / 2), bottom = cross(-Math.PI / 2);
  shape.lineTo(top[0], top[1]);
  for (const { p } of inner) shape.lineTo(p[0], p[1]);
  shape.lineTo(bottom[0], bottom[1]);
  shape.closePath();
  return shape;
}

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'camera-rig';
  const assembly = new THREE.Group();
  group.add(assembly);

  // studio lights for black paint on a black stage (FID-8): key, fill, a strong rim from behind-right-high and a cool
  // kicker from behind-left-low. They live in this group, so they go when the piece hides; the studio environment
  // (softbox panels for long highlights on the curved paint) is swapped in on activate and back out on deactivate.
  ctx.look.addStudioLights(group);
  // The one studio environment of this renderer, which the deep levels use too (look.sharedStudioTexture): the rig used to bake a
  // PMREM of its own, and the first idle moment baked the same thing again for the deep levels (0.3 s each on a 4x phone, score loop r5).
  const sharedStudio = ctx.look.sharedStudioTexture(ctx.renderer);
  const studio = sharedStudio ? { texture: sharedStudio, dispose() { /* the renderer's, not this rig's */ } } : ctx.look.buildStudioEnvironment(ctx.renderer);
  const ground = ctx.look.groundGlow(1);
  group.add(ground);
  const contact = ctx.look.contactShadow();
  group.add(contact);
  FRONT_GLASS ??= ctx.look.opticalGlassMaterial(true);
  INNER_GLASS ??= ctx.look.opticalGlassMaterial(false);
  EDGE ??= ctx.look.elementEdgeMaterial();
  CUT_GLASS ??= ctx.look.cutawayGlassMaterial(1.6, false);

  // the light: traced fans (engine frame, shifted so the sensor sits at z = 0) and the entrance-pupil bundle
  const raysGroup = new THREE.Group();
  const rays = buildRays(ctx.look);
  // the three wavelengths coincide in the air in front of the lens: drawn additively they sum to white light there
  // and split into their own exact colors only where the glass disperses them (no depth fighting between them)
  const rayMat = rays.mesh.material as THREE.Material;
  rayMat.transparent = true; rayMat.depthWrite = false; rayMat.blending = THREE.AdditiveBlending;
  // after the glass (renderOrder 2..3): the coated elements must never blend their tint over a computed ray color,
  // which reaches the screen exactly as the engine colors it; opaque parts still hide rays behind them by depth
  rays.mesh.renderOrder = 5;
  raysGroup.add(rays.mesh);
  group.add(raysGroup);
  // The entrance-pupil sleeve that used to stand in front of the lens is gone (score loop r1): additive in linear
  // light, even a 0.018 opacity encoded to a gray haze wedge (35/255 over a 1/255 void) in front of the 500 mm hood,
  // the glow LOOK.md rules out. The computed rays alone show the bundle the lens takes in; its width is still the
  // entrance pupil (state.epR, the iris mode's ring).

  // the live iris: the engine's opening outline cut from a blade annulus at the stop plane
  // blackened steel (design/LOOK.md, iris blades): dark, but metallic enough to pick up the studio panels, so the
  // annulus reads as sheet metal rather than a hole in the picture (P-03)
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.8, roughness: 0.42, envMapIntensity: 1.3, side: THREE.DoubleSide });
  // in the iris mode the blades are what the reader came to see: lit steel with a little of its own light, so they
  // read against the dark barrel behind them (R1-04)
  // score loop r4: lighter metal (0x9aa1ac, was 0x5a5f68) with a little more light of its own, so the blades are not dark gray on a
  // dark bore
  const irisLitMat = new THREE.MeshStandardMaterial({ color: 0x9aa1ac, metalness: 0.55, roughness: 0.3, emissive: 0x3a3e46, side: THREE.DoubleSide });
  const iris = new THREE.Mesh(new THREE.BufferGeometry(), irisMat);
  iris.name = 'live-iris';
  iris.visible = false; // No position buffer exists until the first optical model is applied.
  group.add(iris);
  // each blade's edge, drawn over the lit annulus in the iris mode so the blades read as blades, not a flat disk
  const bladeEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x08090b, transparent: true, opacity: 0.9 }));
  bladeEdges.visible = false;
  iris.add(bladeEdges);
  // the opening's own edge in the iris mode, a pale line the engine's outline exactly (score loop r4): the blades' dark edge
  // lines alone left the polygon the reader came to see as thin dark gray on a dark bore
  const openingEdge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf1f4f9, toneMapped: false, transparent: true, opacity: 0.95 }));
  openingEdge.visible = false;
  iris.add(openingEdge);

  // Unit focusing (every element shares one shift, as in the n500fl's prescription): the whole lens moves with its
  // glass, so nothing leaves the housing, and a helicoid sleeve fills the gap it opens at the mount (R1-FID-C). The
  // shift is the engine's; the sleeve is drawing. Built lazily per lens, full round outside and half in the cutaway.
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide });
  const sleeve = new THREE.Group();
  sleeve.name = 'focus-sleeve';
  // An illustrative two-stage drawtube: a broader lens-side section and a recessed body-side section.
  // The overlap and turned shoulders give a long extension a mechanical shape; its travel remains engine-driven.
  const sleeveProfile = [
    [1.05, -0.5], [1.08, -0.48], [1.08, -0.08], [1.07, -0.06],
    [1, -0.06], [1, 0.48], [0.98, 0.5], [0.94, 0.5], [0.94, -0.5], [1.05, -0.5],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const sleeveFull = new THREE.Mesh(new THREE.LatheGeometry(sleeveProfile, 72), sleeveMat);
  const sleeveHalf = new THREE.Mesh(new THREE.LatheGeometry(sleeveProfile, 36, 0, Math.PI), sleeveMat);
  for (const m of [sleeveFull, sleeveHalf]) { m.rotation.x = Math.PI / 2; sleeve.add(m); }
  // a thin lit lip where the sleeve meets the body, so the sleeve reads as the barrel's own inner tube run out, not
  // an adapter (R2-FID-5); full round outside, half in the cutaway like the sleeve
  const sleeveEdgeMat = new THREE.MeshStandardMaterial({ color: ctx.look.MATERIAL_COLORS.metalCool, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const edgeFull = new THREE.Mesh(new THREE.CylinderGeometry(1.025, 1.025, 1, 72, 1, true), sleeveEdgeMat);
  const edgeHalf = new THREE.Mesh(new THREE.CylinderGeometry(1.025, 1.025, 1, 36, 1, true, 0, Math.PI), sleeveEdgeMat);
  for (const m of [edgeFull, edgeHalf]) { m.rotation.x = Math.PI / 2; sleeve.add(m); }
  sleeve.visible = false;
  group.add(sleeve);
  let unitShift = 0;

  // the on-axis traced paths in world coordinates, for the photons the exposure streams along them
  let axisPaths: { pts: THREE.Vector3[]; color: THREE.Color }[] = [];
  // Firing from outside shows nothing of the mechanism, so the view opens to the cutaway for the shot and closes
  // again after it (UI-22).
  let restoreView: View | null = null;
  const exposure = createExposure({
    group, overlay: ctx.overlay, badge: ctx.badge,
    body: () => (state.body || 'dslr') as 'dslr' | 'mirrorless',
    model: () => lastModel,
    paths: () => axisPaths,
    node: (n) => assembly.getObjectByName(n),
    onMirror: (up) => { mirrorUp = up; if (lastModel) applyModel(lastModel); },
    beforeFire: () => { teach.stop(); if (view === 'outside' && !detail) { restoreView = 'outside'; setView('cutaway'); } },
    afterFire: () => { if (restoreView && !detail) setView(restoreView); restoreView = null; },
    set: (p) => ctx.bus.emit('scenario-set', p),
  });
  exposure.el.dataset.inset = 'left';
  // shown only while this level is (activate/deactivate); a build for a hook alone must not put it on a deep dive (R1-01)
  exposure.el.hidden = true;
  let mirrorUp = false;
  let raysOn = true;
  const offLayer = ctx.bus.on('layer', (e) => { if (e.id === 'rays') { raysOn = e.on; if (lastModel) updateExtras(lastModel); } });
  const offPause = ctx.bus.on('pause-exposure', () => exposure.pause());

  // The exposure panel sits in the view's left rail (with the docked final image under it) on a wide screen and
  // becomes a strip under the view on a phone (UI-11).
  const strip = typeof document !== 'undefined' ? document.getElementById('view-strip') : null;
  const rail = typeof document !== 'undefined' ? document.getElementById('hud-rail') : null;
  const phoneMq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  const placePanel = () => {
    const workspace = document.getElementById('studio-exposure');
    if (workspace) {
      workspace.append(exposure.el);
      exposure.el.removeAttribute('data-inset');
      if (!exposure.el.querySelector('.exposure-details')) {
        const details = document.createElement('details');
        details.className = 'exposure-details';
        details.innerHTML = '<summary>Exposure details & equal exposure</summary>';
        for (const node of exposure.el.querySelectorAll('.rx-k, .rx-pprow, .rx-total, .rx-well, .rx-sub, .rx-motion, .rx-tl, .rx-eq, .rx-cap, .rx-time')) details.append(node);
        exposure.el.append(details);
      }
    }
    else if (phoneMq?.matches && strip) strip.appendChild(exposure.el);
    else if (rail) rail.prepend(exposure.el);
    else ctx.overlay.appendChild(exposure.el);
  };
  placePanel();
  phoneMq?.addEventListener('change', placePanel);


  const draco = dracoLoader();
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const cache = new Map<string, Promise<THREE.Group>>();
  let bodyRoot: THREE.Group | null = null;
  let lensRoot: THREE.Group | null = null;
  let rigKey = '';
  let loading: Promise<void> | null = null;
  let view: View = 'outside';
  /** The view a pick switched away from (a glass, sensor, shutter or viewfinder pick opens the cutaway; the focus ring and the iris
   *  the outside), given back when the selection clears. A view the reader chose with the switch is theirs: it forgets this. */
  let viewBeforePick: View | null = null;
  let lastModel: Model | null = null;
  let lastScenario: Scenario | null = null;
  let infinityModel: Model | null = null;
  let selected: string | null = null;
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const state = { lens: '', body: '' as BodyId | '', ringAngle: 0, irisRadius: 0, elementShift: [] as number[], rays: 0, epR: 0, reflected: 0 };

  // ---- the Outside / Cutaway switch: in the view's one column of chrome, top right (UI-01) ---------------------
  // It sits in the stage's HUD slot, beside the Rays chip, so it can never land on Reset view and Share again; it is
  // shown only while this level is.
  const viewSwitch = document.createElement('div');
  viewSwitch.className = 'mode rig-view';
  viewSwitch.setAttribute('role', 'group');
  viewSwitch.setAttribute('aria-label', 'View');
  viewSwitch.innerHTML = '<button type="button" data-view="outside" aria-pressed="true">Outside</button><button type="button" data-view="cutaway" aria-pressed="false">Cutaway</button>';
  (document.getElementById('hud-view-slot') ?? ctx.overlay).appendChild(viewSwitch);
  viewSwitch.hidden = true;
  viewSwitch.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view as View)));
  ctx.overlay.insertAdjacentHTML('afterbegin', '<p class="rig-note" hidden></p>');
  const note = ctx.overlay.querySelector('.rig-note') as HTMLElement;

  // The veil's Retry after a failed model: load the same rig again in place, keeping the page and its settings.
  const offRetry = ctx.bus.on('piece-retry', (e) => {
    if (e.id !== 'camera' || !lastScenario || rigKey) return;
    loading = ensureRig(lastScenario.lens);
  });

  // loading progress across the body and the lens, for the stage's veil (UI-21)
  const progress = new Map<string, number>();
  let everLoaded = false;
  // The rig generation whose load failed. The other model of a failed pair keeps downloading, and its progress must
  // not repaint "Loading the camera" over the error (score loop r1: the veil hung at 50% with no Retry).
  let failedGeneration = -1;
  function reportProgress() {
    if (everLoaded || failedGeneration === rigGeneration) return;
    const vals = [...progress.values()];
    const f = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, progress: Math.min(0.95, f * 0.9 + 0.05), label: 'Loading the camera' });
  }
  function load(path: string): Promise<THREE.Group> {
    let p = cache.get(path);
    if (!p) {
      progress.set(path, 0);
      const url = new URL(path, location.href).href;
      const fetchModel = () => loader.loadAsync(url, (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) { progress.set(path, e.loaded / e.total); reportProgress(); }
      });
      // bytes the opening fetched ahead (src/app/warm.ts) are parsed from memory; a failed prefetch fetches again
      const ahead = takePrefetched(url);
      p = (ahead ? ahead.then(buf => loader.parseAsync(buf, THREE.LoaderUtils.extractUrlBase(url)), fetchModel) : fetchModel()).then((g) => { progress.set(path, 1); return prepare(g.scene); }).catch((error) => {
        cache.delete(path);
        throw error;
      });
      cache.set(path, p);
    }
    return p;
  }

  /** The cut faces of the cutaway halves get their own darker section material, in a child mesh that fades with its part
   *  (score loop r4, src/scene/section-caps.ts): they lay as the brightest flat planes in the view. */
  function capCuts(root: THREE.Object3D) { capCutParts(root, CUT_GLASS); }

  function prepare(root: THREE.Group): THREE.Group {
    root.updateMatrixWorld(true);
    const inFront = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element01(Cut)?$/.test(n.name)) return true; return false; };
    const inCut = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element\d+Cut$/.test(n.name) || n.userData?.cutaway === 'half') return true; return false; };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) {
        const n = mesh.material.name ?? '';
        if (/^(lensGlass|pfLayer)/.test(n)) {
          // The cut halves are seen side-on, one or two layers deep, so the outside view's near-black, nearly
          // transparent tint (built so a 7 to 22 element stack seen down the axis never sums to white) left the
          // sectioned glass invisible against the dark cells: the cutaway read as rays crossing an empty tube
          // (presentation review P-01). The sections get the lens piece's own pale coated-glass finish.
          mesh.material = inCut(mesh) ? CUT_GLASS! : inFront(mesh) ? FRONT_GLASS! : INNER_GLASS!;
          // the front element's reflection, added over its tinted glass so it is not a black hole from outside (P-12)
          if (!inCut(mesh) && inFront(mesh) && !mesh.getObjectByName('glassSheen')) {
            SHEEN ??= ctx.look.glassSheenMaterial(studio.texture);
            const sheen = new THREE.Mesh(mesh.geometry, SHEEN);
            sheen.name = 'glassSheen';
            sheen.renderOrder = 4;
            mesh.add(sheen);
          }
          // back to front along the axis, so the stack composites in order seen from the front
          const b = new THREE.Box3().setFromObject(mesh);
          mesh.renderOrder = 2 + Math.round(-b.min.z) / 1000;
        } else {
          // the sensor's silicon and the viewfinder's dark glass replace their export stand-ins (R1-04); every
          // finished surface gets its pebble or paint grain from the extras (R1-FID-B)
          mesh.material = ctx.look.studioReplacement(mesh.material) ?? mesh.material;
          ctx.look.tuneStudioMaterial(mesh.material);
          // the mirror's turned studio needs the studio as its own envMap (look.ts MirrorSurface, score loop r3)
          if (mesh.material.name === 'MirrorSurface') (mesh.material as THREE.MeshStandardMaterial).envMap = studio.texture;
          ctx.look.applySurfaceFinish(mesh.material, phoneMq?.matches ? 0.7 : 1);
        }
      }
      const c = o.userData?.component as string | undefined;
      // the Blender iris is a still at one stop; the live one replaces it
      if (c === 'irisBlades' || c === 'irisBladesCut') o.userData.replaced = true;
      if (c && !o.userData.cutaway && !['mount', 'mountLugs', 'contacts', 'mountBoss', 'body', 'lens', 'glass', 'shellClosed', 'shellCut'].includes(c)
          && centerX(o) < -2 && !isInside(c)) o.userData.onRemovedHalf = true;
    });
    const top = root.getObjectByName('body') ?? root.getObjectByName('lens') ?? root;
    top.children.forEach((o) => {
      if (!o.userData?.component && !o.userData.cutaway && (o as THREE.Mesh).isMesh && centerX(o) < -2) o.userData.onRemovedHalf = true;
    });
    edgeBands(root);
    sectionMount(root);
    capCuts(root);
    return root;
  }

  /** The body's lens mount (its ring, lugs, boss and throat) is revolved with no cut half in the export, so in the cutaway its near half stood
   *  across the section and hid the traced light between the rear element and the mirror (score loop r1). Drawing
   *  only: the kept half is the same mesh's own triangles whose centroid lies on the far side (x >= 0), shown in the
   *  cutaway in place of the whole ring, like the lens's own barrelCut and lensMountCut. */
  function sectionMount(root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    for (const name of ['mount', 'mountLugs', 'mountBoss', 'mountThroat']) {
      const node = root.getObjectByName(name);
      if (!node || node.userData.cutaway) continue;
      node.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && !m.userData.cutaway) meshes.push(m); });
    }
    const inv = new THREE.Matrix4(), toRoot = new THREE.Matrix4(), v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    for (const m of meshes) {
      const g = m.geometry, pos = g.attributes.position;
      if (!pos) continue;
      toRoot.multiplyMatrices(inv, m.matrixWorld);
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
      const keep: number[] = [];
      for (let t = 0; t + 2 < idx.length; t += 3) {
        let cx = 0;
        for (let k = 0; k < 3; k++) cx += v.fromBufferAttribute(pos, idx[t + k]).applyMatrix4(toRoot).x;
        if (cx / 3 >= -0.05) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      if (!keep.length || keep.length === idx.length) continue;
      const half = g.clone();
      half.setIndex(keep);
      const cut = new THREE.Mesh(half, m.material);
      cut.name = `${m.name}Cut`;
      cut.position.copy(m.position); cut.quaternion.copy(m.quaternion); cut.scale.copy(m.scale);
      cut.renderOrder = m.renderOrder;
      cut.userData.cutaway = 'half';
      m.userData.cutaway = 'full';
      (m.parent ?? root).add(cut);
    }
  }

  /** The blackened edge of each element: a thin band at the element's outer radius, over the axial span its rim
   *  vertices cover, added to the element's own node so it moves with focus and follows the cutaway (FID-1). */
  function edgeBands(root: THREE.Object3D) {
    const nodes: THREE.Object3D[] = [];
    root.traverse((o) => { if (/^element\d+(Cut)?$/.test(o.name)) nodes.push(o); });
    const inv = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const node of nodes) {
      node.updateWorldMatrix(true, true);
      inv.copy(node.matrixWorld).invert();
      const pts: THREE.Vector3[] = [];
      node.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || !m.geometry?.attributes?.position) return;
        const pos = m.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 4000));
        for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv).clone());
      });
      if (pts.length < 8) continue;
      let r = 0, sx = 0;
      for (const q of pts) { r = Math.max(r, Math.hypot(q.x, q.y)); sx += q.x; }
      let z0 = Infinity, z1 = -Infinity;
      for (const q of pts) if (Math.hypot(q.x, q.y) > r * 0.97) { z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
      if (!Number.isFinite(z0) || r < 1) continue;
      if (z1 - z0 < 0.3) { z0 -= 0.15; z1 += 0.15; }
      const cut = /Cut$/.test(node.name);
      const [a0, a1] = !cut ? [0, Math.PI * 2] : sx >= 0 ? [-Math.PI / 2, Math.PI / 2] : [Math.PI / 2, Math.PI * 1.5];
      const band = new THREE.Mesh(ctx.look.edgeBandGeometry(r * 1.003, z0, z1, a0, a1), EDGE!);
      band.name = `${node.name}Edge`;
      band.userData.edgeBand = true;
      node.add(band);
    }
  }

  const INSIDE = new Set(['mirrorBox', 'mirror', 'subMirror', 'focusingScreen', 'prism', 'prismHousing', 'shutter',
    'shutterCurtainFront', 'shutterCurtainRear', 'filterStack', 'pixelArray', 'sensorDie', 'sensorPackage', 'bondWires',
    'ibisPlate', 'ibisActuators', 'ibisYoke', 'lightBox', 'evfPanel', 'evfPanelCarrier', 'eyepieceOptics', 'battery', 'afModule', 'glass', 'cells',
    'irisHousing']);
  /** The sensor's package frame in dark ceramic, so only the silicon carries light: the model's near-white frame read as
   *  a pale slab in the sensor mode (R2-02). Drawing only; the part's size and place are the model's. */
  let PACKAGE_MAT: THREE.MeshStandardMaterial | null = null;
  function darkenSensorPackage(root: THREE.Object3D) {
    PACKAGE_MAT ??= new THREE.MeshStandardMaterial({ name: 'sensorPackageDark', color: ctx.look.MATERIAL_COLORS.anodizeBlack, roughness: 0.55, metalness: 0.1 });
    for (const n of ['sensorPackage', 'sensorPackageCut']) {
      root.getObjectByName(n)?.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.name.startsWith('sensorPackage')) m.material = PACKAGE_MAT!; });
    }
  }
  function isInside(c: string) { return INSIDE.has(c) || /^element\d+$/.test(c); }

  function applyView() {
    const cut = view === 'cutaway';
    assembly.traverse((o) => {
      const c = o.userData?.component as string | undefined;
      if (o.userData.replaced) o.visible = false;
      else if (c === 'shellClosed') o.visible = !cut;
      else if (c === 'shellCut') o.visible = cut;
      else if (o.userData.cutaway === 'full') o.visible = !cut;
      else if (o.userData.cutaway === 'half') o.visible = cut;
      else if (o.userData.onRemovedHalf) o.visible = !cut;
    });
    // The prism housing has no cut half in the export, so in the cutaway it stood whole and opaque around the prism and
    // hid the drawn run from the focusing screen up through the prism: the rays stopped at the screen and one line
    // reappeared in mid-air at the eyepiece (score loop r3). In the cutaway it is ghosted like a faded part, so the dark
    // glass prism and the schematic path through it read as one continuous route. Outside it stays solid.
    assembly.getObjectByName('prismHousing')?.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const base = (m.userData.solidMaterial ??= (originals.get(m) as THREE.Material | undefined) ?? m.material) as THREE.Material;
      const want = cut ? faded(base) : base;
      if (originals.has(m)) originals.set(m, want); else m.material = want;
    });
    viewSwitch.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  }

  function setView(v: View) {
    viewBeforePick = null;
    view = v;
    applyView();
    if (lastModel) applyModel(lastModel);
    anchorProbes();
    fitDive(detail ? partFrame(detail) : frame());
  }

  let inflight: Promise<void> = Promise.resolve();
  let rigGeneration = 0;
  let loadPending = false;
  function ensureRig(lensId: string): Promise<void> {
    const body = bodyForLens(lensId);
    const key = `${body ?? 'dslr'}:${body ? lensId : 'none'}`;
    if (key === rigKey) return inflight;
    rigKey = key;
    const generation = ++rigGeneration;
    exposure.setEnabled(false);
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, label: 'Loading the camera' });
    loadPending = true;
    inflight = loadRig(lensId, generation).finally(() => { if (generation === rigGeneration) loadPending = false; }).catch((err) => {
      if (generation !== rigGeneration) return;
      failedGeneration = generation;
      rigKey = '';
      console.error('camera-rig: the models did not load', err);
      // nothing to fire or trade under a failed view (R1-10)
      exposure.setEnabled(false);
      // name the model that failed: an offline lens swap read "The camera model did not load" (score loop r2)
      const what = (err as { what?: string })?.what ?? 'The camera model';
      // After a swap the previous rig is still mounted (the new one replaces it only once both models are in): the veil
      // becomes a banner over it with "Keep current lens", not a blank view (score loop r4).
      const keep = everLoaded && lensRoot && state.lens ? state.lens : undefined;
      ctx.bus.emit('piece-loading', { id: 'camera', loading: false, error: `${what} did not load. ${keep ? 'The view still shows the lens you had. ' : ''}Check the connection and try again.`, retry: true, keep });
    });
    return inflight;
  }
  /** "The 500 mm f/4 lens", from public/models/lenses.json (focalLength, markedFno). */
  function lensName(f: { focalLength?: number; markedFno?: number }) {
    return f.focalLength ? `The ${f.focalLength} mm${f.markedFno ? ` f/${f.markedFno}` : ''} lens` : 'The lens';
  }
  async function loadRig(lensId: string, generation: number) {
    const body = bodyForLens(lensId);
    const fact = body ? LENSES[lensId] : null;
    if (!everLoaded) reportProgress();
    const named = <T,>(p: Promise<T>, what: string) => p.catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { what }); });
    performance.mark('p2p:rig-load');
    const [b, l] = await Promise.all([
      named(load(`./models/${body ?? 'dslr'}.glb`), `The ${body === 'mirrorless' ? 'mirrorless' : 'DSLR'} body`),
      fact ? named(load(`./${lensGlbPath(fact as unknown as { glb: string; glbLite?: string })}`), lensName(fact as unknown as { focalLength?: number; markedFno?: number })) : Promise.resolve(null),
    ]);
    performance.mark('p2p:rig-models');
    if (generation !== rigGeneration) return;      // a later choice won, including A → B → A
    unhighlight();
    exposure.reset();
    mirrorGeom = null;
    assembly.clear();
    bodyRoot = b; lensRoot = l;
    darkenSensorPackage(b);
    assembly.add(b);
    if (l) assembly.add(l);
    controlsFor = '-';   // the hover pick collects the new controls
    assembly.updateMatrixWorld(true);
    state.lens = l ? lensId : ''; state.body = body ?? 'dslr';
    exposure.setEnabled(true);
    for (const p of PROBES) p.label = partLabel(p.id as PartId, state.body as 'dslr' | 'mirrorless');
    unitShift = 0; sleeveR = 0;
    if (l) l.position.z = 0;
    infinityModel = l && lastScenario ? compute({ ...lastScenario, focusM: null }) : null;
    note.hidden = !!l;
    note.textContent = l ? '' : 'This lens has no 3D model: pick one of the lineup lenses above';
    applyView();
    if (lastModel) applyModel(lastModel);
    // The loaded lens and live iris must share the new optical geometry before
    // their world anchors are measured (including cached A → B → A returns).
    anchorProbes();
    placeGround();
    // Compile the new rig's pipelines behind the veil, yielding between objects, instead of in the first visible
    // frame: on WebGL2 that frame was a 3 s synchronous link right after the veil lifted, and the camera looked ready
    // but ignored input (score loop r1). `compiling` holds the stage's frames while this runs, so the compile cannot
    // race a frame over the shared frame-buffer target (the reason an earlier speculative compileAsync was removed).
    // A part that was open before the swap (the Pixel level leaves the sensor open on the camera) ghosts the new rig with
    // new faded and lit material clones. They are made here, before the compile, so that one compile builds them: made
    // after it, their node materials were built in the first frame, a 1.4 s task on a 4x phone (score loop r4).
    if (detail) openDetail(detail);
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, progress: 0.97, label: 'Preparing the camera', compiling: true });
    performance.mark('p2p:rig-built');
    await compileRig();
    performance.mark('p2p:rig-compiled');
    if (generation !== rigGeneration) return;
    if (!everLoaded && typeof requestIdleCallback === 'function') {
      // The deep levels share one studio environment (look.ts sharedStudioTexture); its PMREM bake is synchronous on
      // the GPU, so it is made while the reader is still looking at the camera, not in the first dive (score loop r3).
      requestIdleCallback(() => { ctx.look.sharedStudioTexture(ctx.renderer); }, { timeout: 4000 });
    }
    if (!everLoaded) {
      // The model a reader is most likely to ask for next, this body's next lens, is fetched while the camera sits idle, so
      // its swap finds it in memory (score loop r4); the rest are fetched when the reader points at, touches or focuses their
      // buttons (score loop r5: all six went to every 4G phone, 3.1 MB, on mobile data too, for readers who may never swap).
      const lensFiles = (id: string): string[] => {
        const f = (LENSES as Record<string, { glb: string; glbLite?: string; body?: string }>)[id];
        if (!f) return [];
        const fileBody = f.body ?? 'dslr';
        return [`./${lensGlbPath(f)}`, ...(fileBody === (body ?? 'dslr') ? [] : [`./models/${fileBody}.glb`])];
      };
      const sameBody = Object.entries(LENSES).filter(([id, f]) => id !== lensId && (f as { body?: string }).body === (body ?? 'dslr')).map(([id]) => id);
      if (sameBody[0]) prefetchNeighbours(lensFiles(sameBody[0]));
      prefetchOnIntent(lensFiles);
    }
    everLoaded = true;
    ctx.bus.emit('piece-loading', { id: 'camera', loading: false });
    // A shared part link or lens/body change may select a part before the GLB arrives.
    // Reapply it to the new meshes and frame that part, not the whole camera.
    if (detail) openDetail(detail);
    else fitDive(frame());
    if (group.visible) teach.start();
  }

  /** A part opened for the first time ghosts the rest of the camera with new, transparent, double-sided clones
   *  (faded, lit), and three built their node materials in the next frame: one task of 2.2 s on a 4x-throttled phone
   *  when the camera came back from the Pixel level with the sensor open (5.5 s in the r3 gate), and the same on the
   *  first tap on a part. They are compiled ahead instead, in steps, with the frames held; the stage veils the view
   *  only if that takes longer than a moment (`quiet`, score loop r3). */
  let compilingDetail: Promise<void> | null = null;
  let uncompiled = false; // new clones made while the level was hidden: compiled when it shows again
  function compileNewMaterials() {
    if (!group.visible) { uncompiled = true; return; }
    if (!everLoaded || loadPending || compilingDetail || failedGeneration === rigGeneration) return;
    uncompiled = false;
    const generation = rigGeneration;
    performance.mark('p2p:compile-detail');
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, label: 'Preparing the camera', compiling: true, quiet: true });
    compilingDetail = compileRig().finally(() => {
      performance.mark('p2p:compiled-detail');
      compilingDetail = null;
      if (generation === rigGeneration && !loadPending) ctx.bus.emit('piece-loading', { id: 'camera', loading: false, quiet: true });
    });
  }

  /** Every pipeline the scene needs with the rig in it, built ahead of its first frame. Frustum culling is off for the
   *  synchronous part of the call (the projection pass), since the camera has not flown to the new rig yet. */
  async function compileRig() {
    const r = ctx.renderer as unknown as AsyncCompiler;
    if (!r.compileAsync) return;
    // Measured 10/11/2026 (tools/test-runtime-budgets.mjs veil): ahead of time, WebGL2 desktop became usable at 3.1 s
    // instead of 3.7 s (no 2.7 s freeze after the veil) and a 4x-throttled phone at 7.1 s instead of 11.4 s (no 4.9 s
    // freeze); desktop WebGPU, whose first frame only costs about 0.3 s, waited 1 s longer behind the veil. So it
    // compiles ahead on WebGL2 and on phone-width views, and desktop WebGPU keeps compiling in its first frame.
    if (!r.backend?.isWebGLBackend && !phoneMq?.matches) return;
    // In steps (score loop r4): three builds a node material in JavaScript inside each compileAsync call, so one call for
    // the rig was a single task of 1 to 2.5 s on a 4x-throttled phone. A branch at a time, a frame between (the stage holds
    // its own frames meanwhile), and then the whole scene once, which is quick with every pipeline cached.
    const generation = rigGeneration;
    // Play the shot opens over the camera while it starts (the opening's own button): its canvas animation and these 100 ms
    // compile steps shared every frame (a mean of 57 to 78 ms against 25 ms once the compile ended, 4x phone). While a
    // dialog is open the next step waits, for at most 20 s; it resumes when the dialog closes.
    try { await compileInSteps(r, group, ctx.camera, ctx.scene, { alive: () => generation === rigGeneration, hold: () => !!document.querySelector('dialog[open]') }); }
    catch (error) { console.warn('camera-rig: the rig did not compile ahead; its first frame will', error); }
  }

  /** The faint floor under the camera, just below its lowest point and sized to it. */
  function placeGround() {
    const box = new THREE.Box3();
    assembly.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.cutaway) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromObject(assembly);
    if (box.isEmpty()) { ground.visible = false; contact.visible = false; return; }
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    ground.visible = true;
    ground.position.set(c.x, box.min.y - 0.5, c.z);
    ground.scale.setScalar(Math.max(size.x, size.z) * 1.35); // score loop r6: 1.35 (was 0.95), so the pool reaches behind the body too
    // the contact shadow under the body's own footprint (the closed shell), a little larger than it (score loop r3)
    const body = bodyRoot?.getObjectByName('shellClosed');
    const fb = body ? new THREE.Box3().setFromObject(body) : new THREE.Box3();
    contact.visible = !fb.isEmpty();
    if (contact.visible) {
      const fc = fb.getCenter(new THREE.Vector3()), fs = fb.getSize(new THREE.Vector3());
      contact.position.set(fc.x, box.min.y - 0.45, fc.z);
      contact.scale.set(fs.x * 1.35, fs.z * 1.6, 1);
    }
  }

  // ---- the engine's numbers, applied to the models -----------------------------------------------------------
  let opticsRevision = 0;
  function applyModel(model: Model) {
    if (!lensRoot || state.lens !== model.scenario.lens) return;
    opticsRevision++;
    const surf = model.system.surfaces;
    const imageZ = surf[surf.length - 1].z;
    const flange = (bodyFacts as any)[state.body].mount.flangeMm as number;
    // elements: the GLB holds them at infinity focus; move each by the engine's displacement from there
    if (!infinityModel || infinityModel.scenario.lens !== model.scenario.lens) infinityModel = compute({ ...model.scenario, focusM: null });
    const infSurf = infinityModel.system.surfaces;
    const infImage = infSurf[infSurf.length - 1].z;
    const els = model.realized.elements.filter((e) => -(infSurf[e.surfaces[0]].z - infImage) - flange > -8);
    state.elementShift = els.map((e) => { const f = e.surfaces[0]; return (surf[f].z - imageZ) - (infSurf[f].z - infImage); });
    // unit focusing: every element moves by the same amount, so the lens moves as a whole (the barrel with its glass)
    const s0 = state.elementShift[0] ?? 0;
    const unit = state.elementShift.length > 1 && Math.abs(s0) > 0.05 && state.elementShift.every((d) => Math.abs(d - s0) < 0.02);
    unitShift = unit ? s0 : 0;
    lensRoot.position.z = unitShift;
    els.forEach((_, k) => {
      const name = `element${String(k + 1).padStart(2, '0')}`;
      for (const n of [name, name + 'Cut']) {
        const node = lensRoot!.getObjectByName(n);
        if (node) node.position.z = state.elementShift[k] - unitShift;
      }
    });
    placeSleeve(flange);
    // the focus ring and the distance scale turn together (the cut half stays in its plane)
    state.ringAngle = focusRingAngle(model);
    for (const n of ['focusRing', 'distanceScale']) {
      const node = lensRoot.getObjectByName(n);
      if (node) node.rotation.z = state.ringAngle;
    }
    // the iris: the engine's opening in a blade annulus at the stop plane
    const stopIdx = surf.findIndex((s) => s.kind === 'stop');
    const stopZ = surf[stopIdx].z - imageZ;
    const rOuter = model.realized.realization.stopRadius + 2.6;
    const shape = view === 'cutaway' ? halfIrisShape(model.iris.outline, rOuter) : (() => {
      const s = new THREE.Shape();
      s.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      model.iris.outline.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
      hole.closePath();
      s.holes.push(hole);
      return s;
    })();
    iris.geometry.dispose();
    iris.geometry = new THREE.ShapeGeometry(shape, 48);
    iris.visible = true;
    iris.position.z = stopZ;
    state.irisRadius = model.iris.radius;
    {
      const seg: number[] = [];
      for (const b of model.iris.blades) for (let i = 0; i < b.length; i++) { const a = b[i], c = b[(i + 1) % b.length]; seg.push(a[0], a[1], -0.05, c[0], c[1], -0.05); }
      bladeEdges.geometry.dispose();
      bladeEdges.geometry = new THREE.BufferGeometry();
      bladeEdges.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const ring: number[] = [];
      for (const [x, y] of model.iris.outline) ring.push(x, y, -0.08);
      if (model.iris.outline.length) ring.push(model.iris.outline[0][0], model.iris.outline[0][1], -0.08);
      openingEdge.geometry.dispose();
      openingEdge.geometry = new THREE.BufferGeometry();
      openingEdge.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
    }
    // the light
    raysGroup.position.z = -imageZ;
    // outside: the on-axis bundle the lens takes in; the cutaway adds the off-axis field
    // From outside only the stretch in front of the lens shows, where a ray the iris stops looks the same as one that
    // reaches the sensor. Outside, the fan is therefore traced at the CURRENT aperture (lensFans samples the current
    // entrance pupil), keeping the rays that get through: the arriving bundle's width is the entrance pupil and follows
    // every stop (the haze sleeve that used to say so is gone, score loop r1). The cutaway traces wide open and clips
    // at the live iris, so each ray ends where the engine stops it.
    const traced = view === 'cutaway' ? marginalAwareFans(model, FAN_FIELDS, FAN_NMS, FAN_RAYS) : lensFans(model, { fields: [0], nms: FAN_NMS, rays: FAN_RAYS });
    const fans = view === 'cutaway' ? traced : traced.map((f) => ({ ...f, paths: f.paths.filter((p) => p.status === 'ok') }));
    const drawn = extendEntry(fans, model);
    rays.update(state.body === 'dslr' && !mirrorUp ? reflectAtMirror(drawn, imageZ) : drawn);
    axisPaths = drawn.filter((f) => f.field === 0).flatMap((f) => f.paths.filter((p) => p.pts.length > 3).map((p) => ({
      pts: p.pts.map((q) => new THREE.Vector3(q[0], q[1], q[2] - imageZ)),
      color: ctx.look.wavelengthToThreeColor(p.nm),
    })));
    state.rays = traced.reduce((n, f) => n + f.paths.length, 0);
    const ep = model.cardinal.ep;
    state.epR = ep.r;
    updateExtras(model);
  }

  /** The helicoid sleeve for a unit-focusing lens: from the body's mount face to the lens's own rear, at the radius of
   *  the lens's mount collar, cut with the rest of the lens in the cutaway. */
  let sleeveR = 0;
  function placeSleeve(flange: number) {
    const gap = -unitShift;
    sleeve.visible = !!lensRoot && gap > 0.3;
    if (!sleeve.visible || !lensRoot) return;
    if (!sleeveR) {
      const b = new THREE.Box3();
      const saved = lensRoot.position.z;
      lensRoot.position.z = 0; lensRoot.updateMatrixWorld(true);
      for (const n of ['lensMount', 'lensMountCut', 'mountCollar']) { const o = lensRoot.getObjectByName(n); if (o) b.expandByObject(o); }
      lensRoot.position.z = saved; lensRoot.updateMatrixWorld(true);
      sleeveR = b.isEmpty() ? 30 : Math.max(b.max.x, b.max.y) * 0.96;
      // The exterior drawtube fits the rear barrel, not just the narrower bayonet throat (R3-FID-2).
      // Sample its rear-most outer vertices in lens coordinates; the bore stays clear and glass is untouched.
      const barrel = lensRoot.getObjectByName('barrel');
      if (barrel) {
        const rear: THREE.Vector3[] = [];
        let rearZ = -Infinity;
        barrel.traverse(o => {
          const mesh = o as THREE.Mesh;
          const positions = mesh.geometry?.attributes.position;
          if (!positions) return;
          mesh.updateWorldMatrix(true, false);
          for (let i = 0; i < positions.count; i++) {
            const p = lensRoot!.worldToLocal(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
            rear.push(p); rearZ = Math.max(rearZ, p.z);
          }
        });
        let rearRadius = 0;
        for (const p of rear) if (p.z > rearZ - 2) rearRadius = Math.max(rearRadius, Math.hypot(p.x, p.y));
        if (rearRadius > 0) sleeveR = Math.max(sleeveR, rearRadius / 1.08);
      }
      // the barrel's own paint, so the sleeve is part of the lens
      let paint: THREE.MeshStandardMaterial | null = null;
      lensRoot.getObjectByName('barrel')?.traverse((c) => { const m = (c as THREE.Mesh).material; if (!paint && m && !Array.isArray(m) && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) paint = m as THREE.MeshStandardMaterial; });
      const p = paint as THREE.MeshStandardMaterial | null;
      if (p) { sleeveMat.color.copy(p.color); sleeveMat.roughness = p.roughness; sleeveMat.metalness = p.metalness; }
      else { sleeveMat.color.set(0x141518); sleeveMat.roughness = 0.55; sleeveMat.metalness = 0.35; }
    }
    const cut = view === 'cutaway';
    sleeveFull.visible = !cut; sleeveHalf.visible = cut;
    edgeFull.visible = !cut; edgeHalf.visible = cut;
    sleeve.scale.set(sleeveR, sleeveR, 1);
    for (const m of [sleeveFull, sleeveHalf]) { m.scale.set(1, gap, 1); m.position.z = 0; }
    // a 1.5 mm lip at the mount end (the lens end sits inside the collar, out of sight)
    const ew = Math.min(1.5, gap);
    for (const m of [edgeFull, edgeHalf]) { m.scale.set(1, ew, 1); m.position.z = gap / 2 - ew / 2; }
    sleeve.position.set(0, 0, -flange - gap / 2);
  }

  /** The DSLR at rest: the main mirror sits in the light between the rear element and the sensor and sends it up to
   *  the focusing screen, which sits at the same optical distance, so the image forms there, not on the sensor. A plane
   *  mirror is an isometry, so the reflected path is exact: the traced ray's last straight segment is cut where it
   *  meets the mirror's plane and mirrored across it, then stopped at the screen. (The half-silvered center also lets
   *  a share through to the sub-mirror and the autofocus module; that path is not drawn.) Drawing only: the engine's
   *  numbers are the ray paths themselves. */
  let mirrorGeom: { plane: THREE.Plane; box: THREE.Box3; screenY: number; finder: { exitY: number; eyeZ: number } | null } | null = null;
  function mirrorPlane() {
    if (mirrorGeom) return mirrorGeom;
    const mirror = assembly.getObjectByName('mirror');
    const screen = assembly.getObjectByName('focusingScreen');
    if (!mirror || !screen) return null;
    mirror.updateWorldMatrix(true, true);
    const pts: THREE.Vector3[] = [];
    mirror.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
    });
    if (pts.length < 3) return null;
    // The plane to reflect off is the mirror's optical FRONT face, not a plane refit through the solidified
    // 1mm slab's own vertices: min/max-vertex picks like the old fit can land on either face (or an edge),
    // mixing the thickness into both the center point and the normal's tilt (Astra-6 finding C1, 3.37deg off
    // and 0.75mm past the intended screen landing). blender/dslr_v2.py now records that front face -- the
    // surface SOLIDIFY leaves undisplaced -- as a glTF extra (a point and unit normal, already in this app's
    // world frame), and the focusing screen's own optical plane (nominal y = 25mm, the same optical distance
    // from the mirror center as the sensor) likewise, rather than reading back the screen box's near face
    // (which sat 0.6mm short, at y = 24.4).
    const fp = mirror.userData?.mirrorFrontPlane as number[] | undefined;
    const screenY = screen.userData?.opticalScreenY as number | undefined;
    if (!fp || fp.length !== 6 || typeof screenY !== 'number') return null;
    const normal = new THREE.Vector3(fp[3], fp[4], fp[5]).normalize();
    const point = new THREE.Vector3(fp[0], fp[1], fp[2]);
    const box = new THREE.Box3().setFromPoints(pts).expandByScalar(0.5);
    // score loop r2: past the screen the light runs up into the pentaprism and out of its exit face to the eyepiece.
    // The prism's two roof reflections are not traced; the drawn continuation is a schematic: straight up to the height
    // of the eyepiece axis (which passes through the middle of the exit face, blender/dslr_v2.py ZE), then back along
    // that axis to the eyepiece's rear lens.
    const prism = assembly.getObjectByName('prism'), eye = assembly.getObjectByName('eyepieceOptics');
    let finder: { exitY: number; eyeZ: number } | null = null;
    if (prism && eye) {
      const pb = new THREE.Box3().setFromObject(prism), eb = new THREE.Box3().setFromObject(eye);
      const pc = pb.getCenter(new THREE.Vector3()), ec = eb.getCenter(new THREE.Vector3());
      if (!pb.isEmpty() && !eb.isEmpty()) finder = { exitY: ec.y, eyeZ: ec.z < pc.z ? eb.min.z : eb.max.z };
    }
    mirrorGeom = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point), box, screenY, finder };
    return mirrorGeom;
  }
  function reflectAtMirror(fans: FanSet[], imageZ: number): FanSet[] {
    const g = mirrorPlane();
    state.reflected = 0;
    if (!g) return fans;
    const W = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2] - imageZ);
    const E = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z + imageZ];
    return fans.map((f) => ({
      ...f,
      paths: f.paths.map((p) => {
        for (let i = p.pts.length - 2; i >= 0; i--) {
          const a = W(p.pts[i]), b = W(p.pts[i + 1]);
          const da = g.plane.distanceToPoint(a), db = g.plane.distanceToPoint(b);
          if (da * db > 0) continue;
          const hit = a.clone().lerp(b, da / (da - db));
          // score loop r2: a ray whose last leg passes the mirror's plane beside the glass is not sent on to the
          // closed shutter; with the mirror down it ends there, at the edge of the mirror box
          if (!g.box.containsPoint(hit)) {
            if (i !== p.pts.length - 2) continue;
            return { ...p, pts: [...p.pts.slice(0, i + 1), E(hit)] };
          }
          // mirror the rest of the straight segment across the plane, then run it to the screen
          const tail = b.clone().sub(g.plane.normal.clone().multiplyScalar(2 * db));
          const dir = tail.clone().sub(hit).normalize();
          const t = dir.y > 1e-6 ? (g.screenY - hit.y) / dir.y : 0;
          const end = hit.clone().addScaledVector(dir, Math.max(0, t));
          state.reflected++;
          const finder = g.finder && g.finder.exitY > end.y
            ? [E(new THREE.Vector3(end.x, g.finder.exitY, end.z)), E(new THREE.Vector3(end.x, g.finder.exitY, g.finder.eyeZ))] : [];
          return { ...p, pts: [...p.pts.slice(0, i + 1), E(hit), E(end), ...finder] };
        }
        return p;
      }),
    }));
  }

  function extendEntry(fans: FanSet[], model: Model): FanSet[] {
    const len = LENSES[state.lens]?.lengthMm ?? 100;
    // Drawing only (score loop r2): a blocked ray that the engine stops farther from the axis than the lens's own
    // published outer radius never meets the lens at all; drawn, it ended in mid-air below the front of the barrel.
    // Such rays are left out of the picture (state.rays still counts every traced ray).
    const outerR = (LENSES[state.lens]?.diameterMm ?? Infinity) / 2;
    const kept = fans.map((f) => ({ ...f, paths: f.paths.filter((p) => {
      if (p.status === 'ok' || !p.pts.length) return true;
      const end = p.pts[p.pts.length - 1];
      return Math.hypot(end[0], end[1]) <= outerR;
    }) }));
    return extendEntryPaths(kept, model.system.surfaces[0].z, Math.max(120, len * 0.7), len);
  }

  // ---- selection: the picked part keeps its own material and everything else fades back (UI-14, PANE.md) ------------
  const fadedCache = new Map<THREE.Material, THREE.Material>();
  function faded(src: THREE.Material): THREE.Material {
    let f = fadedCache.get(src);
    if (!f) {
      f = src.clone();
      f.transparent = true;
      f.opacity = Math.min(src.opacity ?? 1, src.transparent ? (src.opacity ?? 1) * 0.5 : FADE_OPACITY);
      f.depthWrite = false;
      // Opacity alone still lets a bright specular or environment highlight (a mount ring, a bracket, a tripod-socket
      // disc) blow past white under ACES tone mapping, since three.js renders the highlight at full HDR intensity
      // and only blends its alpha over black -- a small alpha times a very bright value can still clip (R3-02). Clamp
      // the reflectivity and any glow on a faded clone so the ghosted geometry reads as dim, not as the brightest
      // thing on screen.
      const sm = f as THREE.MeshStandardMaterial;
      if ('envMapIntensity' in sm) sm.envMapIntensity = Math.min(sm.envMapIntensity ?? 1, 0.12);
      if ('emissiveIntensity' in sm) sm.emissiveIntensity = Math.min(sm.emissiveIntensity ?? 1, 0.12);
      if ('metalness' in sm) sm.metalness = Math.min(sm.metalness ?? 0, 0.15);
      if ('roughness' in sm) sm.roughness = Math.max(sm.roughness ?? 0, 0.85);
      // The clamps above only blunt a specular highlight; a bare, unlit color (or one this reflective to begin
      // with) still rendered near-white through the alpha blend. Darken the base color itself too, so a ghosted
      // mount ring or bracket reads as dim, never as the brightest thing in a detail mode (R3-02).
      if ('color' in sm && sm.color) sm.color = sm.color.clone().multiplyScalar(0.35);
      // A pale part (the DSLR's mirror, a white ceramic or chrome face) stayed several times brighter than the
      // ghosted paint even at 0.35x: the lifted mirror lay as a cream slab over the sensor it was meant to frame
      // (presentation review P-08). Cap a ghost's base color near the paint's own level, and drop the clearcoat
      // layer, which carried its own unclamped highlight.
      if ('color' in sm && sm.color) {
        const peak = Math.max(sm.color.r, sm.color.g, sm.color.b);
        if (peak > FADE_COLOR_CAP) sm.color.multiplyScalar(FADE_COLOR_CAP / peak);
      }
      if ('clearcoat' in sm) (sm as unknown as THREE.MeshPhysicalMaterial).clearcoat = 0;
      fadedCache.set(src, f);
    }
    return f;
  }
  function unhighlight() {
    for (const [m, mat] of originals) m.material = mat;
    originals.clear();
  }
  function highlightNames(names: string[], wholeLens = false) {
    unhighlight();
    const keep = new Set<THREE.Object3D>();
    // a revolved part shows as its cut half in the cutaway: keep both
    for (const n of names) for (const v of [n, `${n}Cut`]) { const o = assembly.getObjectByName(v); if (o) keep.add(o); }
    if (wholeLens && lensRoot) keep.add(lensRoot);
    const kept = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n && n !== assembly; n = n.parent) if (keep.has(n)) return true; return false; };
    assembly.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || originals.has(m) || Array.isArray(m.material) || kept(m)) return;
      originals.set(m, m.material);
      m.material = faded(m.material);
    });
  }

  // the cards live in src/app/rig-cards.ts, where every number's evidence is tested (R1-07)
  const cardState = (model: Model) => ({ body: bodyForLens(model.scenario.lens) ?? 'dslr', ringAngle: state.ringAngle, elementShift: state.elementShift });
  const probe = (id: PartId, parts: string[]): PieceProbe & { parts: string[] } =>
    ({ id, label: partLabel(id, 'dslr'), anchor: new THREE.Vector3(), parts, card: (m: Model) => partCard(id, m, cardState(m)) });
  const PROBES: (PieceProbe & { parts: string[] })[] = [
    probe('lens', ['barrel', 'barrelCut']),
    probe('focusRing', ['focusRing', 'distanceScale']),
    probe('iris', ['irisHousing', 'irisHousingCut']),
    probe('glass', ['glass']),
    probe('mount', ['mount', 'lensMount', 'lensMountCut']),
    probe('sensor', ['pixelArray', 'sensorPackage']),
    probe('shutter', ['shutter', 'shutterCurtainFront', 'shutterCurtainRear', 'ibisPlate']),
    probe('viewfinder', ['mirror', 'subMirror', 'focusingScreen', 'prism', 'evfPanel', 'evfHousing']),
  ];

  /** Pins sit where they read from the default three-quarter view and do not pile up: on top of the barrel for the
   *  lens's parts (at the axial position of each), at the front element for the glass, on the body's near side
   *  (x < 0, toward the viewer) for the sensor and the shutter, under the mount for the mount. */
  /** The box of the named parts, each looked up in the lens first, then the body (both carry a few shared names). */
  function boxOf(names: string[]) {
    const b = new THREE.Box3();
    for (const n of names) { const o = lensRoot?.getObjectByName(n) ?? bodyRoot?.getObjectByName(n); if (o) b.expandByObject(o); }
    return b;
  }
  function anchorProbes() {
    const barrel = boxOf(['barrel']);
    const body = boxOf(['shellClosed']);
    const topAt = (z: number) => {
      // the barrel's radius at z, from its own bounding box slices is overkill; the max radius reads fine on top
      return barrel.isEmpty() ? 40 : barrel.max.y;
    };
    const flange = (bodyFacts as any)[state.body || 'dslr'].mount.flangeMm as number;
    const set = (id: string, v: THREE.Vector3) => PROBES.find((p) => p.id === id)!.anchor.copy(v);
    if (!barrel.isEmpty()) {
      const len = barrel.max.z - barrel.min.z;
      // on the barrel's near side toward the mount, clear of the focus ring's pin on top and the iris's underneath
      set('lens', new THREE.Vector3(barrel.min.x, topAt(0) * 0.25, barrel.min.z + len * 0.72));
      const ring = boxOf(['focusRing']);
      set('focusRing', ring.isEmpty() ? new THREE.Vector3(0, topAt(0), barrel.min.z + len * 0.5) : new THREE.Vector3(0, ring.max.y, (ring.min.z + ring.max.z) / 2));
      set('iris', new THREE.Vector3(0, -topAt(0), iris.position.z));
      const g = boxOf(['element01']);
      set('glass', g.isEmpty() ? new THREE.Vector3(0, 0, barrel.min.z) : new THREE.Vector3(g.min.x * 0.5, 0, g.min.z));
    }
    // the mount's near side (the reader looks from the left), where the ring shows between the lens and the body
    const throatR = ((bodyFacts as any)[state.body || 'dslr'].mount.throatMm as number) / 2;
    set('mount', new THREE.Vector3(-(throatR + 5), -throatR * 0.55, -flange));
    if (!body.isEmpty()) {
      set('sensor', new THREE.Vector3(body.min.x, 6, 0));
      set('shutter', new THREE.Vector3(body.min.x, -18, 2));
      // the cutaway opens the body, so these two go on the parts themselves: the sensor's lit face and the shutter's
      // lower edge in front of it, never the empty air beside the cut shell (R2-04)
      if (view === 'cutaway') {
        const sb = boxOf(['pixelArray']);
        if (!sb.isEmpty()) set('sensor', new THREE.Vector3(sb.min.x + (sb.max.x - sb.min.x) * 0.2, sb.max.y - (sb.max.y - sb.min.y) * 0.25, sb.min.z));
        const sh = boxOf(state.body === 'dslr' ? ['shutterCurtainFront', 'shutter'] : ['shutter', 'ibisPlate']);
        if (!sh.isEmpty()) set('shutter', new THREE.Vector3(sh.min.x + (sh.max.x - sh.min.x) * 0.2, sh.min.y + (sh.max.y - sh.min.y) * 0.18, sh.min.z));
      }
      const vf = boxOf(state.body === 'dslr' ? ['prismHousing', 'eyecup'] : ['evfHousing']);
      if (!vf.isEmpty()) set('viewfinder', new THREE.Vector3(vf.min.x * 0.5, vf.max.y, (vf.min.z + vf.max.z) / 2));
    }
    // Each pin then moves onto what the default view really shows of its part (score loop r6): a bounding box's top or its
    // removed half is not a surface, and on the 500 mm lenses the pins floated 25 to 100 px off the ring and the iris.
    snapPins(set);
    // in a detail mode the picked part's pin sits on the part as framed, so it is always inside the frame (R1-04)
    const at = detail ? detailAnchor(detail) : null;
    if (at && detail) set(detail, at);
  }

  // ---- pin anchors on visible surfaces (score loop r6) ---------------------------------------------------------------
  /** What was snapped last, so the slider-driven model updates (which call anchorProbes each time) do not cast rays again. */
  let snapKey = '';
  const snapped = new Map<string, THREE.Vector3>();
  const meshesUnder = (o: THREE.Object3D | null | undefined, out: THREE.Mesh[] = []) => {
    o?.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      for (let n: THREE.Object3D | null = m; n; n = n.parent) if (!n.visible) return;
      out.push(m);
    });
    return out;
  };
  /** A ray test culls faces by the material's side and by the winding the Blender export gave them, and a ray from outside
   *  found no front face on the focus ring, the glass or the mount. Each test counts both faces for its own length, and
   *  every material goes back as it was before anything is drawn. */
  const bothSidesRay = (ray: THREE.Raycaster, meshes: THREE.Mesh[]) => {
    const restore: [THREE.Material, THREE.Side][] = [];
    for (const m of meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { restore.push([mat, mat.side]); mat.side = THREE.DoubleSide; }
    try { return ray.intersectObjects(meshes, false); } finally { for (const [mat, side] of restore) mat.side = side; }
  };
  /** The visible surface point of the probe's own meshes nearest, across the default view, to where its pin would sit
   *  without this step; null when the part is hidden from that view (the pin then keeps its host-surface anchor). A
   *  generator: it yields between rays so the caller can spread the search over several short tasks. */
  function* visibleSurfacePoint(probeId: string, preferred: THREE.Vector3, d: THREE.Vector3): Generator<void, THREE.Vector3 | null> {
    const names = PROBES.find((q) => q.id === probeId)!.parts;
    const own: THREE.Mesh[] = [];
    // a revolved part shows as its cut half in the cutaway (named <part>Cut): both count
    for (const n of names) for (const v of [n, `${n}Cut`]) meshesUnder(lensRoot?.getObjectByName(v) ?? bodyRoot?.getObjectByName(v), own);
    if (!own.length) return null;
    const box = new THREE.Box3();
    for (const m of own) box.expandByObject(m);
    if (box.isEmpty()) return null;
    const right = new THREE.Vector3().crossVectors(d.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d.clone().negate()).normalize();
    const c = box.getCenter(new THREE.Vector3());
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const q = new THREE.Vector3(x, y, z).sub(c);
      u0 = Math.min(u0, q.dot(right)); u1 = Math.max(u1, q.dot(right)); v0 = Math.min(v0, q.dot(up)); v1 = Math.max(v1, q.dot(up));
    }
    const pu = preferred.clone().sub(c).dot(right), pv = preferred.clone().sub(c).dot(up);
    const ray = new THREE.Raycaster();
    ray.far = 20000;
    ray.layers.enableAll(); // the stage's camera draws more than layer 0; so must this ray, or the ring and glass are not seen
    const ownSet = new Set(own);
    let occluders: THREE.Mesh[] | null = null;
    // Rays leave from 1.5 m out (from 4 m a ray missed the ring and the glass outright), in a spiral around where the pin
    // would sit, nearest first. The first one that lands on the part, facing the view, with nothing of another part
    // between it and the camera is the anchor, so the common case costs two or three rays, not a grid of them.
    const extent = Math.max(u1 - u0, v1 - v0);
    const step = Math.max(2, extent / 14);
    let edgeOn: THREE.Vector3 | null = null;
    for (let ring = 0, tried = 0, tests = 0; ring <= 14 && tried < 450 && tests < 60; ring++) {
      const count = ring === 0 ? 1 : ring * 6;
      for (let k = 0; k < count && tests < 60; k++, tried++) {
        const a = (k / count) * Math.PI * 2 + ring * 0.7;
        const u = pu + Math.cos(a) * ring * step, v = pv + Math.sin(a) * ring * step;
        if (u < u0 - step || u > u1 + step || v < v0 - step || v > v1 + step) continue;
        ray.set(c.clone().addScaledVector(right, u).addScaledVector(up, v).addScaledVector(d, 1500), d.clone().negate());
        const h = bothSidesRay(ray, own)[0];
        yield; // after every ray: the driver stops the task when its few milliseconds are used, however many rays miss in a row
        if (!h) continue;
        // a surface seen edge-on (a cylinder's silhouette) is where a pin reads as floating beside the part, not on it
        const facing = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).dot(d) : 1;
        occluders ??= meshesUnder(assembly).filter((m) => !ownSet.has(m));
        ray.set(h.point.clone().addScaledVector(d, 0.6), d);
        tests++;
        yield;
        if (bothSidesRay(ray, occluders).length) continue;
        if (Math.abs(facing) < 0.35) { edgeOn ??= h.point.clone(); continue; }
        return h.point.clone();
      }
    }
    return edgeOn;
  }
  /** One probe's snapped anchor, from where the box rules put it (null: keep that). */
  function* snapOne(id: string, start: THREE.Vector3, d: THREE.Vector3): Generator<void, THREE.Vector3 | null> {
    // the iris is inside the barrel from outside: its pin goes on the barrel's near side at the iris's own axial position
    let preferred = start.clone();
    if (id === 'iris' && view === 'outside') {
      const n = new THREE.Vector2(d.x, d.y).normalize();
      const barrel = meshesUnder(lensRoot?.getObjectByName('barrel'));
      const r = new THREE.Raycaster();
      r.layers.enableAll();
      r.set(new THREE.Vector3(n.x * 600, n.y * 600, iris.position.z), new THREE.Vector3(-n.x, -n.y, 0));
      const h = barrel.length ? bothSidesRay(r, barrel)[0] : null;
      if (h) return h.point.clone();
    }
    // the ring's pin goes on the middle of its visible band, as the teaching ring does, not at the rim the box's top gives
    if (id === 'focusRing' && view === 'outside') {
      const b = boxOf(['focusRing']);
      if (!b.isEmpty()) {
        const n = new THREE.Vector2(d.x, d.y).normalize(), r = Math.min(b.max.x - b.min.x, b.max.y - b.min.y) / 2 * 0.8;
        preferred = b.getCenter(new THREE.Vector3()).add(new THREE.Vector3(n.x * r, n.y * r, 0));
      }
    }
    return yield* visibleSurfacePoint(id, preferred, d);
  }
  function snapPins(set: (id: string, v: THREE.Vector3) => void) {
    if (detail) return;
    const key = [state.lens, state.body, view, ctx.camera.aspect < 0.9, lensRoot?.uuid, bodyRoot?.uuid, boxOf(['barrel']).isEmpty(), boxOf(['shellClosed']).isEmpty()].join('|');
    if (key !== snapKey) {
      snapKey = key;
      snapped.clear();
      if (!lensRoot && !bodyRoot) return;
      assembly.updateMatrixWorld(true);
      const d = outsideDir();
      // Short tasks, one probe at a time, about 8 ms each: a cutaway's occlusion tests took ~300 ms in one go on a desktop,
      // which a phone would feel as a frozen Cutaway button. The pins start where the box rules put them and move onto the
      // surface as each probe lands (the camera is flying to the new view meanwhile).
      // in the browser's idle time, where it has one: a click, a key or a sheet closing is answered before the next slice runs
      const later = (fn: () => void) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 400 }); else window.setTimeout(fn, 16); };
      const queue = PROBES.map((q) => ({ id: q.id, anchor: q.anchor.clone() }));
      const job = key;
      let current: { id: string; gen: Generator<void, THREE.Vector3 | null> } | null = null;
      const next = () => {
        if (job !== snapKey) return;
        if (!current) {
          const q = queue.shift();
          if (!q) { performance.mark('p2p:pin-snap-done'); return; }
          current = { id: q.id, gen: snapOne(q.id, q.anchor, d) };
        }
        const t0 = performance.now();
        let r = current.gen.next();
        while (!r.done && performance.now() - t0 < 6) r = current.gen.next();
        if (performance.now() - t0 > 0.5) performance.mark('p2p:pin-snap', { detail: Math.round((performance.now() - t0) * 10) / 10 });
        if (r.done) {
          const probe = PROBES.find((x) => x.id === current!.id);
          if (r.value && probe && !detail) { snapped.set(current.id, r.value); probe.anchor.copy(r.value); ctx.invalidate?.(); }
          current = null;
        }
        later(next);
      };
      later(next);
    }
    for (const [id, v] of snapped) set(id, v);
  }

  /** Where the picked part's pin goes in its own detail frame: the near top corner of the part as seen from the left,
   *  and for the iris, beside the opening seen from the front. */
  function detailAnchor(id: string): THREE.Vector3 | null {
    if (id === 'iris') {
      const m = lastModel;
      const r = m ? m.realized.realization.stopRadius + 2.6 : 20;
      return new THREE.Vector3(r * 0.72, -r * 0.72, iris.position.z);
    }
    const b = boxOf(DETAIL_PARTS[id] ?? []);
    if (b.isEmpty()) return null;
    return new THREE.Vector3(b.min.x, b.max.y, (b.min.z + b.max.z) / 2);
  }

  /** The free part of the view, as fractions of its width and height: the stage measures the chrome (the title, the
   *  exposure panel, the switches on a phone) and shifts the picture's center into what is left. */
  function freeFraction(): { fw: number; fh: number } {
    const ins = ctx.camera.userData.insets as { left: number; top: number; right: number; bottom: number; width: number; height: number } | undefined;
    if (!ins || !ins.width || !ins.height) return { fw: 1, fh: 1 };
    return { fw: Math.max(0.35, (ins.width - ins.left - ins.right) / ins.width), fh: Math.max(0.35, (ins.height - ins.top - ins.bottom) / ins.height) };
  }

  /** Fits a box seen from `dir`: every corner inside the free rectangle with a margin, the box centered in it. Tighter
   *  than a bounding sphere, which leaves a long telephoto rig small in a wide frame. */
  function fitBox(box: THREE.Box3, dir: THREE.Vector3, margin = 1.1): CameraFrame {
    // Shared part links and quick selections can arrive before the GLB. Empty bounds contain infinities,
    // which otherwise poison the camera permanently, even after the real model has loaded.
    if (box.isEmpty()) box = wholeRigBox();
    const cam = ctx.camera;
    const { fw, fh } = freeFraction();
    const tanV = (Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * fh) / margin;
    const tanH = (Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect * fw) / margin;
    const d = dir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(d.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d.clone().negate()).normalize();
    const c0 = box.getCenter(new THREE.Vector3());
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).sub(c0));
    const us = corners.map((q) => q.dot(right)), vs = corners.map((q) => q.dot(up));
    const du = (Math.min(...us) + Math.max(...us)) / 2, dv = (Math.min(...vs) + Math.max(...vs)) / 2;
    const center = c0.clone().addScaledVector(right, du).addScaledVector(up, dv);
    let dist = 1;
    for (const q of corners) {
      const rel = q.clone().sub(right.clone().multiplyScalar(du)).sub(up.clone().multiplyScalar(dv));
      const w = rel.dot(d);
      dist = Math.max(dist, w + Math.abs(rel.dot(right)) / tanH, w + Math.abs(rel.dot(up)) / tanV);
    }
    return { position: center.clone().addScaledVector(d, dist), target: center };
  }

  /** The default three-quarter view. A long lens turns more side-on so its length runs across the frame, and more so
   *  on a portrait phone, where a head-on telephoto hides the body behind its own front element (UI-10, FID-9). */
  function outsideDir(): THREE.Vector3 {
    const long = (LENSES[state.lens]?.lengthMm ?? 0) > 180;
    const portrait = ctx.camera.aspect < 0.9;
    if (view === 'cutaway') return new THREE.Vector3(-0.9, 0.3, -0.42);
    if (long && portrait) return new THREE.Vector3(-0.93, 0.3, -0.2);
    if (long) return new THREE.Vector3(-0.8, 0.28, -0.53);
    if (portrait) return new THREE.Vector3(-0.7, 0.34, -0.63);
    return new THREE.Vector3(-0.62, 0.34, -0.71);
  }

  /** The whole rig, lens front to eyecup, inside the free rectangle with a small margin (R1-FID-I, FID-9). */
  function frame(): CameraFrame {
    // Long telephotos need the wider assembly envelope for their front rim and its oblique end-on view.
    // The tighter component fit is for the body + short-lens overview, where empty box corners dominated.
    const lensLen = LENSES[state.lens]?.lengthMm ?? 0;
    if (lensLen > 180 && view === 'cutaway' && rays.mesh.visible) {
      // The cutaway's rays come in from the lower left: the fit takes them in for a quarter of the lens length in front
      // of the rig, so the rig moves up and right and the arriving light shares the frame, instead of leaving the top
      // third empty while the rays run off the bottom-left corner (score loop r2, the 500 mm cutaway).
      // Fitted by the components' own corners (overviewFrame), not one world box, whose empty corners kept the frame wide.
      const minZ = wholeRigBox().min.z - lensLen * 0.25;
      const pos = rays.mesh.geometry.getAttribute('position');
      rays.mesh.updateWorldMatrix(true, false);
      const lit: THREE.Vector3[] = [];
      if (pos) for (let i = 0; i < pos.count; i += 2) {
        const q = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(rays.mesh.matrixWorld);
        if (q.z >= minZ) lit.push(q);
      }
      const { fw, fh } = freeFraction();
      const tan = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) / 1.14;
      const f = lit.length ? overviewFrame(assembly, outsideDir(), tan * ctx.camera.aspect * fw, tan * fh, lit) : null;
      if (f) return f;
    }
    if (lensLen > 180) return fitBox(wholeRigBox(), outsideDir(), 1.1);
    const { fw, fh } = freeFraction();
    const tan = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) / 1.08;
    return overviewFrame(assembly, outsideDir(), tan * ctx.camera.aspect * fw, tan * fh)
      ?? fitBox(wholeRigBox(), outsideDir(), 1.1);
  }

  // ---- controls on the model: drag the focus ring, turn the command dials, press the shutter button ------------
  // Capture-phase listeners on the canvas run before OrbitControls' own; a press on a control stops there, so the
  // camera does not orbit while a ring or dial is turned. Anywhere else, orbiting works as before.
  type Ctl = 'focus' | 'aperture' | 'shutter' | 'fire';
  const CTL_OF: Record<string, Ctl> = { focusRing: 'focus', distanceScale: 'focus', commandDialFront: 'aperture', commandDialRear: 'shutter', shutterButton: 'fire' };
  const HINT: Record<Ctl, string> = { focus: 'Drag to focus', aperture: 'Front dial: drag for aperture', shutter: 'Rear dial: drag for shutter speed', fire: 'Press to fire' };
  const canvas = ctx.renderer.domElement as HTMLCanvasElement;
  const ray = new THREE.Raycaster();
  const tip = document.createElement('div');
  tip.className = 'rig-tip';
  tip.hidden = true;
  ctx.overlay.appendChild(tip);
  let drag: { ctl: Ctl; x0: number; angle0: number; idx0: number; node: THREE.Object3D; q0: THREE.Quaternion; last: number; moved: boolean; dial?: THREE.Object3D } | null = null;
  let lastEmit = 0;
  let controlNodes: THREE.Object3D[] = [];
  let controlsFor = '-';

  type Picked = { ctl: Ctl; node: THREE.Object3D; /** the dial a press on the shared ring turns when it is dragged instead of clicked */ dial?: THREE.Object3D };
  /** A press inside a teaching ring that lands on the body, not on the control it is drawn around, goes to the ring's
   *  control (score loop r5: a drag started at the ring's center orbited the camera and a click opened the focus ring's
   *  card, because the ring is centered on the control's projected center, a few pixels from the control's own mesh). The
   *  ring that marks both the shutter button and the front dial takes a click as a press of the button and a drag as a
   *  turn of the dial. */
  function ringPick(e: PointerEvent): Picked | null {
    const names = teach.ringAt(e.clientX, e.clientY);
    if (!names) return null;
    const objs = names.map((n) => assembly.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
    if (!objs.length) return null;
    if (names.length === 2) {
      const fire = assembly.getObjectByName('shutterButton'), dial = assembly.getObjectByName('commandDialFront');
      return fire && dial ? { ctl: 'fire', node: fire, dial } : null;
    }
    const ctl = CTL_OF[names[0]];
    return ctl ? { ctl, node: objs[0] } : null;
  }
  function pick(e: PointerEvent): Picked | null {
    return geometryPick(e) ?? ringPick(e);
  }
  function geometryPick(e: PointerEvent): Picked | null {
    if (!group.visible) return null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ctx.camera);
    const vis = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
    // Quick reject against the few control meshes (focus ring, dials, shutter button) before the full assembly
    // (about 220k triangles, no BVH): most pointer moves miss every control. A control hit is then confirmed against
    // the whole assembly, so a control behind the body still does not pick.
    if (controlsFor !== rigKey) {
      controlsFor = rigKey;
      controlNodes = [];
      assembly.traverse((o) => { const c = o.userData?.component as string | undefined; if (c && CTL_OF[c]) controlNodes.push(o); });
    }
    if (!ray.intersectObjects(controlNodes, true).some((h) => vis(h.object))) return null;
    const hit = ray.intersectObject(assembly, true).find((h) => vis(h.object));
    for (let n: THREE.Object3D | null = hit?.object ?? null; n; n = n.parent) {
      const c = n.userData?.component as string | undefined;
      if (c && CTL_OF[c]) return { ctl: CTL_OF[c], node: n };
    }
    return null;
  }
  const fnoSteps = (m: Model) => apertureSteps(lensSummary(m.scenario.lens).maxFno);
  const nearest = (arr: number[], v: number) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[b] - v)) b = i; return b; };

  function onDown(e: PointerEvent) {
    const p = pick(e);
    if (!p || !lastModel) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const m = lastModel;
    drag = { ctl: p.ctl, x0: e.clientX, angle0: state.ringAngle, last: 0, moved: false,
      idx0: p.ctl === 'aperture' ? nearest(fnoSteps(m), m.scenario.fno) : p.ctl === 'shutter' ? nearest(THIRD_STOP_SHUTTER, m.scenario.shutter) : 0,
      node: p.node, q0: p.node.quaternion.clone(), dial: p.dial };
    canvas.style.cursor = p.ctl === 'fire' && !p.dial ? 'pointer' : 'grabbing';
    tip.hidden = true;
  }
  function emitFocus(m: Model, angle: number) {
    const d = distanceForRingAngle(m, angle);
    ctx.bus.emit('scenario-set', { focusM: d === null ? null : d / 1000 });
  }
  function onMove(e: PointerEvent) {
    if (!drag) {
      // no hover picking while a button is down: that is an orbit or pan gesture, not a hover
      const hovering = e.pointerType === 'mouse' && !e.buttons;
      const p = hovering ? pick(e) : null;
      if (p) {
        hoverPart(null);
        canvas.style.cursor = p.ctl === 'fire' && !p.dial ? 'pointer' : 'grab';
        tip.dataset.kind = 'ctl';
        tip.textContent = p.dial ? 'Click: fire · Drag: aperture' : HINT[p.ctl];
        placeTip(e.clientX, e.clientY);
      } else {
        if (tip.dataset.kind === 'ctl') { tip.hidden = true; tip.dataset.kind = ''; canvas.style.cursor = ''; }
        if (hovering) hoverAt(e); else hoverPart(null);
      }
      return;
    }
    e.stopImmediatePropagation();
    const m = lastModel;
    if (!m) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
    // a press on the shared ring that turns into a drag becomes a turn of the front dial (score loop r5)
    if (drag.dial && drag.moved) {
      drag.ctl = 'aperture'; drag.node = drag.dial; drag.q0 = drag.dial.quaternion.clone(); drag.dial = undefined;
      drag.idx0 = nearest(fnoSteps(m), m.scenario.fno); drag.last = 0;
    }
    if (drag.ctl === 'focus') {
      const angle = Math.max(0, Math.min(focusRingThrow(m), drag.angle0 + dx * 0.008));
      for (const n of ['focusRing', 'distanceScale']) { const o = lensRoot?.getObjectByName(n); if (o) o.rotation.z = angle; }
      state.ringAngle = angle;
      const now = performance.now();
      if (now - lastEmit > 60) { lastEmit = now; emitFocus(m, angle); }
    } else if (drag.ctl === 'aperture' || drag.ctl === 'shutter') {
      const steps = Math.round(dx / 18);
      if (steps !== drag.last) {
        drag.last = steps;
        drag.node.quaternion.copy(drag.q0);
        drag.node.rotateZ(steps * 0.26);
        if (drag.ctl === 'aperture') {
          const a = fnoSteps(m);
          ctx.bus.emit('scenario-set', { fno: a[Math.max(0, Math.min(a.length - 1, drag.idx0 + steps))] });
        } else {
          const a = THIRD_STOP_SHUTTER;
          ctx.bus.emit('scenario-set', { shutter: a[Math.max(0, Math.min(a.length - 1, drag.idx0 - steps))] });
        }
      }
    }
  }
  function onUp(e: PointerEvent) {
    if (!drag) return;
    e.stopImmediatePropagation();
    if (drag.ctl === 'focus' && lastModel) emitFocus(lastModel, state.ringAngle);
    if (drag.ctl === 'fire' && !drag.moved) exposure.fire();
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    drag = null;
    canvas.style.cursor = '';
  }
  // ---- picking a part on the model itself (score loop r4) -------------------------------------------------------
  // The numbered pins were the only way to pick a part, so a first click on the lens or the body did nothing. A tap on
  // the model now picks the part under it (the same path as its pin: 'pick-part' -> stage.selectPin + 'select-part'),
  // a drag still orbits, and the pointer is a hand with the part's name beside it while it is over one.
  /** The probe id of the part under a pixel: the hit mesh's own component, else the part whose box is nearest the hit
   *  (the body shell, the grip and the prism housing belong to no list entry). Null where the ray meets nothing. */
  const SHELL = '__shell';
  function partAt(clientX: number, clientY: number): string | null {
    if (!group.visible || !assembly.children.length) return null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), ctx.camera);
    const vis = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
    const hit = ray.intersectObject(assembly, true).find((h) => vis(h.object) && !h.object.userData.edgeBand);
    if (!hit) return null;
    for (let n: THREE.Object3D | null = hit.object; n; n = n.parent) {
      const c = n.userData?.component as string | undefined;
      const owner = c ? PROBES.find((p) => p.parts.includes(c)) : undefined;
      if (owner) return owner.id;
    }
    // A piece of the lens that belongs to no list entry (the hood bayonet, a switch, the rubber) is the lens. The body's shell
    // and its small controls are not parts of this level: the nearest list entry by box sent a grip click to the Shutter
    // and the wall to the lens, and flipped the view into the cutaway (score loop r6).
    for (let n: THREE.Object3D | null = hit.object; n; n = n.parent) if (n === lensRoot) return 'lens';
    return SHELL;
  }
  let hovered: string | null = null;
  /** Puts the tooltip beside the pointer where it covers none of the numbered pins (it sat on pin 5 and on a pin's own label,
   *  so "Shutter" was drawn over "Shutter", score loop r6). Tries below-right, above-right, below-left, above-left, then
   *  further out; the first spot that clears every pin and the view's edges wins. */
  function placeTip(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = clientX - r.left, y = clientY - r.top;
    const pins = [...ctx.overlay.parentElement!.querySelectorAll<HTMLElement>('.pin')].filter((p) => p.offsetWidth > 0)
      .flatMap((p) => [...p.querySelectorAll<HTMLElement>('.num, .lbl')].filter((q) => q.offsetWidth > 0).map((q) => q.getBoundingClientRect()))
      .map((b) => ({ l: b.left - r.left - 4, t: b.top - r.top - 4, r: b.right - r.left + 4, b: b.bottom - r.top + 4 }));
    const spots: [number, number][] = [];
    for (const far of [0, 1, 2]) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) spots.push([sx > 0 ? x + 14 + far * 30 : x - 14 - w - far * 30, sy > 0 ? y + 10 + far * 24 : y - 10 - h - far * 24]);
    const fits = ([l, t]: [number, number]) => l >= 2 && t >= 2 && l + w <= r.width - 2 && t + h <= r.height - 2
      && !pins.some((p) => l < p.r && l + w > p.l && t < p.b && t + h > p.t);
    const [l, t] = spots.find(fits) ?? spots[0];
    tip.style.left = `${Math.max(2, Math.min(l, r.width - w - 2))}px`;
    tip.style.top = `${Math.max(2, Math.min(t, r.height - h - 2))}px`;
  }
  /** A click on the camera's own shell or an unlisted control says so, once, where it landed. */
  let hintTimer = 0;
  function shellHint(clientX: number, clientY: number) {
    tip.dataset.kind = 'hint';
    tip.textContent = 'Camera body, no part card. Pick a numbered part';
    placeTip(clientX, clientY);
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => { if (tip.dataset.kind === 'hint') { tip.hidden = true; tip.dataset.kind = ''; } }, 2600);
  }
  function hoverPart(id: string | null, e?: PointerEvent) {
    if (id === SHELL) {
      // the shell has no card: no pointer hand, and no part name drawn over a pin
      if (hovered) { hovered = null; ctx.bus.emit('hover-part', { id: null }); }
      if (e && tip.dataset.kind !== 'hint') {
        canvas.style.cursor = '';
        tip.dataset.kind = 'part';
        tip.textContent = 'Camera body · pick a numbered part';
        placeTip(e.clientX, e.clientY);
      }
      return;
    }
    if (id !== hovered) { hovered = id; ctx.bus.emit('hover-part', { id }); }
    if (!id || !e) {
      if (!id && !drag) { if (canvas.style.cursor === 'pointer' && tip.dataset.kind === 'part') canvas.style.cursor = ''; if (tip.dataset.kind === 'part') { tip.hidden = true; tip.dataset.kind = ''; } }
      return;
    }
    canvas.style.cursor = 'pointer';
    tip.dataset.kind = 'part';
    tip.textContent = `${PROBES.find((p) => p.id === id)?.label ?? id} · click to inspect`;
    placeTip(e.clientX, e.clientY);
  }
  // A ray against the whole assembly is the expensive step (about 220k triangles, no BVH), so the hover checks run at
  // most about 15 times a second, on the latest pointer position.
  let hoverEvent: PointerEvent | null = null, hoverTimer = 0, hoverLast = 0;
  function hoverAt(e: PointerEvent) {
    hoverEvent = e;
    if (hoverTimer) return;
    const wait = Math.max(0, 66 - (performance.now() - hoverLast));
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0; hoverLast = performance.now();
      const ev = hoverEvent; hoverEvent = null;
      if (!ev || drag) return;
      hoverPart(partAt(ev.clientX, ev.clientY), ev);
    }, wait);
  }
  function hoverEnd() {
    window.clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = null;
    hoverPart(null);
  }
  const pointers = new Set<number>();
  let tap: { id: number; x: number; y: number; t: number } | null = null;
  function tapDown(e: PointerEvent) {
    pointers.add(e.pointerId);
    // a second finger is a pinch, a secondary or middle button a pan: neither is a tap
    tap = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
  }
  function tapUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    const t = tap; tap = null;
    if (!t || t.id !== e.pointerId || drag) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6 || e.timeStamp - t.t > 800) return;
    const id = partAt(e.clientX, e.clientY);
    // A tap on the shell says there is no card for it and goes back to the overview; a tap on nothing does the same (as
    // Esc and the Overview button do), where it used to leave the picked part and its card open.
    if (id === SHELL) { shellHint(e.clientX, e.clientY); ctx.bus.emit('pick-part', { id: null }); return; }
    ctx.bus.emit('pick-part', { id });
  }
  function tapCancel(e: PointerEvent) { pointers.delete(e.pointerId); tap = null; }
  canvas.addEventListener('pointerdown', tapDown);
  canvas.addEventListener('pointerup', tapUp);
  canvas.addEventListener('pointercancel', tapCancel);
  canvas.addEventListener('pointerleave', hoverEnd);
  canvas.addEventListener('pointerdown', hoverEnd);
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', onUp, { capture: true });
  function detach() {
    canvas.removeEventListener('pointerdown', tapDown);
    canvas.removeEventListener('pointerup', tapUp);
    canvas.removeEventListener('pointercancel', tapCancel);
    canvas.removeEventListener('pointerleave', hoverEnd);
    canvas.removeEventListener('pointerdown', hoverEnd);
    window.clearTimeout(hoverTimer);
    canvas.removeEventListener('pointerdown', onDown, { capture: true });
    canvas.removeEventListener('pointermove', onMove, { capture: true });
    canvas.removeEventListener('pointerup', onUp, { capture: true });
    canvas.removeEventListener('pointercancel', onUp, { capture: true });
  }

  // ---- detail modes (docs/PANE.md): pick a part and the camera flies to it and opens what it has to show -------
  //   iris: straight into the lens from the front, with the entrance pupil ringed at its true size and place;
  //   focus ring: one object point's bundle at the focus distance converging on the sensor (and the cone level);
  //   the glass, the sensor, the shutter, the viewfinder: the cutaway, framed on the part; the sensor links to the loupe.
  let detail: string | null = null;
  const crumb = document.createElement('div');
  crumb.className = 'rig-crumb';
  crumb.dataset.inset = 'top';
  crumb.hidden = true;
  crumb.innerHTML = '<button type="button" class="rc-back">← Camera</button><span class="rc-sep">/</span><span class="rc-here"></span><button type="button" class="btn rc-link" hidden></button>';
  ctx.overlay.appendChild(crumb);
  const linkBtn = crumb.querySelector('.rc-link') as HTMLButtonElement;
  let linkTo: 'cone' | 'loupe' | 'lens' | null = null;
  (crumb.querySelector('.rc-back') as HTMLButtonElement).addEventListener('click', () => back());
  linkBtn.addEventListener('click', () => { if (linkTo) ctx.bus.emit('goto-piece', { piece: linkTo }); });
  function back() { openDetail(null); ctx.bus.emit('select-part', { id: null }); }
  const onKey = (e: KeyboardEvent) => {
    if (!group.visible || canvas.closest('[hidden], [inert]') || document.querySelector('dialog[open]')) return;
    const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape' && detail) back();
    else if ((e.key === 'f' || e.key === 'F') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) exposure.fire();
  };
  window.addEventListener('keydown', onKey);

  // the entrance pupil: a ring of its radius at its plane, in the page's ink (amber stays on the chrome, R1-04)
  // (a closed Line: the WebGPU renderer has no LineLoop)
  const epRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
  })), new THREE.LineBasicMaterial({ color: 0xe8e6e1, toneMapped: false, depthTest: false, transparent: true, opacity: 0.85 }));
  epRing.visible = false;
  epRing.renderOrder = 10;
  group.add(epRing);
  // one object point's bundle for the focus mode
  const bundleGroup = new THREE.Group();
  const bundle = buildRays(ctx.look);
  const bMat = bundle.mesh.material as THREE.Material;
  bMat.transparent = true; bMat.depthWrite = false; bMat.blending = THREE.AdditiveBlending;
  bundleGroup.add(bundle.mesh);
  bundleGroup.visible = false;
  group.add(bundleGroup);

  function updateExtras(model: Model) {
    const surf = model.system.surfaces;
    const imageZ = surf[surf.length - 1].z;
    const barrel = boxOf(['barrel']);
    const pupilZ = model.cardinal.ep.z - imageZ;
    const pupilInHousing = !barrel.isEmpty() && pupilZ >= barrel.min.z && pupilZ <= barrel.max.z;
    // A pupil is an optical image of the stop. It can lie far outside the physical
    // lens (the 800 mm pupil lies behind the camera); do not draw that image as
    // detached hardware or frame the view around it. Its diameter remains exact.
    epRing.visible = detail === 'iris' && pupilInHousing;
    // the live iris sits outside the assembly, so the selection fade never reached it: with the camera ghosted for
    // the sensor, the mount or the shutter, its annulus stayed the one solid black disc in frame (P-03)
    iris.material = detail === 'iris' ? irisLitMat
      : detail && detail !== 'lens' && detail !== 'glass' ? faded(irisMat) as THREE.MeshStandardMaterial : irisMat;
    bladeEdges.visible = detail === 'iris';
    openingEdge.visible = detail === 'iris';
    if (epRing.visible) {
      const r = model.cardinal.ep.r;
      epRing.position.set(0, 0, model.cardinal.ep.z - imageZ);
      epRing.scale.set(r, r, 1);
      // the label sits just above the ring's top, clear of the line
      if (group.visible) ctx.labels.set('rig-ep', { world: new THREE.Vector3(0, r * 1.06, model.cardinal.ep.z - imageZ), text: `Entrance pupil ⌀ ${(2 * r).toFixed(1)} mm`, kind: 'hud' });
    } else if (detail === 'iris' && !barrel.isEmpty() && group.visible) {
      ctx.labels.set('rig-ep', { world: new THREE.Vector3(0, barrel.max.y * 1.06, (barrel.min.z + barrel.max.z) / 2),
        text: `Entrance pupil ⌀ ${(2 * model.cardinal.ep.r).toFixed(1)} mm · apparent`, kind: 'hud' });
    } else ctx.labels.remove('rig-ep');
    bundleGroup.visible = raysOn && detail === 'focusRing';
    if (bundleGroup.visible) {
      const b = pointBundle(model, { pointDistMm: model.focus.distanceMm ?? 1e6, fieldFrac: 0, rays: 9, nms: FAN_NMS });
      bundleGroup.position.z = -imageZ;
      const set = [{ field: 0, fieldDeg: 0, paths: b.paths }];
      // with the mirror down the cone converges on the focusing screen instead, at the same optical distance
      bundle.update(state.body === 'dslr' && !mirrorUp ? reflectAtMirror(set, imageZ) : set);
    }
    // the iris seen from the front and the single cone read cleaner without the general fans and the bundle
    raysGroup.visible = raysOn && detail !== 'iris' && detail !== 'focusRing';
    // with a part picked, the light is still there but steps back behind the part (R1-04)
    // (the glass mode too, and the focus mode's one cone at half: the part leads, the light is its context; R2-02)
    rayMat.opacity = detail ? RAYS_DETAIL_OPACITY : 1;
    // The one-point bundle in the focus-ring mode used a lighter dim (0.5) than every other detail mode's 0.35,
    // so on a phone, where the ring itself is already small, the bright rays read as full strength next to it
    // (R3-09). Match the rest of the detail modes.
    bMat.opacity = detail === 'focusRing' ? RAYS_DETAIL_OPACITY : 0.7;
    // score loop r6: the fan reads as plain white lines from outside, where the three colors lie on top of one another. One small
    // line at the fan's entry says so, and leaves once a part is picked, the cutaway opens or the rays are hidden. On a narrow view the
    // fan's entry is off the picture, so there is no room for it.
    const lead = axisPaths.length && !detail && view === 'outside' && ctx.renderer.domElement.clientWidth >= 900 ? axisPaths.reduce((m, p) => (p.pts[0].z < m.pts[0].z ? p : m), axisPaths[0]) : null;
    // 45% of the way from the entry to the first glass, above the fan: on screen from the usual front view, and clear of the lens itself
    const entry = lead ? lead.pts[0].clone().lerp(lead.pts[1], 0.45) : null;
    if (raysGroup.visible && entry && group.visible) ctx.labels.set('rig-rays-key', { world: new THREE.Vector3(entry.x, entry.y + 20, entry.z), text: 'White = 3 colors overlapped', kind: 'hud' });
    else ctx.labels.remove('rig-rays-key');
  }

  // what each detail mode puts its pin on (the part's own box)
  const DETAIL_PARTS: Record<string, string[]> = {
    lens: ['barrel'], focusRing: ['focusRing'], glass: ['glass'], mount: ['lensMount', 'mount'],
    sensor: ['pixelArray', 'sensorPackage'], shutter: ['shutter', 'ibisPlate'],
    viewfinder: ['prism', 'focusingScreen', 'evfPanel', 'evfHousing'],
  };
  function wholeRigBox() {
    const box = new THREE.Box3();
    assembly.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && !o.userData.edgeBand) box.expandByObject(o); });
    if (box.isEmpty()) box.set(new THREE.Vector3(-80, -60, -150), new THREE.Vector3(80, 80, 40));
    return box;
  }
  /** Each mode frames its part's own box inside the free rectangle the chrome leaves (the exposure rail on a wide
   *  screen, the sheet on a phone: the stage measures both into camera.userData.insets). */
  function partFrame(id: string): CameraFrame {
    const barrel = boxOf(['barrel']);
    const cutDir = new THREE.Vector3(-0.9, 0.3, -0.42);
    // the traced rays lie in the meridional plane (x = 0): straight from the side shows their whole path
    const side = new THREE.Vector3(-1, 0.12, -0.08);
    switch (id) {
      case 'iris': {
        // through the front element about 3 degrees off the axis (10 in earlier rounds: the stop and the entrance pupil lie in different
        // planes, so any more angle slid the pupil ring off the blades' opening, a misalignment the view could not explain), the opening
        // filling about 40% of the free height
        const z = iris.position.z, front = barrel.isEmpty() ? z - 80 : barrel.min.z;
        const m = lastModel;
        const imageZ = m ? m.system.surfaces[m.system.surfaces.length - 1].z : 0;
        const epZ = m ? m.cardinal.ep.z - imageZ : z;
        const epR = m ? m.cardinal.ep.r : 10;
        const a = THREE.MathUtils.degToRad(3);
        const dir = new THREE.Vector3(-Math.sin(a), Math.sin(a) * 0.35, -Math.cos(a)).normalize();
        if (!barrel.isEmpty() && (epZ < barrel.min.z || epZ > barrel.max.z)) {
          return fitBox(barrel, dir, 1.2);
        }
        const { fh } = freeFraction();
        const tanV = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) * fh;
        const dist = Math.max(epR / (0.4 * tanV), epZ - front + 25);
        return { position: new THREE.Vector3(0, 0, epZ).addScaledVector(dir, dist), target: new THREE.Vector3(0, 0, epZ) };
      }
      // Side-on, keep the whole path from the front element to the sensor visible. A margin below one zooms past
      // the free rectangle and crops a long lens and body on phones; retain a small gutter around both endpoints.
      case 'focusRing': return fitBox(wholeRigBox(), side, phoneMq?.matches ? 1.04 : 1.08);
      case 'lens': return fitBox(barrel, new THREE.Vector3(-0.62, 0.34, -0.71), 1.2);
      // the glass with its barrel around it: the whole stack in section, not a close-up among ghosted walls
      case 'glass': return fitBox(barrel.clone().union(boxOf(['glass'])), side, 1.12);
      case 'mount': return fitBox(boxOf(['mount', 'lensMount']), new THREE.Vector3(-0.55, 0.3, -0.78), 1.5);
      case 'sensor': return fitBox(boxOf(['sensorPackage', 'filterStack']), new THREE.Vector3(-0.62, 0.24, -0.75), 2.0);
      case 'shutter': return fitBox(boxOf(['shutter', 'ibisPlate', 'sensorPackage']), cutDir, 1.9);
      case 'viewfinder': return fitBox(boxOf(state.body === 'dslr' ? ['mirror', 'focusingScreen', 'prism', 'pixelArray'] : ['evfHousing', 'evfPanel', 'pixelArray']), side, 1.3);
      default: return frame();
    }
  }

  /** The picked part, lifted a little so it reads against its faded surroundings (R1-04: the focus ring was lost). */
  const litCache = new Map<THREE.Material, THREE.Material>();
  function lit(src: THREE.Material): THREE.Material {
    let f = litCache.get(src);
    if (!f) {
      f = src.clone();
      const m = f as THREE.MeshStandardMaterial;
      // 0x1d1f23 (linear ~0.012) vanished on near-black paint and silicon under ACES: a picked mount or sensor read
      // no different from its ghosted surroundings (P-02), and once the frosted filter glass was made faint (P-05)
      // the silicon itself read as a dark hole. A neutral slate lift about three times stronger keeps each part's
      // own hue (an amber wash turned rubber and silicon brown) and a little more environment shows its form.
      if ('emissive' in m && m.emissive) { m.emissive = new THREE.Color(0x343a44); m.emissiveIntensity = 1; }
      if ('envMapIntensity' in m) m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.6);
      // the silicon is the whole subject of the sensor mode and is seen at a grazing angle that reflects the dark
      // half of the studio: it gets a stronger lift of its own slate hue so the active area reads as a surface
      if (src.name === 'PixelArray' && 'emissive' in m && m.emissive) {
        // score loop r5: a die with a bezel, a fine pixel grid and a faint Bayer tint (look.ts sensorDieTexture), not one flat
        // slate rectangle. The map drives both the base colour and the emissive lift, so the grid and bezel stay visible
        // where the lift would otherwise wash them out; the material's iridescence still shifts with the view.
        const die = ctx.look.sensorDieTexture();
        m.envMapIntensity = 2.8;
        if (die) { m.color = new THREE.Color(0xffffff); m.map = die; m.emissive = new THREE.Color(0xb8c4d8); m.emissiveMap = die; m.emissiveIntensity = 0.8; m.roughness = 0.3; m.metalness = 0.35; }
        else m.emissive = new THREE.Color(0x4f5d70);
      }
      // The DSLR's mirror is a polished metal that already mirrors the studio: the slate emissive lift and the 1.6x
      // environment turned it into the brightest flat white slab in the Viewfinder view, a paper cutout (score loop r4,
      // presentation review). Picked, it keeps its metal (metalness 1, a smooth coat), no emissive lift, and a lower
      // reflection and base so the softbox sweeping across it grades from graphite to silver and stays under white.
      if (src.name === 'MirrorSurface') {
        m.emissive = new THREE.Color(0x000000);
        m.envMapIntensity = 0.16;
        m.color.setScalar(0.7);
        m.roughness = 0.1;
        m.metalness = 1;
        const fade = ctx.look.mirrorFadeTexture();
        if (fade) m.map = fade;
      }
      litCache.set(src, f);
    }
    return f;
  }
  /** The meshes of the named parts, not glass (for lifting the picked part). */
  function partMeshes(names: string[]): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const n of names.flatMap((x) => [x, `${x}Cut`])) {
      const o = lensRoot?.getObjectByName(n) ?? bodyRoot?.getObjectByName(n);
      o?.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && !/glass/i.test(m.material.name ?? '')) out.push(m); });
    }
    return out;
  }

  function openDetail(id: string | null) {
    const materialsBefore = fadedCache.size + litCache.size;
    detail = id;
    selected = id;
    const p = PROBES.find((x) => x.id === id);
    if (!p) unhighlight();
    if (p) highlightNames(p.parts, id === 'lens' || id === 'glass');
    if (p && id !== 'lens' && id !== 'glass') {
      // the package frame stays dark; only the silicon is lifted (R2-02)
      for (const m of partMeshes(p.parts.filter((n) => n !== 'sensorPackage'))) { if (!originals.has(m)) originals.set(m, m.material); m.material = lit(originals.get(m) as THREE.Material); }
    }
    // the focus ring is seen from outside, solid, with the rest ghosted around the one point's cone (R1-04)
    const cutParts = ['glass', 'sensor', 'shutter', 'viewfinder'];
    const forceView = (v: View) => { viewBeforePick ??= view; view = v; applyView(); if (lastModel) applyModel(lastModel); };
    if (id === 'focusRing' && view !== 'outside') forceView('outside');
    if (id && cutParts.includes(id) && view !== 'cutaway') forceView('cutaway');
    // the blades are seen through the front element, so the iris opens from outside, with the whole lens in place
    if (id === 'iris' && view !== 'outside') forceView('outside');
    // the selection cleared: the view the pick took the reader out of comes back (Esc left the cutaway on, with Parts open)
    if (!id && viewBeforePick) { const back = viewBeforePick; viewBeforePick = null; if (back !== view) { view = back; applyView(); if (lastModel) applyModel(lastModel); } }
    // the sensor, the shutter and the focus cone are seen with the mirror swung up out of the way
    if (!exposure.running()) exposure.liftMirror(id === 'sensor' || id === 'shutter' || id === 'focusRing' || id === 'glass');
    crumb.hidden = !p;
    document.body.classList.toggle('rig-detail', !!p && group.visible);
    (crumb.querySelector('.rc-here') as HTMLElement).textContent = p?.label ?? '';
    linkTo = id === 'sensor' ? 'loupe' : id === 'focusRing' ? 'cone' : id === 'lens' || id === 'glass' ? 'lens' : null;
    linkBtn.hidden = !linkTo;
    linkBtn.textContent = linkTo === 'loupe' ? 'Go inside: One pixel →' : linkTo === 'cone' ? 'Go inside: Focus & bokeh →' : 'Go inside: Optics →'; // the card's door says the same (ui.ts)
    teach.stop();
    if (lastModel) updateExtras(lastModel);
    anchorProbes();
    fitDive(p ? partFrame(p.id) : frame());
    if (fadedCache.size + litCache.size > materialsBefore) compileNewMaterials();
  }

  /** A fitted frame: flown to, and flown to again if the chrome around it moves before the reader takes over (the
   *  phone's sheet opening, the rail filling in on load). */
  let userMoved = false;
  let lastFit: (() => CameraFrame) | null = null;
  function fitDive(f: CameraFrame) {
    userMoved = false;
    const id = detail;
    lastFit = () => (id ? partFrame(id) : frame());
    ctx.dive(f);
  }

  // Persistent overview affordances, backed by the orientation-independent controls in the exposure strip.
  // They pause for part inspections and exposure playback, then return without a hover or first-visit timer.
  const teach = (() => {
    const marks: { node: string; text: string; side: string; el: HTMLElement; lw?: number; lh?: number; fonts?: string; kept?: string; showAt?: number }[] = [];
    let on = false;
    let lastLayoutKey = '', lastLayoutAt = -Infinity;
    // Phone label placement (a free-slot search against every pin and HUD rectangle) is too slow for every frame on a
    // throttled phone: about 14 fps while orbiting (score loop r1). While the camera moves, only the rings follow their
    // controls and the text waits; it is placed once the camera has held still for one frame, and an idle recheck
    // (four times a second, for late HUD layout) searches again only when one of the rectangles it avoids has moved.
    let lastCamKey = '', placedKey = '', settling = false, mergedPair = false;
    let rigBox: { key: string; box: THREE.Box3 } | null = null;
    const setSettling = (v: boolean) => {
      if (v === settling) return;
      settling = v;
      for (const m of marks) for (const el of m.el.querySelectorAll<HTMLElement>('span, .rig-teach-leader')) el.style.visibility = v ? 'hidden' : '';
    };
    /** One projected screen point per mark, from the node's box (no DOM access). */
    const anchorOf = (node: string, w: number, h: number) => {
      const o = assembly.getObjectByName(node);
      if (!o) return null;
      const b = new THREE.Box3().setFromObject(o);
      const at = b.getCenter(new THREE.Vector3());
      // the focus ring's mark sits on the ring's camera-facing side, the middle of its visible band, never on its
      // top edge where the projected circle spilled onto the grip behind (R2-FID-3)
      if (node === 'focusRing') {
        const r = Math.max(b.max.x - at.x, b.max.y - at.y) * 0.97;
        const toCam = new THREE.Vector2(ctx.camera.position.x - at.x, ctx.camera.position.y - at.y);
        if (toCam.lengthSq() < 1e-6) toCam.set(0, 1);
        toCam.normalize();
        at.x += toCam.x * r; at.y += toCam.y * r;
      }
      const p = at.project(ctx.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, front: p.z < 1 };
    };
    return {
      start() {
        if (on || view !== 'outside' || detail || exposure.running() || !group.visible || !bodyRoot) return;
        on = true;
        lastLayoutKey = ''; lastLayoutAt = -Infinity; lastCamKey = ''; placedKey = ''; settling = false; mergedPair = false;
        // each label leans its own way (the dial and the button sit close together on the grip; on a phone they
        // take opposite sides of it)
        const narrow = (ctx.overlay.clientWidth || 1000) < 560;
        for (const [node, text, side] of [['focusRing', 'Drag to focus', 'down'], ['commandDialFront', 'Adjust aperture', 'left'], ['shutterButton', 'Fire shutter', narrow ? 'right' : 'up']] as const) {
          const el = document.createElement('div');
          el.className = `rig-teach ${side}`;
          el.innerHTML = `<i></i><b class="rig-teach-leader" aria-hidden="true"></b><span>${text}</span>`;
          ctx.overlay.appendChild(el);
          marks.push({ node, text, side, el });
        }
      },
      /** The control(s) a ring marks where a pointer is inside it, as assembly node names: one for a single ring, both
       *  the shutter button and the front dial for the shared one (pick() resolves them). Null outside every ring. */
      ringAt(clientX: number, clientY: number): string[] | null {
        if (!on) return null;
        const o = ctx.overlay.getBoundingClientRect();
        for (const m of marks) {
          if (m.el.style.display === 'none' || m.el.classList.contains('gone')) continue;
          const x = parseFloat(m.el.style.left), y = parseFloat(m.el.style.top);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const rad = (m.el.querySelector('i') as HTMLElement | null)?.offsetWidth ? (m.el.querySelector('i') as HTMLElement).offsetWidth / 2 : 20;
          if (Math.hypot(clientX - o.left - x, clientY - o.top - y) <= rad) return m.el.classList.contains('pair') ? ['shutterButton', 'commandDialFront'] : [m.node];
        }
        return null;
      },
      stop() {
        if (!on) return;
        on = false;
        for (const m of marks) m.el.remove();
        marks.length = 0;
      },
      tick() {
        // A cutaway removes physical controls; its persistent native strip remains the interaction target.
        if (view !== 'outside') { this.stop(); return; }
        if (!on) this.start();
        if (!on) return;
        const w = ctx.overlay.clientWidth || 1, h = ctx.overlay.clientHeight || 1;
        const now = performance.now();
        const narrow = w <= 760;
        // rounded well below a pixel: orbit damping keeps nudging the camera by vanishing amounts for seconds after a
        // gesture, which must count as still
        const camKey = [...ctx.camera.position.toArray().map((v) => v.toFixed(2)), ...ctx.camera.quaternion.toArray().map((v) => v.toFixed(5)),
          ...ctx.camera.projectionMatrix.elements.map((v) => v.toPrecision(6))].join('|');
        const layoutKey = [w, h, state.lens, lastModel?.scenario.focusM, lastModel?.scenario.fno, camKey].join('|');
        const camMoved = camKey !== lastCamKey;
        lastCamKey = camKey;
        if (narrow && camMoved && placedKey) {
          // the camera is moving: the rings track their controls, the text waits for the camera to stop
          ctx.camera.updateMatrixWorld(true);
          setSettling(true);
          const dialA = mergedPair ? anchorOf('commandDialFront', w, h) : null;
          for (const m of marks) {
            let a = anchorOf(m.node, w, h);
            if (!a || (mergedPair && m.node === 'commandDialFront')) { m.el.style.display = 'none'; continue; }
            // the merged shutter/aperture ring keeps marking the pair while the text waits
            if (mergedPair && m.node === 'shutterButton' && dialA) a = { x: (a.x + dialA.x) / 2, y: (a.y + dialA.y) / 2, front: a.front || dialA.front };
            m.el.style.display = a.front ? '' : 'none';
            m.el.style.left = `${a.x}px`;
            m.el.style.top = `${a.y}px`;
          }
          return;
        }
        // Orbiting controls track immediately on a wide view; an idle camera only rechecks late-arriving HUD layout
        // four times a second instead of searching all phone label slots on every animation frame.
        if (layoutKey === lastLayoutKey && now - lastLayoutAt < 250 && !settling) return;
        lastLayoutKey = layoutKey; lastLayoutAt = now;
        // The stage ticks overlays before rendering, so a just-completed camera dive has not yet
        // refreshed matrixWorldInverse. Do not cache a projection from its previous position.
        ctx.camera.updateMatrixWorld(true);
        // each label takes the first side that keeps it inside the view and off the labels placed before it
        type R = { l: number; t: number; r: number; b: number };
        const taken: R[] = [];
        // All DOM reads first (rectangles, label sizes), then the writes, so the browser lays out once per pass.
        const overlayOrigin = ctx.overlay.getBoundingClientRect();
        // Keep all numbered part pins available: the teaching labels yield when a pin needs the space.
        for (const el of ctx.overlay.parentElement!.querySelectorAll<HTMLElement>('.pin, .hud.tl, .hud.tr, .hud.br, .hud.bl')) {
          if (!el.offsetWidth || !el.offsetHeight || getComputedStyle(el).visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          taken.push({ l: rect.left - overlayOrigin.left - 3, t: rect.top - overlayOrigin.top - 3,
            r: rect.right - overlayOrigin.left + 3, b: rect.bottom - overlayOrigin.top + 3 });
        }
        if (narrow) {
          for (const el of ctx.overlay.parentElement!.querySelectorAll<HTMLElement>('.hud.tr, .hud.br, .hud.bl')) {
            if (!el.offsetWidth || !el.offsetHeight) continue;
            const r = el.getBoundingClientRect();
            taken.push({ l: r.left - overlayOrigin.left - 4, t: r.top - overlayOrigin.top - 4, r: r.right - overlayOrigin.left + 4, b: r.bottom - overlayOrigin.top + 4 });
          }
          // measured again once the web fonts arrive (they load without blocking the first paint)
          const fontsKey = typeof document.fonts === 'undefined' ? 'none' : `${document.fonts.status}${document.fonts.size}`;
          for (const m of marks) if (!m.lw || m.fonts !== fontsKey) {
            const label = m.el.querySelector('span')!;
            if (label.offsetWidth) { m.lw = label.offsetWidth; m.lh = label.offsetHeight; m.fonts = fontsKey; }
          }
          // nothing the search depends on has moved since the last placement: keep it
          const key = layoutKey + '#' + fontsKey + '#' + taken.map((q) => `${Math.round(q.l)},${Math.round(q.t)},${Math.round(q.r)},${Math.round(q.b)}`).join(';');
          if (key === placedKey && !settling) return;
          placedKey = key;
          // Keep phone text outside the projected rig, including while the camera settles into its frame. The rig's
          // box changes only with the loaded models, the focus and the view, not with the camera.
          const boxKey = [rigKey, state.lens, lastModel?.scenario.focusM, view, unitShift].join('|');
          if (rigBox?.key !== boxKey) rigBox = { key: boxKey, box: wholeRigBox() };
          const box = rigBox.box;
          const model: R = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
          const corner = new THREE.Vector3();
          for (const bx of [box.min.x, box.max.x]) for (const by of [box.min.y, box.max.y]) for (const bz of [box.min.z, box.max.z]) {
            const p = corner.set(bx, by, bz).project(ctx.camera);
            const px = (p.x + 1) * w / 2, py = (1 - p.y) * h / 2;
            model.l = Math.min(model.l, px - 6); model.r = Math.max(model.r, px + 6);
            model.t = Math.min(model.t, py - 6); model.b = Math.max(model.b, py + 6);
          }
          taken.push(model);
        }
        setSettling(false);
        // every ring's projected center first, so two controls that sit together can share one ring
        const at2 = new Map<string, { x: number; y: number; front: boolean }>();
        for (const m of marks) { const a = anchorOf(m.node, w, h); if (a) at2.set(m.node, a); }
        // The shutter button sits on top of the front command dial, so from most views their two rings overlapped and
        // two labels fought over one spot (score loop r1, the rubric's overlapping-labels smell). When the rings would
        // touch, one ring marks the pair and its label names both actions; the aperture mark steps aside.
        const fireAt = at2.get('shutterButton'), dialAt = at2.get('commandDialFront');
        const ringPx = (marks[0]?.el.querySelector('i') as HTMLElement | null)?.offsetWidth || 40;
        const merged = !!fireAt && !!dialAt && Math.hypot(fireAt.x - dialAt.x, fireAt.y - dialAt.y) < ringPx + 6;
        mergedPair = merged;
        if (merged) at2.set('shutterButton', { x: (fireAt!.x + dialAt!.x) / 2, y: (fireAt!.y + dialAt!.y) / 2, front: fireAt!.front || dialAt!.front });
        for (const m of marks) {
          const pos = at2.get(m.node);
          if (!pos || (merged && m.node === 'commandDialFront')) { m.el.style.display = 'none'; continue; }
          const pair = merged && m.node === 'shutterButton';
          const labelText = pair ? 'Click: fire shutter · Drag: aperture' : m.text;
          const span = m.el.querySelector('span')!;
          // a phone stacks the pair's two actions, so the label fits a free slot beside the body
          const html = pair && narrow ? 'Click: fire<br>Drag: aperture' : labelText;
          if (span.dataset.html !== html) { span.dataset.html = html; if (pair && narrow) span.innerHTML = html; else span.textContent = html; m.lw = undefined; }
          m.el.classList.toggle('pair', pair);
          const { x, y } = pos;
          // Rings locate physical controls. Only the attached text may move to
          // avoid collisions; displacing a ring makes it point at empty space.
          m.el.style.display = pos.front ? '' : 'none';
          m.el.style.left = `${x}px`;
          m.el.style.top = `${y}px`;
          // A fixed phone offset still covers the body or barrel; place text in free space (R3-FID-3).
          const label = m.el.querySelector('span')!;
          const leader = m.el.querySelector<HTMLElement>('.rig-teach-leader')!;
          m.el.classList.toggle('placed', narrow);
          label.hidden = false;
          if (narrow) {
            // The label's measured size (cached: the text never changes), then the nearest free slot. Rings stay on
            // their controls.
            const lw = m.lw ?? label.offsetWidth, lh = m.lh ?? label.offsetHeight;
            const xs = [Math.max(8, Math.min(w - lw - 8, x - lw / 2))];
            for (let left = 8; left <= w - lw - 8; left += 12) xs.push(left);
            let best: R | undefined, score = Infinity;
            for (let top = 64; top <= h - lh - 8; top += 8) for (const left of xs) {
              // distance first: a slot no nearer than the best so far needs no collision test
              const d = Math.hypot(left + lw / 2 - x, top + lh / 2 - y);
              if (d >= score) continue;
              const cl = left - 4, cr = left + lw + 4, ct = top - 4, cb = top + lh + 4;
              let free = true;
              for (const q of taken) if (cl < q.r && q.l < cr && ct < q.b && q.t < cb) { free = false; break; }
              if (free) { best = { l: left, t: top, r: left + lw, b: top + lh }; score = d; }
            }
            label.hidden = !best;
            leader.hidden = !best;
            if (best) {
              taken.push(best);
              label.style.left = (best.l - x + 20) + 'px';
              label.style.top = (best.t - y + 20) + 'px';
              const dx = Math.max(best.l, Math.min(best.r, x)) - x;
              const dy = Math.max(best.t, Math.min(best.b, y)) - y;
              const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
              leader.style.width = Math.max(0, length - 24) + 'px';
              leader.style.transform = 'rotate(' + angle + 'rad) translateX(22px)';
            }
            continue;
          }
          label.style.removeProperty('left'); label.style.removeProperty('top');
          leader.hidden = true;
          const gap = 26, sideGap = 28;
          const lw = labelText.length * 8.2 + 16, lh = 22;
          // Score loop r3: above or below a ring, the label may also slide so that it ends at the ring (to its left) or
          // starts at it (to its right). On the 800 mm lens the shutter's label, with its plain 'up' slot under pin 8,
          // fell to 'down' and lay across the barrel, 24 px over "Drag to focus"; up-left keeps it off the subject.
          const slide = lw / 2 - 20;
          const rect: Record<string, R> = {
            down: { l: x - lw / 2, t: y + gap, r: x + lw / 2, b: y + gap + lh },
            up: { l: x - lw / 2, t: y - gap - lh, r: x + lw / 2, b: y - gap },
            left: { l: x - sideGap - lw, t: y - lh / 2, r: x - sideGap, b: y + lh / 2 },
            right: { l: x + sideGap, t: y - lh / 2, r: x + sideGap + lw, b: y + lh / 2 },
          };
          for (const v of ['up', 'down'] as const) {
            rect[`${v}L`] = { ...rect[v], l: rect[v].l - slide, r: rect[v].r - slide };
            rect[`${v}R`] = { ...rect[v], l: rect[v].l + slide, r: rect[v].r + slide };
          }
          const hit = (a: R) => a.l < 4 || a.t < 4 || a.r > w - 4 || a.b > h - 4 || taken.some((q) => a.l < q.r && q.l < a.r && a.t < q.b && q.t < a.b);
          // Score loop r2: a label keeps the side it has while that side stays free, and a label whose side has just
          // changed waits half a second before it shows. The part pins also yield to these labels, so without this the
          // two passes traded the space and "Drag to focus" jumped 71 px about 4 s after load with nothing changed.
          const order = [m.kept ?? m.side, m.side, `${m.side}L`, `${m.side}R`, 'down', 'up', 'left', 'right', 'upL', 'upR', 'downL', 'downR']
            .filter((v, k, arr) => rect[v] && arr.indexOf(v) === k);
          const side = order.find((sd) => !hit(rect[sd]));
          label.hidden = !side;
          if (!side) { m.kept = undefined; continue; }
          if (side !== m.kept) { m.kept = side; m.showAt = now + 500; }
          label.style.visibility = now < (m.showAt ?? 0) ? 'hidden' : '';
          // a later teach label keeps at least 16 px from this one (score loop r3)
          const placedRect = rect[side];
          taken.push({ l: placedRect.l - 16, t: placedRect.t - 16, r: placedRect.r + 16, b: placedRect.b + 16 });
          const base = side.replace(/[LR]$/, '');
          const dxSlide = side.endsWith('L') ? -slide : side.endsWith('R') ? slide : 0;
          if (dxSlide) label.style.transform = `translateX(calc(-50% + ${dxSlide.toFixed(1)}px))`; else label.style.removeProperty('transform');
          for (const sd of ['down', 'up', 'left', 'right']) m.el.classList.toggle(sd, sd === base);
        }
      },
    };
  })();

  // The depth range follows the viewing distance (R1-FID-A): the stage's 0.01 mm near plane left 24-bit depth about
  // 6 mm of resolution at 1 m, so the coaxial rings and shells a few mm apart z-fought. near = distance / 100 keeps the
  // closest part of the rig far in front of it at every framing this level uses; far = distance x 20.
  let insetSig = '';
  let savedNear = ctx.camera.near, savedFar = ctx.camera.far;
  const rigCenter = new THREE.Vector3();
  let clipTick = 0;
  function fitClip() {
    const cam = ctx.camera;
    if ((lensRoot || bodyRoot) && clipTick++ % 30 === 0) wholeRigBox().getCenter(rigCenter);
    const dist = Math.max(1, cam.position.distanceTo(rigCenter));
    const near = Math.max(0.5, dist / 100), far = Math.max(2000, dist * 20);
    if (Math.abs(near - cam.near) / cam.near > 0.02 || Math.abs(far - cam.far) / cam.far > 0.02) {
      cam.near = near; cam.far = far;
      cam.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  let savedTone: THREE.ToneMapping | null = null;
  let savedExposure = 1;
  let savedEnv: THREE.Texture | null | undefined;
  let savedBackground: THREE.Scene['background'] | undefined;
  const r = ctx.renderer as unknown as { toneMapping: THREE.ToneMapping; toneMappingExposure: number };

  return {
    group,
    probes: PROBES,
    update(model, scenario) {
      const previous = lastModel?.scenario;
      const opticsChanged = !previous || previous.lens !== model.scenario.lens
        || previous.focusM !== model.scenario.focusM || previous.fno !== model.scenario.fno
        || previous.format !== model.scenario.format;
      lastModel = model; lastScenario = scenario;
      exposure.syncModel();
      // the part names follow the lens's body now, not when its model finishes loading, so the parts list never shows
      // the DSLR's "Shutter" for a mirrorless lens
      const bodyNow = bodyForLens(scenario.lens);
      if (bodyNow) for (const p of PROBES) p.label = partLabel(p.id as PartId, bodyNow);
      loading = ensureRig(scenario.lens);
      // ISO, shutter duration and scene illumination change the exposure, not the
      // lens geometry. Keep the existing iris/ray buffers in those cases. Explicit
      // mirror, cutaway and async rig-load changes still call applyModel directly.
      if (opticsChanged) applyModel(model);
      anchorProbes();
      if (detail && group.visible && !userMoved) fitDive(partFrame(detail));
    },
    frame,
    onViewInteraction() { userMoved = true; },
    tick(dt: number, now: number) {
      // the shot's playback is the only thing that moves the rig on its own; everything else follows an update, an
      // input or a dive, which the stage already draws (render on demand, score loop r2)
      const animated = exposure.tick(now, dt);
      // the chrome moved (the phone's sheet opened, the rail filled in) since the last fit: fly to the fit again,
      // unless the reader has taken the camera over since
      const ins = ctx.camera.userData.insets as Record<string, number> | undefined;
      const sig = ins ? `${ins.left}|${ins.top}|${ins.right}|${ins.bottom}|${ins.width}|${ins.height}` : '';
      if (sig !== insetSig) { insetSig = sig; if (lastFit && !userMoved) ctx.dive(lastFit()); }
      const clipped = fitClip();
      teach.tick();
      return animated || clipped;
    },
    select(id: string | null) { openDetail(id); },
    activate() {
      savedTone = r.toneMapping;
      savedExposure = r.toneMappingExposure;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      savedEnv = ctx.scene.environment;
      ctx.scene.environment = studio.texture;
      // score loop r6: a dark body on pure black had no edge to read against. A soft pool of cool light behind it (screen
      // space, no bloom) lifts the void to about 30/255 at its center and falls to black at the view's edge.
      savedBackground = ctx.scene.background;
      const backdrop = ctx.look.stageBackdropTexture();
      if (backdrop) ctx.scene.background = backdrop;
      viewSwitch.hidden = false;
      exposure.el.hidden = false;
      savedNear = ctx.camera.near; savedFar = ctx.camera.far;
      if (!everLoaded) reportProgress();
      else if (uncompiled) compileNewMaterials();
    },
    deactivate() {
      exposure.pause();
      ctx.labels.remove('rig-ep');
      ctx.labels.remove('rig-rays-key');
      ctx.badge.hide();
      if (savedTone !== null) { r.toneMapping = savedTone; r.toneMappingExposure = savedExposure; }
      if (savedEnv !== undefined) ctx.scene.environment = savedEnv;
      if (savedBackground !== undefined) ctx.scene.background = savedBackground;
      viewSwitch.hidden = true;
      exposure.el.hidden = true;
      teach.stop();
      ctx.camera.near = savedNear; ctx.camera.far = savedFar;
      ctx.camera.updateProjectionMatrix();
      document.body.classList.remove('rig-detail');
    },
    hooks: {
      state: () => ({ ...state, view, selected, raysOn, loaded: !!lensRoot || !!bodyRoot, opticsRevision }),
      ready: async () => { await loading; await inflight; return !!bodyRoot; },
      frameFor: () => { const f = frame(); return { position: f.position.toArray(), target: f.target.toArray() }; },
      /** Test hook: where the camera is, what it sees and what the chrome leaves free. */
      camDebug: () => { const c = ctx.camera; const b = wholeRigBox(); return { pos: c.position.toArray().map((v) => +v.toFixed(1)), aspect: +c.aspect.toFixed(3), near: +c.near.toFixed(2), far: Math.round(c.far),
        insets: c.userData.insets, box: [b.min.toArray().map(Math.round), b.max.toArray().map(Math.round)], unitShift, detail, fov: c.fov, zoom: c.zoom,
        ndc: (() => { c.updateMatrixWorld(true); const xs: number[] = [], ys: number[] = []; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const q = new THREE.Vector3(x, y, z).project(c); xs.push(q.x); ys.push(q.y); } return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(2)); })() }; },
      partFrame: (id: string) => { const f = partFrame(id); return { position: f.position.toArray(), target: f.target.toArray() }; },
      eq: (dir: 1 | -1) => exposure.equalStep(dir),
      setView: (v: View) => setView(v),
      /** Test hook: the visible meshes under a point of the view (CSS px from the canvas's top-left), nearest first. */
      pick: (px: number, py: number) => {
        const dom = ctx.renderer.domElement, rect = dom.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), ctx.camera);
        return ray.intersectObject(assembly, true).filter((h) => { for (let n: THREE.Object3D | null = h.object; n; n = n.parent) if (!n.visible) return false; return true; })
          .slice(0, 5).map((h) => { const m = h.object as THREE.Mesh; const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            return { name: m.name, material: mat.name, color: mat.color?.getHexString(), metal: mat.metalness, rough: mat.roughness, clearcoat: (mat as THREE.MeshPhysicalMaterial).clearcoat, dist: +h.distance.toFixed(1) }; });
      },
      detail: () => detail,
      reflected: () => state.reflected,
      /** Test hook: the visible meshes with a world-space box, name and owning component (for layout checks). */
      visibleMeshes: () => { const out: { name: string; component: string; cut: string; box: number[] }[] = [];
        assembly.updateMatrixWorld(true);
        assembly.traverseVisible((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; let c = ''; for (let n: THREE.Object3D | null = m; n && !c; n = n.parent) c = (n.userData?.component as string) ?? '';
          const b = new THREE.Box3().setFromObject(m); out.push({ name: m.name, component: c, cut: String(m.userData.cutaway ?? ''), box: [...b.min.toArray(), ...b.max.toArray()].map((v) => Math.round(v)) }); });
        return out; },
      mirrorDebug: () => {
        const g = mirrorPlane();
        if (!g || !lastModel) return null;
        const surf = lastModel.system.surfaces; const imageZ = surf[surf.length - 1].z;
        const fans = marginalAwareFans(lastModel, [0], FAN_NMS, FAN_RAYS);
        return { n: g.plane.normal.toArray(), c: g.plane.constant, box: [g.box.min.toArray(), g.box.max.toArray()], screenY: g.screenY,
          segs: fans[0].paths.slice(0, 7).map((p) => { const a = p.pts[p.pts.length - 2], b = p.pts[p.pts.length - 1];
            const A = new THREE.Vector3(a[0], a[1], a[2] - imageZ), B = new THREE.Vector3(b[0], b[1], b[2] - imageZ);
            const da = g.plane.distanceToPoint(A), db = g.plane.distanceToPoint(B);
            const hit = A.clone().lerp(B, da / (da - db));
            return { n: p.pts.length, status: p.status, a: A.toArray().map((v) => +v.toFixed(2)), b: B.toArray().map((v) => +v.toFixed(2)), da: +da.toFixed(2), db: +db.toFixed(2), hit: hit.toArray().map((v) => +v.toFixed(2)) }; }) };
      },
      fire: () => exposure.fire(),
      exposure: () => exposure.state(),
      exposurePause: () => exposure.pause(),
      exposureResume: () => exposure.resume(),
      exposureSeek: (fraction: number) => exposure.seek(fraction),
      /** Test hook: the focus distance (mm; null = infinity) a drag of the ring to `angle` sets. */
      ringTo: (angle: number) => (lastModel ? distanceForRingAngle(lastModel, angle) : undefined),
    },
    dispose() {
      ++rigGeneration;
      rays.dispose();
      exposure.dispose();
      offLayer();
      offPause();
      offRetry();
      phoneMq?.removeEventListener('change', placePanel);
      viewSwitch.remove();
      teach.stop();
      studio.dispose();
      detach();
      window.removeEventListener('keydown', onKey);
      bundle.dispose();
      iris.geometry.dispose();
      draco.dispose();
    },
  };
};
