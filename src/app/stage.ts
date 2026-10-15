// The WebGPU/WebGL2 renderer, camera rig, PMREM environment, resize/off-screen pause, quality tier, and the
// pin/HUD label overlay projection -- docs/PROTOTYPE.md's "src/app/stage.ts" and "Rendering decisions".
//
// Direct renderer.render(scene, camera), no RenderPipeline/EffectComposer in this prototype (docs/PROTOTYPE.md).
// `?gl=webgl2` forces the WebGL2 backend; the real backend obtained is always reported truthfully, even when it
// silently differs from what was asked for (the same "silent fallback" gotcha the rendering spike names).
import * as THREE from 'three/webgpu';
import '../styles/model-polish.css';
import '../styles/type-floor.css';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import type { BuildPiece, CameraFrame, Inset, LabelLayer, PieceHandle, PieceProbe, ScaleBadge } from '../pieces/types';
import * as look from './look';
import * as bus from './bus';
import { upperKeepMicro } from './units';
import { spreadPins } from './pin-layout';
import { fixDoublePassCompile } from '../scene/compile-steps';
import { softwareRendererName } from './software-gl';

/** A narrow HUD may wrap between readings, never between a number and its unit ("1/250" then a lone "S"), and a
 *  separator dot travels with the reading after it rather than dangling at a line's end (as badgeJoin does). */
const glueUnits = (s: string) => s.replace(/(\d) (?=[A-Zµ])/g, '$1 ').replace(/ · /g, ' · ');

export type Backend = 'webgpu' | 'webgl2';
export type QualityTier = 'phone' | 'mid' | 'high';

export interface StageDom {
  canvas: HTMLCanvasElement;
  view: HTMLElement;
  pins: HTMLElement;
  veil: HTMLElement;
  hudTitle: HTMLElement;
  hudSub: HTMLElement;
  scaleLabel: HTMLElement;
  scaleBar: HTMLElement;
  scaleBadge: HTMLElement;
  backendChip: HTMLElement;
}

export interface PinScreen {
  id: string;
  label: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  on: boolean;
}

export interface Stage {
  registerPiece(id: string, build: BuildPiece): void;
  showPiece(id: string, title: string, sub: string): void;
  /** A level tap, announced before its work runs (score loop r5): a first visit's view is dimmed with the loading veil
   *  in the next paint, so the press is answered while the level builds and compiles in the task after it. */
  announceEntry(id: string): void;
  update(model: Model, scenario: Scenario): void;
  resetView(): void;
  /** One 10° step of the model's orbit, for a tap (score loop r4): across -1 or 1 turns it, vertical -1 or 1 tips it. */
  orbit(across: -1 | 0 | 1, vertical: -1 | 0 | 1): void;
  selectPin(id: string | null): void;
  backend(): Backend;
  qualityTier(): QualityTier;
  gpuIdle(): Promise<void>;
  settle(): Promise<void>;
  pins(): PinScreen[];
  framing(): { piece: string | null; selected: string | null; position: number[]; target: number[]; moving: boolean };
  /** The renderer's cached node builds and pipelines (score loop r5), for the gate that a level built ahead costs its first
   *  visit none: null when this three version keeps them elsewhere. */
  pipelineStats(): { builders: number; pipelines: number; drawCalls: number } | null;
  /** Render on demand: animation frames seen, frames drawn, and why each was drawn (score loop r2). */
  drawStats(): { frames: number; draws: number; ms: number; why: Record<string, number> };
  /** The active piece's probes (its numbered parts), for the right panel. */
  activeProbes(): PieceProbe[];
  /** A piece's test and accuracy-gate hooks (building it if needed): window.p2p.pieces[id]. */
  pieceHooks(id: string): Record<string, (...args: any[]) => any>;
  dispose(): void;
}

const DIVE_CURVE = [0.65, 0, 0.35, 1] as const; // design/LOOK.md, "Dive between scale levels"
const DIVE_BASE_MS = 900;
const DIVE_PER_DECADE_MS = 220;
const DIVE_MAX_MS = 2400;

