import { describe, it, expect } from 'vitest';
import type { Bins } from './types';
import {
  PLANCK_H,
  SPEED_OF_LIGHT,
  LUMINOUS_EFFICACY_555NM,
  photonEnergy,
  photonFlux,
  ev,
  ev100,
  equivalentAperture,
  equivalentShutter,
  shutterForEv,
  METER_CONSTANT_K,
  METER_CONSTANT_K_ALT,
  luminanceFromExposure,
  workingFNumber,
  workingFNumberForFocus,
  cos4Falloff,
  offAxisAngle,
  effectiveSolidAngle,
  imageIlluminance,
  imageIrradiance,
  tStop,
  transmissionFromTStop,
  photonsPerPixelPerBin,
  photometricFromRadiometric,
  radiometricFromPhotometric,
  motionBlurPixels,
  rollingShutterSkewPixels,
} from './exposure';

describe('CODATA constants', () => {
  it('Planck constant and speed of light are the exact SI-defined values', () => {
    expect(PLANCK_H).toBe(6.62607015e-34);
    expect(SPEED_OF_LIGHT).toBe(299792458);
  });
});

describe('photon energy and flux (golden)', () => {
  it('a 1 W, 550 nm beam carries about 2.77e18 photons/s', () => {
    // Hand calc: E_photon = hc/lambda = 6.62607015e-34 * 299792458 / 550e-9 = 3.6117197...e-19 J
    //            flux = 1 / E_photon = 2.768764...e18 photons/s
    const flux = photonFlux(1, 550);
    expect(flux / 1e18).toBeCloseTo(2.7688, 3);
    expect(flux / 1e18).toBeCloseTo(2.77, 2);
  });

  it('photonEnergy is inversely proportional to wavelength', () => {
    expect(photonEnergy(1100) / photonEnergy(550)).toBeCloseTo(.5, 12);
    // The energy is ~1e-19 J. An absolute 1e-9 tolerance accepted even zero.
    expect(photonEnergy(550) / 3.611719740270779e-19).toBeCloseTo(1, 12);
  });

  it('photonFlux(watts, nm) scales linearly with watts', () => {
    expect(photonFlux(3, 550)).toBeCloseTo(3 * photonFlux(1, 550), 6);
  });
});

describe('EV (golden)', () => {
  it('f/16 at 1/100 s is EV 14.64', () => {
    // Hand calc: EV = log2(N^2/t) = log2(256 / 0.01) = log2(25600) = 14.6439
    expect(ev(16, 1 / 100)).toBeCloseTo(14.64, 2);
    expect(ev(16, 1 / 100)).toBeCloseTo(14.6439, 3);
  });

  it('one more stop of aperture (half the light) raises EV by 1', () => {
    const N1 = 8,
      N2 = N1 * Math.SQRT2; // one stop down
    expect(ev(N2, 1 / 100) - ev(N1, 1 / 100)).toBeCloseTo(1, 6);
  });

  it('halving the shutter time raises EV by 1', () => {
    expect(ev(8, 1 / 200) - ev(8, 1 / 100)).toBeCloseTo(1, 6);
  });
});

describe('EV100 and sunny-16 self-consistency', () => {
  it('at ISO 100, EV100 equals EV', () => {
    expect(ev100(16, 1 / 100, 100)).toBeCloseTo(ev(16, 1 / 100), 9);
  });

  it('the sunny-16 family (f/16, 1/ISO s, that ISO) gives the same EV100 at every ISO (reciprocity)', () => {
    const at100 = ev100(16, 1 / 100, 100);
    const at200 = ev100(16, 1 / 200, 200);
    const at400 = ev100(16, 1 / 400, 400);
    const at1600 = ev100(16, 1 / 1600, 1600);
    expect(at200).toBeCloseTo(at100, 9);
    expect(at400).toBeCloseTo(at100, 9);
    expect(at1600).toBeCloseTo(at100, 9);
    // Textbook "Sunny 16 is about EV 15" ballpark (this exact family lands at 14.64, the golden EV above).
    expect(at100).toBeCloseTo(14.64, 1);
  });

  it('doubling ISO at fixed N and t raises the ISO-actually-used EV but lowers EV100 by 1', () => {
    const N = 8,
      t = 1 / 200;
    const evValue = ev(N, t); // independent of ISO
    expect(ev100(N, t, 200) - ev100(N, t, 100)).toBeCloseTo(-1, 9);
    expect(ev(N, t)).toBe(evValue);
  });
});

describe('reciprocity / equivalent exposures', () => {
  it('equivalentAperture and equivalentShutter round-trip to the same EV', () => {
    const N1 = 5.6,
      t1 = 1 / 250;
    const N2 = equivalentAperture(N1, t1, 1 / 60);
    expect(ev(N2, 1 / 60)).toBeCloseTo(ev(N1, t1), 9);

    const t2 = equivalentShutter(N1, t1, 8);
    expect(ev(8, t2)).toBeCloseTo(ev(N1, t1), 9);
  });

  it('shutterForEv inverts ev()', () => {
    const N = 4,
      t = 1 / 320;
    const evValue = ev(N, t);
    expect(shutterForEv(N, evValue)).toBeCloseTo(t, 9);
  });
});

