import { describe, expect, it } from 'vitest';
import { compute, LINEUP, bodyForLens } from './engine-api';
import { bareNumbers, partCard, partLabel, PART_IDS } from './rig-cards';

describe('camera part cards (R1-07)', () => {
  it.each([[.6,'0.6 s'],[.8,'0.8 s'],[1/125,'1/125 s']])('keeps the actual %s-second shutter duration on the card', (shutter,title) => {
    const card=partCard('shutter',compute({lens:'n50',shutter:Number(shutter)}),{body:'dslr',ringAngle:0,elementShift:[]});
    expect(card.title).toBe(title);
  });
  for (const lens of [...LINEUP.dslr, ...LINEUP.mirrorless]) {
    it(`every number on ${lens}'s cards carries an evidence chip`, () => {
      const m = compute({ lens });
      const body = bodyForLens(lens)!;
      for (const id of PART_IDS) {
        const card = partCard(id, m, { body, ringAngle: 0.4, elementShift: [0.3, -1.2] });
        expect(bareNumbers(card), `${lens} ${id}`).toEqual([]);
        for (const r of card.specs) if (r.fig) expect(['spec', 'vendor', 'reported', 'derived', 'assumed']).toContain(r.fig.ev);
      }
    });
  }
  it('the reported release lag names its source', () => {
    const card = partCard('viewfinder', compute({ lens: 'n50' }), { body: 'dslr', ringAngle: 0, elementShift: [] });
    const lag = card.specs.find((r) => /lag/i.test(r.k))!;
    expect(lag.fig?.ev).toBe('reported');
    expect(lag.fig?.src).toMatch(/imaging-resource/i);
  });
  it('the DSLR has a shutter, not a stabilizer', () => {
    expect(partLabel('shutter', 'dslr')).toBe('Shutter');
    expect(partLabel('shutter', 'mirrorless')).toBe('Shutter / stabilizer');
  });
  it('no card body leans on a colon', () => {
    for (const lens of ['n50', 'm50']) {
      const m = compute({ lens });
      for (const id of PART_IDS) expect(partCard(id, m, { body: bodyForLens(lens)!, ringAngle: 0, elementShift: [] }).body).not.toMatch(/: /);
    }
  });
});
