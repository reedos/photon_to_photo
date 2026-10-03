// The WebGPU/WebGL2 renderer, camera rig, PMREM environment, resize/off-screen pause, quality tier, and the
// pin/HUD label overlay projection -- docs/PROTOTYPE.md's "src/app/stage.ts" and "Rendering decisions".
//
// Direct renderer.render(scene, camera), no RenderPipeline/EffectComposer in this prototype (docs/PROTOTYPE.md).
// `?gl=webgl2` forces the WebGL2 backend; the real backend obtained is always reported truthfully, even when it
// silently differs from what was asked for (the same "silent fallback" gotcha the rendering spike names).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import type { BuildPiece, CameraFrame, Inset, LabelLayer, PieceHandle, PieceProbe, ScaleBadge } from '../pieces/types';
import * as look from './look';
import * as bus from './bus';
import { upperKeepMicro } from './units';

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
  on: boolean;
}

export interface Stage {
  registerPiece(id: string, build: BuildPiece): void;
  showPiece(id: string, title: string, sub: string): void;
  update(model: Model, scenario: Scenario): void;
  resetView(): void;
  selectPin(id: string | null): void;
  backend(): Backend;
  qualityTier(): QualityTier;
  gpuIdle(): Promise<void>;
  settle(): Promise<void>;
  pins(): PinScreen[];
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

