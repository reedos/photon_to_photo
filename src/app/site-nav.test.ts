import { describe, expect, it } from 'vitest';
import { LINEUP } from './engine-api';
import { LENS_BODY, modelsHref, OPENING_HREF, siteNavigation } from './site-nav';

describe('site navigation', () => {
  it("maps every lineup lens to the body it mounts on, as the engine's lineup does", () => {
    const fromEngine: Record<string, string> = {};
    for (const [body, ids] of Object.entries(LINEUP)) for (const id of ids) fromEngine[id] = body;
    expect(LENS_BODY).toEqual(fromEngine);
  });

  it("opens the Models page on the reader's own body and lens (score loop r4)", () => {
    expect(modelsHref('z800')).toBe('./models.html?body=mirrorless&lens=z800&view=outside');
    expect(modelsHref('n500')).toBe('./models.html?body=dslr&lens=n500&view=outside');
    // a free-form prime has no 3D model: the page keeps its own default
    expect(modelsHref('p50')).toBe('./models.html');
    expect(modelsHref(null)).toBe('./models.html');
  });

  it('leads every page with Start here as an ordinary link and sends the brand to the opening', () => {
    expect(OPENING_HREF).toBe('./index.html?start=1');
    expect(siteNavigation('evidence')).toContain('href="./index.html?start=1"');
    expect(siteNavigation('visualizer')).not.toContain('start-entry');
  });
});
