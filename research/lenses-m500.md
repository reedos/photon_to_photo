# Mirrorless super-telephoto (m500) — research note

Agent: lens-m500. File: `data/lenses/m500.json`. Accessed date for every source below: 9/28/2026,
unless stated otherwise.

## What this file actually is, and why (target changed mid-task)

This slot went through three target changes in one working session, each from the coordinator:

1. Originally: a true mirrorless-native 500 mm prime, any of Sony FE / Nikon Z / Canon RF, no
   diffractive elements, ideally tied to a product via the Photons to Photos Optical Bench hub
   (`.local/lens-normal/modeldata.tsv`). That search found no 500 mm mirrorless prime in the hub
   at all (Sony FE 400mm F2.8 GM, Canon RF600mm F4L, Nikon's Z 400/600mm TC primes are all
   absent from `modeldata.tsv`), and a strong lead on an unreleased **Canon RF 500mm f/4L IS**
   patent design (JP2019-95525 / a 2024-refiled sibling JP2024-009238, per canonwatch.com
   articles dated 2/28/2022 and 1/19/2024) that was never turned into a shipping product.
2. Then: switched to Nikon, no diffractive, from the candidate list NIKKOR Z 400mm f/4.5 VR S /
   Z 400mm f/2.8 TC VR S / Z 600mm f/4 TC VR S. Found `WO2021220612A1` (Nikon Corp, via
   cameragossip.github.io's Nikon lens-patent database) tied to the Z 400mm f/4.5 VR S, with a
   clean f=390.00mm/Fno=4.60 Example 3 that would have been a strong candidate.
3. Finally (this file): diffractive elements explicitly allowed, target changed to the specific
   product **NIKKOR Z 600mm f/6.3 VR S (PF)**. This is what's transcribed below. Neither the
   WO2021220612A1 work from step 2 nor the Canon RF 500mm f/4 lead from step 1 is used or kept
   anywhere in this repo — this note records them only so the next person doesn't re-walk the
   same dead ends.

**This is a nearest-class substitute, not a 500 mm design.** Nikon's Z mount has no 500 mm prime
at all (mirrorless or otherwise) — its super-telephoto primes are 400mm f/2.8 TC, 400mm f/4.5,
600mm f/4 TC, 600mm f/6.3 PF, and 800mm f/6.3 PF. Per the brief's fallback rule (400–600 mm,
nearest class), this file uses the 600 mm class. `focalLength` is kept at `500` in the JSON
purely for slot/id continuity with this project's other lens files (p20...p500, all keyed by
their nominal class number) — the design itself is a 600 mm f/6.3 lens. Flagged here and in the
JSON's own notes array for whoever wires up the site's lens picker.

## The patent

**JP 2023-023323 A**, Nikon Corporation, "Optical system and optical equipment" (title
machine-translated), published (kokai) 2/16/2023.
<https://patents.google.com/patent/JP2023023323A/en> — a direct fetch returned HTTP 503 every
time it was tried in this session; all reads went through the r.jina.ai reader proxy,
`https://r.jina.ai/https://patents.google.com/patent/JP2023023323A/en`, which returns Google
Patents' own machine-OCR'd/translated HTML text, not the original PDF page images.

The patent contains at least 5 numerical examples across three focal-length classes:
Examples 1–2 at ~585 mm (Fno 5.71), Examples 3–4 at ~1000 mm (Fno 8.16), Example 5 at ~780 mm
(Fno 6.42). Example 1 (this file) is the ~585 mm pair, the class nearest to "600 mm f/6.3."
Example numbering/count is as read through the proxy; the full patent was not independently
re-verified page by page beyond Example 1's own numerical table (which is fully transcribed and
self-checked below).

### Why `representativeOf` is set to "Nikon NIKKOR Z 600mm f/6.3 VR S"

Per the coordinator's explicit instruction for this file only (see `representativeSource` in the
JSON for the full text). Three converging, but non-conclusive, points:

1. cameragossip.github.io's Nikon lens-patent database (a third-party curated tracker, not
   Nikon) ties this same patent family's neighboring filing to the shipped **NIKKOR Z 800mm
   f/6.3 VR S** (another PF lens released in the same generation) — no entry for the 600mm f/6.3
   VR S itself was found in that database, but the family match to Nikon's PF super-telephoto
   line is real.
2. This patent's own abstract explicitly describes a phase-Fresnel (multilayer DOE) telephoto —
   the same technology Nikon markets by name for this exact product — and Example 1's
   585.0002 mm/f5.71 is close to the "600 mm f/6.3" marketed class, the same size and direction
   of patent-vs-marketed gap seen in this project's other Canon telephoto files (p400: 392.6 vs
   400; p500: 490.9 vs 500).
3. This file's own mechanical element/group count from the transcribed surfaces (22 elements /
   13 groups — see "Element and group counting" below) lands within 1 of Nikon's published spec
   for the NIKKOR Z 600mm f/6.3 VR S (21 elements / 14 groups, nikonusa.com product page,
   accessed 9/28/2026).

None of this is a company-confirmed identification — no source states that this specific
numerical example became the shipped product. This is the same strength of circumstantial match
this project already accepts elsewhere without setting `representativeOf` (see p200.json,
p300/p400/p500's notes); this file sets it anyway because the coordinator asked for that
specifically for this slot.

## The diffractive surface (DOE / phase Fresnel)

Surface index 6 (0-based; patent's own surface 7) is the diffractive interface, described by the
patent (Table 2, verbatim as machine-translated):

```
psi(h,n) = (2*pi/(n*lambda0)) * (C2*h^2 + C4*h^4)
phiD(lambda,n) = -2*C2*n*lambda/lambda0
```

`h` = height above the axis (mm), `n` = diffraction order, `lambda0` = design wavelength.
Example 1's Table 2: `lambda0 = 587.6 nm`, `n = 1.0`, `C2 = -4.96241e-05`, `C4 = 1.65424e-09`.
At the design condition (`lambda = lambda0`, `n = 1`) the power formula reduces to
`phiD = -2*C2 = +9.92482e-05 mm^-1` — a very weak assist (equivalent to an added ~+10,076 mm
focal length contribution), not the dominant power source in this design; the DOE here is doing
corrective work (killing secondary-spectrum chromatic aberration), not image-forming work.

This surface's phase-function data is carried in a new schema field, `surfaces[i].doe`
(`convention`, `lambda0Nm`, `order`, `coeffs.C2`/`coeffs.C4`, `note`), not present in
`lens-types.ts` yet — the main ray-trace engine does not special-case it. Until another
workstream adds DOE tracing, this surface behaves in the shared engine exactly as its plain
`r`/`nd`/`vd` say (an ordinary, very weakly curved refracting interface) and does **not**
reproduce the patent's stated EFL/BF on its own.

Physically, the diffractive grating sits at the bonded interface between two different optical
materials (`nd=1.5295/vd=36.27` and `nd=1.5498/vd=50.91`, surfaces index 5 and 6), cemented to a
third, ordinary host lens element (`nd=1.5168/vd=64.13`, surface index 4) — a three-layer
"multilayer DOE" assembly, the same construction Nikon's own materials pages describe for its
Phase Fresnel lenses (two materials chosen so their dispersions cancel the diffraction
efficiency's wavelength dependence across the visible band). All three layers share the same
printed radius (131.4346 mm) across their surfaces, consistent with a grating molded onto a
shared conformal substrate shape rather than three independently-curved elements.

## Self-check (paraxial y-nu trace)

`.local/m500/paraxial.py` is a copy of `.local/lens-tele/paraxial.py`, extended with a
`doe_power` parameter: `trace_ray()` adds `-y * phiD` to the ray's reduced angle at any surface
carrying a `doe` field, on top of its ordinary refraction (`build_doe_power()` reads
`phiD = -2*C2*order` from the JSON directly). This is the standard thin-lens-kick treatment: a
paraxial element of power `phi` bends a ray at height `y` by `-y*phi`, regardless of whether that
power comes from a curved refracting surface or a diffractive grating.

```
$ python .local/m500/paraxial.py data/lenses/m500.json
  DOE surfaces found: {6: 9.92482e-05} (paraxial power, mm^-1, added at these surface indices)
=== m500 (600 mm f/6.3 phase-Fresnel super-telephoto ...) ===
  computed EFL = 585.0002 mm   stated f = 585.0002 mm   error = +0.000%  OK
  computed BF  = 95.6912 mm   stated Bf = 95.6894 mm   diff = +0.0018 mm  (tol 0.9569)  OK
  ...matches Fno=5.71 by construction (entrance pupil sized from stated Fno, see p500's method note)...
```

Both required tolerances pass (EFL within 0.5%, BF within 1%/0.2mm) — but only after fixing one
value diagnosed as a transcription error; see the next section.

### The d2 transcription problem and its fix

Every fetch of Example 1's variable-interval table (three independent attempts, via the same
r.jina proxy, on the same underlying Google Patents OCR/translation) returned
`d2 (infinity) = 44.58471 mm`. Taken at face value, that value fails both self-checks badly:
computed EFL = 498.63 mm (stated 585.0002 mm, **-14.76%**, tolerance is 0.5%) and computed
BF = 57.83 mm (stated 95.6894 mm, **-37.86 mm**, tolerance is 1%/0.2mm).

Four independent lines of evidence converge on this being a genuine OCR error in Google's
rendering of the source patent (not a modeling mistake in this file, and not solvable by
re-fetching the same broken pipeline again):

1. **Every other value re-confirmed twice.** The front group (patent surfaces 1–16) and rear
   group (17–36) were each independently re-fetched and transcribed a second time, in separate
   prompts, and matched byte-for-byte both times. `d2` was the one value never independently
   re-derived until this diagnostic.
2. **The patent's own named sub-groups check out using every other value as transcribed.**
   Isolating and paraxially tracing the patent's own three named groups (with the DOE's power
   folded into G1, since surface 6 sits inside it): G1 (surfaces 1–16) → EFL = 205.930 mm vs the
   patent's own stated G1 = 205.9 mm; G2 (surfaces 18–19, the single-element focus group) →
   EFL = -183.276 mm vs stated G2 = -183.3 mm; G3 (surfaces 20–36) → EFL = -147.498 mm vs stated
   G3 = -147.5 mm. All three match to 3–4 significant figures. This is strong evidence that
   every value used in these calculations — including `d1`, and every `r`/`t`/`nd`/`vd` in the
   whole table — is correct; `d2` doesn't participate in any of these three group calculations
   (a group's own EFL, as an isolated system, doesn't depend on the gap leading out of it), which
   is exactly why it was the one value this method couldn't already vouch for.
3. **The patent's own twin design.** Example 2, sharing the same architecture and near-identical
   overall specs (f=585.00008mm, Fno=5.71), prints `d2 (infinity) = 30.63380 mm` — a plausible
   neighborhood for Example 1's `d2`, nothing like 44.58471.
4. **Solving numerically for consistency.** Holding every other transcribed value fixed
   (including `d1 = 4.0` and the DOE power), the single value of `d2` that reproduces the
   patent's stated EFL exactly is **29.89188 mm** — which *also* reproduces the patent's stated
   BF to within 0.0018 mm. Two independently-stated patent quantities (f and Bf) both landing
   inside tolerance from adjusting one suspect number, with no remaining freedom to also fit Bf
   once f was matched, is not circular. A fourth check falls out of the same fix: the patent's
   own stated `TL = 309.4549 mm` does not match `sum(all fixed d's) + d1 + d2` under either the
   OCR'd or the derived `d2` *unless* this patent's own TL convention runs all the way to the
   image plane (i.e. `TL := that sum + Bf`, not the "first surface to last glass surface, Bf
   reported separately" convention this project's other lens files use) — with the derived `d2`
   and TL-including-Bf, the sum reproduces 309.4549 to within 0.001 mm.

**`data/lenses/m500.json` therefore uses `d2(infinity) = 29.89188` (surface index 18's
`focus.gaps[1].atInfinity`), not the OCR'd `44.58471`**, flagged explicitly in both the surface's
own `label` and a full-length notes entry ("DERIVED d2 VALUE") in the JSON, per the brief's
"never invent numbers" rule: this one number is a documented self-consistency reconstruction, not
a value read from a source, because every read attempt available in this session returned a
value demonstrably inconsistent with the patent's own other stated numbers. **It should be
re-verified against the original JP2023-023323 PDF page images before this file is treated as a
precise citation rather than a well-diagnosed reconstruction** — that primary-source access
wasn't available in this session (patents.google.com returned HTTP 503 on every direct attempt;
espacenet blocked the fetch with a bot-check page; no PDF URL for this specific patent could be
located).

`d2`'s close-focus value (`4.60934`) is kept as OCR'd/printed, since nothing in this diagnostic
implicates it — it is not independently re-verified either.

## Element and group counting

Counted mechanically and consistently with every other file in this lens set: every surface
whose `medium` is glass (not air) is one element; a run of consecutive glass elements with no
air gap between them is one group. The PF assembly (surfaces index 4, 5, 6 — the host singlet
plus the two-material diffractive doublet cemented to it) is counted as **3 elements in 1 group**
under this rule, same as every other cemented block in the file — **elements = 22, groups = 13**.

Nikon's own published spec for the NIKKOR Z 600mm f/6.3 VR S is 21 elements in 14 groups
(nikonusa.com product page, accessed 9/28/2026) — within 1 on both numbers, not identical. Likely
explanation: Nikon's marketing count very probably counts the whole PF assembly (or just its
diffractive doublet) as a single "PF lens element" rather than counting each bonded layer
separately, and/or groups the design differently elsewhere in the barrel. Not forced to match;
transcribed exactly as the patent's own surface table gives it, per this project's standing rule.

