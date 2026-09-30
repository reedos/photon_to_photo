// Golden and edge-case tests for surface.ts. Expected values are derived independently of the implementation
// under test (closed-form geometry, a separately-coded quadratic, or a textbook identity), per the workstream's
// accuracy discipline (see the module header comments for citations).

import type { Ray, TraceSurface } from './types';
import { dot3, intersect, length3, normalAt, normalize3, reflect, refract, sag, sagSlope, sub3 } from './surface';

const deg = Math.PI / 180;

function sphereSurf(c: number, k = 0, sd = 20, z = 0): TraceSurface {
  return { z, c, k, a: [], sd, kind: 'refract', mediumAfter: 'glass' };
}

// ---- sag ----------------------------------------------------------------------------------------------------

describe('sag', () => {
  it('matches the textbook sphere sag z = R - sqrt(R^2 - h^2) for a well-conditioned radius', () => {
    const R = 25;
    const s = sphereSurf(1 / R);
    for (const h of [0, 1, 5, 10, 15]) {
      const expected = R - Math.sqrt(R * R - h * h); // independent, the elementary circle equation
      expect(sag(s, h)).toBeCloseTo(expected, 10);
    }
  });

  it('matches the same sphere identity for negative curvature (center on the -z side)', () => {
    const R = -30;
    const s = sphereSurf(1 / R);
    for (const h of [0, 4, 12, 20]) {
      const expected = R - Math.sign(R) * Math.sqrt(R * R - h * h);
      // R<0: z = R + sqrt(R^2-h^2) is the branch through the vertex; verify against that explicitly.
      expect(sag(s, h)).toBeCloseTo(R + Math.sqrt(R * R - h * h), 10);
      void expected;
    }
  });

  it('is the exact identity c*h^2/2 for a parabola (k=-1) at every radius, not just paraxially', () => {
    // For k=-1, disc = 1 - 0*c^2h^2 = 1 exactly, so z = c h^2 / (1+1) = c h^2 / 2 for ALL h -- an exact, not just
    // small-h, closed form. This is the "parabolic mirror/asphere sag check" golden test.
    for (const c of [0.01, 0.1, -0.05]) {
      const s = sphereSurf(c, -1);
      for (const h of [0, 1, 10, 50, 200]) {
        expect(sag(s, h)).toBeCloseTo((c * h * h) / 2, 12);
      }
    }
  });

  it('stays finite and near zero for a near-flat surface (small c*h): the numerically stable c-form', () => {
    // A surface this flat would make the naive z = R - sqrt(R^2 - h^2) form subtract two nearly-equal ~1e8-scale
    // numbers -- demonstrate that surface.ts's c-form does not have that problem.
    const c = 1e-9; // R = 1e9 mm
    const s = sphereSurf(c);
    for (const h of [0, 1, 10, 100]) {
      const z = sag(s, h);
      expect(Number.isFinite(z)).toBe(true);
      // Leading-order Taylor expansion of the exact sphere sag for c*h << 1: z ~= c h^2/2 (1 + O((ch)^2)).
      expect(z).toBeCloseTo((c * h * h) / 2, 12);
    }
  });

  it('sums even-asphere terms A4, A6 on top of the base conic', () => {
    const s: TraceSurface = { z: 0, c: 0.02, k: -0.5, a: [1e-6, -2e-9], sd: 20, kind: 'refract', mediumAfter: 'glass' };
    const h = 8;
    const disc = 1 - (1 + s.k) * s.c * s.c * h * h;
    const conic = (s.c * h * h) / (1 + Math.sqrt(disc)); // hand-evaluated base term
    const expected = conic + 1e-6 * Math.pow(h, 4) + -2e-9 * Math.pow(h, 6);
    expect(sag(s, h)).toBeCloseTo(expected, 12);
  });

  it('is 0 at the vertex for any conic/asphere', () => {
    const s: TraceSurface = { z: 0, c: 0.03, k: 1.5, a: [3e-7], sd: 10, kind: 'refract', mediumAfter: 'glass' };
    expect(sag(s, 0)).toBe(0);
  });
});

