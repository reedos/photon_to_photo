// Firing the shutter on the camera (docs/PANE.md, "Shutter speed as time"): the release and the exposure, played at
// stated slow-motion factors, with photons streaming along the engine's traced on-axis paths while the shutter is
// open, and a counter that climbs to the engine's own count. Every number comes from the model or the hardware data:
//   - release lag: 76 ms, the D850's lab-measured release-to-exposure lag, which includes the mirror flipping up
//     (data/hardware/dslr.json timing.shutterLag, reported); no maker publishes the mirror's own share, so the
//     mirror is drawn moving inside that measured window and the caption says so;
//   - curtain travel: 4 ms (data/hardware/body.json shutter.curtainTravelMs, derived from the 1/250 s sync);
//   - electronic readout: 3.6 ms full frame for the Z8 (data/z8.json sensor.readout.electronicFullFrameMs, reported,
//     low confidence);
//   - photons: model.exposure.photonsMidGray per pixel for an 18 % gray scene, times the pixel count for the sensor.
// Each time scale is badged. The photons' flight is drawn at one fixed visual speed: light crosses the camera in about
// half a nanosecond, which no slow-motion factor that also shows the shutter could make visible, and the badge says so.
import * as THREE from 'three/webgpu';
import type { Model } from '../engine/model-types';
import type { ScaleBadge } from '../pieces/types';
import type { Scenario } from '../engine/types';
import { fmtFno, fmtPow10, fmtRange, fmtSci, fmtShutter as fmtShutterS } from '../app/units';
import { equalExposureStep } from '../app/exposure-eq';
import { badgeJoin } from '../pieces/phone-frame';
import { motionOf } from '../app/motion';
import dslrHw from '../../data/hardware/dslr.json';
import bodyHw from '../../data/hardware/body.json';
import z8 from '../../data/z8.json';

const RELEASE_LAG_MS = (dslrHw as any).timing.shutterLag.v as number;                    // 76, reported
const CURTAIN_MS = (bodyHw as any).shutter.curtainTravelMs.v as number;                   // 4, derived
const READOUT_MS = (z8 as any).sensor.readout.electronicFullFrameMs.v as number;          // 3.6, reported (low confidence)
const FLIGHT_MS = 420;            // visual flight time of a drawn photon, front of the scene to the sensor
const TARGET_EXPOSURE_MS = 2600;  // the exposure segment plays in about this long, at a 1-2-5 factor
const TARGET_RELEASE_MS = 900;
const DOTS = 700;                 // about this many dots over an exposure

/** The largest 1-2-5 step <= x (x > 0). */
function niceFloor(x: number): number {
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * 10 ** e;
}
function factorText(f: number): string {
  return f >= 1 ? `time slowed ${Math.round(f).toLocaleString('en-US')}×` : `time sped up ${Math.round(1 / f).toLocaleString('en-US')}×`;
}
const sci = (n: number) => fmtSci(n);

export interface ExposureDeps {
  group: THREE.Group;
  overlay: HTMLElement;
  badge: ScaleBadge;
  body(): 'dslr' | 'mirrorless';
  model(): Model | null;
  /** The on-axis traced paths, world frame (mm), with their wavelengths. */
  paths(): { pts: THREE.Vector3[]; color: THREE.Color }[];
  node(name: string): THREE.Object3D | undefined;
  /** The mirror went up (true) or came down (false): the light's path changes with it. */
  onMirror?(up: boolean): void;
  /** Called as a shot starts and after it ends (the camera opens its cutaway for the shot and closes it again). */
  beforeFire?(): void;
  afterFire?(): void;
  /** Sets part of the scenario (the equal-exposure control trades aperture for shutter through it). */
  set?(partial: Partial<Scenario>): void;
  /** Optional override for deterministic tests; otherwise follows the reader's system preference. */
  reducedMotion?(): boolean;
}

type Seg = { name: 'release' | 'exposure' | 'return'; realMs: number; factor: number };

