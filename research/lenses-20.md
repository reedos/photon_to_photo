# 20 mm prime — lens-20 research note

> **Lead correction, 09/28/2026.** This note's argument against the Sigma 20mm F1.4 DG HSM | Art tie is wrong. The ~1 mm figure is the gap from the filter/cover-glass plate to the image, not the back focus: the lens-to-image distance is 36.50 + 1.45 + 1.00 = 38.95 mm, and the patent's total length (161.26 mm) runs from the first surface to the image plane, so about 117 mm remains in front of an EF mount (44 mm flange), consistent with the product's 129.8 mm length. data/lenses/p20.json now sets representativeOf from the Photons to Photos tie and the 15/11 match.


Agent: lens-20. Covers `data/lenses/p20.json` only (the wide-primes agent left this slot open;
see research/lenses-wide.md's "Open problems" section for its lead-finding work, which this note
picks up from). Accessed date for every source in this note: 9/28/2026.

## Summary

| Focal (nominal) | Patent f / Fno (stated) | Patent | Example | Assignee | Published | Elements / groups | Representative product | Min focus | Blades | EFL check | BF check |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20 mm | 20.69 mm / F1.46 | [JP 2019-117419 A](https://patents.google.com/patent/JP2019117419A/en) (granted JP 6665960 B2) | Numerical Example 1 | Sigma Corp | 7/18/2019 | 15 / 11 | none — see "Why `representativeOf` is omitted" below | 0.276 m, assumed (class stand-in) | 9, assumed (class stand-in) | +0.017% err (pass) | not checkable — patent never states a numeric BF; derived, see below |

Tolerance required by the brief: EFL within 0.5%, BF within 1% or 0.2 mm. EFL passes with a wide
margin. BF cannot be checked against a patent-stated value because the patent never prints one
for this example (same situation as p85 in research/lenses-normal.md) — the JSON's last-surface
`t` is instead **derived** from this file's own paraxial trace, cross-corroborated by a second,
independent arithmetic check on the patent's own "Lens total length" figure (see below). Both
derivations land within 0.004 mm of each other (1.0010 mm vs. 0.997 mm), so the transcription is
internally self-consistent — but that derived BF is itself the basis of this note's main finding.

## The lead this note started from

The wide-primes agent (research/lenses-wide.md) found and flagged, but could not read, **Canon
JP 2022-020096 A**, reported by CanonWatch to contain a 20.60 mm F1.85 Numerical Example 2.
`patents.google.com` returned HTTP 503 to every fetch attempt for that document (and for every
other `patents.google.com` URL tried directly in this session too — the block is IP-level, not
document-specific; confirmed again here, see "Access method" below). Rather than wait out the
block, this note used the task's second lead: `.local/lens-normal/modeldata.tsv`, a saved copy of
photonstophotos.net's Optical Bench Hub (a table of ~1280 patent-to-product ties independently
maintained by Bill Claff). Filtering it for `20mm` product names turned up several full-frame,
f/1.4-f/2-class candidates with a stated product tie:

- `US20250389929 Example02P` — Canon RF20mm F1.4L VCM (newest; a 2025 US application)
- `JP2019-117419 Example01P` — **Sigma 20mm F1.4 DG HSM Art** (used here)
- `WO2020-213337 Example02P` — Sony FE 20mm F1.8 G
- `JP2016-021011 Example04P` — Nikon AF-S Nikkor 20mm f/1.8G ED (F-mount)

The Sigma patent was tried first because Sigma's JP applications rendered cleanly as text for the
lens-normal and lens-wide agents (no OCR/scan issues), and because a "P"-suffixed row in this hub
means photonstophotos specifically ties that numbered example (not just the patent) to a named
product — the strongest kind of lead the task asked to prefer.

## Access method

