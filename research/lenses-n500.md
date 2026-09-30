# n500 -- Nikon AF-S NIKKOR 500mm f/5.6E PF ED VR (DSLR telephoto, Reed's own lens)

Agent: n500. File: `data/lenses/n500.json`. Scratch: `.local/n500/` (raw patent text fetch,
surface-table transcription staging, paraxial self-check script). Accessed date for every
source below: 9/28/2026.

## Summary

- **Product:** Nikon AF-S NIKKOR 500mm f/5.6E PF ED VR (F-mount, announced 8/23/2018), Reed's
  own lens, the DSLR body's telephoto slot per docs/PLAN.md's lens table.
- **Patent example used:** JP 2018-017857 A ("Optical system, optical instrument, and optical
  system manufacturing method"), Nikon Corporation. Filed 7/27/2016, published (kokai)
  2/1/2018, later granted as JP 6870230 B2 (5/12/2021).
  https://patents.google.com/patent/JP2018017857A/en (rate-limited with HTTP 503 on a direct
  fetch; retrieved via `https://r.jina.ai/https://patents.google.com/patent/JP2018017857A/en`,
  saved at `.local/n500/jp2018017857.txt`).
- The patent gives five numerical examples (OL1-OL5), spanning roughly 392/490/490/490/588 mm.
  **This file uses the Second Example (OL2)**: f = 489.70405 mm, FNo = 5.75019, omega =
  2.51062 deg, TL = 279.32422 mm (Table 5). OL3 and OL4 are near-duplicates of OL2
  (f approx 489.6-489.9 mm) but OL2 is the one used here; the other two are not transcribed.

## The tie to the real product

No public source states outright "JP 2018-017857 A Example 2 is the AF-S NIKKOR 500mm f/5.6E
PF ED VR", so this is a structural-signature tie, the same kind the project's other
`representativeOf` entries describe as "strong circumstantial" -- except here every countable
figure matches exactly, not approximately:

| | Patent (OL2) | Nikon's own spec page |
|---|---|---|
| Elements / groups | 19 / 11 (counted from the patent's own cementing-pattern text) | 19 / 11 |
| PF (diffractive) elements | 1 (surface m=8, marked `*`, inside lens L14) | 1 |
| ED-glass elements | 3 (nd=1.487490/vd=70.31 appears on 3 surfaces: L11, L12, L16) | 3 |
| Half angle of view (FX) | omega = 2.51062 deg (full angle ~5.02 deg) | 5 deg 00' (5.0 deg) |
| Fno class | patent's own stated Fno 5.75019 | f/5.6 marked (patents commonly print a Fno slightly looser than the marketed class; same pattern as p500.json's F4.1-vs-f/4) |

Source for the product-side numbers: Nikon's own spec page,
https://www.nikonusa.com/p/af-s-nikkor-500mm-f56e-pf-ed-vr/20082/overview, accessed
9/28/2026 -- "Lens Construction: 19 elements in 11 groups", "ED Glass Elements: 3",
"Phase Fresnel (PF): Yes", "Angle of View (FX-format): 5 deg 00'", "Minimum Focus Distance:
9.8 ft. (3.0 m) from focal plane", "Diaphragm Blades: 9". Checked directly (9/28/2026)
whether the page states a rounded-blade diaphragm shape: it does not; `iris.rounded: true`
is recorded as assumed, not sourced, per the JSON's own `iris.source` note.

