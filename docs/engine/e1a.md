# E1a: optics tracing (`spectrum.ts`, `surface.ts`, `trace.ts`)

Workstream E1a builds the sequential geometric-optics core of the physics engine: surface geometry and ray
intersection (`surface.ts`), sequential tracing with aiming/fans/pupil sampling (`trace.ts`), and wavelength
binning plus a spectral-to-color stub (`spectrum.ts`). Pure TypeScript, no Three.js, no DOM, allocates only what
the shared `Vec3`/`Ray`/`RayPath` tuple types in `types.ts` require (see "Known limits" below).

Conventions follow `types.ts`'s header: lengths in mm, wavelengths in nm, angles in radians; z is the optical
axis, light travels toward +z. Curvature sign follows `lens-types.ts`: `c = 1/r`, positive when the center of
curvature is to the right (+z, image side) of the vertex.

## API

### `spectrum.ts`

- `FRAUNHOFER` — the standard reference wavelengths (`d`, `F`, `C`, `e`, `g`, `Fp` for F', `Cp` for C'), nm.
- `bins(n, lo, hi) -> Bins` — n evenly spaced bins over `[lo, hi]` nm.
- `VISIBLE_LO_NM` / `VISIBLE_HI_NM` — 380/780 nm, the range `BINS16`/`BINS24` cover.
- `BINS16`, `BINS24: Bins` — 16- and 24-bin spectra over the visible range.
- `wavelengthColor(nm) -> WavelengthColor` — `{ xyz, linear, srgb }` for a monochromatic source at `nm`.

### `surface.ts`

