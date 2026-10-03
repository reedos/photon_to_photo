import { selectionFrame } from './selection-frame';
import '../styles/photon-rain.css';
// Set piece 9, the loupe: docs/BRIEF.md #9, design/LOOK.md "9. The loupe," docs/PROTOTYPE.md's loupe section.
// Everything drawn here is computed: the photo is the render worker's own rgba (render-client.ts), the target
// pixel's numbers come from pixelAt() (a real sampled PixelState), the ray bundle from pointBundle() (a real
// trace through the lens), and the well fill from electrons/fullWell. This piece never invents a number the
// engine did not produce; see needs_from_lead below for the one place that was not true and what was reported
// instead of invented.
//
// Coordinate convention (local group space, arbitrary display units -- always exaggerated, always badged):
//   local Y is the DIVE axis (the piece's "straight down through scale" per LOOK.md's composition note --
//   photo plane up high, well structure far below); local X/Z is the sensor's own row/column plane, always
//   recentered so the TAPPED pixel sits at local (x=0, z=0) at every layer, so a single continuous camera dive
//   toward local (0, *, 0) is all "diving straight down onto that exact pixel" needs -- no swapping geometry
//   in and out (LOOK.md's motion rule: "the 3D geometry itself never fades -- it scales/recedes").
import * as THREE from 'three/webgpu';
import type { BuildPiece, CameraFrame, Inset, PartCard, PieceProbe } from './types';
import type { Model } from '../engine/model-types';
import type { Fig, RayPath } from '../engine/types';
import { pointBundle } from '../app/engine-api';
import { traceableBins } from './lens/valid-bins';
import { badgeJoin, isPhone } from './phone-frame';
import { currentRender, onRender, onRenderFailure, pixelAt, type PixelInfo, type RenderView } from '../app/render-client';
import { sameShot } from '../app/learning-model';
import { cfaColorAt } from '../engine/pipeline';
import { projectToRenderedPixel, renderSetup } from '../engine/render';

// ---- display constants (local units; never true scale -- the badge always says so) ---------------------------

const Y_PHOTO = 70; // the photo plane's layer
const Y_GRID = 0; // the pixel-neighborhood layer (microlens/CFA/photodiode/well all stack around this)
const GRID_N = 5; // "a few neighbors" per LOOK.md -- a 5x5 block, center cell fully detailed, edges in view
const CELL = 5; // grid spacing, local units

const MICROLENS_APEX_Y = Y_GRID + 3.2;
const MICROLENS_BASE_Y = Y_GRID + 1.5;
const CFA_TOP_Y = MICROLENS_BASE_Y;
const CFA_BOT_Y = Y_GRID + 0.95;
const DIODE_TOP_Y = CFA_BOT_Y;
const DIODE_BOT_Y = Y_GRID + 0.25;
const WELL_TOP_Y = DIODE_BOT_Y;
const WELL_BOT_Y = Y_GRID - 3.6;
const WELL_HEIGHT = WELL_TOP_Y - WELL_BOT_Y;
// A sensor as it really is: every pixel carries the same stack (a CFA tile filling nearly the whole pitch, a
// microlens dome on top) on one silicon die. The neighbors are that stack with the target's detail left out
// (design/LOOK.md #9: "the target well is the only fully detailed one"): no well drawn, tints a touch dimmer.
const CELL_HALF = CELL * 0.46; // CFA tile half-size: the tiles meet with a thin gap, as on a real array
const NEIGHBOR_DIM = 0.62;
const TARGET_HALF = CELL * 0.44; // target stack footprint half-size
// The die is cut open in front of the target pixel (its column of cells toward the viewer removed down to the
// bottom of the well), the way a sensor cross-section is drawn, so the well is seen from the side through the cut.
const HALF_ARRAY = (GRID_N * CELL) / 2;
const DIE_BOT_Y = Y_GRID - 4.3;
// The stack's own layers (pixel/CFA/photodiode) sit only fractions of a unit apart -- their PIN anchors (not
// the meshes) are nudged sideways, each its own compass direction, so their on-screen labels stay legible and
// non-overlapping at the well framing's oblique angle (design/RUBRIC.md's "overlapping labels" smell). The well
// frame's camera looks mostly ALONG local Z (a three-quarter angle from +Z), which foreshortens a pure +Z/-Z
// separation almost to nothing on screen -- found directly from the art director's and critic's own screenshots,
// where "the well" and "the color filter" pins (previously opposite ends of the Z axis only) sat fused. Anchors
// below mix X and Z per pin (a real compass spread, not an axis each) so every pair keeps real screen-space
// separation from the well frame's actual viewing angle, not just 3D separation that projects away.
const PIN_SPREAD = TARGET_HALF * 2.4;
// Off-screen sentinel (RUBRIC.md's "overlapping labels" smell, the grid-overview case): before a tap, every
// stack pin sits on the same unresolved point at the far-zoomed-out PHOTO_FRAME, rendering as one illegible
// fused label block (the art director's own screenshot). These pins have nothing to say yet with no tapped
// pixel resolved, so tick() parks them here (well outside any camera's frustum) until diveStage is 'well'.
const PIN_HIDE = new THREE.Vector3(0, -1e6, 0);

const PHOTO_FRAME: CameraFrame = {
  position: new THREE.Vector3(0, Y_PHOTO + 150, 58),
  target: new THREE.Vector3(0, Y_PHOTO, 0),
};
const WELL_FRAME: CameraFrame = {
  // Looking into the cut from the front and a little to the side, down at about 30 degrees: the microlens, the
  // filter, the photodiode and the glass well with its charge stack up in one view, with the die's cut faces
  // and the neighbors' tiles around them for scale.
  // A moderate three-quarter angle, not the steep top-down look this went through first: straight down buried
  // the wider glass well and its charge fill behind the opaque photodiode slab directly above it, and a near-
  // eye-level angle clipped into the surrounding neighbor grid's own huge (relatively) swatches at this scale
  // (both found while reviewing this piece's own screenshots). This angle clears the grid and still shows the
  // well's own side wall below the narrower diode above it. Pulled back and raised slightly from an earlier,
  // tighter version of this same three-quarter angle (art director, "charge-fill-illegible"): that tighter
  // framing cropped the microlens dome out of the resting shot entirely and left only the diode+well slab
  // filling the frame -- legible per the accuracy gate's own numbers, but with nothing else in shot to give the
  // charge fill visual context. This framing keeps the same angle but backs off enough to hold the dome, the
  // diode and the well together, the same three parts the mid-dive frame shows (see docs/pieces/loupe.md).
  position: new THREE.Vector3(10, Y_GRID + 12, 26),
  target: new THREE.Vector3(0, WELL_BOT_Y + WELL_HEIGHT * 0.6, 1.5),
};
const PHOTO_DIST = PHOTO_FRAME.position.distanceTo(PHOTO_FRAME.target);
const WELL_DIST = WELL_FRAME.position.distanceTo(WELL_FRAME.target);

// The ray-bundle request: rays: ~200 pupil samples (the brief's own figure) x a representative spread of
// wavelength bins (fewer than the lens cutaway's 16 -- this cone is about the CONVERGENCE, not chromatic
// splitting, so a representative rainbow reads fine at far lower ray count and cost; see docs/pieces/loupe.md).
const BUNDLE_RAYS = 192;
const BUNDLE_NMS = [430, 470, 505, 540, 575, 610, 650, 690];

// Photon sparks: a small fixed pool, cycling continuously while the well is in view -- decorative arrival
// motion on top of a well fill that is ALWAYS drawn at its true, static electrons/fullWell value (never
// animated up from empty). See docs/pieces/loupe.md, "known limits," for why the animation and the drawn
// fill level are deliberately decoupled.
const SPARK_POOL = 18;
const SPARK_FALL_MS = 900;
const SPARK_SPAWN_Y = MICROLENS_APEX_Y + 3.4;

// The badge's dot budget: chosen so the badge's own "N photons/dot" times the dots actually drawn reproduces
// the pixel's real photon count to within one dot (the accuracy gate's own check #4).
const DOT_BUDGET = 40;

const CFA_NAME: Record<string, string> = { R: 'red', G: 'green', B: 'blue' };

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
function fmtNum(v: number, digits = 1): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fig(v: number, unit: string, ev: Fig['ev'], calc?: string, src?: string): Fig {
  return { v, unit, ev, calc, src };
}

/** The scale badge (design/LOOK.md): how much the picture is enlarged, and how many photons one drawn spark
 *  stands for. Uppercase by hand, so a unit or a symbol is never case-mapped. */
function badgeTextFor(mag: number, b: { n: number; dotsDrawn: number }): string {
  const size = `${fmtInt(mag)}× SIZE`;
  if (b.dotsDrawn === 0) return size;
  return badgeJoin(size, `1 DOT = ${fmtInt(b.n)} ${b.n === 1 ? 'PHOTON' : 'PHOTONS'}`);
}

interface BadgeInfo {
  n: number; // photons per drawn dot
  dotsDrawn: number;
  photonsMean: number;
}