## Other specs, evidence kind, and what's assumed

- `minFocusM = 4.0` and `iris.blades = 9` (rounded) — both taken from the Nikon USA product page
  for the NIKKOR Z 600mm f/6.3 VR S (nikonusa.com, accessed 9/28/2026), evidence kind `assumed`,
  not tied to this patent example by any public source (same convention as every other lens file
  in this project's telephoto set).
- No aspheric coefficients are printed anywhere in Example 1's table — every `r` is a plain
  spherical (or flat, for the stop) radius; the one exception to "plain sphere" is the diffractive
  surface's own phase term, which is a separate additive effect, not an asphere.
- No effective/clear diameter is printed for any surface (same as every other file in this set);
  every `sd` is `sdSource: "estimated-from-marginal-ray"`, computed by `.local/m500/paraxial.py`
  using the same method as p200–p500.json: entrance-beam semi-diameter at surface 1 =
  `EFL / (2 * Fno)` from the stated f/Fno, traced forward through the corrected prescription
  (DOE power included), plus the paraxial chief ray at the patent's own printed half field
  (`omega = 2.10557 deg`).
- `maxFno` (5.71, the patent's own Example 1 value) vs `markedFno` (6.3, the marketed class): a
  larger gap than this project's other telephoto files (which run 0.05–0.4 stops). Both Examples
  1 and 2 in this patent give the same Fno=5.71, so this is a real feature of the patent's own
  numerical examples, not a single-example slip.
- `focus.method = "inner"`: the patent's own `d1`/`d2` pair describes a single element (the lone
  lens right after the aperture stop, surface index 17) sliding between two otherwise-fixed
  neighbors — `d1` shrinks by exactly as much as `d2` grows (and vice versa) between infinity and
  the patent's own close-focus example (magnification `beta = -0.18866`, object distance
  `d0 = 3090.5451 mm` per the patent's own printed value, raw — not independently confirmed to be
  measured from the sensor).