- `sag(s, h) -> number` — local surface sag at radial height h, mm.
- `sagSlope(s, h) -> number` — dz/dh at h (used by `normalAt` and `intersect`'s Newton step; not in ENGINE.md's
  list but small and reusable, e.g. by E1b's paraxial.ts if useful).
- `normalAt(s, x, y) -> Vec3` — unit surface normal at a point known to lie on the surface.
- `intersect(s, ray) -> number | null` — ray parameter t at the surface, or null on failure: a geometric miss, a
  non-converged Newton iteration for a conic/asphere, or a real crossing that lies behind the ray (`t` not
  strictly forward — see "Forward-only intersections" below).
- `refract(d, n, n1, n2) -> Vec3 | null` — vector Snell's law; null on total internal reflection.
- `reflect(d, n) -> Vec3` — mirror reflection.
- `dot3, add3, sub3, scale3, length3, normalize3` — small Vec3 helpers, shared with `trace.ts`.

### `trace.ts`

- `traceRay(sys, ray, opts?) -> RayPath` — sequential trace through every surface; `opts.ignoreVignetting` skips
  the sd/iris tests (used internally by `aimRay`'s real-ray-aiming search).
- `Field` — `{ kind: 'angle', ax, ay }` (object at infinity) or `{ kind: 'object', o }` (finite object point).
- `aimRay(sys, ep, field, px, py, nm, opts?) -> Ray` — builds a ray through normalized pupil coordinates on the
  paraxial entrance pupil `ep`; `opts.realAim` iterates so the ray actually crosses the stop at the equivalent
  normalized stop coordinates (needed at wide field angles — see "Real-ray aiming" below).
- `fan(sys, ep, field, n, nms, axis, aimOpts?) -> RayPath[]` — n rays evenly spaced across pupil coordinate
  `[-1, 1]` along `axis`, for each wavelength in `nms` (wavelength-outermost order).
- `PupilGrid` — `{ kind: 'square', n }`, `{ kind: 'hexapolar', rings }`, or `{ kind: 'fibonacci', n }`.
- `spot(sys, ep, field, grid, nms, aimOpts?) -> SpotResult[]` — one `SpotResult` per wavelength: every pupil
  sample's `RayPath` plus `centroid`/`rms`/`geometricRadius` over the samples that reached the image plane 'ok'.

`TraceOptions`, `AimOptions`, `Field`, `PupilGrid`, `SpotSample`, `SpotResult` are declared locally in `trace.ts`
(see "Deviations from ENGINE.md" below) since `types.ts` does not yet define a field-point or pupil-pattern type.

## Derivations and citations

- **Sag / normal (conic + even asphere).** The "c-form" `z = c h^2 / (1 + sqrt(1 - (1+k) c^2 h^2)) + sum A_2i
  h^2i`, and its radial derivative `dz/dh = c h / sqrt(1 - (1+k) c^2 h^2) + sum 2i A_2i h^(2i-1)`, follow Spencer,
  G. H., and Murty, M. V. R. K., "General Ray-Tracing Procedure," *J. Opt. Soc. Am.* 52(6), 672-678 (1962) — the
  standard sequential-ray-tracing reference (also in Warren J. Smith, *Modern Optical Engineering*, 4th ed., ch.
  16). The derivative is re-derived from the c-form in a comment in `surface.ts` (substituting
  `(1+k)c^2h^2 = 1-u^2 = (1-u)(1+u)` collapses the `(1+u)^2` denominator to give `dz/dh = ch/u`). The c-form is
  chosen specifically because it stays numerically stable as `c -> 0` (a near-flat surface): the equivalent
  `z = R - sqrt(R^2 - (1+k)h^2)` form needs `R = 1/c` (undefined at `c=0`) and subtracts two nearly-equal large
  numbers for a large but finite R, losing precision. `surface.test.ts`'s "near-flat surfaces" tests check this
  directly (`c = 1e-9`, no NaN/blow-up).
- **Sphere/ray intersection.** Closed-form quadratic on the base sphere (center `(0,0,s.z+1/c)`, radius `|1/c|`).
  Only a FORWARD root (`t > T_MIN`, `T_MIN = 1e-9` mm — see "Forward-only intersections" below) is ever a valid
  hit. If neither root is forward, there is no hit (`null`). If exactly one is forward, that's the unambiguous
  answer. If both are forward, either can still be the physically correct (near) one depending on curvature sign
  and the ray's starting point, so — rather than a sign-of-c case split — `sphereIntersect` picks whichever
  lands nearest the surface's own vertex-plane crossing: sign-of-curvature-agnostic by construction, exact for a
  flat surface, and (per a 500,000-case randomized search over realistic lens-scale geometry, `e1a.verify.test.ts`)
  reliably correct whenever both roots are genuinely forward.
- **Conic/asphere intersection.** Newton's method (`NEWTON_MAX_ITER = 50`, `NEWTON_TOL = 1e-9` mm on both the
  step and the residual) on `f(t) = z(t) - (s.z + sag(h(t)))`, started from the base sphere's closed-form
  intersection (falling back to the vertex-plane crossing if the base sphere itself is missed) — both of which
  are themselves forward-filtered, so Newton only ever starts from a guess already ahead of the ray. Returning
  `null` when Newton does not converge within `NEWTON_MAX_ITER`, or converges to a `t` that isn't forward, *is*
  this signature's failure status (there is no separate status channel in `number | null`).
- **Sequential intersections (superseded the forward-only rule; lead, 09/28/2026).** Every listed surface is met
  in order on the cap that contains its vertex, whatever the sign of `t`: zero and negative gaps are ordinary in
  patent prescriptions (p50 puts a flare-cut stop at t = 0 after a lens surface) and Zemax/CODE V trace them as
  virtual propagation. A miss is a line that never meets the base sphere, or meets only its far cap. The earlier
  forward-only rule (from the adversarial review) made p50's axial ray miss that stop; `e1a.verify.test.ts` now
  pins the sequential behavior. Separately, `aimRay` starts rays from a field at infinity on a plane in front of the
  first surface (`entryPlaneZ`), since real lenses put the entrance pupil inside the element stack.
  The paragraphs below that mention forward-only behavior describe the superseded rule.
- **Vector Snell's law / TIR.** Standard vector form (e.g. the Wikipedia "Snell's law" vector-form section, or
  Glassner (ed.), *An Introduction to Ray Tracing*, Academic Press 1989, sec. 2): with the normal resolved to
  oppose the incident ray (`cosI = -dot(n,d) > 0`, resolved internally so either input orientation works) and
  `eta = n1/n2`, `sin2T = eta^2 (1 - cosI^2)`; `sin2T > 1` is total internal reflection; otherwise `cosT =
  sqrt(1-sin2T)` and `refracted = eta*d + (eta*cosI - cosT)*n`.
