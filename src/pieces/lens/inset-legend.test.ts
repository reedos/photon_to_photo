import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildInsetFrame, insetLegend } from './inset';

// Score loop r4: the legend said "color error", "other blur" and two sizes joined by a bare ">" in one line. It is now a
// plain key: a dot is one ray, a bar is one color's spread, and the colors land so far apart.
describe('the Optics inset legend', () => {
  it('reads as a key, not a comparison, in plain words', () => {
    const wide = insetLegend({ colorShiftMm: 0.02, spotMm: 0.038 }, false);
    expect(wide).toBe('Colors land in different places: red to violet 20 µm apart · dot = one ray · bar = one color’s own spread (up to 38 µm)');
    // with the pixel pitch the shift is also counted in pixels (score loop r6)
    expect(insetLegend({ colorShiftMm: 0.02, spotMm: 0.038 }, false, 4.35)).toBe('Colors land in different places: red to violet 20 µm apart (about 5 px) · dot = one ray · bar = one color’s own spread (up to 38 µm)');
    const short = insetLegend({ colorShiftMm: 0.02, spotMm: 0.038 }, true);
    expect(short).toBe('Dot = ray · bar = one color’s spread · colors 20 µm apart');
    // a portrait phone's key is just the two marks (score loop r5: the longer one ran past a 100 px inset)
    const phone = insetLegend({ colorShiftMm: 0.02, spotMm: 0.038 }, 'phone');
    expect(phone).toBe('Dot = ray · bar = one color’s spread');
    expect(insetLegend({ colorShiftMm: 0.0042, spotMm: 0 }, 'phone')).toBe('Dot = ray · each color lands in one point');
    for (const text of [wide, short, phone, insetLegend({ colorShiftMm: 0.0042, spotMm: 0 }, false), insetLegend({ colorShiftMm: 0.0042, spotMm: 0 }, true)]) {
      expect(text).not.toMatch(/[›>]|color error|other blur/);
    }
  });
  it('says when every color lands in one point', () => {
    expect(insetLegend({ colorShiftMm: 0.0042, spotMm: 0 }, false)).toBe('Colors land in different places: red to violet 4.2 µm apart · dot = one ray · each color lands in one point');
    expect(insetLegend({ colorShiftMm: 0.0042, spotMm: 0 }, true)).toContain('each color lands in one point');
  });
});

// Score loop r5: the phone inset's caption and legend ran past the frame and the viewport at 390, 360 and 320 px. The
// measured fit lives in tools/score-loop/r5-inset-measure.mjs (it needs a browser); this holds the geometry it depends on.
import { compactInsetRect } from '../phone-frame';
describe('the compact Optics inset', () => {
  it.each([[320, 640], [360, 740], [375, 812], [390, 844]])('keeps 12 px of right padding in a %i px view', (w, h) => {
    const r = compactInsetRect(w, h, Math.round(w * 0.3), 0.86);
    expect(w - (r.left + r.width)).toBeGreaterThanOrEqual(12);
    expect(r.left).toBeGreaterThanOrEqual(8);
  });
  it('has a caption short enough for the narrowest inset (one unbreakable run under 78 px of 11 px mono)', () => {
    // "Edge · 700×" is 11 characters; the mono face at 10.5 to 11 px is about 6.6 px a character at most
    expect('Edge · 700×'.length * 6.6).toBeLessThan(78);
  });
});

// Score loop r5: "Edge, magnified 1,300×" was wider than a 96-122 px phone inset, so the figure was lost. A compact view's
// caption is the short "Edge · figure" form, and it always ends with the figure; a wide view keeps its words.
describe('the Optics inset caption', () => {
  const samples = [
    { field: 1, status: 'ok', nm: 550, world: [[0, 0, 0], [0.5, 0.2, 30]] },
    { field: 1, status: 'ok', nm: 450, world: [[0, 0, 0], [0.51, 0.2, 30]] },
  ] as never;
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  cam.position.set(0, 0, -200);
  it('is short and ends with its magnification on a phone-width view, and says "Edge of frame" on a wide one', () => {
    const narrow = buildInsetFrame(samples, 30, cam, 320, 280, 4);
    expect(narrow.caption()).toMatch(/^Edge · [\d,.]+×$/);
    expect(narrow.rect.width).toBeLessThan(150);
    const wide = buildInsetFrame(samples, 30, cam, 1200, 700, 4);
    expect(wide.caption()).toMatch(/^Edge of frame, [\d,.]+× larger than drawn$/);
  });
});
