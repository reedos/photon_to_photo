import { describe, expect, it } from 'vitest';
import { journeyHandoff, journeyFraming, JOURNEY_HANDOFFS, HANDOFF_HALF_SECONDS } from './shot-journey';
describe('continuous illustrative shot handoffs', () => {
  it('lands exactly in both neighboring views without residual camera transforms', () => {
    for (const handoff of JOURNEY_HANDOFFS) {
      expect(journeyHandoff(handoff.time - HANDOFF_HALF_SECONDS)).toBeNull();
      expect(journeyHandoff(handoff.time + HANDOFF_HALF_SECONDS)).toBeNull();
      expect(journeyFraming(handoff.outgoing, 0)).toEqual({ scale: 1, x: 0, y: 0 });
      for (const anchor of [handoff.outgoing, handoff.incoming]) {
        const frame = journeyFraming(anchor, 1);
        expect(anchor[0] * frame.scale + frame.x).toBeCloseTo(500);
        expect(anchor[1] * frame.scale + frame.y).toBeCloseTo(280);
      }
    }
  });
  it('uses one reversible clock and continuous midpoint blend for arbitrary scrubbing', () => {
    for (const handoff of JOURNEY_HANDOFFS) {
      expect(journeyHandoff(handoff.time)?.mix).toBeCloseTo(.5);
      const samples = Array.from({ length: 9 }, (_, i) => handoff.time - .4 + .1 * i);
      const forward = samples.map(time => journeyHandoff(time));
      expect(samples.reverse().map(time => journeyHandoff(time)).reverse()).toEqual(forward);
      expect(journeyHandoff(handoff.time - 1e-5)!.mix).toBeCloseTo(journeyHandoff(handoff.time + 1e-5)!.mix, 4);
    }
  });
  it('never pulls a selected process into a neighboring process or adds motion in reduced mode', () => {
    expect(journeyHandoff(12, 0, 12)).toBeNull();
    expect(journeyHandoff(12, 12, 16)).toBeNull();
    expect(journeyHandoff(16, 16, 28)).toBeNull();
    expect(journeyHandoff(4, 0, 28, true)).toBeNull();
    expect(journeyHandoff(NaN)).toBeNull();
    expect(journeyHandoff(20)).toBeNull(); // Existing assembled-JPEG expansion is already continuous.
    expect(journeyHandoff(28)).toBeNull(); // Finished JPEG stays entirely unchanged.
  });
});
