import { describe, expect, it } from 'vitest';
import { Pcg32, makeRng } from './rng';

describe('Pcg32 raw output vs. the published reference vector', () => {
  it('matches pcg32_srandom_r(seed=42, seq=54)\'s first five 32-bit outputs', () => {
    // Independently computed reference, not derived from this file: the canonical PCG32 algorithm
    // (state = 0, inc = (seq<<1)|1, one step, state += seed, one step, then XSH-RR outputs) run by hand
    // against the published test vector reproduced at rosettacode.org/wiki/Pseudo-random_numbers/PCG32
    // (itself following pcg-random.org's reference C implementation), retrieved 2026-09-28.
    const rng = new Pcg32(42, 54);
    const got = [0, 1, 2, 3, 4].map(() => rng.nextUint32());
    expect(got).toEqual([2707161783, 2068313097, 3122475824, 2211639955, 3215226955]);
  });

  it('is deterministic: two generators with the same seed and stream produce identical sequences', () => {
    const a = new Pcg32(123456789, 42);
    const b = new Pcg32(123456789, 42);
    for (let i = 0; i < 2000; i++) {
      expect(b.nextUint32()).toBe(a.nextUint32());
    }
  });

  it('gives statistically independent streams for different seq values from the same seed', () => {
    const a = new Pcg32(1, 1);
    const b = new Pcg32(1, 2);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 8; i++) {
      seqA.push(a.nextUint32());
      seqB.push(b.nextUint32());
    }
    expect(seqA).not.toEqual(seqB);
  });
});

describe('next() uniformity', () => {
  it('passes a chi-square goodness of fit against U(0,1) binned into 10 equal buckets', () => {
    const rng = makeRng(2026, 9);
    const n = 100000;
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < n; i++) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      buckets[Math.min(9, Math.floor(u * 10))] += 1;
    }
    const expected = n / 10;
    const chiSq = buckets.reduce((s, o) => s + ((o - expected) ** 2) / expected, 0);
    // df = 10 - 1 = 9 (the bucket probabilities are fixed at 1/10 each, nothing fitted from the sample).
    // Critical value at alpha=0.001 for 9 df is 27.877 (standard chi-square table, e.g. the NIST/SEMATECH
    // e-Handbook of Statistical Methods, section 1.3.6.7.4); 45 gives ample margin against a false failure
    // while still catching a biased or degenerate generator, whose statistic would run into the hundreds.
    expect(chiSq).toBeLessThan(45);
  });
});

describe('normal()', () => {
  it('has mean ~0 and variance ~1 at fixed seeds', () => {
    const rng = makeRng(7, 3);
    const n = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = rng.normal();
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    // SE(mean) = 1/sqrt(n) for a standard normal; SE(sample variance) ~= sqrt(2/n) asymptotically
    // (Var[S^2] = 2*sigma^4/(n-1) for a normal population). 6 sigma on each, generous.
    expect(Math.abs(mean)).toBeLessThan((6 * 1) / Math.sqrt(n));
    expect(Math.abs(variance - 1)).toBeLessThan(6 * Math.sqrt(2 / n));
  });

  it('is deterministic across runs at a fixed seed, including the cached second Box-Muller value', () => {
    const a = makeRng(55, 11);
    const b = makeRng(55, 11);
    const seqA = Array.from({ length: 9 }, () => a.normal());
    const seqB = Array.from({ length: 9 }, () => b.normal());
    expect(seqB).toEqual(seqA);
  });
});

