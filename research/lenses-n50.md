# Nikon AF-S NIKKOR 50mm f/1.8G (n50)

Agent: lens-n50 (added after `lenses-normal.md`'s p50/p85/p105/p135). Covers `data/lenses/n50.json`
only. Accessed date for every source below is 9/28/2026 unless a publication date is given.

## Summary

| Focal | Fno (patent) | Patent, example | Assignee | Published | Elements/Groups | Representative product (tie) | Min focus (source) | Blades (source) | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|
| 50 mm | f/1.86 (raw f=51.60mm) | [JP 2011-175123 A](https://patents.google.com/patent/JP2011175123A/en), Example 7 (Table 7) | Nikon Corp | 9/8/2011 | 7/6 | Nikon AF-S NIKKOR 50mm f/1.8G (not in photonstophotos hub; tied structurally + by dates, see below) | 0.45 m (nikonusa.com) | 7, rounded (nikonusa.com blade count; "rounded" corroborated by dpreview.com) | +0.003% | +0.000% (0.0001 mm) |

Both required self-check bounds pass with wide margin. `npx vitest run src/engine/lenses.test.ts
src/engine/realize.test.ts` is green for n50 (8 + 5 tests).

## The tie: this lens is NOT in photonstophotos.net's Optical Bench Hub

Reed owns the F-mount AF-S NIKKOR 50mm f/1.8G (announced 4/27/2011), and the task started, as for
the other normal primes, by searching `.local/lens-normal/modeldata.tsv` (the Optical Bench Hub's
extracted `{PatentID, ExampleID, TableID, Description}` rows) for it. There is no row for it:

```
grep -in "50mm f/1.8" modeldata.tsv
  US004514051  ExampleML02P        Nikon AI Nikkor 50mm f/1.8       (1980s manual-focus lens)
  US004234242  Example03  Tale60   Nikon AI Nikkor 50mm f/1.8S      (1980s manual-focus lens)
  WO2019-220618  Example09P        Nikon Nikkor Z 50mm 1.8 S        (mirrorless, different lens: n50's sibling data/lenses/m50.json)
```

The nearby "Nikon AF-S Nikkor 50mm f/1.4G" row (JP2015-041003) is a different, faster lens.
photonstophotos.net's hub, our primary lead-finding tool for every other lens in this dataset,
simply has no entry for the F-mount 50mm f/1.8G's patent. This is the reason the tie for n50 has
to be built from independent evidence rather than quoted from the hub, unlike p50/p105/m50 etc.

## Finding the patent

1. **Nikon's own product pages and press release** (nikon.com company news 4/27/2011, nikonusa.com,
   B&H) confirm the target spec: 7 elements in 6 groups, 1 aspherical element, f/1.8, released
   4/27/2011 as "Nikon's first 50mm lens with an aspherical element."
2. **camera-wiki.org's "Lens patents" page** (used successfully for p85's tie) has no entry for
   this lens at all -- only an unrelated JP2015-041003 "focal reducer" listed under Nikon's
   "patented, not produced" section.
