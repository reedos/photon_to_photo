# Mirrorless-native normal prime: 50 mm f/1.8 (lens-m50)

Covers `data/lenses/m50.json`, a real patent numerical example transcribed and self-checked as
described below. Body target: Nikon Z8 (full frame, image height ~21.6 mm, Z mount, short flange
distance -> short back focus). Accessed date for every source is 9/28/2026 unless a publication
date is given.

## Summary

| Focal | Fno (patent) | Patent, example | Assignee | Published | Elements/Groups | Representative product (tie source) | Min focus (source) | Blades (source) | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|
| 50 mm | f/1.85 (raw f=51.60mm) | [WO 2019/220618 A1](https://patents.google.com/patent/WO2019220618A1/en), Ninth Embodiment / Example 9 / Table 9 | Nikon Corp | 11/21/2019 | 13/9 (engine count; Nikon's own product spec: 12/9, see notes) | Nikon NIKKOR Z 50mm f/1.8 S (photonstophotos.net Optical Bench Hub) | 0.40 m (nikonusa.com) | 9, rounded (nikonusa.com) | +0.0018% | -0.0002% (0.0000 mm) |

Both checks pass comfortably inside tolerance (EFL within 0.5%, BF within 1% or 0.2 mm). Total
lens length also reproduces the patent's own stated value (92.330 mm) to 5 decimal places, an
extra self-consistency check beyond the two required ones.

## Why this lens: mirrorless-native, not an adapted SLR design

Reed asked for a MIRRORLESS-native 50 mm f/1.2-f/1.8 full-frame normal prime with a short back
focus typical of mirrorless mounts, tied to a real product, for a Nikon Z8 body. Two mirrorless
50mm candidates were found in `.local/lens-normal/modeldata.tsv` (photonstophotos.net's Optical
Bench Hub, a table tying specific patent numerical examples to specific shipped products):
`WO2021-241230 Example01P -> Nikon Nikkor Z 50mm f/1.2 S` and `WO2019-220618 Example09P -> Nikon
Nikkor Z 50mm f/1.8 S`. A third, non-mirrorless candidate (`US20190265441 Example02P -> Canon
RF50mm F1.2 L USM`) was also fully transcribed and self-checked (EFL/BF both passed) before the
team's target body changed to a Nikon Z8; that Canon transcription was discarded per the
coordinator's instruction and is not part of this file or repo. The final choice, per the
coordinator's explicit follow-up instruction, is the NIKKOR Z 50mm f/1.8 S specifically (not the
f/1.2 S), tied via Example 9 / Table 9 of WO2019/220618A1.

This design's short back focus (patent's own BF = 13.100 mm from the last real lens-glass surface
to the image, vs. 35-40+ mm typical of an SLR-mount 50mm retrofocus design) is exactly the
"mirrorless short back focus" signature Reed asked for, made possible by the Z mount's large
diameter and short (16 mm) flange distance.

## How the self-check works

`.local/m50/selfcheck_m50.py` (copy in this project's scratch area, not committed) is a standalone
paraxial **y-nu** ray tracer, the same method as `.local/lens-normal/selfcheck.py` (see
`research/lenses-normal.md` for the full algorithm description: Ray A from infinity gives EFL and
BF, Ray B plus the stop's zero-crossing condition give a chief ray at `tan(halfFieldDeg)` for a
bonus image-height check, and a marginal ray scaled to the patent's own stated Fno gives
`sd(i) = |marginal(i)| + |chief(i)|` at every surface, matching `sdSource:
"estimated-from-marginal-ray"` in the JSON).

**One difference from the four lens-normal files**: this design lists an explicit filter/cover-glass
plate (patent surfaces 24-26: a flat air gap, a flat BK7-class filter, a final flat air gap) after
the last real lens element (patent surface 23), per `lens-types.ts`'s own documented convention
("unless a cover glass or filter follows (then list them as surfaces)"). That splits "back focal
distance" into two different numbers depending which reference point you mean:

- The **patent's own printed "BF"** (13.100 mm) is measured from patent surface 24 (the true last
  lens-glass-to-air surface, i.e. this file's surface index 23) to the image plane, spanning the
  10.500 + 1.600 + 1.000 mm trailing air-filter-air stack. Verified in
  `.local/m50/selfcheck_m50.py`'s own custom BF calculation (which locates that reference surface
  automatically, as the last non-plate glass surface's exit vertex): **error -0.0002% (0.0000 mm
  abs)**.
