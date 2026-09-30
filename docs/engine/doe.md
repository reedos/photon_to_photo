# Diffractive (Phase Fresnel / DOE) surfaces

Adds a kinoform/DOE phase profile to the sequential ray tracer (`src/engine/trace.ts`, `surface.ts`) and the
paraxial module (`paraxial.ts`), so `data/lenses/*.json` can carry a Nikon Phase Fresnel element (the diffractive
element in Reed's Nikon AF-S 500mm f/5.6E PF and the NIKKOR Z 600mm f/6.3 PF) and the engine reproduces its
patent-stated focal length and its distinctive "reverse" chromatic dispersion. Branch `engine/doe`, worktree
`photon_to_photo-doe`; work stays on this branch (see `docs/ENGINE.md` for the module map this fits into).

## Data shape: two levels

Two different `Doe`-shaped types exist, deliberately kept separate:

- **`lens-types.ts`'s `DoeSpec`** — the shape a patent transcription actually writes into `data/lenses/*.json`:
  `coeffs` keyed by the patent's own coefficient names (`"C2"`, `"C4"`, `"C6"`, ...), and `convention` as free
  text (the patent's phase-difference formula and enough of its power formula to cross-check sign/units — see
  `data/lenses/n500.json`'s and `m500.json`'s own `doe.convention` fields for the two worked examples transcribed
  into this project so far).
- **`types.ts`'s `Doe`** — the engine's own canonical, order-independent form every trace/paraxial function
  actually consumes: `coeffs` as a plain array `[C2, C4, C6, ...]`, `convention` kept only for audit.

`lens.ts`'s `normalizeDoe` converts one to the other at `loadLens` time (before `scaleDoe` applies the design's
`scale`). This mirrors how `resolveMedium` already turns a patent's raw glass description into what the tracer
uses — a transcription-shape-to-engine-shape adapter living in `lens.ts`, not baked into the wire format.

## The convention: phi(h), order-independent

The engine implements exactly one physical grating equation. The phase difference function:

```
phi(h) = (2*pi/lambda0) * (coeffs[0]*h^2 + coeffs[1]*h^4 + coeffs[2]*h^6 + ...)
```

with `h` the radial height (mm), `lambda0` the design wavelength (nm, converted to mm), and `coeffs[i]` in
`mm^-(2i+1)` for the `h^(2i+2)` term. **`phi` never depends on the diffraction order.** The order `m` enters only
through the grating equation itself (below) — never through the shape of the physical structure, which is fixed
once molded/etched.

### Why this is the right normalization for the two Nikon patents transcribed so far

Both `data/lenses/n500.json` (JP 2018-017857 A) and `data/lenses/m500.json` (JP 2023-023323) write the patent's
own phase-difference function **with an extra `1/n` (order) factor baked in**:

```
psi(h, n) = (2*pi / (n*lambda0)) * (C2*h^2 + C4*h^4)          -- patent's own equation (c)
phiD(lambda, n) = -2*C2*n*(lambda/lambda0)                     -- patent's own paraxial power, equation (d)
```

Applying the standard grating equation (see "Ray tracing" below) to the patent's OWN `psi(h, n)` at order `n`:

```
kick = n * (lambda/(2*pi)) * d(psi)/dh
     = n * (lambda/(2*pi)) * (2*pi/(n*lambda0)) * d/dh(C2 h^2 + C4 h^4)
     = (lambda/lambda0) * d/dh(C2 h^2 + C4 h^4)                -- the order n cancels out completely
```

