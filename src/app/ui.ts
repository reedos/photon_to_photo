// The page shell around the 3D view: the settings (body, lens, aperture, focus, shutter, ISO, format), the level strip
// (the camera and its three inspection views), the part list and its cards, the stat row with evidence chips, and
// the final image (docked live in the view, and in full below it). Reads Model only through engine-api.ts's compute();
// never computes physics itself. Queries the DOM ids index.html defines and wires them once.
import type { Model } from '../engine/model-types';
import type { FormatId, Scenario } from '../engine/types';
import { bodyForLens, compute, defaultFocusM, lensSummary, LINEUP, LONG_LENS_MM, sceneIds, sceneTargets, type BodyId } from './engine-api';
import { motionPartial, motionSpeedOf } from './motion';
import { currentRender, onRenderFailure, publishRender, requestRender, type RenderView } from './render-client';
import { emit, on } from './bus';
import { type AppState, type PieceId, type Store } from './store';
import { cameraPart, PART_LABELS } from './inspection';
import { adjacentPart, insideView, VIEW_LABELS } from './part-navigation';
import { FOCUS_STEPS, focusStepValue, focusStepFromMm } from './focus-control';
import type { Stage } from './stage';
import { fmtDistance, fmtFno, fmtShutter, fmtPitch, fmtDims, fmtNum, fmtRange } from './units';
import { apertureClampNotice } from './equipment-feedback';

// ---- standard photographic third-stop control steps ------------------------------------------------------
// UI control-step conventions (every digital camera's aperture/shutter/ISO dial uses this spacing), not a physics
// claim about the lens or sensor; no evidence chip applies to a control's step size.
import { apertureSteps, THIRD_STOP_SHUTTER, THIRD_STOP_ISO } from './stops';
// Focus distance: log scale from the lens's closest focus (mm) to infinity; infinity is the slider's top step.


const FORMAT_OPTIONS: { id: FormatId; label: string; sub: string }[] = [
  { id: 'ff', label: 'Full frame', sub: '36 × 24 mm' },
  { id: 'apsc', label: 'APS-C', sub: '23.5 × 15.6 mm' },
  { id: 'mft', label: 'MFT', sub: '17.3 × 13 mm' },
];

const BODIES: { id: BodyId; label: string; sub: string }[] = [
  { id: 'dslr', label: 'DSLR', sub: 'mirror, F mount' },
  { id: 'mirrorless', label: 'Mirrorless', sub: 'Z mount' },
];
/** When the body changes, the lens that plays the same part on the other mount (the 35, the 50, the long tele). */
const COUNTERPART: Record<string, string> = { s35: 'z35', n50: 'm50', n500: 'z800', n500fl: 'z800', z35: 's35', m50: 'n50', z800: 'n500' };

// The camera is the parent view. Its optics/focus/pixel inspections retain legacy URLs and renderer hooks,
// while the store carries the selected camera part for return navigation and sharing.
const PIECES: { id: PieceId; n: number; title: string; short: string; color: string; lede: string; deep: boolean }[] = [
  { id: 'camera', n: 1, title: 'The camera', short: 'Camera', color: 'var(--camera)', deep: false,
    lede: 'Turn the focus ring and the glass inside moves. Close the aperture and less light gets in. Every ray on screen is traced through the lens design.' },
  { id: 'lens', n: 2, title: 'The lens', short: 'Lens', color: 'var(--lens)', deep: true,
    lede: 'A deep dive into the lens. The element stack, the aperture blades and a live ray fan, traced surface by surface.' },
  { id: 'cone', n: 3, title: 'Focus & bokeh', short: 'Focus', color: 'var(--focus)', deep: true,
    lede: "A deep dive into focus. One point's light converges to a point on the sensor when it is in focus, and paints a disk when it is not." },
  { id: 'loupe', n: 4, title: 'The loupe', short: 'Loupe', color: 'var(--loupe)', deep: true,
    lede: 'A deep dive into one pixel. From a spot in the final photo down to the microlens, the color filter and the well that counts the electrons.' },
];

export function chip(ev: string, src?: string): string {
  const SHORT: Record<string, string> = { spec: 'Spec', vendor: 'Vendor', reported: 'Reported', derived: 'Calc.', assumed: 'Assumed' };
  const TITLE: Record<string, string> = { spec: 'From a published specification', vendor: "From the maker's own figures", reported: 'Reported by a third party',
    derived: 'Calculated by the engine from backed inputs', assumed: 'Based on a stated modeling assumption' };
  const title = `${TITLE[ev] ?? ''}${src ? `: ${src}` : ''}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span class="chip ${ev}" title="${title}">${SHORT[ev] ?? ev}</span>`;
}

function nearestIndex(arr: number[], v: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bestD) { bestD = d; best = i; } }
  return best;
}

/** A lens's picker label: focal length, maximum aperture, and PF when it has a phase Fresnel element. */
function lensButtonHtml(id: string): string {
  const s = lensSummary(id);
  const pf = /\bPF\b|phase fresnel/i.test(s.name) || id === 'n500' || id === 'z800';
  return `${s.focalLength} mm<small>${fmtFno(s.markedFno)}${pf ? ' PF' : ''}</small>`;
}

