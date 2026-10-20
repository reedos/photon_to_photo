import { describe, expect, it } from 'vitest';
import { compute } from '../app/engine-api';
import { sensorFor, D850_SENSOR_ID, Z8_SENSOR_ID } from './data';

// Score loop r6 (10/14/2026): the D850's and Z8's sensitivities are scaled to the measured (DxOMark saturation-based) ISO in
// Claff's Measured ISO chart: 0.699 and 0.740 of the ISO setting. A metered 18% gray in 5500 K daylight then sits where ISO 12232
// puts it at that ISO, instead of 0.8 EV under the label's expectation.
describe('sensitivity calibrated to the measured ISO', () => {
  it('records the cited measured-to-nominal factors on the sensor info', () => {
    expect(sensorFor('ff', 100, D850_SENSOR_ID).info.measuredIsoFactor).toBe(0.699);
    expect(sensorFor('ff', 100, Z8_SENSOR_ID).info.measuredIsoFactor).toBe(0.740);
  });
  for (const [lens, factor] of [['n50', 0.699], ['m50', 0.740]] as const) {
    it(`${lens}: a metered gray lands within 1% of ISO 12232's expectation at the measured ISO (distant focus, no bellows factor)`, () => {
      const m = compute({ lens, focusM: 200, shutter: 1 / 250, fno: 8 });
      const nominal = (Math.PI * 12.5 * 0.9) / (4 * 78);
      expect(m.exposure.isoExpectedRawFraction).toBeCloseTo(nominal * factor, 9);
      expect(m.exposure.grayRawFractionMetered / m.exposure.isoExpectedRawFraction).toBeGreaterThan(0.99);
      expect(m.exposure.grayRawFractionMetered / m.exposure.isoExpectedRawFraction).toBeLessThan(1.01);
    });
  }
  it('keeps the green peak a derived figure that names its calibration and the Claff cross-check', () => {
    const fig = sensorFor('ff', 100, D850_SENSOR_ID).info.figs.qePeak;
    expect(fig.ev).toBe('derived');
    expect(fig.calc).toMatch(/measured ISO/);
    expect(fig.calc).toMatch(/44%/);
    expect(fig.v).toBeGreaterThan(0.44);
  });
  it('is independent of the ISO setting (the exposure and the clip both scale with 1 / ISO)', () => {
    const a = sensorFor('ff', 100, D850_SENSOR_ID).info.figs.qePeak.v, b = sensorFor('ff', 800, D850_SENSOR_ID).info.figs.qePeak.v;
    expect(Math.abs(a / b - 1)).toBeLessThan(1e-9);
  });
});
