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
}

type Seg = { name: 'release' | 'exposure' | 'return'; realMs: number; factor: number };

export function createExposure(d: ExposureDeps) {
  // ---- the HUD -------------------------------------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'rig-exposure';
  hud.setAttribute('data-fired', 'false');
  hud.innerHTML = `
    <div class="rx-head"><span class="rx-k">Exposure</span><button type="button" class="btn rx-fire" title="Fire the shutter (F)">Fire <kbd>F</kbd></button></div>
    <div class="rx-row rx-pprow"><span>Photons per pixel <small>18% gray</small></span><b class="rx-pp">0</b></div>
    <div class="rx-row rx-total"><span>Whole sensor</span><b class="rx-all">0</b></div>
    <div class="rx-well"><i></i></div>
    <div class="rx-row rx-sub"><span class="rx-wellk">Well 0% full</span><span class="rx-snr"></span></div>
    <div class="rx-row rx-motion" hidden><span>Streak on the sensor</span><b class="rx-motion-v"></b></div>
    <div class="rx-tl" hidden></div>
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
    if (!running) { tl.hidden = true; return; }
    tl.hidden = false;
    const total = segs.reduce((a, x) => a + x.realMs * x.factor, 0) || 1;
    const label = (x: Seg) => (x.name === 'release' ? 'Mirror up' : x.name === 'return' ? 'Mirror down' : `Open ${fmtShutterS(m.scenario.shutter)}`);
    const html = segs.map((x) => `<span>${label(x)}</span>`).join('') + '<i></i>';
    const plan = `${segs.length}:${total.toFixed(0)}:${m.scenario.shutter}`;
    if (tlPlan !== plan) { tl.innerHTML = html; tlPlan = plan; }
    // equal cells, so each label fits; the playhead crosses each cell in that segment's own played time
    let acc0 = 0, pos = segs.length;
    for (let i = 0; i < segs.length; i++) {
      const v = segs[i].realMs * segs[i].factor;
      if (elapsedVis < acc0 + v) { pos = i + Math.max(0, (elapsedVis - acc0) / v); break; }
      acc0 += v;
    }
    const head = tl.querySelector('i') as HTMLElement | null;
    if (head) head.style.left = `calc(${((pos / Math.max(1, segs.length)) * 100).toFixed(2)}% - 1px)`;
    let acc = 0;
    const spans = tl.querySelectorAll ? tl.querySelectorAll('span') : [];
    segs.forEach((x, i) => {
      const v = x.realMs * x.factor;
      const on = elapsedVis >= acc && elapsedVis < acc + v;
      const el = spans[i] as HTMLElement | undefined;
      if (el) el.className = on ? 'on' : '';
      acc += v;
    });
  }

  // ---- the photons: one Points buffer, each dot riding a traced path ---------------------------------------------
  const MAX = 900;
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
  const live: { path: number; born: number }[] = [];
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

  // ---- the timeline --------------------------------------------------------------------------------------------
  let segs: Seg[] = [];
  let t0 = 0;
  let running = false;
  let dotPhotons = 1;
  let dotBudget = 1;           // total/dotPhotons: how many dots at that rounded weight the shot actually represents
  let shownFraction = 1;       // how much of the exposure the counter shows (1 = the finished shot)

  function plan(m: Model) {
    const dslr = d.body() === 'dslr';
    const shutterMs = m.scenario.shutter * 1000;
    const expReal = shutterMs + (dslr ? CURTAIN_MS : READOUT_MS);
    const s: Seg[] = [];
    if (dslr) s.push({ name: 'release', realMs: RELEASE_LAG_MS, factor: niceFloor(TARGET_RELEASE_MS / RELEASE_LAG_MS) });
    s.push({ name: 'exposure', realMs: expReal, factor: niceFloor(TARGET_EXPOSURE_MS / expReal) });
    if (dslr) s.push({ name: 'return', realMs: RELEASE_LAG_MS * 0.6, factor: niceFloor(TARGET_RELEASE_MS / RELEASE_LAG_MS) });
    return s;
  }

  // off while the view has failed to load: nothing to fire or trade under an error (R1-10)
  let enabled = true;
  function setEnabled(on: boolean) {
    enabled = on;
    const b = q('.rx-fire') as HTMLButtonElement;
    if (!running) b.disabled = !on;
    const m = d.model();
    if (m) renderEq(m);
    else for (const e of hud.querySelectorAll<HTMLButtonElement>('.rx-eq-btns .btn')) e.disabled = !on;
  }

  function fire() {
    const m = d.model();
    if (!m || running || !enabled) return;
    d.beforeFire?.();
    rigMechanism();
    segs = plan(m);
    const total = m.exposure.photonsMidGray * m.sensor.widthPx * m.sensor.heightPx;
    dotPhotons = 10 ** Math.round(Math.log10(Math.max(1, total / DOTS)));
    // the badge advertises "1 dot ~= dotPhotons photons": emit exactly total/dotPhotons dots (not the fixed
    // DOTS target used only to choose a round dotPhotons scale), or the dots disagree with their own badge
    // by whatever rounding the log10 step introduced (Astra-6 finding C3: 700 dots at 1e10 photons/dot was
    // 2.93x the model's actual 2.39e12-photon total).
    dotBudget = total / dotPhotons;
    pathCache = d.paths().map((p) => {
      const len = [0];
      for (let i = 1; i < p.pts.length; i++) len.push(len[i - 1] + p.pts[i].distanceTo(p.pts[i - 1]));
      return { ...p, len, total: len[len.length - 1] };
    });
    live.length = 0;
    emitCarry = 0;               // reset between shots: a leftover fractional carry must not roll into the next
    t0 = performance.now();
    running = true;
    shownFraction = 0;
    q('.rx-fire').setAttribute('disabled', '');
    q('.rx-fire').setAttribute('data-armed', 'true');
    hud.setAttribute('data-fired', 'true');
  }

  let emitCarry = 0;
  let mirrorIsUp = false;
  function tick(now: number, dt: number) {
    const m = d.model();
    if (!m) return;
    if (running) {
      // where are we: walk the segments in visual time
      let tv = now - t0;
      let seg: Seg | null = null, local = 0;
      for (const s of segs) {
        const vis = s.realMs * s.factor;
        if (tv < vis) { seg = s; local = tv / s.factor; break; }
        tv -= vis;
      }
      const dslr = d.body() === 'dslr';
      const shutterMs = m.scenario.shutter * 1000;
      if (!seg) {
        running = false;
        shownFraction = 1;
        d.badge.hide();
        if (enabled) q('.rx-fire').removeAttribute('disabled');
        q('.rx-fire').setAttribute('data-armed', 'false');
        if (pivot) pivot.rotation.x = heldUp ? mirrorUp : 0;
        curtainPose(0, 0);
        mirrorIsUp = heldUp;
        d.onMirror?.(heldUp);
        if (scan) scan.visible = false;
        renderTimeline(m, 0);
        d.afterFire?.();
      } else {
        const what = seg.name === 'exposure' ? `Exposure ${fmtShutter(m.scenario.shutter)}` : seg.name === 'release' ? 'Mirror up' : 'Mirror down';
        // each part keeps its words together, so a narrow screen breaks the badge only at a '·' (R2-01)
        const parts = [what, factorText(seg.factor), ...(seg.name === 'exposure' ? [`1 dot ≈ ${fmtPow10(dotPhotons)} photons`] : [])];
        d.badge.show(badgeJoin(...parts).toUpperCase());
        renderTimeline(m, now - t0);
        if (seg.name === 'release') {
          if (pivot) pivot.rotation.x = mirrorUp * smooth(Math.min(1, local / (RELEASE_LAG_MS * 0.8)));
          curtainPose(0, 0);
          shownFraction = 0;
        } else if (seg.name === 'exposure') {
          if (pivot) pivot.rotation.x = mirrorUp;
          if (!mirrorIsUp) { mirrorIsUp = true; d.onMirror?.(true); }
          if (dslr) {
            // the front curtain crosses in CURTAIN_MS; the rear follows exactly one shutter time later
            curtainPose(Math.min(1, local / CURTAIN_MS), Math.max(0, Math.min(1, (local - shutterMs) / CURTAIN_MS)));
          } else if (scan) {
            // rows reset top to bottom, then read out top to bottom one exposure time later
            const px = new THREE.Box3().setFromObject(d.node('pixelArray')!);
            const phase = local < READOUT_MS ? local / READOUT_MS : local >= shutterMs ? Math.min(1, (local - shutterMs) / READOUT_MS) : -1;
            scan.visible = phase >= 0 && phase <= 1;
            scan.position.y = px.max.y - phase * (px.max.y - px.min.y);
          }
          // the center row (where the on-axis light lands) is open from half a traverse in, for exactly the shutter
          const traverse = dslr ? CURTAIN_MS : READOUT_MS;
          const open0 = traverse / 2, open1 = open0 + shutterMs;
          shownFraction = Math.max(0, Math.min(1, (local - open0) / shutterMs));
          // emit dotBudget dots over the whole exposure, at dotBudget/shutterMs per real ms of shutter-open
          // time -- integrated against this tick's EXACT overlap with [open0, open1], not an all-or-nothing
          // per-tick test, so a tick that only partly overlaps the open window (its first or last) is not
          // over- or under-counted (Astra-6 finding C3).
          const stepReal = Math.min(dt, 50) / seg.factor;
          const overlap = Math.max(0, Math.min(open1, local) - Math.max(open0, local - stepReal));
          if (overlap > 0 && pathCache.length) {
            emitCarry += (dotBudget / shutterMs) * overlap;
            while (emitCarry >= 1 && live.length < MAX) { emitCarry -= 1; live.push({ path: Math.floor(Math.random() * pathCache.length), born: now }); }
          }
        } else {
          shownFraction = 1;
          if (mirrorIsUp) { mirrorIsUp = false; d.onMirror?.(false); }
          if (dslr) curtainPose(1, 1);
          if (pivot) pivot.rotation.x = mirrorUp * (1 - smooth(Math.min(1, local / (RELEASE_LAG_MS * 0.6))));
        }
      }
    }
    // move the dots
    let n = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const age = (now - live[i].born) / FLIGHT_MS;
      if (age >= 1) { live.splice(i, 1); continue; }
    }
    for (const p of live) {
      const c = pathCache[p.path];
      if (!c) continue;
      const s = ((now - p.born) / FLIGHT_MS) * c.total;
      let k = 1;
      while (k < c.len.length - 1 && c.len[k] < s) k++;
      const a = c.pts[k - 1], b = c.pts[k];
      const f = (s - c.len[k - 1]) / Math.max(1e-9, c.len[k] - c.len[k - 1]);
      pos[n * 3] = a.x + (b.x - a.x) * f; pos[n * 3 + 1] = a.y + (b.y - a.y) * f; pos[n * 3 + 2] = a.z + (b.z - a.z) * f;
      col[n * 3] = c.color.r; col[n * 3 + 1] = c.color.g; col[n * 3 + 2] = c.color.b;
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    readout(m);
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
    const text = (d.body() === 'dslr' ? 'Time is slowed to show the mirror and the curtains.' : 'Time is slowed to show the rows reset and read out.')
      + ' Real light crosses the camera in under a nanosecond, so the dots fly at a much slower visual speed you can follow.';
    if (cap.textContent !== text) cap.textContent = text;
  }

  /** Holds the mirror up (or lets it down) outside a shot, e.g. while the sensor is being looked at. */
  let heldUp = false;
  function liftMirror(up: boolean) {
    heldUp = up;
    if (running) return;
    rigMechanism();
    if (!pivot) return;
    pivot.rotation.x = up ? mirrorUp : 0;
    if (mirrorIsUp !== up) { mirrorIsUp = up; d.onMirror?.(up); }
  }

  return {
    el: hud,
    fire,
    tick,
    liftMirror,
    equalStep,
    setEnabled,
    running: () => running,
    reset() { pivot = null; base.clear(); if (scan) { scan.removeFromParent(); scan = null; } running = false; live.length = 0; shownFraction = 1; heldUp = false; mirrorIsUp = false; d.badge.hide(); },
    state: () => ({ running, dotPhotons, shownFraction, dots: live.length, segs: segs.map((s) => ({ ...s })) }),
    dispose() { geo.dispose(); mat.dispose(); hud.remove(); },
  };
}

function smooth(t: number) { return t * t * (3 - 2 * t); }
function fmtShutter(t: number) { return fmtShutterS(t); }