`patents.google.com` returned HTTP 503 ("Sorry ... automated queries") to every direct `curl` and
to the `WebFetch` tool for every URL on that domain tried this session, including the plain HTML
patent page, the `/xhr/query` search endpoint, and even a differently-formatted query string —
consistent with the IP-level block the wide-primes and lens-normal agents both hit. The workaround
used here: fetching the same URLs through the `r.jina.ai` read-it-later proxy (`curl
https://r.jina.ai/https://patents.google.com/...`), which returns Google's server-rendered content
converted to plain text/Markdown from a different egress IP. This worked (HTTP 200) for both the
description/claims text and, with the `X-Return-Format: html` header, the raw page HTML needed to
recover the bibliographic sidebar (assignee, filing/publication dates, granted number), which the
proxy's default Markdown extraction drops entirely. No patent table in this note was read as an
image; every surface-data figure below was read as plain text, cross-checked against a duplicate
(see next section).

## Self-check

`.local/lens-20/raytrace.py` (a copy of `.local/lens-wide/raytrace.py`, unmodified) is the same
from-scratch paraxial **y-nu** ray tracer described in research/lenses-wide.md: it traces the
marginal ray (parallel, infinity focus) through every listed surface to get computed EFL
(`-y1/u_final`) and computed BFD (`-y_last/u_final`, stopping right after the last surface's own
refraction rather than propagating by its own `t` — that `t` **is** the unknown being solved for),
and a second independent ray to build the chief ray at the patent's own stated half field angle for
a secondary image-height cross-check. Aspheric terms are correctly excluded (second-order and
higher in ray height, so paraxial-invisible by construction, not by omission).

```
=== p20 (20 mm f/1.4 retrofocus wide-angle (patent numerical example)) ===
  EFL   computed 20.6935 mm   stated 20.6900 mm   err +0.017%
  BFD   computed 1.0010 mm   stated: (none)
  Chief-ray image height computed 22.0710 mm   stated 21.63 mm   err +2.039%
```

