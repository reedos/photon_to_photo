import type { AppState } from './store';
import { lensSummary } from './engine-api';
import { fmtFno, fmtNum } from './units';

/** Explains a lens switch that forces the requested aperture closed to the lens's modeled wide-open limit. */
export function apertureClampNotice(previous: AppState | null, next: AppState): string | null {
  if (!previous || previous.scenario.lens === next.scenario.lens
      || next.scenario.fno <= previous.scenario.fno + 1e-9) return null;

  const lens = lensSummary(next.scenario.lens);
  return `Aperture limited from requested ${fmtFno(previous.scenario.fno)} to model limit f/${next.scenario.fno.toFixed(2)}. `
    + `This ${fmtNum(lens.focalLength, 1)} mm lens is marked ${fmtFno(lens.markedFno)} wide open.`;
}
