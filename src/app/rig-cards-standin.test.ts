// R2-FID-5: the n500fl's patent example names an internal focusing group but gives no gaps, so the engine focuses it
// by moving the whole optic and the drawing grows at close focus. The lens and focus cards must say the real lens
// keeps its length; lenses whose prescription carries its own focus figures must not.
import { describe, expect, it } from 'vitest';
import { compute, PANE_LENS_IDS } from './engine-api';
import { focusesAsStandIn, partCard } from './rig-cards';

const st = { body: 'dslr' as const, ringAngle: 0, elementShift: [0] };

describe('the unit-focus stand-in is named on the cards', () => {
  it('n500fl says so on the lens and focus cards', () => {
    const m = compute({ lens: 'n500fl', focusM: 3.6 });
    expect(focusesAsStandIn(m)).toBe(true);
    for (const id of ['lens', 'focusRing'] as const) expect(partCard(id, m, st).body).toMatch(/real lens focuses internally/);
  });
  it('no other lineup lens carries the note', () => {
    for (const lens of PANE_LENS_IDS.filter((l) => l !== 'n500fl')) {
      const m = compute({ lens });
      expect(focusesAsStandIn(m)).toBe(false);
      expect(partCard('lens', m, st).body).not.toMatch(/focuses internally/);
    }
  });
});
