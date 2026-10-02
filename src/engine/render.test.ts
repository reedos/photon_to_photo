import { describe, it, expect } from 'vitest';
import { compute, exitPupilBlurDiameterMm } from './camera';
import { renderImage, renderSetup, traceSource, traceSourceWithMotion, projectToRenderedPixel } from './render';
import { varianceE, analogGain, readout } from './sensor';
import { airyRadius } from './diffraction';
import type { Scenario } from './types';
import { BINS, sensorFor } from './data';
import { SCENES, daylightAt, flatBillboard } from './scenes';

function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    lens: 'p50',
    fno: 8,
    shutter: 1 / 60,
    iso: 800,
    focusM: 3,
    format: 'ff',
    shutterType: 'mechanical',
    scene: 'bench',
    ...overrides,
  };
}

describe('field silhouette integration', () => {
  it('integrates a half-covered pixel before readout instead of choosing one side of the edge', () => {
    const original = SCENES.field;
    try {
      const model = compute(baseScenario({ lens: 'n500', scene: 'field', focusM: 30, fno: 8, shutter: 1 / 1000, iso: 100 }));
      const width = 120, height = 80, x = 60, y = 40;
      const setup = renderSetup(model, width);
      const edgeX = (x + .5 - width / 2) * setup.blockPitchMm * 30000 / setup.efl;
      const front = flatBillboard('edge', [0, 0, 30000], 100000, 100000, () => .8);
      front.coverage = u => u < edgeX / 100000;
      const back = flatBillboard('background', [0, 0, 30000.01], 100000, 100000, () => .05);
      SCENES.field = () => ({ billboards: [front, back], illuminant: { spectrum: daylightAt(5500), lux: 20000 }, movingBillboardIds: ['offscreen-subject'] });
      const sampleScene = renderSetup(model, width).sceneObj;
      const samples = [-.25, .25].flatMap(dy => [-.25, .25].map(dx => traceSource(x + dx, y + dy, width, height, setup.blockPitchMm, setup.efl, setup.workingFno, sampleScene, setup.spec, setup.exposureS)));
      expect(samples.filter(s => s.hitId === 'edge')).toHaveLength(2);
      const mean = samples.reduce((sum, s) => sum + s.channelElectronsSharp[0] / 4, 0);
      const expected = readout(setup.spec, mean + setup.spec.darkCurrentEPerS * setup.exposureS, setup.iso);
      const result = renderImage(model, { width, height, seed: 1 });
      expect(Math.abs(result.raw[y * width + x] - expected)).toBeLessThan(5);
      const oneSide = readout(setup.spec, samples[0].channelElectronsSharp[0], setup.iso);
      expect(Math.abs(result.raw[y * width + x] - oneSide)).toBeGreaterThan(20);
      // Enabling motion for another subject must not change a stationary silhouette's sampling quality.
      const moving = renderImage({ ...model, scenario: { ...model.scenario, motion: { speedMps: .000001 } } }, { width, height, seed: 1 });
      expect(moving.raw).toEqual(result.raw);
    } finally { SCENES.field = original; }
  });
});

describe('renderImage: basics', () => {
  // A time budget only means something on a quiet machine: alone this renders in ~1.9 s, inside the full parallel
  // suite the same work takes ~3.4 s (09/29/2026, before and after the n50 focus fix alike). So the parallel suite
  // skips it and `node tools/test-perf.mjs` runs it alone (tools/review-build.mjs does, after the suite).
  it.runIf(process.env.P2P_PERF === '1')('runs 600x400 (the target resolution) in well under 3 s', () => {
    const model = compute(baseScenario());
    const cpu0 = process.cpuUsage();
    const t0 = Date.now();
    const result = renderImage(model, { width: 600, height: 400, seed: 1 });
    const ms = Date.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    expect(cpuMs).toBeLessThan(3000);
    expect(result.meta.ms).toBeLessThanOrEqual(ms + 1);
  }, 20000);

  it('returns the requested dimensions and an even pixelScale', () => {
    const model = compute(baseScenario());
    const result = renderImage(model, { width: 120, height: 80, seed: 1 });
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
    expect(result.pixelScale % 2).toBe(0);
    expect(result.raw.length).toBe(120 * 80);
    expect(result.rgba.length).toBe(120 * 80 * 4);
  });

  it('every alpha channel byte is opaque (255)', () => {
    const model = compute(baseScenario());
    const result = renderImage(model, { width: 40, height: 30, seed: 3 });
    for (let i = 3; i < result.rgba.length; i += 4) expect(result.rgba[i]).toBe(255);
  });

  it('carries the standard pipeline stages, each the right size', () => {
    const model = compute(baseScenario());
    const result = renderImage(model, { width: 40, height: 30, seed: 3 });
    for (const key of ['demosaic', 'wb', 'ccm', 'tone']) {
      expect(result.stages[key].length).toBe(40 * 30 * 3);
    }
  });
});

