// The page shell around the 3D view: the settings (body, lens, aperture, focus, shutter, ISO, format), the level strip
// (the camera and its three inspection views), the part list and its cards, the stat row with evidence chips, and
// focused physics controls. Reads Model only through engine-api.ts's compute();
// never computes physics itself. Queries the DOM ids index.html defines and wires them once.
import { glossify } from './gloss';
import type { PartCard } from '../pieces/types';
import type { Model } from '../engine/model-types';
import type { FormatId, Scenario } from '../engine/types';
import { bodyForLens, compute, defaultFocusM, lensSummary, LINEUP, LONG_LENS_MM, type BodyId } from './engine-api';
import { motionPartial, motionSpeedOf } from './motion';
import { emit, on } from './bus';
import { type AppState, type PieceId, type Store } from './store';
import { cameraPart, PART_LABELS } from './inspection';
import { adjacentPart, insidePin, insideView, VIEW_LABELS } from './part-navigation';
import { FOCUS_STEPS, focusStepValue, focusStepFromMm } from './focus-control';
import type { Stage } from './stage';
import { fmtDistance, fmtFno, fmtShutter, fmtPitch, fmtDims, fmtNum, fmtRange, fmtSnr } from './units';
import { apertureClampNotice, apertureModelNote, exposureDefaults, lensFocusNotice } from './equipment-feedback';

// ---- standard photographic third-stop control steps ------------------------------------------------------
// UI control-step conventions (every digital camera's aperture/shutter/ISO dial uses this spacing), not a physics
// claim about the lens or sensor; no evidence chip applies to a control's step size.
import { exposureLine } from './exposure-line';
import { apertureSteps, THIRD_STOP_SHUTTER, THIRD_STOP_ISO, isoLabel } from './stops';
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
    lede: "A deep dive into focus. One point's light converges to a point on the sensor when it is in focus, and paints a disk when it is not. Ray colors are the traced wavelengths, red to violet." },
  { id: 'loupe', n: 4, title: 'The pixel', short: 'Pixel', color: 'var(--loupe)', deep: true,
    lede: 'A deep dive into one pixel. From a controlled light sample down to the microlens, the color filter and the well that counts the electrons.' },
];

export function chip(ev: string, src?: string): string {
  const SHORT: Record<string, string> = { spec: 'Spec', vendor: 'Vendor', reported: 'Reported', derived: 'Calc.', assumed: 'Assumed' };
  // Plain words (score loop r6): what the label means where it is read, not only on the Method page. "Calc." is a result
  // the simulator worked out, never a measurement of a real lens.
  const TITLE: Record<string, string> = { spec: 'A published specification: a number the maker or a standard states', vendor: "From the maker's own figures",
    reported: 'Reported by a third party', derived: 'Calculated from the settings and the lens design; not measured on a real lens',
    assumed: 'Based on a stated modeling assumption, not a measurement' };
  const title = `${TITLE[ev] ?? ''}${src ? `: ${src}` : ''}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span class="chip ${ev}" title="${title}" data-evidence-note>${SHORT[ev] ?? ev}</span>`;
}