describe('Finding P1 -- n50 surface 11 asphere: kappa, not this engine\'s k, is the patent\'s own convention', () => {
  it('sag at 10mm and 15mm matches the patent equation (JP2011175123A [0038], eq. (a)) evaluated independently, ' +
    'with kappa = 0 mapped to k = kappa - 1 = -1 (NOT k = 0)',
    () => {
      // n50.json, surface 11 (data/lenses/n50.json): r=-125.0, A4=-3.6998e-6, A6=-1.7387e-9, patent kappa=0.
      const r = -125.0;
      const A4 = -3.6998e-6;
      const A6 = -1.7387e-9;
      const kappa = 0;

      // Independent derivation straight from the patent's own equation (a), NOT surface.ts's sag(): base term
      // (y^2/r) / (1 + sqrt(1 - kappa*y^2/r^2)), plus the even-asphere terms.
      function patentSag(h: number): number {
        const base = (h * h) / r / (1 + Math.sqrt(1 - (kappa * h * h) / (r * r)));
        return base + A4 * Math.pow(h, 4) + A6 * Math.pow(h, 6);
      }

      const expected10 = -0.438736700000;
      const expected15 = -1.107107254688;
      expect(patentSag(10)).toBeCloseTo(expected10, 9);
      expect(patentSag(15)).toBeCloseTo(expected15, 9);

      // The engine's own convention is (1+k), so the patent's kappa=0 must be stored as k = kappa - 1 = -1
      // (data/lenses/n50.json, surface 11) for surface.ts's sag() to reproduce the same shape.
      const s: TraceSurface = { z: 0, c: 1 / r, k: kappa - 1, a: [A4, A6], sd: 16.42, kind: 'refract', mediumAfter: 'glass' };
      expect(sag(s, 10)).toBeCloseTo(expected10, 9);
      expect(sag(s, 15)).toBeCloseTo(expected15, 9);

      // The wrong (previously shipped) convention, k=0, must NOT reproduce the patent's own sag -- this is what
      // the astra-review reproduction (.local/astra-review/repro/patent-n50-conic.mjs) demonstrated.
      const wrong: TraceSurface = { ...s, k: 0 };
      expect(sag(wrong, 10)).not.toBeCloseTo(expected10, 5);
    },
  );
});

describe('sagSlope', () => {
  it('matches a central-difference numerical derivative of sag() for a conic + asphere surface', () => {
    const s: TraceSurface = { z: 0, c: 0.04, k: -2.2, a: [5e-7, 1e-10], sd: 10, kind: 'refract', mediumAfter: 'glass' };
    const eps = 1e-5;
    for (const h of [0.5, 2, 6, 9]) {
      const numeric = (sag(s, h + eps) - sag(s, h - eps)) / (2 * eps);
      expect(sagSlope(s, h)).toBeCloseTo(numeric, 5);
    }
  });

  it('is 0 at the vertex', () => {
    const s: TraceSurface = { z: 0, c: 0.05, k: 0, a: [], sd: 10, kind: 'refract', mediumAfter: 'glass' };
    expect(sagSlope(s, 0)).toBe(0);
  });
});

// ---- normalAt -------------------------------------------------------------------------------------------------

describe('normalAt', () => {
  it('is [0,0,1] on-axis', () => {
    const s = sphereSurf(1 / 40);
    expect(normalAt(s, 0, 0)).toEqual([0, 0, 1]);
  });

  it('is radial (parallel to point-minus-center) everywhere on a sphere, for either sign of curvature', () => {
    for (const R of [30, -18]) {
      const s = sphereSurf(1 / R, 0, 25, 7); // vertex offset from 0 to make sure z isn't assumed 0
      const center: [number, number, number] = [0, 0, s.z + R];
      for (const [x, y] of [
        [5, 0],
        [0, 8],
        [6, 6],
      ] as const) {
        const z = s.z + sag(s, Math.hypot(x, y));
        const point: [number, number, number] = [x, y, z];
        const radial = normalize3(sub3(point, center));
        const n = normalAt(s, x, y);
        // normalAt's sign convention is not specified beyond "consistent"; compare |dot| to 1.
        expect(Math.abs(dot3(n, radial))).toBeCloseTo(1, 9);
      }
    }
  });

  it('returns a unit vector', () => {
    const s: TraceSurface = { z: 0, c: 0.06, k: 3, a: [1e-6], sd: 8, kind: 'refract', mediumAfter: 'glass' };
    const n = normalAt(s, 3, 4);
    expect(length3(n)).toBeCloseTo(1, 12);
  });
});

