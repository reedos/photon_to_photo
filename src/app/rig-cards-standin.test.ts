// R2-FID-5: a patent example that names an internal focusing group but gives no gaps is focused by moving the whole
// optic and the drawing grows at close focus. The lens and focus cards must say the real lens
// keeps its length; lenses whose prescription carries its own focus figures must not.
import { describe, expect, it } from 'vitest';
import { compute, PANE_LENS_IDS } from './engine-api';
import { focusesAsStandIn, partCard } from './rig-cards';

const st = { body: 'dslr' as const, ringAngle: 0, elementShift: [0] };

describe('the unit-focus stand-in is named on the cards', () => {
  // r4 (10/12/2026): the n500fl's patent example does list its focusing group (d11 and d16 at three states, now in its
  // focus.gaps), so no lineup lens stands in any more. A prescription that names an internal group and gives no gaps
  // (the p300, p400 and p500 free-form examples) still does, and its focus card says so.
  it('a prescription with an internal focusing group but no gaps says so on the focus card (p400)', () => {
    const m = compute({ lens: 'p400', focusM: 4 });
    expect(focusesAsStandIn(m)).toBe(true);
    expect(partCard('focusRing', m, st).body).toMatch(/real lens focuses internally/);
  });
  it('no lineup lens carries the note, the n500fl included (its patent gaps are recorded)', () => {
    for (const lens of PANE_LENS_IDS) {
      const m = compute({ lens });
      expect(focusesAsStandIn(m)).toBe(false);
      expect(partCard('lens', m, st).body).not.toMatch(/focuses internally/);
    }
  });
});