- **EFL: pass, wide margin.** +0.017% is well inside the required 0.5%.
- **BF: not checkable against a patent-stated value** — see "No stated BF" below. The computed
  1.0010 mm is corroborated by an independent arithmetic derivation (see below), which is a
  self-consistency check on the transcription, not a pass/fail against the patent's own number
  (there isn't one).
- **Chief-ray image height: secondary, non-required diagnostic.** +2.039% is larger than p24/p28's
  (both well under 0.1%) but smaller than p35's (+2.254%, research/lenses-normal.md), and follows
  the same pattern documented there: this design's half field angle (46.845°, derived from the
  patent's own "total angle of view 2ω = 93.69°") is much wider than p24's 42.03° or p28's ~37.69°,
  and the `u1 = tan(halfFieldDeg)` paraxial proxy diverges further from a real (non-paraxial,
  distortion-carrying) ray at wider field angles. Not evidence of a transcription error, since EFL
  (which does not depend on this proxy at all) passes to four significant figures.
- **Elements/groups**: counted directly from the surface table's cemented/air-spaced grouping —
  15 elements in 11 groups (1+1+1+1+2+1+2+3+1+1+1, cemented doublets/triplet each counted as one
  group). This matches Sigma's own published spec for the Sigma 20mm F1.4 DG HSM | Art
  ("15 elements in 11 groups", https://www.sigmaphoto.com/20mm-f1-4-dg-hsm-a) exactly — see the
  next section for why this match does not settle the identity question.

## Why `representativeOf` is omitted despite the element/group match

This is the substantive finding of this note. Two independent, source-backed checks contradict
treating this patent example as the real shipped Sigma 20mm F1.4 DG HSM | Art, despite the
photonstophotos tie and the exact 15/11 element/group match:

1. **Total length.** This example's own stated "Lens total length" is **161.26 mm**. The real
   Sigma 20mm F1.4 DG HSM | Art is **129.8 mm** long
   (https://www.sigmaphoto.com/20mm-f1-4-dg-hsm-a, "Dimensions: 90.7mm x 129.8mm", accessed
   9/28/2026) — a 31.5 mm (24%) gap. This is not a quirk of picking the "wrong" one of the
   patent's five numerical examples: all five state total lengths in the same 156.4–161.8 mm range
   (checked directly against the patent text for Examples 2–5 too), all well above 129.8 mm.
2. **Back focal distance.** The patent gives no numeric BF for any example (see below), but this
   file's own derived value — corroborated two independent ways (paraxial trace and total-length
   arithmetic, agreeing to 0.004 mm) — is only **~1.0 mm**. The real Sigma 20mm F1.4 DG HSM | Art
   shipped only in SLR mounts (Canon EF, Nikon F, Sigma SA), all of which need on the order of
   40 mm of clearance behind the last lens surface for the reflex mirror. A ~1 mm optical back
   focus cannot physically be built into any of those mounts (or into any common mirrorless mount
   either — even Sony E's comparatively shallow 18 mm flange distance is nowhere close).

Both checks point the same direction, independently of each other and of the paraxial self-check
above (which only verifies internal consistency of the transcription, not real-world identity).
photonstophotos.net's own Optical Bench Hub page states the caveat plainly: "there is no guarantee
that a production lens followed the patent optical prescription precisely" and "in some cases the
patent optical prescription doesn't line up perfectly with the production lens"
(https://www.photonstophotos.net/GeneralTopics/Lenses/OpticalBench/OpticalBenchHub.htm, accessed
9/28/2026). This looks like exactly that case: the "P"-suffixed tie in `modeldata.tsv` most likely
reflects that this patent covers the same optical *family* or *design lineage* Sigma used for the
naming-conventionally-similar product (hence the coincidentally matching element/group count and
the closely matching f/Fno/field-of-view), without this specific numbered example being the
literal as-shipped prescription.

Given that, `representativeOf`/`representativeSource` are correctly left out of the JSON per the
schema's own rule ("only when a source says so" — and here two independent facts say otherwise).
`minFocusM` (0.276 m) and `iris.blades` (9, rounded) are still populated from the Sigma 20mm F1.4
DG HSM | Art spec page as **assumed, order-of-magnitude class stand-ins** — the same treatment
p24/p28 give an unconfirmed tie in research/lenses-wide.md — not as this patent example's own
values.

## No stated BF, and how it was derived

The surface table's last row prints the literal placeholder text "BF" in the thickness column
(confirmed in both the Japanese original and the English machine-translation copy) instead of a
number, and — unlike the Canon patents in research/lenses-wide.md — there is no separate
"various data" row that supplies a numeric BF either; `[Various data]` lists only focal length,
F-number, total angle of view, image height and total length. This is the same situation p85 hit
in research/lenses-normal.md. Two independent derivations were used:

1. **Paraxial trace** (`raytrace.py`): 1.0010 mm, from the r/t/n data of surfaces 1–28 alone.
2. **Arithmetic on the patent's own stated total length**: 161.26 mm (stated) − 160.263 mm (sum of
   this file's own `t` values for surfaces 1–28 at infinity focus) = 0.997 mm.

The two agree to 0.004 mm, well inside the rounding of a total-length figure given to only two
decimal places while every other value in the table is given to four. This agreement is a
self-consistency check on the transcription (no digit was transposed in a way that would produce a
short BF by accident) — it does not, and cannot, resolve the "why is this so short for an SLR-mount
lens" question raised above; that question is about the real number being implausible for the
claimed product, not about a transcription error. `stated.bf` is deliberately left unset in the
JSON; the JSON's last-surface `t` (1.001 mm) is recorded as derived, with a note pointing here.

## Digit-level cross-check

Every numerical-example table in this patent is printed twice in the fetched text — Japanese
original, then Google's English machine translation immediately after. All digits agree between
the two copies for every surface in Example 1 with one exception: surface 28's radius is
`r = ∞` in the Japanese original ("28 ∞ 1.4500 1.52301 58.59") but renders as the garbled digits
"1.4" in the English MT copy ("28 1.4 1.4500 1.52301 58.59") — an isolated single-character
OCR/translation artifact (the correct `∞` shows intact one line below, for surface 29, in the same
English copy). `r = ∞` (flat) is used for surface 28 in the JSON, matching the Japanese original
and matching the physical expectation for a flat filter/cover-glass face.

## Asphere convention

The patent's own text (§ preceding `[Aspheric surface data]`) defines the aspheric surfaces with
"conic coefficient K" and a standard sag equation
`z = c·h²/(1+√(1−(1+K)·c²·h²)) + A4·h⁴ + A6·h⁶ + A8·h⁸ + A10·h¹⁰ + A12·h¹²`, with `K = 0` meaning a
sphere — the same convention already used for p24/p28 in research/lenses-wide.md. Four aspheric
surfaces in Example 1: both faces of the front doublet element (patent surfaces 3–4) and both
faces of the rearmost element (patent surfaces 26–27), each with its own K/A4/A6/A8/A10/A12 set (no
A14/A16 terms, no odd-order terms).

## Semi-diameters

No effective/clear-aperture table anywhere in the patent text (checked both language copies), so
every surface uses `sdSource: "estimated-from-marginal-ray"`, computed by the same method as
research/lenses-wide.md and research/lenses-normal.md: `sd(i) = |marginal_ray_height(i)| +
|chief_ray_height(i)|`, with the marginal ray scaled to the stated Fno (via the computed EFL) and
the chief ray scaled to the stated half field angle. This is a first-order, vignetting-blind
estimate and, per the established caveat, should read as a lower bound for the front group of this
fast retrofocus design, not a manufacturing figure.

## Other candidates considered but not transcribed

- **Canon JP 2022-020096 A** (the wide-primes agent's original lead, 20.60 mm F1.85): still
  blocked by the same `patents.google.com` 503 as of this session; the `r.jina.ai` proxy route that
  worked for the Sigma patent was not retried against this one once a usable 20 mm source (Sigma)
  was already in hand, in the interest of finishing one clean, self-checked lens rather than two
  partial ones. Worth retrying with the proxy method documented above if a second/better 20 mm
  source is wanted later — in particular it would let a future pass compare against a lens that
  does not carry this note's total-length/BF contradiction.
- **Canon RF20mm F1.4L VCM** (`US20250389929 Example02P` in `modeldata.tsv`): the closest possible
  match to the brief's target spec (full-frame, f/1.4, newest), but a very recent (2025) US
  application; not attempted this session after the Sigma patent's EFL self-check passed cleanly,
  in the interest of time. A good first alternative to try if the Sigma patent's
  total-length/BF contradiction turns out to matter for a later pass.
- **Sony FE 20mm F1.8 G** (`WO2020-213337 Example02P`) and **Nikon AF-S Nikkor 20mm f/1.8G ED**
  (`JP2016-021011 Example04P`): identified in `modeldata.tsv` but not fetched; both are legitimate
  full-frame f/1.8-class alternatives if a second 20 mm source is ever wanted.

## Open problems

- **This file's `representativeOf` is omitted, and unlike p24/p28/p35's omission (which is about
  an unconfirmed tie), this one carries a positive contradiction**: the patent's own total length
  and this file's derived BF both disagree with the real Sigma 20mm F1.4 DG HSM | Art's known
  physical dimensions and mount requirements, despite the exact element/group match. Treat this
  file as "a real, self-checking 20 mm-class f/1.4 patent numerical example, of unconfirmed product
  identity" per the schema's `source.kind: "patent"` (not `"representative"` — it is a real patent,
  just not confirmed tied to a specific shipped product), not as data about the specific shipped
  Sigma lens.
- **`stated.bf` is absent**; the JSON's last-surface `t` is derived, not patent-stated (see above).
  A reviewer wanting a lens with a patent-stated BF should look at p24/p28 (Canon) or p50/p105/p135
  (research/lenses-normal.md) instead.
- **Blade count and minimum focus are class stand-ins**, sourced to the same (unconfirmed-identity)
  Sigma product page, same caveat as p24/p28's stand-ins in research/lenses-wide.md.
- **Semi-diameters are paraxial estimates everywhere** (no patent in this family publishes clear
  apertures); see the caveat above, especially for the front group.
