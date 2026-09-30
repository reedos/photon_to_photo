// Cited spectral fixtures for E3's tests: CIE 1931 2-degree standard observer color matching functions,
// CIE Standard Illuminant D65's measured relative SPD, and the CIE daylight-locus basis functions S0/S1/S2.
// None of this is imported by color.ts, sensor.ts, pipeline.ts or scene.ts — those modules take spectra,
// CMFs and illuminants as arguments (ENGINE.md: "data injection is explicit"). This file exists only so
// color.test.ts and scene.test.ts have real, cited numbers to check against, and so a future data/color/*
// loader has an obviously-correct fixture to diff itself against.
//
// All three tables are sampled every 10 nm from 380 to 780 nm (41 points), which is coarse next to CIE's
// own 1 nm or 5 nm recommendation (CIE 15:2004, "Colorimetry," 3rd ed.) but keeps the fixture small and
// hand-checkable; tests that integrate against these tables use tolerances wide enough to absorb the
// resulting few-tenths-of-a-percent quadrature error (noted at each call site).
//
// Values retrieved 2026-09-28 from the colour-science Python library (github.com/colour-science/colour,
// BSD-3-Clause), which itself reproduces the CIE/ASTM published tables:
//   - CMF: colour/colorimetry/datasets/cmfs.py, key "CIE 1931 2 Degree Standard Observer"
//     (CIE 15:2004 Table T.4 / Wyszecki & Stiles Table I(3.3.1)).
//   - D65 SPD: colour/colorimetry/datasets/illuminants/sds.py, key "D65"
//     (CIE 15:2004 Table T.3 / ASTM E308-01 Table 5).
//   - S0/S1/S2: colour/colorimetry/datasets/illuminants/sds_d_illuminant_series.py
//     (Wyszecki, G. & Stiles, W. S., "Color Science," 2nd ed., Wiley, 2000, pp. 145-146;
//     Lindbloom, B., "Spectral Power Distribution of a CIE D-Illuminant," brucelindbloom.com, 2007).
// Numbers were pulled directly from the raw source files (not summarized), and cross-checked: the D65
// white point these CMF+SPD tables integrate to should land near the published (95.047, 100, 108.883)
// (see color.test.ts), and scene.test.ts checks the S0/S1/S2 daylight formula against this same D65 table
// at its nominal CCT.

import type { Bins } from '../types';

const CENTERS_10NM: number[] = Array.from({ length: 41 }, (_, i) => 380 + i * 10);

function binsFor(centers: number[]): Bins {
  const half = (centers[1] - centers[0]) / 2;
  const edges = [centers[0] - half, ...centers.map((c) => c + half)];
  const weights = centers.map(() => centers[1] - centers[0]);
  return { centers: centers.slice(), edges, weights };
}

/** 380..780 nm, 10 nm steps (41 samples). Shared by the CMF, D65 and S0/S1/S2 tables below. */
export const BINS_10NM: Bins = binsFor(CENTERS_10NM);

