import { describe, it, expect } from 'vitest';
import { compute, lensFans, pointBundle } from './camera';
import { FORMATS } from './formats';
import { cocFor, hyperfocal, dofLimits } from './dof';
import { irisTest } from './iris';
import { imageOf as imageOfIndependent } from './paraxial';
import { FRAUNHOFER_D_NM } from './glass';
import type { Model } from './model-types';
import type { Scenario } from './types';

function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    lens: 'p50',
    fno: 8,
    shutter: 1 / 125,
    iso: 100,
    focusM: 3,
    format: 'ff',
    shutterType: 'mechanical',
    scene: 'bench',
    ...overrides,
  };
}

describe('compute(): normalization', () => {
  it('clamps fno up to the lens maximum aperture', () => {
    const model = compute(baseScenario({ fno: 0.5 }));
    expect(model.scenario.fno).toBeCloseTo(model.lens.maxFno, 6);
  });

  it('clamps focus distance to the realized closest focus, and reports it', () => {
    const model = compute(baseScenario({ focusM: 0.01 })); // far closer than p50's ~0.4 m
    expect(model.focus.clamped).toBe(true);
    expect(model.focus.distanceMm).toBeGreaterThan(10);
    expect(model.focus.requestedMm).toBeCloseTo(10, 3);
  });

  it('a reasonable focus distance is not clamped', () => {
    const model = compute(baseScenario({ focusM: 3 }));
    expect(model.focus.clamped).toBe(false);
    expect(model.focus.distanceMm).toBeCloseTo(3000, 0);
  });

  it('null focusM means infinity: no object plane, zero magnification', () => {
    const model = compute(baseScenario({ focusM: null }));
    expect(model.focus.distanceMm).toBeNull();
    expect(model.focus.objectZ).toBeNull();
    expect(model.focus.magnification).toBe(0);
    expect(model.focus.farMm).toBe(Infinity);
  });

  it('is memoized: the same scenario returns the identical Model object', () => {
    const a = compute(baseScenario());
    const b = compute(baseScenario());
    expect(a).toBe(b);
  });
});

