import { describe, it, expect } from 'vitest';
import {
  FORMATS,
  APSC_CANON,
  diagonal,
  cropFactorOf,
  fov,
  fovForFormat,
  equivalentFocalLength,
  equivalentFNumber,
  equivalentFocalLengthFormat,
  equivalentFNumberFormat,
} from './formats';

describe('format dimensions', () => {
  it('full-frame diagonal is 43.27 mm (golden: sqrt(36^2+24^2))', () => {
    // Hand calculation: sqrt(1296 + 576) = sqrt(1872) = 43.26661... mm.
    expect(FORMATS.ff.diag).toBeCloseTo(43.2666, 3);
    expect(FORMATS.ff.diag).toBeCloseTo(43.27, 2);
  });

  it('full-frame crop factor is exactly 1', () => {
    expect(FORMATS.ff.crop).toBeCloseTo(1, 10);
  });

  it('APS-C (nominal) crop factor is about 1.53 (hand calc: 43.2666/diag(23.5,15.6))', () => {
    // diag(23.5,15.6) = sqrt(552.25 + 243.36) = sqrt(795.61) = 28.20656
    expect(FORMATS.apsc.diag).toBeCloseTo(28.2066, 3);
    expect(FORMATS.apsc.crop).toBeCloseTo(1.5339, 3);
  });

  it('Canon APS-C variant is smaller (larger crop) than the nominal APS-C', () => {
    expect(APSC_CANON.w).toBeLessThan(FORMATS.apsc.w);
    expect(APSC_CANON.h).toBeLessThan(FORMATS.apsc.h);
    expect(APSC_CANON.crop).toBeGreaterThan(FORMATS.apsc.crop);
    // Hand calc: diag(22.3,14.9) = sqrt(497.29+222.01) = sqrt(719.3) = 26.8198; crop = 43.2666/26.8198 = 1.6132
    expect(APSC_CANON.crop).toBeCloseTo(1.6132, 3);
  });

  it('MFT crop factor is about 2.0 (hand calc: 43.2666 / diag(17.3,13))', () => {
    // diag(17.3,13) = sqrt(299.29+169) = sqrt(468.29) = 21.64001
    expect(FORMATS.mft.diag).toBeCloseTo(21.64, 2);
    expect(FORMATS.mft.crop).toBeCloseTo(1.9994, 3);
  });

  it('diagonal() and cropFactorOf() agree with the precomputed FORMATS entries', () => {
    expect(diagonal(FORMATS.apsc.w, FORMATS.apsc.h)).toBeCloseTo(FORMATS.apsc.diag, 9);
    expect(cropFactorOf(FORMATS.mft.w, FORMATS.mft.h)).toBeCloseTo(FORMATS.mft.crop, 9);
  });
});

describe('field of view', () => {
  it('50 mm on full frame gives 39.6 deg horizontal FOV (golden)', () => {
    // Hand calc: 2*atan(36/(2*50)) = 2*atan(0.36) = 39.59775 deg.
    const deg = (fov(50, FORMATS.ff.w) * 180) / Math.PI;
    expect(deg).toBeCloseTo(39.6, 1);
    expect(deg).toBeCloseTo(39.5978, 3);
  });

  it('fovForFormat matches fov() called with the axis dimension directly', () => {
    expect(fovForFormat(50, FORMATS.ff, 'h')).toBeCloseTo(fov(50, FORMATS.ff.w), 12);
    expect(fovForFormat(50, FORMATS.ff, 'v')).toBeCloseTo(fov(50, FORMATS.ff.h), 12);
    expect(fovForFormat(50, FORMATS.ff, 'diag')).toBeCloseTo(fov(50, FORMATS.ff.diag), 12);
  });

  it('a zero-size dimension has zero field of view', () => {
    expect(fov(50, 0)).toBe(0);
  });

  it('focus breathing: extending the image distance beyond f narrows the field of view', () => {
    const infinityFov = fov(50, 36); // default imageDistance = f
    const closeFocusFov = fov(50, 36, 60); // lens extended to v = 60 mm (closer focus)
    expect(closeFocusFov).toBeLessThan(infinityFov);
  });

  it('as image distance grows without bound, field of view shrinks toward 0', () => {
    expect(fov(50, 36, 1e6)).toBeLessThan(fov(50, 36, 1000));
    expect(fov(50, 36, 1e9)).toBeCloseTo(0, 4);
  });
});

describe('equivalence (stated as physics: constant entrance pupil diameter)', () => {
  it('equivalentFocalLength divides by the crop ratio (same FOV needs f/crop)', () => {
    const fEquiv = equivalentFocalLength(50, FORMATS.ff.crop, FORMATS.apsc.crop);
    expect(fEquiv).toBeCloseTo(50 / FORMATS.apsc.crop, 9);
    // Crop is defined from the diagonal, so it exactly reproduces the diagonal field of view:
    const ffDiagFov = fov(50, FORMATS.ff.diag);
    const apscDiagFov = fov(fEquiv, FORMATS.apsc.diag);
    expect(apscDiagFov).toBeCloseTo(ffDiagFov, 9);
  });

  it('reproduces the horizontal FOV only approximately, since FF (3:2) and nominal APS-C (~1.506:1) are not quite the same aspect ratio', () => {
    const fEquiv = equivalentFocalLength(50, FORMATS.ff.crop, FORMATS.apsc.crop);
    const ffFov = fov(50, FORMATS.ff.w);
    const apscFov = fov(fEquiv, FORMATS.apsc.w);
    // Close (same order as the aspect-ratio mismatch, well under 1%), but not exact - unlike the diagonal case.
    expect(Math.abs(apscFov - ffFov) / ffFov).toBeLessThan(0.005);
    expect(Math.abs(apscFov - ffFov)).toBeGreaterThan(1e-9);
  });

  it('equivalentFNumber divides by the crop ratio (same DOF/light needs N/crop)', () => {
    const N2 = equivalentFNumber(8, FORMATS.ff.crop, FORMATS.apsc.crop);
    expect(N2).toBeCloseTo(8 / FORMATS.apsc.crop, 9);
    expect(N2).toBeCloseTo(5.2154, 3);
  });

  it('matched focal length and f-number preserve the absolute entrance pupil diameter f/N', () => {
    const f1 = 50,
      N1 = 8;
    const D1 = f1 / N1;
    const f2 = equivalentFocalLengthFormat(f1, FORMATS.ff, FORMATS.apsc);
    const N2 = equivalentFNumberFormat(N1, FORMATS.ff, FORMATS.apsc);
    const D2 = f2 / N2;
    expect(D2).toBeCloseTo(D1, 9);
  });

  it('is the identity when the two formats are the same', () => {
    expect(equivalentFocalLength(50, FORMATS.mft.crop, FORMATS.mft.crop)).toBeCloseTo(50, 12);
    expect(equivalentFNumber(8, FORMATS.mft.crop, FORMATS.mft.crop)).toBeCloseTo(8, 12);
  });

  it('going from full frame to MFT and back to full frame round-trips', () => {
    const f2 = equivalentFocalLengthFormat(50, FORMATS.ff, FORMATS.mft);
    const back = equivalentFocalLengthFormat(f2, FORMATS.mft, FORMATS.ff);
    expect(back).toBeCloseTo(50, 9);
  });
});