describe('poisson()', () => {
  it('rejects negative or non-finite means', () => {
    const rng = makeRng(1, 1);
    expect(() => rng.poisson(-1)).toThrow(RangeError);
    expect(() => rng.poisson(NaN)).toThrow(RangeError);
    expect(() => rng.poisson(Infinity)).toThrow(RangeError);
  });

  it('is always exactly 0 at mean 0', () => {
    const rng = makeRng(2, 2);
    for (let i = 0; i < 1000; i++) {
      expect(rng.poisson(0)).toBe(0);
    }
  });

  // Sample mean and variance against the exact moments (E[X] = Var[X] = lambda for a Poisson variate) at
  // means straddling the Knuth/PTRS crossover (POISSON_SWITCH = 10 in rng.ts): 0.5 and 5 use Knuth's
  // method, 50 and 5000 use Hörmann's PTRS. Tolerances are 6 standard errors on each statistic:
  //   SE(mean) = sqrt(lambda / n)
  //   SE(sample variance) ~= sqrt((lambda + 2*lambda^2) / n), from the Poisson's 4th central moment
  //   mu4 = lambda + 3*lambda^2 (so Var[S^2] ~= (mu4 - sigma^4)/n = (lambda + 2*lambda^2)/n for large n).
  // 6 SE keeps the false-failure probability negligible (~1e-9 per check) while a real implementation bug
  // (wrong constant, off-by-one, wrong crossover) misses by many multiples of this.
  it.each([
    { lambda: 0.5, n: 200000 },
    { lambda: 5, n: 200000 },
    { lambda: 50, n: 200000 },
    { lambda: 5000, n: 20000 },
  ])('has mean and variance close to lambda=$lambda (n=$n)', ({ lambda, n }) => {
    const rng = makeRng(0xc0ffee, Math.round(lambda * 1000) + 1);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = rng.poisson(lambda);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const seMean = Math.sqrt(lambda / n);
    const seVar = Math.sqrt((lambda + 2 * lambda * lambda) / n);
    expect(Math.abs(mean - lambda)).toBeLessThan(6 * seMean);
    expect(Math.abs(variance - lambda)).toBeLessThan(6 * seVar);
  });

  it('passes a chi-square goodness of fit against the exact Poisson(4) pmf', () => {
    // Expected bucket probabilities computed independently of rng.ts's logGamma/PTRS code: a direct
    // p(k) = exp(-lambda) * lambda^k / k! evaluation (log-space, plain iterative log-factorial), by hand,
    // not by calling anything this module exports.
    const lambda = 4;
    function poissonPmf(k: number): number {
      let logFactorial = 0;
      for (let i = 2; i <= k; i++) logFactorial += Math.log(i);
      return Math.exp(-lambda + k * Math.log(lambda) - logFactorial);
    }
    const nBuckets = 10; // k = 0..9 individually, plus a "10+" tail bucket
    const n = 200000;
    const expectedP: number[] = [];
    let cum = 0;
    for (let k = 0; k < nBuckets; k++) {
      const p = poissonPmf(k);
      expectedP.push(p);
      cum += p;
    }
    expectedP.push(1 - cum); // 10+
    const observed = new Array(nBuckets + 1).fill(0);
    const rng = makeRng(999, 4);
    for (let i = 0; i < n; i++) {
      const x = rng.poisson(lambda);
      observed[Math.min(nBuckets, x)] += 1;
    }
    let chiSq = 0;
    for (let i = 0; i < observed.length; i++) {
      const expectedCount = expectedP[i] * n;
      expect(expectedCount).toBeGreaterThan(5); // Cochran's rule of thumb for a valid chi-square test
      chiSq += ((observed[i] - expectedCount) ** 2) / expectedCount;
    }
    // 11 buckets, lambda fixed (not fitted from the sample) => df = 11 - 1 = 10. Critical value at
    // alpha=0.001 for 10 df is 29.588 (standard chi-square table); 45 gives generous margin.
    expect(chiSq).toBeLessThan(45);
  });

  it('is deterministic across runs at a fixed seed, at both the Knuth and PTRS means', () => {
    for (const lambda of [3, 500]) {
      const a = makeRng(42, lambda);
      const b = makeRng(42, lambda);
      const seqA = Array.from({ length: 200 }, () => a.poisson(lambda));
      const seqB = Array.from({ length: 200 }, () => b.poisson(lambda));
      expect(seqB).toEqual(seqA);
    }
  });

  it('agrees between Knuth and PTRS in distribution right at the crossover (edge case)', () => {
    // POISSON_SWITCH = 10 in rng.ts. Poisson(9.9) uses Knuth; Poisson(10) uses PTRS. Neither algorithm
    // should show a seam: draw both and compare sample means against their own (equal, to first order)
    // lambda, generously, mainly to catch a crossover that accidentally excludes or double-covers a mean.
    const n = 100000;
    const below = makeRng(1, 1);
    const above = makeRng(1, 2);
    let sumBelow = 0;
    let sumAbove = 0;
    for (let i = 0; i < n; i++) {
      sumBelow += below.poisson(9.9);
      sumAbove += above.poisson(10);
    }
    expect(Math.abs(sumBelow / n - 9.9)).toBeLessThan(6 * Math.sqrt(9.9 / n));
    expect(Math.abs(sumAbove / n - 10)).toBeLessThan(6 * Math.sqrt(10 / n));
  });
});
