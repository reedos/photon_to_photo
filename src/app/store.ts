// Scenario state + subscribe, and the URL query <-> scenario translation docs/PROTOTYPE.md's hooks section
// asks for (lens, fno, focus, shutter, iso, format, piece). Pure functions here (scenarioFromQuery /
// queryFromState) are the tested surface; the Store class is a thin pub-sub wrapper plus the URL side effect,
// guarded so it is safe to import from a non-browser environment (vitest's default node test environment).
import type { FormatId, Scenario } from '../engine/types';
import { bodyForLens, normalizeScenario } from './engine-api';
import { sensorFor } from '../engine/data';
import { cameraPart, inspectionParent, type CameraPart } from './inspection';

// 'camera' is docs/PANE.md's one pane (the whole camera and lens); the three first-pass pieces stay as its details
export type PieceId = 'camera' | 'lens' | 'cone' | 'loupe';
export const PIECE_IDS: PieceId[] = ['camera', 'lens', 'cone', 'loupe'];

export interface AppState {
  scenario: Scenario;
  piece: PieceId;
  cameraPart: CameraPart | null;
  /** The part picked on a deeper level (Optics, Focus, Pixel): one of that level's pin ids, carried in the URL as
   *  sel=<id> so a reload or a shared link reopens it (score loop r3). The camera level's own pick is cameraPart. */
  pin?: string | null;
  /** The f-number the last set() asked for, before normalizeScenario clamped it to the lens (score loop r2: the
   *  aperture-clamp notice quotes it). */
  requestedFno?: number;
}

type Listener = (state: AppState) => void;

// ---- shutter: 1/8000s .. 30s round-trips as "1/N" below a second, decimal seconds at or above one ----------