- **N-BK7 Sellmeier coefficients** (`fixtures/e1a-glass.ts`): SCHOTT Optical Glass Datasheet N-BK7
  (media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5), cross-checked against
  refractiveindex.info's SCHOTT collection; `fixtures/e1a-glass.test.ts` reproduces the catalog's own stated nd
  (4 d.p.) and Abbe number vd (1 d.p.) from the Sellmeier formula as a sanity check.
- **`wavelengthColor`.** The multi-lobe piecewise-Gaussian fit to the CIE 1931 2-degree standard observer from
  Wyman, C., Sloan, P.-P., and Shirley, P., "Simple Analytic Approximations to the CIE XYZ Color Matching
  Functions," *JCGT* 2(2), 1-11 (2013) — coefficients and the exact `t = (lambda-mu) * sigma` form (sigma
  multiplies; these are inverse widths, nm^-1, not widths) verified against the published PDF's Table 1 and
  Listing 1. XYZ -> linear sRGB uses the standard IEC 61966-2-1 / D65 matrix. A monochromatic source's raw CMF
  values routinely fall outside the sRGB gamut (real primaries cannot mix a fully saturated spectral color);
  gamut-mapped by clipping negative components to 0 (the simplest documented strategy — see the comment above
  `gamutClip` in `spectrum.ts` for the alternative and why it's deferred). `linear` is intentionally left
  unclamped above 1 so relative brightness across wavelengths (violet/deep-red dim, 555 nm bright) survives for a
  caller that wants to scale/tone-map a whole spectrum; only `srgb` is clamped to `[0,1]` and gamma-encoded.
  ENGINE.md notes this is a stub the color agent's future data table replaces — the signature is meant to survive
  that swap.
- **Fraunhofer line wavelengths**: SCHOTT Technical Information TIE-29, "Refractive Index and Dispersion," Table
  1 (media.schott.com); reproduced identically across catalogs and by Zemax/CODE V.
- **Real-ray aiming.** `aimRay`'s `realAim` search is a 2D Newton iteration (finite-difference Jacobian, h=1e-4
  mm, ≤20 iterations, 1e-9 mm convergence) on the map from an aim point on the paraxial entrance-pupil plane to
  where the resulting ray crosses the stop surface, undamped. It is only as robust as that map is locally
  well-behaved (monotonic-ish, no fold) between the paraxial starting guess and the true root — see "Known
  limits."