function badgeFor(photonsMean: number): BadgeInfo {
  const n = Math.max(1, Math.round(photonsMean / DOT_BUDGET));
  const dotsDrawn = Math.max(1, Math.round(photonsMean / n));
  return { n, dotsDrawn, photonsMean };
}

// ---- small mesh builders (materials always from ctx.look, per design/LOOK.md) --------------------------------

function makeNeighborSwatch(look: import('./types').PieceContext['look'], channel: 'R' | 'G' | 'B'): THREE.Mesh {
  const mat = look.cfaDyeMaterial(channel);
  mat.color.multiplyScalar(NEIGHBOR_DIM);
  // Opaque dyed tiles for the context pixels: transmission on 48 small tiles costs a pass for nothing a reader
  // can see at this scale, and a slightly rough dye surface reads as a colored film, not as flat paint.
  mat.transmission = 0;
  mat.roughness = 0.42;
  mat.clearcoat = 0.4;
  mat.clearcoatRoughness = 0.2;
  const geo = new THREE.BoxGeometry(CELL_HALF * 2, CFA_TOP_Y - CFA_BOT_Y, CELL_HALF * 2);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

function makeMicrolens(look: import('./types').PieceContext['look']): THREE.Mesh {
  const r = TARGET_HALF * 1.05;
  const h = MICROLENS_APEX_Y - MICROLENS_BASE_Y;
  // A real plano-convex dome: the flat base is the sphere's equator, so scale a hemisphere's height to h.
  const geo = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1, h / r, 1);
  const mat = look.microlensMaterial();
  // This enlarged teaching cutaway uses the same stable alpha treatment as its well walls and
  // neighboring domes. A viewport-transmission sampler can retain a destroyed framebuffer when
  // switching into Pixel or resizing. The engine's microlens collection and spectral values are separate.
  mat.transmission = 0;
  mat.transparent = true;
  mat.opacity = 0.16;
  mat.depthWrite = false;
  mat.clearcoat = 1;
  mat.clearcoatRoughness = 0.02;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = MICROLENS_BASE_Y;
  return mesh;
}

// A hollow container -- four thin glass wall panels, not a solid transmissive block -- so a viewer looks
// through exactly ONE thin pane of glass into open space where the charge sits, not through two stacked full-
// thickness glass faces (front wall + back wall) whose combined attenuation and Fresnel reflection made a
// solid box read as flat dark/opaque in practice (found while reviewing this piece's own screenshots). This
// is also the more literally correct shape for "glass, not an opaque tank" (design/LOOK.md): a real well's
// container is thin walls around its charge, not a solid glass fill.
function makeWellShell(look: import('./types').PieceContext['look'], topY: number, botY: number, half: number): THREE.Group {
  const g = new THREE.Group();
  const h = topY - botY;
  const wallT = Math.max(0.03, half * 0.06);
  const mat = look.wellGlassMaterial();
  // `transmission` materials compute what shows through via their own refraction shader/pass, not via the
  // ordinary alpha channel -- their coverage renders opaque regardless of `opacity`/`transparent` (found while
  // reviewing this piece's own screenshots: the well's charge fill was completely invisible behind its front
  // wall, confirmed by a direct camera/NDC projection check showing the charge mesh correctly on screen and
  // NOT occluded by anything else, only by this same wall). Turning transmission off and relying on ordinary
  // alpha blending instead is the fix: it guarantees the wall stays genuinely see-through at this small,
  // nested, dark-void scale, at the cost of the refraction/dispersion a full transmission pass would add --
  // an acceptable, documented trade for this look prototype (docs/pieces/loupe.md, "known limits").
  mat.transmission = 0;
  mat.transparent = true;
  // 0.3 (this shell's first value) doubles up along any view ray that crosses two walls (e.g. front and back,
  // looking straight through the well) -- two 0.3-alpha white layers composite to ~0.51 coverage, enough of a
  // pale wash to bury the charge color sitting behind them (art director, "charge-fill-illegible"; confirmed
  // directly: the resting frame's well read as a flat, uniform pale slab with no charge tint visible at all).
  // 0.16 keeps the walls genuinely visible as glass (LOOK.md's own "not an opaque tank" rule) while cutting
  // that two-layer wash roughly in half.
  mat.opacity = 0.16;
  const front = new THREE.Mesh(new THREE.BoxGeometry(half * 2, h, wallT), mat);
  front.position.set(0, (topY + botY) / 2, half);
  const back = front.clone();
  back.position.z = -half;
  const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, h, half * 2), mat);
  left.position.set(-half, (topY + botY) / 2, 0);
  const right = left.clone();
  right.position.x = half;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(half * 2, wallT, half * 2), mat);
  floor.position.set(0, botY, 0);
  g.add(front, back, left, right, floor);
  return g;
}

