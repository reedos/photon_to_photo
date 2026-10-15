import type { AppState } from './store';
import type { Scenario } from '../engine/types';
import { lensSummary, normalizeScenario } from './engine-api';
import { fmtDistance, fmtFno, fmtNum } from './units';

/** A third of a stop is the step of the aperture ring; a request within half of one of the lens's marked stop is the
 *  marked stop itself (f/5.6 is a rounding of 5.657, and a photograph's EXIF f-number is rounded the same way). */
const MARKED_STOP_TOLERANCE = 2 ** (0.5 / 3 / 2);

/** True when the f-number asked for is the lens's marked widest stop (or within the marking's rounding of it). */
export function isMarkedStop(asked: number, markedFno: number): boolean {
  return asked >= markedFno / MARKED_STOP_TOLERANCE;
}

function lensModeledDiffers(lens: { maxFno: number; markedFno: number }): boolean {
  return Math.abs(lens.maxFno - lens.markedFno) / lens.markedFno > 0.005;
}

/** Explains a lens switch that forces the requested aperture closed to the lens's modeled wide-open limit.
 *  `requested` is the f-number the change named (Store.requestedFno(), e.g. a photograph's recorded f-number from Use
 *  these settings); without it, the new state's own request, else the f-number carried over (score loop r2, physics
 *  and ux reconciled at integration).
 *
 *  Only a request the lens cannot reach is a notice. Asking for the lens's own marked stop (f/5.6 on the 500 mm f/5.6,
 *  which the model draws at its true f/5.75 opening) is a match, not a refusal: it gets no toast, and the aperture
 *  control carries `apertureModelNote` instead (score loop r4). */
export function apertureClampNotice(previous: AppState | null, next: AppState, requested?: number): string | null {
  if (!previous || previous.scenario.lens === next.scenario.lens) return null;
  const lens = lensSummary(next.scenario.lens);
  // Score loop r2: only a real clamp to this lens's own limit, quoting what was asked for.
  const asked = requested ?? next.requestedFno ?? previous.scenario.fno;
  if (Math.abs(next.scenario.fno - lens.maxFno) > 1e-6 || asked >= lens.maxFno - 1e-9) return null;
  if (isMarkedStop(asked, lens.markedFno)) return null;
  return `${fmtFno(asked)} is wider than the ${fmtNum(lens.focalLength, 1)} mm lens opens, so the aperture is set to its widest, `
    + `${fmtFno(lens.markedFno)}${lensModeledDiffers(lens) ? ` (modeled at f/${lens.maxFno.toFixed(2)})` : ''}.`;
}

/** The line under the aperture control while the lens is at its widest opening and the number the model uses is not
 *  the marked one: the control reads the marked stop (f/5.6), the engine draws f/5.75. Null otherwise. */
export function apertureModelNote(lensId: string, fno: number): string | null {
  const lens = lensSummary(lensId);
  if (Math.abs(fno - lens.maxFno) > 1e-6 || !lensModeledDiffers(lens)) return null;
  return `Marked ${fmtFno(lens.markedFno)}, the widest stop. The model draws it at its true opening, f/${lens.maxFno.toFixed(2)}.`;
}

/** A lens switch that moved the focus distance says so (score loop r5: the 500 mm took the focus from 3 m to 15 m with no word).
 *  `focusAsked` is true when the change itself named a focus distance (Use these settings from a photograph, a link), which
 *  needs no explanation. */
export function lensFocusNotice(previous: AppState | null, next: AppState, focusAsked = false): string | null {
  if (!previous || focusAsked || previous.scenario.lens === next.scenario.lens) return null;
  const was = previous.scenario.focusM, now = next.scenario.focusM;
  if (was === now) return null;
  return `Focus set to ${now === null ? 'infinity' : fmtDistance(now * 1000)} for this lens.`;
}

/** What the "Reset settings" link restores: the exposure controls of the shot, at the defaults for the lens that is mounted
 *  (the body, the lens, the format and the scene are the visitor's kit and stay). */
export function exposureDefaults(lens: string, scene: string): Pick<Scenario, 'fno' | 'focusM' | 'shutter' | 'iso'> {
  const d = normalizeScenario({ lens, scene });
  return { fno: d.fno, focusM: d.focusM, shutter: d.shutter, iso: d.iso };
}
