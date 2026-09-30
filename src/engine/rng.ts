// Seeded, deterministic randomness for the engine: PCG32, plus normal and Poisson variates built on it.
//
// Everything downstream (sensor.ts's shot noise, dark current, PRNU and read noise; scene.ts's synthetic
// scatter) draws from an `Rng` (src/engine/types.ts). Two calls constructed with the same seed and stream
// produce byte-identical sequences, on any machine, forever: that determinism is what lets a golden test
// pin down "this seed draws this sample" and what will let a WGSL/TSL port be checked pixel-for-pixel
// against this CPU reference (ENGINE.md's stated purpose for the whole engine).

import type { Rng } from './types';

// ---- PCG32 (O'Neill, permuted congruential generator) --------------------------------------------------
//
// M. E. O'Neill, "PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random
// Number Generation," Harvey Mudd College Tech Report HMC-CS-2014-0905 (2014), and the reference C
// implementation at pcg-random.org ("pcg_basic" / "pcg32"). The generator is a 64-bit linear congruential
// generator (LCG) whose *state* is never emitted; each output instead applies a xorshift-then-rotate
// permutation (XSH-RR) to a still-earlier state, which is what gives PCG its statistical quality despite
// the LCG's well-known weak low bits.
//
// state[n+1] = state[n] * MULT + inc   (mod 2^64)
// output     = rotr32( xorshift(state[n]), state[n] >> 59 )
//
// MULT = 6364136223846793005 is the multiplier Knuth gives for a 64-bit LCG (TAOCP vol. 2, 3.3.4) and
// that pcg_basic uses verbatim. `inc` must be odd (forced by `| 1`) so the LCG has full period 2^64; two
// different odd `inc` values give two statistically independent streams from the same multiplier, which
// is how `seq` below selects a stream.
//
// JS numbers cannot hold a 64-bit integer exactly (products overflow 2^53), so the state is kept as a
// BigInt masked to 64 bits after every operation. BigInt arithmetic is exact by construction, which is
// worth more here than raw speed: this module is the reference the rest of the engine, and eventually a
// GPU port, gets checked against. If sampling throughput ever becomes the bottleneck for a full-frame
// render, the fix is a 32-bit-limb (no-BigInt) reimplementation of just `step`/`nextUint32`, cross-checked
// against this file's golden vector before it replaces it — see docs/engine/e3.md "Known limits".
const PCG_MULT = 6364136223846793005n;
const MASK64 = (1n << 64n) - 1n;
const TWO_POW_32 = 4294967296;

function toBigUint64(v: number | bigint): bigint {
  const b = typeof v === 'bigint' ? v : BigInt(Math.trunc(v));
  return b & MASK64;
}

export class Pcg32 implements Rng {
  private state: bigint;
  private readonly inc: bigint;
  private spareNormal: number | null = null;

  /**
   * @param seed Any integer (or bigint); only its low 64 bits matter.
   * @param seq Selects an independent stream from the same seed (pcg_basic's `initseq`); only its low 63
   *   bits matter (it is shifted left and or'd with 1). Defaults to 1, an arbitrary odd stream id.
   */
  constructor(seed: number | bigint, seq: number | bigint = 1) {
    const s = toBigUint64(seed);
    const q = toBigUint64(seq);
    this.state = 0n;
    this.inc = ((q << 1n) | 1n) & MASK64;
    this.step();
    this.state = (this.state + s) & MASK64;
    this.step();
  }

  /** Advances the LCG one step and returns the state *before* the step (what the output stage permutes). */
  private step(): bigint {
    const old = this.state;
    this.state = (old * PCG_MULT + this.inc) & MASK64;
    return old;
  }

  /** Raw 32-bit output, uniform over [0, 2^32). This is PCG32's XSH-RR permutation of `step()`'s old state. */
  nextUint32(): number {
    const old = this.step();
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n); // top 5 bits of the 64-bit state, i.e. 0..31
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  /** Uniform double in [0, 1), resolution 2^-32 (one nextUint32 draw). */
  next(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  /**
   * Standard normal deviate via the Box-Muller transform (Box, G. E. P. & Muller, M. E., "A Note on the
   * Generation of Random Normal Deviates," Annals of Mathematical Statistics 29(2), 1958, pp. 610-611).
   * Each pair of uniforms yields two independent normals; the second is cached for the next call, so the
   * amortized cost is one `next()` plus one transcendental pair every other call.
   */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u1: number;
    do {
      u1 = this.next();
    } while (u1 <= Number.EPSILON); // avoid log(0); negligible bias, next() hits 0 with prob. 2^-32
    const u2 = this.next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.spareNormal = r * Math.sin(theta);
    return r * Math.cos(theta);
  }

