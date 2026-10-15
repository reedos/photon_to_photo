import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { compactInsetRect, frameBoxAvoiding, frameBoxInRegion } from './phone-frame';

// Projects points through a 40 degree camera placed at the returned frame, in CSS px of a viewW x viewH view.
function project(points: THREE.Vector3[], frame: { position: THREE.Vector3; target: THREE.Vector3 }, viewW: number, viewH: number) {
  const cam = new THREE.PerspectiveCamera(40, viewW / viewH, 0.01, 100000);
  cam.position.copy(frame.position);
  cam.lookAt(frame.target);
  cam.updateMatrixWorld(true);
  return points.map((p) => {
    const v = p.clone().project(cam);
    return { x: ((v.x + 1) / 2) * viewW, y: ((1 - v.y) / 2) * viewH };
  });
}

describe('frameBoxInRegion', () => {
  // a cylinder like the lens cutaway: two end rings of radius 36 mm, 100 mm apart
  const pts: THREE.Vector3[] = [];
  for (const z of [-22, 79]) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 36, Math.sin(a) * 36, z)); }
  const dir = new THREE.Vector3(-0.9, 0.25, -0.35).normalize();

  for (const [viewW, viewH, region] of [
    [557, 234, { l: 6, t: 6, r: 400, b: 222 }],
    [390, 316, { l: 6, t: 6, r: 226, b: 304 }],
    [1100, 697, { l: 16, t: 72, r: 840, b: 520 }],
  ] as const) {
    it(`keeps every point inside the region and fills its limiting side (${viewW}x${viewH})`, () => {
      const f = frameBoxInRegion(pts, dir, viewW, viewH, region, 0.9);
      const s = project(pts, f, viewW, viewH);
      const x0 = Math.min(...s.map((p) => p.x)), x1 = Math.max(...s.map((p) => p.x));
      const y0 = Math.min(...s.map((p) => p.y)), y1 = Math.max(...s.map((p) => p.y));
      expect(x0).toBeGreaterThanOrEqual(region.l - 1);
      expect(x1).toBeLessThanOrEqual(region.r + 1);
      expect(y0).toBeGreaterThanOrEqual(region.t - 1);
      expect(y1).toBeLessThanOrEqual(region.b + 1);
      const fillW = (x1 - x0) / (region.r - region.l), fillH = (y1 - y0) / (region.b - region.t);
      expect(Math.max(fillW, fillH)).toBeGreaterThan(0.85);
    });
  }
});

describe('frameBoxAvoiding', () => {
  // the portrait phone's Optics view: a 390x297 canvas, the inset's rectangle and its legend in the top-right corner
  const pts: THREE.Vector3[] = [];
  for (const z of [-22, 79]) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 36, Math.sin(a) * 36, z)); }
  const dir = new THREE.Vector3(-0.9, 0.25, -0.35).normalize();
  const viewW = 390, viewH = 297;
  const avoid = [{ l: 263, t: 10, r: 380, b: 190 }];
  const area = { l: 8, t: 30, r: viewW - 8, b: viewH - 26 };
  const first = { l: 6, t: 6, r: 255, b: 285 };

  it('grows beyond the first fit without any point reaching the inset or leaving the area', () => {
    const f0 = frameBoxInRegion(pts, dir, viewW, viewH, first, 0.95);
    const f = frameBoxAvoiding(pts, dir, viewW, viewH, first, area, avoid, 0.95);
    const width = (fr: typeof f0) => { const s = project(pts, fr, viewW, viewH); return Math.max(...s.map((p) => p.x)) - Math.min(...s.map((p) => p.x)); };
    expect(width(f)).toBeGreaterThanOrEqual(width(f0) - 0.5);
    for (const p of project(pts, f, viewW, viewH)) {
      expect(p.x).toBeGreaterThanOrEqual(area.l - 1);
      expect(p.x).toBeLessThanOrEqual(area.r + 1);
      expect(p.y).toBeGreaterThanOrEqual(area.t - 1);
      expect(p.y).toBeLessThanOrEqual(area.b + 1);
      expect(p.x > avoid[0].l && p.x < avoid[0].r && p.y > avoid[0].t && p.y < avoid[0].b).toBe(false);
    }
  });

  it('returns the first fit when nothing is to be avoided', () => {
    const f0 = frameBoxInRegion(pts, dir, viewW, viewH, first, 0.95);
    const f = frameBoxAvoiding(pts, dir, viewW, viewH, first, area, [], 0.95);
    expect(f.position.distanceTo(f0.position)).toBeLessThan(1e-9);
  });
});

describe('frameBoxAvoiding when the first fit lies under what it must avoid', () => {
  const pts: THREE.Vector3[] = [];
  for (const z of [-22, 79]) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 36, Math.sin(a) * 36, z)); }
  const dir = new THREE.Vector3(-0.9, 0.25, -0.35).normalize();
  // a phone on its side (348x220): the inset's note runs along the top right, the inset under it, the sliders along the foot
  const viewW = 348, viewH = 220;
  const avoid = [{ l: 190, t: 0, r: 336, b: 53 }, { l: 240, t: 53, r: 336, b: 149 }];
  const area = { l: 8, t: 30, r: viewW - 8, b: 140 };
  it('uses a smaller fit that clears the note and the inset (score loop r6: the fit lay under the note and a pin had no place)', () => {
    const first = { l: 0, t: 0, r: 234, b: 150 };
    const f = frameBoxAvoiding(pts, dir, viewW, viewH, first, area, avoid, 0.88, 24);
    for (const p of project(pts, f, viewW, viewH)) {
      expect(p.x).toBeGreaterThanOrEqual(area.l - 1);
      expect(p.y).toBeGreaterThanOrEqual(area.t - 1);
      expect(p.y).toBeLessThanOrEqual(area.b + 1);
      expect(avoid.some((a) => p.x > a.l - 24 && p.x < a.r + 24 && p.y > a.t - 24 && p.y < a.b + 24)).toBe(false);
    }
  });
});

// Score loop r6: the Focus inset's note (two lines, 36 px) sits above the inset, and the inset stops above the traced-point card, so the note
// never lands on the sliders' words (it was under the inset and ran onto "Center" at 320x568, 360x780 and 360x640).
describe('compactInsetRect with a note reserve and a control card under it', () => {
  it('keeps the default 30 px above the inset', () => {
    const r = compactInsetRect(360, 252, 115, 1);
    expect(252 - r.bottom - r.height).toBe(30);
  });
  it.each([[320, 240], [360, 252], [390, 316], [375, 240]])('puts the inset below its note and above the card in a %i x %i view', (w, h) => {
    const ctl = 94, note = 36;
    const r = compactInsetRect(w, h, Math.round(w * 0.32), 1, note, ctl);
    const top = h - r.bottom - r.height;
    expect(top).toBeGreaterThanOrEqual(note);
    // the card takes its own height (ctl) at the foot; the inset ends above it unless the 96 px floor wins on a very short view
    if (r.width > 96) expect(top + r.height).toBeLessThanOrEqual(h - ctl);
  });
  it('shrinks the inset, down to its 96 px floor, rather than run into the card', () => {
    const tall = compactInsetRect(390, 316, 125, 1, 36, 0), short = compactInsetRect(390, 316, 125, 1, 36, 200);
    expect(short.width).toBeLessThan(tall.width);
    expect(short.width).toBeGreaterThanOrEqual(96);
  });
});
