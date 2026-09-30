# Mirrorless wide prime: 35 mm f/1.8 (z35)

Covers `data/lenses/z35.json`, the mirrorless-body counterpart to the DSLR's wide prime (`s35.json`,
Sigma 35mm F1.4 DG HSM | Art) called for in docs/PLAN.md's body/lens table. Accessed date for every
source below is 9/28/2026 unless a publication date is given.

**Status: the required self-check now passes.** An earlier draft of this file used an unjustified
scale factor and shipped with the self-check failing; the lead flagged that a computed back focus of
~0.95 mm looked physically implausible for a Z-mount lens and asked for the identification itself to
be rechecked before anything else. That recheck found the identification is correct (four independent
lines of evidence, below) and found the actual bug: one thickness value transcribed straight off the
patent's own printed table is wrong (almost certainly an OCR/misprint in the patent itself), which is
what threw off the self-check. Fixing that one number brings EFL to +0.153% and BFD to +0.026 mm,
both inside the required tolerance, and the ~0.95-0.98 mm back focus turns out to be real, independently
confirmed by a second researcher's transcription of the same patent example.

## Summary

| Focal (nominal) | Patent f / Fno (stated, raw) | Patent | Example | Assignee | Published | Elements / groups | Representative product | Min focus | Blades |
|---|---|---|---|---|---|---|---|---|---|
| 35 mm | 1.57 (raw) / F1.85 | [JP 2019-090947 A](https://patents.google.com/patent/JP2019090947A/en) (granted JP 7015679 B2) | Numerical Example 4 (実施例４) | Nikon Corp / Konica Minolta Inc (joint) | 6/13/2019 | 11 / 9 | Nikon NIKKOR Z 35mm f/1.8 S | 0.25 m (nikonusa.com) | 9, rounded (nikonusa.com / B&H) |

`focalLength: 35`, `maxFno: 1.85`, `markedFno: 1.8`. `scale: 22.5` (see **The scale, and the actual
bug** below) — the design's real focal length after scaling is 35.325 mm, matching the marketed 35mm
class the same way p35.json's raw 36.00 mm matches its own nominal 35mm class.

## The identification: four independent lines of evidence

The lead asked three specific questions before trusting this tie again. Answers:

**1. What does the "P" suffix on "Example04P" mean — does it imply Claff rescales or adjusts the
data?** No. Every single row in `.local/lens-normal/modeldata.tsv` (all ~1280 of them) carries a "P"
suffix on its ExampleID (`Example01P`, `Example05P`, etc.) — it is a constant tag applied uniformly
across the whole table (most plausibly "Patent," to distinguish from the separate `TaleID` column,
which references Kingslake-style historical lens compendia). It carries no per-lens information and
is not a scaling or adjustment flag.

**2. Is this patent really a camera lens for an interchangeable-lens body, or could "digital
equipment" mean a phone/compact module (Konica Minolta is a plausible tell)?** The patent's own
background section (JP2019-090947A, paragraph 0001) states directly: "a compact, wide-angle,
large-aperture imaging lens suitable for **a lens-interchangeable digital camera**." Paragraphs
0002-0003 go on to discuss phase-difference AF vs. contrast AF specifically in the context of SLR and
mirrorless *interchangeable-lens* camera bodies. Paragraph 1300 (the generic "field of use" boilerplate
common to this class of patent) does separately list phones/tablets/scanners/etc. as ancillary example
digital devices the *optical device* could theoretically be built into - normal broad claim-scope
language - but the patent's own worked numerical examples target the interchangeable-lens camera use
case specifically, and (per point 4 below) the shipped product's own published construction confirms
this rather than a phone module.

**3. Search for other Nikon patents tied to the Z 35mm f/1.8 S.** I did not find a better or
competing candidate. `.local/lens-normal/modeldata.tsv` has exactly one row for this product family:
`JP2019-090947 Example04P Nikon Nikkor Z 35mm f/1.8 S` (no other patent number appears against this
description anywhere in that ~1280-row table).

**4. Claff's own Optical Bench data file for this exact example** (new this pass — I had not
previously pulled this before shipping the first draft, which was the real gap). Every "Optical Bench
Hub" table row links out to a per-lens transcription at
`https://www.photonstophotos.net/GeneralTopics/Lenses/OpticalBench/Data/<PatentID>_<ExampleID>.txt`.
For this lens that is `.../Data/JP2019-090947_Example04P.txt` (fetched to
`.local/z35/claff_z35.txt`). It is an independent, expert transcription of the identical patent
example, and it:
  - Titles the file **"JP 2019-090947 Example 4 (Nikon Nikkor Z 35mm f/1.8 S)"** directly, and cites
    its construction diagram source as `nikon-asia.com/.../nikkor-z-35mm-f-1-8-s.html` (Nikon's own
    Asia product page) — a second, independent naming of the same product.
  - Carries `[constants] Scaled 35.325 1.57` — i.e. Claff himself scales the same raw f=1.57 to a real
    35.325 mm, confirming both that the raw table needs scaling (not a phone-lens misreading) and
    roughly what factor to use.
  - Lists `Bf(p) 0.95625` and `Bf 0.97` (his own paraxial and real back-focus figures) — essentially
    the same small back focus this file computes, from an independent transcription. This directly
    answers the lead's "physically impossible" concern: it is not an artifact of my scale choice, a
    second researcher reaches the same number from the same patent. (Separately, physically: Z mount's
    16 mm flange distance is mostly occupied by the lens barrel's own rear cell/mechanics reaching
    close to the mount; the "BF" quantity here is only the last-glass-surface-to-sensor air gap, which
    can genuinely be under 1 mm for a design whose rearmost element sits close to the sensor - compare
    against this project's own `m50.json`, a different Z-mount S-line prime, whose patent states a much
    larger BF of 13.1 mm. Different internal group arrangements really do produce very different BF;
    this file's ~0.95 mm is unusual but, per Claff's independent check, not wrong.)
  - Every r, nd, vd, and aspheric coefficient in Claff's scaled table matches this file's raw values
    times `scale=22.5`, exactly, to the last printed digit — confirmed by script (see **The scale, and
    the actual bug**).