This is bit-for-bit the same expression as applying this engine's order-independent `phi(h) = (2*pi/lambda0) *
(C2 h^2 + C4 h^4)` (no `1/n`) with the ordinary grating kick `m*(lambda/2*pi)*grad(phi)` at `m = n`. So the
patent's own printed `C2`/`C4` plug directly into `Doe.coeffs` **unchanged** — confirmed independently against the
patent's own equation (d): `n500.json`'s own convention note works the number (`lambda0=587.6`, `C2=-4.25304e-05`,
order 1) and gets `fpf = 1/(-2*C2) = 11756.30 mm`, matching the patent's own Table 8 value (`fpf = 11756.3`) to
four significant figures — exactly what this module's `doePower` (below) computes.

A future patent that expresses its phase function WITHOUT the `1/n` factor (i.e. already matching this engine's
own `phi(h)`) would normalize even more directly (`normalizeDoe` would just copy the coefficients with no algebra
needed at all, since the two forms would already be identical); one using the "ultra-high-index Sweatt model"
equivalent representation (replacing the DOE surface with an ordinary refracting surface at a fictitious very
high index, e.g. n = 10001, whose *dispersion* is defined to reproduce a diffractive surface's order-1 wavelength
scaling) is NOT implemented — no lens transcribed so far uses it, and it would need its own conversion path
(computing an equivalent even-asphere sag and an index vs. wavelength curve from `phi(h)`, rather than the direct
coefficient copy above). If one appears, extend `DoeSpec`'s `convention` handling in `normalizeDoe` rather than
overloading this one.

## Ray tracing (`surface.ts`)

`doeGradPhi(doe, h)` computes `d(phi)/dh` (rad/mm) directly from the array form above.

`diffract(d, n, n1, n2, x, y, doe, nm)` generalizes `refract`'s vector Snell's law with the grating term, both
applied in one step (both act on the same tangential wavevector). Standard references for the vector grating
equation: Zemax's "Binary 2" surface documentation (the diffraction order enters as a simple multiplicative
tangential-wavevector kick on top of ordinary Snell refraction); O'Shea, T. J., Suleski, T. J., Kathman, A. D., and
Prather, D. W., *Diffractive Optics: Design, Fabrication, and Test*, SPIE Press, 2004, ch. 2-3; Welford, W. T.,
*Aberrations of Optical Systems*, Adam Hilger, 1986, sec. 14.2 (grating equation as a local phase-matching
condition). Derivation:

Vector Snell's law is really tangential-wavevector conservation: with wavevector `k = (2*pi*n/lambda) * d` (`d`
unit direction, `lambda` the vacuum wavelength), the tangential (in the surface's local tangent plane) component
is conserved: `n1 * d1_t = n2 * d2_t` (dividing out the common `2*pi/lambda`). A diffraction grating with local
phase gradient `grad(phi)(h)` (rad/mm, radially directed since `phi` depends only on `h`) ADDS to that tangential
wavevector at order `m`:

```
n2 * d2_t = n1 * d1_t + m * (lambda/(2*pi)) * grad(phi)(h)
```

`diffract` computes `d1_t` (the incident direction's tangential part relative to the local normal), the grating
vector `grad(phi)(h)` projected onto that same tangent plane (exact for a flat or nearly-flat DOE substrate — the
case every Nikon Phase Fresnel patent transcribed here actually uses; see "Known limits"), solves for `d2_t`, and
recovers the normal component from the unit-length constraint — exactly parallel to how `refract` recovers `cosT`
from `sin2T`. **When every coefficient is zero, `diffract` reduces algebraically to `refract`** (verified by a
golden test).

`sin2T = |d2_t|^2 > 1` (an angle the grating cannot actually produce — an evanescent diffraction order, or the
substrate's own ordinary TIR) returns `null`, reported by `trace.ts` the same way as any other TIR: status
`'tir'`. The two failure modes are not distinguished (see "Known limits").

`trace.ts`'s `traceRay` calls `diffract` instead of `refract` whenever `surf.doe` is set; everything else about
the sequential trace (vignetting at `sd`, the stop's iris, the image-plane recording) is unchanged.

## Paraxial power (`paraxial.ts`)

`doePower(doe, nm)` computes the DOE's paraxial optical power (mm^-1) at wavelength `nm`:

```
K(lambda, m) = -2 * m * C2 * (lambda/lambda0)
```

**Derivation.** The phase profile that brings a collimated beam to an ideal focus at `f0`, order `m=1`, design
wavelength `lambda0`, is the one whose optical path difference cancels a spherical wavefront converging at `f0`:
`phi(h) = -(2*pi/lambda0) * sqrt(h^2 + f0^2) ~= -(2*pi/lambda0) * (f0 + h^2/(2*f0))` (dropping the constant,
paraxial in `h`), giving `C2 = -1/(2*f0)`, i.e. `K(lambda0, 1) = 1/f0 = -2*C2`. The grating equation's deflection
(above) is exactly linear in `m*lambda`, so the power at any other order/wavelength scales the same way:
`K(lambda, m) = -2*C2 * (m*lambda)/lambda0`. This is stated directly by both transcribed patents' own equation
(d) (see "Why this is the right normalization" above) and is the formula the task brief itself specifies.

`stepThrough`'s `y-nu` recursion gains this term alongside the ordinary refractive power `c*(n2-n1)`:
`nuPrime = nu - y*(c*dn + doePower(doe, nm))`. Higher-order coefficients (`C4`, `C6`, ...) contribute no PARAXIAL
power (their leading term in `h` is higher than linear in the paraxial `y*power` recursion) — exactly like an
even-asphere surface's own higher-order sag coefficients, which is why `cardinal`'s pupil/Petzval geometry never
needs them either.

`mirrorElems` (the reverse trace used to find the front principal plane/focal point) carries a surface's `doe`
through **unchanged** even though it negates `c`: a DOE's power is an intrinsic, direction-independent property of
the physical grating (it converges light the same way whichever direction it is traced), unlike curvature, which
is defined relative to the direction of travel.

**Petzval sum.** A DOE surface contributes **zero** to the Petzval sum — `cardinal`'s Petzval loop only ever reads
`e.c` and the media either side, never `e.doe`, so this falls out automatically rather than needing a special
case. This matches the well-known, celebrated property of diffractive elements (e.g. Buralli & Morris 1989, cited
below): a DOE's power is a phase effect, not an index-mismatch-at-a-curved-surface effect, so it has no field
curvature contribution regardless of how much power it carries — exactly the property that makes a
diffractive-refractive hybrid useful (it can correct color and shift power around without also perturbing field
curvature the way adding refractive power would).

## Scaling (`lens.ts`)

`scaleDoe(doe, scale)` scales `coeffs[i]` (the `h^(2i+2)` term) as `coeffs[i] / scale^(2i+1)`.

**Derivation.** `phi(h)` is dimensionless (radians); the physical requirement under a uniform geometric rescaling
of the whole lens design (`scale`, exactly as `data/lenses/*.json`'s `Surface.r`/`t`/`sd` are scaled) is that every
ray ANGLE at a corresponding (scaled) point is unchanged — f-number, field angle, and every other paraxial angle
in a uniformly-scaled lens design are scale-invariant, and the same must hold for the grating's own deflection.
The deflection depends on `grad(phi)(h) = (2*pi/lambda0) * sum_i (2i+2) * coeffs[i] * h^(2i+1)`, a REAL (unscaled)
wavelength `lambda` — never `lambda0` or the order, neither of which is a geometric quantity that scales.
Requiring `grad(phi)'(s*h) = grad(phi)(h)` term by term gives `coeffs[i]' * s^(2i+1) = coeffs[i]`, i.e.
`coeffs[i]' = coeffs[i] / s^(2i+1)` — exactly the same `scale^(order-1)` rule `scaleAsphere` already uses for even
asphere terms (`order = 2i+2`, `order-1 = 2i+1`), since `phi`'s `h^n` term behaves under scaling exactly like an
even-asphere sag term's `h^n` does (both are functions of `h` alone whose radial DERIVATIVE, not the function
value itself, is the physically invariant quantity — `sagSlope` for refraction, `doeGradPhi` for diffraction).
`lambda0Nm`, `order` and `convention` are physical/textual constants of the design and are never scaled.

## Element counting and catalog matching for laminated (resin) layers

Unrelated to the diffraction physics itself, but required to actually LOAD `n500.json`: Nikon's "close-contact
multilayer" DOE construction laminates two thin, unnamed materials directly onto a host lens element (`layer:
'resin'` in `lens-types.ts`, added on `main` alongside the n500/m500 transcriptions). Two engine-side
accommodations, both in `lens.ts`:

- **Catalog tolerance.** `resolveMedium`'s `FAIL_LOUD_MAX_DND`/`FAIL_LOUD_MAX_DVD` guard exists to catch an
  empty/wrong glass catalog, not to second-guess a real, patent-stated resin `nd`/`vd` that simply has no business
  being near any ordinary optical glass. A surface marked `layer: 'resin'` skips that guard; the model-glass
  construction below it still reproduces the resin's own stated `nd`/`vd` exactly (borrowing only the nearest
  catalog entry's dispersion SHAPE), regardless of how far away that entry sits.
- **Element counting.** `buildElementsAndGroups` originally absorbed exactly one resin layer forward into the
  element that follows it (a single hybrid-asphere coating). n500's DOE laminates **two** consecutive resin
  layers back to back onto its host element (`L14`), so the rule generalizes: starting a new element at a glass
  segment, keep extending its rear bound across a joint whenever EITHER side of that joint is itself a resin
  layer (`surfaces[k].layer === 'resin'`), transitively, until a joint that is neither side resin, or real air.
  This correctly merges a run of any length (tested against n500's two-layer stack: `L14 front` (ordinary glass,
  unmarked) + `layer 1` (marked) + `layer 2`/the DOE surface itself (marked) merge into ONE element, exactly
  matching the patent's/product's stated 19 elements / 11 groups), while leaving ordinary cemented multi-element
  groups (no `layer` marker anywhere) untouched — they still count as separate elements merged into one GROUP by
  the unchanged grouping pass below.

  `data/lenses/m500.json` (JP 2023-023323) was NOT given this treatment: its own transcription notes describe its
  two laminated materials as "cemented" (the same language used elsewhere in that file for ordinary,
  separately-countable cemented elements) and its own stated `elements: 22` already equals the file's raw,
  UNMERGED non-air surface count — i.e. that file's own count treats its host element and two DOE layers as three
  separate elements forming one group, not one fused element the way n500's "close-contact multilayer" language
  implies. Applying n500's merge-and-bypass treatment to m500 as well was tried and reverted: it changes m500's
  element count to 20 against its own stated 22. m500.json's glass-tolerance problem (surface 5, `nd=1.5295,
  vd=36.27`, no catalog match) is therefore left as an open transcription question for whoever owns that file
  (does it need a `layer` marker with a DIFFERENT [group-preserving] engine treatment, or does its own `elements`/
  `groups` count need revising?) rather than silently reused here — see "Real lens results" below.

## Golden tests (`doe.test.ts`)

- **Flat-substrate kinoform lens, f = 100 mm at lambda0.** `C2 = -1/(2*f0)`, `f0 = 100`, confirms `cardinal(...).efl
  === 100` exactly at `lambda0`, and `f = f0*lambda0/lambda` (the diffractive dispersion) at F/d/C and two
  out-of-band test wavelengths — checked BOTH via the paraxial recursion (`cardinal`) and independently via a real
  (non-paraxial) small-height ray traced through `traceRay`, so the two code paths (paraxial and real-ray) are
  cross-checked against the same closed form.
- **A ray at height h is deviated by exactly the grating angle.** A ray along the axis (no incident tangential
  component at a flat surface) hits a flat DOE surface off-axis: the ENTIRE post-surface tangential direction is
  then the grating's own kick, checked bit-for-bit against `doeGradPhi`'s value and the stated grating-equation
  formula. Also checks `diffract` reduces exactly to `refract` when every coefficient is zero, and that an
  overdriven (evanescent) grating returns `null`.
- **Effective Abbe number ~ -3.4535.** Buralli, D. A., and Morris, G. M., "Effective Abbe number for diffractive
  optical elements," *Appl. Opt.* 28, 3006-3007 (1989): `V_DOE = lambda_d / (lambda_F - lambda_C)`. Because
  `K(lambda)` is exactly linear in `lambda`, this ratio is a property of the d/F/C wavelengths alone — computed
  here from a fully traced system (paraxial power at three wavelengths), not just the wavelength ratio in
  isolation, so the test also exercises `paraxial.ts`'s DOE power path end to end.
- **A diffractive-refractive hybrid achromat beats a refractive singlet.** Standard achromatic-doublet power
  split (e.g. Hecht, *Optics*, 5th ed., eq. 6.9) with the second element's Abbe number replaced by the DOE's
  effective `V ~= -3.4535`: `Phi_1 = Phi_total*V_1/(V_1-V_2)`, `Phi_2 = Phi_total*V_2/(V_2-V_1)`. Textbook
  treatment of the technique itself (an ordinary-glass element paired with a diffractive element to correct color
  with far fewer elements — exactly the design principle behind Reed's own 500mm/600mm PF lenses): Wood, A. P.,
  "Design of a hybrid diffractive-refractive achromat," *Appl. Opt.* 31(14), 2494-2497 (1992); O'Shea et al.,
  *Diffractive Optics*, SPIE Press, 2004, sec. 4.4, "Hybrid Optical Systems." The test builds both a same-power
  all-refractive singlet and the hybrid split (fixed-Abbe-number synthetic glass, isolating the achromatic
  arithmetic from any real glass's own non-ideal partial dispersion) and checks the hybrid's F-C back-focal shift
  is at least ~50x smaller than the singlet's alone.

All nine tests pass; see the file for the exact numbers.

## Real lens results

`data/lenses/n500.json` (Reed's Nikon AF-S NIKKOR 500mm f/5.6E PF ED VR, JP 2018-017857 A Example 2) was copied
into this worktree (never `git add`ed) once it landed in the main checkout and tested against
`lenses.test.ts`/`realize.test.ts`. With the two accommodations above (catalog-tolerance bypass and the extended
multi-layer element-counting rule) **it passes every check**: EFL, BFD, F-number, glass resolution, element count
(19) and group count (11) all match the patent, and `realize.test.ts`'s full-aperture/off-axis/closest-focus
checks all pass. `data/lenses/m500.json` does not yet load (see "Element counting" above) for a reason unrelated
to the diffraction physics itself (an unmatched laminated-material glass, plus that file's own element count not
matching the multi-layer merge treatment n500 needs) — flagged for whoever owns that transcription rather than
worked around here. Neither JSON file is committed by this workstream.

## Known limits

- **Flat/near-flat substrate approximation in `diffract`.** The grating vector `grad(phi)(h)` is computed as a
  purely radial vector in the GLOBAL x-y plane, then projected onto the local surface tangent plane. This is
  EXACT for a flat DOE substrate (`c = 0`, both transcribed patents' diffractive surfaces are on essentially flat
  or very weakly curved interfaces) and a good approximation for a mildly curved one, but is not an intrinsic
  (surface-parametrization-exact) computation of the grating vector on a strongly curved substrate. No lens
  transcribed so far needs that; if one does, `diffract` would need the grating vector computed from the
  surface's own local coordinate frame rather than a global-plane projection.
- **Evanescent order and ordinary TIR are not distinguished.** Both report `RayStatus` `'tir'` (per the task
  brief: "a failure status like TIR"); a caller wanting to tell them apart would need a new status value, which
  this workstream did not add since nothing currently consumes that distinction and `RayStatus` is read
  elsewhere in the codebase.
- **Diffraction efficiency is not modeled.** Only the ideal order (`m` = `Doe.order`, typically 1) is traced, at
  100% efficiency; per the task brief this is a later, separate item (a single-layer vs. multilayer efficiency
  curve), not required for tracing rays at the design order.
- **The Sweatt-model (ultra-high-index) convention is not implemented** — no transcribed lens uses it; see "The
  convention" above for what adding it would need.
- **m500.json's DOE surface is untested end to end** for the reason described above (a data/transcription gap,
  not an engine one); its diffraction math would exercise the identical code path n500.json already covers.
