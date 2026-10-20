import { describe, expect, it } from 'vitest';
import { THIRD_STOP_ISO, isoLabel } from './stops';
import { sensorFor, D850_SENSOR_ID, Z8_SENSOR_ID } from '../engine/data';

// r3 physics (10/11/2026): the ISO ladder starts at the bodies' base ISO 64 (the ISO at which the 59,126 e- full well
// is defined) and marks stops above the native maximum, 25,600, as expanded.
describe('ISO stops', () => {
  it('start at base ISO 64 in third stops', () => {
    expect(THIRD_STOP_ISO.slice(0, 3)).toEqual([64, 80, 100]);
  });
  it('label stops outside the cited native range as expanded', () => {
    for (const id of [D850_SENSOR_ID, Z8_SENSOR_ID]) {
      const range = sensorFor('ff', 100, id).info.isoRange!;
      expect(range).toMatchObject({ nativeMin: 64, nativeMax: 25600 });
      expect(isoLabel(64, range)).toBe('ISO 64');
      expect(isoLabel(25600, range)).toBe('ISO 25,600');
      expect(isoLabel(32000, range)).toBe('ISO 32,000 · Hi (expanded)');
      expect(isoLabel(51200, range)).toBe('ISO 51,200 · Hi (expanded)');
    }
    expect(isoLabel(32000)).toBe('ISO 32,000');
  });
});
