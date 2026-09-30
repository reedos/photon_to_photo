# Reed's DSLR wide lens: Sigma 35mm F1.4 DG HSM | Art (lens-s35)

Covers `data/lenses/s35.json`. Reed owns this lens (the 2012 DSLR-mount "35 Art", not the 2019
mirrorless "35mm F1.4 DG DN Art") and wants it as the site's DSLR wide lens. Accessed date for
every source below is 9/28/2026.

## Summary

| Focal | Fno (patent) | Patent, example | Assignee | Published | Elements/Groups | Representative product (tie source) | Min focus (source) | Blades (source) | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|
| 35 mm | f/1.45 (raw f=34.00mm) | [JP 2014-048488 A](https://patents.google.com/patent/JP2014048488A/en), Numerical Example 3 | Sigma Corp | 3/13/2014 | 13/11 | Sigma 35mm F1.4 DG HSM \| Art (photonstophotos.net Optical Bench Hub) | 0.30 m (sigmaphoto.com) | 9, rounded (sigmaphoto.com) | +0.000% | +0.002% (0.0009 mm) |

Both required self-checks pass comfortably inside tolerance (EFL within 0.5%, BF within 1% or
0.2 mm).

## Finding the lead

`.local/lens-normal/modeldata.tsv` (photonstophotos.net's Optical Bench Hub table, already saved
locally by an earlier agent) was grepped for "sigma" rows containing "35":

```
JP2022-033487   Example01P      Sigma 35mm F1.4 DG DN Art
JP2014-048488   Example03P      Sigma 35mm F1.4 DG HSM Art
```

Two different Sigma 35mm F1.4 lenses appear in the hub: the DG DN Art (2019, mirrorless, patent
JP2022-033487) and the DG HSM Art (2012, DSLR, patent JP2014-048488) — the one Reed owns. This
file uses JP2014-048488, Example03P, matching the DG HSM Art tie exactly.

## Fetching the patent

`patents.google.com/patent/JP2014048488A/en` loaded directly at HTTP 200 with a plain `curl`
this session — no rate-limiting was encountered, so the `r.jina.ai` proxy and
`patentimages.storage.googleapis.com` fallbacks mentioned in the task brief were not needed. The
raw HTML was stripped of `<script>`/`<style>` and converted to text with a small Python script
(`.local/s35/patent.txt`, 123 KB).

The document discloses 9 numerical examples (Examples 1–9), all variants of the same
"large-aperture wide-angle" 3-group family (G1 negative, G2 positive, G3 positive) at f ≈
34.0–35.6mm and F1.45–1.46-ish. Example 3 (f=34.00mm, F1.45) was located at line 2125 of the
stripped text and transcribed in full — both the Japanese-original surface table and its English
machine-translation duplicate immediately following it. All digits agreed between the two copies
for every value in Example 3's `[面データ]`/`[Surface data]`, `[非球面データ]`/`[Aspherical
data]`, `[各種データ]`/`[Various data]` and `[可変間隔データ]`/`[Variable interval data]` blocks —
no OCR/translation discrepancy to resolve here, unlike p105 and p20 in this project, which each
had a caught single-digit mismatch between the two copies.

## Confirming the tie: element/group count

Sigma's own product page (`sigmaphoto.com/35mm-f1-4-dg-hsm-a`, fetched directly, HTTP 200) states
under "Construction": **"Lens Construction: 13 elements in 11 groups"**, 9 rounded diaphragm
blades, and "Minimum Focusing Distance: 30cm / 11.8in."

Counting Example 3's own surface table by hand (23 surfaces + object + image = 25 rows,
0-indexed 0–24 in the JSON):

- **G1** (patent's own lens-group-data table: starts surface 1): 5 physical elements, each singly
  air-spaced (surfaces 0–1, 2–3, 4–5, 6–7, 8–9) → **5 groups**.
- **G2** (starts surface 11): one singlet (surfaces 10–11) plus one cemented doublet (surfaces
  12–13–14, i.e. two glasses back to back with no air gap at surface 13) → **2 groups**.
- **G3** (starts at the stop, surface 16 in patent numbering): one cemented doublet (surfaces
  16–17–18) plus three singlets (19–20, 21–22, 23–24) → **4 groups**.

Total: **13 elements in 5+2+4 = 11 groups**, matching Sigma's spec exactly. This is the same
structural corroboration method used for p50/p20/p105/p135 in `research/lenses-normal.md`, and it
independently confirms Example 3 (not Example 4, which is also f≈35mm/F1.45 in the same patent
but not the example photonstophotos.net ties to this product) is the right pick.

A second, independent corroboration: the patent's own `[Variable interval data]` table gives its
near-focus test condition as "INF / **300mm**" shooting distance — and Sigma's own spec page
states the product's minimum focusing distance as "**30cm**". These match almost exactly (unlike
p20, where the patent's 959mm test distance is far from the product's 276mm actual minimum
focus). Both the structural (13/11) and behavioral (300mm ≈ 30cm) evidence point the same way.

## Back-focus check (no trap here)

Unlike p20 (which ends in a flat filter/cover-glass plate, so the gap after it is not the lens's
true back focus), Example 3's last surface (25, the rear aspheric face of L13) is a real curved
optical surface with no plate after it — the table goes straight from surface 25 to "BF" to the
image plane. So the last surface's `t` (39.2000 mm at infinity, from the `[Variable interval
data]` table) *is* the lens's actual back focal distance, transcribed directly as
`stated.bf` and as the last surface's `t` — no derivation or trap-avoidance needed for this one.

## Self-check

`.local/s35/raytrace.py` is a copy of `.local/lens-wide/raytrace.py`, the standalone paraxial
y-nu tracer used for p20/p24/p28/p35 (see `research/lenses-normal.md` for the method: marginal
ray from infinity for EFL/BF, a second independent ray to build a chief ray at `tan(halfFieldDeg)`
for the bonus image-height check, and `sd = |marginal| + |chief|` at each surface for the
semi-diameter estimates, since this patent gives no effective-diameter column either).

Run against the shipped file:

```
=== s35 (35 mm f/1.4 double-Gauss-derivative wide-angle (patent numerical example)) ===
  EFL   computed 34.0001 mm   stated 34.0000 mm   err +0.000%
  BFD   computed 39.2009 mm   stated 39.2000 mm   err +0.002%
  Chief-ray image height computed 21.8652 mm   stated 21.6 mm   err +1.228%
