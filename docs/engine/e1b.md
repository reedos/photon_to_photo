# E1b: lens systems (`glass.ts`, `paraxial.ts`, `lens.ts`, `iris.ts`)

Pure TypeScript, no Three.js, no DOM (per `docs/ENGINE.md`). Together these four modules turn a `LensDesign`
(a transcribed patent prescription, `src/engine/lens-types.ts`) into a traceable, focusable `TraceSystem`
(`src/engine/types.ts`), plus the aperture math and schematic blade geometry that sit on top of it.

Data stays out of this workstream's modules: `glass.ts` takes catalog entries as an argument
(`makeCatalog(entries)`) and `lens.ts` takes a `GlassCatalog` as an argument to `loadLens`. Nothing here imports
`data/*.json`. The lead wires `data/glass/catalog.json` and `data/lenses/*.json` in after the E1-E3 merge; until
then, `lenses.test.ts` skips with a named, visible skipped test rather than failing or silently passing.

## API

```ts
// glass.ts
makeCatalog(entries: GlassEntry[]): GlassCatalog                      // { get, keys, entries }
indexAt(entry: GlassEntry, nm: number): number                        // Sellmeier / Schott dispersion
resolveGlass(catalog: GlassCatalog, nd: number, vd: number): GlassMatch  // { entry, dnd, dvd }
abbe(entry: GlassEntry): number                                       // recomputed from d/F/C, not entry.vd
partialDispersion(entry: GlassEntry): { PgF: number }
FRAUNHOFER_D_NM, FRAUNHOFER_F_NM, FRAUNHOFER_C_NM, FRAUNHOFER_G_NM     // nm constants

// paraxial.ts
cardinal(sys: TraceSystem, nm: number, stopRadius?: number): Cardinal // efl, bfd, ffd, P, P2, F, F2, ep, xp,
                                                                       // pupilMag, fno, petzvalRadius
imageOf(sys: TraceSystem, nm: number, objectZ: number): { z: number; magnification: number }
petzvalRadius(sys: TraceSystem, nm: number): number

// lens.ts
loadLens(design: LensDesign, catalog: GlassCatalog): ResolvedLens     // see "Deviation from ENGINE.md" below
systemAt(lens: ResolvedLens, focusFromSensorMm: number | null): TraceSystem
sensorZ(lens: ResolvedLens): number

// iris.ts
stopRadiusFor(lens: ResolvedLens, fno: number): number
irisOutline(blades: number, radius: number, rounded: boolean, rotation: number, segments?: number): Vec2[]
irisTest(blades, radius, rounded, rotation, segments?): (x: number, y: number) => boolean
bladeShapes(blades, radius, rounded, rotation, segments?): Vec2[][]
```

`ResolvedLens` (exported from `lens.ts`, local to this workstream — not in `types.ts`/`lens-types.ts`) carries
`design`, `catalog`, `raw` (per-surface resolved geometry before absolute z), `glassResolutions`, `elements`,
`groups`, `sensorZ` and `index`. `Element` is `{ index, surfaces: [entry, exit], groupId }`; `CementedGroup` is
`{ id, elements, surfaces: [entry, exit] }`.

## Deviation from ENGINE.md

ENGINE.md lists `loadLens(design) -> ResolvedLens`, without a catalog parameter. The task brief's data-injection
rule ("glass.ts takes catalog entries as an argument; do not import data/ JSON from engine modules") requires
`loadLens` to receive the catalog explicitly too, since it is the thing that resolves glass. Implemented as
`loadLens(design: LensDesign, catalog: GlassCatalog)`. Flagged for the lead; no other signature differs from
ENGINE.md's module list.

## Conventions