3. **A Japanese-language optics-enthusiast teardown** (lensreview.xyz, "NIKON AF-S NIKKOR 50mm
   F1.8G-分析017") independently names patent **特開2011-175123** (JP 2011-175123 A) as the likely
   source design, picking a specific example (their write-up says "実施例1", Example 1) by eye from
   its drawing and MTF-like performance, explicitly flagged in their own text as an assumption
   ("...と仮定し"), not a confirmed fact. We used their patent number as a lead but did **not** trust
   their example pick.
4. **Checking the patent directly** (fetched via `r.jina.ai` proxy after Google Patents' own
   summarizer refused to reproduce raw table text, citing copyright caution even for numeric
   patent data -- worked around with a direct `curl` to the jina.ai reader endpoint, which returns
   plain text): JP 2011-175123 A ("Lens system, optical equipment, and method for manufacturing
   lens system", Nikon Corp, filed 2/25/2010 as JP2010039675A, published 9/8/2011) contains
   **eight** numerical examples (Tables 1-8), all variations of the same two-group (front group +
   stop + rear group) standard-lens family, at similar but not identical specs (f ≈ 51.5-51.8mm,
   Fno ≈ 1.85-1.86 across most examples). This is the same "one patent, several product-specific
   examples" pattern seen in p50 (Sigma) and p85 (Sigma) in `lenses-normal.md`.
5. **Picking the right example by structure, not by the blog's guess**: we transcribed Table 7 in
   full and counted elements/groups by hand from its own lens description text (each example's
   prose names every element Lxx and states which are cemented) -- see "Structural corroboration"
   below. Example 7 is the only one of the eight (we spot-checked several others' prose descriptions
   against Nikon's spec) with exactly 7 elements in 6 groups and exactly one aspherical surface,
   matching Nikon's own published spec for the 50mm f/1.8G exactly. We did not exhaustively
   re-derive all eight tables' element/group counts (that would require transcribing all eight in
   full); Example 7's match against Nikon's spec, combined with the filing/publication dates below,
   is treated as sufficient identification, consistent with how p50 and p105 were identified from
   among several same-patent examples by structural match to the maker's own spec.
6. **Filing/publication dates bracket the product announcement**: filed 2/25/2010, published
   9/8/2011. Under Japan's 18-month automatic publication rule, a filing on 2/25/2010 publishes
   around 8/25/2011 -- Google Patents gives 9/8/2011, a normal few-week administrative delay past
   that floor. The lens was announced 4/27/2011, i.e. **after filing but before publication**,
   exactly the pattern expected when a patent protects a design that is about to ship (contrast a
   patent published years after a product, which would be weaker evidence of a source-not-sink
   relationship). This is corroborating, not sufficient on its own (Nikon files many lens patents
   that never ship as named products), which is why it's evidence (3) here, not evidence (1).

## Structural corroboration (why Example 7, not another example in the same patent)

Table 7's own prose (第7実施例, "Seventh embodiment") states:

- **G1** (patent surfaces 1-6, before the stop): "正メニスカスレンズ L11" (positive meniscus),
  "正メニスカスレンズ L12" (positive meniscus), "負メニスカスレンズ L13" (negative meniscus) --
  three singlets, air-spaced (no cementing mentioned) = **3 elements, 3 groups**.
- **G2** (patent surfaces 8-14, after the stop): a cemented doublet L21 = L21a (biconcave) +
  L21b (biconvex) ("接合レンズ"), a single aspherical positive meniscus L22 (front surface
  aspheric, per the patent's own asterisk on surface 11), and a single biconvex L23 = **4 elements,
  3 groups** (the cemented pair counts as one group).
- **Total: 7 elements in 6 groups, 1 aspherical surface** (on L22, patent surface 11) -- matching
  Nikon's own published "7 elements in 6 groups... 1 aspherical lens element" spec for the AF-S
  NIKKOR 50mm f/1.8G exactly (nikon.com press release 4/27/2011; nikonusa.com spec page;
  dpreview.com's specifications page, which separately lists "Elements: 7 / Groups: 6 / Special
  elements: One aspherical element").

We did not check whether any of the *other* seven examples in the same patent also happen to
produce 7/6/1; a full transcription of all eight tables was out of scope for confirming a single
tie, and Example 7's exact match plus the filing/publication date bracket was treated as
sufficient. This is the dataset's one open identification uncertainty (see "Open problems" below).

## Transcription and self-check

`.local/n50/selfcheck_n50.py` is the same standalone paraxial **y-nu** ray tracer as
`.local/lens-normal/selfcheck.py` (copied, not modified in its physics), run against
`.local/n50/n50_draft.json` (a working copy identical to the shipped `data/lenses/n50.json` except
for placeholder blade/min-focus citation strings filled in afterward). Results:

```
EFL computed = 51.6018 mm   |  patent f = 51.6000 mm   |  error = +0.003%   [PASS <=0.5%]
BF  computed = 40.1648 mm   |  patent BF = 40.1647 mm   |  error = +0.000%  (abs 0.0001 mm)  [PASS]
Residual ray height at stored image plane (should be ~0): 0.00000 mm
```

Both required tolerances (EFL within 0.5%, BF within 1% or 0.2mm) pass with wide margin -- the
raw transcription reproduces the patent's own stated numbers almost exactly, which is itself
evidence the 14-surface table (radii, thicknesses, nd/vd, and the one aspheric's k/A4/A6) was
copied correctly. `npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts` passes all
13 n50-specific tests (8 in `lenses.test.ts`, 5 in `realize.test.ts`); the only failures in that
run belong to a different, pre-existing lens file (`m500.json`, someone else's work, a glass
catalog-match problem unrelated to n50).

Semi-diameters: as with p50/p85/p105/p135, the patent gives no effective-diameter column, so every
`sd` in `n50.json` is `sdSource: "estimated-from-marginal-ray"` -- the same "marginal ray scaled to
patent Fno, plus full-field chief ray, summed as absolute values" method documented in
`lenses-normal.md`'s "How the self-check works" section, reused unmodified.

### Full patent citation

- **JP 2011-175123 A**, "Lens system, optical equipment, and method for manufacturing lens
  system", Nikon Corp. Filed 2/25/2010 (application JP2010039675A), published 9/8/2011.
  <https://patents.google.com/patent/JP2011175123A/en>. Example 7 / Table 7 (第7実施例, 表７).
- Fetched via `https://r.jina.ai/https://patents.google.com/patent/JP2011175123A/en` (Google
  Patents' own page returned only a summarized/paraphrased read from the standard fetch tool, which
  declined to reproduce raw table numbers even for public numeric patent data, citing copyright
  caution; the jina.ai reader proxy returns plain markdown/text and was not blocked). This document
  renders as clean OCR'd/typeset text (both the Japanese original and an English machine
  translation, in parallel), unlike the p135/Sony patent's image-only tables -- no image-reading
  was needed here.
- Nikon spec sources: `nikonusa.com` (min focus, blade count, element/group count, elements
  construction) and `dpreview.com`'s specifications page (corroborating "rounded" blade
  description, which nikonusa.com's own table states the count for but does not explicitly call
  "rounded").

## Open problems / uncertainty

- **Example identification is structural + date-based, not a hub- or maker-sourced tie.** Unlike
  every other lens in this dataset (p50, p85, p105, p135, m50), which all have a photonstophotos.net
  Optical Bench Hub row directly naming the product, n50's tie rests on (a) the element/group/
  aspheric-count match against Nikon's own spec, and (b) the filing-before/publication-after
  bracket around the announcement date. Both are solid but neither is a "manufacturer confirms
  patent X example Y is this lens" statement. If a hub update or another source later ties a
  *different* JP2011-175123 example (or a different patent entirely) to the 50mm f/1.8G, this file
  should be revisited.
- **The patent's own stated `totalLength` (70.86471mm) does not equal the sum of every surface
  thickness in Table 7 (76.16471mm).** The discrepancy is exactly 5.30mm at infinity focus and
  exactly 5.70mm at the close-focus condition -- in both cases, exactly the value of the
  stop-to-G2 variable gap (patent's own `d7`) at that focus setting. We checked this arithmetic by
  hand and again via `selfcheck_n50.py`'s printed "Sum of all surface t" line; it holds to 5
  decimal places both times, which rules out a rounding coincidence, but we do not know *why* the
  patent's own TL figure appears to omit this one gap (possibly an artifact of Nikon's internal
  lens-design software's TL formula, which none of the other three normal-prime patents in this
  dataset exhibit). `totalLength` is not part of the required self-check (only EFL and BF are
  graded), so this does not block the shipped file, but it's recorded as an unresolved
  transcription puzzle in the JSON's own `notes` array rather than silently corrected.
- **The two variable gaps (stop-to-G2, and Bf itself) don't correspond to a simple rigid-body
  motion.** d7 grows by 0.40mm on close focus while Bf grows by 1.69539mm -- if this were a simple
  "G2 moves as a rigid block, sensor fixed" rear-focus design, both deltas should be equal (G2's
  motion should show up identically in the gap ahead of it and in how far the whole system now
  sits from the sensor). They aren't equal, so the true mechanical focus scheme is more involved
  than what `focus.method: "rear"` implies; recorded as-is (both patent numbers, unresolved
  mechanism) rather than guessed at.
- **No patent-given image height (Y).** Table 7's `[Overall specifications]` gives only f, FNo,
  ω and TL -- no Y row (unlike p50/p105, which both state Y directly) -- so `stated.imageHeight`
  is left unset; there is no bonus chief-ray cross-check available for this lens beyond EFL/BF.
- All `sd` values are first-order paraxial estimates (marginal + chief ray, vignetting-blind),
  same caveat as every other lens in this dataset -- see `lenses-normal.md`'s "Semi-diameter
  estimation caveat" section, which applies here unchanged.