  /**
   * Poisson deviate with the given mean, exact (not a normal approximation) at every mean. Dispatches to
   * Knuth's method below `POISSON_SWITCH` and to Hörmann's PTRS above it; see `poissonKnuth`/`poissonPtrs`
   * for the algorithms and citations.
   */
  poisson(mean: number): number {
    if (!Number.isFinite(mean) || mean < 0) {
      throw new RangeError(`Rng.poisson: mean must be finite and >= 0, got ${mean}`);
    }
    if (mean === 0) return 0;
    return mean < POISSON_SWITCH ? poissonKnuth(this, mean) : poissonPtrs(this, mean);
  }
}

/** Builds a PCG32-backed `Rng`. See `Pcg32` for the seed/seq semantics. */
export function makeRng(seed: number | bigint, seq: number | bigint = 1): Rng {
  return new Pcg32(seed, seq);
}

// ---- Poisson ---------------------------------------------------------------------------------------------

/**
 * Knuth-vs-PTRS crossover. Below this mean, Knuth's method (below) costs O(mean) uniforms per draw, which
 * is cheap; above it, the cost would grow without bound (and `exp(-mean)` underflows to 0 for mean greater
 * than about 745, which would make Knuth's loop spin forever). NumPy's legacy Poisson generator
 * (numpy/random/src/distributions/distributions.c, `random_poisson`) uses this same threshold to switch
 * between `random_poisson_mult` and `random_poisson_ptrs`; matched here since it is the reference this
 * module's PTRS constants (below) are taken from.
 */
const POISSON_SWITCH = 10;

/**
 * Knuth's multiplicative method (Knuth, D. E., "The Art of Computer Programming, Vol. 2: Seminumerical
 * Algorithms," 3rd ed., 1997, Algorithm P, p. 137): multiply uniforms until the running product first
 * drops at or below e^-mean; the number of multiplications is Poisson(mean)-distributed. Exact, O(mean)
 * uniforms per draw on average, and stable for small mean (the regime it is used in here).
 */
function poissonKnuth(rng: Rng, lam: number): number {
  const enlam = Math.exp(-lam);
  let x = 0;
  let prod = 1;
  for (;;) {
    prod *= rng.next();
    if (prod > enlam) {
      x += 1;
    } else {
      return x;
    }
  }
}

/**
 * Hörmann's PTRS ("transformed rejection with squeeze"): Hörmann, W., "The Transformed Rejection Method
 * for Generating Poisson Random Variables," Insurance: Mathematics and Economics 12(1), 1993, pp. 39-45.
 * It fits a normal-like envelope to the Poisson PMF on a transformed (dominating) scale, draws from that
 * envelope by inversion, and accepts or rejects it against the true PMF — O(1) uniforms per draw on
 * average at any mean, with acceptance probability approaching 1 as mean grows, and exact (not a normal
 * approximation) because every candidate is checked against the true log-PMF before being accepted.
 *
 * The constants (0.931, 2.53, -0.059, 0.02483, 1.1239, 1.1328, 3.4, 0.9277, 3.6224, 0.07, 0.013, 0.43) are
 * Hörmann's fitted envelope parameters, reproduced from NumPy's implementation (`random_poisson_ptrs` in
 * numpy/random/src/distributions/distributions.c, retrieved 2026-09-28), which is the standard reference
 * implementation of this algorithm and the one most other libraries' PTRS ports (SciPy, GSL's `gsl_ran_
 * poisson` at large mu, Julia's `Distributions.jl`) trace back to. This file's PCG32 stream is independent
 * of NumPy's own generator, so this does not reproduce NumPy's *output sequence* — only its algorithm.
 */
function poissonPtrs(rng: Rng, lam: number): number {
  const slam = Math.sqrt(lam);
  const loglam = Math.log(lam);
  const b = 0.931 + 2.53 * slam;
  const a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);

  for (;;) {
    const u = rng.next() - 0.5;
    const v = rng.next();
    const us = 0.5 - Math.abs(u);
    const k = Math.floor((2 * a / us + b) * u + lam + 0.43);
    if (us >= 0.07 && v <= vr) {
      return k;
    }
    if (k < 0 || (us < 0.013 && v > us)) {
      continue;
    }
    if (
      Math.log(v) + Math.log(invalpha) - Math.log(a / (us * us) + b) <=
      -lam + k * loglam - logGamma(k + 1)
    ) {
      return k;
    }
  }
}

/**
 * Natural log of the gamma function via the Lanczos approximation (g=5, N=6 coefficients), reproduced from
 * Press, Teukolsky, Vetterling & Flannery, "Numerical Recipes in C," 2nd ed. (1992), §6.1, function
 * `gammln`. Used only for integer arguments here (`logGamma(k + 1) = log(k!)`, k a nonnegative integer
 * from `poissonPtrs`), where its relative error is far below anything the Poisson acceptance test needs
 * (Numerical Recipes cites < 2e-10 for x > 0 over this coefficient set).
 */
const LANCZOS_COEF = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
  -0.5395239384953e-5,
];

function logGamma(xx: number): number {
  let y = xx;
  const x = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += LANCZOS_COEF[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