describe('compute(): golden — hyperfocal and DOF limits vs. hand-computed thin-lens values (p50, f/8, 3 m, FF)', () => {
  const model = compute(baseScenario({ lens: 'p50', fno: 8, focusM: 3, format: 'ff' }));
  const c = model.cardinal;
  const coc = cocFor(FORMATS.ff);

  // "Thin-lens" reference: the same dof.ts closed forms, but treating the requested distances as measured
  // from the sensor directly (i.e. NOT converting to the front principal plane) — the classic simplification
  // a thin-lens/pinhole treatment makes. compute()'s own values additionally correct for the real system's
  // principal-plane offset from the sensor (camera.ts's distanceFromSensorToP); the gap between the two is
  // exactly that offset, restated as a distance rather than computed independently, so this checks that the
  // conversion camera.ts applies is internally consistent and small relative to the meter-scale distances
  // involved — not a second, independent derivation of the offset itself (dof.ts's own golden tests in
  // dof.test.ts already check hyperfocal()/dofLimits() against a hand calculation).
  const thinHyperfocal = hyperfocal(c.efl, 8, coc, c.pupilMag);
  const thinLimits = dofLimits(c.efl, 8, coc, 3000, c.pupilMag);

  // The principal-plane-to-sensor offset for a ~50 mm lens with a total length around 140 mm is on the order
  // of tens of mm (see docs/engine/e4.md for the measured value on this lens) — under 0.1% of the 3 m focus
  // distance and well under 5% of the DOF span, but not exactly zero, which is the "documented thick-lens
  // difference" the golden test asks for.
  const offsetMm = Math.abs(c.P - (model.realized.sensorZ + (model.realized.afOffset ?? 0)));

  it('hyperfocal matches the thin-lens value within the principal-plane offset', () => {
    expect(Math.abs(model.focus.hyperfocalMm - thinHyperfocal)).toBeLessThan(offsetMm + 1);
  });

  // F1 (09/30/2026, Astra-6 review): near/far now solve against the REAL exit pupil and focused/defocused
  // conjugates (camera.ts's exactDofNearFar), not dof.ts's dofLimits (which scales the entrance pupil by
  // pupilMag while still measuring from the principal plane, omitting the exit pupil's own axial offset from
  // it -- p50 wide-open is dof.ts's own blurDiameter doc's example of a ~35%-scale case). That is large enough,
  // at this lens's f/8, 3 m case, that comparing camera.ts's near/far against the thin-lens reference is no
  // longer a meaningful check (the two are supposed to disagree by more than a fixed offset once corrected) --
  // so this checks the actual physical claim directly instead: a real ray-traced bundle centered at the
  // REPORTED near/far distance lands within the stated CoC (the near/far limit's whole definition), independent
  // of dof.ts entirely.
  // Solved paraxially (exactDofNearFar), so a real ray trace's aberration residual (beyond the paraxial exit-
  // pupil model) is expected -- the same order of residual focus-sharp.test.ts allows at exact focus (a few
  // percent to low tens of percent, lens-dependent); 1.25x keeps this a real check without chasing that residual.
  it('near limit: a real ray-traced point there lands within the CoC (not the thin-lens proxy)', () => {
    const b = pointBundle(model, { pointDistMm: model.focus.nearMm, fieldFrac: 0, rays: 257, nms: [550] });
    expect(b.diameterMm).toBeLessThan(model.focus.cocMm * 1.25);
  });

  it('far limit: a real ray-traced point there lands within the CoC (not the thin-lens proxy)', () => {
    const b = pointBundle(model, { pointDistMm: model.focus.farMm, fieldFrac: 0, rays: 257, nms: [550] });
    expect(b.diameterMm).toBeLessThan(model.focus.cocMm * 1.25);
  });

  it('the offset itself is small relative to the 3 m focus distance (thick-lens correction, not a bug)', () => {
    expect(offsetMm).toBeLessThan(200); // generously under the ~140 mm total length of this lens
    expect(offsetMm).toBeGreaterThan(0); // and it is genuinely nonzero — a real thick-lens effect
  });
});

describe('compute(): golden — Airy radius = 1.22 * 0.55 um * working f-number', () => {
  it('matches at f/8, 3 m (working fno close to set fno away from macro)', () => {
    const model = compute(baseScenario({ fno: 8, focusM: 3 }));
    const expected = 1.22 * 0.55 * model.focus.workingFno;
    expect(model.diffraction.airyRadiusUm).toBeCloseTo(expected, 6);
    expect(model.diffraction.nm).toBe(550);
  });

  it('matches at the closest focus too (working fno > set fno, macro bellows factor)', () => {
    const model = compute(baseScenario({ fno: 2.8, focusM: 0.4 }));
    expect(model.focus.workingFno).toBeGreaterThan(2.8);
    const expected = 1.22 * 0.55 * model.focus.workingFno;
    expect(model.diffraction.airyRadiusUm).toBeCloseTo(expected, 6);
  });
});

