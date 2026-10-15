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
import type { Bundle, BundleRequest, Model } from '../engine/model-types';
import { pointBundle, pointBundleSliced } from '../app/engine-api';
import { traceableBins } from './lens/valid-bins';
import { convexHullIndices, halfExtent, ringPoints, sagAt } from './cone/coords';
import {
  buildConeSurfaceGeometry, buildDiscGeometry, buildDiskPlaneGeometry, buildLastElementGeometry,
  buildPixelGridPositions, sparseRaySegments,
} from './cone/geometry';
import { RECORDED_ALPHA_FLOOR, buildDiskTexture, type DiskTexture } from './cone/disk-texture';
import { buildOverlay, fmtDist, type ConeControls } from './cone/overlay';
import { fmtSpanMm } from '../app/units';
import { compactInsetRect, compactView, frameBoxAvoiding, frameBoxInRegion, freeRegion, insetGuard, isPhone } from './phone-frame';

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
// Score loop r6: a slider drag changes the model on every input event, and tracing the full bundle took 57-65 ms (desktop)
// to 420-500 ms (4x phone) each time, so the drag ran at 2-3 updates a second. A change now schedules one trace per animation
// frame, traced coarsely (a bundle with about an eighth of the rays: fewer rays per color, every other color), and the
// full bundle is traced once the input has been quiet for SETTLE_MS (the release of the slider).
const COARSE_RAYS_PER_NM = 32;
const COARSE_NM_STRIDE = 2;
const SETTLE_MS = 120;

const DEFAULT_POINT_M = 1.5;
const MAX_GRID_LINES_PER_AXIS = 160;

const COLOR_PREDICTED = 0x8fc3f0; // design/LOOK.md's --derived evidence color: an annotation, not a wavelength
const COLOR_AIRY = 0x6fe3d4; // the diffraction floor ring: a calculated annotation (Airy first dark ring), kept apart from the blue predicted ring and the lavender CoC ring
const COLOR_COC = 0xb7b0cf; // --assumed: the CoC ring is drawn to an assumed convention (d/1500)

// The view direction (target -> camera), score loop r2: from the lens side and a shallow three-quarter (LOOK.md #3,
// "side-on or a shallow three-quarter"), so the sensor plate's lit face is the one the cone lands on. The old view
// from behind the sensor saw the plate's back and had to keep it see-through to show where the cone landed.
const VIEW_DIR = new THREE.Vector3(-0.3, 0.3, 0.9).normalize();
// The exit-pupil ring's width beyond the pupil's true edge, as a fraction of its radius: drawn, not measured (the
// pupil itself is the dark disc inside it, at the engine's radius, with its crisp rim line).
const PUPIL_RING_W = 0.14;

function fmtMm(mm: number): string {
  return mm < 1 ? `${Math.round(mm * 1000).toLocaleString('en-US')} µm` : `${mm.toLocaleString('en-US', { maximumFractionDigits: 2 })} mm`;
}
const fmtDistM = fmtDist;

/** The sensor inset's square: bottom-right above the backend chip on a desktop, top-right under the layer switch
 *  on a phone (the same corners as the lens cutaway's inset), so it never sits on the 3D sensor plate or its pins.
 *  frame() slides the cone away from that corner. */
function insetRectFor(viewW: number, viewH: number, noteReserve = NOTE_RESERVE, ctlReserve = 0): { left: number; bottom: number; width: number; height: number } {
  // Compact views share lens/inset.ts's rule (phone-frame.ts): top-right, capped by the view's own size.
  // a phone held upright gives it 32% of the width (score loop r4, as the Optics inset gets 30%): the cone beside and below it grows
  // Score loop r6: its note runs above it in `noteReserve` px (two lines, or the measured height), and it stops above the
  // traced-point card (`ctlReserve`), so the note never lands on the sliders' words.
  if (compactView(viewH, viewW)) return compactInsetRect(viewW, viewH, isPhone() ? Math.round(viewW * 0.32) : 164, 1, noteReserve, ctlReserve);
  const w = Math.min(236, Math.max(160, Math.round(viewW * 0.21)));
  return { left: Math.max(8, viewW - 22 - w), bottom: 58, width: w, height: w };
}

/** The room above a compact inset for its note: two lines of the 11 px legend (13 px each) and 6 px of padding and gap. */
const NOTE_RESERVE = 36;
/** How far left of the inset a phone's note may run (px wide): "1 square = 1 pixel · 331 µm across ·" and "rays only, Airy 5.4 µm" in two lines. */
const NOTE_WIDE = 236;
/** On a phone on its side (a view under 300 px tall) the note keeps to the column beside the inset instead: wider, it would take the top
 *  of the cone and hide a pin (three lines there, still above the inset and clear of the sliders). */