function cubicBezier1D([, y1, , y2]: readonly [number, number, number, number]) {
  // A monotonic-enough easing approximation of a cubic-bezier timing function's y(t) for t in x (both endpoints
  // pinned at 0,0 and 1,1, as every CSS cubic-bezier() timing function is): De Casteljau on (0,0)-(x1,y1)-
  // (x2,y2)-(1,1) evaluated at parameter t directly (x is not solved for -- close enough for a camera ease that
  // only has to look right, not for a UI transform CSS itself already handles exactly).
  return (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
  };
}
const diveEase = cubicBezier1D(DIVE_CURVE);

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export async function createStage(dom: StageDom): Promise<Stage> {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const forceWebGL = params.get('gl') === 'webgl2';

  // A browser with no WebGPU falls back to WebGL2 by design, and the backend chip says which one is drawing; three warns about it
  // on every such visit (score loop r5: a console warning on every fallback visit, for a condition the reader cannot act on).
  // Every other three message goes to the console as it would have.
  const previousConsole = THREE.getConsoleFunction();
  THREE.setConsoleFunction((type: 'error' | 'log' | 'warn', message: string, ...rest: unknown[]) => {
    if (type === 'warn' && /WebGPURenderer: WebGPU is not available/.test(String(message))) return;
    if (previousConsole) { previousConsole(type, message, ...rest); return; }
    const trace = rest[0] as { isStackTrace?: boolean; getError?: (m: string) => unknown } | undefined;
    const log = (console as unknown as Record<string, (...a: unknown[]) => void>)[type] ?? console.log;
    if (trace?.isStackTrace && trace.getError) log.call(console, trace.getError(message)); else log.call(console, message, ...rest);
  });
  const renderer = new THREE.WebGPURenderer({ canvas: dom.canvas, antialias: true, forceWebGL });
  await renderer.init();
  fixDoublePassCompile(renderer);
  const backendKind: Backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';
  // With no GPU the 3D view is drawn on the CPU (SwiftShader, llvmpipe): about 2 frames a second here. The picture stays as it
  // is, drawn at one pixel to the pixel and from the lowest quality tier, and the reader is told why and offered the 2D reference.
  const software = softwareRendererName(renderer.backend as Parameters<typeof softwareRendererName>[0]);
  if (software) {
    const note = document.createElement('div');
    note.className = 'soft-note'; note.setAttribute('role', 'status');
    note.innerHTML = '<span>This browser is drawing the 3D view with software, not a graphics card, so the camera will move slowly.</span> <a href="reference.html">Read the 2D reference</a> <button type="button" aria-label="Dismiss this note">Dismiss</button>';
    note.querySelector('button')!.addEventListener('click', () => note.remove());
    dom.view.append(note);
  }
  dom.backendChip.textContent = backendKind === 'webgpu' ? 'WEBGPU' : 'WEBGL2';
  dom.backendChip.classList.toggle('webgl2', backendKind === 'webgl2');
  dom.backendChip.prepend((() => { const d = document.createElement('i'); d.className = 'dot2'; return d; })());

  const scene = new THREE.Scene();
  // design/LOOK.md --ground (#000): every 3D view stands in the same black void (score loop r1: the deep dives read
  // navy (8,13,20) beside the black camera level, the ghosted views and the landing page)
  scene.background = new THREE.Color('#000000');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
  camera.position.set(0, 25, 140);
  // The zoom buttons' own limits: the camera's near/far follow the viewing distance (fitDepthRange below), so they no
  // longer bound it.
  const MIN_VIEW_DISTANCE = 0.04, MAX_VIEW_DISTANCE = 80000;
  const controls = new OrbitControls(camera as unknown as THREE.Camera, dom.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // This is a fixed workspace: plain wheel and trackpad pinch belong to the model.
  // OrbitControls consumes them only over the canvas; settings retain their own scroll.
  controls.zoomSpeed = 0.8;

  // ---- procedural PMREM environment + key/fill lights (design/LOOK.md: "not a photographic HDRI") -------------
  // Factored into look.ts (09/28/2026, lens-exteriors workstream) so src/scene/lens-preview.ts's standalone
  // page gets the exact same look without a second hand-copy of this geometry/color logic.
  const pmrem = look.buildEnvironmentAndLights(renderer, scene);
  // the state a deep level is shown in (the camera level swaps in its studio environment and tone mapping on activate)
  const levelEnvironment = scene.environment, levelToneMapping = renderer.toneMapping, levelExposure = renderer.toneMappingExposure;

  // ---- render on demand (score loop r2) -------------------------------------------------------------------------
  // A frame is drawn only when something can have changed the picture: the orbit controls moved (including their
  // damping), a dive is flying, the active piece's tick() animated, the size or the chrome's layout changed, a model or
  // app event arrived, the reader touched the page, or a test hook ran. invalidate() keeps drawing for a short window
  // after such an event, so late layout and one-frame-late state settle into the picture; a frame every SAFETY_MS
  // catches anything that changed without saying so. At rest the main thread was 47 to 61% busy on desktop and 95 to
  // 98% on a 4x-throttled phone redrawing an unchanged scene (r2 review); see docs/score-loop/r2-perf.md.
  const SAFETY_MS = 1000;
  let drawUntil = 0;
  function invalidate(ms = 250) { drawUntil = Math.max(drawUntil, performance.now() + ms); wake(); }
  // With nothing to draw for a moment the loop itself stops (the piece ticks, the chrome measure and three's own
  // per-frame bookkeeping cost 0.3 to 0.5 ms a frame, at 60 to 240 frames a second), and a timer brings one frame back
  // every SAFETY_MS. invalidate() restarts it at once.
  // three's renderer runs its own requestAnimationFrame loop from init() on, whether or not a callback is set, and
  // advances its node frame on every tick; stopping that loop is what lets the page go quiet. Its start() runs one
  // frame synchronously, so it is restarted from the next animation frame, never inside an event or a piece's update.
  const animation = (renderer as unknown as { _animation?: { start(): void; stop(): void } })._animation;
  let sleeping = false, sleepTimer = 0;
  function sleep() {
    if (sleeping || !running || !animation) return;
    sleeping = true;
    drewLastFrame = false;
    animation.stop();
    sleepTimer = window.setTimeout(() => wake(), SAFETY_MS);
  }
  function wake() {
    if (!sleeping) return;
    sleeping = false;
    window.clearTimeout(sleepTimer);
    requestAnimationFrame(() => {
      if (sleeping || graphicsLost) return;
      lastFrameTime = performance.now();
      animation?.start();
    });
  }
  let lastInputAt = performance.now();
  const onInput = () => { lastInputAt = performance.now(); abortWarmStep(); invalidate(400); };
  const onTouch = () => { lastInputAt = performance.now(); abortWarmStep(); };
  for (const name of ['touchstart', 'pointermove', 'scroll'] as const) document.addEventListener(name, onTouch, { capture: true, passive: true });
  const inputEvents = ['pointerdown', 'pointerup', 'click', 'input', 'change', 'keydown', 'wheel', 'transitionend'] as const;
  for (const name of inputEvents) document.addEventListener(name, onInput, { capture: true, passive: true });
  // the camera's hover highlight follows the pointer over the view
  const onViewPointer = () => invalidate(150);
  dom.view.addEventListener('pointermove', onViewPointer, { passive: true });
  const offAnyEvent = bus.onAny(() => invalidate(400));

  // ---- pieces ----------------------------------------------------------------------------------------------
  const builders = new Map<string, BuildPiece>();
  const built = new Map<string, PieceHandle>();
  let activeId: string | null = null;

  const labelEls = new Map<string, HTMLElement>();
  /** An idle update of a level that is not shown (warmLevels) must leave the shared labels and scale badge alone. */
  let quietChrome = false;
  const labels: LabelLayer = {
    set(id, opts) {
      if (quietChrome) return;
      let el = labelEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hud-label';
        el.style.cssText = 'position:absolute;left:0;top:0;font:600 11px/1.15 var(--mono);letter-spacing:.06em;' +
          'text-transform:uppercase;color:var(--ink);text-shadow:0 1px 6px #000,0 0 2px #000;white-space:nowrap;' +
          'pointer-events:none;transform:translate(-50%,-140%);';
        dom.pins.appendChild(el);
        labelEls.set(id, el);
      }
      el.textContent = opts.text;
      (el as HTMLElement & { _world?: THREE.Vector3 })._world = opts.world;
      invalidate();
    },
    remove(id) {
      if (quietChrome) return;
      const el = labelEls.get(id);
      if (el) { el.remove(); labelEls.delete(id); invalidate(); }
    },
    clear(prefix) {
      if (quietChrome) return;
      for (const [id, el] of labelEls) {
        if (!prefix || id.startsWith(prefix)) { el.remove(); labelEls.delete(id); invalidate(); }
      }
    },
  };

  const badge: ScaleBadge = {
    show(text) {
      if (quietChrome) return;
      if (dom.scaleBadge.textContent !== text) {
        // Each badgeJoin phrase in its own unbreakable span with the separator between them, so a phone can stack the
        // phrases one per line and drop the dot instead of opening a line with a lone "·" (score loop r1). The
        // badge's textContent stays exactly the joined text.
        const sep = ` ·${String.fromCharCode(0xa0)}`;
        dom.scaleBadge.replaceChildren(...text.split(sep).flatMap((phrase, i) => {
          const p = document.createElement('span'); p.className = 'badge-phrase'; p.textContent = phrase;
          if (!i) return [p];
          const d = document.createElement('span'); d.className = 'badge-sep'; d.textContent = sep;
          return [d, p];
        }));
      }
      dom.scaleBadge.hidden = false;
    },
    hide() { if (!quietChrome) dom.scaleBadge.hidden = true; },
  };

  // One overlay layer per piece inside the view, for a piece's own small controls; shown only with its piece.
  const overlays = new Map<string, HTMLElement>();
  function pieceOverlay(id: string): HTMLElement {
    let el = overlays.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'piece-overlay';
      el.dataset.piece = id;
      el.hidden = true;
      dom.view.appendChild(el);
      overlays.set(id, el);
    }
    return el;
  }

  // Inset frames (a border and a mono caption) drawn over the scissored viewports.
  const insetEls = new Map<string, HTMLElement>();
  function syncInsetFrames(list: Inset[]) {
    const keep = new Set(list.map((i) => i.id));
    for (const [id, el] of insetEls) if (!keep.has(id)) { el.remove(); insetEls.delete(id); }
    for (const inset of list) {
      let el = insetEls.get(inset.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'inset-frame';
        const label = document.createElement('span');
        label.className = 'inset-label';
        el.append(label);
        dom.view.appendChild(el);
        insetEls.set(inset.id, el);
      }
      const r = inset.rect;
      el.style.left = `${r.left}px`;
      el.style.bottom = `${r.bottom}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.dataset.label = inset.label ?? '';
      const labelEl = el.firstElementChild as HTMLElement;
      if (labelEl.textContent !== (inset.label ?? '')) labelEl.textContent = inset.label ?? '';
    }
  }

  function ensureBuilt(id: string): PieceHandle {
    let handle = built.get(id);
    if (!handle) {
      const build = builders.get(id);
      if (!build) throw new Error(`stage.ts: no piece registered for "${id}"`);
      performance.mark(`p2p:build-${id}`);
      handle = build({ renderer, look, labels, badge, camera, scene, overlay: pieceOverlay(id), dive: (to) => {
        if (activeId === id) startDive(selectedFrame(built.get(id), to));
      }, bus, invalidate: () => invalidate() });
      handle.group.visible = false;
      scene.add(handle.group);
      built.set(id, handle);
      performance.mark(`p2p:built-${id}`);
    }
    return handle;
  }

  // ---- pins (from the active piece's probes) -----------------------------------------------------------------
  const pinEls = new Map<string, HTMLButtonElement>();
  const pinAnchors = new Map<string, { x: number; y: number }>();
  let selectedPin: string | null = null;
  let hoveredPin: string | null = null;
  /** The hover came from the model itself, whose tooltip already names the part: its pin shows no second label (score loop r6). */
  let hoverFromModel = false;
  let focusedPin: string | null = null;

  function selectedFrame(handle: PieceHandle | undefined, fallback: CameraFrame): CameraFrame {
    return selectedPin && handle?.selectionFrame ? handle.selectionFrame(selectedPin) : fallback;
  }

  function syncPinEls(handle: PieceHandle | null) {
    hoveredPin = focusedPin = null;
    pinAnchors.clear();
    for (const [id, el] of pinEls) { el.remove(); pinEls.delete(id); }
    if (!handle) return;
    handle.probes.forEach((probe, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin';
      el.dataset.pinId = probe.id;
      el.innerHTML = `<i class="pin-leader" aria-hidden="true"></i><span class="num">${i + 1}</span><span class="lbl">${probe.label}</span>`;
      el.setAttribute('aria-label', `${i + 1}. ${probe.label}`);
      const refreshLabel = () => { projectLabelsAndPins(false); start(); };
      el.addEventListener('pointerenter', () => { hoveredPin = probe.id; hoverFromModel = false; refreshLabel(); });
      el.addEventListener('pointerleave', () => { if (hoveredPin === probe.id) hoveredPin = null; refreshLabel(); });
      el.addEventListener('focus', () => { focusedPin = probe.id; refreshLabel(); });
      el.addEventListener('blur', () => { if (focusedPin === probe.id) focusedPin = null; refreshLabel(); });
      el.addEventListener('click', () => {
        const id = selectedPin === probe.id ? null : probe.id;
        stage.selectPin(id);
        bus.emit('select-part', { id });
      });
      dom.pins.appendChild(el);
      pinEls.set(probe.id, el);
    });
  }

  // A tap on the model itself picks the part under it, as that part's pin does; hovering one shows its pin's name.
  bus.on('pick-part', (e) => {
    if (e.id === selectedPin) return;
    stage.selectPin(e.id);
    bus.emit('select-part', { id: e.id });
  });
  bus.on('hover-part', (e) => { hoveredPin = e.id; hoverFromModel = !!e.id; projectLabelsAndPins(false); start(); });

  // ---- camera dive between pieces --------------------------------------------------------------------------
  let diveFrom: CameraFrame | null = null;
  let diveTo: CameraFrame | null = null;
  let diveStart = 0;
  let diveMs = 0;
  let manuallyMoved = false;
  let resizeFrame = false;
  // Pieces use unrelated scene units/origins. Entry (including its first model update)
  // must establish the incoming frame before drawing; only moves within it can fly.
  let enteringPiece = false;
  controls.addEventListener('change', () => invalidate());
  controls.addEventListener('start', () => {
    diveTo = null;
    manuallyMoved = true;
    if (activeId) built.get(activeId)?.onViewInteraction?.();
  });
  function zoomBy(factor: number) {
    if (dom.view.clientWidth === 0 || !activeId) return;
    diveTo = null; manuallyMoved = true;
    built.get(activeId)?.onViewInteraction?.();
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.max(MIN_VIEW_DISTANCE, Math.min(MAX_VIEW_DISTANCE, offset.length() * factor));
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update(); start();
  }
  const zoomIn = () => zoomBy(0.8), zoomOut = () => zoomBy(1.25);
  const zoomKeys = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (['+', '=', '-', '_'].includes(event.key)) {
      event.preventDefault(); zoomBy(event.key === '-' || event.key === '_' ? 1.25 : 0.8);
    }
  };
  /** A keyboard orbit (score loop r3): the drag's rotation, in 10° steps around the same target. */
  function orbitBy(azimuth: number, polar: number) {
    if (dom.view.clientWidth === 0 || !activeId) return;
    diveTo = null; manuallyMoved = true;
    built.get(activeId)?.onViewInteraction?.();
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    spherical.theta += azimuth;
    spherical.phi = Math.min(Math.min(controls.maxPolarAngle, Math.PI - 0.05), Math.max(Math.max(controls.minPolarAngle, 0.05), spherical.phi + polar));
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update(); start();
  }
  const ORBIT_STEP = Math.PI / 18;
  // On the focused model, Up and Down tip it and Shift with the arrows turns it; the plain left and right arrows stay
  // with part stepping (ui.ts). The canvas's accessible name lists these keys.
  const orbitKeys = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const across = event.shiftKey ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0) : 0;
    if (!vertical && !across) return;
    event.preventDefault();
    orbitBy(across * ORBIT_STEP, vertical * ORBIT_STEP);
  };
  document.getElementById('zoom-in')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out')?.addEventListener('click', zoomOut);
  dom.canvas.addEventListener('keydown', zoomKeys);
  dom.canvas.addEventListener('keydown', orbitKeys);

  /** The view size the active level's frame was last fitted for. The level's own frame reads the view's size, and a
   *  level change reshapes the view (the level's prompt, its inset legend) after showPiece has fitted the camera, so a
   *  size that settles somewhere else re-fits the frame even when it equals the last drawn size (score loop r4: Optics
   *  at 390 px was framed for a 342 px view that settled at 299 px, and the framing never followed). */
  let framedW = 0, framedH = 0;
  let framedCard = -2; // where the level's control card stood when the frame was last fitted (-1: none shown; -2: not measured yet)
  /** The camera's aspect follows the view the moment a level is entered, not at the next draw: a frame fitted by aspect
   *  (the desktop cutaway) must read the same size the view has now. The drawing buffer still resizes in drawFrame. */
  function syncAspect() {
    const w = dom.view.clientWidth, h = dom.view.clientHeight;
    if (!w || !h || camera.aspect === w / h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function startDive(to: CameraFrame) {
    if (![...to.position.toArray(), ...to.target.toArray()].every(Number.isFinite)) return;
    framedW = dom.view.clientWidth; framedH = dom.view.clientHeight;
    invalidate();
    // Flush orbit/pan damping before a guided move. Otherwise controls.update() keeps pulling it off target.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    manuallyMoved = false;
    if (enteringPiece || reducedMotion()) {
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      controls.update();
      camera.updateMatrixWorld(true);
      diveTo = null;
      return;
    }
    const distFrom = camera.position.distanceTo(controls.target) || 1;
    const distTo = to.position.distanceTo(to.target) || 1;
    const decades = Math.abs(Math.log10(distTo / distFrom));
    diveMs = Math.min(DIVE_MAX_MS, DIVE_BASE_MS + DIVE_PER_DECADE_MS * decades);
    diveFrom = { position: camera.position.clone(), target: controls.target.clone() };
    diveTo = { position: to.position.clone(), target: to.target.clone() };
    diveStart = performance.now();
  }

  function tickDive(now: number) {
    if (!diveTo || !diveFrom) return;
    const t = Math.max(0, Math.min(1, (now - diveStart) / diveMs));
    const e = diveEase(t);
    camera.position.lerpVectors(diveFrom.position, diveTo.position, e);
    controls.target.lerpVectors(diveFrom.target, diveTo.target, e);
    if (t >= 1) diveTo = null;
  }

  // ---- resize, DPR cap by quality tier, off-screen pause -----------------------------------------------------
  let tier: QualityTier = software ? 'phone' : 'high';
  function pixelRatioCap(): number {
    if (software) return 1;
    // A phone-width view starts at 2x at most: a 3x phone drew 975 x 935 pixels for a 390 x 374 canvas, with
    // transmission glass, before the governor's 90 slow frames could step it down (score loop r1).
    // A phone on the WebGL2 fallback (no WebGPU: many current iOS and Android browsers) starts at 1.5x: per frame it
    // costs about three times what WebGPU does (r2 review: 55 ms of main thread per frame at 4x CPU against 17 ms).
    const phoneCap = (dom.view.clientWidth || window.innerWidth) <= 760 ? (backendKind === 'webgl2' ? 1.5 : 2) : Infinity;
    return Math.min(phoneCap, tier === 'phone' ? 1.5 : tier === 'mid' ? 2 : Math.min(2.5, window.devicePixelRatio || 1));
  }
  let forceMeasure = true;   // set on resize: the insets and the lens shift are measured again on the next frame
  let renderWidth = 0, renderHeight = 0, renderRatio = 0;
  let sizeDirty = true;
  function applySize() {
    const w = dom.view.clientWidth;
    const h = dom.view.clientHeight;
    if (!w || !h) return; // Keep the valid framebuffer while another workspace tab is active.
    const ratio = Math.min(window.devicePixelRatio || 1, pixelRatioCap());
    sizeDirty = false;
    if (renderWidth === w && renderHeight === h && renderRatio === ratio) return;
    renderWidth = w; renderHeight = h; renderRatio = ratio;
    camera.aspect = w / h;
    resizeFrame = true;
    forceMeasure = true;
    camera.updateProjectionMatrix();
    renderer.setDrawingBufferSize(w, h, ratio);
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { sizeDirty = true; invalidate(); }) : null;
  resizeObserver?.observe(dom.view);
  applySize();

  // Off-screen pause. The observer alone proved unreliable (headless Chrome with WebGPU left the loop paused after
  // a scroll brought the view on screen, so the camera never drew), so a scroll or resize also re-checks the view's
  // rectangle directly; either one saying "on screen" restarts drawing.
  let visible = true;
  const checkVisible = () => {
    const r = dom.view.getBoundingClientRect();
    const was = visible;
    visible = r.bottom > 0 && r.top < (window.innerHeight || 1) && r.width > 0;
    if (visible && !was) invalidate();
  };
  const intersectionObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) checkVisible(); else invalidate(); }, { threshold: 0.01 })
    : null;
  intersectionObserver?.observe(dom.view);
  window.addEventListener('scroll', checkVisible, { passive: true });
  window.addEventListener('resize', checkVisible);
  const workspaceView = () => { checkVisible(); sizeDirty = true; invalidate(); };
  document.addEventListener('workspace-view', workspaceView);

  // A piece fetching its models veils the view with its progress and holds its pins back, so nothing piles up at the
  // origin before there is a model to pin (UI-21).
  // `soft`: a quiet compile's entry (never changed afterwards); `quiet`: its veil is still transparent
  const loadingPieces = new Map<string, { progress?: number; label?: string; error?: string; retry?: boolean; keep?: string; compiling?: boolean; quiet?: boolean; soft?: boolean }>();
  // A quiet load (a re-entry compile, which is usually instant) holds the frames but shows the veil only after this
  let quietTimer = 0;
  /** Levels compiling ahead on a first visit (warmPiece): their frames are held, and the veil shows once `veiled`. */
  const warming = new Map<string, { veiled: boolean; ready: Promise<void> }>();
  /** Score loop r5: while a level compiles on its first visit the previous scene stays on screen under the veil, so the HUD
   *  keeps the outgoing level's title and subline until the new scene draws (a stale frame under "THE LENS" read as a mismatch).
   *  The incoming words wait here and the veil names where the reader is going. */
  let heldHud: { id: string; title: string; sub: string } | null = null;
  let warmTitle = '';
  /** The veil is up only for a first-visit compile: it lifts with the first frame after it, no GPU wait needed. */
  let veilFromWarm = false;
  /** A load has been on the veil at least once (the veil's words go only after that, syncVeilState). */
  let veilSawLoad = false;
  /** A level the reader has just tapped (announceEntry), until showPiece takes it over: the view stays veiled meanwhile. */
  let tapEntry: string | null = null;
  let tapTimer = 0;
  const busy = (id: string | null) => !!id && (loadingPieces.has(id) || warming.has(id) || tapEntry !== null);
  let graphicsLost = false;
  let revealGeneration = 0, revealing = false;
  const veilMsg = document.getElementById('veil-msg');
  const veilBar = document.getElementById('veil-bar');
  const veilButton = document.getElementById('veil-reload');
  const stopLoading = bus.on('piece-loading', (e) => {
    // A quiet compile (its start and its end) never replaces a load or an error the piece has reported (score loop r3).
    const current = loadingPieces.get(e.id);
    if (e.loading && e.id === activeId) cancelWarm(); // a load or swap of the shown level must not share the scene with a precompile
    if (e.quiet && !e.error && current && !current.soft) return;
    // A loading event replaces an error (a retry has started), so a piece must not report progress for a load that
    // already failed: the camera rig ignores progress from its failed generation (score loop r1).
    if (e.error) {
      loadingPieces.set(e.id, { error: e.error, retry: e.retry, keep: e.keep });
    } else if (e.loading) loadingPieces.set(e.id, { progress: e.progress, label: e.label, compiling: e.compiling, quiet: e.quiet, soft: e.quiet });
    else loadingPieces.delete(e.id);
    // a piece that compiles its own models ahead (the camera rig) needs no first-entry compile from the stage
    if (e.compiling) { compiledPieces.add(e.id); if (entryCompile === e.id) entryCompile = null; }
    syncVeil();
  });
  // A piece that can load its models again gets Retry in place of Reload: a reload loses the page when offline.
  // app-start's listener reloads unless the veil is in this retry state.
  const onVeilButton = () => {
    const id = dom.veil.dataset.retry;
    if (!id || graphicsLost) return;
    bus.emit('piece-retry', { id });
  };
  veilButton?.addEventListener('click', onVeilButton);
  // A failed lens or body swap leaves the previous rig mounted: "Keep current lens" asks for that lens again (its models
  // are cached, so it comes back at once) instead of leaving the reader with an error over a blank view (score loop r4).
  const keepButton = document.getElementById('veil-keep');
  const onKeepButton = () => { const lens = dom.veil.dataset.keep; if (lens && !graphicsLost) bus.emit('scenario-set', { lens }); };
  keepButton?.addEventListener('click', onKeepButton);
  // An error veil keeps its message and its button in the part of the view the reader can see (score loop r3). On a
  // phone with a part open, the stage's bottom bar (#hud-btns-phone, Reset view) and the part sheet cover the lower
  // part of the view, so a centered Retry fell under Reset view and could not be tapped. The veil's lower padding
  // skips whatever covers its bottom edge; the veil scrolls if what is left is still too short.
  let veilFitTimer = 0;
  function fitVeil() {
    const err = dom.veil.classList.contains('err') && !dom.veil.classList.contains('off');
    if (!err) { dom.veil.style.paddingBottom = ''; window.clearInterval(veilFitTimer); veilFitTimer = 0; return; }
    const r = dom.veil.getBoundingClientRect();
    let covered = 0;
    if (r.height > 0) {
      const x = r.left + r.width / 2;
      // the lowest point still showing the veil, walking up from its bottom edge (elementFromPoint sees what is on top)
      for (let y = Math.min(r.bottom, innerHeight) - 2; y > r.top + 24; y -= 6) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === dom.veil || dom.veil.contains(hit))) break;
        covered = r.bottom - y;
      }
    }
    const pad = `${Math.round(Math.max(0, Math.min(covered, r.height - 120)))}px`;
    if (dom.veil.style.paddingBottom !== pad) dom.veil.style.paddingBottom = pad;
    // the sheet and the bar move (a part opens or closes, the phone turns), so the fit is kept while the error shows
    if (!veilFitTimer) veilFitTimer = window.setInterval(fitVeil, 400);
  }
  function syncVeil() {
    syncVeilState();
    fitVeil();
  }
  // A model that did not load (score loop r6): the failure screen is an alert with a way on that needs no 3D, as the start failure's and
  // failCamera's are, and the controls around the empty view (the exposure rail with Fire shutter, the view strip, the phone's bottom bar)
  // are inert until the model is back, so nothing is drawn, fired or played against a camera that is not there.
  let loadErrorShown = false;
  const loadErrorInerted: HTMLElement[] = [];
  function showLoadErrorChrome(on: boolean) {
    if (on === loadErrorShown) return;
    loadErrorShown = on;
    if (on) {
      dom.veil.setAttribute('role', 'alert');
      for (const sel of ['#hud-rail', '#view-strip', '#hud-btns-phone', '.shot-launch']) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && !el.inert) { el.inert = true; loadErrorInerted.push(el); }
      }
      let link = document.getElementById('veil-reference') as HTMLAnchorElement | null;
      if (!link) {
        link = document.createElement('a');
        link.id = 'veil-reference'; link.className = 'btn veil-reference'; link.href = 'reference.html'; link.textContent = 'Read the 2D reference';
        document.getElementById('veil-reload')?.after(link);
      }
      link.hidden = false;
    } else {
      if (!graphicsLost) dom.veil.removeAttribute('role');
      for (const el of loadErrorInerted.splice(0)) el.inert = false;
      const link = document.getElementById('veil-reference');
      if (link) link.hidden = true;
    }
  }
  function veilOff() {
    dom.veil.classList.add('off');
    dom.veil.classList.remove('quiet');
  }
  function syncVeilState() {
    // A late asset completion or another level must not dismiss a failed renderer.
    if (graphicsLost) {
      delete dom.veil.dataset.retry;
      dom.pins.classList.add('held');
      dom.veil.classList.add('err');
      dom.veil.classList.remove('off', 'quiet');
      if (veilMsg) veilMsg.textContent = 'The browser lost the 3D view. Restore it to continue with your current camera settings.';
      if (veilBar) veilBar.style.width = '0%';
      return;
    }
    const warm = activeId ? warming.get(activeId) : undefined;
    const l = (activeId ? loadingPieces.get(activeId) : undefined) ?? (warm?.veiled || tapEntry !== null ? { label: warmTitle ? `Preparing the view · ${warmTitle}` : 'Preparing the view', progress: 0.9 } as { label: string; progress: number; error?: string; retry?: boolean; keep?: string; quiet?: boolean } : undefined);
    window.clearTimeout(quietTimer); quietTimer = 0;
    if (l?.quiet && (dom.veil.classList.contains('off') || dom.veil.classList.contains('quiet'))) {
      // The view keeps its last frame for a short compile, and a long one gets the veil after 150 ms. The veil is up
      // but transparent meanwhile (.veil.quiet), so the view reads as loading (no `off`), the pins wait, and a
      // reveal does not flash it in.
      dom.veil.classList.add('quiet');
      dom.veil.classList.remove('off');
      dom.pins.classList.add('held');
      revealGeneration++;
      quietTimer = window.setTimeout(() => { quietTimer = 0; if (l === (activeId && loadingPieces.get(activeId))) { l.quiet = false; syncVeil(); } }, 150);
      return;
    }
    // a load that is no longer quiet shows the veil (its fade in); a finished one keeps it transparent until it lifts
    if (l) dom.veil.classList.remove('quiet');
    dom.pins.classList.toggle('held', !!l || !!warm);
    dom.veil.classList.toggle('busy', (!!warm?.veiled || tapEntry !== null) && !(activeId && loadingPieces.has(activeId)));
    dom.veil.classList.toggle('err', !!l?.error);
    showLoadErrorChrome(!!l?.error && !l.keep);
    // once nothing is loading any more the veil only waits for the first frame to be drawn: its words go at once (score loop
    // r4: "Preparing the camera" lingered over the lens for the fade's 0.3 s after the model was already in view)
    if (l) veilSawLoad = true;
    dom.veil.classList.toggle('lifting', !l && veilSawLoad);
    if (l?.error && l.retry && activeId) dom.veil.dataset.retry = activeId; else delete dom.veil.dataset.retry;
    // a failed swap shows its message as a banner over the rig that is still mounted
    if (l?.error && l.keep) dom.veil.dataset.keep = l.keep; else delete dom.veil.dataset.keep;
    dom.veil.classList.toggle('swap', !!(l?.error && l.keep));
    if (veilButton) veilButton.textContent = dom.veil.dataset.retry ? 'Retry' : 'Reload';
    // The veil lifts only after a frame of the new view has been drawn and the GPU has finished it (drawFrame): the
    // first frame of a newly loaded rig builds its pipelines, and on desktop WebGPU that froze the page for 0.4 to
    // 1.2 s right after the reveal, so the camera looked ready but ignored input (score loop r2).
    if (l) { dom.veil.classList.remove('off'); revealGeneration++; }
    else if (!dom.veil.classList.contains('off')) invalidate();
    if (l) {
      if (veilMsg) veilMsg.textContent = l.error ?? l.label ?? 'Loading the view';
      if (veilBar) veilBar.style.width = `${Math.round((l.progress ?? 0.05) * 100)}%`;
    }
  }

  // A simple, measured-frame-time quality governor: sustained slow frames drop a tier; this prototype's stub
  // pieces are cheap, so in practice this only matters once the real set pieces (glass/transmission) land, but
  // the plumbing -- and the DPR/tier effect it has right now -- is real and observable in the screenshots.
  // It also steps back up after about ten seconds of fast frames, so one slow stretch (a level's first compile, a
  // busy tab) does not cost the sharper picture for the rest of the visit.
  // Only frames drawn back to back count (score loop r2): with drawing on demand, the gap after an idle stretch is not
  // a frame time. And a tier that has to step down again soon after stepping up waits twice as long before its next
  // step up (up to eight times), so a phone on the edge does not blur and re-sharpen every 10 to 15 s.
  let slowFrames = 0, fastFrames = 0;
  const SLOW_MS = 1000 / 24, FAST_MS = 1000 / 50;
  const STEP_UP_FRAMES = 600;
  let stepUpFrames = STEP_UP_FRAMES, promoted = false;
  function governQuality(frameMs: number) {
    if (frameMs > SLOW_MS) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    fastFrames = frameMs < FAST_MS ? fastFrames + 1 : 0;
    // the WebGL2 fallback steps down after half as many slow frames (it has less headroom to wait out)
    if (slowFrames > (backendKind === 'webgl2' ? 45 : 90) && tier !== 'phone') {
      tier = tier === 'high' ? 'mid' : 'phone';
      if (promoted) stepUpFrames = Math.min(STEP_UP_FRAMES * 8, stepUpFrames * 2);
      promoted = false;
      slowFrames = 0; fastFrames = 0;
      sizeDirty = true; invalidate();
    } else if (fastFrames > stepUpFrames && tier !== 'high') {
      tier = tier === 'phone' ? 'mid' : 'high';
      promoted = true;
      slowFrames = 0; fastFrames = 0;
      sizeDirty = true; invalidate();
    }
  }

  // ---- render loop ------------------------------------------------------------------------------------------
  let running = false;
  let lastFrameTime = performance.now();
  let suspendedAt: number | null = null;
  let settleResolvers: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const onVisibilityChange = () => { if (document.hidden) suspendedAt ??= performance.now(); else invalidate(); };
  document.addEventListener('visibilitychange', onVisibilityChange);

  let lastDrawAt = -1e9, drewLastFrame = false, lastBusyAt = 0;
  // animation frames seen, frames drawn, and why each was drawn (window.p2p.drawStats(), for the idle budget gate)
  const drawStats = { frames: 0, draws: 0, ms: 0, why: {} as Record<string, number> };
  /** The actual draw work, shared by the paused-off-screen ambient loop and settle()'s forced frame. Every frame ticks
   *  the active piece; the scene is drawn and the pins projected only when something changed (render on demand). */
  /** The depth range follows the viewing distance (score loop r5). A fixed 0.01 to 100000 range left 24-bit depth about
   *  6 mm of resolution at 1 m, so two nearby surfaces z-fought: the dark rim band against the last lens element in the
   *  Focus level read as wavy hatching. near = distance / 100 and far = distance x 20 keep the whole model inside a
   *  range 2000:1 deep. The camera level fits its own range (camera-rig fitClip), so it is left alone. */
  function fitDepthRange(id: string | null) {
    if (!id || id === 'camera') return;
    const dist = camera.position.distanceTo(controls.target);
    if (!(dist > 0)) return;
    const near = Math.max(1e-4, dist / 100), far = Math.max(near * 100, dist * 20);
    if (Math.abs(near - camera.near) / camera.near < 0.02 && Math.abs(far - camera.far) / camera.far < 0.02) return;
    camera.near = near; camera.far = far;
    camera.updateProjectionMatrix();
  }
  function drawFrame(now: number, force: boolean) {
    // A forced frame can run before ResizeObserver delivers a layout change. Keep the
    // drawing buffer in sync before computing inset rectangles from the new CSS size.
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    let why = force ? 'settle' : '';
    if (sizeDirty || renderWidth !== (dom.view.clientWidth || 1) || renderHeight !== (dom.view.clientHeight || 1)) { applySize(); why ||= 'size'; }
    // Fit the camera and project the pins with the same current chrome measurements.
    // Measuring after rendering leaves a frame with mismatched picture/pin projections.
    const remeasured = forceMeasure || now - lastMeasure >= 280;
    if (measure(now)) why ||= 'chrome';
    if (diveTo) why ||= 'dive';
    tickDive(now);
    if (controls.update()) why ||= 'controls';
    const active = activeId ? built.get(activeId) : null;
    const settledW = dom.view.clientWidth, settledH = dom.view.clientHeight;
    // The Focus level frames its cone above the traced-point card, which lands a moment after the level is entered; a frame
    // fitted before it was measured left the exit pupil's pin off the left edge on a phone (score loop r6: Optics then Focus
    // at 390x844). A card that moved since the frame was fitted fits the frame again.
    if (remeasured) {
      const card = dom.view.querySelector<HTMLElement>('.lv-ctl');
      const top = card && card.checkVisibility() ? Math.round(card.getBoundingClientRect().top - dom.view.getBoundingClientRect().top) : -1;
      if (top !== framedCard) { if (framedCard !== -2) resizeFrame = true; framedCard = top; }
    }
    if (resizeFrame || (active && settledW > 1 && settledH > 1 && (settledW !== framedW || settledH !== framedH))) {
      resizeFrame = false;
      framedW = settledW; framedH = settledH;
      why ||= 'size';
      if (active?.selectionFrame && !manuallyMoved) { syncAspect(); startDive(selectedFrame(active, active.frame())); }
    }
    // a tick that animated keeps the next few frames too, so the end state of an animation is drawn
    if (active?.tick && active.tick(dt, now) !== false) { why ||= 'tick'; invalidate(100); }
    if (!why && now < drawUntil) why = 'event';
    if (!why && now - lastDrawAt >= SAFETY_MS) why = 'safety';
    drawStats.frames++;
    if (why && why !== 'safety') lastBusyAt = now;
    if (!why) {
      drewLastFrame = false;
      if (now - lastBusyAt > 300 && !settleResolvers.length) sleep();
      return;
    }
    drawStats.draws++;
    drawStats.why[why] = (drawStats.why[why] ?? 0) + 1;
    if (drewLastFrame) governQuality(dt);
    drewLastFrame = true;
    lastDrawAt = now;
    // Insets share renderer state, including its intermediate output passes. Restore the
    // whole viewport and scissor rectangle before drawing the next main view.
    const viewWidth = dom.view.clientWidth || 1, viewHeight = dom.view.clientHeight || 1;
    renderer.setScissorTest(false);
    renderer.setScissor(0, 0, viewWidth, viewHeight);
    renderer.setViewport(0, 0, viewWidth, viewHeight);
    fitDepthRange(activeId);
    renderer.render(scene, camera);
    const insets = active?.insets?.() ?? [];
    if (insets.length) {
      const r = renderer as unknown as {
        setScissorTest(b: boolean): void; setScissor(x: number, y: number, w: number, h: number): void;
        setViewport(x: number, y: number, w: number, h: number): void; autoClear: boolean; clearDepth(): void;
      };
      const w = dom.view.clientWidth || 1, h = dom.view.clientHeight || 1;
      const autoClear = r.autoClear;
      r.autoClear = false;
      for (const inset of insets) {
        const { left, bottom, width, height } = inset.rect;
        // `Inset.rect` is bottom-left-of-view (the same convention the `.inset-frame` DOM overlay uses via
        // CSS `bottom`), but this renderer's setScissor/setViewport (three/webgpu's unified Renderer, both
        // the WebGPU and WebGL2 backends) take a TOP-left-of-view y -- see its own setViewport() JSDoc
        // ("the vertical coordinate for the upper left corner"), unlike the legacy WebGLRenderer's
        // bottom-left convention. Convert here so the rendered inset lands under its own DOM frame.
        // (Found independently by the lens and loupe workstreams, 09/28/2026.)
        const top = h - bottom - height;
        r.setScissorTest(true);
        r.setScissor(left, top, width, height);
        r.setViewport(left, top, width, height);
        r.clearDepth();
        renderer.render(inset.scene ?? scene, inset.camera);
      }
      r.setScissorTest(false);
      r.setScissor(0, 0, w, h);
      r.setViewport(0, 0, w, h);
      r.autoClear = autoClear;
    }
    syncInsetFrames(insets);
    projectLabelsAndPins(remeasured);
    enteringPiece = false;
    if (veilFromWarm && !busy(activeId) && !graphicsLost) { veilFromWarm = false; veilOff(); }
    if (!busy(activeId) && !dom.veil.classList.contains('off') && !revealing && !graphicsLost) {
      // lift the veil once the GPU has finished this frame (see syncVeil); a load that starts meanwhile keeps it up
      revealing = true;
      const generation = revealGeneration;
      void stage.gpuIdle().catch(() => {}).then(() => {
        revealing = false;
        if (generation === revealGeneration && !graphicsLost && !busy(activeId)) veilOff();
        else invalidate();
      });
    }
    const resolvers = settleResolvers;
    settleResolvers = [];
    for (const r of resolvers) r.resolve();
  }

  function frame(time?: number) {
    // three's loop calls the first frame after a restart synchronously, without a timestamp
    const now = typeof time === 'number' ? time : performance.now();
    if (!running || graphicsLost) return;
    // Explicit settle requests still draw off-screen. Share this one RAF with the ambient
    // loop: parallel forced frames can resize/reuse WebGPU targets twice in one frame.
    // The compact settings sheet deliberately leaves the model visible so an
    // aperture/focus adjustment has an immediate visual result behind it.
    const covered = document.hidden || dom.canvas.inert || !!document.querySelector('dialog:modal:not(#phone-settings)');
    // A piece compiling its pipelines behind the veil (renderer.compileAsync) holds the frames: a frame drawn in the
    // middle would build the same pipelines synchronously and share the frame-buffer target with the compile.
    const compiling = precompiling || !!(activeId && (loadingPieces.get(activeId)?.compiling || warming.has(activeId)));
    // A settle() request waits for a compile too (score loop r3): a frame forced in the middle built the materials the
    // compile was building, synchronously, in one task of up to 3 s on a 4x-throttled phone.
    if (((!visible || covered) && !settleResolvers.length) || compiling) {
      suspendedAt ??= now;
      if (now - lastBusyAt > 300 && now >= drawUntil) sleep(); // the timer and the events that end the pause wake it
      // nothing is drawn off screen or under a dialog, so the veil cannot wait for a frame there
      if (!compiling && !graphicsLost && !busy(activeId)) veilOff();
      return;
    }
    if (suspendedAt !== null) {
      // Keep a guided move at its last visible point, and do not treat time spent
      // behind a lesson/dialog as a slow GPU frame or a giant animation step.
      if (diveTo) diveStart += now - Math.max(suspendedAt, diveStart);
      lastFrameTime = now;
      suspendedAt = null;
      drewLastFrame = false;
      invalidate();
    }
    if (entryCompile && entryCompile === activeId && !loadingPieces.has(activeId)) {
      startEntryCompile(activeId);
      return;
    }
    const t0 = performance.now();
    drawFrame(now, settleResolvers.length > 0);
    drawStats.ms += performance.now() - t0;
  }

  // ---- a level's first entry compiles its materials ahead, in steps (score loop r3) ------------------------------
  // The first frame of a level built every node material it shows in one task: 0.7 to 2.3 s on a 4x-throttled phone
  // (Optics, Focus, Pixel), while the Menu, the tabs and the settings around the view did not answer. Before that
  // frame, renderer.compileAsync builds them in steps with the frames held (as the camera rig does for its models);
  // the stage veils the view only if that takes longer than a moment. Desktop WebGPU keeps compiling in its first
  // frame, which costs it about 0.3 s, as the camera rig does (score loop r2).
  const compiledPieces = new Set<string>();
  let entryCompile: string | null = null;
  function compilesAhead(): boolean {
    return backendKind === 'webgl2' || (dom.view.clientWidth || window.innerWidth) <= 760;
  }
  function startEntryCompile(id: string) {
    entryCompile = null;
    compiledPieces.add(id);
    const handle = built.get(id);
    const r = renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera, target?: THREE.Scene) => Promise<void> };
    if (!handle || !r.compileAsync || !compilesAhead()) return;
    performance.mark(`p2p:compile-${id}`);
    const mark = { compiling: true, quiet: true, soft: true, label: 'Preparing the view' };
    loadingPieces.set(id, mark);
    syncVeil();
    const jobs: [THREE.Object3D, THREE.Camera][] = [[scene, camera], ...(handle.insets?.() ?? []).map((i): [THREE.Object3D, THREE.Camera] => [i.scene ?? scene, i.camera])];
    void (async () => {
      for (const [s, c] of jobs) {
        if (graphicsLost || activeId !== id) break;
        // the camera has not flown to the level yet: nothing of it is culled while the compile collects its objects
        const culled: THREE.Object3D[] = [];
        handle.group.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
        let job: Promise<void>;
        try { job = r.compileAsync!(s, c); } finally { for (const o of culled) o.frustumCulled = true; }
        try { await job; } catch (error) { console.warn('stage: a level did not compile ahead; its first frame will', error); break; }
      }
      performance.mark(`p2p:compiled-${id}`);
      if (loadingPieces.get(id) === mark) loadingPieces.delete(id);
      syncVeil();
      start();
    })();
  }

  function start() {
    invalidate(); // every caller changed something the picture shows: a model, a piece, the view, a pin
    if (running || graphicsLost) return;
    running = true;
    lastFrameTime = performance.now();
    // Three advances node/material frame caches immediately before this callback.
    // A separate browser RAF can otherwise render new-size targets with old bindings.
    void renderer.setAnimationLoop(frame);
  }

  // ---- view insets: the fitted camera centers the model in the part of the view the chrome leaves free ---------------
  // Elements marked data-inset (the title, the exposure panel, the switches on a phone) are measured every so often;
  // a lens shift (camera.setViewOffset) moves the picture's center into the free rectangle, and the piece reads the
  // same numbers from camera.userData.insets to fit its framing into that rectangle (UI-10, FID-9). Only the camera
  // level uses them; the deep dives frame themselves as before.
  type Rect = { l: number; t: number; r: number; b: number };
  let exclusion: Rect[] = [];
  /** The teaching marks on the camera's own controls (a ring and its "Drag to focus" label): a pin whose number would
   *  sit on one moves aside on its leader, but is not hidden as it is under the chrome. Hiding it let the label, which
   *  yields only to pins it can see, settle over pins 1 and 4 for good (score loop r2: pin 1 sat in the focus ring's
   *  mark, and at times pins 1 and 4 went missing under its label). */
  let teachRings: Rect[] = [];
  let lastMeasure = -1e9;
  const insets = { left: 0, top: 0, right: 0, bottom: 0 };
  let exclusionKey = '';
  /** Measures the chrome; true when the insets or the rectangles the pins avoid changed (the frame must be drawn). */
  function measure(now: number): boolean {
    if (!forceMeasure && now - lastMeasure < 280) return false;
    const forced = forceMeasure;
    forceMeasure = false;
    lastMeasure = now;
    const vr = dom.view.getBoundingClientRect();
    if (vr.width < 2) return false;
    const narrow = vr.width < 560;
    const rel = (r: DOMRect): Rect => ({ l: r.left - vr.left, t: r.top - vr.top, r: r.right - vr.left, b: r.bottom - vr.top });
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    // chrome the pins and their labels must stay clear of
    exclusion = [];
    const notes: Rect[] = [];
    const sel = '.hud.tl > *, .hud.tr > *, .hud.br > *, .hud.bl > *, .hud.rail > *, .piece-overlay:not([hidden]) > *, .toast, .shot-launch';
    for (const el of dom.view.querySelectorAll(sel)) {
      if (el.classList.contains('hint') || el.classList.contains('hud-slot') || !shown(el)) continue;
      if (el.classList.contains('rig-teach') || el.classList.contains('rig-tip') || el.classList.contains('rig-note') || el.classList.contains('mode-slotted')) continue;
      if (el.classList.contains('hud-switches') || el.classList.contains('hud-btns')) {
        for (const c of el.querySelectorAll('button, .mode')) if (shown(c)) exclusion.push(rel(c.getBoundingClientRect()));
        continue;
      }
      exclusion.push(rel(el.getBoundingClientRect()));
      // an inset's scale note ("1 square = 1 pixel · 330 µm across") sits outside its guard's box: on a landscape phone a
      // pin landed on it and hid part of it (score loop r3). Like the teaching marks below, a pin moves off it on its
      // leader rather than being hidden.
      if (el.classList.contains('lv-inset-guard')) for (const note of el.querySelectorAll('.lv-inset-note')) if (shown(note)) notes.push(rel(note.getBoundingClientRect()));
    }
    // An inset's note line may run wider than the inset (right-aligned over the view) and below it on a short view: its
    // own box joins the chrome, so no pin sits on its words (score loop r3: pin 4 over "1 square = 1 pixel" on a
    // phone on its side, and over the Optics legend on a phone held upright).
    for (const el of dom.view.querySelectorAll('.piece-overlay:not([hidden]) .lv-inset-note')) if (shown(el)) exclusion.push(rel(el.getBoundingClientRect()));
    teachRings = [...dom.view.querySelectorAll('.rig-teach:not(.gone) > :is(i, span:not([hidden]))')].filter(el => shown(el) && getComputedStyle(el.parentElement!).display !== 'none').map(el => rel(el.getBoundingClientRect()));
    teachRings.push(...notes);
    // insets for the camera's framing
    const next = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const el of dom.view.querySelectorAll<HTMLElement>('[data-inset]')) {
      if (!shown(el)) continue;
      const k = el.dataset.inset;
      const r = rel(el.getBoundingClientRect());
      if (k === 'left') next.left = Math.max(next.left, r.r + 12);
      else if (k === 'top') next.top = Math.max(next.top, r.b + 8);
      else if (k === 'bottom') next.bottom = Math.max(next.bottom, vr.height - r.t + 8);
      else if (k === 'bottom-narrow' && narrow) next.bottom = Math.max(next.bottom, vr.height - r.t + 8);
      else if (k === 'corner' && narrow) next.top = Math.max(next.top, r.b + 6);
      else if (k === 'right-wide' && !narrow) next.right = Math.max(next.right, vr.width - r.l + 12);
    }
    // A short landscape phone floats the part navigation over the bottom of the view (studio-shell.css, score loop
    // r1): its buttons keep the pins off them, and the camera frames the model above them.
    const floatNav = document.getElementById('hud-btns-phone');
    if (floatNav && shown(floatNav)) {
      const fr = floatNav.getBoundingClientRect();
      if (fr.top < vr.bottom - 1 && fr.bottom > vr.bottom - 2) {
        for (const c of floatNav.querySelectorAll('button')) if (shown(c)) exclusion.push(rel(c.getBoundingClientRect()));
        next.bottom = Math.max(next.bottom, vr.bottom - fr.top + 4);
      }
    }
    // never let the chrome take more than a share of the view in either direction
    next.left = Math.round(Math.min(next.left, vr.width * 0.45));
    next.top = Math.round(Math.min(next.top, vr.height * 0.3));
    next.bottom = Math.round(Math.min(next.bottom, vr.height * 0.25));
    // On a phone the part card is a sheet over the lower screen: the camera frames the picked part above it (R1-04).
    const card = document.getElementById('card');
    if (narrow && card && !card.hidden && getComputedStyle(card).position === 'fixed') {
      const cover = vr.bottom - card.getBoundingClientRect().top;
      if (cover > 0) next.bottom = Math.round(Math.max(next.bottom, Math.min(cover + 8, vr.height * 0.62)));
    }
    // A phone's inspector raised as a sheet (workspace.ts, a picked part or More) covers the foot of the view, with
    // the part navigation riding on its top edge: the camera frames the model in the part of the view above both.
    const sheet = document.querySelector<HTMLElement>('.studio-sidebar');
    if (document.body.classList.contains('inspector-expanded') && sheet && getComputedStyle(sheet).position === 'absolute') {
      let top = sheet.getBoundingClientRect().top;
      if (floatNav && getComputedStyle(floatNav).position === 'fixed') top = Math.min(top, floatNav.getBoundingClientRect().top);
      // and the pins under it are hidden, not left to be reached through it (the deep levels frame without insets)
      if (top < vr.bottom) exclusion.push({ l: 0, t: top - vr.top, r: vr.width, b: vr.height });
      const cover = vr.bottom - top;
      if (cover > 0) next.bottom = Math.round(Math.max(next.bottom, Math.min(cover + 8, vr.height * 0.62)));
    }
    next.right = Math.round(Math.min(next.right, vr.width * 0.3));
    if (activeId !== 'camera') { next.left = next.top = next.right = next.bottom = 0; }
    let changed = forced;
    if (forced || next.left !== insets.left || next.top !== insets.top || next.right !== insets.right || next.bottom !== insets.bottom) {
      Object.assign(insets, next);
      applyViewOffset();
      changed = true;
    }
    const key = exclusion.map((r) => `${Math.round(r.l)},${Math.round(r.t)},${Math.round(r.r)},${Math.round(r.b)}`).join(';');
    if (key !== exclusionKey) { exclusionKey = key; changed = true; }
    return changed;
  }
  function applyViewOffset() {
    const w = dom.view.clientWidth || 1, h = dom.view.clientHeight || 1;
    const sx = (insets.left - insets.right) / 2, sy = (insets.top - insets.bottom) / 2;
    camera.userData.insets = { ...insets, width: w, height: h };
    if (Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(w, h, -sx, -sy, w, h);
    camera.updateProjectionMatrix();
  }

  // ---- pins: projected every frame, then laid out so no two labels and no label and the chrome overlap (UI-02) -------
  const labelSize = new Map<string, { w: number; h: number }>();
  const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  /** A deep level that has to leave a pin out (no room beside the insets and cards) says so, in one small line, so a gap
   *  in the numbering is never silent (score loop r5): the part is still in the Parts list. It sits in the first view
   *  corner that is clear of the chrome and the pins, and is left out where no corner is. */
  let hiddenHint: HTMLElement | null = null;
  function updateHiddenHint(count: number, avoid: Rect[], w: number, h: number): Rect | null {
    if (!hiddenHint) {
      hiddenHint = document.createElement('p');
      hiddenHint.className = 'pin-hidden-hint';
      hiddenHint.setAttribute('aria-hidden', 'true'); // the Parts list is the accessible way to every part
      dom.view.appendChild(hiddenHint);
    }
    const el = hiddenHint;
    if (count < 1 || activeId === 'camera' || !activeId) { el.hidden = true; el.textContent = ''; return null; }
    // the longest wording that has a clear place in the view: the top-left first, then down the left edge
    const noun = count === 1 ? 'pin' : 'pins';
    for (const text of [`${count} hidden ${noun} · use Parts`, `${count} ${noun} hidden · Parts`, `${count} hidden`]) {
      const bw = Math.ceil(text.length * 6.6) + 18, bh = 22;
      for (let t = 8; t + bh <= h - 6; t += 4) for (let l = 8; l + bw <= w - 8; l += 12) {
        const r = { l, t, r: l + bw, b: t + bh };
        if (avoid.some((q) => overlaps(q, r))) continue;
        el.hidden = false;
        if (el.textContent !== text) el.textContent = text;
        el.style.left = `${l}px`; el.style.top = `${t}px`;
        return r;
      }
    }
    el.hidden = true; el.textContent = '';
    return null;
  }
  function projectLabelsAndPins(remeasured: boolean) {
    camera.updateMatrixWorld(true); // required before any project() call -- rendering spike gotcha 3
    const w = dom.view.clientWidth || 1;
    const h = dom.view.clientHeight || 1;
    for (const el of labelEls.values()) {
      const world = (el as HTMLElement & { _world?: THREE.Vector3 })._world;
      if (!world) continue;
      const p = world.clone().project(camera);
      const onScreen = p.z < 1 && p.z > -1;
      el.style.display = onScreen ? '' : 'none';
      el.style.left = `${((p.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - p.y) / 2) * h}px`;
    }
    const handle = activeId ? built.get(activeId) : null;
    if (!handle) return;
    type P = { id: string; i: number; el: HTMLButtonElement; x: number; y: number; anchorX: number; anchorY: number; z: number; show: boolean };
    const ps: P[] = [];
    handle.probes.forEach((probe, i) => {
      const el = pinEls.get(probe.id);
      if (!el) return;
      const p = handle.group.localToWorld(probe.anchor.clone()).project(camera);
      const x = ((p.x + 1) / 2) * w, y = ((1 - p.y) / 2) * h;
      pinAnchors.set(probe.id, { x, y });
      const inView = p.z < 1 && p.z > -1 && x > 6 && x < w - 6 && y > 6 && y < h - 6;
      // a pin under the chrome is hidden, not drawn over it; the list still reaches it
      // (score loop r5: only a pin whose anchor is well inside the chrome hides; one at its edge is moved clear on its leader,
      // so the deep levels on a phone stop losing numbers 1 and 5 beside a card)
      const underChrome = exclusion.some((r) => x > r.l + 10 && x < r.r - 10 && y > r.t + 10 && y < r.b - 10);
      ps.push({ id: probe.id, i, el, x, y, anchorX: x, anchorY: y, z: p.z, show: inView && (!underChrome || probe.id === selectedPin) });
    });
    const positions = spreadPins(ps.filter(p => p.show), w, h, teachRings.length ? [...exclusion, ...teachRings] : exclusion, selectedPin, w < 600);
    for (const p of ps) {
      const position = positions.get(p.id);
      p.show = !!position;
      if (position) { p.x = position.x; p.y = position.y; }
    }
    // labels: the selected pin first, then nearest first; right, left, above or below, whichever clears everything
    const placed: Rect[] = [...exclusion, ...teachRings];
    const pinRect = (p: P): Rect => ({ l: p.x - 12, t: p.y - 12, r: p.x + 12, b: p.y + 12 });
    for (const p of ps) if (p.show) placed.push(pinRect(p));
    // a gap in the numbering is never silent: one small line says how many pins this view has no room for
    const hintRect = updateHiddenHint(ps.filter((p) => !p.show).length, placed, w, h);
    if (hintRect) placed.push(hintRect);
    const order = ps.filter((p) => p.show).sort((a, b) => (a.id === selectedPin ? -1 : b.id === selectedPin ? 1 : a.z - b.z));
    const placement = new Map<string, string>();
    const twoLine = new Map<string, number>();
    for (const p of order) {
      const lbl = p.el.querySelector('.lbl') as HTMLElement | null;
      // Persistent numbers locate every part; only the chosen or actively explored part needs a full name.
      // Interaction hints remain visible on the physical controls independently of this quieter label layer.
      const wantLabel = p.id === selectedPin || p.id === focusedPin || (p.id === hoveredPin && !hoverFromModel && focusedPin === null);
      if (!lbl || !wantLabel) { placement.set(p.id, 'none'); continue; }
      // the label is one line of 11 px IBM Plex Mono with .06em tracking: 0.6em advance + 0.06em per character. Worked
      // out, not read back from layout, so a hidden label (display: none measures 0) is still placed at its real width.
      // The backing adds 5 px a side and 4 px above and below (R2-03).
      let sz = labelSize.get(p.id);
      if (!sz || remeasured) {
        const text = lbl.textContent ?? '';
        sz = { w: Math.ceil(text.length * 11 * 0.66) + 12, h: 21 };
        labelSize.set(p.id, sz);
      }
      // beside the pin first, then beside it nudged up or down half a label, then above or below: a label is dropped
      // only when every one of these is taken (R2-04)
      const candsFor = (lw: number, lh: number): [string, Rect][] => {
        const side = (dy: number): [string, Rect][] => [
          [`right${dy}`, { l: p.x + 14, t: p.y - lh / 2 + dy, r: p.x + 14 + lw, b: p.y + lh / 2 + dy }],
          [`left${dy}`, { l: p.x - 14 - lw, t: p.y - lh / 2 + dy, r: p.x - 14, b: p.y + lh / 2 + dy }],
        ];
        return [
          ...side(0),
          ['above', { l: p.x - lw / 2, t: p.y - 17 - lh, r: p.x + lw / 2, b: p.y - 17 }],
          ['below', { l: p.x - lw / 2, t: p.y + 17, r: p.x + lw / 2, b: p.y + 17 + lh }],
          ...side(-(lh / 2 + 2)), ...side(lh / 2 + 2),
        ];
      };
      const own = pinRect(p);
      const pick = (cands: [string, Rect][]) => cands.find(([, r]) => !(r.l < 4 || r.r > w - 4 || r.t < 4 || r.b > h - 4)
        && !placed.some((q) => !(q.l === own.l && q.t === own.t) && overlaps(q, r)));
      const cands = candsFor(sz.w, sz.h);
      let got = pick(cands);
      // a long name ("Shutter / stabilizer") that fits nowhere on one line gets a second try on two, broken at a space
      let two = 0;
      const words = (lbl.textContent ?? '').split(' ');
      if (!got && words.length > 1) {
        const text = lbl.textContent ?? '';
        let best = text.length;
        for (let k = 1; k < words.length; k++) best = Math.min(best, Math.max(words.slice(0, k).join(' ').length, words.slice(k).join(' ').length));
        two = Math.ceil(best * 11 * 0.66) + 2;
        got = pick(candsFor(two + 10, 34));
        if (!got) two = 0;
      }
      // A selected label may displace a dimmed pin, but must never cover a magnified inset or its controls.
      if (!got && p.id === selectedPin) got = cands.find(([, r]) => r.l >= 4 && r.r <= w - 4 && r.t >= 4 && r.b <= h - 4
        && !exclusion.some(q => overlaps(q, r)));
      if (got) { placed.push(got[1]); placement.set(p.id, got[0]); } else placement.set(p.id, 'none');
      if (two) twoLine.set(p.id, two); else twoLine.delete(p.id);
    }
    // Layout already honors the view edges and chrome. Never clamp again after placing the labels.
    for (const p of ps) {
      const el = p.el;
      el.style.display = p.show ? '' : 'none';
      if (!p.show) continue;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      const dx = p.anchorX - p.x, dyAnchor = p.anchorY - p.y;
      const leader = el.querySelector<HTMLElement>('.pin-leader')!;
      const distance = Math.hypot(dx, dyAnchor);
      leader.hidden = distance < 8;
      if (!leader.hidden) {
        leader.style.width = `${distance}px`;
        leader.style.transform = `rotate(${Math.atan2(dyAnchor, dx)}rad)`;
      }
      const probe = handle.probes[p.i];
      const lblEl = el.querySelector('.lbl');
      if (lblEl && probe && lblEl.textContent !== probe.label) { lblEl.textContent = probe.label; el.setAttribute('aria-label', `${p.i + 1}. ${probe.label}`); }
      const on = p.id === selectedPin;
      el.classList.toggle('on', on);
      el.classList.toggle('preview', p.id === (focusedPin ?? hoveredPin));
      if (el.getAttribute('aria-pressed') !== String(on)) el.setAttribute('aria-pressed', String(on));
      el.classList.toggle('dim', !!selectedPin && !on);
      const num = el.querySelector('.num') as HTMLElement;
      const txt = String(p.i + 1);
      if (num.textContent !== txt) num.textContent = txt;
      const place = placement.get(p.id) ?? 'none';
      const dy = /^(right|left)(-?[\d.]+)$/.exec(place);
      const where = dy ? dy[1] : place;
      if (dy) el.style.setProperty('--ly', `${dy[2]}px`); else el.style.removeProperty('--ly');
      el.classList.toggle('no-lbl', where === 'none');
      el.classList.toggle('at-left', where === 'left');
      el.classList.toggle('at-above', where === 'above');
      el.classList.toggle('at-below', where === 'below');
      const tw = twoLine.get(p.id);
      el.classList.toggle('two-line', !!tw);
      if (tw) el.style.setProperty('--lw', `${tw}px`); else el.style.removeProperty('--lw');
    }
  }

  const originalDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = info => {
    originalDeviceLost(info);
    graphicsLost = true;
    cancelWarm();
    running = false;
    window.clearTimeout(sleepTimer); sleeping = false;
    void renderer.setAnimationLoop(null);
    diveTo = null;
    const waiters = settleResolvers;
    settleResolvers = [];
    for (const waiter of waiters) waiter.reject(new Error('The graphics device was lost. Restore the 3D view.'));
    bus.emit('pause-exposure', {});
    dom.canvas.getAnimations().forEach(animation => animation.cancel());
    dom.view.classList.add('graphics-lost');
    syncVeil();
    const reload = document.getElementById('veil-reload');
    if (reload) reload.textContent = 'Restore 3D view';
    dom.veil.setAttribute('role', 'alert');
  };

  // First visits (score loop r3): the first frame of a level, and of the camera again after another level changed the
  // scene's environment and lights, built its GPU pipelines synchronously, and the page froze for 0.7 to 1.6 s in the
  // middle of the dive (r3 review; tools/score-loop/r3-switch-stall.mjs). The first visit to each level after the
  // opening one, and the first return to the camera, compile ahead instead (renderer.compileAsync, which leaves the
  // main thread and the compositor free) behind the veil with a moving progress cue; the frames are held meanwhile, as
  // for the camera rig's load, and settle() waits for it. A level that is also loading (the Pixel level samples its
  // pixel) keeps its own veil text; the hold is separate (warming).
  const visits = new Map<string, number>();
  let openingShown = false;
  function warmPiece(id: string, handle: PieceHandle) {
    const r = renderer as unknown as { compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene) => Promise<void> };
    const n = (visits.get(id) ?? 0) + 1;
    visits.set(id, n);
    const opening = !openingShown;
    openingShown = true;
    if (opening || n > (id === 'camera' ? 2 : 1) || !r.compileAsync || warming.has(id)) return;
    // compiled ahead while the camera sat idle (precompileLevel): its pipelines exist, and its first frame builds what is left
    const ahead = precompiled.has(id);
    if (ahead) {
      compiledPieces.add(id); if (entryCompile === id) entryCompile = null;
      if (!WARM_LEVELS[id]?.insetScene) return; // nothing is left but an inset scene of its own
    }
    let finish!: () => void;
    const entry = { veiled: true, ready: new Promise<void>((resolve) => { finish = resolve; }) };
    warming.set(id, entry);
    veilFromWarm = true;
    // this compile covers the level's first entry: the stage's own entry compile (startEntryCompile) stands down
    compiledPieces.add(id);
    if (entryCompile === id) entryCompile = null;
    const done = () => {
      if (warming.get(id) === entry) warming.delete(id);
      finish();
      // a level the reader already left changes nothing on the screen
      if (activeId !== id) { if (heldHud?.id === id) heldHud = null; return; }
      if (heldHud?.id === id) { dom.hudTitle.textContent = heldHud.title; dom.hudSub.textContent = heldHud.sub; heldHud = null; }
      warmTitle = '';
      // the chrome was not measured while the frames were held: measure it in the next frame, before a settle resolves
      forceMeasure = true;
      syncVeil();
      invalidate();
    };
    // After this task, so the piece has its model (the store's update follows showPiece) before its scene is compiled.
    // Node materials are built in JavaScript inside each compileAsync call, so the level is compiled a branch at a time
    // with a frame between branches: one call for the whole scene was a single 240 ms task. Then the whole scene (by
    // now cached, so quick) and the piece's inset scenes.
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const compileWith = async (root: THREE.Object3D, cam: THREE.Camera, target?: THREE.Scene) => {
      const culled: THREE.Object3D[] = [];
      root.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
      let pending: Promise<void>;
      try { pending = target ? r.compileAsync!(root, cam, target) : r.compileAsync!(root, cam); }
      finally { for (const o of culled) o.frustumCulled = true; }
      await pending;
    };
    performance.mark(`p2p:warm-${id}`);
    window.setTimeout(async () => {
      try {
        const branches: THREE.Object3D[] = [];
        const split = (o: THREE.Object3D, depth: number) => {
          for (const c of o.children) { if (!c.visible) continue; if (depth < 1 && c.children.length > 4) split(c, depth + 1); else branches.push(c); }
        };
        if (!ahead) split(handle.group, 0);
        for (const b of branches) {
          if (activeId !== id || graphicsLost) break;
          await compileWith(b, camera, scene);
          await nextFrame();
        }
        if (activeId === id && !graphicsLost) {
          if (!ahead) await compileWith(scene, camera);
          for (const inset of handle.insets?.() ?? []) if (inset.scene && inset.scene !== scene) { await nextFrame(); await compileWith(inset.scene, inset.camera); }
        }
      } catch (error) { console.warn('stage: a level did not compile ahead; its first frame will', error); }
      performance.mark(`p2p:warmed-${id}`);
      done();
    }, 0);
  }

  // ---- the other levels' pipelines, built while the camera sits idle (score loop r5) ------------------------------
  // A level's first visit built its geometry (a task of 120 to 600 ms on a 4x phone) and compiled its pipelines (1 to 3.4 s
  // of small tasks and waits) while the reader watched the veil. Once the camera is usable and nobody has touched the page
  // for a moment, the stage does that work ahead, one level at a time and one branch at a time: it builds the level,
  // applies the current model to it (its labels and scale badge muted: the level is not shown), and compiles it with the
  // scene wearing the level's own state (the deep levels' environment and tone mapping, the shown level hidden) for just the
  // length of one compile step, with the frames held meanwhile. Any input restores the scene at once and pauses the work.
  // `update`: the level takes the current model first (the Pixel level takes none: its update asks for a pixel sample, which
  // only runs while the level is shown, and its meshes are all built already); `force`: its meshes are hidden until that
  // sample arrives, so the compile shows them for its steps.
  // `reuse`: the level's first entry keeps the model it took (the Focus level's rays are a task of 120 to 600 ms on a 4x
  // phone); the Optics level lays its inset note out from the sizes of its own elements, which a hidden level cannot
  // measure, so its entry takes the model again and lays itself out then.
  // `insetScene`: the level draws an inset from a scene of its own, which its entry compiles (see precompileLevel).
  const WARM_LEVELS: Record<string, { update: boolean; force: boolean; reuse: boolean; insetScene: boolean }> = {
    lens: { update: true, force: false, reuse: false, insetScene: true },
    cone: { update: true, force: false, reuse: true, insetScene: false },
    loupe: { update: false, force: true, reuse: false, insetScene: false },
  };
  // Nobody has touched the page for this long: a reader who is looking at the camera, not one who is dragging it. (The idle
  // gate and a reader's first few seconds are not spent on it either: the work starts about six seconds after the camera.)
  const WARM_QUIET_MS = 6000;
  const precompiled = new Set<string>();
  /** A level whose run failed or hung is not tried again this visit: its first entry compiles as it always did. */
  const precompileFailed = new Set<string>();
  const STEP_LIMIT_MS = 8000;
  let precompiling = false;
  let abortStepNow: (() => void) | null = null;
  let warmGen = 0;
  let warmLoop: Promise<void> | null = null;
  let warmRearm = 0;
  let latest: { model: Model; scenario: Scenario } | null = null;
  /** The model a hidden level was given in idle time, until its first entry uses it. */
  const appliedAhead = new WeakMap<PieceHandle, { model: Model; scenario: Scenario }>();
  function abortWarmStep() { abortStepNow?.(); }
  /** three keeps a scene's environment-and-lights cache key per draw call (renderer.info.calls) and reuses it until
   *  another render() call: a compile that follows a scene change with no frame between them would be keyed by the
   *  state of the last frame. One more call count makes it work the key out again for the state it compiles in. */
  function freshKeys() { (renderer.info as unknown as { calls: number }).calls++; }
  /** Stops the run; a step in flight gives the scene back at once. It starts again by itself when the stage is quiet. */
  function cancelWarm() {
    warmGen++;
    abortWarmStep();
    window.clearTimeout(warmRearm);
    warmRearm = window.setTimeout(armWarm, 4000);
  }
  const warmQuiet = () => !document.hidden && !graphicsLost && !document.querySelector('dialog[open]') && !dom.canvas.inert
    && !busy(activeId) && dom.veil.classList.contains('off') && !diveTo
    && performance.now() - lastInputAt >= WARM_QUIET_MS && performance.now() - lastBusyAt > 600;
  const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const idleSlice = () => new Promise<void>((resolve) => (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 50)))(() => resolve(), { timeout: 1500 }));
  const nextFrameWarm = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** A reader who asked for less data or a lighter page is not given speculative work. */
  const savesData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  function armWarm() {
    if (warmLoop || graphicsLost || !latest || savesData()) return;
    const gen = warmGen;
    warmLoop = (async () => {
      try {
        for (const id of Object.keys(WARM_LEVELS)) {
          if (precompiled.has(id) || precompileFailed.has(id) || !builders.has(id) || activeId === id) continue;
          // wait for a quiet moment (or for the run to be cancelled), then for the browser to be idle, and check again
          for (;;) {
            while (gen === warmGen && !warmQuiet()) await pause(500);
            if (gen !== warmGen) return;
            await idleSlice();
            if (gen !== warmGen) return;
            if (warmQuiet()) break;
          }
          try {
            if (await precompileLevel(id, gen)) precompiled.add(id);
          } catch (error) { precompileFailed.add(id); console.warn(`stage: the ${id} level could not be compiled ahead; its first visit will`, error); }
          if (gen !== warmGen) return;
        }
      } finally { warmLoop = null; }
    })();
  }
  async function precompileLevel(id: string, gen: number): Promise<boolean> {
    const r = renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera, target?: THREE.Scene) => Promise<void> };
    if (!r.compileAsync || !latest) return false;
    const handle = ensureBuilt(id);
    performance.mark(`p2p:prewarm-${id}`);
    const { update, force, reuse } = WARM_LEVELS[id];
    // A level that can trace its rays in short tasks does so first (a 4x phone spent 400 ms in one task on the Focus level's trace,
    // score loop r6), and only the geometry from them is built with the chrome muted.
    const given = latest;
    let apply: (() => void) | null = null;
    if (update && handle.prepareUpdate) {
      apply = await handle.prepareUpdate(given.model, given.scenario);
      if (!apply || gen !== warmGen) return false;
    }
    quietChrome = true;
    try {
      if (update) { if (apply) apply(); else handle.update(given.model, given.scenario); if (reuse) appliedAhead.set(handle, { model: given.model, scenario: given.scenario }); }
      handle.prepare?.();
    } finally { quietChrome = false; }
    // after the geometry task, the compile waits for another quiet moment: that task may have run for half a second
    await pause(0);
    const branches: THREE.Object3D[] = [];
    const split = (o: THREE.Object3D, depth: number) => {
      for (const c of o.children) { if (!c.visible && !force) continue; if (depth < 1 && c.children.length > 4) split(c, depth + 1); else branches.push(c); }
    };
    split(handle.group, 0);
    const hidden: THREE.Object3D[] = [];
    if (force) handle.group.traverse((o) => { if (!o.visible && o !== handle.group) hidden.push(o); });
    /** One compile step with the scene in the level's own state; input or a load gives the scene back at once. */
    const step = async (root: THREE.Object3D, cam: THREE.Camera, target?: THREE.Scene): Promise<boolean> => {
      const shown = activeId ? built.get(activeId) : null;
      const saved = { environment: scene.environment, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
        shown: shown?.group.visible, own: handle.group.visible, mask: camera.layers.mask };
      let given = false;
      const giveBack = () => {
        if (given) return;
        given = true; precompiling = false; abortStepNow = null;
        for (const o of hidden) o.visible = false;
        scene.environment = saved.environment; renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
        if (shown && saved.shown !== undefined) shown.group.visible = saved.shown;
        handle.group.visible = saved.own;
        camera.layers.mask = saved.mask;
        freshKeys();
      };
      precompiling = true; abortStepNow = giveBack;
      freshKeys();
      scene.environment = levelEnvironment; renderer.toneMapping = levelToneMapping; renderer.toneMappingExposure = levelExposure;
      if (shown) shown.group.visible = false;
      handle.group.visible = true;
      for (const o of hidden) o.visible = true;
      camera.layers.enableAll();
      const culled: THREE.Object3D[] = [];
      root.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
      let pending: Promise<void>;
      try { pending = target ? r.compileAsync!(root, cam, target) : r.compileAsync!(root, cam); }
      finally { for (const o of culled) o.frustumCulled = true; }
      // a compile that never answers (a lost device, a driver that hangs) must not hold the frames for good
      let timer = 0, completed = false;
      try {
        await Promise.race([pending, new Promise<void>((_, reject) => { timer = window.setTimeout(() => reject(new Error(`a compile step took more than ${STEP_LIMIT_MS} ms`)), STEP_LIMIT_MS); })]);
        completed = !given; // input that took the scene back mid-step leaves the rest of the step compiled in the wrong state
      } finally { window.clearTimeout(timer); giveBack(); }
      return completed;
    };
    // a step that input cut short is done again, when the stage is quiet again
    for (const b of branches) {
      do {
        while (gen === warmGen && !warmQuiet()) await pause(500);
        if (gen !== warmGen) return false;
      } while (!(await step(b, camera, scene)));
      await nextFrameWarm();
    }
    do {
      while (gen === warmGen && !warmQuiet()) await pause(500);
      if (gen !== warmGen) return false;
    } while (!(await step(scene, camera)));
    // The level's own inset scenes are left for its entry (warmPiece): asking a hidden level for its insets lays their legend
    // out from elements that have no size yet, and the layout is kept (the Optics note landed over its inset).
    performance.mark(`p2p:prewarmed-${id}`);
    return gen === warmGen;
  }

  const stage: Stage = {
    registerPiece(id, build) { builders.set(id, build); },

    announceEntry(id) {
      // Only a first visit is veiled: it compiles its pipelines behind the veil anyway (warmPiece), and a level seen
      // before comes back in a few hundred milliseconds, where a veil that came and went would only flicker.
      if (graphicsLost || id === activeId || tapEntry !== null) return;
      if ((visits.get(id) ?? 0) >= (id === 'camera' ? 2 : 1)) return;
      tapEntry = id;
      window.clearTimeout(tapTimer);
      // showPiece takes the announcement over; if the tap never reaches it (the state did not change), the veil goes
      tapTimer = window.setTimeout(() => { if (tapEntry === id) { tapEntry = null; syncVeil(); } }, 2500);
      syncVeil();
      invalidate();
    },

    showPiece(id, title, sub) {
      // the title and subline follow the scenario even when the piece stays (a focus drag changes the subline)
      const outgoingTitle = dom.hudTitle.textContent ?? '', outgoingSub = dom.hudSub.textContent ?? '';
      if (heldHud && heldHud.id === id) heldHud = { id, title, sub: glueUnits(upperKeepMicro(sub)) };
      else {
        heldHud = null;
        dom.hudTitle.textContent = title;
        dom.hudSub.textContent = glueUnits(upperKeepMicro(sub));
      }
      if (graphicsLost) {
        // Preserve navigation for Restore without allocating on a lost device.
        activeId = id;
        selectedPin = null;
        syncVeil();
        return;
      }
      if (activeId === id) return;
      if (tapEntry !== null) { tapEntry = null; window.clearTimeout(tapTimer); }
      cancelWarm(); // a precompile in flight gives the scene back before the level changes
      // A short crossfade joins inspection scales without pretending their different coordinate systems are one.
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dom.canvas.getAnimations().forEach(animation => animation.cancel());
        dom.canvas.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      }
      if (activeId) {
        const prev = built.get(activeId);
        if (prev) { prev.group.visible = false; prev.deactivate?.(); }
        const ov = overlays.get(activeId);
        if (ov) ov.hidden = true;
      }
      // Shared chrome belongs to the incoming level. Some levels have no badge,
      // so leaving the previous text in place mislabels their size/light counts.
      badge.hide();
      labels.clear();
      syncAspect();
      const handle = ensureBuilt(id);
      if (!compiledPieces.has(id)) entryCompile = id;
      activeId = id;
      selectedPin = null;
      enteringPiece = true;
      handle.group.visible = true;
      handle.activate?.();
      const ov = overlays.get(id);
      if (ov) ov.hidden = false;
      dom.hudTitle.textContent = title;
      dom.hudSub.textContent = glueUnits(upperKeepMicro(sub));
      forceMeasure = true;
      measure(performance.now());
      startDive(handle.frame());
      syncPinEls(handle);
      warmPiece(id, handle);
      if (warming.has(id)) {
        // a first visit: the last frame of the level just left stays under the veil, so its words stay too
        heldHud = { id, title, sub: glueUnits(upperKeepMicro(sub)) };
        warmTitle = title;
        dom.hudTitle.textContent = outgoingTitle;
        dom.hudSub.textContent = outgoingSub;
      }
      syncVeil();
      start();
    },

    update(model, scenario) {
      if (!activeId || graphicsLost) return;
      latest = { model, scenario };
      if (!warmLoop) { window.clearTimeout(warmRearm); warmRearm = window.setTimeout(armWarm, 1500); }
      const handle = built.get(activeId);
      // scaleLabel/scaleBar stay unused (see index.html's #scalebar) until a piece has real, calibrated
      // geometry to measure -- an axis-line stub has no true scale to report.
      // a level that took this very model while it was hidden (precompileLevel) has it already: its first entry does not
      // trace the rays a second time (a task of 120 to 600 ms on a 4x phone); only the first entry skips, once
      const ahead = handle ? appliedAhead.get(handle) : undefined;
      if (handle) appliedAhead.delete(handle);
      if (!(ahead && ahead.model === model && ahead.scenario === scenario)) handle?.update(model, scenario);
      if (handle?.selectionFrame && selectedPin) startDive(selectedFrame(handle, handle.frame()));
      start();
    },

    orbit(across, vertical) { orbitBy(across * ORBIT_STEP, vertical * ORBIT_STEP); },

    resetView() {
      if (!activeId || graphicsLost) return;
      forceMeasure = true;
      measure(performance.now());
      const handle = built.get(activeId);
      if (handle) {
        if (selectedPin && !handle.selectionFrame) handle.select?.(selectedPin);
        else startDive(selectedFrame(handle, handle.frame()));
      }
      start();
    },

    selectPin(id) {
      selectedPin = id;
      invalidate();
      if (graphicsLost) return;
      forceMeasure = true;
      measure(performance.now());
      const handle = activeId ? built.get(activeId) : undefined;
      handle?.select?.(id);
      if (handle?.selectionFrame) startDive(selectedFrame(handle, handle.frame()));
      for (const [pid, el] of pinEls) el.classList.toggle('on', pid === id);
      // Selection also opens/closes the part card later in this event. Measure that
      // resulting layout on the next draw instead of waiting for the idle throttle.
      forceMeasure = true;
    },

    backend() { return backendKind; },
    framing() {
      // Before the entry's first draw, a view that has reshaped since showPiece fitted the camera is fitted again, as
      // the first draw would (the frame a test reads here is the one that draw shows).
      if (enteringPiece && activeId && !graphicsLost) {
        const active = built.get(activeId);
        if (active?.selectionFrame && !manuallyMoved && (dom.view.clientWidth !== framedW || dom.view.clientHeight !== framedH)) {
          syncAspect(); startDive(selectedFrame(active, active.frame()));
        }
      }
      return { piece: activeId, selected: selectedPin, position: camera.position.toArray(), target: controls.target.toArray(), moving: !!diveTo };
    },
    pipelineStats() {
      const r = renderer as unknown as { _nodes?: { nodeBuilderCache?: Map<unknown, unknown> }; _pipelines?: { caches?: Map<unknown, unknown> } };
      const builders = r._nodes?.nodeBuilderCache?.size, pipelines = r._pipelines?.caches?.size;
      return typeof builders === 'number' && typeof pipelines === 'number' ? { builders, pipelines, drawCalls: renderer.info.render.drawCalls } : null;
    },
    drawStats() { return { frames: drawStats.frames, draws: drawStats.draws, ms: Math.round(drawStats.ms), why: { ...drawStats.why } }; },
    qualityTier() { return tier; },

    async gpuIdle() {
      const b = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } };
      if (b.isWebGPUBackend && b.device) await b.device.queue.onSubmittedWorkDone();
      else await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },

    settle(): Promise<void> {
      if (graphicsLost) return Promise.reject(new Error('The graphics device was lost. Restore the 3D view.'));
      // a level compiling ahead on its first visit holds its frames: settle after it (warmPiece), two frames on, so the
      // chrome measured in the first frame after the hold and any refit it causes are in the picture
      const warm = activeId ? warming.get(activeId) : undefined;
      if (warm) return warm.ready.then(() => stage.settle()).then(() => stage.settle());
      // a piece tracing a drag preview owes its full trace: a settled picture is the full one (score loop r6)
      if (activeId) built.get(activeId)?.flush?.();
      return new Promise<void>((resolve, reject) => {
        settleResolvers.push({ resolve, reject });
        start();
      });
    },

    activeProbes() {
      const h = activeId ? built.get(activeId) : null;
      return h ? h.probes : [];
    },

    pieceHooks(id) {
      // A test or accuracy hook can change the scene directly (setView, fire, seek): draw the frames after it.
      const hooks = ensureBuilt(id).hooks ?? {};
      return new Proxy(hooks, {
        get(target, key) {
          const fn = (target as Record<string | symbol, unknown>)[key];
          if (typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            invalidate(400);
            const result = (fn as (...a: unknown[]) => unknown).apply(target, args);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              (result as Promise<unknown>).then(() => invalidate(400), () => invalidate(400));
            }
            return result;
          };
        },
      });
    },

    pins() {
      const out: PinScreen[] = [];
      for (const [id, el] of pinEls) {
        out.push({
          id, label: el.querySelector('.lbl')?.textContent ?? '',
          x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
          anchorX: pinAnchors.get(id)?.x ?? 0, anchorY: pinAnchors.get(id)?.y ?? 0,
          on: id === selectedPin,
        });
      }
      return out;
    },

    dispose() {
      document.getElementById('zoom-in')?.removeEventListener('click', zoomIn);
      document.getElementById('zoom-out')?.removeEventListener('click', zoomOut);
      dom.canvas.removeEventListener('keydown', zoomKeys); dom.canvas.removeEventListener('keydown', orbitKeys);
      document.removeEventListener('workspace-view', workspaceView);
      running = false;
      window.clearTimeout(sleepTimer); sleeping = false;
      void renderer.setAnimationLoop(null);
      stopLoading();
      veilButton?.removeEventListener('click', onVeilButton);
      keepButton?.removeEventListener('click', onKeepButton);
      window.clearInterval(veilFitTimer);
      window.clearTimeout(tapTimer);
      warmGen++; abortWarmStep(); window.clearTimeout(warmRearm);
      for (const name of ['touchstart', 'pointermove', 'scroll'] as const) document.removeEventListener(name, onTouch, { capture: true });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('scroll', checkVisible);
      window.removeEventListener('resize', checkVisible);
      for (const name of inputEvents) document.removeEventListener(name, onInput, { capture: true });
      dom.view.removeEventListener('pointermove', onViewPointer);
      offAnyEvent();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      controls.dispose();
      for (const handle of built.values()) handle.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  return stage;
}