- **This codebase's own engine** (`src/engine/paraxial.ts` `cardinal()`: `bfd = -fwd.y/fwd.u`,
  traced through every listed surface including plates) checks `lenses.test.ts`'s
  `bfd within 1% or 0.2mm of stated.bf` against the paraxial distance from the JSON's own **last
  surface** to the image — i.e. the small 1.000 mm trailing air gap, not the patent's 13.100 mm
  figure. `design.stated.bf` in `data/lenses/m50.json` is therefore set to **1.000 mm** (the JSON's
  own last surface t), which is what the project's test actually needs and is what
  `npx vitest run src/engine/lenses.test.ts` checks and passes. The patent's own 13.100 mm BF is
  recorded in the JSON's `notes` array and in this file, not in `stated.bf`, specifically so it
  is never lost even though it isn't the number the automated test compares against.
- Both are internally consistent with each other and with the patent's own total lens length: TL
  (92.330) - vertex position of the last real lens surface (79.230, i.e. sum of surfaces 1-23's t)
  = 13.100 = the patent's BF, with no division by refractive index needed (this patent's "BF", unlike
  its separately reported "BFa", is the plain physical distance, not an air-equivalent one).

Run it yourself: `python .local/m50/selfcheck_m50.py` (points directly at
`data/lenses/m50.json`; the console output above is drawn from an actual run against the shipped
file, not a scratch copy).

## Research method

1. **photonstophotos.net's Optical Bench Hub** (`.local/lens-normal/modeldata.tsv`, a ~1280-row
   TSV of `{PatentID, ExampleID, TableID, Description}` extracted in an earlier session) was the
   lead-finding tool, same as for the four lens-normal files. Filtering for "Nikon" + "50" turned
   up both Z-mount 50mm patent ties (f/1.2 S and f/1.8 S).
2. `patents.google.com/patent/WO2019220618A1/en` fetched cleanly via a direct `curl` with a
   browser user-agent (HTTP 200, no 503 rate-limit encountered this session). Unlike the WO/PCT
   Sony 135mm patent documented in `research/lenses-normal.md` (whose tables were scanned images
   with zero text layer), this WO/PCT Nikon filing's tables render as ordinary machine-translated
   HTML text (`<span class="notranslate">...(Table 9)...</span>` blocks), directly parseable.
3. The English machine translation and the Japanese original (embedded in the same HTML document,
   in duplicate `google-src-text` spans immediately preceding each translated block) were
   cross-checked digit by digit for every value in Table 9's surface data, aspherical data and
   variable-interval data. They agreed exactly except one OCR/translation artifact: the English MT
   rendered surface 7's `nd` as "1.80 400" (a stray space splitting "1.80400"); the Japanese
   original reads "1.80400" cleanly, confirmed by the self-check passing EFL/BF to well under 0.01%
   (a wrong nd there would have thrown the trace off far more than that).
4. Maker spec (min focus, blade count, elements/groups) was fetched directly from
   `nikonusa.com/p/nikkor-z-50mm-f18-s/20083/overview` (HTTP 200; earlier URL guesses at
   `nikonusa.com/en/nikon-products/...` and `imaging.nikon.com/.../spec.html` both 404'd, and
   `dpreview.com/.../specifications` returned HTTP 403). The page's embedded JSON gives
   `"minimumFocusDistanceMetersAF":"0.4"` directly; the rendered spec table gives "Lens Elements:
   12", "Lens Groups: 9", "Diaphragm Blades: 9", confirmed by an independent web search that also
   surfaced "2 ED and 2 aspherical" elements (consistent with this transcription: ED glass at
   patent surface 18, nd=1.49782/vd=82.6, a textbook low-dispersion glass; aspheric surfaces at
   patent 6, 16, 17).
5. `usa.canon.com`, `en.canon-cna.com` and `www.dpreview.com` all refused direct `curl` fetches
   (HTTP 403) during the earlier (discarded) Canon RF50mm F1.2L USM research; `nikonusa.com` did
   not have this problem for the final Nikon target.

## Per-lens notes (see also the JSON's own `notes` array, which this duplicates in places for a
reader who only opens this file)

- **Element/group count discrepancy (13 vs. Nikon's 12 elements; both agree on 9 groups).**
  Patent surfaces 6-7 are a hybrid aspherical component: a thin resin replica layer (surface 6,
  t=0.100 mm) molded directly onto the front face of a glass substrate (surface 7), with no air
  gap between them — exactly as the patent's own surface table lists it (two consecutive rows,
  both carrying nd/vd, no air row in between). This schema's engine
  (`src/engine/lens.ts` `buildElementsAndGroups`) has no separate concept for a hybrid
  resin-on-glass component: any two glass surfaces joined with no intervening air become two
  cemented "elements" sharing one "group", the same rule it applies to a true two-glass cemented
  doublet. That gives this design 13 raw elements in 9 groups by the engine's own count (which is
  what `design.elements`/`design.groups` are set to, and what `lenses.test.ts` checks them
  against), one more element than Nikon's own published "12 elements" (which counts the hybrid
  resin+substrate as the single physical component it physically is). The **9 groups** figure
  matches Nikon's own spec exactly, which is strong independent structural corroboration that
  Example 9 (of nine numerical examples in this one PCT filing) is the right one. This is reported
  as a schema/engine limitation, not fixed by fudging the transcription — see BRIEF.md's "say
  plainly what is estimated" instruction.
