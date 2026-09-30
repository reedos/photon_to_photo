// The moving-subject contract shared with the scenes stream (see .local or the workflow brief for the full text):
//   - Scenario gains `motion?: { speedMps: number }`.
//   - Model gains `motion: { speedMps: number; blurMm: number; blurPx: number; ev: 'derived' } | null`, plus
//     `model.figs.motionBlurPx` with its own evidence.
// engine/types.ts and engine/model-types.ts are the lead's files (this stream owns src/app/** and src/pieces/**,
// not src/engine/**), so this reads and writes those two fields through a local, optional-shaped type instead of
// editing the shared interfaces -- until the scenes stream's own edit to those files lands, `model.motion` (and a
// `motion` scenario field someone sets) may simply not exist yet, and this stays correct either way.

import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';

export interface MotionReadout {
  speedMps: number;
  blurMm: number;
  blurPx: number;
  ev: 'derived';
}

type ModelWithMotion = Model & { motion?: MotionReadout | null };
type ScenarioWithMotion = Scenario & { motion?: { speedMps: number } };

/** The model's motion readout, or null if there isn't one yet (no motion set, or the scenes stream hasn't merged
 *  `compute()`'s own support for it) -- callers hide the streak readout in the latter case, same as the former. */
export function motionOf(model: Model): MotionReadout | null {
  return (model as ModelWithMotion).motion ?? null;
}

/** The scenario's requested subject speed, m/s (0 = still), reading the same optional field defensively. */
export function motionSpeedOf(scenario: Scenario): number {
  return (scenario as ScenarioWithMotion).motion?.speedMps ?? 0;
}

/** A store.set() partial that sets (or clears, at speedMps <= 0) the subject's motion. Scenario doesn't declare
 *  `motion` in this worktree yet (see the file comment), so this is the one place that casts past it. */
export function motionPartial(speedMps: number): Partial<Scenario> {
  const partial: Partial<ScenarioWithMotion> = { motion: speedMps > 0 ? { speedMps } : undefined };
  return partial as Partial<Scenario>;
}