The elements/groups count was independently derived from the patent's own descriptive text
(not copied from the spec page and back-fit): G1 = L11, {L12+L13 cemented}, L14 (the DOE
carrier lens -- its multilayer DOE structure counts as part of L14, not extra elements),
{L15+L16 cemented} = 6 elements / 4 groups. G2 (the sole focus group Gf) = {L21+L22 cemented}
= 2 elements / 1 group. G3 = {L31+L32}, {L33+L34}, L35, {L36+L37=CL31}, {L38+L39=CL32},
{L310+L311=CL33} = 11 elements / 6 groups. Total 19 elements / 11 groups -- landing on the
product's own published figure without having targeted it, which is the basis for setting
`representativeOf` (every other lens in this project's tele/normal/wide sets leaves it unset).

## The DOE: patent's own formulas, transcribed verbatim

Patent text (`.local/n500/jp2018017857.txt`, lines 249-266), phase shape equation (c):

    psi(h, n) = (2*pi / (n*lambda0)) * (C2*h^2 + C4*h^4)
    h: height perpendicular to the optical axis
    n: order of the diffracted light
    lambda0: design wavelength
    Ci: phase coefficients (i = 2, 4)

and paraxial power equation (d), for the diffractive surface's power at any wavelength lambda
and order m (patent's variable name; this project's `doe.order` field stores the *design*
order n=1, the value equation (d) is evaluated at for the self-check below):

    phiD(lambda, n) = -2 * C2 * n * (lambda / lambda0)

Table 6 ("diffractive optical surface data"), the row for surface m=8 (OL2's DOE surface,
marked `*` in Table 5): `lambda0 = 587.6, n = 1.0, C2 = -4.25304E-05, C4 = 3.00000E-10`.
Transcribed exactly into `data/lenses/n500.json`, surface index 7 (0-based), field `doe`.

The DOE itself is Nikon's "close-contact multilayer type" (patent's own term, 密着複層型):
two different materials laminated directly onto the concave rear face of lens L14, with the
diffractive relief grating at the interface between them. **The patent does not name either
material** (no resin/glass trade name, just the two nd/vd rows already present in the surface
table for the layers on either side of the grating -- surfaces m=7 and m=8). This is recorded
plainly in the `doe.note` field rather than invented.

## Paraxial self-check (python, `.local/n500/paraxial_n500.py`)

