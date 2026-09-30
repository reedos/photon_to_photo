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
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; scenario?: Scenario }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'error') { p.reject(new Error(m.error)); return; }
    if (m.type === 'render') {
      if (m.id !== latestRender) { p.resolve(null); return; } // superseded while it rendered
      p.resolve({ renderId: m.id, width: m.width, height: m.height, pixelScale: m.pixelScale, rgba: m.rgba, raw: m.raw,
        stages: m.stages, meta: m.meta, scenario: p.scenario! } satisfies RenderView);
    } else if (m.type === 'pixel') p.resolve(m.pixel);
  };
  worker.onerror = (e) => { for (const [, p] of pending) p.reject(new Error(e.message)); pending.clear(); };
  return worker;
}

/** Renders the final image for a scenario off the main thread. Resolves to null if a newer request superseded it. */
export function requestRender(scenario: Scenario, width: number, height: number, seed = 1): Promise<RenderView | null> {
  const id = nextId++;
  latestRender = id;
  const msg: WorkerRequest = { type: 'render', id, scenario, width, height, seed };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, scenario });
    getWorker().postMessage(msg);
  });
}

// The latest finished render, for anything that shows or measures it (the final-image panel, the loupe, gates).
let current: RenderView | null = null;
const listeners = new Set<(v: RenderView) => void>();
export function currentRender(): RenderView | null { return current; }
export function onRender(cb: (v: RenderView) => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
export function publishRender(v: RenderView): void { current = v; for (const cb of listeners) cb(v); }

/** One real sensor pixel inside rendered pixel (x, y) of a finished render. */
export function pixelAt(renderId: number, x: number, y: number): Promise<PixelInfo> {
  const id = nextId++;
  const msg: WorkerRequest = { type: 'pixel', id, renderId, x, y };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(msg);
  });
}
