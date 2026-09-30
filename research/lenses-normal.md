# Normal / short-tele primes: 50, 85, 105, 135 mm (lens-normal)

Agent: lens-normal. Covers `data/lenses/p50.json`, `p85.json`, `p105.json`, `p135.json`. All four are
real patent numerical examples, transcribed and self-checked as described below. Accessed date for
every source in this note is 9/28/2026 unless a publication date is given.

## Summary table

| Focal | Fno (patent) | Patent, example | Assignee | Published | Elements/Groups | Representative product (tie source) | Min focus (source) | Blades (source) | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|
| 50 mm | f/1.46 (raw f=49.58mm) | [JP 2015-114366 A](https://patents.google.com/patent/JP2015114366A/en), Numerical Example 1 | Sigma Corp | 6/22/2015 | 13/8 | Sigma 50mm F1.4 DG HSM \| Art (photonstophotos.net Optical Bench Hub) | 0.40 m (sigma-global.com) | 9, rounded (sigma-global.com) | +0.006% | +0.001% (0.0004 mm) |
| 85 mm | f/1.46 (raw f=83.58mm) | [JP 2011-170128 A](https://patents.google.com/patent/JP2011170128A/en), Numerical Example 5 | Sigma Corp | 9/1/2011 | 11/8 | Sigma 85mm F1.4 EX DG HSM (camera-wiki.org "Lens patents"; corroborated by photonstophotos.net) | 0.85 m (sigma-global.com) | 9, rounded (sigma-global.com) | +0.003% | not checkable (patent never states BF; see notes) |
| 105 mm | f/1.45 (raw f=102.148mm) | [WO 2019/116563 A1](https://patents.google.com/patent/WO2019116563A1/en), Table 3 / Third Embodiment | Nikon Corp | 6/20/2019 | 14/9 | Nikon AF-S NIKKOR 105mm f/1.4E ED (photonstophotos.net Optical Bench Hub) | 1.0 m (nikonusa.com) | 9 (nikonusa.com) | +0.001% | +0.001% (0.0005 mm) |
| 135 mm | f/1.854 (raw f=130.95mm) | [WO 2019/187633 A1](https://patents.google.com/patent/WO2019187633A1/en), Table 1 / First Embodiment | Sony Corp | 10/3/2019 | 13/10 | Sony FE 135mm F1.8 GM / SEL135F18GM (photonstophotos.net Optical Bench Hub) | 0.70 m (dpreview.com, reproducing Sony's spec; sony.com would not load) | 11 (dpreview.com) | +0.005% | +1.145% (0.0115 mm, passes on the abs-mm criterion) |

All four pass the required self-check tolerance (EFL within 0.5%, BF within 1% or 0.2 mm) except p85,
whose patent never states a numeric BF at all (see per-lens notes) — for that one only the EFL check
applies.

## How the self-check works

`.local/lens-normal/selfcheck.py` is a standalone paraxial **y-nu** ray tracer (no external optics
library). For each lens it traces two independent paraxial rays through `surfaces[]` at the
infinity-focus gaps stored on `surfaces[i].t`:

- **Ray A** (y₁=1, u₁=0): the axial marginal ray from an object at infinity. From this alone:
  `EFL = -1/u'_last` and `BF = -y_last/u'_last` (both compared against `stated.f` / `stated.bf`).
- **Ray B** (y₁=0, u₁=1): a second independent ray, used only to build a chief ray.
- **Chief ray** = a linear combination of A and B chosen so it crosses the stop at height 0, launched
  at `tan(halfFieldDeg)` (not `halfFieldDeg` in radians — see the "tan vs radians" note below). Its
  image-plane height is compared against `stated.imageHeight` as a bonus (not required) cross-check.
- **Fno / semi-diameters**: none of the four patents print an effective-diameter column, so there is
  no independently-given stop diameter to check Fno against. Instead we scale Ray A so its final
  convergence angle matches the **patent-stated** Fno (`k = EFL/(2*Fno_stated)`), which is how big the
  real marginal ray must be — this necessarily reproduces `Fno_stated` at the stop by construction, so
  it is **not** an independent check, only a self-consistency step. `sd(i) = |k*y_A(i)| + |chief(i)|`
  at every surface is what `sdSource: "estimated-from-marginal-ray"` means in the JSON: full-aperture
  marginal ray plus full-field chief ray, added in quadrature-free (absolute-value) combination. This
  ignores vignetting, so it should read as an *upper bound* on true clear aperture, especially toward
  the rear of each design where real lenses vignette corners to save weight.
- A third script-level check compares each `focus.gaps[i].surface` index against the corresponding
  `surfaces[surface].t`, to catch indexing mistakes (this caught and fixed a real off-by-one bug in
  the first draft of p135's gap list, described below).

**tan(ω) vs ω in radians**: the first version of the chief-ray check used `u1 = halfFieldDeg` directly
in radians and got large (5–6%) image-height errors that looked like transcription mistakes. They
were not: patents define image height as `Y = f*tan(ω)`, and at ω≈10–24° the small-angle
linearization is off by several percent. Switching the chief ray's launch slope to `tan(halfFieldDeg)`
brought all three checkable lenses to well under 1% (p50 +0.125%, p105 -0.301%, p135 -0.024%),
confirming the surface data itself, not the check, had been the problem.

Run it yourself: `python .local/lens-normal/selfcheck.py` (reads `.local/lens-normal/scratch_json/`;
point it at `data/lenses/*.json` directly to re-verify the shipped files — both were run and produce
identical numbers, shown in the table above and in the transcript this note is drawn from).

## Research method

1. **photonstophotos.net's Optical Bench Hub** (`OpticalBenchHub.htm`) turned out to hold its ~1280-row
   table in a client-side JS array (`var modeldata = [...]`) inside the static HTML, not a live
   fetch — a plain `curl` + regex extraction pulled all rows (saved as
   `.local/lens-normal/modeldata.tsv`). Each row is `{PatentID, ExampleID, TaleID, Description}` and
   ties a specific patent **example number** to a specific commercial lens name. This was the primary
   lead-finding tool for all four lenses, and the primary tie source for 50/105/135mm.
2. **camera-wiki.org "Lens patents"** gave an independent corroborating tie for the 85mm patent
   (same patent number, filing/publication dates, and inventor name match exactly against the patent
   itself), used because photonstophotos.net's own hub table also carries the identical tie
   (`JP2011-170128 Example05P Sigma 85mm F1.4 EX DG HSM`).
3. Patent text/tables were fetched directly (`curl` to `patents.google.com/patent/<ID>/en`) and parsed
   with a small Python HTML-to-text script (strip `<script>/<style>`, turn `<tr>/<br>` into newlines,
   drop remaining tags). This worked cleanly for all three JP/WO patents that render as real text
   (JP2015-114366, JP2011-170128, WO2019-116563) — Google's OCR/typesetting for electronically-filed
   JP applications is clean enough to transcribe directly, including the Japanese-original tables
   (used in preference to the English machine-translation duplicate wherever the two disagreed by a
   character, since the translation pass sometimes drops or corrupts a digit — see the p105 note
   below for a caught example).
4. **WO 2019/187633 (Sony 135mm) does not have a text-readable table anywhere**: the Google Patents
   HTML page renders every table (`JPOXMLDOC01-appb-T0000xx.png`) as a scanned image, and the WO/PCT
   PDF itself (fetched from `patentimages.storage.googleapis.com`, a different, non-rate-limited
   Google subdomain) has **zero characters of text layer on all 90 pages** (confirmed with both
   `pypdf` and `pymupdf`). Per the task's instructions ("if a table is an image you cannot read, say
   so and move on"), the honest options were: drop this lens, substitute a different 135mm patent, or
   read the table images directly. We did the latter: pulled the five individual table-image PNGs for
   Numerical Example 1 (`T000002.png`...`T000006.png`, i.e. Table 1 surface data, Table 2 aspheric
   coefficients, Table 3 overall specs, Table 4 variable gaps) straight from
   `patentimages.storage.googleapis.com` and read them as images (each one is a clean, sharp,
   typeset table — not a low-quality scan), transcribing every digit by eye. This is **not** a guess
   at unreadable content; the table images are perfectly legible, just not OCR'd by Google Patents'
   text pipeline for this particular document. The self-check (EFL +0.005%, BF +1.145%/0.0115mm,
   chief-ray image height -0.024%) corroborates the transcription was read correctly.
5. `patents.google.com` started returning HTTP 503 "automated queries" blocks partway through this
   session (both to direct `curl` and to the `WebFetch` tool) — most likely from the combined request
   volume of several agents on this team hitting the same domain concurrently. The
   `patentimages.storage.googleapis.com` asset host (serving each patent's page-image PNGs and full
   PDF) was never blocked and is what let the 135mm transcription finish; the same trick would be the
   fallback if this recurs for another lens later.
6. Maker spec pages (min focus, blade count) were fetched directly: `sigma-global.com` (both Sigma
   lenses) and `nikonusa.com` worked directly. `sony.com`, `electronics.sony.com` and B&H's product
   page all refused the fetch tool (404/blocked/403); dpreview.com's specifications page (which states
   its numbers are the maker's own spec sheet reproduced) was used instead for the Sony 135mm's min
   focus and blade count, flagged as such in `iris.source` / `focus.minFocusSource` rather than
   silently citing it as `sony.com`.

## Per-lens notes

### p50 — Sigma 50mm F1.4 DG HSM | Art (JP 2015-114366, Numerical Example 1)

- Clean, fully-typeset JP-grant patent text; no OCR issues. 23 surfaces, 13 elements in 8 groups —
  matches Sigma's own published "13 elements in 8 groups" exactly, which is strong independent
  corroboration the correct example (of several in the same patent, at similar but not identical
  specs) was picked.
- Two aspheric surfaces (both faces of the last element, patent surfaces 22–23), convention `K, A4,
  A6, A8, A10` with `K=0` (no added conic term).
- Floating-focus design: G2A and G2B move independently (per the JP description), so we model three
  coupled variable gaps (`d9` at the flare-cut fixed aperture, `d14` into the iris, and the BF gap
  itself, which *grows* on close focus because the "Various data" table gives total lens length
  142.00 mm at *both* infinity and the 400 mm test distance — a unit-length focusing barrel with
  internal floating groups). The patent's own near-focus condition is tabulated only as a "400 mm
  shooting distance", with no stated reference plane; recorded as-is with a note.
- Self-check: EFL error +0.006%, BF error +0.001% (0.0004 mm) — both comfortably inside tolerance.
  Chief-ray image height +0.125% against the patent's own Y=21.63mm.

### p85 — Sigma 85mm F1.4 EX DG HSM (JP 2011-170128, Numerical Example 5)

- This patent describes 9 numerical examples (1–8 at f≈82–84mm/F1.46, 9 at f≈80.4mm), all variations
  on the same "large-aperture medium telephoto" family with a moving front sub-group. photonstophotos
  ties the commercial Sigma 85mm F1.4 EX DG HSM specifically to **Example 5** (not Example 1, which we
  transcribed first before checking the tie and had to discard) — the structural match (11 elements
  in 8 groups against Sigma's own spec) confirms Example 5, not Example 1 (10 elements in a different
  grouping), is the right one.
- **The patent never prints a numeric back focal distance anywhere**, for any of its 9 examples: every
  numerical-example table's last row prints the literal text "B.F." (Japanese original) / "BF"
  (English machine translation) in the thickness column instead of a number, and there is no separate
  "total length" or "various data" table elsewhere in the document that supplies it (unlike the other
  three patents in this set, which all have exactly such a table). Because of this, the JSON's last
  surface `t` (39.87 mm) is **derived** from our own paraxial trace of the other 19 surfaces, not
  copied from patent text; `stated.bf` is left unset accordingly, and the self-check for this lens
  only verifies EFL (+0.003%) — there is no independent BF figure to check it against.
- Single aspheric surface (patent surface 10, front face of L6), convention `K, A4, A6, A8, A10, A12`
  with `K=0`, `A12=0`.
- Sole variable gap is the front sub-group spacing (`d6`, patent surface 6), moving on a simple
  front-group focus; near-focus condition is stated directly as "0.85 m" shooting distance.

### p105 — Nikon AF-S NIKKOR 105mm f/1.4E ED (WO 2019/116563 A1, Table 3 / Third Embodiment)

- This single WO filing describes several unrelated embodiments at very different focal
  lengths/apertures (Table 1 f≈12.6mm, Table 2 f≈47mm/F1.40, **Table 3 f≈102.1mm/F1.45**, Table 4
  f≈392mm/F2.88, and more): it reads as a shared optical-design family Nikon patented once and reused
  across several products, not one lens with 5 example variants of nearly the same spec (contrast
  with the Sigma and Sony patents here). Table 3 is the one photonstophotos.net ties to the 105mm
  f/1.4E product, and it is also the only one in the family near 105mm/f1.4.
- **Caught transcription bug, fixed before self-check**: the English machine-translation copy of
  Table 3 in the HTML gives surface 7's radius as `168.23770` and surface 22's `nd` as `1.58184`; the
  Japanese-original copy of the same table (a few lines earlier in the same document) gives
  `168.27370` and `1.58144` respectively. The two duplicate tables (JP original + English MT) let us
  cross-check every digit; wherever they disagreed we used the Japanese original, and this is the
  reason the self-check passes to 0.001% instead of failing — using the English-MT digits directly
  did not reproduce the stated EFL/BF to tolerance in an earlier draft.
- All-spherical: no surface in Table 3 carries the patent's aspheric-surface asterisk, so no `asph`
  blocks are needed.
- 14 elements in 9 groups (a single rigid inner-focus group G2 = surfaces 8–10 moves for focus; G1 and
  G3 are fixed) — matches Nikon's own published "14 elements in 9 groups" exactly.
- Self-check: EFL error +0.001%, BF error +0.001% (0.0005mm), chief-ray image height -0.301%. All well
  inside tolerance.

### p135 — Sony FE 135mm F1.8 GM (WO 2019/187633 A1, Table 1 / First Embodiment)

- See "Research method" step 4 above for why this one required reading table-image PNGs directly
  rather than parsed text — the Google Patents HTML and the WO/PCT PDF are both image-only for every
  table in this document.
- Floating focus: GR2 (the first focus group) moves object-to-image side, GR3 (the second focus
  group) moves image-to-object side, independently, while GR1 and GR4 stay fixed — four coupled
  variable gaps (`d1`, `d2`, `d3`, `d4`) rather than one.
  **Caught indexing bug**: the first JSON draft had `focus.gaps[1..3].surface` off by one (13/14/17
  instead of 14/15/18), because the stop surface (patent 16, a zero-power flat "aperture stop" row
  with no `nd`) is easy to mis-count when converting 1-based patent numbers to 0-based array indices
  by hand. `selfcheck.py` now cross-checks every `focus.gaps[i].surface` against
  `surfaces[surface].t == gaps[i].atInfinity` automatically (see "How the self-check works" above);
  this caught the bug immediately (three "MISMATCH" lines) and it was fixed before publishing.
- Single aspheric surface at patent surface 9 (rear-most element of GR1); this patent's own
  coefficient names are **A, B, C, D** (not A4/A6/A8/A10) for the 4th/6th/8th/10th-order terms —
  mapped 1:1 in that order into the JSON's `A4/A6/A8/A10` fields, noted in the surface's `asph.
  convention` string.
  The stop and the filter (patent surfaces 25–26, a plane-parallel IR/ND/polarizing/NC filter,
  per the description) are listed as explicit surfaces per the schema's own convention.
- `stated.bf = 1.0000mm` is Table 1's own plain last-row thickness (filter rear to image) — a real
  number, not a symbolic "BF" like the other Sigma patent above — but Table 3 (overall specs) does not
  name a separate "BF" variable at all for this design, so it is **not** the traditional full
  back-focal-distance (which would also include the 17.8946mm rear-element-to-filter gap and the
  2.5mm filter thickness, ≈21.39mm total). We check the trace against this last tabulated number for
  consistency with how the other three lenses are checked, not because it is "the" BF in the
  usual photographic sense.
- 13 elements in 10 groups — matches dpreview's reproduction of Sony's own spec ("Elements: 13,
  Groups: 10") exactly.
- Self-check: EFL error +0.005% (PASS), BF error +1.145% / 0.0115mm absolute — **fails the 1%
  relative bound but passes on the 0.2mm absolute bound** (the "or" in the task's tolerance), which is
  expected for a ~1mm-scale gap where a sub-percent paraxial rounding/precision difference is a large
  relative number but a tiny absolute one. Chief-ray image height -0.024%.
- `stated.f = 130.950mm` for the raw patent example vs. the 135mm marketed class is a normal
  generic-example-vs-shipped-product gap (BRIEF.md: "representative designs are schematic"), and
  Fno=1.854 vs the marketed f/1.8 similarly.
- Min focus (0.70m) and blade count (11) are cited to dpreview.com's specifications page, not
  sony.com/electronics.sony.com directly — both Sony domains refused to load through the fetch tool
  (electronics.sony.com: outright refused; sony.com/.../specifications: HTTP 404 on the guessed path;
  B&H's product page: HTTP 403). dpreview's page states these as Sony's own published spec-sheet
  numbers; flagged in the JSON's `iris.source` / `focus.minFocusSource` text rather than silently
  attributed to Sony.

## Semi-diameter estimation caveat (applies to all four)

None of the four patents list effective/clear diameters for any surface. Every `sd` value in all four
JSON files is `sdSource: "estimated-from-marginal-ray"`, computed as described in "How the self-check
works" above (paraxial marginal ray scaled to the patent's stated Fno, plus a paraxial chief ray at
the patent's stated half field angle, added as absolute values). This is a first-order,
vignetting-blind estimate — real lenses deliberately undersize rear-group elements relative to the
full unvignetted field to save weight, so our rear-group `sd` values in particular should be read as
upper bounds, not as the true mechanical clear apertures. The paraxial Fno "check" reported in
`selfcheck.py`'s console output is tautological (it necessarily reproduces `stated.fno` by
construction, since that is what sets the marginal ray's scale) rather than an independent
verification — flagged explicitly in the script's own output and here, since no patent gives an
independent stop diameter to check against.

## Open problems / uncertainty

- p85's BF is not patent-stated at all (derived from our own trace only — see per-lens note); no
  independent numerical check of it is possible with the data this patent provides.
- p135's Table 3 gives no distinct "BF" variable; what we check against is Table 1's own last-row
  thickness (the small filter-to-sensor air gap), not the lens's traditional back focal distance.
- All `sd` values across all four lenses are first-order paraxial estimates, not patent data — see
  the caveat above. A real clear-aperture figure (or a full skew-ray trace with vignetting) would
  supersede them.
- p135's Sony maker-page citations (min focus, blades) are sourced via dpreview.com because Sony's own
  domains refused to load through our fetch tooling; worth re-attempting a direct sony.com fetch later
  if another agent/session has better luck reaching it.
- The 105mm patent (WO2019-116563) bundles several unrelated focal-length/aperture embodiments in one
  filing; we used only Table 3. If a different, more tightly-scoped 105mm f/1.4 patent surfaces later
  (e.g. a JP-only equivalent filed just for this product), it might be a cleaner single-purpose source,
  though our transcription already self-checks cleanly.