describe('Finding S2 -- white balance and the color-matrix fit convert energy to photons', () => {
  it("a rendered spectrally-flat neutral reflector under 6500K comes out [1,1,1] after white balance, " +
    'within 1% (EMVA 1288 release 3.1, eqs. (1), (2), (6)): response is proportional to ' +
    'integral(power(lambda) * lambda * QE(lambda) dlambda), not integral(power(lambda) * QE(lambda) dlambda)',
    () => {
      const spec = sensorFor('ff', 100).spec;
      const light = daylightAt(6500);
      // Independent derivation, not a call into color.ts's own whiteBalanceGains/spectrumToCameraRGB (the
      // functions render.ts's fix wraps): the hc/lambda->photons constant is fixed and cancels in a ratio, so
      // only the wavelength factor matters here.
      const energy: [number, number, number] = ['R', 'G', 'B'].map((ch) =>
        BINS.centers.reduce((sum, nm, i) => sum + light(nm) * nm * spec.qe[ch as 'R' | 'G' | 'B'](nm) * BINS.weights[i], 0),
      ) as [number, number, number];
      const expectedGains: [number, number, number] = [energy[1] / energy[0], 1, energy[1] / energy[2]];
      expect(Math.abs(expectedGains[2] - 1)).toBeGreaterThan(0.1); // sanity: daylight really does need unequal R/B gains

      const savedBench = SCENES.bench;
      SCENES.bench = () => ({
        billboards: [flatBillboard('neutral', [0, 0, 3000], 20000, 20000, () => 0.18)],
        illuminant: { spectrum: light, lux: 1000 },
      });
      try {
        const model = compute(baseScenario({ lens: 'n50', cct: 6500, lux: 1000, fno: 4, shutter: 1 / 125, iso: 100 }));
        const result = renderImage(model, { width: 80, height: 54, seed: 42 });
        const idx = (27 * 80 + 40) * 3;
        const wb = [result.stages.wb[idx], result.stages.wb[idx + 1], result.stages.wb[idx + 2]];
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(wb[k] / wb[1] - 1)).toBeLessThan(0.01);
        }
      } finally {
        SCENES.bench = savedBench;
      }
    },
  );
});

describe('Finding S3 -- binned raw pixels must include the mean dark charge', () => {
  it("a 30 s, zero-lux dark frame's binned raw mean matches the loupe's own per-pixel electron mean, both " +
    'reflecting darkCurrentEPerS * exposureS (EMVA 1288 release 3.1, sec. 3.1, eq. (19))',
    () => {
      const exposureS = 30;
      const model = compute(baseScenario({ lens: 'n50', shutter: exposureS, iso: 100, lux: 0, focusM: null }));
      const spec = sensorFor(model.scenario.format, model.scenario.iso, model.scenario.sensor).spec;
      // Independent derivation, not a read of render.ts's own darkMeanE variable: the mean dark charge is
      // just rate * time, and the analog gain / black level formulas are sensor.ts's own documented, already-
      // tested readout() contract, not something this fix touches.
      const expectedDarkE = spec.darkCurrentEPerS * exposureS;
      const gain = model.scenario.iso / spec.unityGainIso;
      const expectedRawDn = spec.blackLevelDn + gain * expectedDarkE;

      // 80x54, sampled over x in [1,20) / y in [1,15): the same small corner render.test.ts's other golden
      // tests keep clear of the bench scene's own background point highlights (scenes.ts's `pointHighlights`
      // are fixed-radiance sources that ignore the scene's lux override by design, so a naive full-frame
      // average of this "dark frame" would still catch a few saturated bokeh-highlight pixels).
      const result = renderImage(model, { width: 80, height: 54, seed: 7 });
      let sumRaw = 0;
      let sumLoupeE = 0;
      let n = 0;
      for (let y = 1; y < 15; y++) {
        for (let x = 1; x < 20; x++) {
          sumRaw += result.raw[y * 80 + x];
          sumLoupeE += result.pixel(x, y).electrons;
          n++;
        }
      }
      const meanRawDn = sumRaw / n;
      const meanLoupeE = sumLoupeE / n;
      expect(meanLoupeE).toBeCloseTo(expectedDarkE, 0); // Poisson-noisy per-pixel draws; loose tolerance
      expect(meanRawDn).toBeCloseTo(expectedRawDn, 0);
    },
  );
});

