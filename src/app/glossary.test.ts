import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSS_LINKS, glossaryEntry, glossSegments } from './glossary';

describe('glossary notes in the app (score loop r2)', () => {
  it('links only to terms the Glossary page defines, and defines the terms the reviewers found missing', () => {
    for (const [, term] of GLOSS_LINKS) expect(glossaryEntry(term), term).toBeDefined();
    const terms = GLOSSARY.map((entry) => entry[0]);
    for (const t of ['Dispersion', 'Paraxial', 'Rolling shutter', 'Photodiode', 'PRNU (pixel-to-pixel variation)', 'RMS (root mean square)']) expect(terms).toContain(t);
    expect(glossaryEntry('Focal length')![1]).toMatch(/distance behind the lens/);
    expect(new Set(terms).size).toBe(terms.length);
  });
  it('splits text into runs without changing it, linking each term once', () => {
    const text = 'This ISO has 2.9 e− RMS read noise; read noise again, and the entrance pupil.';
    const segs = glossSegments(text);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.term).map((s) => s.term)).toEqual(['Electron (e−)', 'RMS (root mean square)', 'Read noise', 'Entrance pupil']);
  });
  // score loop r4: the site is called Photon to Photo and never said what a photon, a stop or a wavelength is
  it('defines photon, pixel, sensor, stop, wavelength, Poisson, PSF and the aberrations the cards name', () => {
    const terms = GLOSSARY.map((entry) => entry[0]);
    for (const t of ['Photon', 'Pixel', 'Sensor', 'Stop', 'Wavelength', 'Poisson distribution', 'Point spread function (PSF)', 'Airy pattern', 'Spherical aberration', 'Coma', 'Longitudinal color', 'Partial dispersion (θgF)', 'cos⁴ falloff']) expect(terms, t).toContain(t);
    expect(glossaryEntry('Photon')![1]).toMatch(/packet of light/);
    expect(glossaryEntry('Stop')![1]).toMatch(/f\/2\.8 to f\/4/);
    const linked = (text: string) => glossSegments(text).filter((s) => s.term).map((s) => s.term);
    expect(linked('Stopping down one full stop halves the light.')).toEqual(['Stop']);
    expect(linked('Each tour stop follows the rays.')).toEqual([]);
    expect(linked('The expected Poisson spread of photons, from the ideal PSF energy inside the first dark ring.')).toEqual(['Poisson distribution', 'Photon', 'Point spread function (PSF)', 'Airy pattern']);
    expect(linked('When a patent gives only an Abbe number, the θgF and cos⁴ falloff, coma and spherical aberration need care.').sort())
      .toEqual(['Abbe number', 'Coma', 'Partial dispersion (θgF)', 'Spherical aberration', 'cos⁴ falloff'].sort());
  });
  it('shares the once-only set across the parts of one card or dialog', () => {
    const seen = new Set<string>();
    glossSegments('read noise', seen);
    expect(glossSegments('more read noise', seen).some((s) => s.term)).toBe(false);
  });
});