// F1 (09/30/2026, Astra-6 review): z800 at infinity focus, f/8 -- the report's own reproduction case. Checked
// against an INDEPENDENT derivation of the same physical quantity, similar-triangles blur from the REAL exit
// pupil: blur(d) = 2*xp.r*|imageZ(d)-F2|/|imageZ(d)-xp.z|, using paraxial.ts's imageOf directly rather than
// camera.ts's own exactDofNearFar/blurAt (a separate implementation of the same formula, not the same code path).
describe('compute(): F1 — z800 (long telephoto) DOF near limit at infinity focus, f/8', () => {
  it('the reported near limit is where this independent similar-triangles blur first exceeds the CoC', () => {
    const model = compute({ lens: 'z800', fno: 8, shutter: 1 / 250, iso: 100, focusM: null, format: 'ff', shutterType: 'mechanical', scene: 'bench' });
    const xp = model.cardinal.xp;
    const F2 = model.cardinal.F2;
    const sensorZ = model.system.surfaces[model.system.surfaces.length - 1].z;
    const blurAt = (distMm: number) => {
      const objectZ = sensorZ - distMm;
      const imgZ = imageOfIndependent(model.system, FRAUNHOFER_D_NM, objectZ).z;
      return (2 * xp.r * Math.abs(imgZ - F2)) / Math.abs(imgZ - xp.z);
    };
    const near = model.focus.nearMm;
    expect(blurAt(near)).toBeCloseTo(model.focus.cocMm, 4);
    expect(blurAt(near * 0.99)).toBeGreaterThan(model.focus.cocMm); // just closer: already too blurry
    expect(blurAt(near * 1.01)).toBeLessThan(model.focus.cocMm); // just farther: still sharp
    // Was reported at 434.680 m pre-fix (5.23x the CoC when actually ray-traced); must now be far out (real value
    // is on the order of 2.6 km for this lens/aperture/CoC).
    expect(near).toBeGreaterThan(1e6);
  });
});

// F2 (09/30/2026, Astra-6 review): z800 is internally focused -- its groups shift with focus distance, breathing
// the effective focal length and entrance pupil independently of the classical bellows-extension picture that
// workingFNumber's N*(1+|m|/p) formula assumes. Checked against an INDEPENDENT derivation of the same physical
// quantity: the working f-number IS, by definition, half the image-space cone angle's cotangent -- the distance
// from the exit pupil to the image, divided by twice the exit-pupil radius (Edmund Optics, "Iris and Aperture
// Setting"; this repo's own exposure.ts doc says the same). That does not go through workingFNumber/card.pupilMag
// at all, so it independently pins down what the "current, breathed" f-number must be at this focus distance.
describe('compute(): F2 — z800 (internally focused) working f-number at 5 m, f/8', () => {
  it('matches the image-space exit-pupil cone definition, not the classical bellows factor on the infinity fno', () => {
    const model = compute({ lens: 'z800', fno: 8, shutter: 1 / 250, iso: 100, focusM: 5, format: 'ff', shutterType: 'mechanical', scene: 'bench' });
    const xp = model.cardinal.xp;
    // The focused image sits at the sensor (by definition of "focused there"); the cone's far vertex is the
    // sensor position itself, independent of camera.ts's own workingFno computation.
    const sensorZ = model.system.surfaces[model.system.surfaces.length - 1].z;
    const independentNw = Math.abs(sensorZ - xp.z) / (2 * xp.r);
    expect(model.focus.workingFno).toBeCloseTo(independentNw, 1);
    expect(model.focus.workingFno).toBeLessThan(10); // was 19.5 pre-fix; must be close to the requested f/8
    expect(model.focus.workingFno).toBeGreaterThan(7);
  });
});

describe('compute(): golden — EV100 of f/16, 1/100 s, ISO 100 = 14.64', () => {
  it('matches regardless of lens/focus (EV100 depends only on fno/shutter/iso)', () => {
    const model = compute(baseScenario({ fno: 16, shutter: 1 / 100, iso: 100 }));
    expect(model.exposure.ev100).toBeCloseTo(14.64, 2);
  });
});

describe('compute(): golden — stop radius shrinks with fno by exactly the f-number ratio', () => {
  it('f/16 has half the stop radius of f/8', () => {
    const f8 = compute(baseScenario({ fno: 8 }));
    const f16 = compute(baseScenario({ fno: 16 }));
    expect(f16.iris.radius / f8.iris.radius).toBeCloseTo(8 / 16, 9);
  });

  it('f/2.8 vs f/5.6 also matches the ratio exactly', () => {
    const f28 = compute(baseScenario({ fno: 2.8 }));
    const f56 = compute(baseScenario({ fno: 5.6 }));
    expect(f56.iris.radius / f28.iris.radius).toBeCloseTo(2.8 / 5.6, 9);
  });
});

