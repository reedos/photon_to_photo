// Equal exposure (docs/PANE.md, "Light and exposure"): trade one stop of aperture for one stop of shutter. Opening up
// one stop multiplies the f-number by 1/sqrt(2) and halves the time; closing down multiplies it by sqrt(2) and doubles
// the time. Exact factors rather than the nearest marked values, so the light per pixel (time over f-number squared)
// is unchanged to the last photon and the engine's count shows it staying put. A UI rule, not physics: the engine
// computes what follows from the new settings.
import type { Scenario } from '../engine/types';

export const EQ_LIMITS = { maxFno: 22, minShutter: 1 / 8000, maxShutter: 30 } as const;

/** The scenario one equal-exposure stop away: dir = 1 closes the aperture and lengthens the time, dir = -1 opens
 *  it and shortens the time. Null when either setting would leave its range (the lens's widest aperture, f/22,
 *  1/8000 s, 30 s). */
export function equalExposureStep(s: Pick<Scenario, 'fno' | 'shutter'>, lensMaxFno: number, dir: 1 | -1): Partial<Scenario> | null {
  const fno = s.fno * Math.SQRT2 ** dir;
  const shutter = s.shutter * 2 ** dir;
  const eps = 1e-6;
  if (fno < lensMaxFno - eps || fno > EQ_LIMITS.maxFno + eps) return null;
  if (shutter < EQ_LIMITS.minShutter * (1 - eps) || shutter > EQ_LIMITS.maxShutter * (1 + eps)) return null;
  return { fno, shutter };
}
