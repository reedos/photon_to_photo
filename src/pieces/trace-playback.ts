import type { Vec3 } from '../engine/types';
export interface Trail { points: Vec3[]; lengths: number[]; total: number }
export function prepareTrail(points: Vec3[]): Trail {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...points[i].map((v, j) => v - points[i - 1][j])));
  return { points, lengths, total: lengths.at(-1) ?? 0 };
}
/** Clips each existing segment separately: a bright tail can never cut across a refracting surface. */
export function clippedTrail(trail: Trail, start: number, end: number): [Vec3, Vec3][] {
  const result: [Vec3, Vec3][] = [];
  const lo = Math.max(0, start) * trail.total, hi = Math.min(1, end) * trail.total;
  for (let i = 1; i < trail.points.length; i++) {
    const a = trail.lengths[i - 1], b = trail.lengths[i], left = Math.max(a, lo), right = Math.min(b, hi);
    if (right <= left || b <= a) continue;
    const lerp = (d: number) => trail.points[i - 1].map((v, j) => v + (trail.points[i][j] - v) * (d - a) / (b - a)) as Vec3;
    result.push([lerp(left), lerp(right)]);
  }
  return result;
}