  const renderer = new THREE.WebGPURenderer({ canvas: dom.canvas, antialias: true, forceWebGL });
  await renderer.init();
  const backendKind: Backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';
  dom.backendChip.textContent = backendKind === 'webgpu' ? 'WEBGPU' : 'WEBGL2';
  dom.backendChip.classList.toggle('webgl2', backendKind === 'webgl2');
  dom.backendChip.prepend((() => { const d = document.createElement('i'); d.className = 'dot2'; return d; })());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
  camera.position.set(0, 25, 140);
  const controls = new OrbitControls(camera as unknown as THREE.Camera, dom.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // The wheel scrolls the page; Ctrl or Cmd with it (and a trackpad pinch, which arrives as ctrl+wheel) zooms. Without
  // this a reader scrolling down the page gets stuck zooming the camera the moment the pointer crosses the view.
  let wheelHinted = false;
  dom.canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); return; }   // OrbitControls zooms; the page must not
    e.stopImmediatePropagation();
    if (!wheelHinted) {
      wheelHinted = true;
      const t = document.getElementById('toast');
      if (t) {
        t.textContent = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Hold Cmd and scroll to zoom' : 'Hold Ctrl and scroll to zoom';
        t.classList.remove('select');
        t.hidden = false;
        window.setTimeout(() => { t.hidden = true; }, 2200);
      }
    }
  }, { capture: true, passive: false });

  // ---- procedural PMREM environment + key/fill lights (design/LOOK.md: "not a photographic HDRI") -------------
  // Factored into look.ts (09/28/2026, lens-exteriors workstream) so src/scene/lens-preview.ts's standalone
  // page gets the exact same look without a second hand-copy of this geometry/color logic.
  const pmrem = look.buildEnvironmentAndLights(renderer, scene);

  // ---- pieces ----------------------------------------------------------------------------------------------
  const builders = new Map<string, BuildPiece>();
  const built = new Map<string, PieceHandle>();
  let activeId: string | null = null;

  const labelEls = new Map<string, HTMLElement>();
  const labels: LabelLayer = {
    set(id, opts) {
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
    },
    remove(id) {
      const el = labelEls.get(id);
      if (el) { el.remove(); labelEls.delete(id); }
    },
    clear(prefix) {
      for (const [id, el] of labelEls) {
        if (!prefix || id.startsWith(prefix)) { el.remove(); labelEls.delete(id); }
      }
    },
  };

  const badge: ScaleBadge = {
    show(text) { if (dom.scaleBadge.textContent !== text) dom.scaleBadge.textContent = text; dom.scaleBadge.hidden = false; },
    hide() { dom.scaleBadge.hidden = true; },
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
        dom.view.appendChild(el);
        insetEls.set(inset.id, el);
      }
      const r = inset.rect;
      el.style.left = `${r.left}px`;
      el.style.bottom = `${r.bottom}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.dataset.label = inset.label ?? '';
    }
  }

  function ensureBuilt(id: string): PieceHandle {
    let handle = built.get(id);
    if (!handle) {
      const build = builders.get(id);
      if (!build) throw new Error(`stage.ts: no piece registered for "${id}"`);
      handle = build({ renderer, look, labels, badge, camera, scene, overlay: pieceOverlay(id), dive: (to) => {
        if (activeId === id) startDive(to);
      }, bus });
      handle.group.visible = false;
      scene.add(handle.group);
      built.set(id, handle);
    }
    return handle;
  }

  // ---- pins (from the active piece's probes) -----------------------------------------------------------------
  const pinEls = new Map<string, HTMLButtonElement>();
  let selectedPin: string | null = null;

  function syncPinEls(handle: PieceHandle | null) {
    for (const [id, el] of pinEls) { el.remove(); pinEls.delete(id); }
    if (!handle) return;
    handle.probes.forEach((probe, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin';
      el.dataset.pinId = probe.id;
      el.innerHTML = `<span class="num">${i + 1}</span><span class="lbl">${probe.label}</span>`;
      el.setAttribute('aria-label', `${i + 1}. ${probe.label}`);
      el.addEventListener('click', () => {
        const id = selectedPin === probe.id ? null : probe.id;
        stage.selectPin(id);
        bus.emit('select-part', { id });
      });
      dom.pins.appendChild(el);
      pinEls.set(probe.id, el);
    });
  }

  // ---- camera dive between pieces --------------------------------------------------------------------------
  let diveFrom: CameraFrame | null = null;
  let diveTo: CameraFrame | null = null;
  let diveStart = 0;
  let diveMs = 0;

  function startDive(to: CameraFrame) {
    if (reducedMotion()) {
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      diveTo = null;
      return;
    }
    const distFrom = camera.position.distanceTo(controls.target) || 1;
    const distTo = to.position.distanceTo(to.target) || 1;
    const decades = Math.abs(Math.log10(distTo / distFrom));
    diveMs = Math.min(DIVE_MAX_MS, DIVE_BASE_MS + DIVE_PER_DECADE_MS * decades);
    diveFrom = { position: camera.position.clone(), target: controls.target.clone() };
    diveTo = to;
    diveStart = performance.now();
  }

  function tickDive(now: number) {
    if (!diveTo || !diveFrom) return;
    const t = Math.min(1, (now - diveStart) / diveMs);
    const e = diveEase(t);
    camera.position.lerpVectors(diveFrom.position, diveTo.position, e);
    controls.target.lerpVectors(diveFrom.target, diveTo.target, e);
    if (t >= 1) diveTo = null;
  }

  // ---- resize, DPR cap by quality tier, off-screen pause -----------------------------------------------------
  let tier: QualityTier = 'high';
  function pixelRatioCap(): number {
    return tier === 'phone' ? 1.5 : tier === 'mid' ? 2 : Math.min(2.5, window.devicePixelRatio || 1);
  }
  let forceMeasure = true;   // set on resize: the insets and the lens shift are measured again on the next frame
  function applySize() {
    const w = dom.view.clientWidth || 1;
    const h = dom.view.clientHeight || 1;
    camera.aspect = w / h;
    forceMeasure = true;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
    renderer.setSize(w, h, false);
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => applySize()) : null;
  resizeObserver?.observe(dom.view);
  applySize();

  // Off-screen pause. The observer alone proved unreliable (headless Chrome with WebGPU left the loop paused after
  // a scroll brought the view on screen, so the camera never drew), so a scroll or resize also re-checks the view's
  // rectangle directly; either one saying "on screen" restarts drawing.
  let visible = true;
  const checkVisible = () => {
    const r = dom.view.getBoundingClientRect();
    visible = r.bottom > 0 && r.top < (window.innerHeight || 1) && r.width > 0;
  };
  const intersectionObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) checkVisible(); }, { threshold: 0.01 })
    : null;
  intersectionObserver?.observe(dom.view);
  window.addEventListener('scroll', checkVisible, { passive: true });
  window.addEventListener('resize', checkVisible);

  // A piece fetching its models veils the view with its progress and holds its pins back, so nothing piles up at the
  // origin before there is a model to pin (UI-21).
  const loadingPieces = new Map<string, { progress?: number; label?: string }>();
  const veilMsg = document.getElementById('veil-msg');
  const veilBar = document.getElementById('veil-bar');
  bus.on('piece-loading', (e) => {
    if (e.error) {
      dom.veil.classList.remove('off');
      dom.veil.classList.add('err');
      if (veilMsg) veilMsg.textContent = e.error;
      loadingPieces.set(e.id, { label: e.error });
      return;
    }
    if (e.loading) loadingPieces.set(e.id, { progress: e.progress, label: e.label });
    else loadingPieces.delete(e.id);
    syncVeil();
  });
  function syncVeil() {
    const l = activeId ? loadingPieces.get(activeId) : undefined;
    dom.pins.classList.toggle('held', !!l);
    if (l) {
      dom.veil.classList.remove('off');
      if (veilMsg && l.label) veilMsg.textContent = l.label;
      if (veilBar) veilBar.style.width = `${Math.round((l.progress ?? 0.05) * 100)}%`;
    }
  }

  // A simple, measured-frame-time quality governor: sustained slow frames drop a tier; this prototype's stub
  // pieces are cheap, so in practice this only matters once the real set pieces (glass/transmission) land, but
  // the plumbing -- and the DPR/tier effect it has right now -- is real and observable in the screenshots.
  let slowFrames = 0;
  const SLOW_MS = 1000 / 24;
  function governQuality(frameMs: number) {
    if (frameMs > SLOW_MS) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && tier !== 'phone') {
      tier = tier === 'high' ? 'mid' : 'phone';
      slowFrames = 0;
      applySize();
    }
  }

  // ---- render loop ------------------------------------------------------------------------------------------
  let running = false;
  let lastFrameTime = performance.now();
  let settleResolvers: (() => void)[] = [];

  /** The actual draw work, shared by the paused-off-screen ambient loop and settle()'s forced frame. */
  function drawFrame(now: number) {
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    governQuality(dt);
    tickDive(now);
    controls.update();
    const active = activeId ? built.get(activeId) : null;
    active?.tick?.(dt, now);
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
      r.setViewport(0, 0, w, h);
      r.autoClear = autoClear;
    }
    syncInsetFrames(insets);
    projectLabelsAndPins(now);
    if (!(activeId && loadingPieces.has(activeId))) dom.veil.classList.add('off');
    const resolvers = settleResolvers;
    settleResolvers = [];
    for (const r of resolvers) r();
  }

  function frame(now: number) {
    if (!running) return;
    requestAnimationFrame(frame);
    // Off-screen pause (design/LOOK.md-adjacent perf rule, docs/PROTOTYPE.md's "pause when the view is off
    // screen") applies only to this ambient loop. settle() below forces its own frame regardless of `visible`:
    // a caller that explicitly asks "is my update on screen yet" is not asking the idle loop's question, and
    // gating it the same way made p2p.settle() hang forever whenever the stage started below the fold (e.g. a
    // screenshot tool that never scrolls) -- found running tools/shot.mjs against this same page.
    if (!visible) return;
    drawFrame(now);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(frame);
  }

  // ---- view insets: the fitted camera centers the model in the part of the view the chrome leaves free ---------------
  // Elements marked data-inset (the title, the exposure panel, the switches on a phone) are measured every so often;
  // a lens shift (camera.setViewOffset) moves the picture's center into the free rectangle, and the piece reads the
  // same numbers from camera.userData.insets to fit its framing into that rectangle (UI-10, FID-9). Only the camera
  // level uses them; the deep dives frame themselves as before.
  type Rect = { l: number; t: number; r: number; b: number };
  let exclusion: Rect[] = [];
  let lastMeasure = -1e9;
  const insets = { left: 0, top: 0, right: 0, bottom: 0 };
  function measure(now: number) {
    if (!forceMeasure && now - lastMeasure < 280) return;
    const forced = forceMeasure;
    forceMeasure = false;
    lastMeasure = now;
    const vr = dom.view.getBoundingClientRect();
    if (vr.width < 2) return;
    const narrow = vr.width < 560;
    const rel = (r: DOMRect): Rect => ({ l: r.left - vr.left, t: r.top - vr.top, r: r.right - vr.left, b: r.bottom - vr.top });
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    // chrome the pins and their labels must stay clear of
    exclusion = [];
    const sel = '.hud.tl > *, .hud.tr > *, .hud.br > *, .hud.bl > *, .hud.rail > *, .piece-overlay:not([hidden]) > *, .toast';
    for (const el of dom.view.querySelectorAll(sel)) {
      if (el.classList.contains('hint') || el.classList.contains('hud-slot') || !shown(el)) continue;
      if (el.classList.contains('rig-teach') || el.classList.contains('rig-tip') || el.classList.contains('rig-note') || el.classList.contains('mode-slotted')) continue;
      if (el.classList.contains('hud-switches') || el.classList.contains('hud-btns')) {
        for (const c of el.querySelectorAll('button, .mode')) if (shown(c)) exclusion.push(rel(c.getBoundingClientRect()));
        continue;
      }
      exclusion.push(rel(el.getBoundingClientRect()));
    }
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
    next.right = Math.round(Math.min(next.right, vr.width * 0.3));
    if (activeId !== 'camera') { next.left = next.top = next.right = next.bottom = 0; }
    if (forced || next.left !== insets.left || next.top !== insets.top || next.right !== insets.right || next.bottom !== insets.bottom) {
      Object.assign(insets, next);
      applyViewOffset();
    }
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
  function projectLabelsAndPins(now = performance.now()) {
    camera.updateMatrixWorld(true); // required before any project() call -- rendering spike gotcha 3
    const remeasured = forceMeasure || now - lastMeasure >= 280;
    measure(now);
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
    const narrow = w < 560;
    type P = { id: string; i: number; el: HTMLButtonElement; x: number; y: number; z: number; show: boolean };
    const ps: P[] = [];
    handle.probes.forEach((probe, i) => {
      const el = pinEls.get(probe.id);
      if (!el) return;
      const p = handle.group.localToWorld(probe.anchor.clone()).project(camera);
      const x = ((p.x + 1) / 2) * w, y = ((1 - p.y) / 2) * h;
      const inView = p.z < 1 && p.z > -1 && x > 6 && x < w - 6 && y > 6 && y < h - 6;
      // a pin under the chrome is hidden, not drawn over it; the list still reaches it
      const underChrome = exclusion.some((r) => x > r.l - 12 && x < r.r + 12 && y > r.t - 12 && y < r.b + 12);
      ps.push({ id: probe.id, i, el, x, y, z: p.z, show: inView && (!underChrome || probe.id === selectedPin) });
    });
    // merge pins that land on top of each other into one ("1·2"); the lower number leads. A merged pill is wider than
    // a pin, so the pass repeats with each pill's real width until nothing it grew into is left touching it (R2-04).
    const merged = new Map<string, number[]>();
    for (const p of ps) if (p.show) merged.set(p.id, [p.i]);
    const halfW = (p: P) => { const m = merged.get(p.id)!; return m.length > 1 ? (m.map((k) => k + 1).join('·').length * 7 + 14) / 2 : 11; };
    for (let again = true, guard = 0; again && guard < 12; guard++) {
      again = false;
      const live = ps.filter((p) => p.show).sort((a, b) => a.i - b.i);
      for (let a = 0; a < live.length && !again; a++) for (let b = a + 1; b < live.length && !again; b++) {
        const A = live[a], B = live[b];
        if (A.id === selectedPin || B.id === selectedPin) continue;
        if (Math.abs(A.x - B.x) < halfW(A) + halfW(B) + 2 && Math.abs(A.y - B.y) < 24) {
          merged.get(A.id)!.push(...merged.get(B.id)!);
          merged.get(A.id)!.sort((x, y) => x - y);
          merged.delete(B.id);
          B.show = false;
          again = true;
        }
      }
    }
    // labels: the selected pin first, then nearest first; right, left, above or below, whichever clears everything
    const placed: Rect[] = [...exclusion];
    const pinRect = (p: P): Rect => { const hw = (merged.has(p.id) ? halfW(p) : 11) + 1; return { l: p.x - hw, t: p.y - 12, r: p.x + hw, b: p.y + 12 }; };
    for (const p of ps) if (p.show) placed.push(pinRect(p));
    const order = ps.filter((p) => p.show).sort((a, b) => (a.id === selectedPin ? -1 : b.id === selectedPin ? 1 : a.z - b.z));
    const placement = new Map<string, string>();
    const twoLine = new Map<string, number>();
    for (const p of order) {
      const lbl = p.el.querySelector('.lbl') as HTMLElement | null;
      const merges = (merged.get(p.id)?.length ?? 1) > 1;
      const wantLabel = selectedPin ? p.id === selectedPin : !narrow && !merges;
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
      if (!got && p.id === selectedPin) got = cands.find((c) => c[1].l >= 4 && c[1].r <= w - 4) ?? cands[0];
      if (got) { placed.push(got[1]); placement.set(p.id, got[0]); } else placement.set(p.id, 'none');
      if (two) twoLine.set(p.id, two); else twoLine.delete(p.id);
    }
    // Every pin stays whole inside the view with a 12 px margin (a merged "6·7" pill included), and the picked one
    // stays inside the free rectangle the chrome leaves (R1-FID-I, R1-04).
    const ins = insets;
    for (const p of ps) {
      const el = p.el;
      el.style.display = p.show ? '' : 'none';
      if (!p.show) continue;
      const m0 = merged.get(p.id) ?? [p.i];
      const half = m0.length > 1 ? (m0.map((k) => k + 1).join('·').length * 7 + 14) / 2 : 11;
      const [l, r, t, b] = p.id === selectedPin && activeId === 'camera'
        ? [ins.left + 12 + half, w - ins.right - 12 - half, ins.top + 23, h - ins.bottom - 23]
        : [12 + half, w - 12 - half, 23, h - 23];
      if (r > l) p.x = Math.min(r, Math.max(l, p.x));
      if (b > t) p.y = Math.min(b, Math.max(t, p.y));
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      const probe = handle.probes[p.i];
      const lblEl = el.querySelector('.lbl');
      if (lblEl && probe && lblEl.textContent !== probe.label) { lblEl.textContent = probe.label; el.setAttribute('aria-label', `${p.i + 1}. ${probe.label}`); }
      const on = p.id === selectedPin;
      el.classList.toggle('on', on);
      el.classList.toggle('dim', !!selectedPin && !on);
      const m = merged.get(p.id) ?? [p.i];
      el.classList.toggle('merged', m.length > 1);
      const num = el.querySelector('.num') as HTMLElement;
      const txt = m.map((k) => k + 1).join('·');
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

  const stage: Stage = {
    registerPiece(id, build) { builders.set(id, build); },

    showPiece(id, title, sub) {
      // the title and subline follow the scenario even when the piece stays (a focus drag changes the subline)
      dom.hudTitle.textContent = title;
      dom.hudSub.textContent = upperKeepMicro(sub);
      if (activeId === id) return;
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
      const handle = ensureBuilt(id);
      activeId = id;
      handle.group.visible = true;
      handle.activate?.();
      const ov = overlays.get(id);
      if (ov) ov.hidden = false;
      selectedPin = null;
      dom.hudTitle.textContent = title;
      dom.hudSub.textContent = upperKeepMicro(sub);
      forceMeasure = true;
      measure(performance.now());
      startDive(handle.frame());
      syncPinEls(handle);
      syncVeil();
      start();
    },

    update(model, scenario) {
      if (!activeId) return;
      const handle = built.get(activeId);
      // scaleLabel/scaleBar stay unused (see index.html's #scalebar) until a piece has real, calibrated
      // geometry to measure -- an axis-line stub has no true scale to report.
      handle?.update(model, scenario);
      start();
    },

    resetView() {
      if (!activeId) return;
      const handle = built.get(activeId);
      if (handle) startDive(handle.frame());
      start();
    },

    selectPin(id) {
      selectedPin = id;
      if (activeId) built.get(activeId)?.select?.(id);
      for (const [pid, el] of pinEls) el.classList.toggle('on', pid === id);
    },

    backend() { return backendKind; },
    qualityTier() { return tier; },

    async gpuIdle() {
      const b = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } };
      if (b.isWebGPUBackend && b.device) await b.device.queue.onSubmittedWorkDone();
      else await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },

    settle() {
      start(); // keeps the ambient loop running too, so it doesn't stop right after this forced frame
      return new Promise<void>((resolve) => {
        settleResolvers.push(resolve);
        requestAnimationFrame(drawFrame); // forced, unconditional on `visible` -- see frame()'s comment above
      });
    },

    activeProbes() {
      const h = activeId ? built.get(activeId) : null;
      return h ? h.probes : [];
    },

    pieceHooks(id) {
      return ensureBuilt(id).hooks ?? {};
    },

    pins() {
      const out: PinScreen[] = [];
      for (const [id, el] of pinEls) {
        out.push({
          id, label: el.querySelector('.lbl')?.textContent ?? '',
          x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
          on: id === selectedPin,
        });
      }
      return out;
    },

    dispose() {
      running = false;
      window.removeEventListener('scroll', checkVisible);
      window.removeEventListener('resize', checkVisible);
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
