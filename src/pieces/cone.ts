import { selectionFrame } from './selection-frame';
// Set piece 3, focus as a cone of light and the bokeh disk -- docs/BRIEF.md ("3. Focus as a cone of light"),
// design/LOOK.md ("3. Focus as a cone of light" composition notes), docs/PROTOTYPE.md ("3. Cone of focus and
// bokeh"). Everything drawn here comes from pointBundle(model, ...) (src/app/engine-api.ts, the only door to the
// physics) and the Model it already carries -- this piece computes no optics of its own, only scene geometry from
// numbers the engine returned (see src/pieces/cone/coords.ts's module doc for the scene-space convention).
import * as THREE from 'three/webgpu';
import { lightPlayback } from './light-playback';
import { diffractionView } from './diffraction-view';
import type { BuildPiece, Inset, PartCard } from './types';
import type { Bundle, Model } from '../engine/model-types';
import { pointBundle } from '../app/engine-api';
import { traceableBins } from './lens/valid-bins';
import { convexHullIndices, halfExtent, ringPoints, sagAt } from './cone/coords';
import {
  buildConeSurfaceGeometry, buildDiscGeometry, buildDiskPlaneGeometry, buildLastElementGeometry,
  buildPixelGridPositions, buildRectGeometry, sparseRaySegments,
} from './cone/geometry';
import { buildDiskTexture, type DiskTexture } from './cone/disk-texture';
import { buildOverlay, fmtDist, type ConeControls } from './cone/overlay';
import { insetGuard, isPhone } from './phone-frame';

// The engine's own 16-bin visible-spectrum centers (see src/engine/spectrum.ts's bins(16, 380, 780) -- reproduced
// here, not imported, because engine-api.ts is this piece's only door to the engine and does not re-export the
// data module's BINS constant; needs_from_lead: export BINS from engine-api.ts so a piece doesn't have to keep
// this formula in sync by hand). bins(16, 380, 780): width 25 nm, center = 380 + 25*i + 12.5.
const NM_BINS = Array.from({ length: 16 }, (_, i) => 392.5 + 25 * i);

// Per-wavelength ray count: pointBundle's own cost is dominated by aimRay's real-aim Newton search (per ray, a
// handful of full-system traces) and is O(rays * nms) with no shortcut available from a piece (camera.ts is not
// on this piece's path to edit -- see docs/pieces/cone.md, "Known limits" / needs_from_lead). 130 rays * 16 nms
// (~2080 traced rays, ~1650-1900 landing) measured at 110-150ms on this dev machine (RTX 5090, see
// docs/rendering-spike.md's machine note) for p50 at f/1.4 -- responsive enough to debounce behind a slider drag
// (see REBUILD_DEBOUNCE_MS below) without a multi-second stall, while still giving a dense cone/disk.
const RAYS_PER_NM = 130;
const SPARSE_RAY_COUNT = 44;
const REBUILD_DEBOUNCE_MS = 70; // mirrors ui.ts's own final-image render debounce pattern (see ui.ts's comment)

const DEFAULT_POINT_M = 1.5;
const MAX_GRID_LINES_PER_AXIS = 160;

const COLOR_PREDICTED = 0x8fc3f0; // design/LOOK.md's --derived evidence color: an annotation, not a wavelength
const COLOR_COC = 0xb7b0cf; // --assumed: the CoC ring is drawn to an assumed convention (d/1500)

function fmtMm(mm: number): string {
  return mm < 1 ? `${Math.round(mm * 1000).toLocaleString('en-US')} µm` : `${mm.toLocaleString('en-US', { maximumFractionDigits: 2 })} mm`;
}
const fmtDistM = fmtDist;

/** The sensor inset's square: bottom-right above the backend chip on a desktop, top-right under the layer switch
 *  on a phone (the same corners as the lens cutaway's inset), so it never sits on the 3D sensor plate or its pins.
 *  frame() slides the cone away from that corner. */
