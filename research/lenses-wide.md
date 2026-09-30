# Wide primes (20/24/28/35 mm) — lens-wide research note

Scope: `data/lenses/p20.json`, `p24.json`, `p28.json`, `p35.json`. Every prescription below is a
patent numerical example, transcribed as-printed (raw, pre-`scale`) and self-checked with a
paraxial y-nu trace. Accessed date for every source in this note: 9/28/2026.

## Summary table

| Focal (nominal) | Patent f / Fno (stated) | Patent | Example | Assignee | Published | Elements / groups | Representative product | Min focus | Blades | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20 mm | — | — | — | — | — | — | — | — | — | — | — |
| 24 mm | 24.00 mm / F1.40 | [JP 2021-018277 A](https://patents.google.com/patent/JP2021018277A/en) (granted JP 7293017 B2) | Numerical Example 1 | Canon Inc. | 2/15/2021 | 16 / 14 | none (see notes) | 0.24 m, assumed (class stand-in) | 11, assumed (class stand-in) | +0.015% err (pass) | -0.064% err (pass) |
| 28 mm | 28.00 mm / F1.80 | [JP 2021-018277 A](https://patents.google.com/patent/JP2021018277A/en) (granted JP 7293017 B2) | Numerical Example 3 | Canon Inc. | 2/15/2021 | 15 / 13 | none (see notes) | 0.28 m, assumed (class stand-in) | 9, assumed (class stand-in) | -0.002% err (pass) | +0.054% err (pass) |
| 35 mm | 36.000 mm / F1.45 | [US 7,663,816 B2](https://patents.google.com/patent/US7663816B2/en) | Example 1 (Numerical Example 1) | Nikon Corp | 2/16/2010 | 10 / 6 | none (see notes) | 0.30 m, assumed (class stand-in) | 9, assumed (class stand-in) | +0.001% err (pass) | -0.000% err (pass) |

Tolerances required by the brief: EFL within 0.5%, BF within 1% or 0.2 mm. All three transcribed
lenses pass by a wide margin (worst case 0.064%). p20 is not yet filled — see **Open problems**.

## Method (applies to all four lenses)

**Sourcing.** Patents were located by web search for the shipped or rumored commercial lens tied
to a focal length/aperture class, then confirmed on patents.google.com, then read directly from
the "Description" section of the Google Patents HTML (curled with a browser user agent; for the
Canon JP application this is Google's own English machine translation, for the Nikon US patent it
is the original English text). No table was read as an image; every surface-data block below was
read as plain text.

**Self-check.** `.local/lens-wide/raytrace.py` is a from-scratch paraxial y-nu (y, nu=n·u) ray
trace, independent of any optics library:
- Traces a marginal ray (parallel, arbitrary start height) through every surface at infinity focus
  (using each surface's listed `t`, i.e. the patent's own infinity-focus gaps) to get computed EFL
  (`-y1/u_final`) and computed BFD (`-y_last/u_final`, evaluated right after the last surface's
  refraction, without propagating by its own `t`, since that `t` **is** the BFD being checked).
- Traces a second, independent paraxial ray (`y=0, u=1` at the front surface) to fully determine
  the system's linear (y, nu) transfer, then combines it with the marginal ray to build the chief
  ray for the patent's own stated half field angle (`u1 = tan(halfFieldDeg)`), reporting the
  predicted image height as a secondary cross-check against the patent's stated image height `Y`.
- Aspheric terms (k, A4, A6, ...) are correctly excluded from the trace: they are second-order and
  higher in ray height and do not affect a first-order/paraxial EFL or BFD, so ignoring them is not
  a simplification that costs accuracy here.

**Paraxial F-number check — done, but not independent.** The brief asks to "compute the paraxial
F-number from the stop semi-diameter and compare with the stated Fno." None of the three patents
transcribed here publish an effective/clear-aperture ("stop semi-diameter") table anywhere in the
text (confirmed by grep for "effective diamet", "clear aperture", "aperture diamet" on the full
description text of both patent families — no matches). Because of that, semi-diameters in these
JSON files are all `sdSource: "estimated-from-marginal-ray"`, and the estimate itself is built by
scaling the marginal ray's height at the stop **to the patent's own stated Fno** (pupil radius =
computed EFL / (2 × stated Fno)). Computing "paraxial Fno from the stop sd" on that same data is
therefore circular — it reproduces the stated Fno by construction, not by independent measurement.
This is recorded here plainly rather than presented as a passing check: the genuinely independent,
required checks are EFL and BF, and those pass on real (not circularly-derived) data.

**Semi-diameter estimate.** For every surface, `sd_estimate = |marginal_ray_height| +
|chief_ray_height|`, where the marginal ray is the one scaled to the stated Fno (above) and the
chief ray is scaled to the stated half field angle (`tan(halfFieldDeg)`, paraxial small-angle
proxy). This is a standard paraxial full-aperture/full-field clear-aperture estimate, but it is
**known to undersize the front group of a wide retrofocus design** relative to a real (non-paraxial)
ray trace — real fast wide-angle lenses need larger front elements than paraxial optics predicts,
because of pupil aberration (the entrance pupil grows and shifts for oblique bundles at large field
angles) and vignetting margin that paraxial theory does not model. Sanity check: the p24 estimate
puts the front element at 35.4 mm semi-diameter (70.7 mm clear diameter); the real Canon RF 24mm
F1.4L VCM (a different, 15-element design, not this patent's design — see below) uses an 82 mm
filter thread, i.e. a physically larger front element, consistent with the expected paraxial
undershoot. Treat all `sd` values here, especially in the front group, as a paraxial lower bound,
not a manufacturing figure.

**`representativeOf`.** Deliberately left out of all three files. For each lens, the closest public
candidate product was checked against the patent's own element/group count and, where findable, was
a *different* count — see the per-lens notes below. Patents commonly disclose several alternate
embodiments during R&D and only one becomes a shipped product (or none do); without a source that
explicitly ties a specific patent example to a specific product (e.g. a teardown or a maker's own
citation), asserting identity would be a fabricated claim. `minFocusM`/`iris.blades` still needed
*some* number, so a same-class product's spec was used as an explicitly-labeled `assumed`
order-of-magnitude stand-in (cited in `minFocusSource`/`iris.source`), never presented as the
patent example's own value.

## Per-lens notes

### p24 — 24 mm F1.40 (Canon JP 2021-018277 A, Numerical Example 1)
- Application JP2019-132360, filed 7/18/2019, published as JP2021-018277 A on 2/15/2021, granted
  as JP 7293017 B2. Read via Google's machine translation (original is Japanese).
- The same application discloses six numerical examples: 1 (24mm F1.4), 2 (35mm F1.8), 3 (28mm
  F1.8, used for p28 below), 4 (24mm F1.8), 5 (24mm F1.4), 6 (50mm F1.4). Example 1 was used for
  24mm (not Example 5, the other 24mm F1.4 example) because it was the one fully transcribed and
  checked first; Example 5 was not transcribed and remains available if a second 24mm F1.4 source
  is ever wanted.
- 16 elements in 14 groups (7 groups/9 elements ahead of the stop incl. two cemented doublets, 7
  single-element groups behind it). Surfaces 11-12 and 14-15 are cemented interfaces.
- Self-check: EFL 23.9964 mm vs. stated 24.0000 mm (-0.015%); BFD 14.9904 mm vs. stated 15.0000 mm
  (-0.064%); both well inside tolerance. Secondary chief-ray image-height check: 21.6337 mm vs.
  stated 21.64 mm (-0.029%).
- Real-product check: Canon's actual RF 24mm F1.4L VCM (announced 10/29/2024, shipped 12/2024) is
  **15 elements in 11 groups with an 11-blade iris and 0.24 m minimum focus**, per
  https://www.photographyblog.com/reviews/canon_rf_24mm_f1_4l_vcm_review (fetched 9/28/2026) and
  corroborated by web search of Canon's regional spec pages (Canon UK/B&H pages 403'd on direct
  fetch, so not read directly). That element/group count does not match this patent example's
  16/14, so the two are **not** the same design; the RF24 numbers were used only as an
  order-of-magnitude minimum-focus/blade-count stand-in for the class (both marked `assumed`), not
  as a claim of identity. `representativeOf` is correctly omitted.
- Asphere convention: patent's own equation is the standard `x = c h^2/(1+sqrt(1-(1+K)c^2h^2)) +
  A4 h^4 + A6 h^6 + A8 h^8` with K=0 meaning a sphere — the same convention as this engine's
  `Asphere.k`. No odd-order (A3 etc.) terms present in this example's two aspheres (surfaces 10 and
  30).
- The aspherical-data block for surface 30 was rendered by Google's OCR/translation as "30th page"
  instead of "surface 30"; identified by elimination (surface 30 is the only remaining `*` surface
  without an aspheric block, and the coefficients immediately follow the surface-10 block in the
  same position the patent's own layout uses for its second aspheric surface).
- `closeObjectDistance` (240 mm) is transcribed exactly as printed in the patent's [Variable
  Distances] table; the translation does not say whether this is measured from the object to the
  first lens surface or to the image plane, so it is stored with that caveat rather than converted.
- No effective-diameter table anywhere in the text (confirmed by search); every surface is
  `sdSource: "estimated-from-marginal-ray"`.

### p28 — 28 mm F1.80 (Canon JP 2021-018277 A, Numerical Example 3)
- Same application/patent family as p24 (see above); this is the only 28 mm example in it.
- 15 elements in 13 groups (5 groups/7 elements ahead of the stop incl. two cemented doublets, 8
  single-element groups behind it). Surfaces 7-8 and 10-11 are cemented interfaces.
- Self-check: EFL 27.9994 mm vs. stated 28.0000 mm (-0.002%); BFD 15.8586 mm vs. stated 15.8500 mm
  (+0.054%), both well inside tolerance. Secondary chief-ray image-height check: 21.6281 mm vs.
  stated 21.64 mm (-0.055%).
- No product is publicly tied to this example. Canon has not shipped an RF prime at 28 mm f/1.8 as
  of 9/28/2026, so unlike p24 there is not even a same-brand candidate to rule in or out. Min-focus
  (0.28 m) and blade count (9) instead borrow from a different maker's lens at a different
  F-number in the same focal-length class — Sigma 28mm F1.4 DG HSM Art, 0.28 m / 9 rounded blades /
  17 elements in 12 groups, quoted directly ("28cm / 11 in.", "9 (rounded diaphragm)") from
  https://www.sigmaphoto.com/28mm-f1-4-dg-hsm-a (fetched 9/28/2026). Both figures are marked
  `assumed`; `representativeOf` is omitted.
- Asphere convention: identical K=0-sphere convention as p24 (surfaces 6 and 28).
- `closeObjectDistance` (280 mm) transcribed as printed; same reference-point caveat as p24.
- No effective-diameter table in the text; every surface is `sdSource:
  "estimated-from-marginal-ray"`.

### p35 — 35 mm-class F1.45 (Nikon US 7,663,816 B2, Example 1)
- "Wide-angle lens and imaging apparatus," priority JP2007-254903 (filed 9/28/2007), US
  application filed 8/5/2008, granted 2/16/2010. Read directly from the English original text (not
  a translation).
- The patent's own four numerical examples are all "wide-angle lens" designs around F1.45:
  Example 1 (this file) states f=36.000 mm; Examples 2-4 state f=35.863 mm and additionally
  include a zero-thickness "Flare Stopper" surface between the front and middle groups that
  Example 1 does not have. Example 1 was used for simplicity (one fewer surface type to model) and
  because it was the one fully self-checked. `focalLength` is recorded as the requested class (35)
  while `stated.f` keeps the patent's own raw value (36.000), per the schema's stated distinction
  between marketed class and patent example value; this is disclosed here rather than silently
  rounded.
- 10 elements in 6 groups: a single element, then two cemented doublets ahead of the stop; a single
  element, then two cemented doublets behind it. Surfaces 3-4, 6-7, 12-13 and 15-16 are cemented
  interfaces.
- Self-check: EFL 36.0003 mm vs. stated 36.0000 mm (+0.001%); BFD 38.0291 mm vs. stated
  38.02909 mm (-0.000%), essentially exact. Secondary chief-ray image-height check: 22.0869 mm vs.
  stated 21.6 mm (+2.254%) — larger than p24/p28's secondary check, but still only a secondary,
  non-required diagnostic; the two REQUIRED checks (EFL, BF) both pass with very wide margin. The
  larger chief-ray deviation here is expected: the chief-ray check uses `u1 = tan(halfFieldDeg)` as
  a paraxial proxy for a real 31.53° field ray, and paraxial theory diverges from a real
  (non-paraxial, distortion-carrying) trace more at this field angle/design than for p24/p28's
  slightly different field geometry; it is not evidence of a transcription error, since EFL and BF
  (which do not depend on the field-angle proxy at all) are correct to five sig figs.
- Surface 12 (the first surface of the rear aspheric cemented doublet) carries a patent-listed
  `K = 195.0000` **and** an odd-order `A3 = -0.20873E-06` term that this engine's `Asphere` type
  cannot represent (only even orders A4-A16 are modeled). The A3 coefficient is recorded in the
  surface's `asph.convention` note rather than silently dropped. This omission does not affect the
  self-check (paraxial trace ignores all aspheric terms, odd or even, by construction) but would
  matter for a real (non-paraxial) ray-traced rendering of this specific surface; flagged for
  whichever workstream builds the real ray tracer.
- The patent actually lists **three** focus states (Infinity, Close Range 1, Close Range 2); the
  schema's `VariableGap` only has room for two (`atInfinity`/`atClose`), so Close Range 1 (object
  distance 1062.6389 mm, d5=6.32841, d8=7.55812 — between the two stored states) is recorded in
  prose in the JSON's focus-gap notes rather than stored as data.
- No public source ties this example to a shipped Nikon product. The timing is suggestive — priority
  date 9/28/2007, US grant 2/16/2010, and Nikon announced the AF-S NIKKOR 35mm f/1.4G that same
  month (2/2010) — but timing is not identity, and Nikon's element/group count for that shipped
  lens was not found in the sources checked (its own product pages give elements/groups as "10
  elements in 7 groups" per general spec listings seen in search snippets only, not independently
  confirmed here by direct fetch, so it is NOT quoted as a number in this note). `representativeOf`
  is correctly omitted. Minimum focus (0.30 m = 0.98 ft) and blade count (9) are instead taken,
  explicitly as an `assumed` class stand-in, from the Nikon AF-S NIKKOR 35mm f/1.4G spec page
  (https://www.nikonusa.com/p/af-s-nikkor-35mm-f14g/2198/overview, fetched 9/28/2026, states
  "0.98 ft." minimum focus and "9" diaphragm blades directly).
- No effective-diameter table in the text; every surface is `sdSource:
  "estimated-from-marginal-ray"`.

## Open problems

- **p20 (20 mm) is not yet filled.** Extensive search (web search plus direct Google Patents
  full-text search via its `xhr/query` endpoint) found one promising, on-target lead: Canon
  JP 2022-020096 A ("Optical system and image pickup apparatus"), reported by CanonWatch
  (https://www.canonwatch.com/canon-patent-rf-20mm-f-1-8-rf-24mm-f-1-8-rf-28mm-f-1-8-lenses/,
  fetched 9/28/2026) to contain a Numerical Example 2 at **20.60 mm, F1.85** — squarely in the
  brief's 20-35mm f/1.4-f/2 class and presumably full-frame (its sibling examples in the same
  family of Canon applications are all Y=21.64mm). CanonWatch's own text is a secondary summary,
  not the primary surface-data table, so it could not be transcribed from that source alone.
  Google Patents (`patents.google.com`) returned HTTP 503 ("Sorry...", Google's rate-limit page)
  on every direct-fetch attempt for this session — both via `curl` and via the WebFetch tool,
  across roughly ten attempts over several minutes, including for patent numbers that had
  succeeded minutes earlier in the same session, confirming this is IP-level rate limiting rather
  than a problem with this specific document. **Do not guess this patent's surface table** — it
  was not read, so p20.json is not written rather than fabricated.
  - Other 20mm-class candidates identified but not confirmed to have a readable, complete
    numerical example: Sigma "Large aperture ratio optical system" P2024-035865 (20mm F1.4-class,
    filed 9/5/2022, published 3/15/2024) — found only via a search-result summary, not read
    directly. Nikon and Sony patent families that plausibly underlie the NIKKOR Z 20mm f/1.8 S and
    Sony FE 20mm F1.8 G were searched for but not pinned to a specific publication number with
    confidence (candidates JP 6881604 B2 and JP 7428179 were checked; JP 6881604 B2's fixed-focal
    Example 1 is 28.77mm F1.88, not 20mm, and JP 7428179's own numerical examples were not read).
  - **Next step for whoever picks this up:** retry `patents.google.com/patent/JP2022020096A/en`
    (or the granted JP number, once found) after the rate limit clears — it was still 503 as of the
    last attempt in this session (9/28/2026, several retries over ~5 minutes). If it stays blocked,
    fall back to Espacenet (worldwide.espacenet.com) for the same JP publication number, which
    mirrors JPO/EPO full text independently of Google's block.
- **`representativeOf` is empty for all three transcribed lenses.** This is a real finding, not a
  gap in the research: every commercial lens checked against these patent examples (Canon RF24mm
  F1.4L VCM vs. p24; Sigma 28mm F1.4 Art vs. p28, different F-number/maker entirely; Nikon 35mm
  f/1.4G vs. p35, timing-only) either has a confirmed different element/group count or no
  confirmable element count at all. If a later pass wants a lens with a confirmed product tie, the
  likeliest route is a teardown-based source (e.g. Roger Cicala's lensrentals.com teardown/MTF
  posts, or Photons to Photos' Optical Bench, which the brief suggested and which does map some
  patents to named commercial lenses) rather than a rumor site's patent writeup, which only ties a
  patent to a *rumored future product name*, not a confirmed shipped design.
- **Odd-order aspheric term (A3) on p35 surface 12** is not representable by this engine's
  `Asphere` type (even orders only); recorded in the note field, flagged for the physics-engine
  workstream in case it matters for a non-paraxial renderer.
- **Semi-diameters are paraxial estimates everywhere** (no patent in this set publishes clear
  apertures); see the Method section above for the undershoot caveat, especially for front
  elements of the two Canon retrofocus designs.
- **Blade count and minimum focus are class stand-ins, not measurements of these specific
  patent designs**, for all three lenses (see per-lens notes). None of the three patents state a
  blade count or minimum focus distance in the excerpted numerical-example text (patents describe
  optical performance, not mechanical/manufacturing choices like iris blade count).