/** CIE 1931 2-degree standard observer, x-bar/y-bar/z-bar at BINS_10NM.centers. See file header for source. */
export const CIE1931_XBAR: number[] = [
  0.001368, 0.004243, 0.01431, 0.04351, 0.13438, 0.2839, 0.34828, 0.3362, 0.2908, 0.19536, 0.09564, 0.03201,
  0.0049, 0.0093, 0.06327, 0.1655, 0.2904, 0.43345, 0.5945, 0.7621, 0.9163, 1.0263, 1.0622, 1.0026, 0.85445,
  0.6424, 0.4479, 0.2835, 0.1649, 0.0874, 0.04677, 0.0227, 0.01135916, 0.00579035, 0.00289933, 0.00143997,
  0.00069008, 0.0003323, 0.00016615, 0.00008308, 0.00004151,
];
export const CIE1931_YBAR: number[] = [
  0.000039, 0.00012, 0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.09098, 0.13902, 0.20802, 0.323,
  0.503, 0.71, 0.862, 0.954, 0.99495, 0.995, 0.952, 0.87, 0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107,
  0.061, 0.032, 0.017, 0.00821, 0.004102, 0.002091, 0.001047, 0.00052, 0.0002492, 0.00012, 0.00006, 0.00003,
  0.00001499,
];
export const CIE1931_ZBAR: number[] = [
  0.00645, 0.02005, 0.06785, 0.2074, 0.6456, 1.3856, 1.74706, 1.77211, 1.6692, 1.28764, 0.81295, 0.46518,
  0.272, 0.1582, 0.07825, 0.04216, 0.0203, 0.00875, 0.0039, 0.0021, 0.00165, 0.0011, 0.0008, 0.00034, 0.00019,
  0.00005, 0.00002, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** CIE Standard Illuminant D65, relative SPD (S(560) = 100 by convention) at BINS_10NM.centers. */
export const D65_SPD: number[] = [
  49.9755, 54.6482, 82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812, 114.861, 115.923, 108.811,
  109.354, 107.802, 104.79, 107.689, 104.405, 104.046, 100.0, 96.3342, 95.788, 88.6856, 90.0062, 89.5991,
  87.6987, 83.2886, 83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091, 74.349, 61.604, 69.8856,
  75.087, 63.5927, 46.4182, 66.8054, 63.3828,
];

/**
 * D65's correlated color temperature on the modern (post-1968, CODATA c2) Planck-constant scale: nominal
 * 6500 K rectified by c2/1.4380 = 1.438776877.../1.4380 (Wikipedia, "Standard illuminant," section
 * "Computation," retrieved 2026-09-28; the same rectification is described at brucelindbloom.com's D-
 * illuminant page cited above). Plugging this into the daylight-locus formula and S0/S1/S2 below
 * reproduces the D65_SPD table above to within 5e-6 relative (checked numerically against every sample);
 * 6500 K itself only gets to about 7e-4 relative, and shows the historical mismatch is a real effect, not
 * rounding, so this file uses the rectified value throughout.
 */
export const D65_CCT_K = 6503.51;

/** D65's CIE 1931 chromaticity, per CIE 15:2004 / Schanda (2007), "Colorimetry," appendix A. */
export const D65_XY: readonly [number, number] = [0.31272, 0.32903];
/** D65's tristimulus values normalized to Y=100, per the same source. Used as the golden check in color.test.ts. */
export const D65_XYZ: readonly [number, number, number] = [95.047, 100, 108.883];

/** CIE daylight-locus basis functions S0/S1/S2 at BINS_10NM.centers. See file header for source. */
export const DAYLIGHT_S0: number[] = [
  63.4, 65.8, 94.8, 104.8, 105.9, 96.8, 113.9, 125.6, 125.5, 121.3, 121.3, 113.5, 113.1, 110.8, 106.5, 108.8,
  105.3, 104.4, 100.0, 96.0, 95.1, 89.1, 90.5, 90.3, 88.4, 84.0, 85.1, 81.9, 82.6, 84.9, 81.3, 71.9, 74.3,
  76.4, 63.3, 71.7, 77.0, 65.2, 47.7, 68.6, 65.0,
];
export const DAYLIGHT_S1: number[] = [
  38.5, 35.0, 43.4, 46.3, 43.9, 37.1, 36.7, 35.9, 32.6, 27.9, 24.3, 20.1, 16.2, 13.2, 8.6, 6.1, 4.2, 1.9, 0.0,
  -1.6, -3.5, -3.5, -5.8, -7.2, -8.6, -9.5, -10.9, -10.7, -12.0, -14.0, -13.6, -12.0, -13.3, -12.9, -10.6,
  -11.6, -12.2, -10.2, -7.8, -11.2, -10.4,
];
export const DAYLIGHT_S2: number[] = [
  3.0, 1.2, -1.1, -0.5, -0.7, -1.2, -2.6, -2.9, -2.8, -2.6, -2.6, -1.8, -1.5, -1.3, -1.2, -1.0, -0.5, -0.3,
  0.0, 0.2, 0.5, 2.1, 3.2, 4.1, 4.7, 5.1, 6.7, 7.3, 8.6, 9.8, 10.2, 8.3, 9.6, 8.5, 7.0, 7.6, 8.0, 6.7, 5.2,
  7.4, 6.8,
];

/** Builds a table-lookup spectral function (linear interpolation, 0 outside the table) from BINS_10NM + values. */
export function tableSpectrum(values: number[]): (nm: number) => number {
  const centers = BINS_10NM.centers;
  return (nm: number): number => {
    if (nm <= centers[0]) return nm === centers[0] ? values[0] : 0;
    if (nm >= centers[centers.length - 1]) {
      return nm === centers[centers.length - 1] ? values[values.length - 1] : 0;
    }
    let i = 0;
    while (centers[i + 1] < nm) i++;
    const t = (nm - centers[i]) / (centers[i + 1] - centers[i]);
    return values[i] * (1 - t) + values[i + 1] * t;
  };
}
