// The app's build realizes every lens ahead (tools/realize-all.ts, vite.config.ts p2p-realizations) and the browser
// rebuilds each RealizedLens from those numbers (applyRealization). That must be exactly what realize() returns.
import { applyRealization, realize } from './realize';
import { GLASS_CATALOG, lensDesign, lensIds } from './data';
import { loadLens } from './lens';
import { allRealizations } from '../../tools/realize-all';

describe('realizations computed at build time (score loop r3)', () => {
  const table = allRealizations();

  it('covers every lens design', () => {
    expect(Object.keys(table).sort()).toEqual(lensIds().sort());
  });

  it.each(['n50', 's35', 'z800', 'n500', 'p20', 'p24'])('rebuilds %s exactly from its JSON numbers', (id) => {
    const resolved = loadLens(lensDesign(id), GLASS_CATALOG);
    const fromBuild = applyRealization(resolved, JSON.parse(JSON.stringify(table[id])));
    const direct = realize(loadLens(lensDesign(id), GLASS_CATALOG));
    expect(JSON.stringify(fromBuild.raw)).toBe(JSON.stringify(direct.raw));
    expect(fromBuild.afOffset).toBe(direct.afOffset);
    expect(fromBuild.realization).toEqual(direct.realization);
    // the glass (index functions) is the resolved lens's own, as realize() keeps it
    expect(fromBuild.index).toBe(resolved.index);
  });
});
