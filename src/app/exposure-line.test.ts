import { describe, expect, it } from 'vitest';
import { exposureLine, lightRatio, timesText } from './exposure-line';

// Score loop r6: the live line under the Camera sliders.
describe('exposureLine', () => {
  const base = { fno: 4, shutter: 1 / 250, iso: 100 };
  it('says nothing is different at the lens defaults', () => {
    expect(exposureLine(base, base)).toBe('Light per pixel is the same as the lens’s default (f/4, 1/250 s).');
  });
  it('names the shutter change and the ISO consequence in plain words', () => {
    const text = exposureLine({ fno: 4, shutter: 1 / 8000, iso: 51200 }, base);
    expect(text).toMatch(/^1\/8000 s collects 32× fewer photons than 1\/250 s\./);
    expect(text).toMatch(/ISO 51,200 brightens the result afterward; it adds no light, so the noise shows more\.$/);
  });
  it('names an aperture change and an ISO drop', () => {
    expect(exposureLine({ fno: 8, shutter: 1 / 250, iso: 100 }, base)).toBe('f/8 lets in 4× less light than f/4.');
    expect(exposureLine({ fno: 4, shutter: 1 / 60, iso: 25 }, base)).toMatch(/collects 4\.2× more photons[^;]*\. ISO 25 brightens less/);
  });
  it('recognises two changes that cancel', () => {
    expect(exposureLine({ fno: 5.6, shutter: 1 / 125, iso: 100 }, base)).toMatch(/the two changes cancel/);
  });
  it('computes the light from time over f-number squared', () => {
    expect(lightRatio({ fno: 2, shutter: 1 / 250, iso: 100 }, base)).toBeCloseTo(4, 9);
    expect(timesText(1 / 32)).toBe('32×');
    expect(timesText(1.5)).toBe('1.5×');
  });
});