Same y-nu sequential paraxial method as `.local/lens-tele/paraxial.py` (reused for
p200/p300/p400/p500), extended to add the DOE surface's own paraxial power -- via the patent's
own equation (d), evaluated at lambda = lambda0 = 587.6 nm, order n = 1 (the wavelength/order
the patent's stated f/Fno/Bf are themselves given at) -- on top of the ordinary refractive
power at that one surface (surface index 7 / patent m=8). Script output:

```
=== n500 (Nikon JP2018-017857A, Example 2 / OL2) paraxial self-check ===
DOE surface index (0-based) = 7  (patent m=8)
phiD (d-line, order 1) = 8.50608000e-05 mm^-1  ->  fpf = 11756.2967 mm   (patent's own stated fpf = 11756.3 mm, diff = -0.0033 mm)

computed EFL (with DOE power) = 489.7094 mm   stated f = 489.70405 mm   error = +0.0011%   OK  (tol 0.5%)
computed BF  (with DOE power) = 64.3982 mm   stated Bf (infinity, Table 7) = 64.39657 mm   diff = +0.0016 mm  (tol 0.6440 mm / 1%)   OK

For comparison, a plain refractive-only trace (DOE power = 0, i.e. treating the DOE surfaces as
ordinary glass interfaces with no diffraction) gives:
  EFL = 538.9407 mm  (error +10.054%)   BF = 79.5010 mm  (diff +15.1045 mm)
  -- this is expected to be off since it omits the diffractive power entirely.
```

Both EFL (within 0.5%) and BF (within 1% / 0.2 mm, and here against a genuine patent-printed
Bf value, not a derived one -- see below) pass, and only when the DOE's own paraxial power
(equation d) is included: the refractive-only trace of the same surfaces is off by about 10%,
confirming the diffractive term is load-bearing for this lens, not optional. `fpf` (the DOE's
own focal length, computed independently from `phiD`) matches the patent's directly-stated
Table 8 value (11756.3 mm) to better than 0.01%, which is itself a non-circular check that
equation (d) was applied correctly (fpf isn't an input to the EFL/BF trace; it's the same
`phiD` value inverted).

Unlike the shared Canon patent behind p300/p400/p500 (which prints only a `D(last)=0.000`
table-terminator, no real Bf), this Nikon patent -- like p200's -- prints a genuine, separate
Bf label in Table 7 (64.39657 mm at infinity focus). `stated.bf` in the JSON is therefore
patent-stated, not derived, and the last surface's `t` is set to that printed value directly.

Table 7 also gives a full near-focus condition for this numerical example (D0 = 2720.0000 mm,
beta = -0.18012, D1 = 39.16215, D2 = 15.39786, Bf = 64.43514) -- unlike the p300/p400/p500
family, which prints only the infinity state for these examples. Both variable gaps (D1 at
surface index 11, D2 at surface index 14) are transcribed as real `VariableGap` entries in the
JSON with real printed atClose values, not invented placeholders. The small Bf drift across
focus states (64.39657 / 64.40466 / 64.43514 mm) is real (typical of floating/inner-focus
designs) but is carried only as a note, not as its own gap entry, following the p200.json/
p105.json convention of using `focus.gaps` for internal element-group spacing only.

## Semi-diameters

No effective/clear diameter is printed anywhere in this patent (same situation as every other
telephoto in this project). Every `sd` in `data/lenses/n500.json` is
`sdSource: "estimated-from-marginal-ray"`, via the same marginal-ray-sized-from-stated-Fno
plus paraxial-chief-ray method as `.local/lens-tele/paraxial.py`, with the DOE's paraxial power
folded into the same trace (`.local/n500/paraxial_n500.py`'s `estimate_semidiameters`). Full
per-surface table is in that script's stdout; the entrance-beam semi-diameter at surface 1
comes out to 42.582 mm = EFL/(2*Fno), and the traced semi-diameter at the stop is 11.610 mm.

## Engine test results -- `npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts`

After fixing one real (non-DOE) bug -- `maxFno` was initially rounded to 5.75, but every other
file in this project sets `maxFno` to the patent's exact `stated.fno`, and the golden test
enforces `design.maxFno === design.stated.fno` byte-for-byte; fixed to 5.75019 -- **every
remaining n500 failure traces to one single root cause**:

```
Error: lens.ts: loadLens: surface 6: nearest catalog glass HIKARI:J-F16 (nd=1.5927, vd=35.271777)
is too far from the requested nd=1.5278, vd=33.41 (dnd=-0.0649, dvd=-1.86) — catalog looks
empty or wrong, refusing to use it
```

Surface index 6 (0-based) is the DOE's *first* multilayer material (patent m=7, immediately
before the marked DOE surface m=8) -- nd=1.5278, vd=33.41. This is not a transcription error:
a script check of every other glass surface in this file against the actual 1,613-glass
catalog (`.local` check, not committed) shows every ordinary lens glass matches a real
HIKARI/CDGM catalog entry almost exactly (dnd < 0.0001, dvd < 0.01 in every case) -- consistent
with this being a real, catalog-sourced Nikon lens. Only the two DOE layer materials are
unusual: the second layer (m=8 itself, nd=1.5571/vd=49.74) happens to land close enough to
CDGM:H-BAF2 to pass the engine's `FAIL_LOUD_MAX_DND`/`FAIL_LOUD_MAX_DVD` hard-error gate
(dnd=-0.0126, dvd=+0.287, both under the 0.05/5 threshold) and would resolve to a `model` glass;
the first layer material (m=7) does not (dnd=-0.065, dvd=-1.86, over the 0.05 threshold), and
`loadLens` throws before any test assertion runs. That single throw cascades into every
downstream test for `n500` in both `lenses.test.ts` (7 tests) and `realize.test.ts` (5 tests),
since both build the same lazily-cached `loadLens` result once per test file.

**This is exactly the DOE-shaped failure the task anticipated, not a data bug, and it is not
worked around here.** The two "glass" media on either side of the diffractive relief grating
are real optical materials from the patent's own printed nd/vd (proprietary resins Nikon does
not name -- see the DOE section above), not catalog glasses; the engine has no path yet to
trace a diffractive surface's phase term (`doe.note` on the JSON's surface says so, and
docs/PLAN.md lists diffractive tracing as future work), and no path to accept a non-catalog
"glass" medium that the loud-fail gate is specifically designed to reject rather than silently
mismatch. No number in `n500.json` was changed to dodge this -- `maxFno` was the only fix, and
it was a real, independently-verifiable, non-DOE bug (a rounding mismatch against the file's
own `stated.fno`).

