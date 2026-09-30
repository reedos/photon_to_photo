// motion.ts: the shared contract's optional field, read and written defensively (docs contract, "Model gains
// motion: ... | null"; "until the scenes stream merges, model.motion may be undefined"). These tests exercise that
// defensiveness directly, since this worktree's own compute() doesn't produce a motion reading yet.
import { describe, expect, it } from 'vitest';
import { compute } from './engine-api';
import { motionOf, motionPartial, motionSpeedOf } from './motion';

describe('motion.ts (the moving-subject contract, read/written defensively)', () => {
  it('motionOf reads null off a model with no motion field at all', () => {
    const model = compute({ lens: 'n50' });
    expect(motionOf(model)).toBeNull();
  });

  it('motionOf reads whatever the model actually carries, once there is one', () => {
    const model = compute({ lens: 'n50' }) as any;
    model.motion = { speedMps: 5, blurMm: 1.2, blurPx: 14, ev: 'derived' };
    expect(motionOf(model)).toEqual({ speedMps: 5, blurMm: 1.2, blurPx: 14, ev: 'derived' });
  });

  it('motionSpeedOf reads 0 off a scenario with no motion field', () => {
    const model = compute({ lens: 'n50' });
    expect(motionSpeedOf(model.scenario)).toBe(0);
  });

  it('motionSpeedOf reads whatever speed the scenario actually carries', () => {
    const scenario = { ...compute({ lens: 'n50' }).scenario, motion: { speedMps: 1.5 } } as any;
    expect(motionSpeedOf(scenario)).toBe(1.5);
  });

  it('motionPartial(0) clears motion; motionPartial(speed > 0) sets it', () => {
    expect((motionPartial(0) as any).motion).toBeUndefined();
    expect((motionPartial(12) as any).motion).toEqual({ speedMps: 12 });
  });
});