function makeSlab(look: import('./types').PieceContext['look'], mat: THREE.Material, topY: number, botY: number, half: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(half * 2, Math.max(0.02, topY - botY), half * 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = (topY + botY) / 2;
  return mesh;
}

// ---- the piece --------------------------------------------------------------------------------------------

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'piece-loupe';

  // ---- the photo plane (the final render, as a texture) ------------------------------------------------------
  let photoCanvas = document.createElement('canvas');
  photoCanvas.width = 2;
  photoCanvas.height = 2;
  let photoCtx = photoCanvas.getContext('2d')!;
  let photoTexture = new THREE.CanvasTexture(photoCanvas);
  photoTexture.colorSpace = THREE.SRGBColorSpace;
  // Unlit, not one of LOOK.md's hardware material classes: this plane shows the finished PHOTOGRAPH exactly as
  // the final-image panel already displays it (design/LOOK.md's spectral/material rules govern light and
  // hardware, not a picture of a picture) -- toneMapped:false so its own already-encoded sRGB pixels are not
  // re-mapped a second time.
  const photoMat = new THREE.MeshBasicMaterial({ map: photoTexture, toneMapped: false });
  let photoAspect = 600 / 400;
  const photoGeo = new THREE.PlaneGeometry(1, 1);
  const photoMesh = new THREE.Mesh(photoGeo, photoMat);
  photoMesh.rotation.x = -Math.PI / 2; // lie flat, normal facing +Y
  // Up at the photo's own layer. (It was left at y = 0 before, flat under the pixel array, where it drew as the
  // mid-gray ground of review round 0, and, once its texture uploaded, as the photo itself under the tiles.)
  photoMesh.position.y = Y_PHOTO;
  group.add(photoMesh);

  const markerGeo = new THREE.RingGeometry(0.9, 1.15, 32);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xf0f0fa, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = Y_PHOTO + 0.05;
  group.add(marker);

  // ---- the pixel-neighborhood grid: center cell = full detail, others = dim flat swatches ---------------------
  const gridGroup = new THREE.Group();
  gridGroup.position.y = 0;
  group.add(gridGroup);
  const neighborMeshes: THREE.Mesh[] = [];
  const center = Math.floor(GRID_N / 2);
  const RGGB_LOCAL: ('R' | 'G' | 'B')[][] = [
    ['R', 'G'],
    ['G', 'B'],
  ];
  const inCut = (row: number, col: number) => col === center && row > center; // the opened column, toward the viewer
  const neighborCells: { row: number; col: number }[] = [];
  for (let row = 0; row < GRID_N; row++) {
    for (let col = 0; col < GRID_N; col++) {
      if ((row === center && col === center) || inCut(row, col)) continue; // the target has its own full stack
      const ch = RGGB_LOCAL[row % 2][col % 2];
      const mesh = makeNeighborSwatch(ctx.look, ch);
      mesh.position.set((col - center) * CELL, (CFA_TOP_Y + CFA_BOT_Y) / 2, (row - center) * CELL);
      gridGroup.add(mesh);
      neighborMeshes.push(mesh);
      neighborCells.push({ row, col });
    }
  }
  // The neighbors' microlenses: one shared dome, instanced. Clear, glossy and only faintly there, so the tiles'
  // colors read through them the way they do through a real microlens array.
  const domeR = TARGET_HALF * 1.05;
  const domeGeo = new THREE.SphereGeometry(domeR, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.scale(1, (MICROLENS_APEX_Y - MICROLENS_BASE_Y) / domeR, 1);
  const domeMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.08, transparent: true,
    opacity: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false });
  const domes = new THREE.InstancedMesh(domeGeo, domeMat, neighborCells.length);
  {
    const m = new THREE.Matrix4();
    neighborCells.forEach(({ row, col }, i) => {
      m.makeTranslation((col - center) * CELL, MICROLENS_BASE_Y, (row - center) * CELL);
      domes.setMatrixAt(i, m);
    });
    domes.instanceMatrix.needsUpdate = true;
  }
  gridGroup.add(domes);

  // The silicon die under the array, cut open along the target's column toward the viewer. Its top faces sit
  // under the tiles; the faces the cut exposes get a lighter section tone so the cut reads as a cut.
  const dieMat = ctx.look.siliconMaterial();
  const dieCutMat = new THREE.MeshStandardMaterial({ color: 0x2a313a, roughness: 0.55, metalness: 0.35 });
  const dieParts: THREE.Mesh[] = [];
  const dieBox = (x0: number, x1: number, z0: number, z1: number, cutFaces: number[]) => {
    const geo = new THREE.BoxGeometry(x1 - x0, DIODE_TOP_Y - DIE_BOT_Y, z1 - z0);
    // BoxGeometry face groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
    const mats = [0, 1, 2, 3, 4, 5].map((f) => (cutFaces.includes(f) ? dieCutMat : dieMat));
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set((x0 + x1) / 2, (DIODE_TOP_Y + DIE_BOT_Y) / 2, (z0 + z1) / 2);
    gridGroup.add(mesh);
    dieParts.push(mesh);
  };
  const cx0 = -CELL / 2, cx1 = CELL / 2, cz0 = -CELL / 2;
  dieBox(-HALF_ARRAY, cx0, -HALF_ARRAY, HALF_ARRAY, [0, 4]);     // left of the cut
  dieBox(cx1, HALF_ARRAY, -HALF_ARRAY, HALF_ARRAY, [1, 4]);      // right of the cut
  dieBox(cx0, cx1, -HALF_ARRAY, cz0, [4]);                        // behind the target

  // ---- the target pixel's full stack: microlens, CFA, photodiode, glass well + charge fill --------------------
  const microlens = makeMicrolens(ctx.look);
  gridGroup.add(microlens);

  // The target dye uses LOOK.md's tint with illustrative alpha coverage, like the other cutaway
  // covers. Display opacity is not the spectral transmission used for photon/electron calculations.
  const targetDye = (ch: 'R' | 'G' | 'B') => {
    const m = ctx.look.cfaDyeMaterial(ch);
    m.transmission = 0;
    m.transparent = true;
    m.opacity = 0.7;
    m.depthWrite = false;
    m.roughness = 0.3;
    m.clearcoat = 0.5;
    return m;
  };
  let cfaMesh = makeSlab(ctx.look, targetDye('G'), CFA_TOP_Y, CFA_BOT_Y, TARGET_HALF);
  gridGroup.add(cfaMesh);

  const diodeMesh = makeSlab(ctx.look, ctx.look.siliconMaterial(), DIODE_TOP_Y, DIODE_BOT_Y, TARGET_HALF);
  gridGroup.add(diodeMesh);

  // Wider than the photodiode sitting on top of it -- a flared glass base, not a same-width column hidden
  // directly under an opaque diode -- so the well's own glass walls and the charge inside are actually visible
  // from the dive's oblique, from-above camera angle, not occluded by the silicon slab above (found while
  // reviewing this piece's own screenshots: a same-width stack hid the well entirely). The height/fill
  // FRACTION this draws is exactly electrons/fullWell either way; only the footprint is a legibility choice.
  const WELL_HALF = TARGET_HALF * 0.96;
  const wellShell = makeWellShell(ctx.look, WELL_TOP_Y, WELL_BOT_Y, WELL_HALF);
  gridGroup.add(wellShell);
  // The well's glass edges, inked (the same pale line as the lens cutaway's glass sections), so the container
  // reads as a glass box around the charge rather than as a floating blue slab.
  const wellEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(WELL_HALF * 2, WELL_TOP_Y - WELL_BOT_Y, WELL_HALF * 2));
  const wellEdgeMat = new THREE.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.55 });
  const wellEdges = new THREE.LineSegments(wellEdgeGeo, wellEdgeMat);
  wellEdges.position.y = (WELL_TOP_Y + WELL_BOT_Y) / 2;
  gridGroup.add(wellEdges);

  const chargeGeo = new THREE.BoxGeometry(WELL_HALF * 1.8, 1, WELL_HALF * 1.8);
  const chargeMesh = new THREE.Mesh(chargeGeo, ctx.look.chargeMaterial(0.08));
  chargeMesh.scale.y = 0.001; // never literally zero -- LOOK.md's own zero-height-mesh pitfall
  chargeMesh.position.y = WELL_BOT_Y;
  gridGroup.add(chargeMesh);

  // ---- the ray bundle: the last segment of each traced ray, converging on the microlens apex ------------------
  const bundleGeo = new THREE.BufferGeometry();
  bundleGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  bundleGeo.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const bundleMat = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.85 });
  const bundleLines = new THREE.LineSegments(bundleGeo, bundleMat);
  gridGroup.add(bundleLines);

  // ---- photon sparks: a small pool, respawned on a cycle while the well is on screen ---------------------------
  const sparkGroup = new THREE.Group();
  const photonControls = document.createElement('div'); photonControls.className = 'light-playback'; photonControls.hidden = true;
  photonControls.innerHTML = '<button class="btn" type="button">Animate photons</button><label>Arriving light<input type="range" min="0" max="1000" value="0" aria-label="Photon animation phase"></label><span>Illustrative packets · not real time</span>';
  document.getElementById('model-experiments')!.before(photonControls);
  const photonButton = photonControls.querySelector('button')!, photonRange = photonControls.querySelector('input')!;
  const rainLaunch = document.createElement('button'); rainLaunch.type = 'button'; rainLaunch.className = 'btn rain-launch';
  rainLaunch.textContent = 'Photon rain & noise'; rainLaunch.hidden = true; photonControls.before(rainLaunch);
  let rainView: ReturnType<typeof import('../app/photon-rain').createPhotonRain> | null = null;
  rainLaunch.onclick = async () => {
    if (!currentModel || rainLaunch.disabled) return;
    pausePhotons(); rainLaunch.disabled = true;
    try {
      const { createPhotonRain } = await import('../app/photon-rain');
      if (disposed || !group.visible) return;
      rainView ??= createPhotonRain(); rainView.open(currentModel, rainLaunch);
    } catch (error) { console.error('Photon rain could not open', error); rainLaunch.textContent = 'Retry photon rain'; }
    finally { rainLaunch.disabled = false; }
  };
  let photonPlaying = false, photonTime = 0;
  const pausePhotons = () => { photonPlaying = false; photonButton.textContent = 'Animate photons'; };
  photonButton.onclick = () => { if (photonPlaying) pausePhotons(); else { photonPlaying = true; photonButton.textContent = 'Pause photons'; } };
  photonRange.oninput = () => { pausePhotons(); photonTime = Number(photonRange.value) / 1000 * SPARK_FALL_MS; };
  const offPhotonPause = ctx.bus.on('pause-exposure', pausePhotons);
  const hiddenPhotons = () => { if (document.hidden) pausePhotons(); };
  document.addEventListener('visibilitychange', hiddenPhotons);
  gridGroup.add(sparkGroup);
  const sparkGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const sparkMat = ctx.look.physicsColorMaterial(ctx.look.wavelengthToThreeColor(560));
  const sparks: { mesh: THREE.Mesh; phaseMs: number }[] = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.position.set((Math.random() - 0.5) * 1.2, SPARK_SPAWN_Y, (Math.random() - 0.5) * 1.2);
    sparkGroup.add(mesh);
    sparks.push({ mesh, phaseMs: (i / SPARK_POOL) * SPARK_FALL_MS });
  }

  // ---- breadcrumb inset camera: a fixed top-down ortho view of the photo plane ---------------------------------
  const insetCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  insetCam.up.set(0, 0, -1);
  insetCam.position.set(0, Y_PHOTO + 40, 0.0001);
  insetCam.lookAt(0, Y_PHOTO, 0);

  // A purpose-built scene for the breadcrumb, not the whole main scene (critic, "breadcrumb-empty" -- this
  // piece's own "known limits" doc entry had assumed the far-below grid/well geometry was sub-pixel and
  // harmless at the inset's zoomed-out framing; it is not: an orthographic camera draws distant geometry at
  // full size, no perspective falloff, and the grid's neighbor swatches sit well within this camera's own XZ
  // footprint, so they render right through/over the photo plane at this scale instead of vanishing behind it).
  // crumbPhoto/crumbMarker are separate Mesh instances sharing the main photo/marker's own geometry and
  // material (safe -- only object PARENTING is exclusive in three.js, not geometry/material reuse), so this
  // costs one extra draw call, not a duplicated texture or a second CanvasTexture upload.
  const insetScene = new THREE.Scene();
  const crumbPhoto = new THREE.Mesh(photoGeo, photoMat);
  crumbPhoto.rotation.x = -Math.PI / 2;
  insetScene.add(crumbPhoto);
  // A dedicated, larger marker for the crumb: the main marker (LOOK.md's on-photo ring, ~1.15 units on a
  // ~90-unit-wide plane) is built to read at the PHOTO_FRAME's own zoomed-out scale, not a 132px-wide inset --
  // at that ratio it is under 2px across, effectively invisible (critic, "no dot marking the tapped pixel").
  const crumbMarkerGeo = new THREE.RingGeometry(1.6, 2.5, 24);
  const crumbMarkerMat = new THREE.MeshBasicMaterial({ color: 0xf0f0fa, toneMapped: false, side: THREE.DoubleSide });
  const crumbMarker = new THREE.Mesh(crumbMarkerGeo, crumbMarkerMat);
  crumbMarker.rotation.x = -Math.PI / 2;
  crumbMarker.visible = false;
  insetScene.add(crumbMarker);

  /** The photo breadcrumb: bottom-left, one line above the scale badge (on a phone, beside the pixel's readout
   *  card at the bottom right, with the way-back line alone at the top under the layer switch). */
  function crumbRect(): { left: number; bottom: number; width: number; height: number } {
    const el = ctx.renderer.domElement;
    const viewW = el.clientWidth || 1000, viewH = el.clientHeight || 640;
    const phone = (typeof window !== 'undefined' ? window.innerWidth : viewW) <= 760;
    const w = phone ? 120 : 168;
    const h = Math.round(photoAspect >= 1 ? w / photoAspect : w);
    if (phone) return { left: 12, bottom: 58, width: w, height: h };
    const gutter = Math.min(72, Math.max(16, (typeof window !== 'undefined' ? window.innerWidth : viewW) * 0.044));
    return { left: Math.round(gutter), bottom: 46, width: w, height: h };
  }

  function syncInsetFrustum(): void {
    const halfW = (photoAspect >= 1 ? photoAspect : 1) * 1.06;
    const halfH = (photoAspect >= 1 ? 1 : 1 / photoAspect) * 1.06;
    // A little more room above the photo than below, the same aspect as the inset's box, so the inset's own
    // caption ("The photo") sits over empty ground instead of the photo's top edge.
    const room = 1.22, lift = 0.1;
    insetCam.left = -halfW * room * PHOTO_HALF_UNITS;
    insetCam.right = halfW * room * PHOTO_HALF_UNITS;
    insetCam.top = halfH * (room + lift) * PHOTO_HALF_UNITS;
    insetCam.bottom = -halfH * (room - lift) * PHOTO_HALF_UNITS;
    insetCam.updateProjectionMatrix();
  }
  const PHOTO_HALF_UNITS = 46; // half-width of the plane at aspect 1; see resizePhoto()

  // Places the crumb's photo + marker to match the main photoMesh's own current transform and the real tapped
  // pixel's position within the frame (a straightforward fraction-of-width/height placement -- the plane's
  // local X axis is the image's column axis unrotated, and CFA_TOP_Y's own rotation.x=-PI/2 carries local Y,
  // the texture's V/row axis, onto world Z one-to-one, so no extra sign flip is needed here).
  function syncCrumb(): void {
    crumbPhoto.scale.copy(photoMesh.scale);
    crumbPhoto.position.copy(photoMesh.position);
    if (targetX < 0) { crumbMarker.visible = false; return; }
    const view = currentRender();
    const w = view?.width ?? 1;
    const h = view?.height ?? 1;
    const u = (targetX + 0.5) / w - 0.5;
    const v = (targetY + 0.5) / h - 0.5;
    crumbMarker.position.set(u * photoMesh.scale.x, Y_PHOTO + 0.08, v * photoMesh.scale.y);
    crumbMarker.visible = true;
  }

  /** WELL_FRAME, pulled back on a narrow (phone) view so the stack and a ring of neighbors still fit across it,
   *  and aimed a little higher so the way-back line at the top of the view stays clear of the photon bundle. */
  function wellFrame(): CameraFrame {
    const aspect = ctx.camera.aspect || 1.5;
    if (aspect >= 0.9) return WELL_FRAME;
    const dir = WELL_FRAME.position.clone().sub(WELL_FRAME.target);
    const target = WELL_FRAME.target.clone().add(new THREE.Vector3(0, 1.2, 0));
    return { position: target.clone().addScaledVector(dir, 1.18), target };
  }

  // ---- piece state --------------------------------------------------------------------------------------------
  type DiveStage = 'photo' | 'well';
  let diveStage: DiveStage = 'photo';
  let targetX = -1;
  let targetY = -1;
  let targetRenderId = -1;
  let currentPixel: PixelInfo | null = null;
  let currentModel: Model | null = null;
  let currentBundlePaths: RayPath[] = [];
  let badge: BadgeInfo = { n: 1, dotsDrawn: 0, photonsMean: 0 };
  const badgeText = (mag: number) => badgeTextFor(mag, badge);
  let fetchSeq = 0;
  let diveTimer: number | null = null;
  let paintedRenderId = -1;
  let wantsWell = true;
  let disposed = false;
  let pendingPixel = false;
  let pixelError = '';
  const status = document.createElement('div');
  status.className = 'lv-read lv-status';
  status.setAttribute('role', 'status');
  const statusText = document.createElement('p');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Retry pixel';
  retry.onclick = () => acceptRender(currentRender());
  status.append(statusText, retry); ctx.overlay.appendChild(status);

  function matchingView(view: RenderView | null): view is RenderView {
    return !!view && !!currentModel && sameShot(view.scenario, currentModel.scenario);
  }
  function cancelDive(): void {
    if (diveTimer !== null) window.clearTimeout(diveTimer);
    diveTimer = null;
  }
  function invalidatePixel(): void {
    fetchSeq++; pendingPixel = false; currentPixel = null; currentBundlePaths = [];
    cancelDive(); pausePhotons();
    badge = { n: 1, dotsDrawn: 0, photonsMean: 0 };
    bundleGeo.setDrawRange(0, 0);
    syncBackButton();
  }

  function resizePhoto(view: RenderView | null): void {
    if (!view) return;
    photoAspect = view.width / view.height;
    const halfW = photoAspect >= 1 ? PHOTO_HALF_UNITS : PHOTO_HALF_UNITS * photoAspect;
    const halfH = photoAspect >= 1 ? PHOTO_HALF_UNITS / photoAspect : PHOTO_HALF_UNITS;
    photoMesh.scale.set(halfW * 2, halfH * 2, 1);
    syncInsetFrustum();
    syncCrumb();
  }

  function paintPhoto(view: RenderView): void {
    if (photoCanvas.width !== view.width || photoCanvas.height !== view.height) {
      // A texture's GPU storage is sized at its first upload; growing its canvas afterwards makes every later
      // upload overflow that storage (WebGL: "glCopySubTextureCHROMIUM: Offset overflows texture dimensions"),
      // which left the photo plane and the breadcrumb blank. A new canvas and texture at the new size instead.
      photoCanvas = document.createElement('canvas');
      photoCanvas.width = view.width;
      photoCanvas.height = view.height;
      photoCtx = photoCanvas.getContext('2d')!;
      const old = photoTexture;
      photoTexture = new THREE.CanvasTexture(photoCanvas);
      photoTexture.colorSpace = THREE.SRGBColorSpace;
      photoMat.map = photoTexture;
      photoMat.needsUpdate = true;
      old.dispose();
    }
    const imageData = photoCtx.createImageData(view.width, view.height);
    imageData.data.set(view.rgba);
    photoCtx.putImageData(imageData, 0, 0);
    photoTexture.needsUpdate = true;
    paintedRenderId = view.renderId;
    resizePhoto(view);
  }

  // Places the marker at the tapped pixel's own position on the (now recentered-under-it) photo plane -- since
  // every layer is recentered so the tapped pixel sits at local (0, *, 0), the marker always sits at the plane's
  // own center; recomputing this only documents why, it is not a coordinate lookup.
  marker.position.x = 0;
  marker.position.z = 0;

  function updateGridColors(cfa: 'R' | 'G' | 'B'): void {
    // Real Bayer geometry around a native pixel's own color at (targetX, targetY): the four neighbors sharing a
    // 2x2 quad follow cfaColorAt directly (imported, not reimplemented) so the grid's colors are the real CFA
    // pattern around the tapped site, not an assumed alternating scheme.
    const realX = currentPixel?.x ?? 0;
    const realY = currentPixel?.y ?? 0;
    let i = 0;
    for (let row = 0; row < GRID_N; row++) {
      for (let col = 0; col < GRID_N; col++) {
        if ((row === center && col === center) || inCut(row, col)) continue;
        const ch = cfaColorAt('RGGB', realX + (col - center), realY + (row - center));
        const mesh = neighborMeshes[i++];
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        const fresh = ctx.look.cfaDyeMaterial(ch);
        mat.color.copy(fresh.color).multiplyScalar(NEIGHBOR_DIM);
        fresh.dispose();
      }
    }
    (cfaMesh.material as THREE.Material).dispose();
    cfaMesh.material = targetDye(cfa);
  }

  function updateWellFill(): void {
    if (!currentPixel) return;
    const frac = Math.max(0, Math.min(1, currentPixel.electrons / currentPixel.fullWell));
    const h = Math.max(0.015, frac * WELL_HEIGHT); // never literally zero -- see the zero-height pitfall
    chargeMesh.scale.y = h;
    chargeMesh.position.y = WELL_BOT_Y + h / 2;
    (chargeMesh.material as THREE.Material).dispose();
    const mat = ctx.look.chargeMaterial(frac);
    // The stage's shared camera spans mm-scale lens elements to sub-micron sensor structure in one near/far
    // range (0.01 to 100000, stage.ts), so float32 depth-buffer precision at THIS piece's own small, close-in
    // well scale is coarse enough that the charge fill lost ordinary depth testing against its own well walls
    // outright (confirmed directly: forcing depthTest off made an otherwise-invisible test fill appear exactly
    // where expected, with nothing else actually in front of it). Disabling depth test/write for the charge
    // mesh specifically -- always draw it, never let it write depth for anything else -- sidesteps that
    // precision floor for the one object that must always read through the glass around it; the microlens,
    // CFA and diode above it are opaque/near-opaque anyway and still draw over it normally as ordinary opaque
    // geometry (they are not affected by this flag, which is set only on the charge material).
    mat.depthTest = false;
    mat.depthWrite = false;
    chargeMesh.material = mat;
    chargeMesh.renderOrder = 5;
  }

  function updateRayBundle(): void {
    if (!currentModel || !currentPixel) return;
    const halfFieldDeg = currentModel.realized.realization.halfFieldDeg || 1;
    const widthPx = currentModel.sensor.widthPx;
    const heightPx = currentModel.sensor.heightPx;
    const pitchMm = currentModel.sensor.pitchUm / 1000;
    const dxImg = currentPixel.x - widthPx / 2;
    const dyImg = heightPx / 2 - currentPixel.y; // image row grows downward; flip so +y reads "up", matching
    // types.ts's own "y up" system convention for the field-angle math below.
    const sensorXmm = dxImg * pitchMm;
    const sensorYmm = dyImg * pitchMm;
    const radialMm = Math.hypot(sensorXmm, sensorYmm);
    const efl = currentModel.cardinal.efl;
    const angleDeg = (Math.atan(radialMm / efl) * 180) / Math.PI;
    const fieldFrac = Math.max(0, Math.min(1, angleDeg / halfFieldDeg));
    const theta = radialMm > 1e-6 ? Math.atan2(sensorYmm, sensorXmm) : 0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    // Orthonormal local basis: radial (toward/away from the image center, in our local XZ plane) mapped from
    // the traced ray's own meridional (system-y) component; tangential from system-x; "toward the sensor"
    // (system +z) mapped to local -Y (our dive axis runs photo-at-top to well-at-bottom). This is a pure
    // rotation of orthonormal axes, so it preserves the real ray's arrival ANGLE exactly; only its drawn
    // LENGTH is a visual choice (see BUNDLE_LEN).
    const radial3 = new THREE.Vector3(cosT, 0, sinT);
    const tangent3 = new THREE.Vector3(-sinT, 0, cosT);
    const down3 = new THREE.Vector3(0, -1, 0);

    const pointDistMm = currentPixel.objectPoint[2]; // axial "distance from sensor," render.ts's own convention
    const bundle = pointBundle(currentModel, { pointDistMm, fieldFrac, rays: BUNDLE_RAYS, nms: traceableBins(currentModel, BUNDLE_NMS) });
    currentBundlePaths = bundle.paths;

    const BUNDLE_LEN = 3.6;
    const apex = new THREE.Vector3(0, MICROLENS_APEX_Y, 0);
    const positions: number[] = [];
    const colors: number[] = [];
    const tmp = new THREE.Vector3();
    for (const path of bundle.paths) {
      if (path.status !== 'ok' || !path.dirOut) continue;
      const [dx, dy, dz] = path.dirOut;
      tmp.copy(radial3).multiplyScalar(dy).addScaledVector(tangent3, dx).addScaledVector(down3, dz).normalize();
      const start = apex.clone().addScaledVector(tmp, -BUNDLE_LEN);
      positions.push(start.x, start.y, start.z, apex.x, apex.y, apex.z);
      const c = ctx.look.wavelengthToThreeColor(path.nm);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    bundleGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    bundleGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    bundleGeo.computeBoundingSphere();
    bundleGeo.setDrawRange(0, positions.length / 3);
  }

  function applyPixel(): void {
    if (!currentPixel) return;
    updateGridColors(currentPixel.cfa);
    updateWellFill();
    updateRayBundle();
    badge = badgeFor(currentPixel.photonsMean);
    selectedProbeSync();
    syncBackButton();
  }

  function refreshPixel(): void {
    if (disposed || !group.visible || !matchingView(currentRender()) || targetRenderId < 0 || targetX < 0 || targetY < 0) return;
    const seq = ++fetchSeq;
    pendingPixel = true; pixelError = ''; currentPixel = null; syncBackButton();
    pixelAt(targetRenderId, targetX, targetY).then((info) => {
      if (disposed || !group.visible || seq !== fetchSeq || !matchingView(currentRender())) return;
      pendingPixel = false;
      currentPixel = info;
      applyPixel();
      if (wantsWell && diveStage === 'photo') scheduleDiveToWell();
    }).catch(() => {
      if (disposed || seq !== fetchSeq) return;
      pendingPixel = false; pixelError = 'This pixel could not load. Retry, or change a camera setting to render a new photo.';
      syncBackButton();
    });
  }

  function scheduleDiveToWell(): void {
    cancelDive();
    if (!group.visible || !currentPixel || !wantsWell) return;
    diveTimer = window.setTimeout(() => {
      if (!group.visible || !currentPixel || !wantsWell || disposed) { diveTimer = null; return; }
      diveStage = 'well';
      ctx.dive(wellFrame());
      syncBackButton();
      diveTimer = null;
    }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 480);
  }

  function setTarget(x: number, y: number, renderId: number): void {
    const view = currentRender();
    if (!matchingView(view) || view.renderId !== renderId) return;
    invalidatePixel(); wantsWell = true;
    targetX = Math.max(0, Math.min(view.width - 1, Math.round(x)));
    targetY = Math.max(0, Math.min(view.height - 1, Math.round(y)));
    targetRenderId = view.renderId;
    marker.visible = true;
    refreshPixel();
    syncCrumb();
  }

  function acceptRender(view: RenderView | null): void {
    if (disposed || !group.visible || !matchingView(view)) { syncBackButton(); return; }
    if (view.renderId !== paintedRenderId) paintPhoto(view);
    if (targetX < 0) {
      const last = ctx.bus.lastLoupeTap();
      setTarget(last?.x ?? Math.floor(view.width / 2), last?.y ?? Math.floor(view.height / 2), view.renderId);
    } else if (targetRenderId !== view.renderId || (!currentPixel && !pendingPixel)) {
      invalidatePixel();
      targetX = Math.max(0, Math.min(view.width - 1, targetX));
      targetY = Math.max(0, Math.min(view.height - 1, targetY));
      targetRenderId = view.renderId; syncCrumb(); refreshPixel();
    }
  }

  function goBackToPhoto(): void {
    cancelDive(); wantsWell = false;
    diveStage = 'photo';
    ctx.dive(PHOTO_FRAME);
    ctx.bus.emit('select-part', { id: null });
    syncBackButton();
  }

  // ---- overlay: the way back and the pixel's numbers (design/LOOK.md #9: "a Back control (and Esc)" and "the
  // well's fill fraction as a number, not just the visual") ------------------------------------------------------
  // A breadcrumb like the camera's detail modes (Camera / the part): "Photo / Row r, column c", the first step a
  // link back out along the same dive. Styled in src/styles/levels.css (.lv-crumb).
  // On a phone with a part picked, the strip above the sheet holds only the pixel: the readout and the photo
  // inset step aside until the pick is cleared (R1-13).
  let pickedOnPhone = false;
  const crumb = document.createElement('p');
  crumb.className = 'lv-crumb';
  crumb.hidden = true;
  crumb.innerHTML = '<button type="button" class="lv-back">&larr; Photo</button><span class="lv-sep">/</span><span class="lv-here"></span>';
  const backBtn = crumb.querySelector<HTMLButtonElement>('.lv-back')!;
  const crumbHere = crumb.querySelector<HTMLElement>('.lv-here')!;
  backBtn.addEventListener('click', goBackToPhoto);
  ctx.overlay.appendChild(crumb);

  const read = document.createElement('div');
  read.className = 'lv-read';
  read.hidden = true;
  // One evidence chip for the whole reading (R2-08): every row is worked out by the engine for this pixel, the
  // same "Calc." the part cards give these numbers.
  read.innerHTML = `<div class="lv-read-h"><p class="lv-ctl-k">This pixel</p><span class="chip derived" title="Calculated by the engine for this pixel">Calc.</span></div>
    <div class="lv-read-row"><span>Photons, mean</span><b data-k="photons"></b></div>
    <div class="lv-read-row"><span>Electrons</span><b data-k="electrons"></b></div>
    <div class="lv-read-well" aria-hidden="true"><i></i></div>
    <div class="lv-read-row"><span>Well filled</span><b data-k="fill"></b></div>
    <div class="lv-read-row lv-read-extra"><span>Raw value</span><b data-k="dn"></b></div>`;
  ctx.overlay.appendChild(read);
  const readOut = (k: string) => read.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const readWell = read.querySelector<HTMLElement>('.lv-read-well i')!;

  let loadingState = '';
  function syncBackButton(): void {
    const active = group.visible && !disposed;
    rainLaunch.hidden = !group.visible;
    const ready = !!currentPixel && matchingView(currentRender());
    const waiting = active && !ready && !pixelError;
    const label = matchingView(currentRender()) ? 'Loading this pixel…' : 'Preparing the photo for these camera settings…';
    const nextLoading = waiting ? label : '';
    if (nextLoading !== loadingState) {
      loadingState = nextLoading;
      ctx.bus.emit('piece-loading', { id: 'loupe', loading: waiting, label, progress: matchingView(currentRender()) ? 0.85 : 0.15 });
    }
    // The shared central veil explains pending work and holds numbered pins. An
    // error replaces it with a centered, actionable message rather than an empty
    // scene or an old pixel presented as if it belonged to the current settings.
    status.hidden = !active || !pixelError;
    statusText.textContent = pixelError;
    retry.hidden = !pixelError;
    retry.disabled = !matchingView(currentRender());
    photonControls.hidden = !group.visible || !ready;
    gridGroup.visible = ready;
    photoMesh.visible = matchingView(currentRender());
    marker.visible = photoMesh.visible && targetX >= 0;
    const inWell = diveStage !== 'photo';
    crumb.hidden = !inWell || !ready;
    read.hidden = !inWell || !currentPixel || pickedOnPhone;
    if (currentPixel) {
      crumbHere.textContent = `Row ${fmtInt(currentPixel.y)}, column ${fmtInt(currentPixel.x)} · ${CFA_NAME[currentPixel.cfa]} filter`;
      const frac = Math.max(0, Math.min(1, currentPixel.electrons / currentPixel.fullWell));
      readOut('photons').textContent = fmtInt(currentPixel.photonsMean);
      readOut('electrons').textContent = `${fmtInt(currentPixel.electrons)} e⁻`;
      readOut('fill').textContent = `${fmtNum(frac * 100, 1)}%`;
      readOut('dn').textContent = `${fmtInt(currentPixel.dn)} DN`;
      readWell.style.width = `${(frac * 100).toFixed(1)}%`;
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && diveStage !== 'photo') goBackToPhoto();
  }

  const offBusTap = ctx.bus.on('loupe-tap', (e) => setTarget(e.x, e.y, e.renderId));
  const offRender = onRender(acceptRender);
  const offFailure = onRenderFailure(() => {
    if (disposed) return;
    invalidatePixel(); pixelError = 'The photo worker stopped. Change a camera setting to render a new photo.';
    syncBackButton();
  });

  // ---- probes -------------------------------------------------------------------------------------------------
  function selectedProbeSync(): void { /* probes read closure state live; nothing to push */ }

  const probes: PieceProbe[] = [
    {
      id: 'pixel',
      label: 'The tapped pixel',
      anchor: new THREE.Vector3(TARGET_HALF, CFA_TOP_Y, -TARGET_HALF),
      card(): PartCard {
        const p = currentPixel;
        return {
          kicker: 'Level 4 · the pixel',
          title: p ? `Row ${fmtInt(p.y)}, column ${fmtInt(p.x)}` : 'Waiting for the render…',
          body: 'The exact sensor pixel behind the tapped point in the photo, and the raw digital number the ' +
            'pipeline read out for it before demosaic, white balance or the color matrix touched it.',
          specs: p ? [
            { k: 'Row / column', v: `${fmtInt(p.y)} / ${fmtInt(p.x)}` },
            { k: 'Filter color', v: CFA_NAME[p.cfa][0].toUpperCase() + CFA_NAME[p.cfa].slice(1) },
            { k: 'Raw DN', v: fmtInt(p.dn), fig: fig(p.dn, 'DN', 'derived', 'render.ts pixel(x,y): readout(sensor, electrons, iso, sampled read noise)') },
            { k: 'Saturated', v: p.saturated ? 'yes' : 'no' },
          ] : [],
        };
      },
    },
    {
      id: 'microlens',
      label: 'The microlens',
      anchor: new THREE.Vector3(0, MICROLENS_APEX_Y, 0),
      card(model: Model): PartCard {
        return {
          kicker: 'Level 4 · the microlens',
          title: 'Microlens',
          body: 'A real plano-convex dome molded over each pixel, focusing its share of the incoming cone down ' +
            'through the color filter onto the photodiode. Fill factor and pitch are the sensor’s own.',
          specs: [
            { k: 'Pixel pitch', v: `${fmtNum(model.sensor.pitchUm, 2)} µm`, fig: model.sensor.figs.pitchUm },
            { k: 'IOR (typical)', v: '1.58', fig: fig(1.58, 'ratio', 'assumed', 'design/LOOK.md Materials: typical molded photoresist microlens') },
          ],
        };
      },
    },
    {
      id: 'cfa',
      label: 'The color filter',
      anchor: new THREE.Vector3(TARGET_HALF, CFA_TOP_Y, TARGET_HALF),
      card(): PartCard {
        const ch = currentPixel?.cfa ?? 'G';
        return {
          kicker: 'Level 4 · the color filter',
          title: `${ch} channel dye`,
          body: 'One Bayer dye above this photodiode, passing mostly its own band and some out-of-band light ' +
            '(the cross-talk demosaicing and the color matrix correct for downstream).',
          specs: [
            { k: 'Channel', v: ch },
            { k: 'Transmission (typical)', v: '~78%', fig: fig(0.78, 'fraction', 'assumed', 'design/LOOK.md Materials: representative Bayer dye transmission') },
          ],
        };
      },
    },
    {
      id: 'photodiode',
      label: 'The photodiode',
      anchor: new THREE.Vector3(0, DIODE_BOT_Y + 0.05, TARGET_HALF),
      card(model: Model): PartCard {
        return {
          kicker: 'Level 4 · the photodiode',
          title: 'Photodiode',
          body: 'Converts an arriving photon to an electron with some probability (its quantum efficiency), ' +
            'then lets that electron drift into the well below.',
          specs: [
            { k: 'Peak QE', v: `${fmtNum((model.sensor.figs.qePeak?.v ?? 0) * 100, 0)}%`, fig: model.sensor.figs.qePeak },
          ],
        };
      },
    },
    {
      id: 'well',
      label: 'The well',
      anchor: new THREE.Vector3(TARGET_HALF * 0.96, WELL_BOT_Y + WELL_HEIGHT * 0.35, TARGET_HALF * 0.96),
      card(model: Model): PartCard {
        const p = currentPixel;
        const fillPct = p ? (100 * p.electrons) / p.fullWell : 0;
        return {
          kicker: 'Level 4 · the well',
          title: 'The charge well',
          body: 'The well is drawn as glass so the charge inside shows. Its fill is the same fraction as the ' +
            'number below, shown twice, as height and as brightness, so even a view from straight above can tell a fuller well.',
          specs: p ? [
            { k: 'Electrons', v: `${fmtInt(p.electrons)} e⁻`, fig: fig(p.electrons, 'e-', 'derived', 'sensor.ts samplePixel(): one seeded stochastic draw') },
            { k: 'Full well', v: `${fmtInt(p.fullWell)} e⁻`, fig: model.sensor.figs.fullWellE },
            { k: 'Fill', v: `${fmtNum(fillPct, 1)}%` },
            { k: 'Read noise', v: `${fmtNum(p.readNoise, 1)} e⁻ rms`, fig: model.sensor.figs.readNoiseE },
          ] : [],
        };
      },
    },
    {
      id: 'photons',
      label: 'Arriving photons',
      anchor: new THREE.Vector3(0, SPARK_SPAWN_Y, 0),
      card(): PartCard {
        return {
          kicker: 'Level 4 · the photons',
          title: 'Photon arrivals',
          body: 'Sparks fall onto the microlens at a scaled rate: too many real photons arrive to draw one dot ' +
            'each, so the badge states the honest ratio for this exact pixel.',
          specs: currentPixel ? [
            { k: 'Photons (mean)', v: fmtInt(badge.photonsMean), fig: fig(badge.photonsMean, 'photons', 'derived', 'sensor.ts expectedElectrons() input, this pixel’s photonsMean') },
            { k: 'Badge scale', v: `1 dot = ${fmtInt(badge.n)} photons` },
          ] : [],
        };
      },
    },
  ];
  // Each probe's real anchor, saved once so tick() can park a probe at PIN_HIDE before a tap resolves (the
  // grid-overview state has nothing yet for any of these pins to say) and restore it once diveStage is 'well',
  // without losing the real position permanently (see PIN_HIDE's own comment).
  const realAnchors = new Map(probes.map((p) => [p.id, p.anchor.clone()]));

  // ---- PieceHandle ----------------------------------------------------------------------------------------

  return {
    group,

    update(model, _scenario) {
      if (currentModel && !sameShot(currentModel.scenario, model.scenario)) {
        invalidatePixel(); pixelError = '';
      }
      currentModel = model;
      acceptRender(currentRender());
      syncBackButton();
      if (currentPixel && matchingView(currentRender())) ctx.badge.show(badgeText(1));
      else ctx.badge.hide();
    },

    frame() {
      return diveStage === 'well' ? wellFrame() : PHOTO_FRAME;
    },

    probes,

    tick(dtMs) {
      if (document.hidden || ctx.renderer.domElement.inert || document.querySelector('dialog[open]')) pausePhotons();
      if (photonPlaying) { photonTime = (photonTime + Math.min(dtMs, 100)) % SPARK_FALL_MS; photonRange.value = String(Math.round(1000 * photonTime / SPARK_FALL_MS)); }
      // Park every stack pin off-screen until a tap has actually resolved something for it to point at (art
      // director, "pin-overlap": at the pre-tap grid-overview frame every one of these anchors' 3D separation
      // collapses to the same on-screen point at that extreme zoom-out, rendering as one fused, illegible label
      // block regardless of how far apart the anchors are in local units).
      const showPins = diveStage === 'well' && !!currentPixel;
      for (const p of probes) {
        const real = realAnchors.get(p.id);
        if (real) p.anchor.copy(showPins ? real : PIN_HIDE);
      }
      // The charge fill draws without a depth test (see updateWellFill), so while the camera is still above the
      // photo plane, where the photo itself hides everything below it, it is switched off rather than showing
      // through the picture as a stray blue square.
      chargeMesh.visible = ctx.camera.position.y < Y_PHOTO - 0.5;
      // Photon sparks: a small pool falling on a fixed cycle from just above the microlens down to its apex.
      for (const s of sparks) {
        const t = ((photonTime + s.phaseMs) % SPARK_FALL_MS) / SPARK_FALL_MS;
        s.mesh.position.y = THREE.MathUtils.lerp(SPARK_SPAWN_Y, MICROLENS_APEX_Y, t);
        s.mesh.visible = diveStage === 'well';
      }
      // The scale badge's magnification, read live from the camera's own current distance to the target (see
      // the module header): this stays honest under any easing curve, timing constant or reduced-motion snap
      // the stage applies, because it never re-derives the dive's own timing -- it just measures where the
      // camera actually is right now.
      const camDist = Math.max(0.01, ctx.camera.position.distanceTo(new THREE.Vector3(0, (Y_PHOTO + Y_GRID) / 2, 0)));
      const u = Math.max(0, Math.min(1, Math.log(PHOTO_DIST / camDist) / Math.log(PHOTO_DIST / WELL_DIST)));
      const mag = Math.round(1 + u * 2400); // an honest, monotonic "how exaggerated is this view right now"
      if (currentPixel && matchingView(currentRender())) ctx.badge.show(badgeText(mag));
      else ctx.badge.hide();
    },

    insets(): Inset[] {
      if (targetX < 0 || pickedOnPhone || !matchingView(currentRender())) return [];
      return [{
        id: 'loupe-breadcrumb',
        camera: insetCam,
        scene: insetScene,
        rect: crumbRect(),
        label: 'The photo',
      }];
    },

    select(id) {
      pickedOnPhone = !!id && isPhone();
      if (id) {
        wantsWell = true;
        if (currentPixel && diveStage === 'photo') scheduleDiveToWell();
      }
      syncBackButton();
    },
    selectionFrame(id) {
      const anchor = realAnchors.get(id);
      return diveStage === 'well' && anchor
        ? selectionFrame(wellFrame(), group.localToWorld(anchor.clone()))
        : this.frame();
    },

    activate() {
      syncBackButton();
      window.addEventListener('keydown', onKeydown);
    },

    deactivate() {
      rainLaunch.hidden = true; rainView?.close();
      pausePhotons(); photonControls.hidden = true;
      invalidatePixel(); status.hidden = true;
      window.removeEventListener('keydown', onKeydown);
      pickedOnPhone = false;
      if (diveTimer !== null) { window.clearTimeout(diveTimer); diveTimer = null; }
    },
    onViewInteraction() { cancelDive(); wantsWell = false; },

    hooks: {
      photons: () => ({ playing: photonPlaying, phase: photonTime / SPARK_FALL_MS }),
      // Test/accuracy-gate surface: window.p2p.pieces.loupe.<name>(...). See tools/accuracy/loupe.mjs.
      tap(x: number, y: number) {
        const view = currentRender();
        if (!view) throw new Error('loupe.ts hooks.tap: no render yet');
        const cx = Math.max(0, Math.min(view.width - 1, Math.round(x)));
        const cy = Math.max(0, Math.min(view.height - 1, Math.round(y)));
        ctx.bus.emit('loupe-tap', { x: cx, y: cy, renderId: view.renderId });
        return { x: cx, y: cy, renderId: view.renderId };
      },

      // The Back control, for the choreography (tools/choreo/loupe.mjs) to drive without a real DOM click.
      back() {
        goBackToPhoto();
      },

      state() {
        return { diveStage, targetX, targetY, targetRenderId, hasPixel: currentPixel !== null, pendingPixel, pixelError, paintedRenderId };
      },

      debugCamera() {
        const world = new THREE.Vector3();
        chargeMesh.getWorldPosition(world);
        const ndc = world.clone().project(ctx.camera);
        return {
          camPos: ctx.camera.position.toArray(),
          chargeWorld: world.toArray(),
          chargeNdc: ndc.toArray(),
          chargeVisible: chargeMesh.visible,
          chargeScale: chargeMesh.scale.toArray(),
          groupPos: group.position.toArray(),
          gridGroupPos: gridGroup.position.toArray(),
          crumbMarkerVisible: crumbMarker.visible,
          crumbMarkerPos: crumbMarker.position.toArray(),
          crumbPhotoScale: crumbPhoto.scale.toArray(),
          insetCamFrustum: [insetCam.left, insetCam.right, insetCam.top, insetCam.bottom],
        };
      },

      // For the choreography (tools/choreo/loupe.mjs): finds a real "highlight-edge" pixel in the CURRENT
      // render -- a near-saturated pixel with a visibly darker neighbor -- by scanning the render's own rgba,
      // not a hardcoded coordinate (the bokeh highlights' screen position moves with the lens/focus/format).
      findHighlightEdge() {
        const view = currentRender();
        if (!view) throw new Error('loupe.ts hooks.findHighlightEdge: no render yet');
        const lum = (i: number) => 0.2126 * view.rgba[i * 4] + 0.7152 * view.rgba[i * 4 + 1] + 0.0722 * view.rgba[i * 4 + 2];
        // The brightest pixel with a real local gradient (a bokeh highlight's own defocused edge, not a flat
        // saturated field) -- ranked by luma first, tie-broken by edge contrast, rather than a fixed luma
        // threshold: a defocused highlight this far off the focus plane may not reach full 8-bit saturation
        // even while it is still the frame's own brightest, most highlight-like feature.
        let best: { x: number; y: number; lum: number; edge: number } | null = null;
        for (let y = 1; y < view.height - 1; y++) {
          for (let x = 1; x < view.width - 1; x++) {
            const i = y * view.width + x;
            const here = lum(i);
            const edge = Math.max(here - lum(i - 1), here - lum(i + view.width));
            if (edge <= 2) continue; // ignore flat regions entirely -- this hook wants an EDGE, not just bright
            if (!best || here > best.lum || (here === best.lum && edge > best.edge)) best = { x, y, lum: here, edge };
          }
        }
        if (!best) return null;
        return { x: best.x, y: best.y };
      },

      badge() {
        return { ...badge };
      },

      // Reads the numbers straight off the drawn THREE.js meshes, not a recomputation, so this checks what a
      // reader actually sees, not just what the model says (accuracy gate #1).
      drawnFill() {
        return {
          fillHeightUnits: chargeMesh.scale.y,
          wellHeightUnits: WELL_HEIGHT,
          fillFrac: currentPixel ? currentPixel.electrons / currentPixel.fullWell : null,
          chargeColor: (chargeMesh.material as THREE.MeshBasicMaterial).color.toArray(),
        };
      },

      // Determinism (accuracy gate #3): two independent pixelAt() calls for the exact same (renderId, x, y).
      async pixelAtTwice() {
        if (targetRenderId < 0) throw new Error('loupe.ts hooks.pixelAtTwice: no target yet');
        const [a, b] = await Promise.all([
          pixelAt(targetRenderId, targetX, targetY),
          pixelAt(targetRenderId, targetX, targetY),
        ]);
        return { a, b };
      },

      // The noise check (accuracy gate #2): measures the raw DN standard deviation over a flat mid-gray
      // ColorChecker patch in the current render's G channel, and predicts the same figure from the engine's
      // own already-exposed numbers -- see the doc comment on grayPatchNoise below for the derivation.
      grayPatchNoise() { return grayPatchNoise(); },

      probe() {
        return {
          pixel: currentPixel,
          badge: { ...badge },
          drawnFill: {
            fillHeightUnits: chargeMesh.scale.y,
            wellHeightUnits: WELL_HEIGHT,
            emissiveBrightness: (chargeMesh.material as THREE.MeshBasicMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).l,
          },
          noise: grayPatchNoise(),
        };
      },
    },

    dispose() {
      disposed = true; invalidatePixel(); status.remove(); offFailure();
      offPhotonPause(); document.removeEventListener('visibilitychange', hiddenPhotons); photonControls.remove(); rainLaunch.remove(); rainView?.dispose();
      offBusTap();
      offRender();
      window.removeEventListener('keydown', onKeydown);
      if (diveTimer !== null) window.clearTimeout(diveTimer);
      crumb.remove();
      wellEdgeGeo.dispose();
      wellEdgeMat.dispose();
      read.remove();
      domeGeo.dispose();
      domeMat.dispose();
      for (const d of dieParts) d.geometry.dispose();
      dieMat.dispose();
      dieCutMat.dispose();
      ctx.labels.clear('loupe-');
      photoGeo.dispose();
      photoMat.dispose();
      photoTexture.dispose();
      markerGeo.dispose();
      markerMat.dispose();
      crumbMarkerGeo.dispose();
      crumbMarkerMat.dispose();
      bundleGeo.dispose();
      bundleMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      for (const s of sparks) (s.mesh.geometry as THREE.BufferGeometry).dispose?.();
      for (const m of neighborMeshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      microlens.geometry.dispose();
      (microlens.material as THREE.Material).dispose();
      cfaMesh.geometry.dispose();
      (cfaMesh.material as THREE.Material).dispose();
      diodeMesh.geometry.dispose();
      (diodeMesh.material as THREE.Material).dispose();
      for (const child of wellShell.children) (child as THREE.Mesh).geometry.dispose();
      ((wellShell.children[0] as THREE.Mesh).material as THREE.Material).dispose(); // one shared material, 5 walls
      chargeGeo.dispose();
      (chargeMesh.material as THREE.Material).dispose();
    },
  };

  // ---- the gray-patch noise check: measured (from the render's own raw buffer) vs predicted (from the ------
  // ---- model's own already-exposed sensor figures) -----------------------------------------------------------
  //
  // Locates the ColorChecker's "neutral 5 (.70 D)" patch (reflectance ~0.20, the chart's closest neutral to
  // the engine's own 18%-gray convention) by calling the engine's OWN projection function
  // (render.ts's projectToRenderedPixel) on that patch's known world position -- reading where a real object
  // already is, not computing new physics (see the module header's "pieces never compute physics" rule; this
  // is gate-support code, not a drawn visual). The patch's world position is derived the same way
  // colorCheckerBillboard (scenes.ts) itself places patches: billboard center [-550, 0, 3000] mm, 650x500 mm,
  // right = normal x up = [1,0,0] (scene.ts's own convention), row 3 (0-indexed, the bottom/grayscale row),
  // column 3 ("neutral 5").
  function grayPatchNoise(): { measuredSigmaDn: number; predictedSigmaDn: number; cfa: 'G'; n: number } | null {
    if (!currentModel) return null;
    const view = currentRender();
    if (!view) return null;
    const model = currentModel;

    const patchU = (3 + 0.5) / 6 - 0.5;
    const patchV = 0.5 - (3 + 0.5) / 4;
    const worldX = -550 + patchU * 650;
    const worldY = patchV * 500;
    const worldZ = 3000;

    const setup = renderSetup(model, view.width, view.height);
    const { bx, by } = projectToRenderedPixel(setup.efl, setup.blockPitchMm, view.width, view.height, worldX, worldY, worldZ);

    // R=8 (a 17x17 box, comfortably inside this patch's own ~22px content width at the default scenario,
    // found by direct inspection while building this gate) rather than a smaller box: the standard deviation
    // ESTIMATE from N samples itself carries relative uncertainty ~sqrt(2/dof) (a small box's own dof was the
    // dominant source of gate flakiness found while tuning this, not a formula error -- a 61-sample box (dof
    // 58) has ~13% relative uncertainty in its own sigma estimate; this box's ~280+ samples cut that well
    // under half).
    const R = 8;
    const samples: { dx: number; dy: number; v: number }[] = [];
    const cx = Math.round(bx);
    const cy = Math.round(by);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= view.width || y < 0 || y >= view.height) continue;
        if (cfaColorAt('RGGB', x, y) !== 'G') continue;
        samples.push({ dx, dy, v: view.raw[y * view.width + x] });
      }
    }
    if (samples.length < 8) return null;

    // Even a "flat" ColorChecker patch this far off-axis carries a small, real illumination/vignetting
    // gradient across an 11x11-rendered-pixel box (found by direct inspection while building this gate:
    // roughly 0.7-0.9% peak-to-peak, enough on its own to double the naive sample standard deviation above
    // the true shot+read noise). That gradient is real signal structure, not noise, so it has to come out
    // before comparing to a noise prediction -- fit and remove a local linear plane (least squares over the
    // sample's own dx, dy offsets) and measure the RESIDUAL spread, the standard two-point/detrending method
    // for isolating noise from a slow spatial trend in sensor-noise characterization.
    const n = samples.length;
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sv = 0, Sxv = 0, Syv = 0;
    for (const s of samples) {
      Sx += s.dx; Sy += s.dy; Sxx += s.dx * s.dx; Syy += s.dy * s.dy; Sxy += s.dx * s.dy;
      Sv += s.v; Sxv += s.dx * s.v; Syv += s.dy * s.v;
    }
    // Solve the 3x3 normal-equations system [[n,Sx,Sy],[Sx,Sxx,Sxy],[Sy,Sxy,Syy]] * [a,b,c]^T = [Sv,Sxv,Syv]^T
    // by Cramer's rule (a hand-rolled 3x3 solve local to this gate -- not engine code, not reused elsewhere).
    const det3 = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = [[n, Sx, Sy], [Sx, Sxx, Sxy], [Sy, Sxy, Syy]];
    const rhs = [Sv, Sxv, Syv];
    const detM = det3(M);
    let a = n > 0 ? Sv / n : 0, b = 0, c = 0; // fallback: flat mean, if the system is degenerate
    if (Math.abs(detM) > 1e-9) {
      const withCol = (col: number) => M.map((row, i) => row.map((v, j) => (j === col ? rhs[i] : v)));
      a = det3(withCol(0)) / detM;
      b = det3(withCol(1)) / detM;
      c = det3(withCol(2)) / detM;
    }
    let sqResidual = 0;
    for (const s of samples) {
      const fitted = a + b * s.dx + c * s.dy;
      sqResidual += (s.v - fitted) ** 2;
    }
    const dof = Math.max(1, n - 3);
    const measuredSigmaDn = Math.sqrt(sqResidual / dof);
    const mean = a; // the fitted plane's value at the patch center -- this gate's own mean-signal estimate

    // Predicted sigma, entirely from Model's own exposed numbers (no reimplementation of the engine's private
    // SensorSpec): invert the measured MEAN back to electrons via the same gain/black-level readout uses,
    // then apply the same shot+dark+read variance terms sensor.ts's varianceE computes (PRNU's own small
    // quadratic term is the one piece Model does not expose per-pixel and is omitted here -- negligible next
    // to shot+read noise at this signal level; see docs/pieces/loupe.md, "known limits").
    const gain = model.scenario.iso / model.sensor.unityGainIso;
    const blackLevelDn = model.sensor.figs.blackLevelDn?.v ?? 0;
    const meanElectrons = Math.max(0, (mean - blackLevelDn) / gain);
    const darkMeanE = (model.sensor.figs.darkCurrentEPerS?.v ?? 0) * model.scenario.shutter;
    const readNoiseE = model.sensor.readNoiseE;
    // PRNU (sensor.ts's own varianceE term, signalE*(1+p^2) + signalE^2*p^2): Model does not expose the
    // engine's own prnuStdDev per pixel, so this uses the SAME representative figure the engine's data feeds
    // from (data/sensors.json, generic.prnu.typicalPercent: 1.5% RMS, onsemi NOII4SM6600A datasheet -- one
    // concretely cited commercial CMOS sensor's PRNU, used project-wide as the representative value, not
    // reinvented here). At the signal level this patch sits at, PRNU is not negligible next to shot noise
    // (found while building this gate: omitting it left prediction ~30% low), so it is included, not skipped.
    const prnu = 0.015;
    const varianceE = meanElectrons * (1 + prnu * prnu) + meanElectrons * meanElectrons * prnu * prnu + darkMeanE + readNoiseE * readNoiseE;
    const sigmaPerPixelDn = Math.sqrt(varianceE) * gain;
    // raw[] holds each rendered pixel's BLOCK average (render.ts's own doc comment), averaged over the
    // same-CFA-color real pixels in that block -- divide by sqrt(N) to predict the block-averaged sigma.
    const halfBlock = view.pixelScale / 2;
    const nSameColorG = 2 * halfBlock * halfBlock;
    const predictedSigmaDn = sigmaPerPixelDn / Math.sqrt(Math.max(1, nSameColorG));

    return { measuredSigmaDn, predictedSigmaDn, cfa: 'G', n: samples.length };
  }
};
