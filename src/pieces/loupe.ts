import { selectionFrame } from './selection-frame';
import '../styles/photon-rain.css';
// Set piece 9, the loupe: docs/BRIEF.md #9, design/LOOK.md "9. The loupe," docs/PROTOTYPE.md's loupe section.
// The scene is an explicitly controlled 18% neutral sample. Its pixel values come from the engine's sensor
// sampling path, its ray bundle from pointBundle(), and the well fill from electrons/fullWell. It does not
// render or inspect a photograph.
//
// Local Y runs through the pixel stack. Display dimensions are enlarged for legibility.
import * as THREE from 'three/webgpu';
import type { BuildPiece, CameraFrame, Inset, PartCard, PieceProbe } from './types';
import type { Model } from '../engine/model-types';
import type { Fig, RayPath } from '../engine/types';
import { pointBundle } from '../app/engine-api';
import { traceableBins } from './lens/valid-bins';
import { badgeJoin, isPhone } from './phone-frame';
import { cfaColorAt } from '../engine/pipeline';
import { sampleNeutralPixel, type ControlledPixelInfo } from './pixel-sample';

// ---- display constants (local units; never true scale -- the badge always says so) ---------------------------

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
// Stack pins stay outside the view until the controlled pixel sample is available.
const PIN_HIDE = new THREE.Vector3(0, -1e6, 0);

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

// The spark badge summarizes the represented photon count for the controlled sample.
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