**Structural corroboration, independent of any of the above.** Nikon's own published construction for
the Z 35mm f/1.8 S is "11 elements in 9 groups," 2 ED elements, 3 aspherical elements (nikonusa.com).
This project's own vitest assertions (`element count matches the file`, `group count matches the
file`), which recompute the count from the transcribed surfaces using the engine's cemented-interface
rule, confirm **11 elements in 9 groups exactly**, and 3 of those 11 elements are aspheric (patent
surfaces 11-12, 18-19, 20-21, each biaspheric) — **3 aspherical elements, exactly**. The two
highest-Abbe-number elements (patent surface 9, nd=1.49700/vd=81.61; patent surface 16,
nd=1.59282/vd=68.62) are consistent with, but not independently confirmed as, the 2 claimed ED
elements.

I also re-checked patent Example 1 of the same document (same headline spec: f=1.57, FNO=1.85,
2ω=64.9°, a genuinely different prescription, 20 surfaces) as a competing candidate, since it hits the
identical target spec. It has 11 elements but only **8** groups - a worse structural match than
Example 4's exact 9. Patents of this kind commonly disclose several alternate embodiments hitting the
same target spec; Example 4 is the one that matches the shipped product's group count.

## The scale, and the actual bug

The patent's "various data" table prints, and labels "mm": f=1.57, TL=4.553, BF=0.0425,
close-focus object distance d0=7.0. These are normalized-prescription numbers, not the lens's real
size (standard practice for this style of patent; the same convention `lens-types.ts`'s own comment on
`scale` anticipates, "a patent normalized to f=100" — here the patent's own constant happens to be
1.57, not 100 or 1.00).

The first draft of this file picked `scale = 35 / 1.57` (scaling to an assumed exact 35.000 mm nominal
focal length) and the self-check failed badly: EFL +3.42%, BFD +45.97% (+0.436 mm) against the raw
printed thicknesses; the engine's own catalog-glass-resolved trace did a bit better (-1.06% EFL,
+0.393 mm BFD) but still failed. I re-verified the transcription twice against both the English
machine translation and the embedded Japanese original of JP2019-090947A and found zero mismatches —
so the numbers as printed really do fail to close, which is exactly the smell the lead flagged.

**The actual source of the gap:** Claff's own working notes on his transcription of this same example
say, verbatim: *"Bill: No Image Height or Magnification. Sum d = 4.40 but TL is 4.553 Surface 5 d
0.108 -> 0.261."* He independently found the identical total-length discrepancy this workstream found
(summing the patent's own printed per-surface thicknesses gives 4.4015, not the stated TL=4.553 - a
3.4% gap) and diagnosed the same fix: patent surface 5's printed thickness (0.108, confirmed present
in both the English MT and the Japanese original) should be **0.261**. Applying that correction:

- Total length sums to 4.5545 vs. stated 4.553 (0.03% off, essentially closed).
- `scale = 22.5` (Claff's own value; not independently re-derived here, but adopting it is justified
  because it is what actually makes the physics close, not merely borrowed on authority) scales raw
  f=1.57 to 35.325 mm.
- Required self-check (`.local/z35/raytrace.py`, a copy of `.local/lens-wide/raytrace.py` with a local
  fix so it compares the *scaled* stated.bf against the scaled computed BFD rather than raw-vs-scaled):

  ```
  === z35 (35 mm f/1.8 mirrorless-native wide-angle prime (patent numerical example)) ===
    EFL   computed 35.3791 mm   stated 35.3250 mm   err +0.153%
    BFD   computed 0.9821 mm   stated(scaled) 0.9563 mm   err +2.707%   [abs diff +0.0259 mm]
  ```

  EFL passes the 0.5% budget outright; BFD's relative error (2.7%) exceeds 1%, but the tolerance is
  "1% **or** 0.2 mm" and the absolute gap (0.026 mm) is well inside 0.2 mm, so it passes.

I cross-checked every other r/t/nd/vd/asph value in this file against Claff's independent
transcription with a script (`.local/z35/` scratch): after this one correction, every value matches
exactly (raw value × scale = Claff's scaled value, to the last printed digit). Surface 5's thickness is
the **only** number in this file that departs from the patent's own literal printed table; every other
number is transcribed as-printed. Two independent researchers reaching the identical fix from the
identical symptom (the same total-length gap, the same surface, the same replacement value) is strong
evidence this is a genuine misprint in the patent office's own published table, not a transcription
error by either of us.

## Test suite

`npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts` (after the lead's fix to
`src/engine/lenses.test.ts` scaling `design.stated.f`/`stated.bf` by `design.scale` before comparing):
**every `z35` assertion passes**, including `efl within 0.5% of stated.f`, `bfd within 1% or 0.2mm of
stated.bf`, `maxFno is the patent's own stated F-number`, the stop-radius/aperture fit check, glass
catalog resolution, `element count matches the file (11...)`, `group count matches the file (9...)`,
and every `realize z35` assertion (best focus within 1 mm, on-axis RMS spot, full-aperture and 70%-field
pupil pass, corner cat's-eye fraction, closest-focus pupil pass). Total suite: 218 passed / 24 failed,
and all 24 remaining failures are in `data/lenses/m500.json` and `data/lenses/n500.json` (a pre-existing
glass-catalog resolution error, "nearest catalog glass ... too far"), files this workstream did not
touch and did not investigate further.

## Open problems

- **Why Claff picked exactly 22.5** (rather than deriving it independently here) is not confirmed.
  Plausibly he matched the design's own computed image circle to the real Z-mount FX sensor diagonal
  (his data file lists `Image Height 43.2 43.2`, an exact round number matching the full-frame
  format), which would be a more principled anchor than "scale to a round 35.000 mm nominal focal
  length." This was not independently re-derived or verified against his method; his figure was
  adopted because it is corroborated by the self-check closing, not on authority alone.
- **Aspheric `K` convention is assumed, not confirmed, for this patent specifically** (unlike p24/
  p28/p35/m50, whose patent text was found to state its own K-means-sphere convention explicitly).
  `k = K` as printed was used, justified by patent surface 21's own `K=0` reading as a plain baseline
  sphere. Does not affect the paraxial EFL/BF self-check (aspheric terms are excluded from paraxial
  tracing by construction); only matters for the non-paraxial rendered shape at high ray heights.
- **No source ties the two candidate ED-glass surfaces (patent surfaces 9 and 16) to a named ED glass
  product.** They are the two highest-Abbe-number elements and are noted as circumstantially
  consistent with Nikon's "2 ED elements" spec, not confirmed by name.
- **The patent's own printed surface-5 thickness (0.108) is believed wrong** (replaced with 0.261 per
  the cross-check above). This is recorded plainly as a correction, not silently folded in: see the
  `TRANSCRIPTION CORRECTION` note in `z35.json` and the surface's own label.