function parseShutter(raw: string): number | undefined {
  if (!raw) return undefined;
  if (raw.includes('/')) {
    const [n, d] = raw.split('/').map(Number);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return n / d;
    return undefined;
  }
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export function formatShutter(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '0';
  const denominator = Math.round(1 / t);
  return t < 1 && Math.abs(1 / t - denominator) < 1e-8 ? `1/${denominator}` : `${Number(t.toFixed(3))}`;
}

// ---- focus: meters, or "inf" for infinity (Scenario.focusM = null) -------------------------------------------

function parseFocus(raw: string): number | null | undefined {
  if (!raw) return undefined;
  if (raw === 'inf') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

function formatFocus(m: number | null): string {
  return m === null ? 'inf' : String(m);
}

const VALID_PIECES = new Set<PieceId>(PIECE_IDS);

/** Reads a query string (with or without its leading "?") into a partial scenario plus the active piece. Every
 *  field is optional; normalizeScenario (engine-api.ts) fills and clamps whatever is missing or out of range. */
export function scenarioFromQuery(search: string): { scenario: Partial<Scenario>; piece?: PieceId; cameraPart: CameraPart | null; pin?: string | null } {
  const params = new URLSearchParams(search);
  const scenario: Partial<Scenario> = {};
  const lens = params.get('lens');
  if (lens) scenario.lens = lens;
  const fno = params.get('fno');
  if (fno) { const v = Number(fno); if (Number.isFinite(v)) scenario.fno = v; }
  const focus = params.get('focus');
  if (focus !== null) { const v = parseFocus(focus); if (v !== undefined) scenario.focusM = v; }
  const shutter = params.get('shutter');
  if (shutter) { const v = parseShutter(shutter); if (v !== undefined) scenario.shutter = v; }
  const iso = params.get('iso');
  if (iso) { const v = Number(iso); if (Number.isFinite(v)) scenario.iso = v; }
  const format = params.get('format');
  if (format === 'ff' || format === 'apsc' || format === 'mft') scenario.format = format as FormatId;
  const scene = params.get('scene');
  if (scene) scenario.scene = scene;
  const motion = params.get('motion');
  if (motion) { const v = Number(motion); if (Number.isFinite(v)) scenario.motion = { speedMps: v }; }
  const subject = params.get('subject');
  if (subject) { const v = Number(subject); if (Number.isFinite(v) && v > 0) scenario.subjectM = v; }
  const shutterType = params.get('shutterType');
  if (shutterType === 'mechanical' || shutterType === 'electronic') scenario.shutterType = shutterType;
  for (const key of ['lux', 'cct'] as const) {
    const raw = params.get(key), value = Number(raw);
    if (raw && Number.isFinite(value) && (key === 'lux' ? value >= 0 : value > 0)) scenario[key] = value;
  }
  const sensor = params.get('sensor');
  if (sensor) {
    try { sensorFor(scenario.format ?? 'ff', scenario.iso ?? 100, sensor); scenario.sensor = sensor; }
    catch { /* Unknown sensors in shared links fall back to the selected body. */ }
  }
  const pieceRaw = params.get('piece');
  const piece = pieceRaw && VALID_PIECES.has(pieceRaw as PieceId) ? (pieceRaw as PieceId) : undefined;
  const pin = pinId(params.get('sel'));
  return { scenario, piece, cameraPart: cameraPart(params.get('part') ?? params.get('from')), ...(pin && piece && piece !== 'camera' ? { pin } : {}) };
}

/** A deeper level's pin id as a URL may carry it: short, lower case, letters, digits and hyphens; anything else is
 *  dropped (the level then opens on its overview). */
export function pinId(value: string | null | undefined): string | null {
  return value && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
}

/** The inverse of scenarioFromQuery: a full normalized state -> the query string that reproduces it. */
export function queryFromState(state: AppState): string {
  const p = new URLSearchParams();
  p.set('lens', state.scenario.lens);
  p.set('fno', String(state.scenario.fno));
  p.set('focus', formatFocus(state.scenario.focusM));
  // Presentation labels may round to marked stops; a share link must retain the actual exposure.
  p.set('shutter', String(state.scenario.shutter));
  p.set('iso', String(state.scenario.iso));
  p.set('format', state.scenario.format);
  p.set('scene', state.scenario.scene);
  if (state.scenario.motion) p.set('motion', String(state.scenario.motion.speedMps));
  if (state.scenario.subjectM !== undefined) p.set('subject', String(state.scenario.subjectM));
  p.set('shutterType', state.scenario.shutterType);
  for (const key of ['sensor', 'lux', 'cct'] as const) {
    if (state.scenario[key] !== undefined) p.set(key, String(state.scenario[key]));
  }
  p.set('piece', state.piece);
  // On the camera level the part is the selection (part=). On a deeper level it is only where the visitor came from, the
  // breadcrumb's "Camera · Aperture", and the level itself may show nothing selected: it goes in from=, so the address
  // never says there is a selection the screen does not show (score loop r5). part= is still read on any level.
  if (state.cameraPart) p.set(state.piece === 'camera' ? 'part' : 'from', state.cameraPart);
  if (state.pin && state.piece !== 'camera') p.set('sel', state.pin);
  return `?${p.toString()}`;
}

const inBrowser = typeof window !== 'undefined' && typeof window.history !== 'undefined';

/** Query parameters that are not part of the scenario but describe what is open (the renderer override, the guided
 *  tour and its stop, the Real photos view with its photograph and detail, and the Play the shot dialog); the URL
 *  keeps them when the store rewrites it. */
export const PASSTHROUGH = ['gl', 'tour', 'view', 'photo', 'crop', 'shot'];

/** The page URL for a state: the scenario query, the pass-through parameters of the current URL, and its hash. */
export function urlForState(state: AppState, href: string, keep: readonly string[] = PASSTHROUGH): URL {
  const current = new URL(href);
  const url = new URL(queryFromState(state), href);
  for (const key of keep) { const v = current.searchParams.get(key); if (v !== null) url.searchParams.set(key, v); }
  url.hash = current.hash;
  return url;
}

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  /** 'push' gives a level change its own browser history entry; 'replace' is for restoring one (popstate) and for
   *  moves that belong to another entry (a tour stop). Slider and part changes always replace. */
  private history: 'push' | 'replace' = 'push';
  private urlPiece: PieceId;
  /** The f-number the change being delivered asked for, if it named one (equipment-feedback.ts compares it with
   *  the f-number the lens allowed). */
  private askedFno: number | undefined;
  /** Whether the change being delivered named a focus distance itself. */
  private askedFocus = false;

  constructor(initial?: { scenario?: Partial<Scenario>; piece?: PieceId; cameraPart?: CameraPart | null; pin?: string | null }) {
    const scenario = normalizeScenario(initial?.scenario ?? {});
    const piece = initial?.piece ?? 'camera';
    this.state = { scenario, piece, cameraPart: inspectionParent(piece, initial?.cameraPart ?? null) };
    if (initial?.pin && piece !== 'camera') this.state.pin = initial.pin;
    this.urlPiece = piece;
  }

  /** Runs `fn` with every URL write replacing the current history entry instead of adding one. */
  withoutHistory(fn: () => void): void {
    const previous = this.history;
    this.history = 'replace';
    try { fn(); } finally { this.history = previous; }
  }

  /** Back/Forward: return to the level (piece and part) a history entry describes, without adding an entry. The
   *  shot itself (lens, settings) is one shot across the levels, so it stays as the reader left it: Back does not
   *  undo a slider. The entry's URL is rewritten to match. */
  restore(search: string): void {
    if (!new URLSearchParams(search).has('lens')) return; // not a store-written entry (the opening)
    const parsed = scenarioFromQuery(search);
    const piece = parsed.piece ?? 'camera';
    const cameraPart = inspectionParent(piece, parsed.cameraPart);
    const pin = parsed.pin ?? null;
    this.withoutHistory(() => {
      if (piece === this.state.piece && cameraPart === this.state.cameraPart && pin === (this.state.pin ?? null)) { this.writeUrl(); return; }
      this.state = { ...this.state, piece, cameraPart, pin };
      this.notify();
    });
  }

  get(): AppState {
    return this.state;
  }

  /** While listeners run for a set() that named an f-number, that f-number; undefined otherwise. */
  requestedFno(): number | undefined {
    return this.askedFno;
  }

  /** While listeners run for a set() that named a focus distance, true. */
  focusRequested(): boolean {
    return this.askedFocus;
  }

  /** Merges a partial scenario (and optionally switches the active piece), normalizes, notifies, syncs the URL. */
  set(partial: Partial<Scenario>, piece?: PieceId): void {
    // A subject distance belongs to the layout it was set with (the real-photo panel's "Match these settings"
    // sets it with its lens): a new lens or scene without one of its own goes back to the scene's own layout.
    const merged = { ...this.state.scenario, ...partial };
    if (partial.lens && bodyForLens(partial.lens) !== bodyForLens(this.state.scenario.lens) && !('sensor' in partial)) delete merged.sensor;
    if (((partial.lens !== undefined && partial.lens !== this.state.scenario.lens)
      || (partial.scene !== undefined && partial.scene !== this.state.scenario.scene)) && !('subjectM' in partial)) delete merged.subjectM;
    const normalized = normalizeScenario(merged);
    // Sliders can emit the same clamped value many times at their bounds. Preserve
    // shot identity so those events neither rebuild geometry nor restart the photo.
    const unchanged = JSON.stringify(normalized) === JSON.stringify(this.state.scenario);
    const scenario = unchanged ? this.state.scenario : normalized;
    const nextPiece = piece ?? this.state.piece;
    if (unchanged && nextPiece === this.state.piece) return;
    this.state = { scenario, piece: nextPiece, cameraPart: inspectionParent(nextPiece, this.state.cameraPart), pin: nextPiece === this.state.piece ? this.state.pin : null, requestedFno: merged.fno };
    this.askedFno = partial.fno;
    this.askedFocus = 'focusM' in partial;
    try { this.notify(); } finally { this.askedFno = undefined; this.askedFocus = false; }
  }

  /** Changes level. `pin` opens the new level on that part (Go inside from a camera part, score loop r3). */
  setPiece(piece: PieceId, pin: string | null = null): void {
    if (piece === this.state.piece) return;
    this.state = { ...this.state, piece, cameraPart: inspectionParent(piece, this.state.cameraPart), pin: piece === 'camera' ? null : pin };
    this.notify();
  }

  /** Records the part picked on a deeper level, in the state and the URL (sel=), without a history entry. */
  setPin(pin: string | null): void {
    const next = this.state.piece === 'camera' ? null : pinId(pin);
    if (next === (this.state.pin ?? null)) return;
    this.withoutHistory(() => {
      this.state = { ...this.state, pin: next };
      this.notify();
    });
  }

  /** Select a camera part without changing the shot or re-rendering its sensor image. */
  setCameraPart(part: CameraPart | null): void {
    if (part === this.state.cameraPart) return;
    this.state = { ...this.state, cameraPart: part };
    this.notify();
  }

  /** The overview button leaves a detail; the inspection breadcrumb returns to its parent instead. */
  showCameraOverview(): void {
    if (this.state.piece === 'camera' && this.state.cameraPart === null) return;
    this.state = { ...this.state, piece: 'camera', cameraPart: null, pin: null };
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Writes the state into the address bar: a new history entry for a level change, the current one otherwise. */
  writeUrl(keep?: readonly string[]): void {
    if (!inBrowser) return;
    const url = urlForState(this.state, window.location.href, keep);
    if (this.history === 'push' && this.state.piece !== this.urlPiece) window.history.pushState({ p2p: 'level' }, '', url);
    else window.history.replaceState(window.history.state, '', url);
    this.urlPiece = this.state.piece;
  }

  private notify(): void {
    this.writeUrl();
    for (const fn of this.listeners) fn(this.state);
  }
}

/** The app's one store, seeded from the page's own URL when running in a browser. The URL is rewritten at once to
 *  the state it actually produced, so a link with an unknown lens or an out-of-range f-number is not shared on with
 *  the junk in it; Back and Forward return to the level of the entry they land on. */
export function createStore(): Store {
  const initialSearch = inBrowser ? window.location.search : '';
  const store = new Store(scenarioFromQuery(initialSearch));
  if (inBrowser) {
    store.writeUrl([...PASSTHROUGH, 'lesson', 'v']);
    window.addEventListener('popstate', () => store.restore(window.location.search));
  }
  return store;
}
