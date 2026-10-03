// Set piece 2: the lens as glass you can see into (docs/BRIEF.md, design/LOOK.md "2. The lens as glass you can
// see into", docs/PROTOTYPE.md "Lens cutaway"). Everything drawn here is read straight from model.realized (the
// element stack), model.system (the current-focus surfaces), model.iris and lensFans()/BINS -- this module
// itself computes no optics, only geometry/camera framing from those already-computed numbers. See
// docs/pieces/lens.md for what each visual is computed from and this piece's known limits.
import * as THREE from 'three/webgpu';
import { lightPlayback } from './light-playback';
import type { BuildPiece, CameraFrame, Inset } from './types';
import type { Model } from '../engine/model-types';
import type { RayStatus } from '../engine/types';
import { marginalAwareFans } from './lens/marginal-rays';
import { BINS } from '../engine/data';
import { buildElements, type ElementsHandle } from './lens/elements';
import { buildBarrel, type BarrelHandle } from './lens/barrel';
import { buildIris } from './lens/iris';
import { buildRays } from './lens/rays';
import { buildSensor } from './lens/sensor';
import { buildProbes, type ProbeExtras } from './lens/probes';
import { buildInsetFrame, type InsetFrame } from './lens/inset';
import { CUTAWAY_DIR } from './lens/geometry';
import { hasGlb, loadGlbBarrel, type GlbBarrel } from './lens/glb-barrel';
import { traceableBins } from './lens/valid-bins';
import { frameAboveSheet, insetGuard, isPhone } from './phone-frame';

const FIELDS = [0, 0.7]; // on-axis, and the off-axis field the detail inset zooms into (LOOK.md: "an off-axis object point")
const RAYS_PER_FIELD = 9;

interface Extents { zMin: number; zMax: number; radius: number }

/** Fits the whole cutaway (housing, glass, sensor) into the stage camera from CUTAWAY_DIR. The stage's camera
 *  fov (40 deg) is VERTICAL; three.js derives the horizontal one from the aspect, which on a phone in portrait is
 *  much tighter, so both axes are fitted and the larger distance wins. */
function computeFrame(ext: Extents | null, aspect = 1): CameraFrame {
  if (!ext) return { position: new THREE.Vector3(0, 40, -220), target: new THREE.Vector3(0, 0, 0) };
  const centerZ = (ext.zMin + ext.zMax) / 2;
  const half = (ext.zMax - ext.zMin) / 2;
  const boundRadius = Math.sqrt(half ** 2 + ext.radius ** 2);
  const halfFovRad = THREE.MathUtils.degToRad(20);
  const halfFovHorizRad = Math.atan(Math.tan(halfFovRad) * aspect);
  const phone = aspect < 0.9;
  const dist = (boundRadius / Math.sin(Math.min(halfFovRad, halfFovHorizRad))) * (phone ? 0.96 : 0.8);
  const target = new THREE.Vector3(0, 0, centerZ);
  // Slide the frame so the lens sits away from the detail inset's corner (inset.ts): up and left of the
  // bottom-right inset on a desktop, below the top-right inset on a phone. Moving the camera and its target
  // together along the screen's own right/up axes is a pure pan: nothing about the view angle changes.
  const forward = CUTAWAY_DIR.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const halfH = dist * Math.tan(halfFovRad);
  const halfW = halfH * aspect;
  const [sx, sy] = phone ? [-0.02, 0.25] : [0.1, -0.04];
  target.addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
  const position = target.clone().addScaledVector(CUTAWAY_DIR, dist);
  return { position, target };
}

/** The z (engine frame) of the lens's focus group, from the design's own variable gaps: the whole lens for unit
 *  focus, the elements in front of the first moving gap for front-group focus, those behind it for rear focus,
 *  and those between the first two moving gaps for inner and floating focus. */
