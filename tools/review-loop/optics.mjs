// Independent optics for the 10/10/2026 correctness review loop. Deliberately shares no code with src/engine:
// a y-nu paraxial trace written from Smith, "Modern Optical Engineering" (4th ed., ch. 2), and a real ray
// tracer that intersects each surface by bisection on F(t) = z(t) - sag(h(t)) (not the engine's closed-form
// sphere plus Newton) and takes the normal from a central finite difference of the sag (not the engine's
// analytic slope). Surfaces come from the live page as plain data: { z, c, k, a[], sd, kind, n } where n is the
// index after the surface at the ray's wavelength (read from the page's own glass model, which the lens tests
// already check against the catalog).

/** Even-asphere sag, standard form z = c h^2 / (1 + sqrt(1 - (1+k) c^2 h^2)) + sum A_{2i+4} h^{2i+4}. */
export function sagOf(s, h) {
  const d = 1 - (1 + s.k) * s.c * s.c * h * h;
  let z = d > 0 ? (s.c * h * h) / (1 + Math.sqrt(d)) : (s.c ? 1 / s.c : 0);
  (s.a || []).forEach((A, j) => { z += A * h ** (4 + 2 * j); });
  return z;
}

/** Paraxial y-nu trace through `surfs` starting with height y0 and slope u0 in object space, from the first
 *  surface's vertex plane. Optional `doePower[i]` (1/mm) adds a thin diffractive power at surface i. Returns
 *  the heights at every surface, the final slope and the last-surface height. */
export function paraxTrace(surfs, y0, u0, doePower = []) {
  let y = y0, u = u0, n = 1;
  const ys = [];
  for (let i = 0; i < surfs.length; i++) {
    const s = surfs[i];
    if (i > 0) y += u * (s.z - surfs[i - 1].z);
    ys.push(y);
    if (s.kind === 'image') break;
    const n2 = s.n;
    const phi = (n2 - n) * s.c + (doePower[i] || 0);
    u = (n * u - y * phi) / n2;
    n = n2;
  }
  return { ys, u, y };
}

/** EFL and the rear focal point z from a ray parallel to the axis. */
export function eflOf(surfs, doePower) {
  const refr = surfs.filter((s) => s.kind !== 'image');
  const t = paraxTrace(refr, 1, 0, doePower);
  const last = refr[refr.length - 1];
  return { efl: -1 / t.u, F2: last.z - t.ys[t.ys.length - 1] / t.u };
}

/** Image-space working f-number for an on-axis object at z = objectZ (null = infinity) with the stop surface
 *  (index `stopIdx`) filled to `stopR`: the paraxial marginal ray's image-space slope u', N_w = 1 / (2 |u'|)
 *  (the paraxial form of 1 / (2 sin U'), Smith ch. 6). Independent of any pupil-magnification formula. */
export function workingFno(surfs, stopIdx, stopR, objectZ, doePower) {
  const refr = surfs.filter((s) => s.kind !== 'image');
  // unit-slope trial ray from the object point (or unit-height parallel ray), then scale to the stop edge
  const z0 = refr[0].z;
  const trial = objectZ === null ? paraxTrace(refr, 1, 0, doePower) : paraxTrace(refr, 1e-3 * (z0 - objectZ), 1e-3, doePower);
  const scale = stopR / Math.abs(trial.ys[stopIdx]);
  return 1 / (2 * Math.abs(trial.u * scale));
}

/** The stop radius that gives infinity f-number N: a parallel ray at height EFL/(2N) meets the stop at y_stop. */
export function stopRadiusForFno(surfs, stopIdx, N, doePower) {
  const refr = surfs.filter((s) => s.kind !== 'image');
  const { efl } = eflOf(surfs, doePower);
  const t = paraxTrace(refr, efl / (2 * N), 0, doePower);
  return Math.abs(t.ys[stopIdx]);
}

/** Paraxial image z of an object point at objectZ (on axis). */
export function imageZ(surfs, objectZ, doePower) {
  const refr = surfs.filter((s) => s.kind !== 'image');
  const z0 = refr[0].z;
  const t = paraxTrace(refr, 1e-3 * (z0 - objectZ), 1e-3, doePower);
  const last = refr[refr.length - 1];
  return last.z - t.ys[t.ys.length - 1] / t.u;
}

/** Paraxial geometric blur diameter on the sensor (z = sensorZ) of an on-axis point at objectZ with the stop
 *  filled to stopR: the marginal ray's height where it crosses the sensor plane, doubled. */