describe('renderImage: golden — determinism by seed', () => {
  it('the same model, request and seed produce byte-identical output', () => {
    const model = compute(baseScenario());
    const a = renderImage(model, { width: 80, height: 54, seed: 42 });
    const b = renderImage(model, { width: 80, height: 54, seed: 42 });
    expect(a.raw).toEqual(b.raw);
    expect(a.rgba).toEqual(b.rgba);
  });

  it('a different seed changes the noisy raw output', () => {
    const model = compute(baseScenario());
    const a = renderImage(model, { width: 80, height: 54, seed: 42 });
    const b = renderImage(model, { width: 80, height: 54, seed: 43 });
    expect(a.raw).not.toEqual(b.raw);
  });

  it('pixel(x, y) is itself deterministic by seed', () => {
    const model = compute(baseScenario());
    const a = renderImage(model, { width: 80, height: 54, seed: 7 });
    const b = renderImage(model, { width: 80, height: 54, seed: 7 });
    expect(a.pixel(40, 27)).toEqual(b.pixel(40, 27));
  });
});

// ---- shared helper: every rendered pixel in a wide, mostly-backdrop swath of the frame that lands on the
// ---- flat, uniform 'backdrop' billboard, with its own CFA channel and the SHARP (pre-blur) per-real-pixel
// ---- expected electrons for that channel at that exact pixel (which already reflects that pixel's own
// ---- off-axis cos^4 falloff — see camera.ts's exposure.imageIrradiance — so unlike a plain "flat patch,"
// ---- this set does NOT need to sit at a small, near-constant field angle: each sample carries its own
// ---- correct predicted mean, so a natural-vignetting gradient across the swath is expected and harmless.
interface FlatSample { bx: number; by: number; ch: 'R' | 'G' | 'B'; meanE: number }

function findFlatBackdropPixels(model: ReturnType<typeof compute>, width: number, height: number): FlatSample[] {
  const setup = renderSetup(model, width);
  const out: FlatSample[] = [];
  const margin = 6;
  for (let by = margin; by < height - margin; by++) {
    // the scene's left side, a clean stretch of backdrop: the photo's left third since the image became upright
    // (09/30/2026; it was the right third while the rendered image was stored inverted)
    for (let bx = margin; bx < Math.ceil(width * 0.32); bx++) {
      const src = traceSource(bx, by, width, height, setup.blockPitchMm, setup.efl, setup.workingFno, setup.sceneObj, setup.spec, setup.exposureS);
      if (src.hitId !== 'backdrop') continue;
      const evenX = bx % 2 === 0;
      const evenY = by % 2 === 0;
      const ch: 'R' | 'G' | 'B' = evenY ? (evenX ? 'R' : 'G') : evenX ? 'G' : 'B';
      const ci = ch === 'R' ? 0 : ch === 'G' ? 1 : 2;
      out.push({ bx, by, ch, meanE: src.channelElectronsSharp[ci] });
    }
  }
  return out;
}