Matches `types.ts`'s header: mm, nm, s, radians; z along the optical axis, light travels +z; a surface's `r`
(and derived `c = 1/r`) is positive when its center of curvature lies to the +z side of the vertex. Object and
image space are always air for every lens this engine models (light starts and ends outside glass) — `cardinal`
and `imageOf` read air's index via `sys.index('air', nm)` rather than hardcoding 1, so a non-unity "air" would
still be honored, but nothing here supports an object or image space that is not air.

## Derivations

### The core y-nu recursion

Every function in `paraxial.ts` reduces to one recursion, traced through a straight-line gap into a surface's
refraction. Standard paraxial ray-trace formulas, e.g. Warren J. Smith, *Modern Optical Engineering*, 4th ed.
(McGraw-Hill, 2007), ch. 2, "Paraxial Optics"; Rudolf Kingslake & R. Barry Johnson, *Lens Design Fundamentals*,
2nd ed. (Academic Press, 2010), ch. 2:

```
refraction:  n' u' = n u - y c (n' - n)        (nu' = nu - y c (n' - n), the reduced-angle form)
transfer:    y_next = y + t u'                  (straight line through gap t, using the real angle u' = nu'/n')
```

`paraxial.ts`'s `traceParaxialRay(startZ, y0, u0, n0, elems, indexFn, nm)` implements this as one pass over an
ordered list of `{z, c, mediumAfter}`, propagating through the gap before each surface and then refracting.
Every other computation in the file is built from one or two calls to this primitive.