// ---- intersect --------------------------------------------------------------------------------------------

describe('intersect: flat surfaces', () => {
  it('hits a tilted ray at the hand-computed point', () => {
    const s: TraceSurface = { z: 10, c: 0, k: 0, a: [], sd: 20, kind: 'refract', mediumAfter: 'glass' };
    const d = normalize3([0.2, -0.1, 1]);
    const ray: Ray = { o: [1, 2, 0], d, nm: 587.5618 };
    const t = intersect(s, ray)!;
    const expectedT = (10 - 0) / d[2]; // z = 10 plane, independent one-line solve
    expect(t).toBeCloseTo(expectedT, 10);
  });

  it('misses a plane it runs parallel to', () => {
    const s: TraceSurface = { z: 10, c: 0, k: 0, a: [], sd: 20, kind: 'refract', mediumAfter: 'glass' };
    const ray: Ray = { o: [0, 0, 0], d: [1, 0, 0], nm: 587.5618 };
    expect(intersect(s, ray)).toBeNull();
  });
});

describe('intersect: spheres, closed form, either sign of curvature', () => {
  // Independent geometric fact used as the oracle: any ray starting AT the sphere's center hits the sphere at
  // t = +R and t = -R. Sequential semantics (surface.ts, lead correction 09/28/2026) take the crossing on the cap
  // that contains the vertex, whatever the sign of t. The vertex sits at center - R along z, so for a ray heading
  // +z the vertex-cap crossing is t = -R: backward for R = 12 (the forward crossing at t = +12 is on the far cap),
  // forward for R = -9.
  for (const R of [12, -9]) {
    it(`picks the vertex-cap root for R=${R} (t = -R)`, () => {
      const s = sphereSurf(1 / R, 0, Math.abs(R) * 0.8, 3);
      const center: [number, number, number] = [0, 0, s.z + R];
      const d = normalize3([0.15, -0.1, 1]);
      const ray: Ray = { o: center, d, nm: 587.5618 };

      const expectedT = -R;
      const expectedPoint: [number, number, number] = [
        center[0] + expectedT * d[0],
        center[1] + expectedT * d[1],
        center[2] + expectedT * d[2],
      ];

      const t = intersect(s, ray)!;
      expect(t).toBeCloseTo(expectedT, 9); // forward: the near-vs-far *heuristic* never even has to run here
      const got: [number, number, number] = [ray.o[0] + t * d[0], ray.o[1] + t * d[1], ray.o[2] + t * d[2]];
      expect(got[0]).toBeCloseTo(expectedPoint[0], 9);
      expect(got[1]).toBeCloseTo(expectedPoint[1], 9);
      expect(got[2]).toBeCloseTo(expectedPoint[2], 9);
    });
  }

  it('misses a sphere the ray does not reach', () => {
    const s = sphereSurf(1 / 10, 0, 9);
    const ray: Ray = { o: [50, 0, -100], d: [0, 0, 1], nm: 587.5618 };
    expect(intersect(s, ray)).toBeNull();
  });

  it('an on-axis ray hits exactly the vertex', () => {
    const s = sphereSurf(1 / 15, 0, 10, 4);
    const ray: Ray = { o: [0, 0, -20], d: [0, 0, 1], nm: 587.5618 };
    const t = intersect(s, ray)!;
    expect(ray.o[2] + t).toBeCloseTo(4, 10);
  });
});