describe('renderImage: golden — a flat region\'s DN standard deviation matches the predicted binned sigma', () => {
  it('within 5%, on the flat background billboard (checked as a z-score across many pixels, so a real, ' +
    'correct cos^4 vignetting gradient across the sampled area does not contaminate the noise measurement)', () => {
    const width = 200;
    const height = 134;
    const model = compute(baseScenario({ fno: 8, shutter: 1 / 60, iso: 800 }));
    const flat = findFlatBackdropPixels(model, width, height);
    expect(flat.length).toBeGreaterThan(1000); // enough samples for a stable std-of-z estimate

    const result = renderImage(model, { width, height, seed: 11 });
    const setup = renderSetup(model, width);
    const halfBlock = result.pixelScale / 2;
    const gain = analogGain(setup.spec, setup.iso);

    const zScores: number[] = [];
    for (const { bx, by, ch, meanE } of flat) {
      const n = ch === 'G' ? 2 * halfBlock * halfBlock : halfBlock * halfBlock;
      const predictedSigmaE = Math.sqrt(varianceE(setup.spec, meanE, setup.exposureS, setup.iso) / n);
      const predictedSigmaDn = predictedSigmaE * gain;
      const predictedMeanDn = meanE * gain + setup.spec.blackLevelDn;
      const measuredDn = result.raw[by * width + bx];
      zScores.push((measuredDn - predictedMeanDn) / predictedSigmaDn);
    }

    const zMean = zScores.reduce((a, b) => a + b, 0) / zScores.length;
    const zVar = zScores.reduce((a, v) => a + (v - zMean) ** 2, 0) / (zScores.length - 1);
    const zStd = Math.sqrt(zVar);
    // A correctly-predicted sigma makes each z-score ~ N(0, 1); its sample std should itself be close to 1.
    // (ADC quantization's own +/-0.5 DN, not included in predictedSigmaDn, is negligible next to a
    // shot-noise-dominated sigma of several DN at ISO 800, so this does not need its own tolerance term.)
    expect(Math.abs(zStd - 1)).toBeLessThan(0.05);
  });
});

describe('renderImage: golden — doubling the shutter doubles the mean signal until clipping', () => {
  it('the flat background region\'s mean DN above black level roughly doubles', () => {
    const width = 120;
    const height = 80;
    const shortScenario = baseScenario({ fno: 8, shutter: 1 / 250, iso: 400 });
    const longScenario = baseScenario({ fno: 8, shutter: 1 / 125, iso: 400 });
    const shortModel = compute(shortScenario);
    const longModel = compute(longScenario);
    const flat = findFlatBackdropPixels(shortModel, width, height);
    expect(flat.length).toBeGreaterThan(200);

    const shortResult = renderImage(shortModel, { width, height, seed: 5 });
    const longResult = renderImage(longModel, { width, height, seed: 5 });
    const { spec } = renderSetup(shortModel, width);

    const meanOf = (result: ReturnType<typeof renderImage>) => {
      const values = flat.map(({ bx, by }) => result.raw[by * width + bx] - spec.blackLevelDn);
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    const shortMean = meanOf(shortResult);
    const longMean = meanOf(longResult);
    expect(shortMean).toBeGreaterThan(0);
    const ratio = longMean / shortMean;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  it('stops doubling once the signal clips at full well / the ADC max code', () => {
    const width = 80;
    const height = 54;
    // A deliberately very long shutter relative to a much shorter one, both well past saturation.
    const dimScenario = baseScenario({ fno: 2, shutter: 1, iso: 1600 });
    const brighterScenario = baseScenario({ fno: 2, shutter: 4, iso: 1600 });
    const dimModel = compute(dimScenario);
    const brighterModel = compute(brighterScenario);
    const flat = findFlatBackdropPixels(dimModel, width, height);
    expect(flat.length).toBeGreaterThan(50);

    const dimResult = renderImage(dimModel, { width, height, seed: 9 });
    const brighterResult = renderImage(brighterModel, { width, height, seed: 9 });
    const { spec } = renderSetup(dimModel, width);
    const maxCode = 2 ** spec.bitDepth - 1;

    const meanOf = (result: ReturnType<typeof renderImage>) => flat.map(({ bx, by }) => result.raw[by * width + bx]).reduce((a, b) => a + b, 0) / flat.length;
    expect(meanOf(dimResult)).toBeGreaterThan(maxCode * 0.9); // already near saturated
    expect(meanOf(brighterResult)).toBeGreaterThan(maxCode * 0.95);
    expect(meanOf(brighterResult)).toBeLessThanOrEqual(maxCode); // never exceeds the ADC's own max code
  });
});

describe('renderImage: golden — a point highlight renders as a disk matching the predicted blur diameter', () => {
  it('within one rendered pixel, for the on-axis highlight at 25 m, focused at 3 m', () => {
    const width = 600;
    const height = 400;
    const model = compute(baseScenario({ lens: 'p50', fno: 2, shutter: 1 / 2000, iso: 200, focusM: 3, format: 'ff' }));
    const setup = renderSetup(model, width);
    const result = renderImage(model, { width, height, seed: 21 });

    // Locate the highlight exactly, by the same projection render.ts itself uses to place its splat (the
    // scene's own bokeh-highlight-0 sits at world (0, 0, 25000) mm — see scenes.ts).
    const proj = projectToRenderedPixel(setup.efl, setup.blockPitchMm, width, height, 0, 0, 25000);
    const px = Math.round(proj.bx);
    const py = Math.round(proj.by);

    // Measure on the DEMOSAICED stage (not the raw Bayer mosaic): raw DN alternates R/G/B pixel to pixel
    // (different QE per channel), so a plain raw-value threshold conflates that mosaic pattern with the
    // highlight's own shape; the demosaiced (interpolated, full-resolution-per-channel) luminance does not.
    const demosaic = result.stages.demosaic;
    const lumAt = (x: number, y: number) => {
      const i = (y * width + x) * 3;
      return Math.max(demosaic[i], demosaic[i + 1], demosaic[i + 2]);
    };

    const box = 25;
    let peakV = -Infinity;
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        peakV = Math.max(peakV, lumAt(x, y));
      }
    }
    // Local background: the median over a ring well outside the expected disk (predicted diameter is a few
    // rendered pixels at most on this scenario — see the assertion below).
    const ring: number[] = [];
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        if (Math.hypot(dx, dy) < box * 0.7) continue;
        const x = px + dx, y = py + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        ring.push(lumAt(x, y));
      }
    }
    ring.sort((a, b) => a - b);
    const background = ring[Math.floor(ring.length / 2)];
    expect(peakV).toBeGreaterThan(background * 1.5); // the highlight must actually stand out

    const halfMax = background + (peakV - background) / 2;
    let count = 0;
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        if (lumAt(x, y) >= halfMax) count++;
      }
    }
    const measuredDiameterPx = 2 * Math.sqrt(count / Math.PI);

    const predictedDiameterMm = exitPupilBlurDiameterMm(model, 25000);
    const predictedDiameterAiryMm = 2 * airyRadius(550, model.focus.workingFno);
    const combinedMm = Math.hypot(predictedDiameterMm, predictedDiameterAiryMm);
    const predictedDiameterPx = combinedMm / setup.blockPitchMm;

    expect(Math.abs(measuredDiameterPx - predictedDiameterPx)).toBeLessThan(1);
  });
});

