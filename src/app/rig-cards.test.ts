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
  // Score loop r4 (10/12/2026): the EV100 of the settings and the scene's own, and the model's gray level against ISO 12232.
  it('the shutter card lists the settings EV100 and the scene EV100 apart', () => {
    const m = compute({ lens: 'n50', fno: 2.8, shutter: 1 / 250, iso: 100 });
    const card = partCard('shutter', m, { body: 'dslr', ringAngle: 0, elementShift: [] });
    const own = card.specs.find((r) => r.k === 'EV100 of these settings')!;
    const scene = card.specs.find((r) => /^EV100 of the scene/.test(r.k))!;
    expect(own.v).toBe('10.9');
    expect(scene.v).toBe('12.2');
    expect(scene.fig?.ev).toBe('assumed');
    expect(card.body).toMatch(/smaller opening or a faster shutter/);
  });
  it('the sensor card states the model raw level of a metered gray beside the ISO 12232 expectation', () => {
    const m = compute({ lens: 'n50' });
    const card = partCard('sensor', m, { body: 'dslr', ringAngle: 0, elementShift: [] });
    // score loop r5: these two rows sit under the card's More settings disclosure, not in its first list
    expect(card.specs.some((r) => /^ISO 12232 expects|^Raw level/.test(r.k))).toBe(false);
    const model = card.moreSpecs!.find((r) => /^Raw level, green 18% gray at the metered exposure/.test(r.k))!;
    const iso = card.moreSpecs!.find((r) => /^ISO 12232 expects/.test(r.k))!;
    // score loop r6: the D850's measured ISO is 0.699 of its setting (Claff's Measured ISO chart), so ISO 12232 expects
    // 11.3% x 0.699 = 7.9% at that ISO, and the sensitivity is calibrated to land the model on it
    expect(parseFloat(iso.v)).toBeCloseTo(7.9, 1);
    // (a little under it at the default 3 m focus: the working f-number is a few percent slower than the marked one)
    expect(Math.abs(parseFloat(model.v) - parseFloat(iso.v))).toBeLessThan(0.4);
    expect(parseFloat(model.v)).toBeGreaterThan(4);
    expect(model.fig?.ev).toBe('assumed');
  });
  it('the DSLR has a shutter, not a stabilizer', () => {
    expect(partLabel('shutter', 'dslr')).toBe('Shutter');
    expect(partLabel('shutter', 'mirrorless')).toBe('Shutter / stabilizer');
  });
  // score loop r4: the sensor card states its live figures in the sentence and no longer calls the calculated SNR measured;
  // the long viewfinder card leads with one plain sentence and keeps the optics under More detail
  it('writes the live photon and electron counts into the sensor card and calls the signal-to-noise ratio calculated', () => {
    const m = compute({ lens: 'n50' });
    const card = partCard('sensor', m, { body: 'dslr', ringAngle: 0, elementShift: [] });
    expect(card.body).toContain(`about ${Math.round(m.exposure.photonsMidGray).toLocaleString('en-US')} photons`);
    expect(card.body).toContain(`about ${Math.round(m.exposure.electronsMidGray).toLocaleString('en-US')} electrons`);
    // score loop r5: the lead keeps photons and electrons; the signal-to-noise explanation and PRNU are under More detail
    expect(card.more).toMatch(/signal-to-noise ratio is calculated for a uniform patch/);
    expect(card.body).not.toMatch(/measured|below|PRNU|ISO 12232/);
    expect(card.body.split(/\s+/).length).toBeLessThan(45);
    expect(card.specs.some((r) => /^Signal-to-noise ratio/.test(r.k))).toBe(true);
    expect(card.moreSpecs!.some((r) => /^Pixel-to-pixel variation, PRNU/.test(r.k))).toBe(true);
  });
  it('leads the DSLR viewfinder card with a short plain body and puts the rest under more', () => {
    const card = partCard('viewfinder', compute({ lens: 'n50' }), { body: 'dslr', ringAngle: 0, elementShift: [] });
    expect(card.body.split(/\s+/).length).toBeLessThan(45);
    expect(card.more).toMatch(/same optical distance/);
  });
  it('no card body leans on a colon', () => {
    for (const lens of ['n50', 'm50']) {
      const m = compute({ lens });
      for (const id of PART_IDS) expect(partCard(id, m, { body: bodyForLens(lens)!, ringAngle: 0, elementShift: [] }).body).not.toMatch(/: /);
    }
  });
});