function insetRectFor(viewW: number, viewH: number): { left: number; bottom: number; width: number; height: number } {
  const winW = typeof window !== 'undefined' ? window.innerWidth : viewW;
  const phone = winW <= 760;
  const w = phone ? Math.min(164, Math.round(viewW * 0.42)) : Math.min(236, Math.max(160, Math.round(viewW * 0.21)));
  const right = phone ? 12 : 22;
  const bottom = phone ? Math.max(8, viewH - 58 - w) : 58;
  return { left: Math.max(8, viewW - right - w), bottom, width: w, height: w };
}

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'piece-cone';
  const flight = lightPlayback(ctx, group, 'Toward the sensor', 1);
  const diffraction = diffractionView(ctx, 'cone');

  // ---- persistent objects (geometry/material/texture swapped in place on rebuild(), never the containers -----
  // glassMaterial()'s own transmission:1 (LOOK.md: real optical glass) reads as nearly invisible against this
  // piece's plain black void with no bright background to refract -- physically correct for a real element, but
  // wrong for a SCHEMATIC landmark that has to read as "there" at a glance. Dialed down here (not in look.ts,
  // which is off this piece's paths) so it still reads as glass -- clearcoat highlight, ior, edge -- rather than
  // an almost-clear void; `transparent`/`opacity` on a transmissive material barely matter next to this.
  // The exit pupil: a faint disc with a crisp rim, the Ciechanowski way (LOOK.md #3: "clean edges, a shaded
  // translucent surface, no texture"), so it reads as the opening the light leaves through at a glance.
  const pupilDiscMat = new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const pupilDisc = new THREE.Mesh(new THREE.BufferGeometry(), pupilDiscMat);
  pupilDisc.name = 'exit-pupil-disc';
  const pupilRimMat = new THREE.LineBasicMaterial({ color: 0xf0f0fa, transparent: true, opacity: 0.7 });
  const pupilRim = new THREE.LineSegments(new THREE.BufferGeometry(), pupilRimMat);
  pupilRim.name = 'exit-pupil-rim';

  // The last element as faint glass (LOOK.md #3: "at most a schematic exit-pupil disc, not the whole barrel"):
  // its real lathed profile, a pale glass tint at low opacity with a clearcoat highlight, and its section inked,
  // the same section-glass look as the lens cutaway, so it reads as glass and not as a gray plastic disc.
  const lastElementMat = new THREE.MeshPhysicalMaterial({
    color: 0xc4dce6, metalness: 0, roughness: 0.18, transmission: 0, transparent: true, opacity: 0.07,
    clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, depthWrite: false,
  });
  const lastElement = new THREE.Mesh(new THREE.BufferGeometry(), lastElementMat);
  lastElement.name = 'last-element';
  const lastOutlineMat = new THREE.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.45 });
  const lastOutline = new THREE.LineSegments(new THREE.BufferGeometry(), lastOutlineMat);
  lastOutline.name = 'last-element-outline';

  const sensorPlate = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({
    color: 0x1b2029, roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  }));
  sensorPlate.name = 'sensor-plate';

  // The fill above (near-black silicon) reads as barely-there against the void; an --ink outline makes the
  // frame's real extent legible even so, which matters here since the field-position slider's whole point is
  // showing the point land nearer the frame edge.
  const sensorOutlineMat = new THREE.LineBasicMaterial({ color: 0xf0f0fa, transparent: true, opacity: 0.35 });
  sensorOutlineMat.toneMapped = false;
  const sensorOutline = new THREE.LineSegments(new THREE.BufferGeometry(), sensorOutlineMat);
  sensorOutline.name = 'sensor-outline';

  const coneSurfaceMat = ctx.look.wellGlassMaterial();
  // wellGlassMaterial()'s own transmission: 0.95 makes a MeshPhysicalMaterial render as real physically-based
  // transmissive glass -- the renderer samples what's BEHIND the surface (here, the plain black void) rather
  // than doing a standard alpha blend, so `opacity`/`transparent` below barely register: found by comparing this
  // surface's screen pixels against its background at several camera angles -- with transmission left at 0.95
  // the interior faces stayed indistinguishable from the void everywhere except right at the silhouette edge
  // (root cause of art director finding cone-surface-invisible, distinct from the exit-pupil/last-element flat-
  // read finding, which is about specular quality, not this near-total invisibility). Zeroed here so `opacity`'s
  // ordinary alpha blend governs the fill instead -- this is a shaded schematic panel (LOOK.md's Ciechanowski
  // reference), not a piece of real glass.
  coneSurfaceMat.transmission = 0;
  coneSurfaceMat.transparent = true;
  coneSurfaceMat.opacity = 0.32;
  coneSurfaceMat.side = THREE.DoubleSide;
  coneSurfaceMat.depthWrite = false;
  // A fresnel-like rim: sheen brightens strongly at grazing angles even where the face itself is nearly
  // transparent, so the cone's silhouette edge stays visible where a flat, view-angle-independent opacity alone
  // would not (LOOK.md's Ciechanowski reference names "clean edges" as the thing that makes the convergence
  // unambiguous -- art director finding cone-surface-invisible).
  coneSurfaceMat.sheen = 1;
  coneSurfaceMat.sheenColor = new THREE.Color(0xffffff);
  coneSurfaceMat.sheenRoughness = 0.4;
  const coneSurface = new THREE.Mesh(new THREE.BufferGeometry(), coneSurfaceMat);
  coneSurface.name = 'cone-surface';

  const sparseRaysGeom = new THREE.BufferGeometry();
  const sparseRaysMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  sparseRaysMat.toneMapped = false;
  const sparseRays = new THREE.LineSegments(sparseRaysGeom, sparseRaysMat);
  sparseRays.name = 'sparse-rays';

  let diskTex: DiskTexture | null = null;
  let maskTexture: THREE.CanvasTexture | null = null;
  const diskPlaneMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  diskPlaneMat.toneMapped = false;
  const diskPlane = new THREE.Mesh(new THREE.BufferGeometry(), diskPlaneMat);
  diskPlane.name = 'bokeh-disk';
  diskPlane.frustumCulled = false; // its geometry is rebuilt via BufferGeometry.translate() each rebuild()

  const predictedRingGeom = new THREE.BufferGeometry();
  const predictedRingMat = ctx.look.physicsLineMaterial(COLOR_PREDICTED, 1.5);
  const predictedRing = new THREE.LineSegments(predictedRingGeom, predictedRingMat);
  predictedRing.name = 'predicted-blur-ring';

  const cocRingGeom = new THREE.BufferGeometry();
  const cocRingMat = ctx.look.physicsLineMaterial(COLOR_COC, 1.5);
  const cocRing = new THREE.LineSegments(cocRingGeom, cocRingMat);
  cocRing.name = 'coc-ring';

  const pixelGridGeom = new THREE.BufferGeometry();
  const pixelGridMat = new THREE.LineBasicMaterial({ color: 0x3a4048, transparent: true, opacity: 0.6 });
  pixelGridMat.toneMapped = false;
  const pixelGrid = new THREE.LineSegments(pixelGridGeom, pixelGridMat);
  pixelGrid.name = 'pixel-grid';

  group.add(pupilDisc, pupilRim, lastElement, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays, diskPlane, predictedRing, cocRing, pixelGrid);

  // The context objects (barrel-side glass, the cone's own ray lines) cross through the sensor inset's cropped
  // frustum too -- a ray converging toward the disk enters the inset's tiny field of view as a long diagonal
  // line, which would swamp the accuracy gate's pixel threshold of "the disk" (tools/accuracy/cone.mjs). Three's
  // own layer mask keeps them out of the inset camera (which stays on the default layer 0) while the main
  // camera still sees everything -- see activate()/deactivate() below for enabling layer 1 only while this
  // piece owns the shared main camera.
  const CONTEXT_LAYER = 1;
  for (const obj of [pupilDisc, pupilRim, lastElement, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays]) obj.layers.set(CONTEXT_LAYER);

  // ---- overlay controls -----------------------------------------------------------------------------------
  const controls: ConeControls = buildOverlay(DEFAULT_POINT_M * 1000);
  ctx.overlay.appendChild(controls.el);
  controls.set(DEFAULT_POINT_M * 1000, 0);

  // ---- state kept for frame()/hooks/probes between rebuild() calls ------------------------------------------
  let lastModel: Model | null = null;
  let lastBundle: Bundle | null = null;
  let originZ = 0;
  let sensorX = 0;
  let elementFrontX = 0; // the last element's own front surface, scene-local X (may be negative, behind the pupil)
  let diskCenter = { y: 0, z: 0 }; // scene-space (local Y/Z) of the disk centroid
  let insetHalfExtentMm = 1;
  let lastInsetRect = { left: 0, bottom: 0, width: 236, height: 236 };
  let lastElementR = 0;

  // Persistent anchor Vector3 instances, MUTATED (never replaced) in rebuild() -- PieceHandle.probes is a plain
  // array returned once from build() (pieces/types.ts), so a probe's `anchor` must be the same object updated in
  // place each rebuild, not a fresh `new THREE.Vector3()` recomputed from then-current closure state (which would
  // freeze every anchor at its build()-time value: sensorX/diskCenter/insetHalfExtentMm are all still their
  // zeroed defaults the moment this array literal below is evaluated).
  const anchorExitPupil = new THREE.Vector3(0, 0, 0);
  const anchorCone = new THREE.Vector3(0.001, 0, 0);
  const anchorDisk = new THREE.Vector3(0, 0, 0);
  const anchorPixelGrid = new THREE.Vector3(0, 0, 0);
  const anchorCoc = new THREE.Vector3(0, 0, 0);
  const insetCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);

  function disposeGeom(mesh: THREE.Mesh | THREE.LineSegments) {
    mesh.geometry.dispose();
  }

  function rebuild(model: Model) {
    lastModel = model;
    controls.setMinMm(model.lens.closestFocusMm);
    const pointDistMm = Math.min(200_000, Math.max(model.lens.closestFocusMm, controls.pointDistMm()));
    const fieldFrac = controls.fieldFrac();

    const bundle = pointBundle(model, { pointDistMm, fieldFrac, rays: RAYS_PER_NM, nms: traceableBins(model, NM_BINS) });
    lastBundle = bundle;

    originZ = model.cardinal.xp.z;
    const surfaces = model.system.surfaces;
    const sensorZ = surfaces[surfaces.length - 1].z;
    sensorX = sensorZ - originZ;

    // ---- exit pupil disc (schematic, real z/radius from model.cardinal.xp) ----------------------------------
    disposeGeom(pupilDisc);
    pupilDisc.geometry = buildDiscGeometry(0, 0, 0, Math.max(0.05, model.cardinal.xp.r));
    pupilRim.geometry.dispose();
    pupilRim.geometry = new THREE.BufferGeometry().setFromPoints(ringPoints(0, 0, 0, Math.max(0.05, model.cardinal.xp.r), 96, false));

    // ---- last element as faint glass (real sag from its own two surfaces) -----------------------------------
    let exitIdx = surfaces.length - 2;
    while (exitIdx > 0 && surfaces[exitIdx].kind !== 'refract') exitIdx--;
    const entryIdx = Math.max(0, exitIdx - 1);
    disposeGeom(lastElement);
    lastElement.geometry = buildLastElementGeometry(surfaces[entryIdx], surfaces[exitIdx], originZ);
    lastElement.visible = exitIdx > 0;
    elementFrontX = surfaces[entryIdx].z - originZ;
    lastElementR = Math.max(surfaces[entryIdx].sd, surfaces[exitIdx].sd);
    lastOutline.geometry.dispose();
    {
      // the element's section in the plane facing the camera (scene z = 0), above and below the axis
      const pts: THREE.Vector3[] = [];
      const e = surfaces[entryIdx], x = surfaces[exitIdx];
      const steps = 24;
      const prof: [number, number][] = [];
      for (let i = 0; i <= steps; i++) { const h = (lastElementR * i) / steps; prof.push([e.z - originZ + sagAt(e.c, e.k, e.a, h), h]); }
      for (let i = steps; i >= 0; i--) { const h = (lastElementR * i) / steps; prof.push([x.z - originZ + sagAt(x.c, x.k, x.a, h), h]); }
      for (const sign of [1, -1]) {
        for (let i = 0; i < prof.length - 1; i++) {
          pts.push(new THREE.Vector3(prof[i][0], sign * prof[i][1], 0), new THREE.Vector3(prof[i + 1][0], sign * prof[i + 1][1], 0));
        }
      }
      lastOutline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      lastOutline.visible = lastElement.visible;
    }

    // ---- sensor plate, true format size --------------------------------------------------------------------
    disposeGeom(sensorPlate);
    sensorPlate.geometry = buildRectGeometry(sensorX, model.sensor.format.w, model.sensor.format.h);
    sensorOutline.geometry.dispose();
    {
      const hw = model.sensor.format.w / 2, hh = model.sensor.format.h / 2;
      const c00 = new THREE.Vector3(sensorX, -hh, -hw), c01 = new THREE.Vector3(sensorX, hh, -hw);
      const c11 = new THREE.Vector3(sensorX, hh, hw), c10 = new THREE.Vector3(sensorX, -hh, hw);
      sensorOutline.geometry = new THREE.BufferGeometry().setFromPoints([c00, c01, c01, c11, c11, c10, c10, c00]);
    }

    // ---- the cone surface + sparse spectral rays, from the bundle's real traced rays ------------------------
    disposeGeom(coneSurface);
    const coneGeom = buildConeSurfaceGeometry(bundle.paths, originZ);
    if (coneGeom) { coneSurface.geometry = coneGeom; coneSurface.visible = true; }
    else { coneSurface.geometry = new THREE.BufferGeometry(); coneSurface.visible = false; }

    const { positions: rayPositions, nms: rayNms } = sparseRaySegments(bundle.paths, originZ, SPARSE_RAY_COUNT);
    const rayColors = new Float32Array(rayPositions.length);
    for (let i = 0; i < rayNms.length; i++) {
      const c = ctx.look.wavelengthToThreeColor(rayNms[i]);
      rayColors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    sparseRays.geometry.dispose();
    sparseRays.geometry = new THREE.BufferGeometry();
    sparseRays.geometry.setAttribute('position', new THREE.Float32BufferAttribute(rayPositions, 3));
    sparseRays.geometry.setAttribute('color', new THREE.Float32BufferAttribute(rayColors, 3));
    flight.update(rayNms.map((nm, i) => ({ nm, world: [Array.from(rayPositions.slice(i * 6, i * 6 + 3)), Array.from(rayPositions.slice(i * 6 + 3, i * 6 + 6))] as [number, number, number][] })));

    // ---- the bokeh disk texture + CoC/predicted rings, sized to comfortably contain all three -----------------
    const cx = bundle.centroid[0];
    const cy = bundle.centroid[1];
    diskCenter = { y: cy, z: cx };
    const measuredR = bundle.landing.length ? halfExtent(bundle.landing, cx, cy) : 0;
    const frameR = Math.max(measuredR, bundle.predictedBlurMm / 2, bundle.cocMm / 2, bundle.pitchMm * 3) * 1.35;
    insetHalfExtentMm = Math.max(frameR, bundle.pitchMm * 6);

    diskTex?.dispose();
    diskTex = buildDiskTexture(bundle.landing, cx, cy, insetHalfExtentMm, ctx.look);
    diskPlaneMat.map = diskTex.texture;
    diskPlaneMat.needsUpdate = true;
    disposeGeom(diskPlane);
    // A tiny offset toward the inset camera (not exactly coplanar with the pixel grid and CoC/predicted rings,
    // which all sit at X=sensorX too) avoids equal-depth z-fighting against those opaque lines; harmless at
    // 2 micrometers next to a sub-millimeter frame.
    diskPlane.geometry = buildDiskPlaneGeometry(sensorX + 0.002, cx, cy, insetHalfExtentMm);

    predictedRingGeom.dispose();
    predictedRing.geometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(sensorX, cx, cy, bundle.predictedBlurMm / 2, 64, true),
    );
    cocRingGeom.dispose();
    cocRing.geometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(sensorX, cx, cy, bundle.cocMm / 2, 64, false),
    );

    pixelGridGeom.dispose();
    pixelGrid.geometry = new THREE.BufferGeometry();
    pixelGrid.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(buildPixelGridPositions(sensorX, cx, cy, insetHalfExtentMm, bundle.pitchMm, MAX_GRID_LINES_PER_AXIS), 3),
    );

    // ---- inset camera (orthographic, straight down the optical axis onto the sensor region) ------------------
    insetCamera.left = -insetHalfExtentMm;
    insetCamera.right = insetHalfExtentMm;
    insetCamera.top = insetHalfExtentMm;
    insetCamera.bottom = -insetHalfExtentMm;
    insetCamera.near = 0.01;
    insetCamera.far = Math.max(1000, sensorX * 4);
    insetCamera.position.set(sensorX + Math.max(50, sensorX * 0.5), cy, cx);
    insetCamera.up.set(0, 1, 0);
    insetCamera.lookAt(sensorX, cy, cx);
    insetCamera.updateProjectionMatrix();

    // ---- the inset's scale (the inset is magnified; the main view is true scale) is written on the inset itself
    // by insets() below (R2-07), so the corner badge stays empty. The distance, focus and f-number live in the
    // traced-point card, the HUD line and the scenario builder: the scene carries no second copy.
    ctx.labels.remove('cone-hud');
    ctx.badge.hide();

    // ---- keep the probe pins' anchors in sync with the geometry they now point at ----------------------------
    anchorExitPupil.set(0, 0, 0);
    anchorCone.set(sensorX * 0.5, 0, 0);
    anchorDisk.set(sensorX + 0.001, diskCenter.y, diskCenter.z);
    // The disk itself is sub-mm -- three pins that sat right on top of it (a few insetHalfExtentMm apart) would
    // always collide on screen at the main view's real-mm scale (design/RUBRIC.md's "overlapping labels" smell).
    // Pixel-grid and CoC-ring are sensor-level concepts, not points on the disk itself, so they're spread a few
    // real mm apart along the sensor plate -- still visibly "at the sensor", legible at any camera distance.
    const format = lastModel?.sensor.format;
    // Toward the plate's far top and far bottom corners, well clear of the disk's own pin in the middle.
    const spreadY = (format?.h ?? 24) * 0.42;
    const spreadZ = (format?.w ?? 36) * 0.36;
    anchorPixelGrid.set(sensorX + 0.001, spreadY, spreadZ);
    anchorCoc.set(sensorX + 0.001, -spreadY, spreadZ);
    if (selectedId && group.visible) ctx.dive(frame());
  }

  let selectedId: string | null = null;
  // the inset's footprint for the pin pass (R2-06), and its note: what a square is and how wide the inset is
  const guard = insetGuard(ctx.overlay);
  // the picks the inset itself shows; any other pick on a phone puts the inset away until it is cleared
  const INSET_PARTS = new Set(['bokeh-disk', 'pixel-grid', 'coc-ring']);
  let debounceTimer = 0;
  controls.onChange(() => {
    if (!lastModel) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => rebuild(lastModel!), REBUILD_DEBOUNCE_MS);
  });

  // ---- probe cards ------------------------------------------------------------------------------------------
  function fig(v: number, unit: string, calc: string): PartCard['specs'][number]['fig'] {
    return { v, unit, ev: 'derived', calc };
  }

  function frame() {
    // Fits a sphere around everything this piece draws (the last element's rim, the exit pupil, the sensor
    // plate's corners, each point's axial and radial offset together) into the stage camera, fitting the
    // tighter of the vertical and the aspect-derived horizontal fov, then pans the frame away from the sensor
    // inset's corner (insetRectFor): left of it on a desktop, below it on a phone.
    if (!lastModel) return { position: new THREE.Vector3(40, 30, 90), target: new THREE.Vector3(40, 0, 0) };
    const spanMin = Math.min(0, elementFrontX);
    const spanMax = sensorX;
    const centerX = (spanMin + spanMax) / 2;
    const halfSpanX = Math.max(spanMax - centerX, centerX - spanMin);
    const maxRadial = Math.max(lastModel.cardinal.xp.r, lastElementR, lastModel.sensor.format.diag / 2);
    const trueRadius = Math.hypot(halfSpanX, maxRadial);
    const aspect = ctx.camera.aspect || 1.5;
    const phone = aspect < 0.9;
    const halfFovRad = THREE.MathUtils.degToRad(20);
    const halfFovHoriz = Math.atan(Math.tan(halfFovRad) * aspect);
    const dist = (trueRadius / Math.sin(Math.min(halfFovRad, halfFovHoriz))) * (phone ? 1.18 : 1.0);
    const dir = new THREE.Vector3(0.45, 0.32, 0.75).normalize();
    const target = new THREE.Vector3(centerX, 0, 0);
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const halfH = dist * Math.tan(halfFovRad);
    const [sx, sy] = phone ? [0.02, 0.02] : [0.3, -0.02];
    target.addScaledVector(right, sx * halfH * aspect).addScaledVector(up, sy * halfH);
    const position = target.clone().addScaledVector(dir, dist);
    return { position, target };
  }

  return {
    group,
    update(model) {
      diffraction.update(model);
      const lensChanged = !lastModel || lastModel.lens.id !== model.lens.id || lastModel.sensor.format.id !== model.sensor.format.id;
      rebuild(model);
      if (lensChanged && group.visible) ctx.dive(this.frame());
    },
    frame,

    probes: [
      {
        id: 'exit-pupil',
        label: 'Exit pupil',
        anchor: anchorExitPupil,
        card(model): PartCard {
          const xp = model.cardinal.xp;
          return {
            kicker: 'Level 3 · the exit pupil',
            title: 'Exit pupil',
            body: 'The opening the light seems to leave the lens through, seen from the sensor. The disc stands in for the whole barrel here, drawn where the engine puts the exit pupil and at its size.',
            specs: [
              { k: 'Distance to sensor', v: `${sensorX.toLocaleString('en-US', { maximumFractionDigits: 1 })} mm`, fig: fig(sensorX, 'mm', 'system.surfaces[image].z - cardinal().xp.z') },
              { k: 'Diameter', v: fmtMm(xp.r * 2), fig: fig(xp.r * 2, 'mm', 'cardinal().xp.r * 2') },
              { k: 'Pupil magnification', v: model.cardinal.pupilMag.toFixed(2), fig: fig(model.cardinal.pupilMag, 'ratio', 'cardinal().pupilMag = xp.r / ep.r') },
            ],
          };
        },
      },
      {
        id: 'cone',
        label: 'Cone of light',
        anchor: anchorCone,
        card(model): PartCard {
          const b = lastBundle;
          return {
            kicker: 'Level 3 · the cone',
            title: 'One point, traced',
            body: 'Every ray from one point in the scene, traced through the lens to the sensor. The working f-number sets how steeply the cone closes in.',
            specs: [
              { k: 'Working f-number', v: `f/${model.focus.workingFno.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, fig: fig(model.focus.workingFno, 'f-stop', 'exposure.ts workingFNumber(), pupil-corrected') },
              { k: 'Point set at', v: b ? fmtDistM(controls.pointDistMm()) : '–', fig: undefined },
              { k: 'Rays traced', v: b ? b.paths.length.toLocaleString('en-US') : '–', fig: undefined },
            ],
          };
        },
      },
      {
        id: 'bokeh-disk',
        label: 'The bokeh disk',
        anchor: anchorDisk,
        card(): PartCard {
          const b = lastBundle;
          return {
            kicker: 'Level 3 · the bokeh disk',
            title: 'Measured vs. predicted',
            body: 'How wide the disk is where the traced rays land, next to the textbook formula for defocus blur. Aberrations make the traced disk larger than the formula near wide apertures and close focus.',
            specs: b ? [
              { k: 'Measured diameter', v: fmtMm(b.diameterMm), fig: fig(b.diameterMm, 'mm', 'pointBundle(): max chord of landing points') },
              { k: 'Predicted diameter', v: fmtMm(b.predictedBlurMm), fig: fig(b.predictedBlurMm, 'mm', 'camera.ts exitPupilBlurDiameterMm()') },
              { k: 'Blade count', v: `${lastModel?.lens.blades ?? '–'}`, fig: lastModel ? { v: lastModel.lens.blades, unit: 'blades', ev: 'spec', src: lastModel.lens.source.url, loc: lastModel.lens.source.location } : undefined },
            ] : [],
          };
        },
      },
      {
        id: 'pixel-grid',
        label: 'Pixel grid',
        anchor: anchorPixelGrid,
        card(model): PartCard {
          return {
            kicker: 'Level 3 · the sensor',
            title: 'Pixel pitch',
            body: 'The inset draws the sensor\'s pixels at their true pitch, so the disk can be counted in pixels.',
            specs: [{ k: 'Pitch', v: `${model.sensor.pitchUm.toFixed(2)} µm`, fig: model.figs.pitchUm }],
          };
        },
      },
      {
        id: 'coc-ring',
        label: 'Circle of confusion',
        anchor: anchorCoc,
        card(model): PartCard {
          return {
            kicker: 'Level 3 · depth of field',
            title: 'The CoC assumption',
            body: 'The largest blur that still counts as sharp: the format diagonal divided by 1500, the default most depth-of-field calculators use. It is a convention about print size and viewing distance, so it is marked assumed.',
            specs: [{ k: 'CoC (this format)', v: fmtMm(model.focus.cocMm), fig: model.figs.cocMm }],
          };
        },
      },
    ],
    insets(): Inset[] {
      // On a phone with a part picked, the view above the sheet is too short to hold the inset as well (the same
      // rule as the lens cutaway, R2-06): it stays away unless the pick is something only the inset shows.
      const hideForPick = selectedId !== null && !INSET_PARTS.has(selectedId) && isPhone();
      if (!lastModel || hideForPick) { guard.update(null); return []; }
      // Sized from the view's own current CSS box (ctx.renderer.domElement fills it 1:1) so the inset sits
      // clear of the top HUD/pins and the bottom-left overlay sliders at any viewport size.
      const dom = (ctx.renderer as unknown as { domElement?: HTMLElement }).domElement;
      const viewW = dom?.clientWidth || 1200;
      const viewH = dom?.clientHeight || 640;
      lastInsetRect = insetRectFor(viewW, viewH);
      guard.update(lastInsetRect, `1 square = 1 pixel · ${(insetHalfExtentMm * 2).toFixed(2)} mm across`);
      return [{
        id: 'cone-sensor-inset',
        camera: insetCamera,
        rect: lastInsetRect,
        label: 'On the pixels',
      }];
    },
    tick(dt) { flight.tick(dt); },
    hooks: {
      diffraction: diffraction.state,
      light: flight.state,
      lightRibbon: flight.probe,
      /** Names and screen-space bounds of what this piece draws (layout checks in the screenshot tools). */
      debugObjects() {
        ctx.camera.updateMatrixWorld(true);
        return group.children.map((o) => {
          const b = new THREE.Box3().setFromObject(o);
          return { name: o.name, visible: o.visible, min: b.min.toArray().map((v) => +v.toFixed(1)), max: b.max.toArray().map((v) => +v.toFixed(1)) };
        });
      },
      probe() {
        if (!lastModel || !lastBundle) return null;
        return {
          diameterMeasuredMm: lastBundle.diameterMm,
          predictedBlurMm: lastBundle.predictedBlurMm,
          cocMm: lastBundle.cocMm,
          pitchUm: lastModel.sensor.pitchUm,
          blades: lastModel.lens.blades,
          centroid: { x: lastBundle.centroid[0], y: lastBundle.centroid[1] },
          landing: lastBundle.landing,
          inset: {
            rect: lastInsetRect,
            halfExtentMm: insetHalfExtentMm,
            mmPerPixel: (insetHalfExtentMm * 2) / lastInsetRect.width,
          },
        };
      },
      setPoint(pointDistMm: number, fieldFrac: number) {
        controls.set(pointDistMm, fieldFrac);
        if (lastModel) rebuild(lastModel);
      },
      /** Accuracy capture: preserve the real texture's coverage and geometry, isolating them from spectral
       * brightness and annotations. The normal spectral texture is restored when disabled. */
      geometryMask(enabled: boolean) {
        maskTexture?.dispose(); maskTexture = null;
        if (!diskTex) return;
        if (enabled) {
          const source = diskTex.texture.image as HTMLCanvasElement;
          const mask = document.createElement('canvas'); mask.width = source.width; mask.height = source.height;
          const context = mask.getContext('2d')!;
          const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
          for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          context.putImageData(pixels, 0, 0);
          maskTexture = new THREE.CanvasTexture(mask); maskTexture.colorSpace = THREE.SRGBColorSpace;
          diskPlaneMat.map = maskTexture;
        } else diskPlaneMat.map = diskTex.texture;
        diskPlaneMat.needsUpdate = true;
        predictedRing.visible = cocRing.visible = pixelGrid.visible = !enabled;
      },
      hull(pts: { x: number; y: number }[]) {
        return convexHullIndices(pts);
      },
    },
    select(id) { selectedId = id; },
    selectionFrame(id) {
      const probe = this.probes.find(p => p.id === id);
      return probe ? selectionFrame(this.frame(), group.localToWorld(probe.anchor.clone())) : this.frame();
    },
    activate() {
      diffraction.activate();
      flight.activate();
      // The main camera is shared across pieces (stage.ts); enable the context layer only while this piece
      // owns it (see the CONTEXT_LAYER comment above), and disable it again in deactivate() below.
      ctx.camera.layers.enable(1);
    },
    deactivate() {
      diffraction.deactivate();
      flight.deactivate();
      // A pending slider rebuild would otherwise hide another inspection's shared scale badge.
      window.clearTimeout(debounceTimer);
      // Own hygiene for switching away from this piece: stage.ts does not clear a piece's HUD labels or the
      // scale badge on its own when another piece is shown (only pin buttons are resynced), so a piece that
      // wants to leave nothing behind removes what it set. See docs/pieces/cone.md, "Known limits" for the
      // one label this can't fix (a piece shown before this one that skips this same cleanup).
      ctx.labels.remove('cone-hud');
      selectedId = null;
      guard.update(null);
      ctx.badge.hide();
      ctx.camera.layers.disable(1);
    },
    dispose() {
      diffraction.dispose();
      flight.dispose();
      controls.dispose();
      guard.dispose();
      window.clearTimeout(debounceTimer);
      for (const mesh of [pupilDisc, pupilRim, lastElement, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays, diskPlane, predictedRing, cocRing, pixelGrid]) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat.dispose();
      }
      diskTex?.dispose();
      maskTexture?.dispose();
      ctx.labels.remove('cone-hud');
    },
  };
};