- Three aspheric surfaces (patent 6, 16, 17) are all printed with kappa (K) = 1.00000. No explicit
  sentence defining what K=1 means was found in the machine-translated text, but (a) K=1 recurs
  identically on every aspheric surface across all nine examples in this one document, including
  ones whose other conditional-expression values look like ordinary well-corrected designs, and
  (b) treating it as "K=1 means a sphere, k=kappa-1=0" in this schema's own sag convention
  reproduces the patent's stated EFL and BF to a few parts in 100,000 — strong indirect
  confirmation this is the right reading, consistent with how p50.json/p105.json (Sigma/Nikon
  patents in the existing lens-normal set) treat their own printed conic parameters.
- Patent surface 13 is explicitly called a "virtual surface" in the patent's own text ("the
  thirteenth surface is a virtual surface"): flat, no medium change, a bookkeeping reference plane
  rather than a real optical element. Carried through as an ordinary flat air surface.
- Floating/inner focus: only the middle group (G2, patent surfaces 13-19) moves; G1 (surfaces
  1-12) and G3 (surfaces 20-26, including the fixed filter package) stay fixed. Modeled as
  `focus.method: "inner"` with two coupled variable gaps (d12, into G2's front; d19, out of G2's
  rear). The patent's own third "variable" gap, D26 (filter-to-image), is numerically fixed at
  1.000 mm at both infinity and its close-focus condition, so it is not listed in `focus.gaps` (no
  parameter would move it).
- `closeObjectDistance` (307.67 mm) is transcribed as printed in the patent's own [Variable
  interval data] `D0` row for Table 9; as with p24/p50 in the existing lens-normal set, the
  translated text does not state whether D0 is measured from the object to the first lens surface
  or to the image plane — recorded as-is with that caveat.
- `focus.minFocusM` (0.40 m) comes from Nikon's real product spec, not from this patent example's
  own close-focus condition (whose D0=307.67 mm / magnification -0.1565 reaches a different,
  farther close-focus point than the shipped lens actually achieves) — the engine's documented
  clamp-to-`minFocusM` behavior (`lens.ts` `systemAt()`) handles this gap the same way it does for
  every other lens in the set.

## Semi-diameter estimation caveat

None of the patent's nine numerical examples list effective/clear diameters for any surface. Every
`sd` value in `data/lenses/m50.json` is `sdSource: "estimated-from-marginal-ray"`, computed exactly
as described in "How the self-check works" above and in `research/lenses-normal.md`'s equivalent
section (paraxial marginal ray scaled to the patent's stated Fno=1.85, plus a paraxial chief ray at
the patent's stated half field 22.9 deg, added as absolute values). This is a first-order,
vignetting-blind estimate that should read as an upper bound on true clear aperture, particularly
toward the rear of the design.

## Open problems / uncertainty

- The 13-vs-12-elements discrepancy from the hybrid resin-on-glass aspheric (see per-lens notes
  above) is a real, understood, single-point difference between how this schema/engine counts
  refracting surfaces and how Nikon's marketing literature counts physical components. It does not
  affect the EFL/BF self-check (which traces the real surface data regardless of how the results
  are bucketed into "elements"), but a reader comparing `design.elements` against Nikon's own "12
  elements" spec sheet should know why they differ.
- `design.stated.bf` (1.000 mm) intentionally does NOT equal the patent's own printed "BF" value
  (13.100 mm) - see "How the self-check works" above for why, and the JSON's own `notes` array for
  the same explanation inline with the data.
- As with every patent-example lens in this project, `closeObjectDistance`'s reference plane (first
  surface vs. image plane) is not stated in the machine-translated text.
- This patent (WO2019/220618A1) has nine total numerical examples spanning a range of similar
  large-aperture 50mm-class designs (Tables 1-9); only Table 9 (tied to the f/1.8 S product by
  photonstophotos.net) was transcribed here. If a future task needs the f/1.2 S sibling, Example 1
  / Table 1 of the SAME patent family is a plausible next candidate (not yet checked), or the
  separately-numbered `WO2021-241230` patent that `modeldata.tsv` ties to the f/1.2 S specifically.
