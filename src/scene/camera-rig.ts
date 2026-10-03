// The camera: docs/PANE.md's one scene. The body and the lens are the scripted-Blender models (public/models), both
// built in the frame the engine's optics map into (sensor plane at z = 0, lens toward -z, mount face at -flange), so
// the engine's own numbers place everything inside them with no fitting:
//   - each glass element moves with focus by exactly the engine's surface displacement from infinity focus;
//   - the iris is the engine's opening outline (model.iris), rebuilt on every aperture change;
//   - the focus ring and its distance scale turn by the engine's focus travel (engine-api focusRingAngle);
//   - the light is the engine's traced ray fans, entering the front element and landing on the sensor;
//   - the bundle in front of the lens is the entrance pupil (model.cardinal.ep): its width IS the aperture.
// The piece draws; the engine computes (src/pieces/types.ts). Detail modes (iris, focus cone, sensor dive, mirror,
// shutter) come next and re-house the first-pass pieces.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { BuildPiece, CameraFrame, PartCard, PieceProbe } from '../pieces/types';
import type { FanSet, Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { buildRays } from '../pieces/lens/rays';
import { marginalAwareFans } from '../pieces/lens/marginal-rays';
import { bodyForLens, compute, distanceForRingAngle, pointBundle, focusRingAngle, focusRingThrow, lensSummary, type BodyId } from '../app/engine-api';
import { createExposure } from './rig-exposure';
import { apertureSteps, THIRD_STOP_SHUTTER } from '../app/stops';
import { LENS_FACTS as LENSES, partCard, partLabel, type PartId } from '../app/rig-cards';
import bodyFacts from '../../public/models/bodies.json';

type View = 'outside' | 'cutaway';

// three wavelengths for the fans (blue, green, red) keep the picture readable; the spectral spread still shows
const FAN_NMS = [460, 550, 640];
const FAN_FIELDS = [0, 0.7];
const FAN_RAYS = 7;
// The glass seen from outside (FID-1): dark and deep, the coating's sheen at an angle, never a milky plug. The front
// element carries a touch more than the ones behind it so a stack of 7 to 22 elements does not add up to white; a PF
// layer looks like any other glass from outside. Blackened element edges are drawn as thin bands (see edgeBands).
let FRONT_GLASS: THREE.MeshPhysicalMaterial | null = null;
let INNER_GLASS: THREE.MeshPhysicalMaterial | null = null;
let EDGE: THREE.MeshStandardMaterial | null = null;
// what the rest of the camera fades to while one part is picked (UI-14): see-through, never hidden
const FADE_OPACITY = 0.25;
// the traced light while a part is picked: there, but behind the part (R1-04)
const RAYS_DETAIL_OPACITY = 0.35;
// the entrance-pupil bundle in front of the lens: light arriving, never a solid sleeve (R1-05, R1-FID-D)
const BEAM_OPACITY = 0.06;
const BEAM_FRONT_FADE_MM = 18;

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

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'camera-rig';
  const assembly = new THREE.Group();
  group.add(assembly);

  // studio lights for black paint on a black stage (FID-8): key, fill, a strong rim from behind-right-high and a cool
  // kicker from behind-left-low. They live in this group, so they go when the piece hides; the studio environment
  // (softbox panels for long highlights on the curved paint) is swapped in on activate and back out on deactivate.
  ctx.look.addStudioLights(group);
  const studio = ctx.look.buildStudioEnvironment(ctx.renderer);
  const ground = ctx.look.groundGlow(1);
  group.add(ground);
  FRONT_GLASS ??= ctx.look.opticalGlassMaterial(true);
  INNER_GLASS ??= ctx.look.opticalGlassMaterial(false);
  EDGE ??= ctx.look.elementEdgeMaterial();

  // the light: traced fans (engine frame, shifted so the sensor sits at z = 0) and the entrance-pupil bundle
  const raysGroup = new THREE.Group();
  const rays = buildRays(ctx.look);
  // the three wavelengths coincide in the air in front of the lens: drawn additively they sum to white light there
  // and split into their own exact colors only where the glass disperses them (no depth fighting between them)
  const rayMat = rays.mesh.material as THREE.Material;
  rayMat.transparent = true; rayMat.depthWrite = false; rayMat.blending = THREE.AdditiveBlending;
  raysGroup.add(rays.mesh);
  group.add(raysGroup);
  // The bundle's width is the entrance pupil. It is drawn as light arriving: neutral, faint, fading in from nothing
  // far out and back to nothing just before the front glass, so the coated front element shows through it and the
  // tube never gets a hard end or a solid look (R1-05, R1-FID-D). The fade is rebuilt for each reach, in mm.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xe8e6e1, transparent: true, opacity: BEAM_OPACITY, depthWrite: false, vertexColors: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 48, true);
  beamGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(beamGeo.attributes.position.count * 3), 3));
  let beamReach = -1;
  function shadeBeam(reach: number) {
    if (Math.abs(reach - beamReach) < 0.5) return;
    beamReach = reach;
    const pos = beamGeo.attributes.position, col = beamGeo.attributes.color as THREE.BufferAttribute;
    const fade = Math.min(0.45, BEAM_FRONT_FADE_MM / reach);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getY(i) + 0.5;                  // 0 far out, 1 at the front glass
      const k = THREE.MathUtils.smoothstep(u, 0, 0.55) * (1 - THREE.MathUtils.smoothstep(u, 1 - fade, 1));
      col.setXYZ(i, k, k, k);
    }
    col.needsUpdate = true;
  }
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.x = Math.PI / 2;
  beam.name = 'entrance-pupil-bundle';
  group.add(beam);

  // the live iris: the engine's opening outline cut from a blade annulus at the stop plane
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.6, roughness: 0.34, side: THREE.DoubleSide });
  // in the iris mode the blades are what the reader came to see: lit steel with a little of its own light, so they
  // read against the dark barrel behind them (R1-04)
  const irisLitMat = new THREE.MeshStandardMaterial({ color: 0x5a5f68, metalness: 0.5, roughness: 0.34, emissive: 0x2a2d33, side: THREE.DoubleSide });
  const iris = new THREE.Mesh(new THREE.BufferGeometry(), irisMat);
  iris.name = 'live-iris';
  group.add(iris);
  // each blade's edge, drawn over the lit annulus in the iris mode so the blades read as blades, not a flat disk
  const bladeEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x08090b, transparent: true, opacity: 0.9 }));
  bladeEdges.visible = false;
  iris.add(bladeEdges);

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


  const draco = new DRACOLoader().setDecoderPath(new URL('./draco/', location.href).href).setDecoderConfig({ type: 'js' });
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const cache = new Map<string, Promise<THREE.Group>>();
  let bodyRoot: THREE.Group | null = null;
  let lensRoot: THREE.Group | null = null;
  let rigKey = '';
  let loading: Promise<void> | null = null;
  let view: View = 'outside';
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

  // loading progress across the body and the lens, for the stage's veil (UI-21)
  const progress = new Map<string, number>();
  let everLoaded = false;
  function reportProgress() {
    if (everLoaded) return;
    const vals = [...progress.values()];
    const f = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, progress: Math.min(0.95, f * 0.9 + 0.05), label: 'Loading the camera' });
  }
  function load(path: string): Promise<THREE.Group> {
    let p = cache.get(path);
    if (!p) {
      progress.set(path, 0);
      p = loader.loadAsync(new URL(path, location.href).href, (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) { progress.set(path, e.loaded / e.total); reportProgress(); }
      }).then((g) => { progress.set(path, 1); return prepare(g.scene); }).catch((error) => {
        cache.delete(path);
        throw error;
      });
      cache.set(path, p);
    }
    return p;
  }

  function prepare(root: THREE.Group): THREE.Group {
    root.updateMatrixWorld(true);
    const inFront = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element01(Cut)?$/.test(n.name)) return true; return false; };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material)) {
        const n = mesh.material.name ?? '';
        if (/^(lensGlass|pfLayer)/.test(n)) {
          mesh.material = inFront(mesh) ? FRONT_GLASS! : INNER_GLASS!;
          // back to front along the axis, so the stack composites in order seen from the front
          const b = new THREE.Box3().setFromObject(mesh);
          mesh.renderOrder = 2 + Math.round(-b.min.z) / 1000;
        } else {
          // the sensor's silicon and the viewfinder's dark glass replace their export stand-ins (R1-04); every
          // finished surface gets its pebble or paint grain from the extras (R1-FID-B)
          mesh.material = ctx.look.studioReplacement(mesh.material) ?? mesh.material;
          ctx.look.tuneStudioMaterial(mesh.material);
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
    return root;
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
    'ibisPlate', 'ibisActuators', 'ibisYoke', 'lightBox', 'evfPanel', 'evfPanelCarrier', 'glass', 'cells', 'irisHousing']);
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
    beam.visible = raysOn && !!lensRoot && (!detail || detail === 'lens' || detail === 'glass');
    viewSwitch.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  }

  function setView(v: View) {
    view = v;
    applyView();
    if (lastModel) applyModel(lastModel);
    anchorProbes();
    fitDive(detail ? partFrame(detail) : frame());
  }

  let inflight: Promise<void> = Promise.resolve();
  let rigGeneration = 0;
  function ensureRig(lensId: string): Promise<void> {
    const body = bodyForLens(lensId);
    const key = `${body ?? 'dslr'}:${body ? lensId : 'none'}`;
    if (key === rigKey) return inflight;
    rigKey = key;
    const generation = ++rigGeneration;
    exposure.setEnabled(false);
    ctx.bus.emit('piece-loading', { id: 'camera', loading: true, label: 'Loading the camera' });
    inflight = loadRig(lensId, generation).catch((err) => {
      if (generation !== rigGeneration) return;
      rigKey = '';
      console.error('camera-rig: the models did not load', err);
      // nothing to fire or trade under a failed view (R1-10)
      exposure.setEnabled(false);
      ctx.bus.emit('piece-loading', { id: 'camera', loading: false, error: 'The camera model did not load. Check the connection and reload the page.' });
    });
    return inflight;
  }
  async function loadRig(lensId: string, generation: number) {
    const body = bodyForLens(lensId);
    const fact = body ? LENSES[lensId] : null;
    if (!everLoaded) reportProgress();
    const [b, l] = await Promise.all([load(`./models/${body ?? 'dslr'}.glb`), fact ? load(`./${fact.glb.replace(/^public\//, '')}`) : Promise.resolve(null)]);
    if (generation !== rigGeneration) return;      // a later choice won, including A → B → A
    unhighlight();
    exposure.reset();
    mirrorGeom = null;
    assembly.clear();
    bodyRoot = b; lensRoot = l;
    darkenSensorPackage(b);
    assembly.add(b);
    if (l) assembly.add(l);
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
    anchorProbes();
    if (lastModel) applyModel(lastModel);
    placeGround();
    // The stage renders/compiles on demand. A speculative compileAsync here races that shared
    // renderer's frame-buffer target when a new body or inspection changes tone mapping or size.
    everLoaded = true;
    ctx.bus.emit('piece-loading', { id: 'camera', loading: false });
    // A shared part link or lens/body change may select a part before the GLB arrives.
    // Reapply it to the new meshes and frame that part, not the whole camera.
    if (detail) openDetail(detail);
    else fitDive(frame());
    if (group.visible) teach.start();
  }

  /** The faint floor under the camera, just below its lowest point and sized to it. */
  function placeGround() {
    const box = new THREE.Box3();
    assembly.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.cutaway) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromObject(assembly);
    if (box.isEmpty()) { ground.visible = false; return; }
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    ground.visible = true;
    ground.position.set(c.x, box.min.y - 0.5, c.z);
    ground.scale.setScalar(Math.max(size.x, size.z) * 0.95);
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
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    model.iris.outline.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
    iris.geometry.dispose();
    iris.geometry = new THREE.ShapeGeometry(shape, 48);
    iris.position.z = stopZ;
    state.irisRadius = model.iris.radius;
    {
      const seg: number[] = [];
      for (const b of model.iris.blades) for (let i = 0; i < b.length; i++) { const a = b[i], c = b[(i + 1) % b.length]; seg.push(a[0], a[1], -0.05, c[0], c[1], -0.05); }
      bladeEdges.geometry.dispose();
      bladeEdges.geometry = new THREE.BufferGeometry();
      bladeEdges.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    }
    // the light
    raysGroup.position.z = -imageZ;
    // outside: the on-axis bundle the lens takes in; the cutaway adds the off-axis field
    const fans = marginalAwareFans(model, view === 'cutaway' ? FAN_FIELDS : [0], FAN_NMS, FAN_RAYS);
    const drawn = extendEntry(fans, model);
    rays.update(state.body === 'dslr' && !mirrorUp ? reflectAtMirror(drawn, imageZ) : drawn);
    axisPaths = drawn.filter((f) => f.field === 0).flatMap((f) => f.paths.filter((p) => p.pts.length > 3).map((p) => ({
      pts: p.pts.map((q) => new THREE.Vector3(q[0], q[1], q[2] - imageZ)),
      color: ctx.look.wavelengthToThreeColor(p.nm),
    })));
    state.rays = fans.reduce((n, f) => n + f.paths.length, 0);
    const ep = model.cardinal.ep;
    const frontZ = surf[0].z - imageZ;
    const reach = beamReachMm();
    shadeBeam(reach);
    beam.scale.set(ep.r, reach, ep.r);
    beam.position.set(0, 0, frontZ - reach / 2 - 1);
    state.epR = ep.r;
    updateExtras(model);
  }

  /** How far out in front of the lens the arriving light is drawn: about a third of the lens's length, at most 120 mm,
   *  so a long lens's front glass is not buried in a sleeve of light (R1-FID-D). */
  function beamReachMm() {
    return Math.min(120, Math.max(60, (LENSES[state.lens]?.lengthMm ?? 100) * 0.3));
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
  let mirrorGeom: { plane: THREE.Plane; box: THREE.Box3; screenY: number } | null = null;
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
    mirrorGeom = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point), box, screenY };
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
          if (!g.box.containsPoint(hit)) continue;
          // mirror the rest of the straight segment across the plane, then run it to the screen
          const tail = b.clone().sub(g.plane.normal.clone().multiplyScalar(2 * db));
          const dir = tail.clone().sub(hit).normalize();
          const t = dir.y > 1e-6 ? (g.screenY - hit.y) / dir.y : 0;
          const end = hit.clone().addScaledVector(dir, Math.max(0, t));
          state.reflected++;
          return { ...p, pts: [...p.pts.slice(0, i + 1), E(hit), E(end)] };
        }
        return p;
      }),
    }));
  }

  function extendEntry(fans: FanSet[], model: Model): FanSet[] {
    const len = LENSES[state.lens]?.lengthMm ?? 100;
    return extendEntryPaths(fans, model.system.surfaces[0].z, Math.max(120, len * 0.7), len);
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
    // in a detail mode the picked part's pin sits on the part as framed, so it is always inside the frame (R1-04)
    const at = detail ? detailAnchor(detail) : null;
    if (at && detail) set(detail, at);
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
    return fitBox(wholeRigBox(), outsideDir(), 1.1);
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
  let drag: { ctl: Ctl; x0: number; angle0: number; idx0: number; node: THREE.Object3D; q0: THREE.Quaternion; last: number; moved: boolean } | null = null;
  let lastEmit = 0;

  function pick(e: PointerEvent): { ctl: Ctl; node: THREE.Object3D } | null {
    if (!group.visible) return null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ctx.camera);
    const vis = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
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
      node: p.node, q0: p.node.quaternion.clone() };
    canvas.style.cursor = p.ctl === 'fire' ? 'pointer' : 'grabbing';
    tip.hidden = true;
  }
  function emitFocus(m: Model, angle: number) {
    const d = distanceForRingAngle(m, angle);
    ctx.bus.emit('scenario-set', { focusM: d === null ? null : d / 1000 });
  }
  function onMove(e: PointerEvent) {
    if (!drag) {
      const p = e.pointerType === 'mouse' ? pick(e) : null;
      canvas.style.cursor = p ? (p.ctl === 'fire' ? 'pointer' : 'grab') : '';
      tip.hidden = !p;
      if (p) {
        const r = canvas.getBoundingClientRect();
        tip.textContent = HINT[p.ctl];
        tip.style.left = `${e.clientX - r.left + 14}px`;
        tip.style.top = `${e.clientY - r.top + 10}px`;
      }
      return;
    }
    e.stopImmediatePropagation();
    const m = lastModel;
    if (!m) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 3) drag.moved = true;
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
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', onUp, { capture: true });
  function detach() {
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
    epRing.visible = detail === 'iris';
    iris.material = detail === 'iris' ? irisLitMat : irisMat;
    bladeEdges.visible = detail === 'iris';
    if (epRing.visible) {
      const r = model.cardinal.ep.r;
      epRing.position.set(0, 0, model.cardinal.ep.z - imageZ);
      epRing.scale.set(r, r, 1);
      // the label sits just above the ring's top, clear of the line
      if (group.visible) ctx.labels.set('rig-ep', { world: new THREE.Vector3(0, r * 1.06, model.cardinal.ep.z - imageZ), text: `Entrance pupil ⌀ ${(2 * r).toFixed(1)} mm`, kind: 'hud' });
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
    // the incoming bundle belongs to the whole-camera and lens views; from inside the body it is only a gray tube
    beam.visible = raysOn && !!lensRoot && (!detail || detail === 'lens' || detail === 'glass');
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
        // through the front element about 10 degrees off the axis, the opening filling about 40% of the free height
        const z = iris.position.z, front = barrel.isEmpty() ? z - 80 : barrel.min.z;
        const m = lastModel;
        const imageZ = m ? m.system.surfaces[m.system.surfaces.length - 1].z : 0;
        const epZ = m ? m.cardinal.ep.z - imageZ : z;
        const epR = m ? m.cardinal.ep.r : 10;
        const { fh } = freeFraction();
        const tanV = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) * fh;
        const dist = Math.max(epR / (0.4 * tanV), epZ - front + 25);
        const a = THREE.MathUtils.degToRad(10);
        const dir = new THREE.Vector3(-Math.sin(a), Math.sin(a) * 0.35, -Math.cos(a)).normalize();
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
      if ('emissive' in m && m.emissive) { m.emissive = new THREE.Color(0x1d1f23); m.emissiveIntensity = 1; }
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
    if (id === 'focusRing' && view !== 'outside') { view = 'outside'; applyView(); if (lastModel) applyModel(lastModel); }
    if (id && cutParts.includes(id) && view !== 'cutaway') { view = 'cutaway'; applyView(); if (lastModel) applyModel(lastModel); }
    // the blades are seen through the front element, so the iris opens from outside, with the whole lens in place
    if (id === 'iris' && view !== 'outside') { view = 'outside'; applyView(); if (lastModel) applyModel(lastModel); }
    // the sensor, the shutter and the focus cone are seen with the mirror swung up out of the way
    if (!exposure.running()) exposure.liftMirror(id === 'sensor' || id === 'shutter' || id === 'focusRing' || id === 'glass');
    crumb.hidden = !p;
    document.body.classList.toggle('rig-detail', !!p && group.visible);
    (crumb.querySelector('.rc-here') as HTMLElement).textContent = p?.label ?? '';
    linkTo = id === 'sensor' ? 'loupe' : id === 'focusRing' ? 'cone' : id === 'lens' || id === 'glass' ? 'lens' : null;
    linkBtn.hidden = !linkTo;
    linkBtn.textContent = linkTo === 'loupe' ? 'Deep dive: one pixel →' : linkTo === 'cone' ? 'Deep dive: focus & bokeh →' : 'Deep dive: the lens →';
    teach.stop();
    if (lastModel) updateExtras(lastModel);
    anchorProbes();
    fitDive(p ? partFrame(p.id) : frame());
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
    const marks: { node: string; text: string; side: string; el: HTMLElement }[] = [];
    let on = false;
    let lastLayoutKey = '', lastLayoutAt = -Infinity;
    return {
      start() {
        if (on || view !== 'outside' || detail || exposure.running() || !group.visible || !bodyRoot) return;
        on = true;
        lastLayoutKey = ''; lastLayoutAt = -Infinity;
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
        const layoutKey = [w, h, state.lens, lastModel?.scenario.focusM, lastModel?.scenario.fno,
          ...ctx.camera.position.toArray(), ...ctx.camera.quaternion.toArray(), ...ctx.camera.projectionMatrix.elements].join('|');
        // Orbiting controls track immediately; an idle camera only rechecks late-arriving HUD layout
        // four times a second instead of searching all phone label slots on every animation frame.
        if (layoutKey === lastLayoutKey && now - lastLayoutAt < 250) return;
        lastLayoutKey = layoutKey; lastLayoutAt = now;
        // The stage ticks overlays before rendering, so a just-completed camera dive has not yet
        // refreshed matrixWorldInverse. Do not cache a projection from its previous position.
        ctx.camera.updateMatrixWorld(true);
        // each label takes the first side that keeps it inside the view and off the labels placed before it
        type R = { l: number; t: number; r: number; b: number };
        const taken: R[] = [];
        const overlayOrigin = ctx.overlay.getBoundingClientRect();
        // Keep all numbered part pins available: the teaching labels yield when a pin needs the space.
        for (const el of ctx.overlay.parentElement!.querySelectorAll<HTMLElement>('.pin, .hud.tl, .hud.tr, .hud.br, .hud.bl')) {
          if (!el.offsetWidth || !el.offsetHeight || getComputedStyle(el).visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          taken.push({ l: rect.left - overlayOrigin.left - 3, t: rect.top - overlayOrigin.top - 3,
            r: rect.right - overlayOrigin.left + 3, b: rect.bottom - overlayOrigin.top + 3 });
        }
        const narrow = w <= 760;
        if (narrow) {
          // Keep phone text outside the projected rig, including while the camera settles into its frame.
          const box = wholeRigBox();
          const model: R = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
          for (const bx of [box.min.x, box.max.x]) for (const by of [box.min.y, box.max.y]) for (const bz of [box.min.z, box.max.z]) {
            const p = new THREE.Vector3(bx, by, bz).project(ctx.camera);
            const px = (p.x + 1) * w / 2, py = (1 - p.y) * h / 2;
            model.l = Math.min(model.l, px - 6); model.r = Math.max(model.r, px + 6);
            model.t = Math.min(model.t, py - 6); model.b = Math.max(model.b, py + 6);
          }
          taken.push(model);
          const origin = ctx.overlay.getBoundingClientRect();
          for (const el of ctx.overlay.parentElement!.querySelectorAll<HTMLElement>('.hud.tr, .hud.br, .hud.bl')) {
            if (!el.offsetWidth || !el.offsetHeight) continue;
            const r = el.getBoundingClientRect();
            taken.push({ l: r.left - origin.left - 4, t: r.top - origin.top - 4, r: r.right - origin.left + 4, b: r.bottom - origin.top + 4 });
          }
        }
        const centers: { x: number; y: number; n: string }[] = [];
        for (const m of marks) {
          const o = assembly.getObjectByName(m.node);
          if (!o) { m.el.style.display = 'none'; continue; }
          const b = new THREE.Box3().setFromObject(o);
          const at = b.getCenter(new THREE.Vector3());
          // the focus ring's mark sits on the ring's camera-facing side, the middle of its visible band, never on its
          // top edge where the projected circle spilled onto the grip behind (R2-FID-3)
          if (m.node === 'focusRing') {
            const r = Math.max(b.max.x - at.x, b.max.y - at.y) * 0.97;
            const toCam = new THREE.Vector2(ctx.camera.position.x - at.x, ctx.camera.position.y - at.y);
            if (toCam.lengthSq() < 1e-6) toCam.set(0, 1);
            toCam.normalize();
            at.x += toCam.x * r; at.y += toCam.y * r;
          }
          const p = at.project(ctx.camera);
          let x = ((p.x + 1) / 2) * w, y = ((1 - p.y) / 2) * h;
          // Two controls can land this close on the grip (the front dial and the shutter button). Hiding one ring
          // and stacking both labels on the other left a reader unable to tell which fires and which sets the
          // aperture (R3-03): nudge this one's ring a little further along the line away from the other instead, so
          // both stay visible and each keeps its own label.
          const near = centers.find((c) => c.n === 'commandDialFront' && Math.hypot(c.x - x, c.y - y) < 40);
          if (m.node === 'shutterButton' && near) {
            const dx = x - near.x, dy = y - near.y;
            const len = Math.hypot(dx, dy);
            const [ux, uy] = len > 1 ? [dx / len, dy / len] : [0, -1];
            x += ux * 30; y += uy * 30;
          }
          m.el.style.display = p.z < 1 ? '' : 'none';
          m.el.style.left = `${x}px`;
          m.el.style.top = `${y}px`;
          centers.push({ x, y, n: m.node });
          // A fixed phone offset still covers the body or barrel; place text in free space (R3-FID-3).
          const label = m.el.querySelector('span')!;
          const leader = m.el.querySelector<HTMLElement>('.rig-teach-leader')!;
          m.el.classList.toggle('placed', narrow);
          label.hidden = false;
          if (narrow) {
            // Measure the actual font, then choose the nearest free label slot. Rings stay on their controls.
            const lw = label.offsetWidth, lh = label.offsetHeight;
            const xs = [Math.max(8, Math.min(w - lw - 8, x - lw / 2))];
            for (let left = 8; left <= w - lw - 8; left += 12) xs.push(left);
            let best: R | undefined, score = Infinity;
            for (let top = 64; top <= h - lh - 8; top += 8) for (const left of xs) {
              const candidate = { l: left, t: top, r: left + lw, b: top + lh };
              if (taken.some(q => candidate.l < q.r + 4 && q.l < candidate.r + 4 && candidate.t < q.b + 4 && q.t < candidate.b + 4)) continue;
              const d = Math.hypot(left + lw / 2 - x, top + lh / 2 - y);
              if (d < score) { best = candidate; score = d; }
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
          const lw = m.text.length * 8.2 + 16, lh = 22;
          const rect: Record<string, R> = {
            down: { l: x - lw / 2, t: y + gap, r: x + lw / 2, b: y + gap + lh },
            up: { l: x - lw / 2, t: y - gap - lh, r: x + lw / 2, b: y - gap },
            left: { l: x - sideGap - lw, t: y - lh / 2, r: x - sideGap, b: y + lh / 2 },
            right: { l: x + sideGap, t: y - lh / 2, r: x + sideGap + lw, b: y + lh / 2 },
          };
          const hit = (a: R) => a.l < 4 || a.t < 4 || a.r > w - 4 || a.b > h - 4 || taken.some((q) => a.l < q.r && q.l < a.r && a.t < q.b && q.t < a.b);
          const order = [m.side, 'down', 'up', 'left', 'right'].filter((v, k, arr) => arr.indexOf(v) === k);
          const side = order.find((sd) => !hit(rect[sd]));
          label.hidden = !side;
          if (!side) continue;
          taken.push(rect[side]);
          for (const sd of ['down', 'up', 'left', 'right']) m.el.classList.toggle(sd, sd === side);
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
    }
  }

  let savedTone: THREE.ToneMapping | null = null;
  let savedExposure = 1;
  let savedEnv: THREE.Texture | null | undefined;
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
      exposure.tick(now, dt);
      // the chrome moved (the phone's sheet opened, the rail filled in) since the last fit: fly to the fit again,
      // unless the reader has taken the camera over since
      const ins = ctx.camera.userData.insets as Record<string, number> | undefined;
      const sig = ins ? `${ins.left}|${ins.top}|${ins.right}|${ins.bottom}|${ins.width}|${ins.height}` : '';
      if (sig !== insetSig) { insetSig = sig; if (lastFit && !userMoved) ctx.dive(lastFit()); }
      fitClip();
      teach.tick();
    },
    select(id: string | null) { openDetail(id); },
    activate() {
      savedTone = r.toneMapping;
      savedExposure = r.toneMappingExposure;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      savedEnv = ctx.scene.environment;
      ctx.scene.environment = studio.texture;
      viewSwitch.hidden = false;
      exposure.el.hidden = false;
      savedNear = ctx.camera.near; savedFar = ctx.camera.far;
      if (!everLoaded) reportProgress();
    },
    deactivate() {
      exposure.pause();
      ctx.labels.remove('rig-ep');
      ctx.badge.hide();
      if (savedTone !== null) { r.toneMapping = savedTone; r.toneMappingExposure = savedExposure; }
      if (savedEnv !== undefined) ctx.scene.environment = savedEnv;
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
      detail: () => detail,
      reflected: () => state.reflected,
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
      phoneMq?.removeEventListener('change', placePanel);
      viewSwitch.remove();
      teach.stop();
      studio.dispose();
      detach();
      window.removeEventListener('keydown', onKey);
      bundle.dispose();
      iris.geometry.dispose();
      beam.geometry.dispose();
      draco.dispose();
    },
  };
};