Two unrelated pre-existing failures were observed in the same test run and are **not** part of
this task: `m500` (a different lens file, presumably another agent's Z-mount telephoto,
apparently with its own catalog-mismatch and EFL/BF issues) and `z35` (an unrelated normal-lens
EFL/BF and best-focus failure). Neither file was touched by this task.

## A second, independent DOE-caused test gap (elements count)

Even setting the catalog-mismatch failure aside, `element count matches the file (19; plates
are not elements)` would **still fail once the DOE is loadable**, for a second and distinct
reason, also caused by the DOE: `src/engine/lens.ts`'s `buildElementsAndGroups` counts one
"element" per surface whose own medium is non-air (i.e. one per glass *segment*, not one per
physical lens). For an ordinary cemented doublet that is exactly right (2 glass segments = 2
physical lens pieces). But L14 (the DOE carrier lens) is ONE physical lens with a two-material
diffractive coating stack bonded to its rear face -- three glass segments (base glass, DOE
layer 1, DOE layer 2) for one physical element. A local, uncommitted check
(`elements = [i for i,s in surfaces if s.medium != 'air']`, then grouping consecutive indices)
against this file's own surfaces confirms the engine's rule would count 21 elements here (11
groups, correctly, since grouping only cares about adjacency, and it gets that right), not 19.

19 is kept as `elements` in `data/lenses/n500.json` because it is what the task asked to check
against and what Nikon's own product spec states, and because it is the same convention this
project already uses to say "count physical lens pieces, not internal cemented interfaces" (a
cemented doublet's own interface isn't double-counted as if it added an element). The DOE's
laminated layer structure is the same idea one level further, and the schema already has a
precedent for excluding a surface from the count when it is not a full lens element of its own
(`plate`). It has no equivalent flag yet for "DOE sub-layer, not a separate element" -- that is
a schema/engine decision for whichever workstream adds DOE tracing, not invented here. Recorded
in the JSON's own `notes` and here so it isn't mistaken for a transcription slip once someone
gets far enough to see this specific assertion run.

## Open problems

1. **The DOE cannot be traced by the engine yet.** The paraxial self-check above is a
   standalone python verification (`.local/n500/paraxial_n500.py`), not an engine code path;
   `npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts` fails for `n500`
   specifically and only because of the two DOE-adjacent "glass" media the engine's catalog
   gate correctly refuses to fake-match. This will resolve once whichever agent adds DOE
   surface tracing also decides how `loadLens` should treat a non-catalog diffractive-layer
   medium (a new `medium` kind, e.g. `"doe-layer"`, seems like the natural fix, but that is a
   schema/engine decision for that workstream, not this one).
2. **The DOE's two layer materials are unnamed by the patent.** Only nd/vd are given, no
   resin/glass identity. Recorded as such in `doe.note`.
3. **representativeOf is asserted on a structural match, not a citing source**, same caveat as
   every other tied lens in this project -- but here every countable figure (elements, groups,
   PF count, ED count, angle of view) matches the real product's own spec sheet exactly, which
   is the strongest tie in this project's lens table to date.
4. OL3 and OL4 (the patent's other two near-490mm examples) were not compared in detail beyond
   their headline f/Fno numbers; OL2 was chosen as the first exact match found and not
   re-verified against OL3/OL4 for a possibly closer fit. Given all three examples independently
   describe closely related but distinct designs (this is normal for a multi-embodiment patent),
   this is a reasonable choice but not an exhaustive one.