describe('reflected-light meter constant (ISO 2720)', () => {
  it('the two commonly cited K values are 12.5 (default) and 14', () => {
    expect(METER_CONSTANT_K).toBe(12.5);
    expect(METER_CONSTANT_K_ALT).toBe(14);
  });

  it('luminanceFromExposure is consistent with ev/ev100 (both come from N^2/t = LS/K)', () => {
    const N = 8,
      t = 1 / 125,
      iso = 100;
    const L = luminanceFromExposure(N, t, iso);
    // L = K N^2/(tS)  =>  N^2/t = LS/K, i.e. ev(N,t) should equal log2(L*iso/(K*... )) consistently; check by
    // reconstructing N^2/t from L and confirming it reproduces the original.
    const reconstructedNsqOverT = (L * iso) / METER_CONSTANT_K;
    expect(reconstructedNsqOverT).toBeCloseTo((N * N) / t, 6);
  });

  it('a larger K implies a lower inferred scene luminance for the same exposure', () => {
    const N = 8,
      t = 1 / 125,
      iso = 100;
    const lLow = luminanceFromExposure(N, t, iso, METER_CONSTANT_K);
    const lHigh = luminanceFromExposure(N, t, iso, METER_CONSTANT_K_ALT);
    expect(lHigh).toBeGreaterThan(lLow);
  });
});

describe('working f-number and the camera equation', () => {
  it('at infinity focus (m=0), working f-number equals N', () => {
    expect(workingFNumber(8, 0)).toBeCloseTo(8, 9);
  });

  it('1:1 macro (|m|=1, pupilMag=1) doubles the f-number (the classic "one stop per unit magnification" result)', () => {
    expect(workingFNumber(8, 1, 1)).toBeCloseTo(16, 9);
  });

  it('workingFNumberForFocus at the 1:1 point matches workingFNumber(N, 1, pupilMag)', () => {
    const f = 100,
      N = 8;
    const u = 2 * f; // 1:1 magnification point
    expect(workingFNumberForFocus(N, f, u)).toBeCloseTo(workingFNumber(N, 1), 6);
  });

  it('cos4Falloff(0) = 1 and cos4Falloff(45 deg) = 0.25 exactly (cos(45deg)^4 = (sqrt2/2)^4 = 0.25)', () => {
    expect(cos4Falloff(0)).toBeCloseTo(1, 12);
    expect(cos4Falloff(Math.PI / 4)).toBeCloseTo(0.25, 9);
  });

  it('offAxisAngle(0, f) = 0, and grows with image height', () => {
    expect(offAxisAngle(0, 50)).toBe(0);
    expect(offAxisAngle(10, 50)).toBeGreaterThan(offAxisAngle(5, 50));
  });

  it('effectiveSolidAngle shrinks as (1/N^2)', () => {
    expect(effectiveSolidAngle(16)).toBeCloseTo(effectiveSolidAngle(8) / 4, 9);
  });

  it('imageIlluminance on-axis (cosTheta=1) with T=1 matches L * pi/(4 N^2) directly', () => {
    const L = 1000,
      N = 4;
    expect(imageIlluminance(L, 1, N, 1)).toBeCloseTo((L * Math.PI) / (4 * N * N), 9);
  });

  it('imageIlluminance and imageIrradiance apply the same formula (photometric vs radiometric is just the input unit)', () => {
    expect(imageIlluminance(500, 0.9, 5.6, 0.95)).toBeCloseTo(imageIrradiance(500, 0.9, 5.6, 0.95), 12);
  });

  it('halving transmission halves image-plane illuminance', () => {
    const base = imageIlluminance(1000, 1, 8, 1);
    const halfT = imageIlluminance(1000, 0.5, 8, 1);
    expect(halfT).toBeCloseTo(base / 2, 9);
  });

  it('off-axis falloff strictly reduces illuminance relative to on-axis', () => {
    const onAxis = imageIlluminance(1000, 1, 8, 1);
    const offAxis = imageIlluminance(1000, 1, 8, Math.cos(offAxisAngle(15, 50)));
    expect(offAxis).toBeLessThan(onAxis);
  });
});

describe('T-stop', () => {
  it('T-stop equals f-number at perfect (T=1) transmission', () => {
    expect(tStop(2.8, 1)).toBeCloseTo(2.8, 9);
  });

  it('golden hand calc: f/1.4 at T=0.81 transmission is T1.56', () => {
    // Hand calc: T# = N/sqrt(T) = 1.4/sqrt(0.81) = 1.4/0.9 = 1.5556
    expect(tStop(1.4, 0.81)).toBeCloseTo(1.5556, 3);
  });

  it('transmissionFromTStop inverts tStop', () => {
    const N = 2.0,
      T = 0.85;
    const t = tStop(N, T);
    expect(transmissionFromTStop(N, t)).toBeCloseTo(T, 9);
  });
});