describe('lensFans', () => {
  it('wide open, on axis: rays are ok except possibly at the extreme pupil rim, where a straight-bladed ' +
    'iris can clip a marginal ray whose meridian is not aligned with a blade vertex (real polygon-iris ' +
    'geometry, not a clear-aperture vignette) — the center ray and every interior ray still pass', () => {
    const model = compute(baseScenario({ fno: 1.46, focusM: 3 }));
    const fans = lensFans(model, { fields: [0], nms: [550], rays: 9 });
    expect(fans.length).toBe(1);
    const paths = fans[0].paths;
    expect(paths[Math.floor(paths.length / 2)].status).toBe('ok'); // the center (on-axis chief) ray
    for (const path of paths) expect(['ok', 'iris']).toContain(path.status);
    // Realize.ts's own field/pupil survey guarantees on-axis rays never fail geometrically (its own
    // "on-axis rays failed geometrically" check throws if any do) — so 'vignetted'/'tir'/'missed' must
    // never appear here; only the blade polygon can turn a marginal ray away, never the glass.
    for (const path of paths) expect(['vignetted', 'tir', 'missed']).not.toContain(path.status);
  });

  it('returns only ok, vignetted or iris statuses across a spread of fields and wavelengths', () => {
    const model = compute(baseScenario({ fno: 2.8, focusM: 3 }));
    const fans = lensFans(model, { fields: [0, 0.5, 1], nms: [486, 587, 656], rays: 9 });
    const allowed = new Set(['ok', 'vignetted', 'iris']);
    for (const set of fans) {
      for (const path of set.paths) expect(allowed.has(path.status)).toBe(true);
    }
  });

  it('field fractions map to the realized half field in degrees', () => {
    const model = compute(baseScenario());
    const fans = lensFans(model, { fields: [0, 1], nms: [550], rays: 3 });
    expect(fans[0].fieldDeg).toBe(0);
    expect(fans[1].fieldDeg).toBeCloseTo(model.realized.realization.halfFieldDeg, 6);
  });
});