**Sign check** (done before writing anything else, to fix the convention unambiguously): a single positive
surface, air (n=1) to glass (n'=1.5), r=+50mm. A parallel ray at height y=10 gives, from the refraction equation,
`n'u' = -10 * 0.02 * 0.5 = -0.1`, `u' = -0.0667`. It crosses the axis at `-y/u' = 150mm`, matching the classic
single-surface focal length `f' = n' r / (n' - n) = 1.5*50/0.5 = 150mm` exactly.

### EFL, BFD and the rear principal plane/focal point

Trace a ray parallel to the axis (`y0=1, u0=0`) from object space through the whole system. At the last surface,
real angle `u_final` (not the reduced angle — the two are algebraically equal here because `f' = n_image/Φ` and
`Φ = -n_image u_final / y0` cancel the image-space index):

```
efl = -y0 / u_final
bfd = -y_final / u_final              (from the last surface's z)
F2  = z_last + bfd                    (rear focal point)
P2  = F2 - efl                        (rear principal plane)
```

### The reverse trace: FFD and the front principal plane

There is no analogous single forward pass for the front cardinal points without tracing the system backward.
`mirrorElems` builds that backward trace as a forward one, by mirroring coordinates (`z~ = -z`): under this
reflection a surface's curvature negates (`c~ = -c`, since `r` is defined relative to the direction of travel)
and the medium a backward-traveling ray meets after crossing a surface is whatever the forward system had
*before* it. Running `traceParaxialRay` on the mirrored list and converting the result back (`z = -z~`) gives
FFD, F and P by the same formulas as above, applied to the mirrored geometry.

This was checked by hand on a biconvex singlet (R1=+50, R2=-50, d=10mm, nd=1.5168, air both sides) before
trusting it in code:

- Thick-lens formula (e.g. Hecht, *Optics*, 5th ed., §6.3; or Smith, ch. 2): power
  `= (n-1)[1/R1 - 1/R2 + (n-1)d/(n R1 R2)]`, principal planes `x_H = -f(n-1)d/(R2 n)` from V1,
  `x_H' = -f(n-1)d/(R1 n)` from V2. Gives f=50.0801mm, H=3.4126mm (from V1), H'=6.5874mm (from V2, V2 at z=10).
- Hand-run the forward y-nu recursion on the same lens: f=50.0812mm, P2=6.5878mm (matches to hand-arithmetic
  precision).
- Hand-run the mirrored/reverse recursion: F=-46.669mm, P=3.412mm (matches the thick-lens H, and matches
  `f = f'` — expected since object and image space are both air).

This exact case is `paraxial.test.ts`'s "thick biconvex lens vs the thick-lens formula" golden test, computed
independently in the test file from the same closed-form thick-lens equations (not from this derivation's
numbers).

### Pupils

Entrance pupil = image of the stop through the elements before it, seen backward from object space; exit pupil
= image of the stop through the elements after it, seen forward from image space ("trace the stop
backward/forward paraxially" per `docs/ENGINE.md`). Both use the same construction, `subImage`: since paraxial
imaging is linear, every ray from an on-axis object point crosses the axis at the same image point regardless of
its starting angle, so one ray (`y=0` at the stop, arbitrary angle) locates the pupil's z; a second ray (`y =
stopRadius`, `u=0` at the stop) extended to that z gives the pupil's radius, because a point at that height and z
maps under the same linear imaging to `(radius * magnification, pupilZ)`.

`ep.r`/`xp.r` are reported as **non-negative** sizes, even though the underlying construction is signed and can
invert (e.g. a stop exactly 2f behind a single positive element images with magnitude-1 inversion — see the
"entrance pupil of a stop behind a single lens" golden test below). The sign there reflects image orientation,
not pupil *size*, and `types.ts` documents `Pupil.r` as "radius, mm" — so the sign is discarded here rather than
leaking into `fno` and `pupilMag` as an arbitrary flip depending on where the stop happens to sit.

Golden test (also independently hand-derived, not read off this file): stop 2f behind a thin f=50mm lens, stop
radius 5mm. Imaging backward through the lens is the classic 2f-2f symmetric conjugate (object at 2f images to
2f on the far side, magnitude-1, inverted) — entrance pupil at z=-2f, radius 5mm exactly.

### Petzval sum and radius

`P = sum_j [ c_j (n'_j - n_j) / (n_j n'_j) ]` over refracting surfaces; `R_petzval = -n_image / P` (Kingslake;
Smith, ch. 15, "Petzval curvature"). Checked against the well-known thin-lens special case, Petzval radius = `-n
f` for a thin lens of index n and focal length f in air: substituting the thin lens's two surfaces into the sum
above algebraically reduces to `P = (n-1)(c1-c2)/n = φ/n = 1/(nf)`, so `R_petzval = -n/(1/(nf)) = -nf`. Both the
algebraic reduction and the code are checked against `-nf` numerically in `paraxial.test.ts`.

### `imageOf`: finite-conjugate imaging

Same linear-imaging argument as the pupil sub-trace, applied to the whole system: one ray from the object point
(`y=0`, arbitrary angle) locates the image z; a second ray (`y=1`, `u=0`) extended to that z gives the
magnification directly (object height was 1). Golden-tested against the Gaussian thin-lens conjugate equation
(`1/v + 1/s = 1/f`, s positive in front of the lens).

### Unit focus: why the extension isn't simply `f^2/(s-f)`

`docs/ENGINE.md` fixes the convention: the sensor is fixed at the infinity-focus position, and unit focus moves
every surface forward (toward the object). That means the object is fixed *in absolute space relative to the
sensor* — a real camera's focus distance is what the lens barrel's own marking, and hence the sensor, reads —
while the lens barrel itself moves between them.

The classic extension formula `e = f^2/(s-f)` (from the thin-lens equation `1/(f+e) + 1/s = 1/f`, e = the extra
image distance beyond f) defines `s` as the object distance **from the lens's current, focused position**. If
instead the object is fixed relative to the sensor and the lens moves toward it by `e`, the object-to-lens
distance at focus is `s0 - e` (s0 = the distance to the lens's *infinity* position), and the exact equation
becomes self-referential: `1/(f+e) + 1/(s0-e) = 1/f`, a quadratic in `e`, not simply `f^2/(s0-f)`. For f=50mm,
s0=1000mm this genuinely differs from the naive formula by about 0.007mm (`e=2.6389` vs the naive `2.6316`) —
small, but far more than the golden test's 1e-6 tolerance, and not a numerical error.

The golden test (`lens.test.ts`, `systemAt: unit focus`) resolves this by constructing the scenario in the
causal direction the formula actually describes: pick the target focused object distance `s` and compute
`e0 = f^2/(s-f)` from it (the textbook formula, exact by its own definition since `s` there *is* the focused
distance); then place the object's fixed, sensor-relative position so that once the lens has shifted by `e0`,
the object really is `s` from the shifted lens (`objectZ = -e0 - s`). `systemAt`'s Newton solve, given that
`focusFromSensorMm`, reproduces `e0` to 1e-6 — this is an exact check, not an approximation, because the
scenario was built to have that exact answer, and the solve has to find the same root independently. A second,
non-golden test in the same file documents the naive construction's ~0.007mm miss, so the distinction is visible
rather than silently avoided.

`systemAt`'s Newton solve itself: finite-difference derivative (`h=0.01mm` for the extension, `h=1e-4` for the
dimensionless gap-interpolation parameter), starting from `e=0` / `t=0.5`, up to 40/60 iterations, accepting a
residual under `50 * tol` as converged and throwing otherwise (`lens.ts: systemAt: ... did not converge`) —
i.e., failing loudly on a focus distance the design genuinely cannot solve for, rather than returning a wrong
system silently.

### Iris blade geometry (schematic)

There is no real blade CAD model here — `docs/ENGINE.md` asks only that the schematic geometry be documented.

- **Straight blades**: a regular n-gon, vertices at circumradius `radius`, vertex 0 at angle `rotation`. This is
  the real, well-known behavior of a straight-edged iris: polygonal bokeh, vertices farther from the axis than
  edge midpoints.
- **Rounded blades**: the same n vertices, but each edge bulges outward from the straight chord toward the
  circle, closing 90% of the gap between the polygon's circumradius and inradius at the edge's angular midpoint
  (a circular arc through the two vertices and that midpoint, via the standard three-point circumcenter
  construction). 90% is a chosen schematic constant, not a measured one — it leaves a small, deliberately
  visible n-fold ripple so a rounded 5- or 7-blade iris still reads as polygonal-ish wide open, and only looks
  fully circular as `blades` grows, matching the qualitative look of real rounded-blade irises (softer, rounder
  bokeh than straight blades, but not a perfect circle at low blade counts).
- **`bladeShapes`**: each of the n physical blades occupies its own `2*pi/n` angular sector, bounded on the
  inside by that sector's edge of the current opening (same arc/straight edge as `irisOutline`) and on the
  outside by a fixed housing radius, `2 * radius`. No attempt to model how real blades overlap or pivot
  mechanically — a labeled schematic for the cutaway view, per `docs/ENGINE.md`.

`stopRadiusFor` inverts `cardinal`'s entrance-pupil imaging: since that imaging is linear in the stop's own
radius, probing with a 1mm stop radius gives the front group's magnification directly (`probeEpR`), and the stop
radius for a target f-number is `(efl / (2 fno)) / probeEpR`. No iteration needed. Golden-tested with the stop
placed *before* any refracting surface (entrance pupil == the stop exactly), where the result must equal `efl /
(2 fno)` directly by the textbook definition of f-number.

## Golden tests, one-line index

All in this workstream's `*.test.ts` files, each computing its expected value independently of the code under
test (a hand calculation from a cited closed-form formula, or a published datasheet table):

- `glass.test.ts`: SCHOTT N-BK7 Sellmeier coefficients vs the SCHOTT datasheet's stated nd=1.51680, vd=64.17.
- `paraxial.test.ts`: thin singlet vs the lensmaker equation; thick biconvex vs the thick-lens formula (efl, both
  principal planes, both focal points); two thin lenses vs the combination formula; entrance pupil of a stop
  behind a thin lens vs the hand-derived 2f-2f conjugate; thin-lens Petzval radius = -nf; `imageOf` vs the
  Gaussian thin-lens conjugate equation; edge cases (no stop, stop as surface 0, afocal system).
- `lens.test.ts`: element/cemented-group counting on a doublet+singlet; scale linearity; coating defaults;
  unit-focus extension vs `f^2/(s-f)` (see "Derivations" above); minimum-focus clamp; variable-gap focus solve
  reproduces the base gap at (near-)infinity and images a finite object onto the sensor; glass fail-loud paths.
- `iris.test.ts`: `stopRadiusFor` vs `efl/(2 fno)` when the stop is the entrance pupil; polygon vertex geometry;
  rounded-arc bounds (never exceeds circumradius, always exceeds inradius, converges to circular as blades
  grow); point-in-outline edge cases.
- `lenses.test.ts`: per-file integration against `data/lenses/*.json` once it lands (efl/bfd/fno within the
  brief's tolerances, glass match quality, element/group counts). Validated end-to-end against a throwaway
  fixture during development (not committed — nothing under `data/` is ever `git add`ed from this workstream).

## Known limits

- `cardinal()` on a system with no `kind: 'stop'` surface returns `ep`/`xp`/`pupilMag`/`fno` as `NaN` rather than
  throwing, so callers that only need efl/bfd/principal planes on a stopless synthetic system are not forced to
  fabricate a stop.
- `cardinal()` throws on an afocal system (a parallel ray stays parallel; there is no finite EFL/BFD to report).
- `glass.ts` implements the `sellmeier3` and `schott` dispersion formulas only; a `GlassEntry` with `formula:
  'other'` throws rather than guessing at an unstated formula. Add it in `glass.ts`'s `indexAt` if `data/glass`
  ever needs one.
- `resolveGlass`'s nearest-match distance is normalized by each quantity's spread across the *supplied* catalog
  (max-min of nd, of vd), an engineering choice since ENGINE.md does not specify a normalization; documented in
  `glass.ts`.
- The iris blade geometry (`irisOutline`, `bladeShapes`) is explicitly schematic, not a mechanical blade model;
  see "Iris blade geometry" above for the exact, documented construction.
- `systemAt`'s focus solve assumes the object images through the system in a numerically well-behaved
  (monotonic-ish) way over the Newton iteration's path; a design where that fails throws with a residual rather
  than returning a silently wrong focus position.
- Variable-gap (non-`unit`) focus methods solve a dimensionless interpolation parameter `t` between the design's
  declared `focus.gaps` (`t=0` at infinity, `t=1` at the design's stated close-focus condition). `t` is bounded to
  `[0,1]` (a 1e-6 float-slop tolerance): a focus request the gaps table cannot reach — closer than `t=1`'s
  condition, but still farther than `focus.minFocusM` so the minimum-focus clamp never engages — throws rather
  than silently solving a `t>1` extrapolation (and, further still, a negative element-group gap, i.e. the rear
  group solved to sit axially in front of the front group it is supposed to follow). This can happen because
  `focus.minFocusM` (often taken straight from a patent's stated closest-focus spec) has no code-enforced
  relationship to the separately authored/estimated `focus.gaps` table; nothing prevents the two from disagreeing,
  so a design whose `minFocusM` promises a closer focus than its `gaps` table can actually reach will throw for
  focus requests between the two rather than return an impossible geometry. Found and fixed 2026-09-28 (adversarial
  review, `e1b.verify.test.ts`); the `unit` focus method's extension solve was already safe from this (it throws
  on non-convergence with no intermediate silently-broken geometry — confirmed under an analogous stress test).
- Asphere coefficients scale with the design's `scale` factor (`A_n' = A_n / scale^(n-1)`, since sag must scale
  linearly); the conic constant `k` does not scale (dimensionless). Not golden-tested here (no asphere-bearing
  fixture in this workstream's scope) — worth a check once a real asphere-bearing design lands in `data/lenses`.