/** Labels the controlled target and the number of photons represented by a drawn spark. */
function badgeTextFor(b: { n: number; dotsDrawn: number }): string {
  const sample = 'CONTROLLED 18% GRAY';
  if (b.dotsDrawn === 0) return sample;
  return badgeJoin(sample, `1 DOT = ${fmtInt(b.n)} ${b.n === 1 ? 'PHOTON' : 'PHOTONS'}`);
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
  photonControls.innerHTML = '<button class="btn" type="button" aria-pressed="false">▶ Play photons</button><label><span class="playback-caption">Arriving light<small>Illustrative time · drag to inspect</small></span><input type="range" min="0" max="1000" value="0" aria-label="Photon animation phase"></label><span>Illustrative packets<br>Not individual real-time photons</span>';
  document.getElementById('model-experiments')!.before(photonControls);
  const photonButton = photonControls.querySelector('button')!, photonRange = photonControls.querySelector('input')!;
  const rainLaunch = document.createElement('button'); rainLaunch.type = 'button'; rainLaunch.className = 'btn rain-launch';
  rainLaunch.textContent = 'Photon rain & noise'; rainLaunch.hidden = true; photonControls.before(rainLaunch);
  let rainView: ReturnType<typeof import('../app/photon-rain').createPhotonRain> | null = null;
  let cancelRainOpening: (() => void) | null = null;
  rainLaunch.onclick = async () => {
    if (!currentModel || rainLaunch.disabled) return;
    pausePhotons(); rainLaunch.disabled = true;
    let canceled = false;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const cancel = () => { canceled = true; document.removeEventListener('keydown', onEscape, true); };
    cancelRainOpening = cancel;
    document.addEventListener('keydown', onEscape, true);
    try {
      // Reopening an existing dialog is synchronous. A cold lazy import may
      // finish after Escape or a trip to another level; do not resurrect it.
      if (!rainView) {
        const { createPhotonRain } = await import('../app/photon-rain');
        if (canceled || disposed || !group.visible) return;
        rainView = createPhotonRain();
      }
      if (!canceled && !disposed && group.visible) rainView.open(currentModel, rainLaunch);
    } catch (error) { console.error('Photon rain could not open', error); rainLaunch.textContent = 'Retry photon rain'; }
    finally {
      document.removeEventListener('keydown', onEscape, true);
      if (cancelRainOpening === cancel) cancelRainOpening = null;
      rainLaunch.disabled = false;
    }
  };
  let photonPlaying = false, photonTime = 0;
  const pausePhotons = () => { photonPlaying = false; photonButton.setAttribute('aria-pressed', 'false'); photonButton.textContent = photonTime > 0 ? '▶ Resume photons' : '▶ Play photons'; };
  photonButton.onclick = () => { if (photonPlaying) pausePhotons(); else { photonPlaying = true; photonButton.textContent = 'Ⅱ Pause photons'; photonButton.setAttribute('aria-pressed', 'true'); } };
  photonRange.oninput = () => { photonTime = Number(photonRange.value) / 1000 * SPARK_FALL_MS; pausePhotons(); };
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
  let targetX = -1;
  let targetY = -1;
  let currentPixel: ControlledPixelInfo | null = null;
  let currentModel: Model | null = null;
  let currentBundlePaths: RayPath[] = [];
  let badge: BadgeInfo = { n: 1, dotsDrawn: 0, photonsMean: 0 };
  const badgeText = () => badgeTextFor(badge);
  let fetchSeq = 0;
  let disposed = false;
  let pendingPixel = false;
  let pixelError = '';
  const status = document.createElement('div');
  status.className = 'lv-read lv-status';
  status.setAttribute('role', 'status');
  const statusText = document.createElement('p');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Retry pixel';
  retry.onclick = () => refreshPixel();
  status.append(statusText, retry); ctx.overlay.appendChild(status);

  function invalidatePixel(): void {
    fetchSeq++; pendingPixel = false; currentPixel = null; currentBundlePaths = [];
    pausePhotons();
    badge = { n: 1, dotsDrawn: 0, photonsMean: 0 };
    bundleGeo.setDrawRange(0, 0);
    syncBackButton();
  }

  function updateGridColors(cfa: 'R' | 'G' | 'B'): void {
    // Bayer colors around the sampled native pixel follow cfaColorAt directly, rather than an assumed pattern.
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
    if (disposed || !group.visible || !currentModel) return;
    const seq = ++fetchSeq;
    pendingPixel = true; pixelError = ''; currentPixel = null; syncBackButton();
    Promise.resolve().then(() => sampleNeutralPixel(currentModel!, seq)).then((info) => {
      if (disposed || !group.visible || seq !== fetchSeq) return;
      pendingPixel = false; currentPixel = info; targetX = info.x; targetY = info.y;
      applyPixel();
    }).catch(() => {
      if (disposed || seq !== fetchSeq) return;
      pendingPixel = false; pixelError = 'The controlled pixel sample could not be calculated. Retry the sample.';
      syncBackButton();
    });
  }

  function clearSelection(): void {
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
  const read = document.createElement('div');
  read.className = 'lv-read';
  read.hidden = true;
  // One evidence chip for the whole reading (R2-08): every row is worked out by the engine for this pixel, the
  // same "Calc." the part cards give these numbers.
  read.innerHTML = `<div class="lv-read-h"><p class="lv-ctl-k">Reference pixel</p><span class="chip derived" title="Calculated by the engine for this pixel">Calc.</span></div>
    <p class="lv-read-condition" data-k="conditions"></p>
    <div class="lv-read-row"><span title="Expected photon arrivals; actual arrivals vary">Expected photons</span><b data-k="photons"></b></div>
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
    const ready = !!currentPixel;
    const waiting = active && !ready && !pixelError;
    const label = 'Sampling a controlled neutral pixel…';
    const nextLoading = waiting ? label : '';
    if (nextLoading !== loadingState) {
      loadingState = nextLoading;
      ctx.bus.emit('piece-loading', { id: 'loupe', loading: waiting, label, progress: 0.5 });
    }
    // The shared central veil explains pending work and holds numbered pins. An
    // error replaces it with a centered, actionable message rather than an empty
    // scene or an old pixel presented as if it belonged to the current settings.
    status.hidden = !active || !pixelError;
    statusText.textContent = pixelError;
    retry.hidden = !pixelError;
    retry.disabled = pendingPixel;
    photonControls.hidden = !group.visible || !ready;
    gridGroup.visible = ready;

    read.hidden = !currentPixel || pickedOnPhone;
    if (currentPixel) {
      const scenario = currentModel!.scenario;
      const shutterLabel = scenario.shutter < 1 ? `1/${Math.round(1 / scenario.shutter)} s` : `${fmtNum(scenario.shutter, 2)} s`;
      readOut('conditions').textContent = `18% gray · ${fmtNum(currentPixel.sample.lux, 0)} lux · ${fmtInt(currentPixel.sample.cctK)} K daylight · f/${fmtNum(scenario.fno, 1)} · ${shutterLabel} · ISO ${fmtInt(scenario.iso)} · ${currentPixel.sample.distanceMm === null ? 'infinity focus' : `${fmtNum(currentPixel.sample.distanceMm / 1000, 2)} m focus`}`;
      const frac = Math.max(0, Math.min(1, currentPixel.electrons / currentPixel.fullWell));
      readOut('photons').textContent = fmtInt(currentPixel.photonsMean);
      readOut('electrons').textContent = fmtInt(currentPixel.electrons);
      readOut('fill').textContent = `${fmtNum(frac * 100, 1)}%`;
      readOut('dn').textContent = fmtInt(currentPixel.dn);
      readOut('dn').title = 'Digital output code after gain and analog-to-digital conversion';
      readWell.style.width = `${(frac * 100).toFixed(1)}%`;
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') clearSelection();
  }



  // ---- probes -------------------------------------------------------------------------------------------------
  function selectedProbeSync(): void { /* probes read closure state live; nothing to push */ }

  const probes: PieceProbe[] = [
    {
      id: 'pixel',
      label: 'The controlled pixel sample',
      anchor: new THREE.Vector3(TARGET_HALF, CFA_TOP_Y, -TARGET_HALF),
      card(): PartCard {
        const p = currentPixel;
        return {
          kicker: 'Level 4 · the pixel',
          title: p ? `Row ${fmtInt(p.y)}, column ${fmtInt(p.x)}` : 'Waiting for the render…',
          body: 'A central sensor pixel sampling a controlled 18% neutral target under the model illuminant. ' +
            'The raw digital number is read before demosaic, white balance or the color matrix.',
          specs: p ? [
            { k: 'Row / column', v: `${fmtInt(p.y)} / ${fmtInt(p.x)}` },
            { k: 'Filter color', v: CFA_NAME[p.cfa][0].toUpperCase() + CFA_NAME[p.cfa].slice(1) },
            { k: 'Raw DN', v: fmtInt(p.dn), fig: fig(p.dn, 'DN', 'derived', 'sensor.ts samplePixel(): sensor readout with sampled read noise') },
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
  // Move anchors into view as soon as the sample resolves, without losing their real positions.
  const realAnchors = new Map(probes.map((p) => [p.id, p.anchor.clone()]));

  // ---- PieceHandle ----------------------------------------------------------------------------------------

  return {
    group,

    update(model, _scenario) {
      if (currentModel && JSON.stringify(currentModel.scenario) !== JSON.stringify(model.scenario)) {
        invalidatePixel(); pixelError = '';
      }
      currentModel = model;
      if (!currentPixel && !pendingPixel) refreshPixel();
      syncBackButton();
      if (currentPixel) ctx.badge.show(badgeText());
      else ctx.badge.hide();
    },

    frame() { return wellFrame(); },

    probes,

    tick(dtMs) {
      if (document.hidden || ctx.renderer.domElement.inert || document.querySelector('dialog[open]')) pausePhotons();
      if (photonPlaying) { photonTime = (photonTime + Math.min(dtMs, 100)) % SPARK_FALL_MS; photonRange.value = String(Math.round(1000 * photonTime / SPARK_FALL_MS)); }
      // Park stack pins off-screen until the controlled pixel sample is ready.
      const showPins = !!currentPixel;
      for (const p of probes) {
        const real = realAnchors.get(p.id);
        if (real) p.anchor.copy(showPins ? real : PIN_HIDE);
      }
      // The charge fill draws without a depth test (see updateWellFill), so while the camera is still above the
      // The charge fill has no depth test, so show it only with a resolved sample.
      chargeMesh.visible = !!currentPixel;
      // Photon sparks: a small pool falling on a fixed cycle from just above the microlens down to its apex.
      for (const s of sparks) {
        const t = ((photonTime + s.phaseMs) % SPARK_FALL_MS) / SPARK_FALL_MS;
        s.mesh.position.y = THREE.MathUtils.lerp(SPARK_SPAWN_Y, MICROLENS_APEX_Y, t);
        s.mesh.visible = !!currentPixel;
      }
      // Reassert the controlled-sample badge while the pixel is available.
      if (currentPixel) ctx.badge.show(badgeText());
      else ctx.badge.hide();
    },

    insets(): Inset[] {
      return [];
    },

    select(id) {
      pickedOnPhone = !!id && isPhone();
      syncBackButton();
    },
    selectionFrame(id) {
      const anchor = realAnchors.get(id);
      return anchor
        ? selectionFrame(wellFrame(), group.localToWorld(anchor.clone()))
        : this.frame();
    },

    activate() {
      if (!currentPixel && !pendingPixel) refreshPixel();
      syncBackButton();
      window.addEventListener('keydown', onKeydown);
    },

    deactivate() {
      cancelRainOpening?.();
      rainLaunch.hidden = true; rainView?.close();
      pausePhotons(); photonControls.hidden = true;
      invalidatePixel(); status.hidden = true;
      window.removeEventListener('keydown', onKeydown);
      pickedOnPhone = false;
    },
    onViewInteraction() {},

    hooks: {
      photons: () => ({ playing: photonPlaying, phase: photonTime / SPARK_FALL_MS }),
      // Test/accuracy-gate surface: window.p2p.pieces.loupe.<name>(...). See tools/accuracy/loupe.mjs.
      sample() { if (!currentModel) throw new Error('loupe.ts hooks.sample: model not ready'); refreshPixel(); return currentPixel; },

      // The Back control, for the choreography (tools/choreo/loupe.mjs) to drive without a real DOM click.
      back() {
        clearSelection();
      },

      state() {
        return { targetX, targetY, hasPixel: currentPixel !== null, pendingPixel, pixelError };
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
        };
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

      // Determinism check: repeat the same seeded controlled-pixel sample twice.
      async sampleTwice() {
        if (!currentModel) throw new Error('loupe.ts hooks.sampleTwice: model not ready');
        const [a, b] = await Promise.all([
          Promise.resolve().then(() => sampleNeutralPixel(currentModel!, 1)),
          Promise.resolve().then(() => sampleNeutralPixel(currentModel!, 1)),
        ]);
        return { a, b };
      },

      probe() {
        return {
          pixel: currentPixel,
          badge: { ...badge },
          drawnFill: {
            fillHeightUnits: chargeMesh.scale.y,
            wellHeightUnits: WELL_HEIGHT,
            emissiveBrightness: (chargeMesh.material as THREE.MeshBasicMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).l,
          },
        };
      },
    },

    dispose() {
      cancelRainOpening?.();
      disposed = true; invalidatePixel(); status.remove();
      offPhotonPause(); document.removeEventListener('visibilitychange', hiddenPhotons); photonControls.remove(); rainLaunch.remove(); rainView?.dispose();
      window.removeEventListener('keydown', onKeydown);
      wellEdgeGeo.dispose();
      wellEdgeMat.dispose();
      read.remove();
      domeGeo.dispose();
      domeMat.dispose();
      for (const d of dieParts) d.geometry.dispose();
      dieMat.dispose();
      dieCutMat.dispose();
      ctx.labels.clear('loupe-');
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

};