interface Dom {
  pieceCounter: HTMLElement; pageTitle: HTMLElement; pageLede: HTMLElement;
  scBody: HTMLElement; scLens: HTMLElement; scFno: HTMLInputElement; scFnoV: HTMLElement;
  scFocus: HTMLInputElement; scFocusV: HTMLElement; scShutter: HTMLInputElement; scShutterV: HTMLElement;
  scIso: HTMLInputElement; scIsoV: HTMLElement; scFormat: HTMLElement; scScene: HTMLElement; scMotion: HTMLElement; kpis: HTMLElement;
  steps: HTMLElement; intro: HTMLElement; partsK: HTMLElement; parts: HTMLElement; partsAll: HTMLButtonElement;
  card: HTMLElement; cardK: HTMLElement; cardT: HTMLElement; cardSub: HTMLElement; cardB: HTMLElement; cardS: HTMLElement; cardX: HTMLButtonElement;
  resetView: HTMLButtonElement; shareBtn: HTMLButtonElement; toast: HTMLElement;
  finalimgCanvas: HTMLCanvasElement; finalimgCap: HTMLElement; finalimgScale: HTMLElement;
  dock: HTMLButtonElement; dockCanvas: HTMLCanvasElement; dockCap: HTMLElement;
  raysChip: HTMLButtonElement; hudBtns: HTMLElement; hudBtnsPhone: HTMLElement; hint: HTMLElement; hudTr: HTMLElement;
  topnav: HTMLElement; menuBtn: HTMLButtonElement; stageSection: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`ui.ts: index.html is missing #${id}`);
  return el as T;
}

function queryDom(): Dom {
  return {
    pieceCounter: byId('piece-counter'), pageTitle: byId('page-title'), pageLede: byId('page-lede'),
    scBody: byId('sc-body'), scLens: byId('sc-lens'), scFno: byId('sc-fno'), scFnoV: byId('sc-fno-v'),
    scFocus: byId('sc-focus'), scFocusV: byId('sc-focus-v'), scShutter: byId('sc-shutter'), scShutterV: byId('sc-shutter-v'),
    scIso: byId('sc-iso'), scIsoV: byId('sc-iso-v'), scFormat: byId('sc-format'), scScene: byId('sc-scene'), scMotion: byId('sc-motion'), kpis: byId('kpis'),
    steps: byId('steps'), intro: byId('intro'), partsK: byId('parts-k'), parts: byId('parts'), partsAll: byId('parts-all'),
    card: byId('card'), cardK: byId('card-k'), cardT: byId('card-t'), cardSub: byId('card-sub'), cardB: byId('card-b'), cardS: byId('card-s'), cardX: byId('card-x'),
    resetView: byId('reset-view'), shareBtn: byId('share-btn'), toast: byId('toast'),
    finalimgCanvas: byId('finalimg-canvas'), finalimgCap: byId('finalimg-cap'), finalimgScale: byId('finalimg-scale'),
    dock: byId('fi-dock'), dockCanvas: byId('fi-dock-canvas'), dockCap: byId('fi-dock-cap'),
    raysChip: byId('rays-chip'), hudBtns: byId('hud-btns'), hudBtnsPhone: byId('hud-btns-phone'), hint: byId('hint'), hudTr: byId('hud-tr'),
    topnav: byId('topnav'), menuBtn: byId('menu-btn'), stageSection: byId('stage-section'),
  };
}

const phoneQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null);

/** Changing lens: the focus carries over, except across the short/long divide, where the new lens opens at its own
 *  default distance (a long lens at 3 m sits at its closest focus; a 35 at 15 m is a different picture). */
export function lensChange(fromLens: string, toLens: string, focusM: number | null): { lens: string; focusM?: number | null } {
  const long = (id: string) => lensSummary(id).focalLength >= LONG_LENS_MM;
  return long(fromLens) === long(toLens) ? { lens: toLens } : { lens: toLens, focusM: defaultFocusM(toLens) };
}

/** Whether any of the bench scene's targets (the charts, the foreground card) falls inside this shot's frame, from the
 *  sensor's size and the lens's image distance: drawing geometry for the empty-frame caption, not a displayed number. */
export function targetsInFrame(model: Model): boolean {
  const wMm = (model.sensor.widthPx * model.sensor.pitchUm) / 1000, hMm = (model.sensor.heightPx * model.sensor.pitchUm) / 1000;
  const img = model.cardinal.efl * (1 + Math.abs(model.focus.magnification || 0));
  const tx = wMm / 2 / img, ty = hMm / 2 / img;
  return sceneTargets(model.scenario.scene ?? 'bench', model.scenario.subjectM).some((t) => t.x0 < t.z * tx && t.x1 > -t.z * tx && t.y0 < t.z * ty && t.y1 > -t.z * ty);
}

/** A card title's parenthetical provenance ("50 mm f/1.8 (generic, after ...)") goes on a mono line of its own. */
export function splitTitle(title: string): { title: string; sub: string | null } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(title);
  if (!m || m[1].length < 3) return { title, sub: null };
  const sub = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return { title: m[1].replace(/\s+lens$/i, ''), sub };
}