describe('intersect: conics and aspheres, Newton from the sphere guess', () => {
  // Independent oracle: the general implicit conic-of-revolution equation (1+k)*c*z^2 - 2z + c*(x^2+y^2) = 0,
  // derivable from the same sag formula (see surface.ts's header) but solved here as a direct quadratic in the
  // ray parameter t, a different code path from surface.ts's Newton iteration.
  function conicQuadraticT(s: TraceSurface, ray: Ray): number {
    const K = (1 + s.k) * s.c;
    const [ox, oy, ozAbs] = ray.o;
    const oz = ozAbs - s.z; // the implicit equation is in LOCAL z (relative to the vertex plane), not absolute z
    const [dx, dy, dz] = ray.d;
    const A = K * dz * dz + s.c * (dx * dx + dy * dy);
    const B = 2 * K * oz * dz - 2 * dz + 2 * s.c * (ox * dx + oy * dy);
    const C = K * oz * oz - 2 * oz + s.c * (ox * ox + oy * oy);
    const disc = B * B - 4 * A * C;
    const sq = Math.sqrt(disc);
    const t1 = (-B - sq) / (2 * A);
    const t2 = (-B + sq) / (2 * A);
    const t0 = (s.z - ozAbs) / dz;
    return Math.abs(t1 - t0) <= Math.abs(t2 - t0) ? t1 : t2;
  }

  it('matches the independent conic quadratic for an ellipse (k=1.5, no asphere terms)', () => {
    const s: TraceSurface = { z: 6, c: 1 / 22, k: 1.5, a: [], sd: 15, kind: 'refract', mediumAfter: 'glass' };
    const ray: Ray = { o: [2, -1, -30], d: normalize3([0.08, 0.05, 1]), nm: 587.5618 };
    const expectedT = conicQuadraticT(s, ray);
    const t = intersect(s, ray)!;
    expect(t).toBeCloseTo(expectedT, 6);
  });

  it('converges on an asphere (adds A4/A6 on top of the conic) with a near-zero residual', () => {
    const s: TraceSurface = { z: 0, c: 1 / 40, k: -0.8, a: [2e-6, -4e-9], sd: 18, kind: 'refract', mediumAfter: 'glass' };
    const ray: Ray = { o: [3, 2, -25], d: normalize3([0.05, -0.03, 1]), nm: 587.5618 };
    const t = intersect(s, ray)!;
    const x = ray.o[0] + t * ray.d[0];
    const y = ray.o[1] + t * ray.d[1];
    const z = ray.o[2] + t * ray.d[2];
    const residual = z - (s.z + sag(s, Math.hypot(x, y)));
    expect(Math.abs(residual)).toBeLessThan(1e-8);
  });

  it('never returns NaN/non-finite garbage across a battery of pathological rays: null or a converged residual', () => {
    // The failure status this signature has is exactly "no value" (null); anything short of that (NaN, Infinity,
    // a t that doesn't actually satisfy the surface equation) would be worse than an honest failure. Sweep a set
    // of extreme cases -- grazing rays, a wildly oscillatory asphere, a bounded (disc-can-go-negative) conic
    // probed near and beyond its real extent -- and check every result is either null or genuinely converged.
    const cases: { s: TraceSurface; ray: Ray }[] = [
      {
        s: { z: 0, c: 1 / 5, k: 0.5, a: [], sd: 100, kind: 'refract', mediumAfter: 'glass' }, // bounded ellipse
        ray: { o: [500, 0, 0], d: [0, 0, 1], nm: 587.5618 },
      },
      {
        s: { z: 0, c: 1 / 5, k: 0.5, a: [], sd: 100, kind: 'refract', mediumAfter: 'glass' },
        ray: { o: [3.9, 0, -10], d: normalize3([0.001, 0, 1]), nm: 587.5618 }, // grazes the real half-extent
      },
      {
        s: { z: 0, c: 1 / 50, k: 0, a: [1e-2, -1e-2], sd: 40, kind: 'refract', mediumAfter: 'glass' }, // huge, oscillatory asphere terms
        ray: { o: [8, 3, -30], d: normalize3([0.02, 0.01, 1]), nm: 587.5618 },
      },
      {
        s: { z: 0, c: 1 / 50, k: 0, a: [1e-2, -1e-2], sd: 40, kind: 'refract', mediumAfter: 'glass' },
        ray: { o: [0, 0, -30], d: normalize3([0.9999, 0, 0.0141]), nm: 587.5618 }, // near-grazing incidence
      },
    ];
    for (const { s, ray } of cases) {
      const t = intersect(s, ray);
      if (t === null) {
        expect(t).toBeNull(); // the documented failure status
        continue;
      }
      expect(Number.isFinite(t)).toBe(true);
      const x = ray.o[0] + t * ray.d[0];
      const y = ray.o[1] + t * ray.d[1];
      const z = ray.o[2] + t * ray.d[2];
      const residual = z - (s.z + sag(s, Math.hypot(x, y)));
      expect(Math.abs(residual)).toBeLessThan(1e-6); // if it claims success, it must actually be on the surface
    }
  });
});