// A touch screen has no hover, so the label's explanation opens on a tap or click as a small note (score loop r6).
let chipNote: HTMLElement | null = null;
if (typeof document !== 'undefined') document.addEventListener('click', (event) => {
  const el = (event.target as Element | null)?.closest<HTMLElement>('.chip[data-evidence-note]');
  if (!el || !el.title) { if (chipNote?.matches(':popover-open')) chipNote.hidePopover(); return; }
  if (!chipNote) {
    chipNote = document.createElement('div');
    chipNote.className = 'gloss-pop evidence-note'; chipNote.setAttribute('popover', 'manual'); chipNote.setAttribute('role', 'note');
    chipNote.addEventListener('click', () => chipNote?.hidePopover());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chipNote?.matches(':popover-open')) chipNote.hidePopover(); });
    document.body.append(chipNote);
  }
  if (chipNote.matches(':popover-open') && chipNote.dataset.for === el.dataset.noteId) { chipNote.hidePopover(); return; }
  if (chipNote.matches(':popover-open')) chipNote.hidePopover();
  el.dataset.noteId ||= String(Math.random()).slice(2);
  chipNote.dataset.for = el.dataset.noteId;
  chipNote.textContent = `${el.textContent}: ${el.title}`;
  chipNote.showPopover();
  const r = el.getBoundingClientRect(), w = Math.min(300, innerWidth - 24);
  chipNote.style.width = `${w}px`;
  const h = chipNote.getBoundingClientRect().height;
  chipNote.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  chipNote.style.top = `${r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
});

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
  scBody: HTMLElement; scLens: HTMLElement; scFno: HTMLInputElement; scFnoV: HTMLElement; scFnoNote: HTMLElement;
  scFocus: HTMLInputElement; scFocusV: HTMLElement; scShutter: HTMLInputElement; scShutterV: HTMLElement;
  scIso: HTMLInputElement; scIsoV: HTMLElement; scLive: HTMLElement; scFormat: HTMLElement; scMotion: HTMLElement; kpis: HTMLElement;
  steps: HTMLElement; intro: HTMLElement; partsK: HTMLElement; parts: HTMLElement; partsAll: HTMLButtonElement;
  card: HTMLElement; cardK: HTMLElement; cardT: HTMLElement; cardSub: HTMLElement; cardB: HTMLElement; cardMore: HTMLDetailsElement; cardMoreB: HTMLElement; cardS: HTMLElement; cardMoreS: HTMLDetailsElement; cardS2: HTMLElement; cardX: HTMLButtonElement;
  resetView: HTMLButtonElement; shareBtn: HTMLButtonElement; toast: HTMLElement;
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
    scBody: byId('sc-body'), scLens: byId('sc-lens'), scFno: byId('sc-fno'), scFnoV: byId('sc-fno-v'), scFnoNote: byId('sc-fno-note'),
    scFocus: byId('sc-focus'), scFocusV: byId('sc-focus-v'), scShutter: byId('sc-shutter'), scShutterV: byId('sc-shutter-v'),
    scIso: byId('sc-iso'), scIsoV: byId('sc-iso-v'), scLive: byId('sc-live'), scFormat: byId('sc-format'), scMotion: byId('sc-motion'), kpis: byId('kpis'),
    steps: byId('steps'), intro: byId('intro'), partsK: byId('parts-k'), parts: byId('parts'), partsAll: byId('parts-all'),
    card: byId('card'), cardK: byId('card-k'), cardT: byId('card-t'), cardSub: byId('card-sub'), cardB: byId('card-b'), cardMore: byId('card-more') as HTMLDetailsElement, cardMoreB: byId('card-more-b'), cardS: byId('card-s'), cardMoreS: byId('card-more-specs') as HTMLDetailsElement, cardS2: byId('card-s2'), cardX: byId('card-x'),
    resetView: byId('reset-view'), shareBtn: byId('share-btn'), toast: byId('toast'),
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

/** Set by the body and lens buttons just before they change the kit, so the focus a lens switch itself chooses is announced
 *  (a photograph's "Use these settings" names its own focus and is not). */
let kitSwitch = false;

/** A card title's parenthetical provenance ("50 mm f/1.8 (generic, after ...)") goes on a mono line of its own. Only
 *  a final, balanced parenthetical with no parentheses inside splits off; a title with two or nested parentheticals
 *  stays whole (score loop r2: "Front element (L1) · 50 mm f/1.8 (patent example, ...)" split from the first "(" to
 *  the last ")" and read "L1) · 50 mm f/1.8 (patent example, ..."). */
export function splitTitle(title: string): { title: string; sub: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(title);
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
      kitSwitch = true; store.set(lensChange(cur, LINEUP[b.id].includes(next) ? next : LINEUP[b.id][1], store.get().scenario.focusM));
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
      btn.addEventListener('click', () => { const sc = store.get().scenario; kitSwitch = true; store.set(lensChange(sc.lens, id, sc.focusM)); });
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
  // A tap that changes the level paints before the level's work starts (score loop r5). Building a level and tracing its
  // rays is a task of 120 to 650 ms on a 4x-throttled phone, and it ran inside the click handler, so the browser could
  // not paint the pressed tab or the loading veil until it ended (INP 280 to 650 ms). The handler now marks the tab and
  // dims the view (stage.announceEntry), and the work runs in the task after the next paint.
  // Taps run in the order they were made, each after its own paint. A tap that finds another path (a lesson, the keyboard, the URL)
  // has changed the level since it was made, and no earlier tap has run in between, is dropped: that change is the later word.
  let pendingTaps = 0, executedTaps = 0;
  function enterLevel(id: PieceId, go: () => void) {
    const from = store.get().piece, executedAtTap = executedTaps;
    pendingTaps++;
    for (const [pid, el] of stepEls) el.classList.toggle('entering', pid === id);
    stage.announceEntry(id);
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      pendingTaps--;
      try {
        if (executedTaps === executedAtTap && store.get().piece !== from) return;
        executedTaps++;
        go();
      } finally { if (!pendingTaps) for (const el of stepEls.values()) el.classList.remove('entering'); }
    };
    // a hidden document paints nothing and runs no animation frames: the entry runs at once there
    if (document.hidden) { run(); return; }
    requestAnimationFrame(() => setTimeout(run, 0));
    setTimeout(run, 500); // a frame that never comes (a throttled tab) must not strand the tap
  }
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
      // what a tap does is decided when it runs (a tap made while another is waiting sees that one's result), but a tap on the level
      // already shown, with nothing waiting, only re-frames it, at once
      const act = () => {
        // From a deeper level the Camera tab goes back the way the crumb does, to the part the visitor came from (score loop r6: the
        // two controls named Camera did different things, and the tab dropped the place the crumb kept)
        if (p.id === 'camera' && store.get().piece !== 'camera') store.setPiece('camera');
        else if (p.id === 'camera') { store.showCameraOverview(); stage.resetView(); }
        else if (store.get().piece === p.id) stage.resetView();
        else store.setPiece(p.id);
      };
      if (!pendingTaps && store.get().piece === p.id) act();
      else enterLevel(p.id, act);
    });
    dom.steps.appendChild(btn);
    stepEls.set(p.id, btn);
  }

  const inspectionBar = document.createElement('div');
  inspectionBar.className = 'inspection-context';
  inspectionBar.hidden = true;
  inspectionBar.innerHTML = '<button type="button" class="inspection-back"></button><span aria-hidden="true">/</span><span class="inspection-here"></span><span class="inspection-note">Same camera, a closer look</span><button type="button" class="inspection-why" aria-expanded="false" aria-controls="level-why">Why?</button>';
  dom.steps.after(inspectionBar);
  const inspectionBack = inspectionBar.querySelector<HTMLButtonElement>('button')!;
  // Score loop r6: on a phone the crumb and the level's one-line reason made two rows (about 100 px of a 740 px screen) over a
  // 195 px model. The reason folds behind this toggle on the three deep levels (CSS shows it only at 760 px and under) and
  // returns to folded on every level change.
  const whyToggle = inspectionBar.querySelector<HTMLButtonElement>('.inspection-why')!;
  const setWhyOpen = (open: boolean) => {
    document.body.classList.toggle('why-open', open);
    whyToggle.setAttribute('aria-expanded', String(open));
    window.dispatchEvent(new Event('resize'));
  };
  whyToggle.addEventListener('click', () => setWhyOpen(whyToggle.getAttribute('aria-expanded') !== 'true'));
  let whyFor: PieceId | null = null;
  inspectionBack.addEventListener('click', () => enterLevel('camera', () => store.setPiece('camera')));
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
    for (const [id, k] of [['scenario', 'scenario']] as const) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= line) key = k;
    }
    // the last section can never reach the line: at the foot of the page it is the one on screen (R2-05)
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

  // ---- a cue for the part card on a phone whose page scrolls (score loop r6) --------------------------------------------------
  // Picking a part scrolls the page to the model so the flight shows; on a short phone (320x568, 360x640) the part list and the
  // card then sit below the screen and the tab row, and nothing said a card had opened. The cue is a strip under the
  // model while the card is off screen: it brings the card up and moves focus to its heading. It goes when the card shows.
  const cardCue = document.createElement('button');
  cardCue.type = 'button'; cardCue.className = 'card-cue'; cardCue.hidden = true;
  cardCue.textContent = 'Details below';
  cardCue.setAttribute('aria-label', 'Details below: go to the part card');
  document.getElementById('view')?.after(cardCue);
  const cardOnScreen = () => {
    if (dom.card.hidden) return true;
    const r = dom.card.getBoundingClientRect(), row = document.querySelector('.inspector-tab-row');
    const floor = row && getComputedStyle(row).position === 'fixed' ? row.getBoundingClientRect().top : window.innerHeight;
    return r.height > 0 && r.top < Math.min(window.innerHeight, floor) - 40 && r.bottom > 40;
  };
  let cueTimer = 0;
  function syncCardCue() {
    window.clearTimeout(cueTimer);
    // after the page's own smooth scroll to the model has settled
    cueTimer = window.setTimeout(() => { cardCue.hidden = !(phone?.matches && selectedPartId && !dom.card.hidden && !cardOnScreen()); }, 600);
  }
  window.addEventListener('scroll', () => { if (!cardCue.hidden && cardOnScreen()) cardCue.hidden = true; }, { passive: true });
  cardCue.addEventListener('click', () => {
    cardCue.hidden = true;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    dom.card.scrollIntoView({ block: 'start', behavior: calm ? 'instant' : 'smooth' });
    dom.cardT.tabIndex = -1;
    dom.cardT.focus({ preventScroll: true });
  });
  const setHint = () => {
    // Chosen by the pointer, not the width: a phone on its side is wide but still pinches (review loop 10/11/2026).
    const touch = matchMedia('(pointer: coarse)').matches || !!phone?.matches;
    const zoom = touch ? 'pinch to zoom' : 'Scroll to zoom';
    const keys = touch ? '' : ' · ← → step through the parts';
    dom.hint.textContent = store.get().piece === 'camera'
      ? `Drag the focus ring or a dial to set it · drag elsewhere to orbit · ${zoom}${keys}`
      : `Drag to orbit · ${zoom}${keys}`;
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
  const resetView = () => {
    if (store.get().piece === 'camera' && selectedPartId) stage.selectPin(selectedPartId);
    else stage.resetView();
  };
  dom.resetView.addEventListener('click', resetView);
  on('reset-view', resetView);
  // Turn and tip buttons: orbiting the model was only a drag, or Shift and the arrow keys on a keyboard. A tap on one is one 10°
  // step, the same as the key (score loop r4, WCAG 2.5.7). They sit in the Controls, above More settings; on a phone that
  // is the Settings sheet.
  const rotate = document.createElement('div');
  rotate.className = 'rotate-controls'; rotate.id = 'rotate-controls'; rotate.setAttribute('role', 'group'); rotate.setAttribute('aria-label', 'Rotate the model');
  rotate.innerHTML = '<span class="rotate-k" aria-hidden="true">Rotate the model</span>'
    + ([['Turn left', '◀', -1, 0], ['Turn right', '▶', 1, 0], ['Tilt up', '▲', 0, -1], ['Tilt down', '▼', 0, 1]] as const)
      .map(([name, glyph, across, vertical]) => `<button type="button" class="btn" data-across="${across}" data-vertical="${vertical}"><span aria-hidden="true">${glyph}</span> ${name}</button>`).join('');
  rotate.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-across]');
    if (button) stage.orbit(Number(button.dataset.across) as -1 | 0 | 1, Number(button.dataset.vertical) as -1 | 0 | 1);
  });
  const scenarioPanel = document.getElementById('scenario');
  const advancedDetails = scenarioPanel?.querySelector('.studio-advanced');
  if (advancedDetails) advancedDetails.before(rotate); else scenarioPanel?.append(rotate);
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
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard may be unavailable: the older copy command is tried next */ }
    if (!copied) {
      // no clipboard API (an insecure page, a locked-down browser): the copy command from a selected, off-screen field
      const field = document.createElement('textarea');
      field.value = url; field.setAttribute('readonly', ''); field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      field.remove();
    }
    // The link itself is in the clipboard; the message stays one short line clear of the view's title (score loop r6: it
    // was the whole address when the clipboard API was missing). Only when nothing could copy does the toast carry the
    // URL, on one line, still selectable whole, for copying by hand.
    if (copied) toast(`Link copied · ${VIEW_LABELS[store.get().piece]} view`, false, 2500);
    else toast(url, true);
  });

  // Rays on/off: the camera hides its traced light and the entrance-pupil bundle, to see the hardware alone.
  dom.raysChip.addEventListener('click', () => {
    const on = dom.raysChip.getAttribute('aria-pressed') !== 'true';
    dom.raysChip.setAttribute('aria-pressed', String(on));
    emit('layer', { id: 'rays', on });
  });

  // ---- the part list and its card ---------------------------------------------------------------------------
  const previous = byId<HTMLButtonElement>('part-prev'), next = byId<HTMLButtonElement>('part-next');
  const door = byId<HTMLButtonElement>('card-go');
  function selectPart(id: string | null) {
    selectedPartId = id;
    if (store.get().piece === 'camera') {
      if (store.get().cameraPart === id) stage.selectPin(id);
      else store.setCameraPart(cameraPart(id));
    }
    else { stage.selectPin(id); store.setPin(id); }
    if (!id) stage.resetView();
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
    const part = cameraPart(selectedPartId);
    const destination = insideView(part);
    if (destination && store.get().piece === 'camera') enterLevel(destination, () => store.setPiece(destination, insidePin(part)));
  });
  // The left and right arrows step through the parts from the model, a pin, or the part navigation's own buttons
  // (score loop r2: they worked only on the canvas, and a click on a pin or Next, the natural way in, took the focus
  // away from it). Sliders, menus, text and tabs keep their arrows. From a pin, the focus follows the new part's pin
  // so a screen reader names it; from a button it stays, and the part position announces the change.
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest?.('#gl, .pin, #part-prev, #part-next, #part-overview') || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    stepPart(event.key === 'ArrowLeft' ? -1 : 1);
    if (target.classList.contains('pin')) {
      requestAnimationFrame(() => {
        const pin = selectedPartId ? document.querySelector<HTMLElement>(`.pin[data-pin-id="${selectedPartId}"]`) : null;
        (pin?.checkVisibility() ? pin : byId('gl')).focus({ preventScroll: true });
      });
    }
  });
  /** A pick made on the model or its pin returns the desktop panel from Parts to Controls when it clears (Esc, a tap on empty
   *  space, a second tap on the same pin): the sliders were gone until Controls was clicked (score loop r6). The Overview
   *  button and the card's close leave the panel as it is, as the list the reader was using. A phone's sheet is not a tab. */
  function backToControls() {
    if (matchMedia('(max-width: 599px)').matches || document.body.classList.contains('tour-active')) return;
    if (document.getElementById('tab-explain')?.getAttribute('aria-selected') === 'true') document.getElementById('tab-controls')?.click();
  }
  function clearSelection(toControls = false) {
    selectedPartId = null;
    stage.selectPin(null);
    const s = store.get();
    if (s.piece === 'camera') store.setCameraPart(null);
    else store.setPin(null);
    renderPanel(compute(s.scenario), s.piece);
    if (toControls) backToControls();
  }
  // Closing the card with its × puts focus back on the part's own button in the list (score loop r4: it dropped to <body>,
  // so a keyboard or screen reader user started again from the top of the page). The list is rebuilt by the render that
  // clearing the selection causes, so the button is looked up after it, and once more a frame later in case the store
  // renders asynchronously.
  dom.cardX.addEventListener('click', () => {
    const closing = selectedPartId;
    clearSelection();
    const refocus = () => {
      if (dom.parts.contains(document.activeElement) && document.activeElement !== document.body) return;
      const button = closing ? dom.parts.querySelector<HTMLElement>(`[data-part-id="${closing}"]`) : null;
      (button?.checkVisibility() ? button : byId('gl')).focus({ preventScroll: true });
    };
    refocus(); requestAnimationFrame(refocus);
  });
  window.addEventListener('keydown', (e) => {
    // Escape belongs to an open dialog, not to the selected part behind its backdrop; the full-view mode and the
    // tour take it first (workspace.ts, learning.ts).
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (selectedPartId && phone?.matches) { clearSelection(); return; }
    // From the model or a pin, Escape steps out one place at a time: the picked part to the level's overview, then a
    // deeper level up to the camera (score loop r3: only the breadcrumb and the level tabs went back up).
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('#gl, .pin')) return;
    e.preventDefault();
    if (selectedPartId) { clearSelection(true); stage.resetView(); }
    else if (store.get().piece !== 'camera') store.setPiece('camera');
    else return;
    if (target.classList.contains('pin') && !target.checkVisibility()) byId('gl').focus({ preventScroll: true });
  });

  let lastModel: Model | null = null;

  function renderScenario(scenario: Scenario, model: Model) {
    const body = bodyForLens(scenario.lens);
    dom.scBody.closest('.sc-sub')!.toggleAttribute('hidden', !body);
    if (body) buildLensGroup(body);
    for (const btn of dom.scBody.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.body === body));
    for (const btn of dom.scLens.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.lens === scenario.lens));
    for (const btn of dom.scFormat.children) (btn as HTMLElement).setAttribute('aria-pressed', String((btn as HTMLElement).dataset.format === scenario.format));
    const speedMps = motionSpeedOf(scenario);
    for (const btn of dom.scMotion.children) (btn as HTMLElement).setAttribute('aria-pressed', String(Number((btn as HTMLElement).dataset.speed) === speedMps));

    const fnoSteps = apertureSteps(model.lens.maxFno);
    dom.scFno.max = String(Math.max(0, fnoSteps.length - 1));
    dom.scFno.value = String(nearestIndex(fnoSteps, scenario.fno));
    dom.scFnoV.textContent = fmtFno(scenario.fno);
    // At the lens's widest opening the control reads its marked stop (f/5.6) while the engine draws the true one
    // (f/5.75): say so beside the readout and under the slider, so the reader knows which aperture the model uses.
    const modelNote = apertureModelNote(scenario.lens, scenario.fno);
    dom.scFnoNote.hidden = !modelNote;
    dom.scFnoNote.textContent = modelNote ?? '';
    if (modelNote) {
      const small = document.createElement('small');
      small.textContent = `(model f/${scenario.fno.toFixed(2)})`;
      dom.scFnoV.append(' ', small);
    }
    dom.scFno.setAttribute('aria-valuetext', dom.scFnoV.textContent ?? '');

    dom.scFocus.value = String(focusStepFromMm(model.lens.closestFocusMm, model.lens.focalLength, scenario.focusM === null ? null : scenario.focusM * 1000));
    dom.scFocusV.textContent = fmtDistance(model.focus.distanceMm);
    dom.scFocus.setAttribute('aria-valuetext', dom.scFocusV.textContent);

    dom.scShutter.value = String(nearestIndex(THIRD_STOP_SHUTTER, scenario.shutter));
    dom.scShutterV.textContent = fmtShutter(scenario.shutter);
    dom.scShutter.setAttribute('aria-valuetext', dom.scShutterV.textContent);

    dom.scIso.value = String(nearestIndex(THIRD_STOP_ISO, scenario.iso));
    // "ISO 51,200" with its "Hi (expanded)" qualifier on a quiet line beneath, so the number is never squeezed (score loop r6)
    const isoText = isoLabel(scenario.iso, model.sensor.isoRange), isoParts = isoText.split(' · ');
    dom.scIsoV.textContent = isoParts[0];
    if (isoParts[1]) { const q = document.createElement('small'); q.textContent = isoParts[1]; dom.scIsoV.append(' ', q); }
    dom.scIso.setAttribute('aria-valuetext', dom.scIsoV.textContent ?? isoText);
    for (const el of [dom.scFno, dom.scFocus, dom.scShutter, dom.scIso]) setPct(el);
    // What these three settings do, in words, from the same exposure numbers the readouts below show (score loop r6)
    dom.scLive.textContent = `${exposureLine(scenario, exposureDefaults(scenario.lens, scenario.scene))} On mid-gray that is ${fmtNum(model.exposure.photonsMidGray, 0)} photons per pixel${model.exposure.grayClipped ? '' : `, signal-to-noise ${fmtSnr(model.exposure, 0)}`}.`;

    // value, label and chip on one line each; the qualifier goes on a quiet line under them (UI-18)
    dom.kpis.innerHTML = [
      [fmtNum(model.exposure.ev100, 1), 'EV100', chip('derived'), 'exposure value at ISO 100; higher suits a brighter scene'],
      [`${fmtNum(model.focus.cocMm * 1000, 2)} µm`, 'Sharpness criterion', chip('assumed', 'format diagonal / 1500'), 'acceptable blur diameter for depth of field'],
      [fmtRange(model.focus.nearMm, model.focus.farMm), 'Depth of field', chip('derived'), `focused at ${fmtDistance(model.focus.distanceMm)}`],
      [`${fmtNum(model.diffraction.airyRadiusUm, 2)} µm`, 'Airy radius', chip('derived'), `diffraction blur, ${fmtNum(model.diffraction.airyRadiusPx, 2)} of a pixel`],
      [fmtNum(model.exposure.photonsMidGray, 0), 'Photons/px', chip('assumed'), 'on an 18% gray patch'],
      [fmtSnr(model.exposure, 1), 'SNR', chip('assumed', model.figs.snrMidGray.src), model.exposure.grayClipped ? `the green 18% gray patch averages ${fmtNum(model.exposure.electronsMidGray, 0)} electrons per pixel, past the ${fmtNum(model.exposure.usableE, 0)} the pixel records at this ISO (${model.exposure.limitedBy === 'adc' ? 'the ADC clips first' : 'the full well'}), so its raw value is clipped` : `spatial signal-to-noise across a green 18% gray patch (${fmtNum(model.exposure.electronsMidGray, 0)} electrons per pixel; shot noise, read noise and pixel-to-pixel variation)`],
    ].map(([v, l, c, d]) => `<div class="kpi"><span class="kv">${v}</span><span class="kl"><span>${l}</span>${c}</span><span class="kd">${d}</span></div>`).join('');
  }

  // One short factual subline per level: what the strip's subline and the in-view title's subline both show.
  function subFor(model: Model, id: PieceId): string {
    if (id === 'camera') return `${model.lens.focalLength} mm ${fmtFno(model.scenario.fno)} · focus ${fmtDistance(model.focus.distanceMm)} · ${fmtShutter(model.scenario.shutter)}`;
    if (id === 'lens') return `${model.lens.focalLength} mm ${fmtFno(model.lens.markedFno)} · ${model.lens.elements} elements`;
    if (id === 'cone') return `focus ${fmtDistance(model.focus.distanceMm)} · acceptable blur ${fmtNum(model.focus.cocMm, 3)} mm`;
    return `${fmtPitch(model.sensor.pitchUm)} pitch · ${fmtDims(model.sensor.widthPx, model.sensor.heightPx)}`;
  }

  // ---- orientation for a screen reader (score loop r4) ---------------------------------------------------------------
  // One polite region says what changed: the level on a level change ("Optics level: The lens, 6 parts") and the part on a
  // part change ("Part 2 of 8: Focus ring"). The drawn title and the part counter are hidden on a phone, where a live region
  // that is display:none is never spoken, so this one is visually hidden instead. The level's name is also a heading, and
  // the tab's title follows the level (and the Real photos view).
  const LEVEL_NAMES: Record<PieceId, string> = { camera: 'Camera', lens: 'Optics', cone: 'Focus', loupe: 'Pixel' };
  const announceRegion = document.getElementById('sr-announce');
  const levelHeading = document.getElementById('level-heading');
  let announceTimer = 0;
  function announce(text: string) {
    if (!announceRegion) return;
    // emptied first so an identical sentence (the same part picked again) is still spoken
    announceRegion.textContent = '';
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { announceRegion.textContent = text; }, 60);
  }
  function setDocumentTitle() {
    const photos = document.body.dataset.workspaceView === 'photos';
    const piece = PIECES.find(x => x.id === store.get().piece);
    document.title = `${photos ? 'Real photos' : piece?.title ?? 'The camera'} · Photon to Photo`;
  }
  document.addEventListener('workspace-view', setDocumentTitle);
  let announcedLevel: PieceId | null = null, announcedPart: string | null | undefined;
  function announceChanges(activePiece: PieceId, partLabel: string | null, index: number, count: number) {
    if (!count) return; // the level is still loading: its parts are not there yet
    if (announcedLevel !== activePiece) {
      const first = announcedLevel === null;
      announcedLevel = activePiece; announcedPart = selectedPartId;
      if (!first) announce(`${LEVEL_NAMES[activePiece]} level: ${PIECES.find(x => x.id === activePiece)!.title}, ${count} ${count === 1 ? 'part' : 'parts'}`);
      return;
    }
    if (announcedPart === selectedPartId) return;
    announcedPart = selectedPartId;
    announce(partLabel ? `Part ${index + 1} of ${count}: ${partLabel}` : 'Overview');
  }

  function renderSteps(model: Model, activePiece: PieceId) {
    for (const p of PIECES) {
      const el = stepEls.get(p.id)!;
      el.classList.remove('entering');
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
    if (whyFor !== activePiece) { whyFor = activePiece; if (document.body.classList.contains('why-open')) setWhyOpen(false); }
    const parent = store.get().cameraPart;
    inspectionBack.textContent = `← Camera${parent ? ` · ${PART_LABELS[parent]}` : ''}`;
    inspectionBar.querySelector('.inspection-here')!.textContent = p.title;
    const probes = stage.activeProbes();
    if (selectedPartId && !probes.some((pr) => pr.id === selectedPartId)) selectedPartId = null;

    dom.partsK.textContent = `${probes.length} ${probes.length === 1 ? 'part' : 'parts'}`;
    dom.partsAll.hidden = true;
    dom.parts.classList.remove('collapsed');
    const selectedIndex = probes.findIndex(pr => pr.id === selectedPartId);
    // "Part 6 of 8", not "6 / 8": beside the tour's "8 / 10" a bare fraction read as a second tour counter (score loop r2)
    byId('part-position').textContent = selectedIndex < 0 ? 'Overview' : `Part ${selectedIndex + 1} of ${probes.length}`;
    if (levelHeading) levelHeading.textContent = p.title;
    setDocumentTitle();
    announceChanges(activePiece, selectedIndex < 0 ? null : probes[selectedIndex].label, selectedIndex, probes.length);
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
    const overviewItem = document.createElement('li');
    overviewItem.classList.toggle('sel', selectedPartId === null);
    const overviewButton = document.createElement('button');
    overviewButton.type = 'button';
    overviewButton.dataset.partId = 'overview';
    overviewButton.setAttribute('aria-pressed', String(selectedPartId === null));
    overviewButton.title = `Show the full ${VIEW_LABELS[activePiece].toLowerCase()} view`;
    overviewButton.innerHTML = '<span class="pn">0</span><span class="pt">Overview</span>';
    overviewButton.addEventListener('click', () => selectPart(null));
    overviewItem.append(overviewButton);
    dom.parts.append(overviewItem);
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
        else { stage.selectPin(selectedPartId); store.setPin(selectedPartId); }
        renderPanel(model, store.get().piece);
        // on a phone the list sits under the view: bring the camera back up so the flight and the sheet show together
        if (phone?.matches && selectedPartId) dom.stageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.appendChild(btn);
      dom.parts.appendChild(li);
    });

    if (focusedPart) dom.parts.querySelector<HTMLElement>(`[data-part-id="${focusedPart}"]`)?.focus({ preventScroll: true });
    const newCard = shownCard !== selectedPartId;
    if (newCard) dom.card.scrollTop = 0;
    shownCard = selectedPartId;
    const sel = probes.find((pr) => pr.id === selectedPartId);
    const card = sel?.card?.(model);
    if (card) {
      dom.card.hidden = false;
      // A camera part's card is headed by the part's own name, as the list and its pin show it, with its live value
      // (f/4, 8,256 × 5,504 pixels) on the line under it; its eyebrow says where it sits (score loop r3: the heading
      // was the value, and the eyebrow named "the aperture" beside a list entry "Iris (aperture)").
      const cameraCard = activePiece === 'camera';
      dom.cardK.textContent = cameraCard ? `The camera · part ${selectedIndex + 1} of ${probes.length}` : card.kicker;
      // The other levels' cards are headed the same way (score loop r5: a tapped "Sensor" opened "Nikon D850", "Iris"
      // opened "7-blade aperture", "The well" opened "The charge well"): the list's name is the heading, and the card's own
      // title, when it differs, leads the line under it.
      const own = card.sub !== undefined ? { title: card.title, sub: card.sub } : splitTitle(card.title);
      const bare = (x: string) => x.trim().toLowerCase().replace(/^the\s+/, '');
      const t = cameraCard ? { title: sel!.label, sub: [card.title, card.sub].filter(Boolean).join(' · ') }
        : bare(own.title) === bare(sel!.label) ? { title: sel!.label, sub: own.sub }
        : { title: sel!.label, sub: [own.title, own.sub].filter(Boolean).join(' · ') };
      dom.cardT.textContent = t.title;
      dom.cardSub.hidden = !t.sub;
      dom.cardSub.textContent = t.sub ?? '';
      // glossary terms open their definition in place, each once per card (score loop r2)
      const seen = new Set<string>();
      glossify(dom.cardB, card.body, seen);
      // the expert detail sits under a disclosure that closes again for each newly opened card
      dom.cardMore.hidden = !card.more;
      if (newCard) dom.cardMore.open = false;
      if (card.more) glossify(dom.cardMoreB, card.more, seen); else dom.cardMoreB.textContent = '';
      // the main spec rows, then any the card keeps for a "More settings" disclosure (score loop r5: the sensor card showed eight)
      const fillSpecs = (list: HTMLElement, rows: PartCard['specs']) => {
        list.innerHTML = '';
        for (const row of rows) {
          const div = document.createElement('div');
          const dt = document.createElement('dt'); glossify(dt, row.k, seen);
          const dd = document.createElement('dd'); dd.textContent = row.v;
          div.append(dt, dd);
          if (row.fig) {
            const evidence = document.createElement('dd'); evidence.className = 'spec-evidence';
            evidence.innerHTML = chip(row.fig.ev, row.fig.src && !/^https?:/.test(row.fig.src) ? row.fig.src : row.fig.src ? row.fig.src.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : undefined);
            div.append(evidence);
          }
          list.appendChild(div);
        }
      };
      fillSpecs(dom.cardS, card.specs);
      dom.cardMoreS.hidden = !card.moreSpecs?.length;
      if (newCard) dom.cardMoreS.open = false;
      fillSpecs(dom.cardS2, card.moreSpecs ?? []);
      if (newCard) revealCard();
    } else {
      dom.card.hidden = true;
    }
    syncCardCue();
  }

  /** The card sits under the parts list in the inspector, which on a phone is a ~110 px dock: a newly picked part
   *  scrolls the inspector (only the inspector, never the page) until the card's heading shows, so a tap on a pin
   *  is answered on screen (review loop 10/11/2026: the card opened 150 px below the dock's bottom edge). */
  function revealCard() {
    const panel = dom.card.closest<HTMLElement>('.panel');
    if (!panel || !document.body.classList.contains('workspace')) return;
    requestAnimationFrame(() => {
      const box = panel.getBoundingClientRect(), card = dom.card.getBoundingClientRect();
      if (card.height === 0) return;
      // A short inspector (a phone's sheet or a landscape phone's column, under 420 px) gives the card all of its
      // height, heading at the top (score loop r2); a tall one keeps the part list in view while the card fits.
      if (box.height < 420 ? Math.abs(card.top - box.top) < 6 : card.top >= box.top - 1 && card.top <= box.bottom - Math.min(120, box.height * 0.5)) return;
      // Instant: a smooth scroll here can be cancelled by the page's own scroll back to the model on a phone.
      panel.scrollTop += card.top - box.top - 4;
    });
  }

  // "Reset settings" (score loop r5): the exposure controls back to the defaults for the mounted lens; Reset view only
  // reframes the camera, and a reload keeps the URL's values.
  const resetBtn = document.getElementById('sc-reset') as HTMLButtonElement | null;
  const sameExposure = (a: Scenario, b: Pick<Scenario, 'fno' | 'focusM' | 'shutter' | 'iso'>) =>
    Math.abs(a.fno - b.fno) < 1e-6 && a.focusM === b.focusM && Math.abs(a.shutter - b.shutter) < 1e-9 && a.iso === b.iso;
  function syncReset(state: AppState) {
    if (resetBtn) resetBtn.disabled = sameExposure(state.scenario, exposureDefaults(state.scenario.lens, state.scenario.scene));
  }
  resetBtn?.addEventListener('click', () => {
    const s = store.get().scenario;
    const d = exposureDefaults(s.lens, s.scene);
    store.set(d);
    toast(`Settings reset · ${fmtFno(d.fno)} · ${fmtShutter(d.shutter)} · ISO ${d.iso} · focus ${d.focusM === null ? 'infinity' : fmtDistance(d.focusM * 1000)}`, false, 4000);
  });

  let renderedState: AppState | null = null;
  function render(state: AppState) {
    const apertureNotice = apertureClampNotice(renderedState, state, store.requestedFno());
    const focusNotice = lensFocusNotice(renderedState, state, store.focusRequested() && !kitSwitch);
    kitSwitch = false;
    if (apertureNotice || focusNotice) toast([apertureNotice, focusNotice].filter(Boolean).join(' '), false, 6000);
    syncReset(state);
    const { scenario, piece } = state;
    const shotChanged = !renderedState || renderedState.scenario !== scenario;
    const viewChanged = !renderedState || renderedState.piece !== piece;
    const parentChanged = !renderedState || renderedState.cameraPart !== state.cameraPart;
    const model = shotChanged || !lastModel ? compute(scenario) : lastModel;
    lastModel = model;
    const p = PIECES.find((x) => x.id === piece)!;
    // Level colors identify navigation; controls and evidence chrome inherit house amber.
    dom.stageSection.style.removeProperty('--accent');
    dom.stageSection.dataset.level = piece;
    stage.showPiece(piece, p.title, subFor(model, piece));
    if (shotChanged || viewChanged) stage.update(model, scenario);
    if (viewChanged) { selectedPartId = null; }
    if (piece === 'camera' && (viewChanged || parentChanged)) {
      selectedPartId = state.cameraPart;
      stage.selectPin(selectedPartId);
    }
    // A deeper level's pick comes from the URL (sel=, a reload, a shared link or Back) or from Go inside; the
    // reader's own picks set it after selecting, so this only acts when the two differ (score loop r3).
    if (piece !== 'camera' && (viewChanged || renderedState?.pin !== state.pin) && (state.pin ?? null) !== selectedPartId) {
      selectedPartId = state.pin ?? null;
      stage.selectPin(selectedPartId);
    }
    renderedState = state;
    // The ray toggle belongs to the camera overview.
    dom.raysChip.hidden = piece !== 'camera';
    setHint();
    spy();
    renderScenario(scenario, model);
    renderSteps(model, piece);
    renderPanel(model, piece);
  }

  // the camera's own controls (the focus ring, the command dials) set the scenario through the bus
  on('scenario-set', (p) => store.set(p));
  // 'Use these settings' changes the camera in place: a toast shows what it was set to and the live region says it
  // (score loop r5: the change was silent, with no sign that the camera now matched the photo)
  on('camera-set', (e) => { toast(e.text, false, 6000); announce(e.text); });
  on('goto-piece', (e) => store.setPiece(e.piece));
  on('piece-loading', (event) => {
    // Asset-backed cards read the loaded rig's focus-ring/glass state. Refresh after an async
    // body/lens swap, even when no further scenario change follows its completion.
    const state = store.get();
    if (!event.loading && !event.error && event.id === state.piece) {
      // a level that was still loading when its sel= arrived selects that part now that its pins exist
      if (state.piece !== 'camera' && state.pin && selectedPartId !== state.pin && stage.activeProbes().some(p => p.id === state.pin)) {
        selectedPartId = state.pin; stage.selectPin(state.pin);
      }
      renderPanel(compute(state.scenario), state.piece);
    }
  });
  on('card-stale', (e) => {
    const state = store.get();
    if (e.piece === state.piece && selectedPartId) renderPanel(compute(state.scenario), state.piece);
  });
  on('select-part', (e) => {
    if (e.id === selectedPartId) return;
    selectedPartId = e.id;
    const state = store.get();
    if (state.piece === 'camera') store.setCameraPart(cameraPart(e.id));
    else { stage.selectPin(e.id); store.setPin(e.id); }
    renderPanel(compute(state.scenario), state.piece);
    if (e.id) document.getElementById('tab-explain')?.click();
    else backToControls();
  });
  store.subscribe(render);
}