- **Hexapolar pupil sampling**: the standard fast-converging spot-diagram pattern used by lens-design tools (e.g.
  Zemax's "Hexapolar"/"Ring" ray-fan patterns): 1 center point plus, for ring `i = 1..rings`, `6i` points evenly
  spaced in angle at radius `i/rings`.
- **Fibonacci pupil sampling**: Vogel, H., "A better way to construct the sunflower head," *Mathematical
  Biosciences* 44(3-4), 179-189 (1979): `r_i = sqrt((i+0.5)/n)`, `theta_i = i * goldenAngle` (`goldenAngle =
  pi*(3-sqrt(5))`). The `sqrt` radial spacing is exactly what makes the area element `r dr` uniform in `i`; see
  the "Fibonacci pupil sampling has uniform density" test in `trace.test.ts` (an equal-area-bin count check, using
  an "identity" system — a single image plane placed exactly at the entrance pupil — so a sample's landing point
  is its raw `(px, py)`, isolating the pattern from any lens refraction).

## Golden tests (summary; see the test files for the exact numbers and citations)

- `surface.test.ts`: sphere sag vs. the elementary circle equation (either curvature sign); parabola (k=-1) sag is
  the *exact* identity `c h^2/2` at every radius, not just paraxially; near-flat surfaces don't blow up; sagSlope
  matches a numerical derivative of sag; sphere intersection picks the forward root for either curvature sign
  (oracle: any ray from the sphere's own center hits it at t=±R, and exactly one sign is ever forward, so the
  vertex-plane heuristic doesn't even need to run); conic intersection matches an independently derived closed-form
  quadratic on the general implicit conic equation `(1+k)c z_local^2 - 2 z_local + c h^2 = 0` (a different code
  path from the Newton iteration under test); asphere intersection converges to a near-zero residual; a battery of
  pathological rays never returns NaN (only `null` or a genuinely converged, residual-checked `t`); Snell's law at
  a known angle matches the scalar formula; TIR just above/below the critical angle; reflection obeys the law of
  reflection; both `refract` and `reflect` are independent of which normal sign the caller passes.
  `e1a.verify.test.ts` adds the forward/causal checks above: a flat and a curved surface each reject a
  real-but-behind-the-ray crossing, and a two-surface `traceRay` reports `'missed'` (not a backward-z-stepping
  `'ok'`) for one.
- `trace.test.ts`: status coverage (ok/vignetted/iris/tir/missed, including that a blocked ray still records its
  hit point and that only 'ok' sets `dirOut`); a real (Snell's-law-exact), tiny-aperture trace of a plano-convex
  singlet and a symmetric biconvex lens matches the closed-form thick-lens EFL within 1e-6 relative (both derived
  independently in the test from the standard thick-lens equation); a positive singlet's marginal focus lands in
  front of (smaller z than) its paraxial focus, and monotonically so with aperture (undercorrected spherical
  aberration, the expected sign); a small-angle ray through a flat plate is axially displaced by the paraxial
  `t(1-1/n)` formula; `aimRay`'s `realAim` converges a 20 deg-field chief ray to the stop center within 1e-6 mm
  (and a companion test shows the *paraxial* guess alone misses by orders of magnitude more, motivating the
  option); `fan`'s wavelength-outermost ordering and count; `spot`'s three pupil patterns (point counts, weight
  sums, and — the dedicated test — Fibonacci's equal-area-bin uniformity); a tight-aperture element vignetting
  some pupil samples while still reporting every sample's path.
- `spectrum.test.ts`: Fraunhofer line values and violet-to-red ordering; `bins`/`BINS16`/`BINS24` shape and weight
  invariants (plus n=1 and a rejected non-positive/non-integer n); `wavelengthColor` reads green/red/blue-
  dominant at 550/650/460 nm, peaks in luminance near 555-560 nm, decays to ~0 (not NaN) far outside the visible
  range, and keeps `srgb` in `[0,1]` while `linear` is gamut-clipped but not brightness-clamped.

## Known limits

- **Not allocation-free.** `types.ts`'s `Vec3 = [number, number, number]` and `Ray`/`RayPath` are plain JS-array
  tuples, not views into a flat `Float32Array`/`Float64Array` buffer, so every `add3`/`sub3`/`scale3`/
  `normalize3`, every `TraceSurface` hit point, and every `Ray` handed to the next surface necessarily allocates a
  small tuple. `sag`/`sagSlope`/`intersect` themselves allocate nothing extra beyond that. Reaching the "hot loops
  allocation-free, data flat" bar `ENGINE.md`'s header asks for would need `Vec3`/`Ray`/`RayPath` (or a parallel
  flat-buffer API) to change in `types.ts`, which this workstream does not own — flagged in
  `needs_from_lead`. `spot()`'s per-sample allocation (one `RayPath` with its own `pts` array per pupil sample) is
  the sharpest edge of this for a GPU-port comparison; if E4's reference renderer calls `spot` with large grids in
  a per-pixel inner loop, that's the first place to revisit.
- **Real-ray aiming is undamped Newton, not globally robust.** It works well when the paraxial-entrance-pupil
  guess and the true stop-crossing root are connected by a reasonably well-behaved (non-folding) map, which was
  true for every case this workstream needed (up to ~20 deg field angle on hand-built fixtures) but is not
  guaranteed for an arbitrary system/field combination — a strongly aberrated pupil or a field angle right at a
  vignetting/TIR boundary can make the local Jacobian ill-conditioned and the iteration diverge or land on a
  `null` crossing, at which point `aimRay` just keeps the last valid aim point (see `frontGroupWithStop`'s doc
  comment in `fixtures/e1a-lenses.ts` for a worked example of a *too*-aggressive fixture that broke this). A
  damped/bounded-step Newton or a bracketing fallback would be the next hardening step if E1b's real lens
  prescriptions hit this at their working field angles.
- **An `{ kind: 'angle' }` field's ray is launched AT `ep.z`** (`rayThroughPupilPoint` sets `ray.o` to the pupil
  point directly, not to a true object-space origin), and — since "Forward-only intersections" above — `traceRay`
  can then never reach a surface positioned before `ep.z`. Every `Pupil` a caller builds for an infinite-conjugate
  field must therefore satisfy `ep.z <= sys.surfaces[0].z` (as every fixture in `trace.test.ts` does). Placing
  `ep.z` after one or more real surfaces, as `trace.test.ts`'s "aimRay real-ray aiming" tests originally did (a
  leftover from before intersections were forward-only, when a behind-the-ray hit was silently accepted), makes
  those surfaces permanently unreachable — before this fix that silently produced a bogus but plausible-looking
  path; now it reports `'missed'` there instead, which is at least loud. Neither is "correct" tracing of a system
  with real elements before its entrance pupil; that would need `rayThroughPupilPoint` to back-project the launch
  point to before `sys.surfaces[0]`, which this workstream's `aimRay` does not do.
- **`Field`'s off-axis angle mapping is a documented approximation.** `{ kind: 'angle', ax, ay }` builds the
  infinite-conjugate bundle direction as `normalize([tan(ax), tan(ay), 1])`. This is *exact* whenever one of
  `ax`/`ay` is zero (the meridional case every golden test here uses, and what `fan()` always produces), but for
  a genuinely skew (both nonzero) field point it's a standard, simple generalization, not a second exact angular
  definition — fine for now since nothing in this workstream needed true skew fields; worth another look before
  E4's per-pixel scene sampling relies on it off the meridional plane.
- **Hexapolar weighting is uniform per point, not per unit area** (see the citation above): each ring's annular
  area grows faster than its point count, so hexapolar centroid/rms/energy integrals are only approximately
  area-correct. Prefer `square` or `fibonacci` where that matters (e.g. bokeh energy integration); hexapolar is
  offered for its fast RMS convergence in spot-diagram-style diagnostics, matching how lens-design tools use it.
- **`sag`/`sagSlope`'s domain guard, not a raised error.** Outside a bounded conic's real half-extent (`disc <=
  0`), both functions clamp rather than propagate a domain error, so a caller that queries `sag` far past a
  surface's `sd` gets a smoothly-clamped (not physically meaningful) value instead of a thrown exception.
  `trace.ts` never does this in normal operation (its `sd` vignetting check always fires first), so this only
  matters for a caller probing `surface.ts` directly outside a system.
- **No decenter/tilt.** Every surface is rotationally symmetric about a single shared z-axis (`TraceSurface` has
  no x/y/tilt offset), matching `types.ts`'s "absolute coordinates for the current focus" comment. Fine for the
  on-axis, axisymmetric lens systems E1b's data model describes; would need new geometry (and likely new fields
  on `TraceSurface`, which this workstream doesn't own) for a decentered/tilted element.
- **Ghost paths (two internal reflections) are out of scope here**, per `ENGINE.md` ("Ghost paths... come later").
  `reflect()` exists and is tested, but `traceRay` never calls it — every `TraceSurface.kind` it handles is
  `'refract' | 'stop' | 'image'`, all dioptric.

## Deviations from ENGINE.md / needs_from_lead

- `vite.config.ts`'s `test` block was missing `globals: true`, so `describe`/`it`/`expect` (which `tsconfig.json`
  already types as ambient globals via `"types": ["vitest/globals"]`) were not actually defined at runtime —
  every `*.test.ts` file, in every workstream, would fail with `ReferenceError: describe is not defined` before
  this fix. `vite.config.ts` is not in E1a's owned paths, but this blocks all of them, so it was fixed directly
  (one line) rather than worked around per-file; flagged here in case the lead wants it done differently.
- `Field`, `TraceOptions`, `AimOptions`, `PupilGrid`, `SpotSample`, `SpotResult` are declared locally in
  `trace.ts` rather than in `types.ts` (not owned by this workstream). If E1b's `paraxial.ts` or E4's `render.ts`
  want to build/consume these (a field point, a pupil-sampling pattern), promoting them to `types.ts` would let
  everyone share one definition instead of re-declaring compatible-but-separate ones.
- `sagSlope` is exported from `surface.ts` even though ENGINE.md's module list for `surface.ts` only names `sag`,
  `normalAt`, `intersect`, `refract`, `reflect`. It's a small, independently useful piece (`normalAt` and
  `intersect`'s Newton step both already need it) — kept as a bonus export rather than folded in as a private
  helper, in case E1b's paraxial.ts wants the same derivative. Not a change to any listed signature.