export function mountUI(store: Store, stage: Stage): void {
  const dom = queryDom();
  let selectedPartId: string | null = null;
  let shownCard: string | null = null;

  // ---- body and lens: two groups, the lens group showing only the lenses that mount on the chosen body ----------
  for (const b of BODIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.body = b.id;
    btn.innerHTML = `${b.label}<small>${b.sub}</small>`;
    btn.addEventListener('click', () => {
      const cur = store.get().scenario.lens;
      if (bodyForLens(cur) === b.id) return;
      const next = COUNTERPART[cur] ?? LINEUP[b.id][1];
      store.set(lensChange(cur, LINEUP[b.id].includes(next) ? next : LINEUP[b.id][1], store.get().scenario.focusM));
    });
    dom.scBody.appendChild(btn);
  }
  let lensBody: BodyId | null = null;
  function buildLensGroup(body: BodyId) {
    if (lensBody === body) return;
    lensBody = body;
    dom.scLens.innerHTML = '';
    for (const id of LINEUP[body]) {
      const s = lensSummary(id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.lens = id;
      btn.title = s.name;
      btn.innerHTML = lensButtonHtml(id);
      btn.addEventListener('click', () => { const sc = store.get().scenario; store.set(lensChange(sc.lens, id, sc.focusM)); });
      dom.scLens.appendChild(btn);
    }
  }

  // ---- format picker --------------------------------------------------------------------------------------
  for (const f of FORMAT_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.format = f.id;
    btn.innerHTML = `${f.label}<small>${f.sub}</small>`;
    btn.addEventListener('click', () => store.set({ format: f.id }));
    dom.scFormat.appendChild(btn);
  }

  // ---- scene switch: Tabletop (the bench charts) / Field (a long lens's own default, docs contract with the scenes
  // stream). Offered unconditionally: normalizeScenario already falls back to the default scene for an id sceneIds()
  // doesn't know, so picking Field before that stream's edit to scenes.ts lands is a safe no-op, not a crash.
  const SCENES: { id: string; label: string; sub: string }[] = [
    { id: 'bench', label: 'Tabletop', sub: 'Close, still' },
    { id: 'flight', label: 'Bird glide', sub: 'Lateral flight' },
    { id: 'field', label: 'Field', sub: 'Far, open' },
  ];
  for (const s of SCENES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.scene = s.id;
    btn.innerHTML = `${s.label}<small>${s.sub}</small>`;
    btn.addEventListener('click', () => store.set({ scene: s.id }));
    dom.scScene.appendChild(btn);
  }

  // ---- moving subject: Off, or an illustrative walking/running/bird-in-flight speed (motion.ts's shared-contract
  // helpers; hidden downstream wherever the model doesn't carry a motion readout yet).
  const MOTIONS: { speedMps: number; label: string }[] = [
    { speedMps: 0, label: 'Off' },
    { speedMps: 1.5, label: 'Walking' },
    { speedMps: 5, label: 'Running' },
    { speedMps: 12, label: 'Bird in flight' },
  ];
  for (const m of MOTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.speed = String(m.speedMps);
    btn.innerHTML = m.speedMps > 0 ? `${m.label}<small>${m.speedMps} m/s, assumed</small>` : `${m.label}<small>Still</small>`;
    btn.addEventListener('click', () => store.set(motionPartial(m.speedMps)));
    dom.scMotion.appendChild(btn);
  }

  // ---- sliders: index into a standard third-stop array (aperture's array depends on the current lens) --------
  dom.scFno.min = '0'; dom.scFno.step = '1';
  dom.scShutter.min = '0'; dom.scShutter.max = String(THIRD_STOP_SHUTTER.length - 1); dom.scShutter.step = '1';
  dom.scIso.min = '0'; dom.scIso.max = String(THIRD_STOP_ISO.length - 1); dom.scIso.step = '1';
  dom.scFocus.min = '0'; dom.scFocus.max = String(FOCUS_STEPS - 1); dom.scFocus.step = '1';

  const setPct = (el: HTMLInputElement) => {
    const max = Number(el.max) || 1;
    el.style.setProperty('--pct', `${(Number(el.value) / max) * 100}%`);
  };
  dom.scFno.addEventListener('input', () => {
    const fnoSteps = apertureSteps(lensSummary(store.get().scenario.lens).maxFno);
    store.set({ fno: fnoSteps[Number(dom.scFno.value)] ?? fnoSteps[0] });
  });
  dom.scShutter.addEventListener('input', () => store.set({ shutter: THIRD_STOP_SHUTTER[Number(dom.scShutter.value)] }));
  dom.scIso.addEventListener('input', () => store.set({ iso: THIRD_STOP_ISO[Number(dom.scIso.value)] }));
  dom.scFocus.addEventListener('input', () => {
    const minFocusMm = lastModel ? lastModel.lens.closestFocusMm : 300;
    const mm = focusStepValue(minFocusMm, lastModel?.lens.focalLength ?? 50, Number(dom.scFocus.value));
    store.set({ focusM: mm === null ? null : mm / 1000 });
  });

  // ---- level strip: the camera, then its three deep dives -----------------------------------------------------
  const stepEls = new Map<PieceId, HTMLButtonElement>();
  for (const p of PIECES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = p.deep ? 'step deep' : 'step';
    btn.style.setProperty('--c', p.color);
    btn.dataset.piece = p.id;
    const label = { camera: 'Camera', lens: 'Optics', cone: 'Focus', loupe: 'Pixel' }[p.id];
    btn.setAttribute('aria-label', p.deep ? `Inspect ${label.toLowerCase()}` : 'Camera overview');
    btn.innerHTML = `<span class="top"><span class="t">${label}</span></span>`
      + `<span class="meta"><span class="dot"></span><span class="sub"></span></span>`;
    btn.addEventListener('click', () => {
      if (p.id === 'camera') {
        store.showCameraOverview();
        stage.resetView();
      } else if (store.get().piece === p.id) stage.resetView();
      else store.setPiece(p.id);
    });
    dom.steps.appendChild(btn);
    stepEls.set(p.id, btn);
  }

  const inspectionBar = document.createElement('div');
  inspectionBar.className = 'inspection-context';
  inspectionBar.hidden = true;
  inspectionBar.innerHTML = '<button type="button" class="inspection-back"></button><span aria-hidden="true">/</span><span class="inspection-here"></span><span class="inspection-note">Same shot, a closer look</span>';
  dom.steps.after(inspectionBar);
  const inspectionBack = inspectionBar.querySelector<HTMLButtonElement>('button')!;
  inspectionBack.addEventListener('click', () => store.setPiece('camera'));
  dom.steps.setAttribute('aria-label', 'Camera inspection views');

  // ---- the top bar: site sections; the menu closes after a pick; the current section is underlined -------------
  dom.menuBtn.addEventListener('click', () => {
    const open = dom.topnav.classList.toggle('open');
    dom.menuBtn.setAttribute('aria-expanded', String(open));
  });
  dom.topnav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) { dom.topnav.classList.remove('open'); dom.menuBtn.setAttribute('aria-expanded', 'false'); }
  });
  // Scroll-spy: the section whose top has passed a line a third of the way down the screen is current.
  // Camera inspections remain inside the same camera section.
  const navLinks = [...dom.topnav.querySelectorAll<HTMLAnchorElement>('a[data-nav]')];
  const spy = () => {
    const line = window.innerHeight * 0.33;
    let key = 'stage';
    for (const [id, k] of [['scenario', 'scenario'], ['finalimg', 'finalimg']] as const) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) key = k;
    }
    // the last section can never reach the line: at the foot of the page it is the one on screen (R2-05)
    if (document.getElementById('finalimg') && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) key = 'finalimg';
    for (const a of navLinks) a.setAttribute('aria-current', String(a.dataset.nav === key));
  };
  window.addEventListener('scroll', spy, { passive: true });
  window.addEventListener('resize', spy);

  // Scroll state for the top bar (ported from intelligence_factory/src/app/site.js's onScroll): content passes behind
  // the fixed bar as soon as the reader scrolls, so the bar firms up then.
  const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- the view's buttons: Reset and Share live in the top-right column, and under the view on a phone ----------
  const phone = phoneQuery();
  const setHint = () => {
    const zoom = phone?.matches ? 'pinch to zoom' : 'Scroll to zoom';
    dom.hint.textContent = store.get().piece === 'camera'
      ? `Drag the focus ring or a dial to set it · drag elsewhere to orbit · ${zoom}`
      : `Drag to orbit · ${zoom}`;
  };
  const placeButtons = () => {
    const actions = document.getElementById('studio-actions');
    if (actions) {
      actions.append(dom.hudBtns); dom.hudBtnsPhone.append(dom.hint);
      document.getElementById('part-position')?.before(dom.resetView);
    }
    else if (phone?.matches) { dom.hudBtnsPhone.append(dom.hudBtns, dom.hint); }
    else { dom.hudTr.append(dom.hudBtns, dom.hint); }
    setHint();
  };
  placeButtons();
  phone?.addEventListener('change', placeButtons);
  // the docked final image: in the left rail under the exposure panel on a wide screen, in the lower right on a phone
  const rail = document.getElementById('hud-rail'), br = document.getElementById('hud-br');
  const placeDock = () => { if (phone?.matches) br?.append(dom.dock); else rail?.append(dom.dock); };
  placeDock();
  phone?.addEventListener('change', placeDock);

  dom.resetView.addEventListener('click', () => {
    if (store.get().piece === 'camera' && selectedPartId) stage.selectPin(selectedPartId);
    else stage.resetView();
  });
  let toastTimer = 0;
  function toast(text: string, select = false, ms = 4000) {
    dom.toast.textContent = text;
    dom.toast.hidden = false;
    dom.toast.classList.toggle('select', select);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, ms);
  }
  dom.shareBtn.addEventListener('click', async () => {
    const url = location.href;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard may be unavailable; the toast still shows the link */ }
    toast(copied ? `Link copied. ${url}` : url, true);
  });

  // Rays on/off: the camera hides its traced light and the entrance-pupil bundle, to see the hardware alone.
  dom.raysChip.addEventListener('click', () => {
    const on = dom.raysChip.getAttribute('aria-pressed') !== 'true';
    dom.raysChip.setAttribute('aria-pressed', String(on));
    emit('layer', { id: 'rays', on });
  });

  // A tap on the final image opens the loupe at that rendered pixel (the loupe piece hears it on the bus).
  dom.finalimgCanvas.addEventListener('click', (ev) => {
    // The previous photo remains visible while its replacement is computed. Its pixels no longer
    // describe the current controls, so wait for a successful render before opening an inspection.
    if (dom.finalimgCanvas.getAttribute('aria-disabled') === 'true') return;
    const view = currentRender();
    if (!view) return;
    const r = dom.finalimgCanvas.getBoundingClientRect();
    store.setPiece('loupe');
    dom.stageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const x = Math.min(view.width - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * view.width)));
    const y = Math.min(view.height - 1, Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * view.height)));
    emit('loupe-tap', { x, y, renderId: view.renderId });
  });
  dom.dock.addEventListener('click', () => document.getElementById('finalimg')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  // ---- the part list and its card ---------------------------------------------------------------------------
  const previous = byId<HTMLButtonElement>('part-prev'), next = byId<HTMLButtonElement>('part-next');
  const door = byId<HTMLButtonElement>('card-go');
  function selectPart(id: string | null) {
    selectedPartId = id;
    if (store.get().piece === 'camera') {
      if (store.get().cameraPart === id) stage.selectPin(id);
      else store.setCameraPart(cameraPart(id));
    }
    else { stage.selectPin(id); if (!id) stage.resetView(); }
    renderPanel(compute(store.get().scenario), store.get().piece);
    document.getElementById('tab-explain')?.click();
  }
  function stepPart(direction: -1 | 1) {
    selectPart(adjacentPart(stage.activeProbes().map(p => p.id), selectedPartId, direction));
  }
  previous.addEventListener('click', () => stepPart(-1));
  next.addEventListener('click', () => stepPart(1));
  byId('part-overview').addEventListener('click', () => selectPart(null));
  door.addEventListener('click', () => {
    const destination = insideView(cameraPart(selectedPartId));
    if (destination && store.get().piece === 'camera') store.setPiece(destination);
  });
  byId('gl').addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); stepPart(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  function clearSelection() {
    selectedPartId = null;
    stage.selectPin(null);
    const s = store.get();
    if (s.piece === 'camera') store.setCameraPart(null);
    renderPanel(compute(s.scenario), s.piece);
  }
  dom.cardX.addEventListener('click', clearSelection);
  window.addEventListener('keydown', (e) => {
    // Escape belongs to an open dialog, not to the selected part behind its backdrop.
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && selectedPartId && phone?.matches) clearSelection();
  });

  let lastModel: Model | null = null;

  function renderScenario(scenario: Scenario, model: Model) {
    const body = bodyForLens(scenario.lens);
    dom.scBody.closest('.sc-sub')!.toggleAttribute('hidden', !body);
    if (body) buildLensGroup(body);
    for (const btn of dom.scBody.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.body === body));
    for (const btn of dom.scLens.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.lens === scenario.lens));
    for (const btn of dom.scFormat.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.format === scenario.format));
    const knownScenes = sceneIds();
    for (const btn of dom.scScene.children) {
      const el = btn as HTMLButtonElement;
      el.setAttribute('aria-pressed', String(el.dataset.scene === scenario.scene));
      // Disabled, not hidden, until the scenes stream's own scenes.ts registers it: a real option that isn't wired
      // up yet reads as "not yet" rather than as a silent no-op (see the note by SCENES above).
      el.disabled = !!el.dataset.scene && !knownScenes.includes(el.dataset.scene);
    }
    const speedMps = motionSpeedOf(scenario);
    for (const btn of dom.scMotion.children) (btn as HTMLElement).setAttribute('aria-pressed', String(Number((btn as HTMLElement).dataset.speed) === speedMps));

    const fnoSteps = apertureSteps(model.lens.maxFno);
    dom.scFno.max = String(Math.max(0, fnoSteps.length - 1));
    dom.scFno.value = String(nearestIndex(fnoSteps, scenario.fno));
    dom.scFnoV.textContent = fmtFno(scenario.fno);
    dom.scFno.setAttribute('aria-valuetext', dom.scFnoV.textContent);

    dom.scFocus.value = String(focusStepFromMm(model.lens.closestFocusMm, model.lens.focalLength, scenario.focusM === null ? null : scenario.focusM * 1000));
    dom.scFocusV.textContent = fmtDistance(model.focus.distanceMm);
    dom.scFocus.setAttribute('aria-valuetext', dom.scFocusV.textContent);

    dom.scShutter.value = String(nearestIndex(THIRD_STOP_SHUTTER, scenario.shutter));
    dom.scShutterV.textContent = fmtShutter(scenario.shutter);
    dom.scShutter.setAttribute('aria-valuetext', dom.scShutterV.textContent);

    dom.scIso.value = String(nearestIndex(THIRD_STOP_ISO, scenario.iso));
    dom.scIsoV.textContent = `ISO ${Math.round(scenario.iso)}`;
    dom.scIso.setAttribute('aria-valuetext', dom.scIsoV.textContent);
    for (const el of [dom.scFno, dom.scFocus, dom.scShutter, dom.scIso]) setPct(el);

    // value, label and chip on one line each; the qualifier goes on a quiet line under them (UI-18)
    dom.kpis.innerHTML = [
      [fmtNum(model.exposure.ev100, 1), 'EV100', chip('derived'), 'exposure value at ISO 100'],
      [`${fmtNum(model.focus.cocMm * 1000, 2)} µm`, 'Sharpness criterion', chip('assumed', 'format diagonal / 1500'), 'acceptable blur diameter for depth of field'],
      [fmtRange(model.focus.nearMm, model.focus.farMm), 'Depth of field', chip('derived'), `focused at ${fmtDistance(model.focus.distanceMm)}`],
      [`${fmtNum(model.diffraction.airyRadiusUm, 2)} µm`, 'Airy radius', chip('derived'), `${fmtNum(model.diffraction.airyRadiusPx, 2)} of a pixel`],
      [fmtNum(model.exposure.photonsMidGray, 0), 'Photons/px', chip('assumed'), 'on an 18% gray patch'],
      [fmtNum(model.exposure.snrMidGray, 1), 'SNR', chip('assumed'), 'on an 18% gray patch'],
    ].map(([v, l, c, d]) => `<div class="kpi"><span class="kv">${v}</span><span class="kl"><span>${l}</span>${c}</span><span class="kd">${d}</span></div>`).join('');
  }

  // One short factual subline per level: what the strip's subline and the in-view title's subline both show.
  function subFor(model: Model, id: PieceId): string {
    if (id === 'camera') return `${model.lens.focalLength} mm ${fmtFno(model.scenario.fno)} · focus ${fmtDistance(model.focus.distanceMm)} · ${fmtShutter(model.scenario.shutter)}`;
    if (id === 'lens') return `${model.lens.focalLength} mm ${fmtFno(model.lens.markedFno)} · ${model.lens.elements} elements`;
    if (id === 'cone') return `focus ${fmtDistance(model.focus.distanceMm)} · blur criterion ${fmtNum(model.focus.cocMm, 3)} mm`;
    return `${fmtPitch(model.sensor.pitchUm)} pitch · ${fmtDims(model.sensor.widthPx, model.sensor.heightPx)}`;
  }

  function renderSteps(model: Model, activePiece: PieceId) {
    for (const p of PIECES) {
      const el = stepEls.get(p.id)!;
      el.setAttribute('aria-current', p.id === activePiece ? 'step' : 'false');
      el.querySelector('.sub')!.textContent = subFor(model, p.id);
    }
  }

  function renderPanel(model: Model, activePiece: PieceId) {
    const p = PIECES.find((x) => x.id === activePiece)!;
    dom.pieceCounter.textContent = 'From light to a photograph';
    dom.pageTitle.textContent = PIECES[0].title;
    dom.pageLede.textContent = PIECES[0].lede;
    dom.intro.textContent = activePiece === 'camera' ? 'Pick a part to see how it works.' : p.lede;
    inspectionBar.hidden = !p.deep;
    const parent = store.get().cameraPart;
    inspectionBack.textContent = `← Camera${parent ? ` · ${PART_LABELS[parent]}` : ''}`;
    inspectionBar.querySelector('.inspection-here')!.textContent = p.title;
    const probes = stage.activeProbes();
    if (selectedPartId && !probes.some((pr) => pr.id === selectedPartId)) selectedPartId = null;

    dom.partsK.textContent = `${probes.length} ${probes.length === 1 ? 'part' : 'parts'}`;
    dom.partsAll.hidden = true;
    dom.parts.classList.remove('collapsed');
    const selectedIndex = probes.findIndex(pr => pr.id === selectedPartId);
    byId('part-position').textContent = selectedIndex < 0 ? 'Overview' : (selectedIndex + 1) + ' / ' + probes.length;
    for (const [button, direction] of [[previous, -1], [next, 1]] as const) {
      const id = adjacentPart(probes.map(pr => pr.id), selectedPartId, direction);
      const label = probes.find(pr => pr.id === id)?.label ?? 'Overview';
      button.title = (direction < 0 ? 'Previous: ' : 'Next: ') + label;
      button.setAttribute('aria-label', button.title);
      button.disabled = !probes.length;
    }
    const destination = activePiece === 'camera' ? insideView(cameraPart(selectedPartId)) : null;
    door.hidden = !destination;
    door.textContent = destination ? 'Go inside: ' + VIEW_LABELS[destination] + ' →' : '';
    dom.card.closest('.panel')?.classList.toggle('has-selection', !!selectedPartId);

    const focusedPart = dom.parts.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.partId : null;
    dom.parts.innerHTML = '';
    probes.forEach((probe, i) => {
      const li = document.createElement('li');
      if (probe.id === selectedPartId) li.className = 'sel';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.partId = probe.id;
      btn.setAttribute('aria-pressed', String(selectedPartId === probe.id));
      btn.innerHTML = `<span class="pn">${i + 1}</span><span class="pt"></span><span class="pk"></span>`;
      (btn.querySelector('.pt') as HTMLElement).textContent = probe.label;
      btn.addEventListener('click', () => {
        selectedPartId = selectedPartId === probe.id ? null : probe.id;
        if (store.get().piece === 'camera') store.setCameraPart(cameraPart(selectedPartId));
        else stage.selectPin(selectedPartId);
        renderPanel(model, store.get().piece);
        // on a phone the list sits under the view: bring the camera back up so the flight and the sheet show together
        if (phone?.matches && selectedPartId) dom.stageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(btn);
      dom.parts.appendChild(li);
    });

    if (focusedPart) dom.parts.querySelector<HTMLElement>(`[data-part-id="${focusedPart}"]`)?.focus({ preventScroll: true });
    if (shownCard !== selectedPartId) dom.card.scrollTop = 0;
    shownCard = selectedPartId;
    const sel = probes.find((pr) => pr.id === selectedPartId);
    const card = sel?.card?.(model);
    if (card) {
      dom.card.hidden = false;
      dom.cardK.textContent = card.kicker;
      const t = splitTitle(card.title);
      dom.cardT.textContent = t.title;
      dom.cardSub.hidden = !t.sub;
      dom.cardSub.textContent = t.sub ?? '';
      dom.cardB.textContent = card.body;
      dom.cardS.innerHTML = '';
      for (const row of card.specs) {
        const div = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = row.k;
        const dd = document.createElement('dd'); dd.textContent = row.v;
        div.append(dt, dd);
        if (row.fig) {
          const evidence = document.createElement('dd'); evidence.className = 'spec-evidence';
          evidence.innerHTML = chip(row.fig.ev, row.fig.src && !/^https?:/.test(row.fig.src) ? row.fig.src : row.fig.src ? row.fig.src.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : undefined);
          div.append(evidence);
        }
        dom.cardS.appendChild(div);
      }
    } else {
      dom.card.hidden = true;
    }
  }

  // ---- the final image: rendered in a worker (render-worker.ts, about 2 s at 600 x 400), debounced so a drag asks
  // for one render when it pauses, and latest-wins so a stale render never paints over a newer setting. The docked
  // thumbnail in the view is the same render, scaled down.
  let renderTimer = 0;
  let renderGeneration = 0;
  const retryPhoto = byId<HTMLButtonElement>('finalimg-retry');
  function setPhotoInspection(enabled: boolean, hint: string) {
    dom.finalimgCanvas.setAttribute('aria-disabled', String(!enabled));
    dom.finalimgCanvas.tabIndex = enabled ? 0 : -1;
    dom.finalimgCanvas.setAttribute('aria-label', enabled
      ? 'Calculated photo. Click a pixel, or press Enter to inspect the center.' : hint);
    const help = document.querySelector('.photo-hint');
    if (help) help.textContent = hint;
  }
  retryPhoto.onclick = () => renderFinalImage(compute(store.get().scenario));
  onRenderFailure(() => {
    setPhotoInspection(false, 'Retry the photo to inspect a pixel');
    dom.finalimgCanvas.closest('.finalimg-card')?.classList.remove('rendering');
    dom.dock.classList.remove('rendering');
    dom.finalimgCanvas.setAttribute('aria-busy', 'false');
    dom.finalimgCap.textContent = 'The photo renderer stopped. Retry to restore this photo and its pixel inspection.';
    retryPhoto.hidden = false;
  });
  function renderFinalImage(model: Model) {
    setPhotoInspection(false, 'Updating the photo…');
    retryPhoto.hidden = true;
    dom.finalimgCanvas.setAttribute('aria-busy', 'true');
    const generation = ++renderGeneration;
    window.clearTimeout(renderTimer);
    dom.finalimgCanvas.closest('.finalimg-card')?.classList.add('rendering');
    dom.dock.classList.add('rendering');
    dom.dockCap.textContent = `${fmtFno(model.scenario.fno)} · ${fmtShutter(model.scenario.shutter)}`;
    renderTimer = window.setTimeout(async () => {
      const w = dom.finalimgCanvas.width, h = dom.finalimgCanvas.height;
      let view: RenderView | null;
      try {
        view = await requestRender(model.scenario, w, h, 1);
      } catch (err) {
        if (generation !== renderGeneration) return;
        setPhotoInspection(false, 'Retry the photo to inspect a pixel');
        dom.finalimgCap.textContent = 'The photo could not be rendered. Retry to keep these settings.';
        dom.finalimgCanvas.closest('.finalimg-card')?.classList.remove('rendering');
        dom.finalimgCanvas.setAttribute('aria-busy', 'false');
        retryPhoto.hidden = false;
        dom.dock.classList.remove('rendering');
        console.error('ui.ts: render failed', err);
        return;
      }
      if (!view || generation !== renderGeneration) return; // includes changes still inside the debounce interval
      dom.finalimgCanvas.setAttribute('aria-busy', 'false');
      const ctx = dom.finalimgCanvas.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(view.width, view.height);
      imageData.data.set(view.rgba);
      ctx.putImageData(imageData, 0, 0);
      setPhotoInspection(true, 'Tap the photo to inspect a pixel');
      dom.finalimgCanvas.closest('.finalimg-card')?.classList.remove('rendering');
      const dctx = dom.dockCanvas.getContext('2d');
      if (dctx) { dctx.imageSmoothingQuality = 'high'; dctx.drawImage(dom.finalimgCanvas, 0, 0, dom.dockCanvas.width, dom.dockCanvas.height); }
      dom.dock.classList.remove('rendering');
      publishRender(view);
      const block = Math.round(view.pixelScale);
      const sc = view.scenario;
      const nbsp = ' ';
      // "EACH ONE 14 × 14 SENSOR PIXELS" wraps mid-phrase if the line breaks at an ordinary space (R3-04): keep the
      // pixel count and its unit on one line, wherever the rest of the (pre-line) text wraps.
      const eachOne = `each one${nbsp}${block}${nbsp}×${nbsp}${block}${nbsp}sensor${nbsp}pixels`;
      dom.finalimgScale.textContent = `${view.width} × ${view.height} px · ${eachOne}
`
        + `${fmtFno(sc.fno)} · ${fmtShutter(sc.shutter)} · ISO ${Math.round(sc.iso)} · focus ${fmtDistance(model.focus.distanceMm)}`;
      // A long lens's narrow view misses the charts at any focus: say so, in the card and on the dock, instead of
      // showing a gray field that looks like a failed render (R1-06).
      const empty = !targetsInFrame(model);
      const chartsAt = fmtDistance(sceneTargets(model.scenario.scene ?? 'bench', model.scenario.subjectM).find((t) => t.id === 'colorchecker')?.z ?? 3000);
      dom.finalimgCap.classList.toggle('finalimg-empty', empty);
      dom.finalimgCap.textContent = empty
        ? `At ${model.lens.focalLength} mm the view is too narrow to take in the test charts. The charts stand ${chartsAt} away, outside `
          + `this narrow view, so this frame holds the gray wall far behind them and the small foreground swatch used to test background blur. `
          + `Pick a 35 or 50 mm lens to see the charts in the shot.`
        : `The engine's render of this shot, with the photon and read noise of the sensor pixels behind each image pixel. `
          + `It is shown no larger than it was rendered, so any softness comes from the shot, not from enlarging it. Tap a spot to open the loupe on it.`;
      const dockEmpty = document.getElementById('fi-dock-empty');
      if (dockEmpty) { dockEmpty.hidden = !empty; dockEmpty.textContent = empty ? 'Charts outside this view' : ''; }
    }, 120);
  }

  let renderedState: AppState | null = null;
  function render(state: AppState) {
    const apertureNotice = apertureClampNotice(renderedState, state);
    if (apertureNotice) toast(apertureNotice, false, 6000);
    const { scenario, piece } = state;
    const shotChanged = !renderedState || renderedState.scenario !== scenario;
    const viewChanged = !renderedState || renderedState.piece !== piece;
    const parentChanged = !renderedState || renderedState.cameraPart !== state.cameraPart;
    const model = shotChanged || !lastModel ? compute(scenario) : lastModel;
    lastModel = model;
    const p = PIECES.find((x) => x.id === piece)!;
    dom.stageSection.style.setProperty('--accent', p.color);
    dom.stageSection.dataset.level = piece;
    stage.showPiece(piece, p.title, subFor(model, piece));
    if (shotChanged || viewChanged) stage.update(model, scenario);
    if (viewChanged) { selectedPartId = null; }
    if (piece === 'camera' && (viewChanged || parentChanged)) {
      selectedPartId = state.cameraPart;
      stage.selectPin(selectedPartId);
    }
    renderedState = state;
    // the camera's own chrome: the Rays chip and the docked final image belong to level 1
    dom.raysChip.hidden = piece !== 'camera';
    dom.dock.hidden = piece !== 'camera';
    setHint();
    spy();
    renderScenario(scenario, model);
    renderSteps(model, piece);
    renderPanel(model, piece);
    if (shotChanged) renderFinalImage(model);
  }

  // the camera's own controls (the focus ring, the command dials) set the scenario through the bus
  on('scenario-set', (p) => store.set(p));
  on('goto-piece', (e) => store.setPiece(e.piece));
  on('piece-loading', (event) => {
    // Asset-backed cards read the loaded rig's focus-ring/glass state. Refresh after an async
    // body/lens swap, even when no further scenario change follows its completion.
    const state = store.get();
    if (!event.loading && !event.error && event.id === state.piece) renderPanel(compute(state.scenario), state.piece);
  });
  on('select-part', (e) => {
    if (e.id === selectedPartId) return;
    selectedPartId = e.id;
    const state = store.get();
    if (state.piece === 'camera') store.setCameraPart(cameraPart(e.id));
    else stage.selectPin(e.id);
    renderPanel(compute(state.scenario), state.piece);
    if (e.id) document.getElementById('tab-explain')?.click();
  });
  store.subscribe(render);
}
