// Scenario state + subscribe, and the URL query <-> scenario translation docs/PROTOTYPE.md's hooks section
// asks for (lens, fno, focus, shutter, iso, format, piece). Pure functions here (scenarioFromQuery /
// queryFromState) are the tested surface; the Store class is a thin pub-sub wrapper plus the URL side effect,
// guarded so it is safe to import from a non-browser environment (vitest's default node test environment).
import type { FormatId, Scenario } from '../engine/types';
import { normalizeScenario } from './engine-api';
import { cameraPart, inspectionParent, type CameraPart } from './inspection';

// 'camera' is docs/PANE.md's one pane (the whole camera and lens); the three first-pass pieces stay as its details
export type PieceId = 'camera' | 'lens' | 'cone' | 'loupe';
export const PIECE_IDS: PieceId[] = ['camera', 'lens', 'cone', 'loupe'];

export interface AppState {
  scenario: Scenario;
  piece: PieceId;
  cameraPart: CameraPart | null;
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
  return t < 1 ? `1/${Math.round(1 / t)}` : `${Number(t.toFixed(3))}`;
}

// ---- focus: meters, or "inf" for infinity (Scenario.focusM = null) -------------------------------------------

function parseFocus(raw: string): number | null | undefined {
  if (!raw) return undefined;
  if (raw === 'inf') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

function formatFocus(m: number | null): string {
  return m === null ? 'inf' : `${Number(m.toFixed(3))}`;
}

const VALID_PIECES = new Set<PieceId>(PIECE_IDS);

/** Reads a query string (with or without its leading "?") into a partial scenario plus the active piece. Every
 *  field is optional; normalizeScenario (engine-api.ts) fills and clamps whatever is missing or out of range. */
export function scenarioFromQuery(search: string): { scenario: Partial<Scenario>; piece?: PieceId; cameraPart: CameraPart | null } {
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
  const pieceRaw = params.get('piece');
  const piece = pieceRaw && VALID_PIECES.has(pieceRaw as PieceId) ? (pieceRaw as PieceId) : undefined;
  return { scenario, piece, cameraPart: cameraPart(params.get('part')) };
}

/** The inverse of scenarioFromQuery: a full normalized state -> the query string that reproduces it. */
export function queryFromState(state: AppState): string {
  const p = new URLSearchParams();
  p.set('lens', state.scenario.lens);
  p.set('fno', String(Number(state.scenario.fno.toFixed(2))));
  p.set('focus', formatFocus(state.scenario.focusM));
  p.set('shutter', formatShutter(state.scenario.shutter));
  p.set('iso', String(Math.round(state.scenario.iso)));
  p.set('format', state.scenario.format);
  p.set('scene', state.scenario.scene);
  if (state.scenario.motion) p.set('motion', String(state.scenario.motion.speedMps));
  if (state.scenario.subjectM !== undefined) p.set('subject', String(Number(state.scenario.subjectM.toFixed(2))));
  p.set('piece', state.piece);
  if (state.cameraPart) p.set('part', state.cameraPart);
  return `?${p.toString()}`;
}

const inBrowser = typeof window !== 'undefined' && typeof window.history !== 'undefined';

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial?: { scenario?: Partial<Scenario>; piece?: PieceId; cameraPart?: CameraPart | null }) {
    const scenario = normalizeScenario(initial?.scenario ?? {});
    const piece = initial?.piece ?? 'camera';
    this.state = { scenario, piece, cameraPart: inspectionParent(piece, initial?.cameraPart ?? null) };
  }

  get(): AppState {
    return this.state;
  }

  /** Merges a partial scenario (and optionally switches the active piece), normalizes, notifies, syncs the URL. */
  set(partial: Partial<Scenario>, piece?: PieceId): void {
    // A subject distance belongs to the layout it was set with (the real-photo panel's "Match these settings"
    // sets it with its lens): a new lens or scene without one of its own goes back to the scene's own layout.
    const merged = { ...this.state.scenario, ...partial };
    if (('lens' in partial || 'scene' in partial) && !('subjectM' in partial)) delete merged.subjectM;
    const scenario = normalizeScenario(merged);
    const nextPiece = piece ?? this.state.piece;
    this.state = { scenario, piece: nextPiece, cameraPart: inspectionParent(nextPiece, this.state.cameraPart) };
    this.notify();
  }

  setPiece(piece: PieceId): void {
    if (piece === this.state.piece) return;
    this.state = { ...this.state, piece, cameraPart: inspectionParent(piece, this.state.cameraPart) };
    this.notify();
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
    this.state = { ...this.state, piece: 'camera', cameraPart: null };
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    if (inBrowser) {
      const url = queryFromState(this.state);
      window.history.replaceState(null, '', url);
    }
    for (const fn of this.listeners) fn(this.state);
  }
}

/** The app's one store, seeded from the page's own URL when running in a browser. */
export function createStore(): Store {
  const initialSearch = inBrowser ? window.location.search : '';
  return new Store(scenarioFromQuery(initialSearch));
}