// ---- refract ---------------------------------------------------------------------------------------------------

describe('refract: Snell at known angles', () => {
  it('air (n=1) into glass (n=1.5) at 30 deg matches the scalar Snell formula', () => {
    const thetaI = 30 * deg;
    const d = normalize3([Math.sin(thetaI), 0, Math.cos(thetaI)]);
    const n: [number, number, number] = [0, 0, 1];
    const out = refract(d, n, 1, 1.5)!;
    const thetaT = Math.acos(out[2]); // out is unit and its x,z define the angle from the axis (y=0 plane)
    const expectedThetaT = Math.asin(Math.sin(thetaI) / 1.5); // independent scalar Snell's law
    expect(thetaT).toBeCloseTo(expectedThetaT, 10);
  });

  it('is independent of which normal sign the caller passes', () => {
    const d = normalize3([0.3, 0.1, 1]);
    const n: [number, number, number] = [0, 0, 1];
    const a = refract(d, n, 1, 1.5)!;
    const b = refract(d, [-n[0], -n[1], -n[2]], 1, 1.5)!;
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });

  it('does not bend at normal incidence', () => {
    const out = refract([0, 0, 1], [0, 0, 1], 1, 1.7)!;
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(1, 12);
  });

  it('leaves the direction unchanged when n1 === n2', () => {
    const d = normalize3([0.4, -0.2, 1]);
    const out = refract(d, [0, 0, 1], 1.5, 1.5)!;
    expect(out[0]).toBeCloseTo(d[0], 12);
    expect(out[1]).toBeCloseTo(d[1], 12);
    expect(out[2]).toBeCloseTo(d[2], 12);
  });
});

describe('refract: total internal reflection at the critical angle', () => {
  // Critical angle for glass (1.5) -> air (1): asin(1/1.5) = 41.8103... deg.
  const thetaC = Math.asin(1 / 1.5);

  it('refracts just below the critical angle', () => {
    const thetaI = thetaC - 2 * deg;
    const d = normalize3([Math.sin(thetaI), 0, Math.cos(thetaI)]);
    const out = refract(d, [0, 0, 1], 1.5, 1);
    expect(out).not.toBeNull();
    const expectedThetaT = Math.asin(1.5 * Math.sin(thetaI));
    expect(Math.acos(out![2])).toBeCloseTo(expectedThetaT, 8);
  });

  it('totally internally reflects just above the critical angle', () => {
    const thetaI = thetaC + 2 * deg;
    const d = normalize3([Math.sin(thetaI), 0, Math.cos(thetaI)]);
    const out = refract(d, [0, 0, 1], 1.5, 1);
    expect(out).toBeNull();
  });

  it('deep beyond the critical angle (grazing) is still TIR, not NaN', () => {
    const thetaI = 89 * deg;
    const d = normalize3([Math.sin(thetaI), 0, Math.cos(thetaI)]);
    expect(refract(d, [0, 0, 1], 1.5, 1)).toBeNull();
  });
});

// ---- reflect ---------------------------------------------------------------------------------------------------

describe('reflect', () => {
  it('reverses a normal-incidence ray', () => {
    const out = reflect([0, 0, 1], [0, 0, 1]);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(-1, 12);
  });

  it('obeys the law of reflection (angle in = angle out) at 40 deg', () => {
    const thetaI = 40 * deg;
    const d = normalize3([Math.sin(thetaI), 0, Math.cos(thetaI)]);
    const n: [number, number, number] = [0, 0, 1];
    const out = reflect(d, n);
    const angleIn = Math.acos(dot3([-d[0], -d[1], -d[2]], n));
    const angleOut = Math.acos(dot3(out, n));
    expect(angleOut).toBeCloseTo(angleIn, 10);
    // and it stays in the plane of incidence (y stays 0)
    expect(out[1]).toBeCloseTo(0, 12);
  });

  it('is independent of which normal sign the caller passes', () => {
    const d = normalize3([0.2, 0.3, 1]);
    const a = reflect(d, [0, 0, 1]);
    const b = reflect(d, [0, 0, -1]);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });
});
