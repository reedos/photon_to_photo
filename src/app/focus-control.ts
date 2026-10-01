// Control spacing, not an optical claim. The last position is explicitly infinity.
export const FOCUS_STEPS = 128;

export function focusRangeMaxMm(minMm: number, focalLengthMm: number): number {
  return Math.max(20000, focalLengthMm * 1000, minMm * 10);
}

export function focusStepValue(minMm: number, focalLengthMm: number, step: number): number | null {
  if (step >= FOCUS_STEPS - 1) return null;
  const t = Math.max(0, step) / (FOCUS_STEPS - 2);
  return minMm * (focusRangeMaxMm(minMm, focalLengthMm) / minMm) ** t;
}

export function focusStepFromMm(minMm: number, focalLengthMm: number, mm: number | null): number {
  if (mm === null) return FOCUS_STEPS - 1;
  const t = Math.log(Math.max(minMm, mm) / minMm) / Math.log(focusRangeMaxMm(minMm, focalLengthMm) / minMm);
  return Math.round(Math.min(1, Math.max(0, t)) * (FOCUS_STEPS - 2));
}
