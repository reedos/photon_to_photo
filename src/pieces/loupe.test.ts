import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import * as look from '../app/look';
import * as bus from '../app/bus';
import { compute } from '../engine/camera';
import { build } from './loupe';
import type { PieceHandle } from './types';

class Element {
  style = {}; hidden = false; width = 2; height = 2; textContent = ''; children: Element[] = [];
  selectors = new Map<string, Element>();
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  before() {} remove() {} setAttribute() {} addEventListener() {} removeEventListener() {}
  querySelector(selector: string) { if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector)!; }
}
const dslr = () => compute({ lens: 'n50', fno: 4, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff', scene: 'bench', shutterType: 'mechanical' });
const mirrorless = () => compute({ ...dslr().scenario, lens: 'z35', sensor: 'full-frame-z8', shutterType: 'electronic' });
let handle: PieceHandle, dive: ReturnType<typeof vi.fn>;
const state = () => handle.hooks!.state();
const tick = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(500); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new Element(), getElementById: () => new Element(), querySelector: () => null, addEventListener() {}, removeEventListener() {}, hidden: false });
  vi.stubGlobal('window', { innerWidth: 1366, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) });
  dive = vi.fn();
  handle = build({ renderer: { domElement: { clientWidth: 1000, clientHeight: 640, inert: false } }, look, camera: new THREE.PerspectiveCamera(45, 1.5), scene: new THREE.Scene(), overlay: new Element(), labels: { clear() {} }, badge: { show() {}, hide() {} }, dive, bus } as any);
  handle.group.visible = true; handle.activate!();
});
afterEach(() => { handle.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('independent pixel sample lifecycle', () => {
  it('samples immediately from the live camera model without a rendered view', async () => {
    const model = mirrorless();
    handle.update(model, model.scenario);
    await tick();
    const pixel = handle.hooks!.probe().pixel;
    expect(pixel).not.toBeNull();
    expect(pixel.x).toBe(Math.floor(model.sensor.widthPx / 2));
    expect(pixel.y).toBe(Math.floor(model.sensor.heightPx / 2));
    expect(pixel.photonsMean).toBeCloseTo(model.exposure.photonsMidGray, 8);
    expect(state().hasPixel).toBe(true);
    expect(state().hasPixel).toBe(true);
    expect(dive).not.toHaveBeenCalled();
  });

  it('replaces the sample when aperture, shutter, ISO, or sensor settings change', async () => {
    const first = dslr(); handle.update(first, first.scenario); await tick();
    const initial = handle.hooks!.probe().pixel;
    const next = compute({ ...first.scenario, shutter: first.scenario.shutter * 2, iso: 400, fno: 5.6 });
    handle.update(next, next.scenario); await tick();
    const updated = handle.hooks!.probe().pixel;
    expect(updated.photonsMean).toBeCloseTo(next.exposure.photonsMidGray, 8);
    expect(updated.photonsMean).toBeGreaterThan(initial.photonsMean);
    expect(updated.readNoise).not.toBe(initial.readNoise);
    expect(updated.fullWell).toBeGreaterThan(0);
  });

  it('keeps the pixel structure framed during setting changes and view interaction', async () => {
    const model = dslr(); handle.update(model, model.scenario); await tick();
    expect(state().hasPixel).toBe(true);
    handle.hooks!.back(); dive.mockClear();
    expect(state().hasPixel).toBe(true);
    handle.onViewInteraction!();
    expect(dive).not.toHaveBeenCalled();
    handle.select!('well');
    expect(state().hasPixel).toBe(true);
    expect(dive).not.toHaveBeenCalled();
  });

  it('discards a pending sample on body changes and when leaving the pixel view', async () => {
    const first = dslr(), next = mirrorless();
    handle.update(first, first.scenario);
    handle.update(next, next.scenario);
    await tick();
    expect(handle.hooks!.probe().pixel.fullWell).toBe(next.sensor.fullWellE);
    expect(handle.hooks!.probe().pixel.x).toBe(Math.floor(next.sensor.widthPx / 2));
    handle.update(first, first.scenario);
    handle.deactivate!(); handle.group.visible = false;
    await tick();
    expect(state().hasPixel).toBe(false);
    expect(state().pendingPixel).toBe(false);
    handle.group.visible = true; handle.activate!();
    await tick();
    expect(state().hasPixel).toBe(true);
    expect(handle.hooks!.probe().pixel.fullWell).toBe(first.sensor.fullWellE);
    expect(dive).not.toHaveBeenCalled();
  });

  it('returns the same controlled stochastic draw from the determinism probe', async () => {
    const model = dslr(); handle.update(model, model.scenario); await tick();
    const { a, b } = await handle.hooks!.sampleTwice();
    expect(a).toEqual(b);
  });
});