function focusGroupZ(model: Model): number {
  const surf = model.system.surfaces;
  const last = surf.length - 2;
  const design = model.realized.design;
  const gaps = (design.focus.gaps ?? []).map((g) => g.surface).filter((i) => i >= 0 && i <= last).sort((a, b) => a - b);
  let a = 0, b = last;
  if (design.focus.method !== 'unit' && gaps.length) {
    if (design.focus.method === 'front-group') b = gaps[0];
    else if (design.focus.method === 'rear') a = Math.min(last, gaps[0] + 1);
    else { a = Math.min(last, gaps[0] + 1); b = gaps.length > 1 ? gaps[1] : last; }
  }
  if (b < a) [a, b] = [b, a];
  return (surf[a].z + surf[b].z) / 2;
}

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'piece-lens';
  const flight = lightPlayback(ctx, group, 'Through the glass');

  let lensId: string | null = null;
  let elementsHandle: ElementsHandle | null = null;
  let barrelHandle: BarrelHandle | null = null;
  let housing: GlbBarrel | null = null;
  let housingFor: string | null = null;
  const irisHandle = buildIris(ctx.look);
  const raysHandle = buildRays(ctx.look);
  const sensorHandle = buildSensor(ctx.look);
  group.add(irisHandle.group, raysHandle.mesh, sensorHandle.group);

  // The fan lies in the cut plane (x = 0), exactly where the section faces of the glass and the housing are, so
  // it is drawn after them and over them, like the ray trace printed on a maker's cutaway drawing. Opaque,
  // untouched color: transparent only so it sorts after the glass, opacity 1 so every pixel is the exact
  // wavelengthToRGB value the accuracy gate samples.
  const rayMat = raysHandle.mesh.material as THREE.Material;
  rayMat.transparent = true;
  rayMat.depthTest = false;
  rayMat.depthWrite = false;
  raysHandle.mesh.renderOrder = 10;

  // Studio lights for the housing's paint and the glass edges; they live in this group, so they leave with it.
  const key = new THREE.DirectionalLight(0xf4f2ee, 2.2);
  key.position.set(-160, 200, -140);
  const rim = new THREE.DirectionalLight(0xd9c9a8, 1.3);
  rim.position.set(80, 90, 260);
  const fillLight = new THREE.DirectionalLight(0xe4e6ea, 0.5);
  fillLight.position.set(-200, -60, 40);
  group.add(key, rim, fillLight);

  // The detail inset: a spot diagram at the image plane. Its own small scene holds the landing points of the
  // off-axis fan as wavelength-colored dots and the sensor's pixel grid at its true pitch behind them, so the
  // reader sees how far apart the colors land in pixels. No lights: every color here is a physics color.
  const insetScene = new THREE.Scene();
  const DOT_MAX = 16 * RAYS_PER_FIELD;
  const dotGeo = new THREE.CircleGeometry(1, 20);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, DOT_MAX);
  dots.frustumCulled = false;
  dots.count = 0;
  const gridMat = new THREE.LineBasicMaterial({ color: 0x2e3034, toneMapped: false });
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), gridMat);
  grid.frustumCulled = false;
  insetScene.add(grid, dots);

  const anchors = {
    frontElement: new THREE.Vector3(),
    iris: new THREE.Vector3(),
    focusGroup: new THREE.Vector3(),
    sensor: new THREE.Vector3(),
    rayFan: new THREE.Vector3(),
    inset: new THREE.Vector3(),
  };
  const extras: ProbeExtras = { irisDrawnRadius: 1, insetMagnification: 1, insetSpreadMm: 0, fields: FIELDS, bins: [...BINS.centers] };
  const probes = buildProbes(anchors, () => extras);

  let lastModel: Model | null = null;
  let insetFrame: InsetFrame | null = null;

  // The inset's scale bar (R1-12): a round length on the image plane, drawn to the inset's own scale in its
  // bottom-left corner. HTML over the view, so the label is real text at the type scale.
  const scaleBar = document.createElement('div');
  scaleBar.className = 'lv-scalebar';
  scaleBar.hidden = true;
  scaleBar.innerHTML = '<i></i><span></span>';
  ctx.overlay.appendChild(scaleBar);
  const scaleBarLine = scaleBar.querySelector('i') as HTMLElement;
  const scaleBarText = scaleBar.querySelector('span') as HTMLElement;
  // the inset's footprint for the pin pass, and its "1 square = 1 pixel" note when the grid is drawn
  const guard = insetGuard(ctx.overlay);
  let cancelSelect = () => {};
  let selectedId: string | null = null;
  let extents: Extents | null = null;

  function viewSize(): { w: number; h: number } {
    const el = ctx.renderer.domElement;
    return { w: el.clientWidth || 1200, h: el.clientHeight || 700 };
  }

  function rebuildLensGeometry(model: Model) {
    if (elementsHandle) { group.remove(elementsHandle.group); elementsHandle.dispose(); }
    if (barrelHandle) { group.remove(barrelHandle.group); barrelHandle.dispose(); barrelHandle = null; }
    elementsHandle = buildElements(model, ctx.look, ctx.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } });
    group.add(elementsHandle.group);

    const surfaces = model.system.surfaces;
    const frontZ = surfaces[0].z;
    const sensorZ = surfaces[surfaces.length - 1].z;
    const totalLength = sensorZ - frontZ;
    // The schematic tube stands in only while a lineup lens's real housing loads, or for a lens without one.
    const marginFront = Math.max(15, totalLength * 0.08);
    const marginBack = Math.max(8, totalLength * 0.03);
    barrelHandle = buildBarrel(elementsHandle.maxOd(), frontZ - marginFront, sensorZ + marginBack, ctx.look);
    barrelHandle.group.visible = !hasGlb(model.lens.id);
    group.add(barrelHandle.group);
  }

  function swapHousing(id: string) {
    if (housingFor === id) return;
    housingFor = id;
    if (housing) { group.remove(housing.root); housing.dispose(); housing = null; }
    if (!hasGlb(id)) { if (barrelHandle) barrelHandle.group.visible = true; return; }
    loadGlbBarrel(id, ctx.look).then((h) => {
      if (!h) return;
      if (housingFor !== id) { h.dispose(); return; }
      housing = h;
      group.add(h.root);
      if (barrelHandle) barrelHandle.group.visible = false;
      if (lastModel) {
        placeHousing(lastModel);
        updateExtents(lastModel);
        updateAnchors(lastModel);
        if (group.visible) ctx.dive(computeFrame(extents, ctx.camera.aspect));
      }
    }).catch((err) => {
      // the schematic tube stays up; say why in the console rather than leave a silent gap
      console.error('lens.ts: the housing failed to load, keeping the schematic barrel', err);
      if (barrelHandle) barrelHandle.group.visible = true;
    });
  }

  function placeHousing(model: Model) {
    if (!housing) return;
    const surfaces = model.system.surfaces;
    housing.root.position.z = surfaces[surfaces.length - 1].z;
  }

  function updateExtents(model: Model) {
    const surfaces = model.system.surfaces;
    const frontZ = surfaces[0].z;
    const sensorZ = surfaces[surfaces.length - 1].z;
    const maxOd = elementsHandle ? elementsHandle.maxOd() : 25;
    let zMin = frontZ - Math.max(15, (sensorZ - frontZ) * 0.08);
    let radius = Math.max(maxOd * 1.3, model.sensor.format.diag / 2);
    if (housing) {
      zMin = Math.min(frontZ, sensorZ + housing.zFront);
      radius = Math.max(radius, housing.outerR);
    }
    extents = { zMin, zMax: sensorZ + 2, radius };
  }

  function syncInset(model: Model) {
    const { w, h } = viewSize();
    const sensorZ = model.system.surfaces[model.system.surfaces.length - 1].z;
    insetFrame = buildInsetFrame(raysHandle.samples, sensorZ, ctx.camera, w, h, model.sensor.pitchUm);
    extras.insetMagnification = insetFrame.magnification;
    extras.insetSpreadMm = insetFrame.spreadMm;
    extras.fields = FIELDS;
    // dots: every off-axis ray that reached the image plane, where it landed
    const halfH = (insetFrame.camera.top - insetFrame.camera.bottom) / 2;
    const r = (2 * halfH / insetFrame.rect.height) * 5; // a 5 px marker, whatever the magnification
    const m = new THREE.Matrix4();
    let n = 0;
    for (const s of raysHandle.samples) {
      if (s.status !== 'ok' || s.field !== insetFrame.field || n >= DOT_MAX) continue;
      const p = s.world[s.world.length - 1];
      m.makeScale(r, r, 1).setPosition(p[0], p[1], p[2] - 0.001);
      dots.setMatrixAt(n, m);
      dots.setColorAt(n, ctx.look.wavelengthToThreeColor(s.nm));
      n++;
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    // the pixel grid at the sensor's true pitch, centered on the landing spot
    const pitch = model.sensor.pitchUm / 1000;
    const cx = insetFrame.center.x, cy = insetFrame.center.y;
    const halfW = halfH * (insetFrame.rect.width / insetFrame.rect.height);
    const pts: number[] = [];
    const nx = Math.min(120, Math.ceil(halfW / pitch) + 1), ny = Math.min(120, Math.ceil(halfH / pitch) + 1);
    const x0 = Math.round(cx / pitch) * pitch, y0 = Math.round(cy / pitch) * pitch;
    for (let i = -nx; i <= nx; i++) { const x = x0 + (i + 0.5) * pitch; pts.push(x, cy - halfH * 1.2, sensorZ, x, cy + halfH * 1.2, sensorZ); }
    for (let j = -ny; j <= ny; j++) { const y = y0 + (j + 0.5) * pitch; pts.push(cx - halfW * 1.2, y, sensorZ, cx + halfW * 1.2, y, sensorZ); }
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry();
    grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    // a grid finer than about 4 screen px per cell is a gray wash, not pixels: leave it out then
    grid.visible = (pitch / (2 * halfH)) * insetFrame.rect.height >= 4;
    insetFrame.gridShown = grid.visible;
  }

  // Pins sit on the part they name and alternate above and below the axis, so their labels never stack.
  function updateAnchors(model: Model) {
    const surfaces = model.system.surfaces;
    const frontZ = surfaces[0].z;
    const sensorZ = surfaces[surfaces.length - 1].z;
    const maxOd = elementsHandle ? elementsHandle.maxOd() : 20;
    const stopIndex = surfaces.findIndex((s) => s.kind === 'stop');
    const stopZ = surfaces[stopIndex >= 0 ? stopIndex : 0].z;
    // Above the axis: front element, focus group, and the landing spot the inset magnifies (the off-axis field
    // lands high on the sensor). Below: iris, ray fan, sensor.
    anchors.frontElement.set(0, surfaces[0].sd * 0.9, frontZ + 0.5);
    anchors.focusGroup.set(0, maxOd * 0.72, focusGroupZ(model));
    anchors.iris.set(0, -Math.max(model.iris.radius + 1.5, maxOd * 0.42), stopZ);
    anchors.rayFan.set(0, -maxOd * 0.28, stopZ + (sensorZ - stopZ) * 0.45);
    anchors.sensor.set(0, -model.sensor.format.h / 2, sensorZ);
    if (insetFrame) anchors.inset.copy(insetFrame.center);
  }

  return {
    group,

    update(model) {
      const lensChanged = model.lens.id !== lensId;
      if (lensChanged) {
        lensId = model.lens.id;
        rebuildLensGeometry(model);
        swapHousing(model.lens.id);
      } else {
        elementsHandle!.reposition(model);
      }
      lastModel = model;
      placeHousing(model);
      updateExtents(model);
      if (lensChanged && group.visible) ctx.dive(computeFrame(extents, ctx.camera.aspect));

      const surfaces = model.system.surfaces;
      const stopIndex = surfaces.findIndex((s) => s.kind === 'stop');
      const stopZ = surfaces[stopIndex >= 0 ? stopIndex : 0].z;
      irisHandle.setTarget(model.iris.radius, model.lens.blades, model.lens.rounded, model.iris.rotation, stopZ);

      extras.bins = traceableBins(model, BINS.centers);
      const fans = marginalAwareFans(model, FIELDS, extras.bins, RAYS_PER_FIELD);
      raysHandle.update(fans);
      flight.update(raysHandle.samples.filter(s => s.status === 'ok' || s.world.length > 2));

      sensorHandle.update(model);
      syncInset(model);
      updateAnchors(model);
      // the f-number lives in the HUD and the iris card; the scene carries no second copy of it
      ctx.labels.remove('lens-fno');
    },

    frame() {
      return computeFrame(extents, ctx.camera.aspect);
    },

    probes,

    tick(dt) {
      flight.tick(dt);
      const changed = irisHandle.tick();
      extras.irisDrawnRadius = irisHandle.drawnRadius();
      return changed;
    },

    insets() {
      // On a phone with a part picked, the view above the sheet is too short to hold the inset as well; it
      // stays away until the pick is cleared, unless the pick is the inset itself.
      const hideForPick = selectedId !== null && selectedId !== 'detail-inset' && isPhone();
      // The magnification lives in the inset's own caption (R2-07), so the corner badge stays empty on this level.
      ctx.badge.hide();
      if (!insetFrame || !lastModel || hideForPick) { scaleBar.hidden = true; guard.update(null); return []; }
      const { w, h } = viewSize();
      if (insetFrame.viewW !== w || insetFrame.viewH !== h) syncInset(lastModel);
      const inset: Inset = {
        id: 'lens-detail-inset',
        camera: insetFrame.camera,
        scene: insetScene,
        rect: insetFrame.rect,
        label: '',
      };
      extras.insetMagnification = insetFrame.refreshMag();
      inset.label = insetFrame.caption();
      guard.update(insetFrame.rect, insetFrame.gridShown ? '1 square = 1 pixel' : '');
      const bar = insetFrame.scaleBar();
      scaleBar.hidden = false;
      scaleBar.style.left = `${insetFrame.rect.left + 10}px`;
      scaleBar.style.bottom = `${insetFrame.rect.bottom + 8}px`;
      scaleBarLine.style.width = `${bar.px.toFixed(1)}px`;
      if (scaleBarText.textContent !== bar.label) scaleBarText.textContent = bar.label;
      return [inset];
    },

    activate() {
      flight.activate();
      if (extents) ctx.dive(computeFrame(extents, ctx.camera.aspect));
    },

    deactivate() {
      flight.deactivate();
      cancelSelect();
      selectedId = null;
      scaleBar.hidden = true;
      guard.update(null);
      ctx.badge.hide();
    },

    select(id) {
      // On a phone, slide the picked part into the strip of view above the part sheet (R1-13); clearing the
      // pick flies back to the whole cutaway.
      cancelSelect();
      selectedId = id;
      if (!isPhone()) return;
      if (!id) { ctx.dive(computeFrame(extents, ctx.camera.aspect)); return; }
      const probe = probes.find((p) => p.id === id);
      if (probe) cancelSelect = frameAboveSheet(ctx, () => group.localToWorld(probe.anchor.clone()), 0.8);
    },

    hooks: {
      light: flight.state,
      /** Where the shared camera is now and where this piece wants it (framing checks in the screenshot tools). */
      camera() {
        const f = computeFrame(extents, ctx.camera.aspect);
        return { at: ctx.camera.position.toArray(), aspect: ctx.camera.aspect, want: f.position.toArray(), target: f.target.toArray(), extents };
      },
      /** The visual accuracy gate (tools/accuracy/lens.mjs): drawn ray vertices vs. a fresh marginalAwareFans()
       *  call (the same wide-trace + current-iris reclip update() itself uses, so this checks self-consistency
       *  against a re-run of the real engine calls, not against a different, un-clipped code path), the iris's
       *  drawn vs. model radius, and ray status counts for the f/8 marginal-ray-count check. Every world point is
       *  also projected through the live camera so the gate can check screen-pixel agreement without reaching
       *  into Three.js internals itself. */
      probe() {
        const model = lastModel;
        if (!model) return null;
        ctx.camera.updateMatrixWorld(true);
        const w = ctx.renderer.domElement.clientWidth || 1;
        const h = ctx.renderer.domElement.clientHeight || 1;
        const project = (p: [number, number, number]): [number, number] => {
          const v = new THREE.Vector3(p[0], p[1], p[2]).project(ctx.camera);
          return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
        };
        const fresh = marginalAwareFans(model, FIELDS, traceableBins(model, BINS.centers), RAYS_PER_FIELD);
        const rays: { nm: number; field: number; status: RayStatus; world: number[][]; engine: number[][]; screenFromWorld: number[][]; screenFromEngine: number[][] }[] = [];
        let i = 0;
        for (const set of fresh) {
          for (const path of set.paths) {
            const drawn = raysHandle.samples[i++];
            const engine = path.pts.map((p) => [p[0], p[1], p[2]]);
            rays.push({
              nm: path.nm,
              field: set.field,
              status: path.status,
              world: drawn ? drawn.world.map((p) => [p[0], p[1], p[2]]) : [],
              engine,
              screenFromWorld: (drawn ? drawn.world : []).map(project),
              screenFromEngine: engine.map((p) => project(p as [number, number, number])),
            });
          }
        }
        return {
          rays,
          iris: { drawnRadius: irisHandle.drawnRadius(), modelRadius: model.iris.radius },
        };
      },
      /** The exact-color check (accuracy gate #2): the sRGB the SAME function the rays are colored from would
       *  produce for `nm`, 0-255 per channel, for the Node-side script to compare a sampled pixel against. */
      wavelengthSrgb255(nm: number) {
        // Three stores material RGB in linear working space; screenshots contain encoded sRGB.
        const c = ctx.look.wavelengthToThreeColor(nm).convertLinearToSRGB();
        return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
      },
    },

    dispose() {
      flight.dispose();
      elementsHandle?.dispose();
      barrelHandle?.dispose();
      housing?.dispose();
      guard.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      grid.geometry.dispose();
      gridMat.dispose();
      irisHandle.dispose();
      raysHandle.dispose();
      sensorHandle.dispose();
      ctx.labels.remove('lens-fno');
      cancelSelect();
      scaleBar.remove();
    },
  };
};
