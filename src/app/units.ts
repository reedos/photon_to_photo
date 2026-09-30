// One place for how the page writes numbers and units (design/LOOK.md): µm, never "um"; × for dimensions and factors,
// never a letter x; superscript powers of ten, never a caret; focus distances in meters with two decimals below 10 m
// (0.45 m, not 450 mm), so a drag never flips the unit under the reader.

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

export function fmtNum(v: number, digits = 1): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** A distance from the sensor, in meters: 0.45 m, 1.50 m, 12.3 m, 140 m; null or non-finite reads "infinity". */
export function fmtDistance(mm: number | null): string {
  if (mm === null || !Number.isFinite(mm)) return 'infinity';
  const m = mm / 1000;
  if (m < 10) return `${m.toFixed(2)} m`;
  if (m < 100) return `${m.toFixed(1)} m`;
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

// The marked f-numbers on a lens are rounded powers of the square root of 2 (5.6 for 5.657, 11 for 11.31). A value within
// 4% of a marked full, half or third stop (a third of a stop is 12%) reads as that mark, the way a camera shows it.
const MARKED = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
/** A near-to-far range of distances with one unit: 1.42–1.59 m, 3.10 m to infinity. */
export function fmtRange(nearMm: number | null, farMm: number | null): string {
  const near = fmtDistance(nearMm);
  if (farMm === null || !Number.isFinite(farMm)) return `${near} to infinity`;
  const far = fmtDistance(farMm);
  return `${near.replace(/ m$/, '')}–${far}`;
}

export function fmtFno(n: number): string {
  const near = MARKED.reduce((a, m) => (Math.abs(m - n) < Math.abs(a - n) ? m : a), MARKED[0]);
  const best = Math.abs(near - n) / n < 0.04 ? near : n;
  return `f/${best < 10 ? best.toFixed(1).replace(/\.0$/, '') : Math.round(best)}`;
}

// The marked shutter speeds (1/60 for 1/64, 1/8 for 1/7.8): a time within 5% of one reads as that mark.
const MARKED_T = [1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800,
  1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30,
  1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5,
  6, 8, 10, 13, 15, 20, 25, 30];

/** 1/250 s below a second, decimal seconds at or above one; a doubled or halved time reads as its marked speed. */
export function fmtShutter(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '0 s';
  const near = MARKED_T.reduce((a, m) => (Math.abs(Math.log(m / t)) < Math.abs(Math.log(a / t)) ? m : a), MARKED_T[0]);
  const v = Math.abs(near - t) / t < 0.05 ? near : t;
  return v < 1 ? `1/${Math.round(1 / v)} s` : `${Number(v.toFixed(3))} s`;
}

export function fmtPitch(um: number): string {
  return `${um.toFixed(2)} µm`;
}

export function fmtDims(w: number, h: number): string {
  return `${Math.round(w).toLocaleString('en-US')} × ${Math.round(h).toLocaleString('en-US')}`;
}

export function superscript(n: number): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

/** Whole numbers below a million in full (51,876); above that, 2.4 × 10¹². */
export function fmtSci(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) < 1e6) return Math.round(n).toLocaleString('en-US');
  const e = Math.floor(Math.log10(Math.abs(n)));
  return `${(n / 10 ** e).toFixed(digits)} × 10${superscript(e)}`;
}

/** A power of ten on its own (a dot's photon weight): 10¹⁰; small ones in full. */
export function fmtPow10(n: number): string {
  if (n < 1e4) return Math.round(n).toLocaleString('en-US');
  const e = Math.round(Math.log10(n));
  return Math.abs(n - 10 ** e) / n < 1e-9 ? `10${superscript(e)}` : fmtSci(n);
}

/** Uppercase for mono captions, leaving a micro sign a micro sign (CSS uppercase turns µ into a Greek capital Mu). */
export function upperKeepMicro(s: string): string {
  return s.replace(/[^µ]+/g, (m) => m.toUpperCase());
}
