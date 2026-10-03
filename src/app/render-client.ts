// Main-thread side of render-worker.ts. requestRender() is latest-wins: a newer request supersedes an older one
// that has not come back yet (its promise resolves to null). pixelAt() asks the worker about one real sensor pixel
// inside a finished render (the loupe).
import type { PixelState } from '../engine/types';
import type { Scenario } from '../engine/types';
import type { WorkerRequest } from './render-worker';

export interface RenderView {
  renderId: number;
  width: number;
  height: number;
  pixelScale: number;
  rgba: Uint8ClampedArray;
  raw: Uint16Array;
  stages: Record<string, Float32Array>;
  meta: { seed: number; ms: number; notes: string[] };
  scenario: Scenario;
}
export type PixelInfo = PixelState & { objectPoint: [number, number, number]; depthMm: number };

let worker: Worker | null = null;
let nextId = 1;
let latestRender = 0;
type RenderMessage = Extract<WorkerRequest, { type: 'render' }>;
let activeRender = 0;
let queuedRender: RenderMessage | null = null;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; scenario?: Scenario }>();

function dispatchRender(message: RenderMessage) {
  const entry = pending.get(message.id);
  if (!entry) return;
  activeRender = message.id;
  if (!send(message.id, message, entry.reject)) { activeRender = 0; drainRender(); }
}
function drainRender() {
  if (activeRender || !queuedRender) return;
  const next = queuedRender; queuedRender = null; dispatchRender(next);
}

function getWorker(): Worker {
  if (worker) return worker;
  const job = new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' });
  worker = job;
  job.onmessage = (ev) => {
    if (worker !== job) return;
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    const finishedRender = m.id === activeRender;
    if (finishedRender) activeRender = 0;
    if (m.type === 'error') { p.reject(new Error(m.error)); }
    else if (m.type === 'render') {
      if (m.id !== latestRender) p.resolve(null); // superseded while it rendered
      else p.resolve({ renderId: m.id, width: m.width, height: m.height, pixelScale: m.pixelScale, rgba: m.rgba, raw: m.raw,
        stages: m.stages, meta: m.meta, scenario: p.scenario! } satisfies RenderView);
    } else if (m.type === 'pixel') p.resolve(m.pixel);
    if (finishedRender) drainRender();
  };
  const fail = (message: string) => {
    if (worker !== job) return;
    job.terminate(); worker = null;
    activeRender = 0; queuedRender = null;
    current = null; // The pixel data lived in this worker; even a completed view can no longer serve the loupe.
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
    for (const cb of failureListeners) cb();
  };
  job.onerror = (e) => { e.preventDefault(); fail(e.message || 'The photo worker stopped.'); };
  job.onmessageerror = () => fail('The photo worker returned unreadable data.');
  return job;
}

function send(id: number, msg: WorkerRequest, reject: (error: Error) => void): boolean {
  try { getWorker().postMessage(msg); return true; }
  catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); return false; }
}

/** Renders the final image for a scenario off the main thread. Resolves to null if a newer request superseded it. */
export function requestRender(scenario: Scenario, width: number, height: number, seed = 1): Promise<RenderView | null> {
  const id = nextId++;
  latestRender = id;
  const msg: WorkerRequest = { type: 'render', id, scenario, width, height, seed };
  return new Promise((resolve, reject) => {
    // A worker cannot interrupt synchronous CPU rendering. Keep only the newest waiting shot,
    // rather than making every slider/body change render before the user's final choice.
    if (queuedRender) { pending.get(queuedRender.id)?.resolve(null); pending.delete(queuedRender.id); }
    pending.set(id, { resolve, reject, scenario });
    if (activeRender) queuedRender = msg;
    else dispatchRender(msg);
  });
}

// The latest finished render, for anything that shows or measures it (the final-image panel, the loupe, gates).
let current: RenderView | null = null;
const listeners = new Set<(v: RenderView) => void>();
const failureListeners = new Set<() => void>();
export function onRenderFailure(cb: () => void): () => void { failureListeners.add(cb); return () => failureListeners.delete(cb); }
export function currentRender(): RenderView | null { return current; }
export function onRender(cb: (v: RenderView) => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
export function publishRender(v: RenderView): void { current = v; for (const cb of listeners) cb(v); }

/** One real sensor pixel inside rendered pixel (x, y) of a finished render. */
export function pixelAt(renderId: number, x: number, y: number): Promise<PixelInfo> {
  const id = nextId++;
  const msg: WorkerRequest = { type: 'pixel', id, renderId, x, y };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send(id, msg, reject);
  });
}
