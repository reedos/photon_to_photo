import { it, expect } from 'vitest';
import { evidenceIndex } from './evidence-index';
import d850 from '../../data/d850.json';
import z8 from '../../data/z8.json';
import rn from '../../data/read-noise.json';
import s35 from '../../data/lenses/s35.json';
import n50 from '../../data/lenses/n50.json';
import n500 from '../../data/lenses/n500.json';
import n500fl from '../../data/lenses/n500fl.json';
import z35 from '../../data/lenses/z35.json';
import m50 from '../../data/lenses/m50.json';
import z800 from '../../data/lenses/z800.json';
it('every recorded use on the Evidence page carries a label (r5: there were 12 without one)', () => {
  const src = evidenceIndex({ '../data/d850.json': d850, '../data/z8.json': z8, '../data/read-noise.json': rn, '../data/lenses/s35.json': s35, '../data/lenses/n50.json': n50, '../data/lenses/n500.json': n500, '../data/lenses/n500fl.json': n500fl, '../data/lenses/z35.json': z35, '../data/lenses/m50.json': m50, '../data/lenses/z800.json': z800 });
  const bad: string[] = [];
  for (const s of src) for (const u of s.uses) if (!['spec', 'vendor', 'reported', 'derived', 'assumed'].includes(u.evidence)) bad.push(`${s.label} ${u.path}`);
  expect(bad).toEqual([]);
});
