import { describe, expect, it } from 'vitest';
import { compute, LINEUP, bodyForLens } from './engine-api';
import { partCard, PART_IDS } from './rig-cards';

describe('on-screen evidence provenance', () => {
  for (const lens of [...LINEUP.dslr, ...LINEUP.mirrorless]) {
    it(`${lens}: every computed figure names its calculation and every card number has provenance`, () => {
      const m = compute({ lens, shutter: .8, lux: 1200 });
      for (const [key, value] of Object.entries(m.figs)) {
        if (value.ev === 'derived') expect(value.calc, key).toBeTruthy();
        else expect(value.src || value.calc, key).toBeTruthy();
      }
      for (const key of ['shutter', 'iso', 'sceneLux']) expect(m.figs[key].ev).toBe('assumed');
      for (const id of PART_IDS) {
        const card = partCard(id, m, { body: bodyForLens(lens)!, ringAngle: 0, elementShift: [] });
        for (const row of card.specs) expect(row.fig?.src || row.fig?.calc, `${id}/${row.k}`).toBeTruthy();
      }
      const maximum = partCard('lens', m, { body: bodyForLens(lens)!, ringAngle: 0, elementShift: [] }).specs[1];
      expect(Number(maximum.v.slice(2))).toBeCloseTo(maximum.fig!.v, 1);
    });
  }
});