const noteWideFor = (viewW: number, viewH: number, insetW: number) => (viewH < 300 && viewW < 400 && window.innerWidth > window.innerHeight ? insetW + 50 : NOTE_WIDE);

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
  // Score loop r2: the opening reads as a dark aperture inside a thin lit ring (below), not as a flat gray disc.
  const pupilDiscMat = new THREE.MeshBasicMaterial({ color: 0x040506, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  const pupilDisc = new THREE.Mesh(new THREE.BufferGeometry(), pupilDiscMat);
  pupilDisc.name = 'exit-pupil-disc';
  const pupilRimMat = new THREE.LineBasicMaterial({ color: 0xf0f0fa, transparent: true, opacity: 0.7 });
  const pupilRim = new THREE.LineSegments(new THREE.BufferGeometry(), pupilRimMat);
  pupilRim.name = 'exit-pupil-rim';
  // Materials that reflect the camera studio's softbox panels (look.ts studioLitSet): the glass, the pupil ring and
  // the sensor read lit like the Camera level instead of flat under the stage's dim dome (score loop r2).
  const studio = ctx.look.studioLitSet(ctx.renderer);
  let studioApplied = false; // render on demand (r2-perf): the first successful apply() asks tick() for a draw
  // A soft key from the lens side, above and in front, and a dim rim from behind the sensor, like the Optics level's
  // studio lights: they live in this group, so they leave with it, and they light materials only (rays and the
  // bokeh disk are unlit physics colors).
  const keyLight = new THREE.DirectionalLight(0xf4f2ee, 1.6);
  keyLight.position.set(-160, 200, 220);
  const rimLight = new THREE.DirectionalLight(0xd9c9a8, 0.8);
  rimLight.position.set(200, 120, -160);
  group.add(keyLight, rimLight);
  const pupilRingMat = studio.add(ctx.look.anodizedBarrelMaterial(true), 1.7);
  pupilRingMat.side = THREE.DoubleSide;
  const pupilRing = new THREE.Mesh(new THREE.BufferGeometry(), pupilRingMat);
  pupilRing.name = 'exit-pupil-ring';
  // The cone's straight lines continued back from the last glass surface to the exit-pupil plane, faint and neutral:
  // seen from the sensor, the light appears to come from the pupil. Construction lines, not light: no wavelength color.
  const virtualMat = new THREE.LineBasicMaterial({ color: 0xc8d4dc, transparent: true, opacity: 0.14, depthWrite: false });
  virtualMat.toneMapped = false;
  const virtualRays = new THREE.LineSegments(new THREE.BufferGeometry(), virtualMat);
  virtualRays.name = 'cone-to-pupil';

  // The last element as faint glass (LOOK.md #3: "at most a schematic exit-pupil disc, not the whole barrel"):
  // its real lathed profile, a pale glass tint at low opacity with a clearcoat highlight, and its section inked,
  // the same section-glass look as the lens cutaway, so it reads as glass and not as a gray plastic disc.
  // Score loop r2: the Optics cutaway's own pale coated glass (look.ts cutawayGlassMaterial, its ior set per lens in
  // rebuild()), with a clear coat and the studio's reflections, so it reads as the same glass and not a smoky blob.
  const lastElementMat = studio.add(ctx.look.cutawayGlassMaterial(1.52, false), 1.8);
  lastElementMat.opacity = 0.2;
  lastElementMat.clearcoat = 1;
  lastElementMat.clearcoatRoughness = 0.04;
  // the element's blackened edge (LOOK.md: edge blackening), a band at its rim like the cutaway's elements
  const lastEdgeMat = studio.add(ctx.look.elementEdgeMaterial(), 1.2);
  const lastEdge = new THREE.Mesh(new THREE.BufferGeometry(), lastEdgeMat);
  lastEdge.name = 'last-element-edge';
  const lastElement = new THREE.Mesh(new THREE.BufferGeometry(), lastElementMat);
  lastElement.name = 'last-element';
  const lastOutlineMat = new THREE.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.45 });
  const lastOutline = new THREE.LineSegments(new THREE.BufferGeometry(), lastOutlineMat);
  lastOutline.name = 'last-element-outline';

  // The camera's own coated sensor surface (look.ts sensorArrayMaterial, as on the Camera level), opaque and lit by
  // the studio: it reads as silicon now that the view faces the side the light lands on (score loop r2).
  // score loop r6: the plate's lit face carries the Camera level's die look (look.ts sensorDieTexture: a dark bezel around the
  // active area, a fine cell grid, a faint Bayer tint), so the sensor is a package and not a bare outlined plane. The cell
  // grid is illustrative (about 120 x 80 cells across the face, not the real pixel count); the real pitch is in the inset.
  const sensorBodyMat = studio.add(ctx.look.sensorArrayMaterial(), 1.5);
  const sensorFaceMat = studio.add(ctx.look.sensorArrayMaterial(), 1.3);
  {
    const die = ctx.look.sensorDieTexture();
    if (die) {
      sensorFaceMat.map = die; sensorFaceMat.color.set(0xc4d0e0);
      sensorFaceMat.emissive.set(0xffffff); sensorFaceMat.emissiveMap = die; sensorFaceMat.emissiveIntensity = 0.16;
      sensorFaceMat.iridescence = 0.35; sensorFaceMat.roughness = 0.3;
    }
  }
  // BoxGeometry face order: +x, -x (the lit face toward the lens), +y, -y, +z, -z
  const sensorPlate = new THREE.Mesh(new THREE.BufferGeometry(), [sensorBodyMat, sensorFaceMat, sensorBodyMat, sensorBodyMat, sensorBodyMat, sensorBodyMat]);
  sensorPlate.name = 'sensor-plate';
  // a faint pool of floor under the whole setup, so the lens, the rays and the sensor stand on something (score loop r6)
  const floorGlow = ctx.look.groundGlow(1);
  floorGlow.name = 'focus-floor-glow';
  group.add(floorGlow);

  // The fill above (near-black silicon) reads as barely-there against the void; an --ink outline makes the
  // frame's real extent legible even so, which matters here since the field-position slider's whole point is
  // showing the point land nearer the frame edge.
  const sensorOutlineMat = new THREE.LineBasicMaterial({ color: 0xf0f0fa, transparent: true, opacity: 0.28 });
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
  // score loop r5: 0.2 (was 0.32) and a cool tint: at 0.32 a long lens drew a flat mid-grey tube the rays read as confetti on
  coneSurfaceMat.opacity = 0.2;
  coneSurfaceMat.color.set(0xa9bccb);
  coneSurfaceMat.side = THREE.DoubleSide;
  coneSurfaceMat.depthWrite = false;
  // A fresnel-like rim: sheen brightens strongly at grazing angles even where the face itself is nearly
  // transparent, so the cone's silhouette edge stays visible where a flat, view-angle-independent opacity alone
  // would not (LOOK.md's Ciechanowski reference names "clean edges" as the thing that makes the convergence
  // unambiguous -- art director finding cone-surface-invisible).
  coneSurfaceMat.sheen = 1;
  coneSurfaceMat.sheenColor = new THREE.Color(0xffffff);
  coneSurfaceMat.sheenRoughness = 0.4;
  coneSurfaceMat.envMapIntensity = 0.6;
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

  // Score loop r6: the diffraction floor. Rays alone shrink to a point as the lens is stopped down, but a real recorded point
  // is never smaller than its Airy disk, so the inset draws that disk's first dark ring (a dotted ring) beside the traced rays.
  const airyRingMat = ctx.look.physicsLineMaterial(COLOR_AIRY, 1.5);
  const airyRing = new THREE.LineSegments(new THREE.BufferGeometry(), airyRingMat);
  airyRing.name = 'airy-ring';

  const pixelGridGeom = new THREE.BufferGeometry();
  const pixelGridMat = new THREE.LineBasicMaterial({ color: 0x3a4048, transparent: true, opacity: 0.6 });
  pixelGridMat.toneMapped = false;
  const pixelGrid = new THREE.LineSegments(pixelGridGeom, pixelGridMat);
  pixelGrid.name = 'pixel-grid';

  group.add(pupilDisc, pupilRim, pupilRing, virtualRays, lastElement, lastEdge, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays, diskPlane, predictedRing, cocRing, airyRing, pixelGrid);

  // The context objects (barrel-side glass, the cone's own ray lines) cross through the sensor inset's cropped
  // frustum too -- a ray converging toward the disk enters the inset's tiny field of view as a long diagonal
  // line, which would swamp the accuracy gate's pixel threshold of "the disk" (tools/accuracy/cone.mjs). Three's
  // own layer mask keeps them out of the inset camera (which stays on the default layer 0) while the main
  // camera still sees everything -- see activate()/deactivate() below for enabling layer 1 only while this
  // piece owns the shared main camera.
  const CONTEXT_LAYER = 1;
  for (const obj of [pupilDisc, pupilRim, pupilRing, virtualRays, lastElement, lastEdge, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays, floorGlow]) obj.layers.set(CONTEXT_LAYER);

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

  /** The bundle request for this model and the traced point's current setting. `coarse`: the drag preview (an eighth of the rays,
   *  no d-line trace); the full bundle follows when the input stops. */
  function bundleRequestFor(model: Model, coarse: boolean): BundleRequest {
    controls.setMinMm(model.lens.closestFocusMm);
    controls.setFocusMm(model.focus.distanceMm);
    const pointDistMm = Math.min(200_000, Math.max(model.lens.closestFocusMm, controls.pointDistMm()));
    const fieldFrac = controls.fieldFrac();
    const allBins = traceableBins(model, NM_BINS);
    return coarse
      ? { pointDistMm, fieldFrac, rays: COARSE_RAYS_PER_NM, nms: allBins.filter((_, i) => i % COARSE_NM_STRIDE === 0) }
      : { pointDistMm, fieldFrac, rays: RAYS_PER_NM, nms: allBins, dLine: true };
  }

  /** `traced`: the bundle for this model, when it was traced in slices elsewhere. */
  function rebuild(model: Model, coarse = false, traced?: Bundle) {
    lastModel = model;
    coarseShown = coarse;
    const bundle = traced ?? pointBundle(model, bundleRequestFor(model, coarse));
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
    pupilRing.geometry.dispose();
    {
      const r = Math.max(0.05, model.cardinal.xp.r), w = Math.max(0.5, r * PUPIL_RING_W), t = w * 0.7;
      // a small rectangular section revolved about the axis, just outside the pupil's true edge
      const prof = [new THREE.Vector2(r, -t / 2), new THREE.Vector2(r + w, -t / 2), new THREE.Vector2(r + w, t / 2), new THREE.Vector2(r, t / 2), new THREE.Vector2(r, -t / 2)];
      const g = new THREE.LatheGeometry(prof, 96);
      g.rotateZ(-Math.PI / 2); // lathe +Y onto scene +X, the optical axis (geometry.ts buildLastElementGeometry)
      g.computeVertexNormals();
      pupilRing.geometry = g;
    }

    // ---- last element as faint glass (real sag from its own two surfaces) -----------------------------------
    let exitIdx = surfaces.length - 2;
    while (exitIdx > 0 && surfaces[exitIdx].kind !== 'refract') exitIdx--;
    const entryIdx = Math.max(0, exitIdx - 1);
    disposeGeom(lastElement);
    lastElement.geometry = buildLastElementGeometry(surfaces[entryIdx], surfaces[exitIdx], originZ);
    lastElement.visible = exitIdx > 0;
    elementFrontX = surfaces[entryIdx].z - originZ;
    lastElementR = Math.max(surfaces[entryIdx].sd, surfaces[exitIdx].sd);
    {
      const nd = model.realized.design.surfaces[entryIdx]?.nd ?? 1.52;
      lastElementMat.ior = nd;
      lastEdge.geometry.dispose();
      const e = surfaces[entryIdx], x = surfaces[exitIdx];
      const x0 = e.z - originZ + sagAt(e.c, e.k, e.a, lastElementR), x1 = x.z - originZ + sagAt(x.c, x.k, x.a, lastElementR);
      const band = ctx.look.edgeBandGeometry(lastElementR * 1.004, Math.min(x0, x1), Math.max(x0, x1, Math.min(x0, x1) + 0.3));
      band.rotateY(Math.PI / 2); // band axis z onto scene +X
      lastEdge.geometry = band;
      lastEdge.visible = exitIdx > 0;
    }
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
    // a thin slab whose lit face is the image plane itself, its body behind it (drawn depth, not a measured one)
    {
      const slab = new THREE.BoxGeometry(0.8, model.sensor.format.h, model.sensor.format.w);
      slab.translate(sensorX + 0.4 + 0.004, 0, 0);
      sensorPlate.geometry = slab;
    }
    {
      const hh = model.sensor.format.h / 2, x0 = Math.min(elementFrontX, 0);
      floorGlow.position.set((x0 + sensorX) / 2, -(Math.max(hh, lastElementR) * 1.25 + 1), 0);
      floorGlow.scale.setScalar(Math.max(sensorX - x0, model.sensor.format.w * 2) * 0.62);
    }
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
    virtualRays.geometry.dispose();
    {
      // each sparse ray's last leg, continued backward to the exit-pupil plane (scene x = 0) when that plane is in
      // front of the last glass surface; skipped when the pupil sits behind it
      const pts: number[] = [];
      for (let i = 0; i + 5 < rayPositions.length; i += 6) {
        const sx = rayPositions[i], sy = rayPositions[i + 1], sz = rayPositions[i + 2];
        const ex = rayPositions[i + 3], ey = rayPositions[i + 4], ez = rayPositions[i + 5];
        if (sx < 0.5 || ex - sx < 1e-6) continue;
        const t = -sx / (ex - sx);
        pts.push(0, sy + (ey - sy) * t, sz + (ez - sz) * t, sx, sy, sz);
      }
      virtualRays.geometry = new THREE.BufferGeometry();
      virtualRays.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      virtualRays.visible = pts.length > 0;
    }
    flight.update(rayNms.map((nm, i) => ({ nm, world: [Array.from(rayPositions.slice(i * 6, i * 6 + 3)), Array.from(rayPositions.slice(i * 6 + 3, i * 6 + 6))] as [number, number, number][] })));

    // ---- the bokeh disk texture + CoC/predicted rings, sized to comfortably contain all three -----------------
    const cx = bundle.centroid[0];
    const cy = bundle.centroid[1];
    diskCenter = { y: cy, z: cx };
    const measuredR = bundle.landing.length ? halfExtent(bundle.landing, cx, cy) : 0;
    const airyR = model.diffraction.airyRadiusUm / 1000;
    const frameR = Math.max(measuredR, bundle.predictedBlurMm / 2, bundle.cocMm / 2, airyR, bundle.pitchMm * 3) * 1.35;
    insetHalfExtentMm = Math.max(frameR, bundle.pitchMm * 6);

    diskTex?.dispose();
    const recW = new Map(bundle.recordedWeightByNm.map((r) => [r.nm, r.w]));
    // a coarse bundle has about an eighth of the landing points: wider splats keep the disk's area and light about the same
    diskTex = buildDiskTexture(bundle.landing, cx, cy, insetHalfExtentMm, ctx.look, (nm) => recW.get(nm) ?? 1,
      coarse ? Math.min(2.4, Math.sqrt(RAYS_PER_NM * NM_BINS.length / Math.max(1, bundle.paths.length))) : 1);
    diskPlaneMat.map = diskTex.texture;
    diskPlaneMat.needsUpdate = true;
    disposeGeom(diskPlane);
    // A tiny offset toward the inset camera (not exactly coplanar with the pixel grid and CoC/predicted rings,
    // which all sit at X=sensorX too) avoids equal-depth z-fighting against those opaque lines; harmless at
    // 2 micrometers next to a sub-millimeter frame.
    diskPlane.geometry = buildDiskPlaneGeometry(sensorX + 0.002, cx, cy, insetHalfExtentMm);

    predictedRing.geometry.dispose();
    predictedRing.geometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(sensorX, cx, cy, bundle.predictedBlurMm / 2, 64, true),
    );
    cocRing.geometry.dispose();
    cocRing.geometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(sensorX, cx, cy, bundle.cocMm / 2, 64, false),
    );

    airyRing.geometry.dispose();
    airyRing.geometry = new THREE.BufferGeometry().setFromPoints(ringPoints(sensorX + 0.001, cx, cy, airyR, 128, true));

    pixelGrid.geometry.dispose();
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
  // the room a compact inset leaves above itself for its note, and the foot of the view the traced-point card covers (score loop r6)
  let noteReserve = NOTE_RESERVE;
  const ctlReserve = () => { const h = controls.el.offsetHeight; return h > 0 ? h + 14 : 0; };
  guard.onResize(() => ctx.invalidate?.());
  // the picks the inset itself shows; any other pick on a phone puts the inset away until it is cleared
  const INSET_PARTS = new Set(['bokeh-disk', 'pixel-grid', 'coc-ring']);
  let debounceTimer = 0;
  controls.onChange(() => {
    if (!lastModel) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { refineToken++; cancelFrame(); window.clearTimeout(settleTimer); const m = pendingModel ?? lastModel!; pendingModel = null; rebuild(m); ctx.invalidate?.(); cardsStale(); }, REBUILD_DEBOUNCE_MS);
  });

  // ---- one trace per frame while the model keeps changing (score loop r6) ------------------------------------------
  let pendingModel: Model | null = null;   // the newest model not yet drawn
  let lastNoteText = '';
  let coarseShown = false;                 // what is drawn is the drag preview, a full trace is still owed
  let frameTimer = 0, frameRaf = 0, settleTimer = 0, refineToken = 0;
  const yieldToMain = (): Promise<void> => {
    const sched = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    return sched?.yield ? sched.yield() : new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  };
  const cancelFrame = () => {
    window.clearTimeout(frameTimer);
    if (frameRaf) cancelAnimationFrame(frameRaf);
    frameRaf = 0;
  };
  const cancelScheduled = () => { refineToken++; cancelFrame(); window.clearTimeout(settleTimer); window.clearTimeout(debounceTimer); };
  /** What a card reads (the traced numbers) changed after the panel drew it. */
  const cardsStale = () => ctx.bus.emit('card-stale', { piece: 'cone' });
  const runCoarse = () => {
    cancelFrame();
    const m = pendingModel;
    if (!m) return;
    pendingModel = null;
    rebuild(m, true);
    ctx.invalidate?.();
    cardsStale();
    // the full trace waits for the input to stop; a newer model arriving restarts that wait
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(refine, SETTLE_MS);
  };
  /** The full bundle for the newest model, traced in short tasks (a 4x phone takes about 450 ms to trace it in one); a newer model, a
   *  flush or a deactivation cancels it. */
  function refine() {
    cancelFrame();
    window.clearTimeout(settleTimer);
    if (!pendingModel && !coarseShown) return;
    if (!group.visible && !pendingModel) return;
    const m = pendingModel ?? lastModel;
    pendingModel = null;
    if (!m) return;
    const token = ++refineToken;
    const req = bundleRequestFor(m, false);
    void pointBundleSliced(m, req, { sliceNms: 2, yieldToMain, cancelled: () => token !== refineToken }).then((bundle) => {
      if (!bundle || token !== refineToken) return;
      rebuild(m, false, bundle);
      ctx.invalidate?.();
      cardsStale();
    }).catch(() => { if (token === refineToken) { rebuild(m); ctx.invalidate?.(); cardsStale(); } });
  }
  /** The same, synchronously. */
  function refineNow() {
    cancelFrame();
    window.clearTimeout(settleTimer);
    if (!pendingModel && !coarseShown) return;
    const m = pendingModel ?? lastModel;
    pendingModel = null;
    refineToken++;
    if (!m) return;
    rebuild(m);
    ctx.invalidate?.();
    cardsStale();
  }
  /** A model change while this level is on screen: drawn coarsely on the next frame, in full when the input stops. */
  function schedule(model: Model) {
    pendingModel = model;
    refineToken++; // a newer model: a full trace in flight is for an older one
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(refine, SETTLE_MS + 100); // backstop if no frame comes (a throttled or hidden tab)
    if (frameRaf) return;
    frameRaf = requestAnimationFrame(runCoarse);
    window.clearTimeout(frameTimer);
    frameTimer = window.setTimeout(runCoarse, 100);
  }

  // ---- probe cards ------------------------------------------------------------------------------------------
  function fig(v: number, unit: string, calc: string): PartCard['specs'][number]['fig'] {
    return { v, unit, ev: 'derived', calc };
  }

  function frame() {
    // Fits what this piece draws (the exit pupil, the last element's rim, the sensor plate's corners) into the part of
    // the view the inset and the traced-point card leave free, by its projected bounding box (score loop r2: the old
    // bounding sphere left most of the view empty around a long, flat subject).
    if (!lastModel) return { position: new THREE.Vector3(40, 30, 90), target: new THREE.Vector3(40, 0, 0) };
    const r = Math.max(lastModel.cardinal.xp.r, 0.05);
    const ringR = r + Math.max(0.5, r * PUPIL_RING_W);
    const hw = lastModel.sensor.format.w / 2, hh = lastModel.sensor.format.h / 2;
    const pts: THREE.Vector3[] = [];
    for (const [x, rad] of [[0, ringR], [elementFrontX, lastElementR], [Math.max(0, elementFrontX), lastElementR]] as const) {
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pts.push(new THREE.Vector3(x, Math.cos(a) * rad, Math.sin(a) * rad)); }
    }
    for (const y of [-hh, hh]) for (const z of [-hw, hw]) pts.push(new THREE.Vector3(sensorX, y, z));
    const dom = (ctx.renderer as unknown as { domElement?: HTMLElement }).domElement;
    const viewW = dom?.clientWidth || 0, viewH = dom?.clientHeight || 0;
    if (!viewW || !viewH) {
      const c = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
      return { position: c.clone().addScaledVector(VIEW_DIR, sensorX * 3 + 60), target: c };
    }
    // what the traced-point card covers at the view's bottom-left, measured when it is on screen
    const ctl = controls.el.getBoundingClientRect(), view = dom!.getBoundingClientRect();
    const ctlTop = ctl.height > 0 ? ctl.top - view.top : viewH - 64;
    if (compactView(viewH, viewW)) {
      // the inset and its note are laid out first, so the framing leaves room for what the note measures (not a two-line guess)
      // (only while the overlay is on screen: a hidden note has no height to measure, and the guard would keep that layout)
      if (lastModel && ctl.height > 0 && !(selectedId !== null && !INSET_PARTS.has(selectedId) && isPhone())) placeInset(viewW, viewH);
      // A compact view frames the cone beside its top-right inset, by the same test and the same rectangle the inset
      // uses, and above the traced-point sliders along the bottom edge (review loop 10/11/2026).
      const bottomReserve = ctl.height > 0 ? Math.max(0, view.bottom - ctl.top + 4) : 64;
      const region = freeRegion(viewW, viewH, insetRectFor(viewW, viewH, noteReserve, ctlReserve()), bottomReserve);
      // Beside the inset the free column is tall and narrow (a 768x1024 tablet: 272 px wide, 420 tall), and the wide,
      // flat cone, fitted by its width and centered, left ~120 px of empty view between it and the sliders under it
      // (score loop r3). Its region there is the square that stands on the sliders, so the cone sits just above them.
      if (region.t === 0 && region.r < viewW - 1) region.t = Math.max(0, region.b - (region.r - region.l));
      // Then as large as it can grow below the inset (score loop r4: on a portrait phone the cone filled half the width
      // and left the band under the inset empty). The inset's own note runs 22 px above it.
      const ins = insetRectFor(viewW, viewH, noteReserve, ctlReserve());
      const insetTop = viewH - ins.bottom - ins.height;
      // 46 px in from the left edge (it was 8): the pin on the exit pupil, the cone's near end, is a 22 px disc centered on the ring, and a
      // cone entered by way of the Optics level is drawn about 17% larger than the same frame draws it when entered from the camera (the
      // stage's own projection, on the integration build too: pupil pin at 80 px against 109 at 844x390), which pushed pin 1 off the view's edge
      // (score loop r6, tools/test-phone-navigation.mjs: "844x390/cone: pins hidden or covered: exit-pupil")
      const area = { l: 46, t: 30, r: viewW - 8, b: viewH - bottomReserve - 10 };
      // the note above the inset runs left of it on a phone (score loop r6), so the cone keeps clear of its box too
      const noteL = isPhone() ? Math.max(8, Math.min(ins.left, ins.left + ins.width - noteWideFor(viewW, viewH, ins.width))) : ins.left;
      return frameBoxAvoiding(pts, VIEW_DIR, viewW, viewH, region, area, [
        { l: noteL, t: insetTop - noteReserve + 4, r: ins.left + ins.width, b: insetTop }, // the note, as wide as it runs
        { l: ins.left, t: insetTop, r: ins.left + ins.width, b: insetTop + ins.height }, // the inset itself
      ], 0.88, viewH < 300 && viewW < 400 ? 24 : 14);
    }
    // a desktop: left of the bottom-right inset, under the title, above the traced-point card and the navigation row
    const inset = insetRectFor(viewW, viewH);
    const region = { l: 16, t: 72, r: inset.left - 20, b: Math.min(viewH - 52, ctlTop - 10) };
    return frameBoxInRegion(pts, VIEW_DIR, viewW, viewH, region, 0.94);
  }

  /** The inset's rectangle for this view, with its note laid out (and measured, for a compact view) so the rectangle leaves the room the note takes. */
  function placeInset(viewW: number, viewH: number) {
    lastInsetRect = insetRectFor(viewW, viewH, noteReserve, ctlReserve());
    if (!lastModel) return lastInsetRect;
    // Rays only (score loop r5): the inset draws where traced rays land, with no diffraction; the note gives the Airy
    // disk's first dark ring (score loop r6: a teal dotted circle) of this stop so a stopped-down point is never read as smaller than it can be.
    const airyUm = 2 * lastModel.diffraction.airyRadiusUm;
    const airyTxt = airyUm.toLocaleString('en-US', { maximumFractionDigits: 1 });
    // A phone's inset note is about 100 px wide and the view 240 px tall: the short form keeps it inside the view under WCAG 1.4.12 text spacing (integration r5)
    const compact = compactView(viewH, viewW);
    const noteText = compact
      ? `1 square = 1 pixel · ${fmtSpanMm(insetHalfExtentMm * 2)} across · teal ring: Airy ${airyTxt} µm`
      : `1 square = 1 pixel · ${fmtSpanMm(insetHalfExtentMm * 2)} across · rays only · teal ring: Airy disk, ${airyTxt} µm`;
    // the note's text is laid out and measured (forced layout) when it changes; while a drag preview is drawn it keeps the last
    // full trace's wording and takes the new one with the full trace (score loop r6)
    if (!coarseShown || !lastNoteText) lastNoteText = noteText;
    guard.update(lastInsetRect, lastNoteText, true, compact ? { wide: noteWideFor(viewW, viewH, lastInsetRect.width) } : undefined);
    // Score loop r6: a compact inset leaves exactly the room its note measures above it (the note was under the inset and
    // ran onto the "Center" value of the Off center slider at 320 to 360 px, and with a reader's text spacing at 390). The
    // measured height replaces the two-line default once; the guard re-measures when a spacing stylesheet resizes the note.
    if (compact) {
      const want = Math.max(NOTE_RESERVE, guard.noteHeight() + 6);
      if (want !== noteReserve) {
        noteReserve = want;
        lastInsetRect = insetRectFor(viewW, viewH, noteReserve, ctlReserve());
        guard.update(lastInsetRect, lastNoteText, true, { wide: noteWideFor(viewW, viewH, lastInsetRect.width) });
      }
    }
    return lastInsetRect;
  }

  return {
    group,
    update(model) {
      diffraction.update(model);
      const lensChanged = !lastModel || lastModel.lens.id !== model.lens.id || lastModel.sensor.format.id !== model.sensor.format.id;
      // a level on screen with the same lens and sensor traces once per frame, coarsely, then in full (score loop r6); a hidden level
      // (built ahead) is traced in full at once; a new lens or the first model on screen is below
      const raf = typeof requestAnimationFrame === 'function';
      if (!lensChanged && group.visible && raf) { if (model !== lastModel || pendingModel || coarseShown) schedule(model); return; }
      // the first model on screen, or a new lens (a first entry to this level traced 450 ms in one task on a 4x phone): a coarse bundle now,
      // so the frame and the dive have their geometry, and the full one in short tasks right after
      if (group.visible && raf) {
        cancelScheduled(); pendingModel = null;
        rebuild(model, true);
        ctx.dive(this.frame());
        settleTimer = window.setTimeout(refine, 30);
        return;
      }
      cancelScheduled(); pendingModel = null;
      rebuild(model);
      if (lensChanged && group.visible) ctx.dive(this.frame());
    },
    async prepareUpdate(model) {
      if (group.visible) return null;
      const token = ++refineToken;
      const bundle = await pointBundleSliced(model, bundleRequestFor(model, false), { sliceNms: 2, yieldToMain, cancelled: () => token !== refineToken });
      if (!bundle || token !== refineToken) return null;
      return () => { diffraction.update(model); cancelScheduled(); pendingModel = null; rebuild(model, false, bundle); };
    },
    /** Draws what is pending at full quality now (the stage calls it before a forced frame, and a gate before it reads values). */
    flush() { window.clearTimeout(debounceTimer); refineNow(); },
    frame,

    probes: [
      {
        id: 'exit-pupil',
        label: 'Exit pupil',
        anchor: anchorExitPupil,
        card(model): PartCard {
          const xp = model.cardinal.xp;
          return {
            kicker: 'Focus · the exit pupil',
            title: 'Exit pupil',
            body: 'The opening the light seems to leave the lens through, seen from the sensor: its size and distance set how wide the cone of light is when it reaches the sensor.',
            more: 'How it’s drawn: the dark disk sits where the simulator puts the exit pupil and at its size, standing in for the barrel; the ring around it is only a marker, and faint straight lines carry the cone back from the last glass surface to it.',
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
            kicker: 'Focus · the cone',
            title: 'One point, traced',
            body: 'Every ray from one point in the scene, traced through the lens to the sensor. Ray colors are the traced wavelengths, red to violet; the disk is where they land.',
            more: 'The working f-number, the f-number in effect at this focus distance, sets how steeply the cone closes in.',
            specs: [
              { k: 'Working f-number (effective at this focus)', v: `f/${model.focus.workingFno.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, fig: fig(model.focus.workingFno, 'f-stop', 'exposure.ts workingFNumber(), pupil-corrected') },
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
          // Score-loop r1 (10/11/2026): the measured disk spans every traced wavelength, the prediction is the d line
          // only, so the gap is usually longitudinal color (one end of the spectrum focusing off the sensor), not
          // monochromatic aberration. The card names the widest wavelength and adds the like-for-like d-line chord.
          const widest = b && b.diameterByNm.length ? b.diameterByNm.reduce((a, c) => (c.diameterMm > a.diameterMm ? c : a)) : null;
          const nmLo = b && b.diameterByNm.length ? Math.min(...b.diameterByNm.map((d) => d.nm)) : 0;
          const nmHi = b && b.diameterByNm.length ? Math.max(...b.diameterByNm.map((d) => d.nm)) : 0;
          const fmtNm = (nm: number) => `${nm.toLocaleString('en-US', { maximumFractionDigits: 1 })} nm`;
          // Score-loop r5 (10/14/2026): the traced disk is geometric optics, rays only. A real recorded point is at least
          // its Airy disk (diffraction), which the rays do not carry; say so, with this stop's own figure.
          const airyUm = lastModel ? 2 * lastModel.diffraction.airyRadiusUm : 0;
          const airyPx = lastModel ? 2 * lastModel.diffraction.airyRadiusPx : 0;
          const fmtUm = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
          const diffractionNote = lastModel && b
            ? ` Rays only: diffraction is not added to the traced disk, so the inset also draws the Airy disk (550 nm) as a teal dotted ring. At this stop it is ${fmtUm(airyUm)} µm across (${fmtUm(airyPx)} px), ` +
              (airyUm * 0.001 >= b.recordedDiameterMm
                ? 'wider than the traced disk, so a real in-focus point here would be at least that wide.'
                : 'smaller than the traced disk here, but it becomes the larger part of an in-focus point as the lens is stopped down, and a real point is never smaller than it.')
            : '';
          return {
            kicker: 'Focus · the bokeh disk',
            title: 'Traced vs. textbook',
            body: 'The blur disk a point makes. The simulator traces real rays to find it, then compares it with the textbook formula; both are calculated, not measured on a real lens.',
            more: (diffractionNote ? diffractionNote.trim() + ' ' : '') + 'The traced disk is where the computed rays land; the textbook value is what an ideal lens would give, and the two rows at 587.6 nm compare like with like. The disk’s headline size is the size the sensor records: each traced wavelength' + (b ? ` (${fmtNm(nmLo)} to ${fmtNm(nmHi)})` : '') +
              ' counts by its share of the recorded light (the scene’s light times the camera’s red, green and blue sensitivity), and the disk is the circle holding 90% of it. ' +
              'Each color focuses at a slightly different depth (longitudinal color), so violet and deep red, which the sensor barely records, spread wider; ' +
              `the inset draws them as a faint halo (at least ${Math.round(RECORDED_ALPHA_FLOOR * 100)}% brightness) and the all-colors row lists the widest extent. ` +
              'The textbook value is the paraxial blur (ideal, small-angle optics) for yellow light (587.6 nm) only; what remains between the two 587.6 nm rows is the lens’s own aberration.',
            specs: b ? [
              { k: 'Traced disk, as recorded (90% of the light)', v: fmtMm(b.recordedDiameterMm), fig: fig(b.recordedDiameterMm, 'mm', 'pointBundle(): recordedDiameterMm, the circle about the weighted centroid holding 90% of the arriving rays’ recorded weight (Model.exposure.recordedByBin: scene photons x (R + 2G + B)/4 sensitivity)') },
              { k: 'Traced disk, all colors (widest extent)', v: fmtMm(b.diameterMm), fig: fig(b.diameterMm, 'mm', 'pointBundle(): max chord of landing points over every traced wavelength, unweighted') },
              ...(widest ? [{ k: 'Widest color', v: `${fmtNm(widest.nm)}, ${fmtMm(widest.diameterMm)}`, fig: fig(widest.diameterMm, 'mm', `pointBundle(): diameterByNm, max chord at ${widest.nm} nm`) }] : []),
              ...(b.dLineDiameterMm !== undefined ? [{ k: 'Traced at 587.6 nm', v: fmtMm(b.dLineDiameterMm), fig: fig(b.dLineDiameterMm, 'mm', 'pointBundle(): dLineDiameterMm, same pupil grid traced at the d line') }] : []),
              { k: 'Textbook (paraxial) at 587.6 nm', v: fmtMm(b.predictedBlurMm), fig: fig(b.predictedBlurMm, 'mm', 'camera.ts exitPupilBlurDiameterMm(): paraxial, d line, real exit pupil') },
              ...(lastModel ? [{ k: 'Diffraction, not in the traced disk (Airy disk, 550 nm, this stop)', v: `${fmtUm(airyUm)} µm · ${fmtUm(airyPx)} px`, fig: fig(airyUm, 'um', 'diffraction.ts airyRadius(550 nm, working f-number) x 2: the diameter of the first dark ring of the Airy pattern') }] : []),
              { k: 'Blade count', v: `${lastModel?.lens.blades ?? '–'}`, fig: lastModel ? { v: lastModel.lens.blades, unit: 'blades', ev: lastModel.realized.design.iris.ev, src: lastModel.realized.design.iris.source } : undefined },
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
            kicker: 'Focus · the sensor',
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
            kicker: 'Focus · depth of field',
            title: 'The circle of confusion',
            body: 'The circle of confusion (CoC) is the largest blur that still counts as sharp: the format diagonal divided by 1500, the viewing criterion selected for this model. It is a convention about print size and viewing distance, so it is marked assumed.',
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
      lastInsetRect = placeInset(viewW, viewH);
      return [{
        id: 'cone-sensor-inset',
        camera: insetCamera,
        rect: lastInsetRect,
        label: 'On the pixels',
      }];
    },
    tick(dt) { const lit = flight.tick(dt); if (studioApplied) return lit; studioApplied = studio.apply(); return lit || studioApplied; },
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
        refineNow(); // a gate reads the full trace, not the drag preview
        if (!lastModel || !lastBundle) return null;
        return {
          // the traced point's distance after the slider's log-step quantization (what the readout shows)
          pointDistMm: controls.pointDistMm(),
          diameterMeasuredMm: lastBundle.diameterMm,
          recordedDiameterMm: lastBundle.recordedDiameterMm,
          recordedWeightByNm: lastBundle.recordedWeightByNm,
          diameterByNm: lastBundle.diameterByNm,
          dLineDiameterMm: lastBundle.dLineDiameterMm,
          predictedBlurMm: lastBundle.predictedBlurMm,
          cocMm: lastBundle.cocMm,
          pitchUm: lastModel.sensor.pitchUm,
          airyDiameterMm: 2 * lastModel.diffraction.airyRadiusUm / 1000,
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
        cancelScheduled();
        const m = pendingModel ?? lastModel;
        pendingModel = null;
        if (m) rebuild(m);
      },
      /** Accuracy capture: preserve the real texture's coverage and geometry, isolating them from spectral
       * brightness and annotations. The normal spectral texture is restored when disabled. */
      geometryMask(enabled: boolean) {
        maskTexture?.dispose(); maskTexture = null;
        if (!diskTex) return;
        if (enabled) {
          // the geometry mask is every arriving ray at full alpha (unweighted), so the gates measure ray geometry
          const geo = lastBundle ? buildDiskTexture(lastBundle.landing, diskCenter.z, diskCenter.y, insetHalfExtentMm, ctx.look) : null;
          const source = (geo ?? diskTex).texture.image as HTMLCanvasElement;
          const mask = document.createElement('canvas'); mask.width = source.width; mask.height = source.height;
          const context = mask.getContext('2d')!;
          const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
          for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          context.putImageData(pixels, 0, 0);
          geo?.dispose();
          maskTexture = new THREE.CanvasTexture(mask); maskTexture.colorSpace = THREE.SRGBColorSpace;
          diskPlaneMat.map = maskTexture;
        } else diskPlaneMat.map = diskTex.texture;
        diskPlaneMat.needsUpdate = true;
        predictedRing.visible = cocRing.visible = airyRing.visible = pixelGrid.visible = !enabled;
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
    prepare() { studio.apply(); },
    activate() {
      studio.apply();
      diffraction.activate();
      flight.activate();
      // The main camera is shared across pieces (stage.ts); enable the context layer only while this piece
      // owns it (see the CONTEXT_LAYER comment above), and disable it again in deactivate() below.
      ctx.camera.layers.enable(1);
    },
    deactivate() {
      diffraction.deactivate();
      flight.deactivate();
      // A pending slider rebuild would otherwise hide another inspection's shared scale badge. The newest model is kept
      // (pendingModel) and drawn in full by the next entry's update().
      refineToken++; cancelFrame(); window.clearTimeout(settleTimer); window.clearTimeout(debounceTimer);
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
      cancelScheduled();
      for (const mesh of [pupilDisc, pupilRim, pupilRing, virtualRays, lastElement, lastEdge, lastOutline, sensorPlate, sensorOutline, coneSurface, sparseRays, diskPlane, predictedRing, cocRing, airyRing, pixelGrid]) {
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