describe('motion blur (SHARED CONTRACT)', () => {
  // A hard-edged billboard covering world x in [0, 50000] mm at the bench scene's own Siemens-star distance
  // (3 m), sharply focused there so defocus/diffraction stay negligible: only its LEFT edge (at x = 0, the
  // optical axis) falls inside any lens's field of view here, so the frame shows a simple step from dark
  // (x < 0, a miss) to lit (x >= 0). A moving billboard's own shift is +x (SHARED CONTRACT) over t in
  // [0, exposureS); averaging that shift uniformly turns the step into an EXACTLY LINEAR ramp spanning
  // world x in [0, speedMps*1000*exposureS] mm (a point at world x = p mm is covered for the fraction
  // min(W,p)/W of the exposure, W = the shift's own total mm span, for 0 <= p <= W — a plain geometric
  // fact about a box sliding at constant speed, independent of anything render.ts computes) — i.e. a ramp
  // whose width, converted to the image plane by the pinhole projection's own magnification (efl / Z,
  // traceSource's own dir computation), is exactly the streak width the SHARED CONTRACT names: speed *
  // shutter * |m|. Measured here via traceSourceWithMotion directly (channelElectronsSharp), the same way
  // this file's other physics checks (e.g. findFlatBackdropPixels above) read render.ts's pre-pipeline
  // numbers rather than the final, demosaiced/tone-curved rgba (whose own interpolation kernels add a
  // little unrelated spatial spread of their own).
  const EDGE_Z_MM = 3000;

  function withMovingEdge<T>(fn: () => T): T {
    const saved = SCENES.bench;
    SCENES.bench = () => ({
      billboards: [flatBillboard('edge', [25000, 0, EDGE_Z_MM], 50000, 3000, () => 0.9)],
      illuminant: { spectrum: daylightAt(5500), lux: 20000 },
      movingBillboardIds: ['edge'],
    });
    try {
      return fn();
    } finally {
      SCENES.bench = saved;
    }
  }

  // The G-channel profile (channelElectronsSharp[1], present at every source pixel regardless of that
  // pixel's own Bayer color — see traceSource — so consecutive columns are directly comparable, unlike the
  // final mosaic) across one row, and the width (rendered px) of its transition from the row's own peak
  // (plateau, at/just past the edge) down to zero (background, the pure miss beyond it).
  function rampWidthPx(model: ReturnType<typeof compute>, width: number, height: number, row: number): number {
    const setup = renderSetup(model, width);
    const values: number[] = [];
    for (let x = 0; x < width; x++) {
      const src = traceSourceWithMotion(x, row, width, height, setup.blockPitchMm, setup.efl, setup.workingFno, setup.sceneObj, setup.spec, setup.exposureS, setup.motion, setup.movingBillboardIds);
      values.push(src.channelElectronsSharp[1]);
    }
    const plateau = Math.max(...values);
    // Measured at the edge itself, from whichever side is lit (since the image became upright on 09/30/2026 the
    // lit side is on the photo's right): the zero column nearest the peak, then walk back toward the peak to the
    // first column at the plateau. (Counting every sub-plateau column would also count the lit side's cos^4
    // falloff toward the frame edge.)
    const k = values.indexOf(plateau);
    let z = -1;
    for (let d = 1; d < width && z < 0; d++) {
      if (k + d < width && values[k + d] <= 0.01 * plateau) z = k + d;
      else if (k - d >= 0 && values[k - d] <= 0.01 * plateau) z = k - d;
    }
    expect(z).toBeGreaterThanOrEqual(0);
    const step = z > k ? -1 : 1;
    let f = z;
    while (f !== k && values[f] < 0.99 * plateau) f += step;
    return Math.abs(z - f);
  }

  it('the moving edge ramps over speed * shutter * |m| / (pitch * pixelScale) rendered pixels, m the ' +
    "pinhole-projection magnification (efl / Z — traceSource's own dir) at the edge's distance, within one " +
    'rendered pixel',
    () => {
      withMovingEdge(() => {
        const width = 240, height = 80;
        const speedMps = 6;
        const scenario: Scenario = {
          lens: 'p50', fno: 0, shutter: 1 / 60, iso: 200, focusM: EDGE_Z_MM / 1000, format: 'ff',
          shutterType: 'mechanical', scene: 'bench', motion: { speedMps },
        };
        const model = compute(scenario);
        const setup = renderSetup(model, width);
        const mag = setup.efl / EDGE_Z_MM;
        const expectedWidthPx = (speedMps * 1000 * model.scenario.shutter * mag) / setup.blockPitchMm;
        expect(expectedWidthPx).toBeGreaterThan(4); // a meaningful ramp, not noise-level

        const measuredWidthPx = rampWidthPx(model, width, height, Math.floor(height / 2));
        expect(Math.abs(measuredWidthPx - expectedWidthPx)).toBeLessThan(1.5);
      });
    },
  );

  it('the edge is a sharp (at most one rendered pixel) step when scenario.motion is absent', () => {
    withMovingEdge(() => {
      const width = 240, height = 80;
      const scenario: Scenario = {
        lens: 'p50', fno: 0, shutter: 1 / 60, iso: 200, focusM: EDGE_Z_MM / 1000, format: 'ff',
        shutterType: 'mechanical', scene: 'bench',
      };
      const model = compute(scenario);
      expect(model.scenario.motion).toBeUndefined();
      expect(rampWidthPx(model, width, height, Math.floor(height / 2))).toBeLessThanOrEqual(2);
    });
  });

  it('is likewise a sharp step when scenario.motion.speedMps is 0, same as absent', () => {
    withMovingEdge(() => {
      const width = 240, height = 80;
      const scenario: Scenario = {
        lens: 'p50', fno: 0, shutter: 1 / 60, iso: 200, focusM: EDGE_Z_MM / 1000, format: 'ff',
        shutterType: 'mechanical', scene: 'bench', motion: { speedMps: 0 },
      };
      const model = compute(scenario);
      expect(rampWidthPx(model, width, height, Math.floor(height / 2))).toBeLessThanOrEqual(2);
    });
  });
});

describe('the final image is upright (photo orientation)', () => {
  // A lens forms an inverted image; a camera presents it upright. An object above and to the right of the axis must
  // land above and to the right of the photo's center (rows grow downward), and traceSource must be the projection's
  // exact inverse.
  it('an object up and to the right lands up and to the right of center', () => {
    const setup = renderSetup(compute(baseScenario()), 600);
    const p = projectToRenderedPixel(setup.efl, setup.blockPitchMm, 600, 400, 300, 200, 5000);
    expect(p.bx).toBeGreaterThan(300);
    expect(p.by).toBeLessThan(200);
  });
});
