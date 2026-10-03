import { clippedTrail, type Trail } from './trace-playback';

/** Presentation weights along existing traced segments; never smooth across a glass surface. */
export function ribbonTrail(trail: Trail, progress: number, span = .22) {
  const head = Math.max(0, Math.min(1, progress));
  const start = Math.max(0, head - span);
  let distance = start * trail.total;
  const weight = (at: number) => {
    const age = (head * trail.total - at) / (span * trail.total || 1);
    return .05 + .95 * Math.pow(Math.max(0, Math.min(1, 1 - age)), 1.6);
  };
  return clippedTrail(trail, start, head).map(([a,b]) => {
    const startWeight = weight(distance);
    distance += Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
    return { a, b, startWeight, endWeight: weight(distance) };
  });
}