```

Both required checks (EFL within 0.5%, BF within 1% or 0.2 mm) pass with a wide margin: EFL error
is +0.000% (0.0001 mm) and BF error is +0.002% (0.0009 mm). The chief-ray image-height check is a
bonus/non-required cross-check (per the method note in `research/lenses-normal.md`) and is off by
+1.228% here — a bit larger than the ~0.1–0.3% seen for p50/p105/p135, but still a first-order
paraxial check against a full-field chief ray, which is expected to carry more error than the
on-axis EFL/BF numbers, especially at wide field angles (halfFieldDeg here is 32.745°, wider than
p50's 23.6° or p105's field, though narrower than p20's 46.8°). It is not part of the required
pass/fail gate.

## Semi-diameter estimation caveat

As with every other lens in this project, the patent lists no effective/clear-diameter column
for any surface, so every `sd` value in `data/lenses/s35.json` is `sdSource:
"estimated-from-marginal-ray"` — the paraxial marginal ray scaled to the patent's stated Fno
(1.45) plus a paraxial chief ray at the patent's stated half field (32.745°), added as absolute
values (see `research/lenses-normal.md`, "How the self-check works", for why this is a
vignetting-blind upper bound, especially toward the rear of the design).

## Cemented-interface convention

Surfaces 12–13 (L7 front / L8 rear of a cemented doublet in G2) and 16–17 (L9 front / L10 rear of
a cemented doublet in G3) are transcribed the same way p20.json's own cemented interfaces are:
the second surface of each pair carries `coated: false` and both surfaces' `nd`/`vd` come
straight from the patent row that lists them (each cemented interface's shared vertex is one
patent surface row with the *next* glass's index/Abbe number attached, not a separate air-gapped
row).

## Open problems / uncertainty

- The chief-ray image-height bonus check (+1.228%) is looser than the other normal-prime lenses
  in this project, though still inside a few percent and not part of the required EFL/BF gate.
  Possible causes not investigated further: this design's wider field angle amplifies paraxial
  (vs. real, aberration-corrected) chief-ray error more than at 50mm+, or a very small digit-level
  transcription slip in a rear-group surface not caught by the two-copy (JP/English-MT) digit
  cross-check, since both copies agreed everywhere. Left as an open flag, not corrected by
  loosening any tolerance.
- All `sd` values are first-order paraxial estimates, not patent data (see the caveat above); a
  real clear-aperture figure or a full skew-ray trace with vignetting would supersede them.
- The patent's own near-focus test condition (300mm shooting distance) is not stated to be
  measured from a particular reference plane (object to first surface, or to the image plane);
  recorded as-is, same caveat as every other lens file in this project.
- Sigma's product angle of view (63.4°) and the patent example's angle of view (2ω = 65.49°,
  i.e. 63.4 vs. patent's roughly-comparable full angle) differ slightly, a normal
  generic-patent-example-vs-shipped-product gap (per `docs/BRIEF.md`: "representative designs are
  schematic"), same as the f=34.00mm raw example vs. the 35mm marketed class and Fno=1.45 vs. the
  marketed f/1.4.
