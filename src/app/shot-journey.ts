/** Editorial camera moves between representations, not physical transit times. */
export const JOURNEY_HANDOFFS = [
  { time: 4, from: 0, to: 1, label: 'Follow the light into the lens', outgoing: [735, 278, 2.05], incoming: [510, 285, 1.08] },
  { time: 8, from: 1, to: 2, label: 'Focused light reaches the sensor', outgoing: [890, 295, 1.75], incoming: [500, 270, 1.25] },
  { time: 12, from: 2, to: 3, label: 'Inside one representative pixel', outgoing: [500, 270, 2.15], incoming: [385, 190, 1.6] },
  { time: 16, from: 3, to: 4, label: 'Collected charge becomes image data', outgoing: [832, 325, 1.7], incoming: [520, 265, 1.5] },
] as const;
export const HANDOFF_HALF_SECONDS = .45;
const smooth = (x: number) => x * x * (3 - 2 * x);
export function journeyHandoff(seconds: number, start = 0, end = 28, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(seconds)) return null;
  const spec = JOURNEY_HANDOFFS.find(item => item.time > start && item.time < end && seconds > item.time - HANDOFF_HALF_SECONDS && seconds < item.time + HANDOFF_HALF_SECONDS);
  if (!spec) return null;
  const progress = (seconds - spec.time + HANDOFF_HALF_SECONDS) / (2 * HANDOFF_HALF_SECONDS);
  return { ...spec, progress, mix: smooth(progress) };
}
/** The chosen landmark moves toward the same visual center during every handoff. */
export function journeyFraming(anchor: readonly number[], amount: number) {
  const scale = 1 + (anchor[2] - 1) * amount;
  return { scale, x: (500 - anchor[0]) * amount + anchor[0] * (1 - scale), y: (280 - anchor[1]) * amount + anchor[1] * (1 - scale) };
}