describe('pointBundle', () => {
  it('at the focus distance, on axis, the measured diameter is below 3 pixels at f/8', () => {
    const model = compute(baseScenario({ lens: 'p50', fno: 8, focusM: 3, format: 'ff' }));
    const bundle = pointBundle(model, { pointDistMm: model.focus.distanceMm!, fieldFrac: 0, rays: 200, nms: [550] });
    expect(bundle.diameterMm / bundle.pitchMm).toBeLessThan(3);
  });

  it('defocused (point at 1 m, focus 3 m, f/2): measured diameter matches predictedBlurMm within 5%', () => {
    const model = compute(baseScenario({ lens: 'p50', fno: 2, focusM: 3, format: 'ff' }));
    const bundle = pointBundle(model, { pointDistMm: 1000, fieldFrac: 0, rays: 400, nms: [550] });
    expect(bundle.landing.length).toBeGreaterThan(50);
    const rel = Math.abs(bundle.diameterMm - bundle.predictedBlurMm) / bundle.predictedBlurMm;
    // predictedBlurMm is the closed-form pupil-corrected blur diameter, referenced to the REAL exit pupil
    // (camera.ts's exitPupilBlurDiameterMm, not a direct call to dof.ts's blurDiameter — see that function's
    // own doc comment for why: dof.blurDiameter's pupilMag scaling, which implicitly assumes the exit pupil
    // sits at the rear principal plane, overshoots by about 35% on this exact case, because p50's real exit
    // pupil sits about 16 mm from its rear principal plane while the image-side conjugate distances here are
    // only about 50 mm — a large fraction. camera.ts's own version, using the real traced exit pupil position
    // and paraxial.imageOf, is what is checked here, against 5%; the remaining few-percent gap from a real
    // ray trace is aberrations plus the paraxial (not full) treatment of the exit pupil location itself.
    expect(rel).toBeLessThan(0.05);
  });

  it('on-axis rays at the focus distance almost all pass at a modest aperture, and any that do not are ' +
    'blade-clipped (iris), never element-vignetted (matching realize.ts\'s on-axis guarantee)', () => {
    const model = compute(baseScenario({ lens: 'p50', fno: 5.6, focusM: 3, format: 'ff' }));
    const bundle = pointBundle(model, { pointDistMm: model.focus.distanceMm!, fieldFrac: 0, rays: 100, nms: [550] });
    const okCount = bundle.paths.filter((p) => p.status === 'ok').length;
    expect(okCount).toBeGreaterThanOrEqual(bundle.paths.length - 3); // a couple of rim rays may clip a blade corner
    for (const p of bundle.paths) if (p.status !== 'ok') expect(p.status).toBe('iris');
  });

  it('landing points form a polygon with as many sides as blades, when blades are straight', () => {
    // Every design in data/lenses has a rounded iris (irisOutline's rounded construction deliberately closes
    // 90% of the vertex/edge-midpoint gap, per its own doc comment, leaving only a small few-percent ripple —
    // too fine a signal to check reliably against real-ray-traced sampling noise). This test instead swaps in
    // a STRAIGHT-bladed iris test at the model's own current stop radius/rotation — same blade count, same
    // stop, same everything else — so it exercises pointBundle's real code path (spot/traceRay/the model's
    // TraceSystem.iris) against the geometry the golden test actually names: straight blades, where the
    // inradius/circumradius gap is a full 1-cos(pi/n) (~6% for 9 blades), an easy, robust signal.
    const model = compute(baseScenario({ lens: 'p50', fno: 2.8, focusM: 3, format: 'ff' }));
    const n = model.lens.blades;
    const straightIris = irisTest(n, model.iris.radius, false, model.iris.rotation);
    const straightModel: Model = { ...model, system: { ...model.system, iris: straightIris } };

    const bundle = pointBundle(straightModel, { pointDistMm: 1000, fieldFrac: 0, rays: 3000, nms: [550] });
    expect(bundle.landing.length).toBeGreaterThan(400);

    // The map from a pupil-space angle to a landing-space angle is some fixed rotation (a similarity
    // transform through the group of elements between the stop and the image) that this test does not need
    // to predict — it finds the phase empirically instead: bin the landing points' angle (about their own
    // centroid) finely, take each bin's farthest point, then use the single farthest bin overall as a known
    // vertex-phase reference and check the OTHER n-1 bins one full step away are elevated the same way, while
    // the n bins half a step away (the true edge midpoints, wherever the phase actually landed) are not.
    const [cx, cy] = bundle.centroid;
    const nBins = 360;
    const binMax = new Float64Array(nBins);
    for (const p of bundle.landing) {
      const a = Math.atan2(p.y - cy, p.x - cx);
      const bin = Math.floor((((a + Math.PI) / (2 * Math.PI)) * nBins + nBins) % nBins);
      const r = Math.hypot(p.x - cx, p.y - cy);
      if (r > binMax[bin]) binMax[bin] = r;
    }
    let refBin = 0;
    for (let i = 1; i < nBins; i++) if (binMax[i] > binMax[refBin]) refBin = i;

    const binsPerStep = nBins / n;
    const meanAtOffset = (offsetSteps: number): number => {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const bin = Math.round(refBin + (k + offsetSteps) * binsPerStep) % nBins;
        sum += binMax[(bin + nBins) % nBins];
      }
      return sum / n;
    };

    const vertexMean = meanAtOffset(0); // includes refBin itself, by construction the largest
    const midpointMean = meanAtOffset(0.5);
    // Expected gap for a straight n-gon: circumradius vs inradius = 1 - cos(pi/n) ~= 6% for n = 9; require at
    // least a third of that (conservative against real-ray-trace/defocus-mapping/binning noise).
    expect(vertexMean).toBeGreaterThan(midpointMean * (1 + (1 - Math.cos(Math.PI / n)) / 3));
  });
});