## Vitest results (`npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts`)

Both suites were run against the full repo, not just this file. Result: **27 tests fail total**
across three lenses — `m500` (this file, 12 tests: 7 in lenses.test.ts, 5 in realize.test.ts),
and two pre-existing lenses this workstream did not touch, `n500` (12 tests, same failure
signature) and `z35` (2 tests, an unrelated `afOffset` assertion). 215 tests pass.

**Every m500 failure has the same single root cause**, and it is not the DOE surface itself
(index 6) — it's the material bonded to it (index 5, `nd=1.5295`, `vd=36.27`, the first of the
two DOE resin layers). `loadLens()` in `src/engine/lens.ts` refuses any glass whose nearest
catalog match exceeds `dnd > 0.05` or `dvd > 5` ("catalog looks empty or wrong, refusing to use
it" — `FAIL_LOUD_MAX_DND`/`FAIL_LOUD_MAX_DVD`, lens.ts lines 20-21). The nearest catalog entry to
this DOE layer's material is `CDGM:QF3` (nd=1.575026, vd=41.297), which misses by `dvd = -5.03` —
just over the 5.0 cutoff. Since this is a **hard throw inside `loadLens()`**, the lens fails to
load at all, which cascades into every downstream test failing (including the EFL/BF checks,
which — per this file's own standalone Python self-check above — already pass once the DOE's
paraxial power is accounted for).

This is exactly the situation the coordinator anticipated: "the engine cannot trace DOE surfaces
yet... skip the vitest realize run if it fails only because of the DOE; report that." It is
reported here rather than worked around: the DOE resin material genuinely has no close catalog
neighbor (these are specialty diffractive-grating resins, not standard optical glasses catalogued
in `data/glass/catalog.json`), and forcing a closer catalog match by altering the transcribed
nd/vd would be inventing a number this project's own convention forbids. `n500.json` (a different
lens, not authored by this workstream) fails with the identical error shape on its own surface 6,
suggesting this is a known, shared gap across every DOE lens in this data set right now, not
specific to a transcription choice made here — worth flagging to whoever owns the glass catalog
and DOE-tracing workstreams.