export function createExposure(d: ExposureDeps) {
  // ---- the HUD -------------------------------------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'rig-exposure';
  hud.setAttribute('data-fired', 'false');
  hud.innerHTML = `
    <div class="rx-head"><span class="rx-k">Exposure</span><button type="button" class="btn rx-fire" title="Fire the shutter (F)">Play exposure <kbd>F</kbd></button></div>
    <div class="rx-row rx-pprow"><span>Photons per pixel <small>18% gray</small></span><b class="rx-pp">0</b></div>
    <div class="rx-row rx-total"><span>Whole sensor</span><b class="rx-all">0</b></div>
    <div class="rx-well"><i></i></div>
    <div class="rx-row rx-sub"><span class="rx-wellk">Well 0% full</span><span class="rx-snr"></span></div>
    <div class="rx-row rx-motion" hidden><span>Streak on the sensor</span><b class="rx-motion-v"></b></div>
    <div class="rx-tl" aria-hidden="true" hidden></div>
    <div class="rx-playback" hidden>
      <div class="rx-playback-head"><button type="button" class="btn rx-pause">Pause</button><span class="rx-phase"></span></div>
      <label class="rx-scrub-label">Inspect the exposure<input class="rx-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Exposure playback position"></label>
      <span class="rx-time"></span>
    </div>
    <p class="rx-status" role="status" aria-live="polite"></p>
    <div class="rx-eq">
      <div class="rx-eq-k"><span>Equal exposure</span><span>±1 stop</span></div>
      <div class="rx-eq-btns">
        <button type="button" class="btn rx-eq-open" data-eq="open" title="Open the aperture one stop and halve the time"></button>
        <button type="button" class="btn rx-eq-close" data-eq="close" title="Close the aperture one stop and double the time"></button>
      </div>
      <p class="rx-eq-note" hidden></p>
    </div>
    <p class="rx-cap"></p>`;
  d.overlay.appendChild(hud);
  const q = (s: string) => hud.querySelector(s) as HTMLElement;
  q('.rx-fire').addEventListener('click', () => fire());
  q('.rx-eq-open').addEventListener('click', () => equalStep(-1));
  q('.rx-eq-close').addEventListener('click', () => equalStep(1));
  q('.rx-pause').addEventListener('click', () => { if (paused || !running) resume(); else pause(); });
  q('.rx-scrub').addEventListener('input', (event) => seek(Number((event.target as HTMLInputElement).value) / 1000));

  // ---- equal exposure (docs/PANE.md, "Light and exposure"): one stop of aperture for one stop of shutter ---------
  // The f-number moves by exactly the square root of 2 and the time by exactly 2, so the light per pixel, which goes
  // as time over f-number squared, is the same before and after; the engine's own count shows it. What changes is the
  // depth of field (and, for a moving subject, the blur). The note compares the two, both read from the engine.
  let eqNote: { key: string; text: string } | null = null;
  const eqKey = (m: Model) => `${m.scenario.lens}|${m.scenario.fno.toFixed(4)}|${m.scenario.shutter.toPrecision(6)}|${m.scenario.iso}`;
  // a range never breaks across lines (R1-11)
  const dof = (m: Model) => `<span class="nw">${fmtRange(m.focus.nearMm, m.focus.farMm)}</span>`;
  function equalStep(dir: 1 | -1): boolean {
    const m = d.model();
    if (!m || !d.set) return false;
    const next = equalExposureStep(m.scenario, m.lens.maxFno, dir);
    if (!next) return false;
    const before = m;
    d.set(next);
    const after = d.model();
    if (!after || after === before) return false;
    const pp = (x: Model) => Math.round(x.exposure.photonsMidGray).toLocaleString('en-US');
    const same = pp(before) === pp(after);
    // Trading a stop of aperture for a stop of shutter also changes how much a moving subject streaks (the
    // shutter time changed, and the streak is speed times shutter times magnification), so the note says so
    // whenever there's a motion reading to compare (both sides read it defensively; see motion.ts).
    const mb = (x: Model) => motionOf(x)?.blurPx;
    const beforeMb = mb(before), afterMb = mb(after);
    eqNote = {
      key: eqKey(after),
      text: `<b class="nw">${fmtFno(before.scenario.fno)}</b> at <b class="nw">${fmtShutterS(before.scenario.shutter)}</b> became <b class="nw">${fmtFno(after.scenario.fno)}</b> at <b class="nw">${fmtShutterS(after.scenario.shutter)}</b>. `
        + (same ? `The same <b>${pp(after)}</b> photons reach each pixel. ` : `Photons per pixel went from <b>${pp(before)}</b> to <b>${pp(after)}</b>. `)
        + `Depth of field went from ${dof(before)} to <b>${dof(after)}</b>.`
        + (beforeMb !== undefined && afterMb !== undefined
          ? ` The moving subject's streak went from <b>${Math.round(beforeMb)} px</b> to <b>${Math.round(afterMb)} px</b>.`
          : ''),
    };
    return true;
  }
  function renderEq(m: Model) {
    const open = equalExposureStep(m.scenario, m.lens.maxFno, -1);
    const close = equalExposureStep(m.scenario, m.lens.maxFno, 1);
    const bo = q('.rx-eq-open') as HTMLButtonElement, bc = q('.rx-eq-close') as HTMLButtonElement;
    const lo = open ? `← ${fmtFno(open.fno!)} · ${fmtShutterS(open.shutter!)}` : m.scenario.fno / Math.SQRT2 < m.lens.maxFno - 1e-6 ? 'Widest already' : 'Fastest already';
    const lc = close ? `${fmtFno(close.fno!)} · ${fmtShutterS(close.shutter!)} →` : m.scenario.fno * Math.SQRT2 > 22 + 1e-6 ? 'Smallest already' : 'Longest already';
    if (bo.textContent !== lo) bo.textContent = lo;
    if (bc.textContent !== lc) bc.textContent = lc;
    if (open && !running && enabled) bo.removeAttribute('disabled'); else bo.setAttribute('disabled', '');
    if (close && !running && enabled) bc.removeAttribute('disabled'); else bc.setAttribute('disabled', '');
    const note = q('.rx-eq-note');
    const live = !!eqNote && eqNote.key === eqKey(m);
    if (!live) eqNote = null;
    note.hidden = !live;
    if (live && note.innerHTML !== eqNote!.text) note.innerHTML = eqNote!.text;
    q('.rx-pprow').setAttribute('data-held', String(live));
  }

  // ---- the firing timeline: the played segments at their played lengths, and a playhead ----------------------------
  let tlPlan = '';
  function renderTimeline(m: Model, elapsedVis: number) {
    const tl = q('.rx-tl');
    if (!shotModel) { tl.hidden = true; return; }
    tl.hidden = false;
    const total = segs.reduce((a, x) => a + x.realMs * x.factor, 0) || 1;
    const label = (x: Seg) => (x.name === 'release' ? 'Mirror up' : x.name === 'return' ? 'Mirror down' : `Open ${fmtShutterS(m.scenario.shutter)}`);
    const html = segs.map((x) => `<span>${label(x)}</span>`).join('') + '<i></i>';
    const plan = `${segs.length}:${total.toFixed(0)}:${m.scenario.shutter}`;
    if (tlPlan !== plan) { tl.innerHTML = html; tlPlan = plan; }
    // Segment widths and the native slider share the same visual-time coordinate.
    const head = tl.querySelector('i') as HTMLElement | null;
    if (head) head.style.left = `calc(${(Math.min(1, elapsedVis / total) * 100).toFixed(2)}% - 1px)`;
    let acc = 0;
    const spans = tl.querySelectorAll ? tl.querySelectorAll('span') : [];
    segs.forEach((x, i) => {
      const v = x.realMs * x.factor;
      const on = elapsedVis >= acc && elapsedVis < acc + v;
      const el = spans[i] as HTMLElement | undefined;
      if (el) { el.className = on ? 'on' : ''; el.style.flex = String(v) + ' 1 0'; }
      acc += v;
    });
  }

  // ---- the photons: one Points buffer, each dot riding a traced path ---------------------------------------------
  // Rounding the weight to a power of ten permits up to DOTS*sqrt(10) dots in a shot.
  // Every dot must fit even when a very short shutter emits them all during one visual flight.
  const MAX = Math.ceil(DOTS * Math.sqrt(10));
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const dots = new THREE.Points(geo, mat);
  dots.frustumCulled = false;
  dots.name = 'photons';
  d.group.add(dots);
  let visibleDots = 0;
  let pathCache: { pts: THREE.Vector3[]; color: THREE.Color; len: number[]; total: number }[] = [];

  // ---- the mechanism nodes -------------------------------------------------------------------------------------
  let pivot: THREE.Group | null = null;
  let mirrorUp = 0;             // radians the hinge turns to lift the mirror (sign found from the model's geometry)
  const base = new Map<string, THREE.Vector3>();
  let scan: THREE.Mesh | null = null;

  function rigMechanism() {
    const mirror = d.node('mirror');
    if (mirror && !pivot) {
      // hinge the main mirror (and the sub-mirror it carries) at its top edge
      const box = new THREE.Box3().setFromObject(mirror);
      pivot = new THREE.Group();
      pivot.position.set(0, box.max.y, (box.min.z + box.max.z) / 2 + (box.max.z - box.min.z) / 2 * 0);
      // the top edge: the vertex row with the largest y sits at one z end of the box
      const topZ = sampleTopZ(mirror);
      pivot.position.z = topZ;
      mirror.parent!.add(pivot);
      pivot.attach(mirror);
      const sub = d.node('subMirror');
      if (sub) pivot.attach(sub);
      // which way lifts it: try both, keep the one that raises the mirror's lowest point
      const low0 = new THREE.Box3().setFromObject(mirror).min.y;
      pivot.rotation.x = Math.PI / 4;
      const lowA = new THREE.Box3().setFromObject(mirror).min.y;
      pivot.rotation.x = 0;
      mirrorUp = lowA > low0 ? Math.PI / 4 : -Math.PI / 4;
    }
    for (const n of ['shutterCurtainFront', 'shutterCurtainRear']) {
      const o = d.node(n);
      if (o && !base.has(n)) base.set(n, o.position.clone());
    }
    const px = d.node('pixelArray');
    if (px && !scan && d.body() === 'mirrorless') {
      const b = new THREE.Box3().setFromObject(px);
      scan = new THREE.Mesh(new THREE.PlaneGeometry(b.max.x - b.min.x, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xe6ba82, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
      scan.position.set(0, b.max.y, 0.4);
      scan.visible = false;
      scan.name = 'readout-line';
      d.group.add(scan);
    }
  }
  function sampleTopZ(o: THREE.Object3D): number {
    let best = -Infinity, z = 0;
    o.updateWorldMatrix(true, true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        if (v.y > best + 1e-6) { best = v.y; z = v.z; }
      }
    });
    return z;
  }

  // the curtains' travel, from the pixel array's height: front covers the frame at rest and drops below it to open,
  // the rear waits above and drops to cover it. The blade stack (blender/dslr_v2.py) is built to exactly this
  // height, so a curtain recentered on the frame at rest already covers it edge to edge (coverage 1.0, Astra-6
  // finding C2); driving both curtains by exactly that same height `h` (not h plus an arbitrary margin) is what
  // makes each curtain's leading edge sweep the whole active rectangle in precisely CURTAIN_MS -- the constant
  // tick() below already assumes when it places the center row's open/close instants at CURTAIN_MS/2 and
  // CURTAIN_MS/2 + shutterMs.
  function curtainPose(frontOpen: number, rearClosed: number) {
    const f = d.node('shutterCurtainFront'), r = d.node('shutterCurtainRear');
    const px = d.node('pixelArray');
    if (!f || !r || !px) return;
    const b = new THREE.Box3().setFromObject(px);
    const h = b.max.y - b.min.y;
    const fb = base.get('shutterCurtainFront')!, rb = base.get('shutterCurtainRear')!;
    const fCenter = new THREE.Box3().setFromObject(f).getCenter(new THREE.Vector3()).y - (f.position.y - fb.y);
    const rCenter = new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).y - (r.position.y - rb.y);
    f.position.y = fb.y - fCenter - frontOpen * h;
    r.position.y = rb.y - rCenter + (1 - rearClosed) * h;
  }

  // ---- inspectable timeline: one playhead drives mechanisms, counters and photon positions -----------------------
  let segs: Seg[] = [];
  let running = false; // includes paused inspection: keep the camera's cutaway and mirror under our control
  let paused = false;
  let elapsedVis = 0;
  let anchorNow = 0;
  let anchorElapsed = 0;
  let shotModel: Model | null = null;
  let shotBody: 'dslr' | 'mirrorless' = 'dslr';
  let dotPhotons = 1;
  let dotBudget = 0;
  let shownFraction = 1;
  let mirrorIsUp = false;
  let enabled = true;
  let notice = '';
  let heldUp = false;

  const prefersReducedMotion = () => d.reducedMotion?.() ??
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const totalVisualMs = () => segs.reduce((sum, seg) => sum + seg.realMs * seg.factor, 0);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  function plan(m: Model): Seg[] {
    const dslr = shotBody === 'dslr';
    const shutterMs = m.scenario.shutter * 1000;
    const expReal = shutterMs + (dslr ? CURTAIN_MS : READOUT_MS);
    const s: Seg[] = [];
    if (dslr) s.push({ name: 'release', realMs: RELEASE_LAG_MS, factor: niceFloor(TARGET_RELEASE_MS / RELEASE_LAG_MS) });
    s.push({ name: 'exposure', realMs: expReal, factor: niceFloor(TARGET_EXPOSURE_MS / expReal) });
    if (dslr) s.push({ name: 'return', realMs: RELEASE_LAG_MS * 0.6, factor: niceFloor(TARGET_RELEASE_MS / RELEASE_LAG_MS) });
    return s;
  }

  function segmentAt(elapsed: number) {
    let start = 0;
    for (const seg of segs) {
      const end = start + seg.realMs * seg.factor;
      if (elapsed < end) return { seg, local: Math.max(0, (elapsed - start) / seg.factor) };
      start = end;
    }
    return null;
  }

  function setMirror(up: boolean) {
    if (mirrorIsUp !== up) { mirrorIsUp = up; d.onMirror?.(up); }
  }

  function restoreMechanism() {
    if (pivot) pivot.rotation.x = heldUp ? mirrorUp : 0;
    if (base.size) curtainPose(0, 0);
    if (scan) scan.visible = false;
    setMirror(heldUp);
  }

  function announce(text: string) {
    if (notice === text) return;
    notice = text;
    q('.rx-status').textContent = text;
  }

  function renderPlayback() {
    const hasShot = !!shotModel;
    hud.setAttribute('data-playback', !hasShot ? 'idle' : running ? paused ? 'paused' : 'playing' : 'complete');
    q('.rx-playback').hidden = !hasShot;
    const fireButton = q('.rx-fire') as HTMLButtonElement;
    fireButton.disabled = !enabled || (running && !paused);
    fireButton.setAttribute('data-armed', String(running && !paused));
    const fireLabel = hasShot ? 'Replay' : 'Play exposure';
    const fireHtml = fireLabel + ' <kbd>F</kbd>';
    if (fireButton.innerHTML !== fireHtml) fireButton.innerHTML = fireHtml;
    fireButton.title = hasShot ? 'Replay the exposure (F)' : 'Play the exposure (F)';
    const pauseButton = q('.rx-pause') as HTMLButtonElement;
    pauseButton.hidden = !running;
    pauseButton.disabled = !enabled || !hasShot;
    pauseButton.textContent = !running ? 'Replay' : paused ? 'Resume' : 'Pause';
    pauseButton.setAttribute('aria-label', !running ? 'Replay the exposure' : paused ? 'Resume exposure playback' : 'Pause exposure playback');
    if (!shotModel) { q('.rx-tl').hidden = true; return; }
    const total = totalVisualMs();
    const position = segmentAt(elapsedVis);
    const phase = !position ? 'Shot complete' : position.seg.name === 'release' ? 'Mirror up' : position.seg.name === 'return' ? 'Mirror down' : 'Sensor exposure';
    q('.rx-phase').textContent = phase;
    const shutterMs = shotModel.scenario.shutter * 1000;
    const digits = shutterMs < 1 ? 3 : shutterMs < 100 ? 2 : 0;
    const timeText = (shownFraction * shutterMs).toFixed(digits) + ' / ' + shutterMs.toFixed(digits) + ' ms · center row';
    q('.rx-time').textContent = timeText;
    const scrub = q('.rx-scrub') as HTMLInputElement;
    scrub.disabled = !enabled;
    scrub.value = String(Math.round(clamp01(elapsedVis / total) * 1000));
    scrub.setAttribute('aria-valuetext', phase + ', ' + timeText + (paused ? ', paused' : ''));
    renderTimeline(shotModel, elapsedVis);
  }

  // Stop before accepting a new model: otherwise a half-finished old shot could use new exposure settings.
  function cancel(message = '') {
    const wasRunning = running;
    running = false; paused = false; shotModel = null;
    segs = []; elapsedVis = 0; dotBudget = 0; shownFraction = 1;
    visibleDots = 0; geo.setDrawRange(0, 0); pathCache = [];
    restoreMechanism();
    d.badge.hide();
    hud.setAttribute('data-fired', 'false');
    announce(message);
    renderPlayback();
    const model = d.model();
    if (model) readout(model);
    if (wasRunning) d.afterFire?.();
  }

  /** Can be called as soon as the parent receives a new model, or checked on the next frame. */
  function syncModel() {
    if (shotModel && (d.model() !== shotModel || d.body() !== shotBody)) {
      cancel('Settings changed. Play to inspect the new exposure.');
    }
  }

  function setEnabled(on: boolean) {
    enabled = on;
    if (!on) cancel();
    renderPlayback();
    const m = d.model();
    if (m) renderEq(m);
  }

  function fire() {
    syncModel();
    const m = d.model();
    if (!m || (running && !paused) || !enabled) return;
    if (!running) d.beforeFire?.();
    rigMechanism();
    shotModel = m;
    shotBody = d.body();
    segs = plan(m);
    const total = m.exposure.photonsMidGray * m.sensor.widthPx * m.sensor.heightPx;
    dotPhotons = 10 ** Math.round(Math.log10(Math.max(1, total / DOTS)));
    dotBudget = total / dotPhotons;
    pathCache = d.paths().filter((p) => p.pts.length > 1).map((p) => {
      // A shot owns its paths, so a new ray fan cannot mutate a paused frame.
      const pts = p.pts.map((point) => point.clone());
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
      return { pts, color: p.color.clone(), len, total: len[len.length - 1] };
    });
    elapsedVis = 0; anchorElapsed = 0; anchorNow = performance.now();
    running = true; paused = prefersReducedMotion();
    hud.setAttribute('data-fired', 'true');
    announce(paused ? 'Ready to inspect. Reduced motion is on; scrub or choose Resume.' : 'Exposure playing. Pause or drag the timeline to inspect it.');
    renderFrame();
  }

  function pause() {
    syncModel();
    if (!running || paused || !shotModel) return;
    // Freeze the last displayed frame; no invisible advance between the click and the next render.
    paused = true;
    announce('Playback paused. Drag the timeline or use its arrow keys to inspect.');
    renderFrame();
  }

  function resume() {
    syncModel();
    if (!shotModel || !enabled) return;
    if (!running || elapsedVis >= totalVisualMs()) {
      fire();
      if (!running) return;
    }
    paused = false; anchorElapsed = elapsedVis; anchorNow = performance.now();
    announce('Exposure playing.');
    renderFrame();
  }

  /** 0..1 of the displayed timeline. Seeking always pauses, including native keyboard range changes. */
  function seek(fraction: number) {
    syncModel();
    if (!shotModel || !enabled || !Number.isFinite(fraction)) return;
    if (!running) d.beforeFire?.();
    running = true; paused = true;
    elapsedVis = clamp01(fraction) * totalVisualMs();
    announce('Playback paused. Drag the timeline or use its arrow keys to inspect.');
    renderFrame();
  }

  function renderPhotons() {
    let n = 0;
    if (shotModel && running && pathCache.length) {
      const exposureSeg = segs.find((seg) => seg.name === 'exposure')!;
      const release = segs.find((seg) => seg.name === 'release');
      const openStart = (release ? release.realMs * release.factor : 0) +
        (shotBody === 'dslr' ? CURTAIN_MS : READOUT_MS) / 2 * exposureSeg.factor;
      const openDuration = shotModel.scenario.shutter * 1000 * exposureSeg.factor;
      // Emission ordinal -> exact birth time. Reconstruct only dots still in flight, independent of tick
      // size/history. Backwards seeking restores the same wavelengths, positions and count without re-sampling.
      const emitted = Math.min(Math.floor(dotBudget), Math.max(0, Math.floor((elapsedVis - openStart) / openDuration * dotBudget + 1e-9)));
      const expired = Math.max(0, Math.floor((elapsedVis - FLIGHT_MS - openStart) / openDuration * dotBudget + 1e-9));
      for (let ordinal = expired + 1; ordinal <= emitted && n < MAX; ordinal++) {
        const born = openStart + ordinal / dotBudget * openDuration;
        const age = Math.max(0, (elapsedVis - born) / FLIGHT_MS);
        // A stable spread through the supplied traced paths, not a new random choice on each seek.
        const pathIndex = Math.floor(((ordinal * 0.6180339887498949) % 1) * pathCache.length);
        const c = pathCache[pathIndex];
        const distance = age * c.total;
        let k = 1;
        while (k < c.len.length - 1 && c.len[k] < distance) k++;
        const a = c.pts[k - 1], b = c.pts[k];
        const f = (distance - c.len[k - 1]) / Math.max(1e-9, c.len[k] - c.len[k - 1]);
        pos[n * 3] = a.x + (b.x - a.x) * f;
        pos[n * 3 + 1] = a.y + (b.y - a.y) * f;
        pos[n * 3 + 2] = a.z + (b.z - a.z) * f;
        col[n * 3] = c.color.r; col[n * 3 + 1] = c.color.g; col[n * 3 + 2] = c.color.b;
        n++;
      }
    }
    visibleDots = n;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  function renderFrame() {
    const m = shotModel;
    if (!m) return;
    const position = segmentAt(elapsedVis);
    const dslr = shotBody === 'dslr';
    if (scan) scan.visible = false;
    if (!position) {
      shownFraction = 1;
      restoreMechanism();
      if (paused) d.badge.show('PAUSED · SHOT COMPLETE'); else d.badge.hide();
    } else {
      const { seg, local } = position;
      const what = seg.name === 'exposure' ? 'Exposure ' + fmtShutter(m.scenario.shutter) : seg.name === 'release' ? 'Mirror up' : 'Mirror down';
      const parts = [...(paused ? ['Paused'] : []), what, factorText(seg.factor),
        ...(seg.name === 'exposure' ? ['1 dot ≈ ' + fmtPow10(dotPhotons) + ' photons'] : [])];
      d.badge.show(badgeJoin(...parts).toUpperCase());
      if (seg.name === 'release') {
        if (pivot) pivot.rotation.x = mirrorUp * smooth(Math.min(1, local / (RELEASE_LAG_MS * 0.8)));
        setMirror(false);
        curtainPose(0, 0);
        shownFraction = 0;
      } else if (seg.name === 'exposure') {
        if (pivot) pivot.rotation.x = mirrorUp;
        setMirror(true);
        const shutterMs = m.scenario.shutter * 1000;
        if (dslr) {
          curtainPose(Math.min(1, local / CURTAIN_MS), clamp01((local - shutterMs) / CURTAIN_MS));
        } else if (scan) {
          const px = new THREE.Box3().setFromObject(d.node('pixelArray')!);
          const phase = local < READOUT_MS ? local / READOUT_MS : local >= shutterMs ? Math.min(1, (local - shutterMs) / READOUT_MS) : -1;
          scan.visible = phase >= 0 && phase <= 1;
          scan.position.y = px.max.y - phase * (px.max.y - px.min.y);
        }
        const open0 = (dslr ? CURTAIN_MS : READOUT_MS) / 2;
        shownFraction = clamp01((local - open0) / shutterMs);
      } else {
        shownFraction = 1;
        setMirror(false);
        if (dslr) curtainPose(1, 1);
        if (pivot) pivot.rotation.x = mirrorUp * (1 - smooth(Math.min(1, local / (RELEASE_LAG_MS * 0.6))));
      }
    }
    renderPhotons();
    renderPlayback();
    readout(m);
  }

  function tick(now: number, _dt: number) {
    syncModel();
    const m = d.model();
    if (!m) return;
    if (running && shotModel) {
      if (paused) return; // seek/pause already rendered the frozen frame; keep all buffers untouched
      if (!paused) elapsedVis = Math.min(totalVisualMs(), anchorElapsed + Math.max(0, now - anchorNow));
      const finished = !paused && elapsedVis >= totalVisualMs();
      if (finished) running = false;
      renderFrame();
      if (finished) { announce('Shot complete. Replay or drag the timeline to inspect.'); d.afterFire?.(); }
    } else {
      readout(m);
    }
  }

  function readout(m: Model) {
    renderEq(m);
    const f = shownFraction;
    const pp = m.exposure.photonsMidGray * f;
    q('.rx-k').textContent = `Exposure · ${fmtShutter(m.scenario.shutter)}`;
    q('.rx-pp').textContent = Math.round(pp).toLocaleString('en-US');
    q('.rx-all').textContent = sci(m.exposure.photonsMidGray * m.sensor.widthPx * m.sensor.heightPx * f);
    const well = m.figs.fullWellE?.v as number | undefined;
    const fill = well ? Math.min(1, (m.exposure.electronsMidGray * f) / well) : 0;
    (q('.rx-well i') as HTMLElement).style.width = `${(fill * 100).toFixed(1)}%`;
    q('.rx-wellk').textContent = well ? `Well ${(fill * 100).toFixed(fill < 0.1 ? 1 : 0)}% full` : 'Well';
    q('.rx-snr').textContent = f >= 1 ? `signal to noise ${m.exposure.snrMidGray.toFixed(0)}` : '';
    // The moving-subject streak (shared contract with the scenes stream): hidden whenever there's no motion
    // reading yet, whether that's because the subject is off or because the scenes stream hasn't merged its own
    // edit to compute() (model.motion undefined) -- both read the same way to this panel (R3 brief, "code
    // defensively").
    const motion = motionOf(m);
    const motionRow = q('.rx-motion');
    motionRow.hidden = !motion;
    if (motion) q('.rx-motion-v').textContent = `${Math.round(motion.blurPx)} px at ${fmtShutter(m.scenario.shutter)}`;
    // The mechanism's slow-motion factor (badged during the fired sequence, above) and the drawn photons'
    // flight speed are two separate, independently chosen visual scales -- light crosses this camera in a
    // fraction of a nanosecond, too fast for any mechanism slow-motion factor to also make visible, so the
    // dots fly at one fixed visual speed regardless of path length. Astra-6 finding C4: this caption is the
    // disclosure design/LOOK.md's "scale badge" section requires for that separate, nonliteral speed.
    // shown only while the shot plays (R1-08); the dots' own speed is disclosed here (Astra-6 C4)
    const cap = q('.rx-cap');
    cap.hidden = !running;
    const text = (d.body() === 'dslr' ? 'Playback reveals the mirror and the curtains.' : 'Playback reveals the rows resetting and reading out.')
      + ' Real light crosses the camera in under a nanosecond, so the dots fly at a much slower visual speed you can follow.';
    if (cap.textContent !== text) cap.textContent = text;
  }

  /** Holds the mirror up (or lets it down) outside a shot, e.g. while the sensor is being looked at. */
  function liftMirror(up: boolean) {
    heldUp = up;
    if (running) return;
    rigMechanism();
    if (!pivot) return;
    pivot.rotation.x = up ? mirrorUp : 0;
    if (mirrorIsUp !== up) { mirrorIsUp = up; d.onMirror?.(up); }
  }

  function reset() {
    heldUp = false;
    cancel();
    // Releasing a loaded body must not leave its mirror inside a stale, rotated hinge group.
    if (pivot) {
      pivot.rotation.x = 0;
      const parent = pivot.parent;
      if (parent) for (const child of [...pivot.children]) parent.attach(child);
      pivot.removeFromParent(); pivot = null;
    }
    base.clear();
    if (scan) { scan.removeFromParent(); scan = null; }
  }

  return {
    el: hud,
    fire,
    tick,
    pause,
    resume,
    seek,
    cancel,
    syncModel,
    liftMirror,
    equalStep,
    setEnabled,
    running: () => running,
    reset,
    state: () => ({ running, paused, status: running ? paused ? 'paused' : 'playing' : shotModel ? 'complete' : 'idle',
      elapsedVisMs: elapsedVis, durationVisMs: totalVisualMs(), progress: totalVisualMs() ? elapsedVis / totalVisualMs() : 0,
      dotPhotons, shownFraction, dots: visibleDots, segs: segs.map((s) => ({ ...s })) }),
    dispose() { reset(); geo.dispose(); mat.dispose(); dots.removeFromParent(); hud.remove(); },
  };
}

function smooth(t: number) { return t * t * (3 - 2 * t); }
function fmtShutter(t: number) { return fmtShutterS(t); }
