import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import * as look from '../app/look';
import * as bus from '../app/bus';
import { compute } from '../engine/camera';
import { build } from './loupe';
import type { RenderView, PixelInfo } from '../app/render-client';
import type { PieceHandle } from './types';

const client = vi.hoisted(() => ({ view: null as RenderView | null, renders: new Set<(v: RenderView) => void>(), failures: new Set<() => void>(), pixel: vi.fn() }));
vi.mock('../app/render-client', () => ({ currentRender: () => client.view, pixelAt: client.pixel,
  onRender: (cb: (v: RenderView) => void) => { client.renders.add(cb); return () => client.renders.delete(cb); },
  onRenderFailure: (cb: () => void) => { client.failures.add(cb); return () => client.failures.delete(cb); },
}));
vi.mock('../app/engine-api', () => ({ pointBundle: () => ({ paths: [] }) }));

class Element {
  style = {}; hidden = false; width = 2; height = 2; textContent = ''; children: Element[] = [];
  selectors = new Map<string, Element>();
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  before() {} remove() {} setAttribute() {} addEventListener() {} removeEventListener() {}
  querySelector(selector: string) { if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector)!; }
  getContext() { return { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; }
}
const dslr = () => compute({ lens: 'n50', fno: 4, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff', shutterType: 'mechanical', scene: 'bench' });
const mirrorless = () => compute({ ...dslr().scenario, lens: 'z35', sensor: 'full-frame-z8', shutterType: 'electronic' });
function view(model = dslr(), renderId = 1, width = 12, height = 8): RenderView {
  return { renderId, scenario: model.scenario, width, height, pixelScale: 2, rgba: new Uint8ClampedArray(width * height * 4), raw: new Uint16Array(width * height), stages: {}, meta: { seed: 1, ms: 1, notes: [] } };
}
const pixel: PixelInfo = { x: 20, y: 10, cfa: 'G', photonsMean: 100, electronsMean: 40, electrons: 38, fullWell: 1000, readNoise: 2, dn: 540, saturated: false, objectPoint: [0, 0, 3000], depthMm: 3000 };
function pending() { let resolve!: (p: PixelInfo) => void, reject!: () => void; const promise = new Promise<PixelInfo>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
let handle: PieceHandle, dive: ReturnType<typeof vi.fn>;
const state = () => handle.hooks!.state();
const publish = (v: RenderView) => { client.view = v; for (const cb of client.renders) cb(v); };
beforeEach(() => {
  vi.useFakeTimers(); client.view = null; client.pixel.mockReset(); client.pixel.mockResolvedValue(pixel);
  vi.stubGlobal('document', { createElement: () => new Element(), getElementById: () => new Element(), querySelector: () => null, addEventListener() {}, removeEventListener() {}, hidden: false });
  vi.stubGlobal('window', { innerWidth: 1366, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) });
  dive = vi.fn();
  handle = build({ renderer: { domElement: { clientWidth: 1000, clientHeight: 640 } }, look, camera: new THREE.PerspectiveCamera(45, 1.5), scene: new THREE.Scene(), overlay: new Element(), labels: { clear() {} }, badge: { show() {}, hide() {} }, dive, bus } as any);
  handle.group.visible = true; handle.activate!();
});
afterEach(() => { handle.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('pixel inspection lifecycle', () => {
  it('waits for a matching mirrorless render and resolved pixel before diving', async () => {
    const next = mirrorless(); client.view = view(); const request = pending(); client.pixel.mockReturnValue(request.promise);
    handle.update(next, next.scenario); await vi.advanceTimersByTimeAsync(1000);
    expect(client.pixel).not.toHaveBeenCalled(); expect(dive).not.toHaveBeenCalled();
    publish(view(next, 2)); await vi.advanceTimersByTimeAsync(1000);
    expect(state().pendingPixel).toBe(true); expect(dive).not.toHaveBeenCalled();
    request.resolve(pixel); await vi.advanceTimersByTimeAsync(500);
    expect(state().hasPixel).toBe(true); expect(state().diveStage).toBe('well'); expect(dive).toHaveBeenCalledTimes(1);
  });
  it('rebinds a stale saved tap to the current render and clamps resized coordinates', async () => {
    bus.emit('loupe-tap', { x: 400, y: 300, renderId: 7 });
    const model = dslr(); client.view = view(model, 9, 12, 8); handle.update(model, model.scenario);
    expect(client.pixel).toHaveBeenLastCalledWith(9, 11, 7);
    await vi.advanceTimersByTimeAsync(500); publish(view(model, 10, 6, 4));
    expect(client.pixel).toHaveBeenLastCalledWith(10, 5, 3);
  });
  it('ignores old pixel responses after a camera change and after deactivation', async () => {
    const old = pending(), next = pending(); client.pixel.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const a = dslr(), b = mirrorless(); client.view = view(a); handle.update(a, a.scenario);
    handle.update(b, b.scenario); old.resolve(pixel); await vi.advanceTimersByTimeAsync(600);
    expect(state().hasPixel).toBe(false); expect(dive).not.toHaveBeenCalled();
    publish(view(b, 2)); handle.group.visible = false; handle.deactivate!(); next.resolve(pixel); await vi.advanceTimersByTimeAsync(600);
    expect(state().hasPixel).toBe(false); expect(dive).not.toHaveBeenCalled();
    handle.group.visible = true; handle.activate!(); client.pixel.mockResolvedValue(pixel); handle.update(b, b.scenario); await vi.advanceTimersByTimeAsync(600);
    expect(state().hasPixel).toBe(true); expect(state().diveStage).toBe('well');
  });
  it('Back and a manual orbit cancel the deferred dive even if pixel data arrives later', async () => {
    const model = dslr(), request = pending(); client.view = view(model); client.pixel.mockReturnValue(request.promise); handle.update(model, model.scenario);
    handle.hooks!.back(); dive.mockClear(); request.resolve(pixel); await vi.advanceTimersByTimeAsync(600);
    expect(state().diveStage).toBe('photo'); expect(dive).not.toHaveBeenCalled();
    handle.hooks!.tap(3, 2); await Promise.resolve(); handle.onViewInteraction!(); await vi.advanceTimersByTimeAsync(600);
    expect(dive).not.toHaveBeenCalled();
  });
  it('surfaces a pixel failure and recovers on a new render without stale readouts', async () => {
    const model = dslr(); client.view = view(model); client.pixel.mockRejectedValueOnce(new Error('expired render')); handle.update(model, model.scenario);
    await vi.advanceTimersByTimeAsync(600); expect(state().pixelError).toContain('could not load'); expect(state().hasPixel).toBe(false);
    publish(view(model, 2)); await vi.advanceTimersByTimeAsync(600); expect(state().pixelError).toBe(''); expect(state().hasPixel).toBe(true);
    client.view = null; for (const cb of client.failures) cb(); expect(state().hasPixel).toBe(false); expect(state().pixelError).toContain('worker stopped');
  });
  it('a numbered part reopens the well after Back, including reduced-motion mode', async () => {
    (window.matchMedia as any) = () => ({ matches: true });
    const model = dslr(); client.view = view(model); handle.update(model, model.scenario);
    await vi.advanceTimersByTimeAsync(1); expect(state().diveStage).toBe('well');
    handle.hooks!.back(); expect(state().diveStage).toBe('photo');
    handle.select!('well'); await vi.advanceTimersByTimeAsync(1);
    expect(state().diveStage).toBe('well');
  });
});