export function paraxBlurDiameter(surfs, stopIdx, stopR, objectZ, sensorZ, doePower) {
  const refr = surfs.filter((s) => s.kind !== 'image');
  const z0 = refr[0].z;
  const t = paraxTrace(refr, 1e-3 * (z0 - objectZ), 1e-3, doePower);
  const scale = stopR / Math.abs(t.ys[stopIdx]);
  const last = refr[refr.length - 1];
  const yLast = t.ys[t.ys.length - 1] * scale, u = t.u * scale;
  return 2 * Math.abs(yLast + u * (sensorZ - last.z));
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Real ray trace from origin o, unit direction d, in index 1, through every surface; returns the points (one per
 *  surface) or null with the failing index. Refraction by vector Snell (Born & Wolf 1.5). DOE surfaces are not
 *  supported here (callers skip DOE lenses for the real trace). */
export function realTrace(surfs, o, d) {
  let p = o.slice(), dir = norm(d), n = 1;
  const pts = [];
  for (let i = 0; i < surfs.length; i++) {
    const s = surfs[i];
    if (s.kind !== 'image' && s.kind !== 'stop' && !s.doe && s.c === 0 && !s.k && !(s.a && s.a.some((v) => v)) && s.n === n) {
      // Score loop r2: a flat surface with the same medium on both sides (a patent's virtual reference plane, z800's
      // surface 13, which the preceding convex surface's sag can put behind the ray) bends nothing: record where the
      // ray's line meets it, forward or not, and keep the ray as it is.
      const t = (s.z - p[2]) / dir[2];
      pts.push([p[0] + dir[0] * t, p[1] + dir[1] * t, s.z]);
      continue;
    }
    const F = (t) => { const x = p[0] + dir[0] * t, y = p[1] + dir[1] * t, z = p[2] + dir[2] * t; return z - (s.z + sagOf(s, Math.hypot(x, y))); };
    // bracket: start a little before the vertex plane, march forward
    let t0 = (s.z - p[2]) / dir[2] - 50, f0 = F(t0);
    if (t0 < 0) { t0 = 0; f0 = F(0); }
    let t1 = t0, f1 = f0, step = 0.5, found = false;
    for (let k = 0; k < 4000; k++) { t1 = t0 + step; f1 = F(t1); if (Math.sign(f1) !== Math.sign(f0)) { found = true; break; } t0 = t1; f0 = f1; }
    if (!found) return { pts, failed: i };
    for (let k = 0; k < 200; k++) { const tm = (t0 + t1) / 2, fm = F(tm); if (Math.sign(fm) === Math.sign(f0)) { t0 = tm; f0 = fm; } else { t1 = tm; } }
    const t = (t0 + t1) / 2;
    p = [p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t];
    pts.push(p);
    if (s.kind === 'image') break;
    const h = Math.hypot(p[0], p[1]), e = 1e-6;
    const dzdh = (sagOf(s, h + e) - sagOf(s, Math.max(0, h - e))) / (h + e - Math.max(0, h - e));
    const nrm = h > 0 ? norm([-dzdh * p[0] / h, -dzdh * p[1] / h, 1]) : [0, 0, 1];
    const n2 = s.n;
    if (s.doe && s.doe.coeffs && s.nm) {
      // Score loop r2: a diffractive surface, by the local grating equation written intrinsically on the curved
      // substrate (not the engine's tangent-plane projection): along the meridian, arc length s has
      // ds = sqrt(1 + (dz/dh)^2) dh, so the phase gradient along the surface is dphi/dh / sqrt(1 + (dz/dh)^2), in the
      // direction of the meridional tangent. Then n2 sin(out) = n1 sin(in) + m lambda / (2 pi) dphi/ds, as a vector.
      const N = dot(dir, nrm) > 0 ? nrm.map((v) => -v) : nrm;
      const ci = -dot(dir, N);
      const dt = [dir[0] + ci * N[0], dir[1] + ci * N[1], dir[2] + ci * N[2]]; // tangential part of the unit direction
      let K = [0, 0, 0];
      if (h > 1e-12) {
        const lam0 = s.doe.lambda0Nm / 1e6;
        let dphidh = 0;
        s.doe.coeffs.forEach((c, i) => { const pw = 2 * (i + 1); dphidh += (2 * Math.PI / lam0) * c * pw * Math.pow(h, pw - 1); });
        const t = norm([p[0] / h, p[1] / h, dzdh]);
        const dphids = dphidh / Math.sqrt(1 + dzdh * dzdh);
        K = t.map((v) => v * dphids);
      }
      const kick = s.doe.order * (s.nm / 1e6) / (2 * Math.PI);
      const out = [0, 1, 2].map((j) => (n * dt[j] + kick * K[j]) / n2);
      const st2 = dot(out, out);
      if (st2 > 1) return { pts, failed: i };
      const ct = Math.sqrt(1 - st2);
      dir = norm([out[0] - ct * N[0], out[1] - ct * N[1], out[2] - ct * N[2]]);
      n = n2;
      continue;
    }
    if (n2 !== n) {
      // N faces the incoming ray; cos i = -d.N > 0; t = mu d + (mu cos i - cos t) N
      const N = dot(dir, nrm) > 0 ? nrm.map((v) => -v) : nrm;
      const mu = n / n2, ci = -dot(dir, N);
      const k2 = 1 - mu * mu * (1 - ci * ci);
      if (k2 < 0) return { pts, failed: i };
      const g = mu * ci - Math.sqrt(k2);
      dir = norm([mu * dir[0] + g * N[0], mu * dir[1] + g * N[1], mu * dir[2] + g * N[2]]);
    }
    n = n2;
  }
  return { pts, failed: null };
}