## Open problems

1. **The `d2` (infinity) value is a diagnosed reconstruction, not a citation** — see "The d2
   transcription problem and its fix" above. Re-verify against the primary-source PDF page images
   before treating this file's numbers as more than a well-diagnosed best reconstruction.
2. **`representativeOf` is asserted, not proven.** See "Why `representativeOf` is set..." above —
   this is a looser evidentiary standard than every other lens file in this project's telephoto
   set uses, applied here specifically because the coordinator asked for it on this file.
3. **The DOE resin material (surface index 5) has no close catalog match**, so `loadLens()`
   refuses to load this lens at all in the current engine + glass catalog; every vitest check for
   `m500` fails as a result (see "Vitest results" above). The lens's own physics (EFL, BF, per-
   group focal lengths) are independently verified correct by the standalone Python self-check.
4. **The main ray-trace engine does not yet special-case the `doe` field.** Even once the glass-
   catalog gap above is fixed, `m500` will not reproduce its stated EFL/BF inside the shared
   engine until a workstream adds DOE-surface tracing (the `doe` field is present and complete on
   surface index 6, ready for that to consume).
5. **`focalLength: 500` names a 600 mm design.** Flagged for whoever wires up any UI that groups
   lenses by focal length — see "What this file actually is" above.
6. Did not independently verify surfaces 20-36 or the DOE's Table 2 coefficients against a third,
   differently-sourced transcription beyond the two r.jina.ai re-fetches (both through the same
   underlying Google Patents OCR) — the `d2` diagnostic above shows that source can be wrong, so
   anything not cross-checked by this note's four-point diagnostic (i.e., everything except `d2`
   itself) carries the same, lower-than-ideal confidence that a from-scratch PDF read would give.