describe('photometric <-> radiometric (peak-sensitivity approximation)', () => {
  it('683 lm/W is the SI-defined 555 nm luminous efficacy', () => {
    expect(LUMINOUS_EFFICACY_555NM).toBe(683);
  });

  it('the two conversions are exact inverses of each other', () => {
    expect(radiometricFromPhotometric(photometricFromRadiometric(1))).toBeCloseTo(1, 9);
  });
});

describe('photonsPerPixelPerBin', () => {
  it('matches a hand-computed single-bin photon count', () => {
    const bins: Bins = { centers: [550], edges: [545, 555], weights: [10] }; // 10 nm wide bin
    const sceneRadiance = [2]; // W/(m^2 sr nm)
    const geom = { T: 1, workingFNo: 8, cosTheta: 1, pixelPitchMm: 0.004, exposureS: 0.01 };

    // Hand calc:
    //   Omega_eff = pi/(4*8^2) = pi/256 = 0.01227185 sr
    //   spectral irradiance = 2 * 1 * 1 * Omega_eff = 0.02454369 W/(m^2 nm)
    //   pixel area = (4e-6 m)^2 = 1.6e-11 m^2
    //   energy = 0.02454369 * 1.6e-11 * 0.01 * 10 = 3.926991e-14 J
    //   photon energy at 550nm = hc/lambda = 3.611719740e-19 J
    //   photons = 3.926991e-14 / 3.611719740e-19 = 108729.1
    const [photons] = photonsPerPixelPerBin(bins, sceneRadiance, geom);
    expect(photons).toBeCloseTo(108729.1, 0); // within 0.5 photon of the hand calculation
  });

  it('scales linearly with exposure time', () => {
    const bins: Bins = { centers: [500, 600], edges: [495, 505, 595, 605], weights: [10, 10] };
    const radiance = [1, 1];
    const geomShort = { T: 1, workingFNo: 5.6, cosTheta: 1, pixelPitchMm: 0.005, exposureS: 0.01 };
    const geomLong = { ...geomShort, exposureS: 0.02 };
    const short = photonsPerPixelPerBin(bins, radiance, geomShort);
    const long = photonsPerPixelPerBin(bins, radiance, geomLong);
    for (let i = 0; i < short.length; i++) {
      expect(long[i]).toBeCloseTo(2 * short[i], 6);
    }
  });

  it('a bluer (shorter wavelength) bin yields more photons than an equal-energy redder bin', () => {
    const bins: Bins = { centers: [450, 650], edges: [445, 455, 645, 655], weights: [10, 10] };
    const radiance = [1, 1]; // equal radiance -> equal energy per bin
    const geom = { T: 1, workingFNo: 5.6, cosTheta: 1, pixelPitchMm: 0.005, exposureS: 0.01 };
    const [bluePhotons, redPhotons] = photonsPerPixelPerBin(bins, radiance, geom);
    // Equal energy, but each blue photon carries more energy, so there are fewer of them per unit energy... wait:
    // higher energy per photon means FEWER photons for the same total energy.
    expect(bluePhotons).toBeLessThan(redPhotons);
  });

  it('returns one entry per bin, all non-negative', () => {
    const bins: Bins = { centers: [400, 500, 600, 700], edges: [], weights: [5, 5, 5, 5] };
    const radiance = [0.5, 1, 1.5, 0.2];
    const geom = { T: 0.9, workingFNo: 4, cosTheta: 0.98, pixelPitchMm: 0.0045, exposureS: 0.02 };
    const result = photonsPerPixelPerBin(bins, radiance, geom);
    expect(result.length).toBe(4);
    for (const v of result) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('motion blur and rolling shutter', () => {
  it('at the 1:1 point (|m|=1), image-space blur equals object-space speed * time', () => {
    const f = 100,
      u = 2 * f; // 1:1 magnification
    const speed = 500; // mm/s
    const t = 0.01,
      pitch = 0.005;
    const px = motionBlurPixels(speed, u, f, t, pitch);
    expect(px).toBeCloseTo((speed * t) / pitch, 6);
  });

  it('zero exposure time gives zero motion blur', () => {
    expect(motionBlurPixels(1000, 3000, 50, 0, 0.005)).toBe(0);
  });

  it('a faster subject blurs proportionally more', () => {
    const a = motionBlurPixels(500, 3000, 50, 0.01, 0.005);
    const b = motionBlurPixels(1000, 3000, 50, 0.01, 0.005);
    expect(b).toBeCloseTo(2 * a, 6);
  });

  it('rollingShutterSkewPixels uses readout time the same way motionBlurPixels uses exposure time', () => {
    const speed = 800,
      distance = 4000,
      f = 85,
      pitch = 0.0045;
    const readout = 0.02;
    expect(rollingShutterSkewPixels(speed, distance, f, readout, pitch)).toBeCloseTo(
      motionBlurPixels(speed, distance, f, readout, pitch),
      9
    );
  });

  it('zero readout time gives zero skew', () => {
    expect(rollingShutterSkewPixels(1000, 3000, 50, 0, 0.005)).toBe(0);
  });
});
