# Mirrorless super-telephoto PF (z800) — research note

Agent: lens-z800 (redirected from an earlier z600 attempt). File: `data/lenses/z800.json`.
Accessed date for every source below: 9/28/2026, unless stated otherwise.

## Target change mid-task

This slot started as a search for the patent numerical example behind the **NIKKOR Z 600mm f/6.3
VR S**. That search (Google Patents full-text search via the r.jina.ai reader proxy, since direct
`patents.google.com` fetches returned HTTP 503 every time; `cameragossip.github.io`'s Nikon
lens-patent tracker; `asobinet.com`; `digicame-info.com`; `nikonrumors.com`;
`photonstophotos.net`'s Optical Bench Hub and its `modeldata.tsv`) found no patent example, tracker
entry, or published source tying any numerical example to the Z 600mm f/6.3 VR S (21 elements / 14
groups per Nikon's own spec). Every 585 mm-class example in the one plausible candidate patent
family (JP 2023-023323 A / granted JP 7695611 B2, the same family `data/lenses/m500.json`
transcribes Example 1 of) is described by digicame-info.com's own contemporaneous coverage
(<https://digicame-info.com/2023/02/pf600mm-f561000mm-f8400mm-f45.html>) as a "600mm f/5.6" class
design — a lens Nikon designed but never shipped — and the same trackers instead tie this family to
the **already-shipped NIKKOR Z 800mm f/6.3 VR S**. No `z600.json` file was ever written (per the
brief's "do not ship a file" rule for an unconfirmed match), so there is nothing to delete.

The coordinator redirected this workstream to the Z 800mm f/6.3 VR S on Reed's call, based on that
same tracker evidence, with an explicit instruction to verify the tie independently rather than take
the trackers' word for it — see "Why `representativeOf` is set" below for that verification.

## The patent

**JP 2023-023323 A**, Nikon Corporation, "Optical system and optical equipment" (title
machine-translated), published (kokai) 2/16/2023, later granted as **JP 7695611 B2**.
<https://patents.google.com/patent/JP7695611B2/en> — direct fetch returned HTTP 503 every time it
was tried in this session; reads went through the r.jina.ai reader proxy,
`https://r.jina.ai/https://patents.google.com/patent/JP7695611B2/en`, which returns Google Patents'
own machine-OCR'd/translated HTML/text, not the original PDF page images.

The patent contains **eight** numerical examples (OL1–OL8), more than either predecessor
transcription (`n500.json`, `m500.json`) had found — the raw full-text dump was searched directly
for `第６実施例` / `Example 6` / `OL6` markers rather than relying on a single summarized fetch (an
earlier summarized fetch of this same document, asked generically for "every numerical example,"
only surfaced 5 of the 8 and is not used anywhere in this file — see "A process note on
verification" below). The eight examples pair up by focal-length class: OL1/OL2 at ~585 mm F5.71,
OL3/OL4 at ~1000 mm F8.16 (not examined closely by this workstream), OL5/OL6 at ~780 mm F6.42 (OL6
is this file), and a further pair this workstream did not examine (not needed once OL6 checked out).
This file transcribes **Example 6 (第６実施例, optical system OL6)**, Table 16–18 in the patent's own
numbering.

### A process note on verification

The first WebFetch of the granted patent, asked to summarize "Example 6" specifically, returned data
that on inspection was actually a mislabeled copy of Example 2's specs (585.00008 mm / F5.71,
including the exact reconstructed `d2=30.63380` value `m500.md` had flagged as a *derived*, not
OCR'd, number for a different example entirely) — a clear sign that a summarizing fetch can silently
mislabel content instead of reporting "not found." This was caught by re-fetching the patent's raw
text (no summarization) and grepping it directly for `第６実施例`/`OL6`, which located the genuine
Table 16–18 block transcribed below. The lesson generalizes: do not trust a WebFetch summary's own
example/table labels without an independent raw-text grep confirming the section actually exists
under that label.

## Why `representativeOf` is set to "Nikon NIKKOR Z 800mm f/6.3 VR S"

Two independent third-party Nikon lens-patent trackers tie this **patent family** (not this specific
example) to Nikon's shipped PF super-telephoto primes:

1. `cameragossip.github.io/nikon-lens-patents.html` — surfaced in this session's searches as tying
   this family to Nikon's PF super-telephoto line generally.
2. `asobinet.com/info-patent-nikon-pf-super-tere-lens/` (2/16/2023) — covers the same patent
   application (P2023023323, application number P2021-128741) explicitly listing "600mm F5.6",
   "1000mm F8", and **"800mm F6.3"** as the classes its numerical examples resemble.

Per the coordinator's explicit instruction, this tie was verified directly rather than taken on the
trackers' word:

- **Element/group count, exact match.** Nikon's own published spec for the NIKKOR Z 800mm f/6.3
  VR S (<https://www.nikonusa.com/p/nikkor-z-800mm-f63-vr-s/20108/overview>, accessed 9/28/2026):
  "22 elements in 14 groups... 3 ED elements, 1 SR element, 1 PF element." This file's own
  mechanical count from Example 6's patent text (every glass segment an element, a cemented run one
  group, the PF assembly's host lens + 2 resin layers merged into 1 element per the same
  `layer: "resin"` convention `n500.json`/`m500.json` use) is **22 elements in 14 groups, exactly**
  — see "Element and group counting" below for the surface-by-surface tally.
- **Fno gap direction/magnitude, consistent with the rest of this project's PF files.** The patent's
  own Fno (6.41999) sits slightly above the marketed f/6.3 class, in the same direction and roughly
  the same size as `n500.json` (patent 5.75 vs marked 5.6) and `m500.json`'s own Example 1 (patent
  5.71 vs a 600mm f/5.6 class that never shipped) — internal consistency across the whole family,
  not proof by itself.
- **Focal-length class.** Example 6's f=779.99933mm rounds to the "800mm" marketed class exactly
  the way `n500.json`'s f=489.7 rounds to "500mm" and `m500.json`'s f=585.0 was argued (incorrectly,
  per the retracted z600 tie) to round to "600mm."

No source states outright that this specific numerical example IS the shipped 800mm f/6.3 VR S —
this is the same strength of circumstantial-but-exact-signature-match tie `n500.json` draws for the
500mm f/5.6E PF, not a company confirmation.

## The diffractive surface (DOE / phase Fresnel)

Patent surface 7 (0-based surface index 6 in this file's `surfaces` array, marked with the patent's
own `#`) is the diffractive interface. Table 17, transcribed verbatim:

```
psi(h,n) = (2*pi/(n*lambda0)) * (C2*h^2 + C4*h^4)
phiD(lambda,n) = -2*C2*n*lambda/lambda0
```

Example 6's row: `lambda0 = 587.6 nm`, `n = 1.0`, `C2 = -4.02091e-05`, `C4 = -2.29061e-10`,
as printed. At the design condition (`lambda=lambda0`, `n=1`):
`phiD = -2*C2 = +8.04182e-05 mm^-1` (`fpf = 1/phiD = 12434.996 mm`) — a weak corrective assist, not
the dominant power source, exactly the same role the DOE plays in `n500.json` and `m500.json`.

**This is the identical DOE material pair `m500.json`'s Example 1 uses**: `nd=1.5295/vd=36.27`
(material A) and `nd=1.5498/vd=50.91` (material B), cemented to a host element with the same
`nd=1.5168/vd=64.13` glass as `m500.json`'s host lens — strong internal evidence Nikon reused the
same close-contact multilayer material pair across numerical examples within this one patent filing.

A second, independent corroboration: the patent's own Table 26 (headlined "Fifth Example / Sixth
Example / Seventh Example / Eighth Example") states `fpf` for the Sixth Example directly as
`12434.996` — matching this file's own `-2*C2`-derived value to 8 significant figures.

## Surface table and the "virtual surface" quirk

Patent surface 13 (`r=2165.2785`) has `t=0.0000` in the patent's own printed table, immediately
followed by patent surface 14 (`r=0.0000`, i.e. flat, `t=17.5002`), which the patent's own text
states explicitly: *"the 14th surface is a virtual surface and is not shown in Fig. 11"*
(第１４面は仮想面であり、図１１には図示していない). This is transcribed here as two consecutive
surfaces (this file's index 12 with `t=0`, index 13 with `r=null`/`t=17.5002`) — the same device
`m500.json`'s own transcription already uses for its flat air-spaced reference surface. It is not a
real physical lens face, just the patent's own bookkeeping split of one continuous 17.5002 mm air
gap into two printed rows.

## Self-check (paraxial y-nu trace)

A standalone Node.js script (`.local/z800/check.js` in this session's scratch area, not committed —
same marginal/chief method as `.local/n500/paraxial_n500.py` and `.local/m500/paraxial.py`, ported
to JS) traces the marginal ray from infinity with the DOE's own paraxial power added as a thin-lens
kick (`nu -= y*phiD`) at surface index 6, exactly `doePower`'s formula in `docs/engine/doe.md`.

```
sum(t) incl. BF = 393.4546 mm   vs patent's stated TL = 393.4547 mm   (diff -0.0001 mm, rounding only)

WITHOUT the DOE's paraxial power: EFL = 859.0448 mm   (off by +10.1% -- confirms the DOE is load-bearing)
WITH the DOE's paraxial power:    EFL = 780.0084 mm   BF = 74.5719 mm

stated f  = 779.99933 mm   computed EFL error = +0.0012%   (tolerance 0.5%)   OK
stated Bf =  74.56937 mm   computed BF  diff  = +0.0025 mm (tolerance 1%/0.2mm) OK
```

Both required tolerances pass comfortably, and — unlike `m500.json`'s Example 1 — **no value needed
reconstruction**: the patent's own printed `d1(infinity)=6.00000` and `d2(infinity)=62.50000` (Table
18) plug directly into the trace with no OCR-garbling diagnosis needed. The full Tables 16–18 block
was independently re-fetched a second time via the same r.jina.ai proxy and matched digit-for-digit
both times.

Half field of view: patent states `omega=1.56363 deg`; a naive `atan(Y/f) = atan(21.6/779.99933) =
1.586 deg` is close but not identical — the same small, expected pupil/distortion-driven gap
`n500.json`'s own half-field cross-check documents, not a transcription error.

## Element and group counting

Counted directly from the patent's own text description of OL6's construction (quoted verbatim in
the patent, and cross-checked surface-by-surface against Table 16's lens-data rows):

- **G1** (patent's positive first group): L11, L12, L13 (PF host — its close-contact multilayer DOE
  counts as part of L13, not as separate elements, `n500.json`'s/`m500.json`'s own convention),
  {L14+L15 cemented}, L16, {L17+L18 cemented} = **8 elements in 6 groups**.
- **G2** (the sole focus group): L21, a single element = **1 element in 1 group**.
- **G3**: {L31+L32}, L33 (single), {L34+L35}, {L36+L37}, {L38+L39}, {L310+L311}, {L312+L313} =
  **13 elements in 7 groups**.
- **Total: 8+1+13 = 22 elements; 6+1+7 = 14 groups.**

This is an **exact** match to Nikon's own published "22 elements in 14 groups" for the NIKKOR Z
800mm f/6.3 VR S — independent confirmation that both the patent's own printed element list and this
file's surface-by-surface transcription are correct and mutually consistent.

## Other specs, evidence kind, and what's assumed

- `minFocusM = 5.0` — Nikon USA product page for the NIKKOR Z 800mm f/6.3 VR S
  (<https://www.nikonusa.com/p/nikkor-z-800mm-f63-vr-s/20108/overview>, accessed 9/28/2026):
  "Closest Focus: 5m / 16.4 ft." Not tied to this patent example by any source; the patent's own
  close-focus condition (`d0=4606.5453 mm` from the front vertex) is a different, non-comparable
  datum (measured from the front vertex, not the sensor), same convention as `n500.json`.
- `iris.blades = 9`, rounded, evidence kind `assumed` — Nikon's own USA spec page for this lens does
  not print a diaphragm-blade count (checked directly, 9/28/2026); 9 rounded blades is assumed by
  analogy with `n500.json`'s and `m500.json`'s own Nikon spec pages (both 9 rounded blades), not
  confirmed for this specific lens.
- No aspheric coefficients are printed anywhere in Example 6's numerical table — every `r` is a
  plain spherical (or flat, for the stop and the virtual surface) radius; the only non-spherical
  element is the DOE's own additive phase term.
- No effective/clear diameter is printed for any surface (same situation as every telephoto file in
  this project's set); every `sd` is `sdSource: "estimated-from-marginal-ray"`, computed by this
  session's own Node.js self-check script using the same method as `n500.json`/`m500.json`:
  entrance-beam semi-diameter at surface 1 = `EFL / (2*Fno)`, traced forward, plus the paraxial
  chief ray at the patent's own printed half field, `sd = |marginal| + |chief|`.

  **A caveat worth flagging explicitly**: this method's computed front-element semi-diameter here
  (101.6 mm, i.e. a ~203 mm diameter) is considerably larger than what the real product's spec sheet
  implies (Nikon states the lens body itself is 140 mm in diameter, so the front glass must be
  smaller than that). The same oversizing shows up, proportionally, in `n500.json` (65.2 mm computed
  vs a ~95 mm filter thread, i.e. ~47.5 mm implied radius) and `m500.json` (62.4 mm computed against
  a similarly-sized real filter thread) — this is a known, already-accepted property of the
  marginal-plus-chief-ray estimation method across every telephoto file in this project (long,
  internally-focusing telephotos put the stop far from the front group, so the paraxial chief ray at
  the front surface is large relative to the real vignetted/mechanically-limited aperture), not a
  defect specific to this transcription. It is flagged here rather than silently accepted because the
  gap is larger in absolute terms for this longer lens than for the shorter files, and whoever
  eventually renders this lens's housing/front element in the UI should use the real product's
  physical dimensions for the barrel, not this file's `sd` values, for anything outside the optical
  ray trace itself.
- `maxFno` (6.41999, the patent's own Example 6 value) vs `markedFno` (6.3, the marketed class): a
  gap of the same sign and similar size to `n500.json`'s own 5.75-vs-5.6 gap.
- `focus.method = "inner"`: the patent's own `d1`/`d2` pair describes the single lens in G2 (patent
  surface 18) sliding between two otherwise-fixed neighbors — `d1` shrinks by exactly as much as
  `d2` grows (and vice versa) between infinity and the patent's own close-focus example
  (`beta = -0.16674`, `d0 = 4606.5453 mm`, per the patent's own printed values).

## Vitest results

`npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts` — **255 tests pass, 0 fail**
(full repo run, not just this file), including all 13 `z800`-specific checks:

```
lenses.test.ts > z800 > loads without error
lenses.test.ts > z800 > efl within 0.5% of stated.f (779.99933 mm)
lenses.test.ts > z800 > bfd within 1% or 0.2 mm of stated.bf (74.56937 mm)
lenses.test.ts > z800 > maxFno is the patent's own stated F-number (6.41999)
lenses.test.ts > z800 > the stop radius for maxFno gives that F-number and fits inside the stop clear aperture
lenses.test.ts > z800 > every glass reproduces the patent nd and vd (exact catalog match or model glass)
lenses.test.ts > z800 > element count matches the file (22; plates are not elements)
lenses.test.ts > z800 > group count matches the file (14; plates are not groups)
realize.test.ts > realize z800 > best focus is within 1 mm of the paraxial image and the on-axis spot is sharp (< 15 um RMS)
realize.test.ts > realize z800 > the full pupil passes on axis at full aperture (F, d, C)
realize.test.ts > realize z800 > at 70% of the field most of the pupil passes
realize.test.ts > realize z800 > the corner passes about 0.55 of the pupil diameter (mechanical vignetting, the cat's eye)
realize.test.ts > realize z800 > focuses at its closest reachable distance and the on-axis bundle still passes
```

The DOE resin materials (surface indices 5–6, `nd=1.5295/vd=36.27` and `nd=1.5498/vd=50.91`) resolve
without the `FAIL_LOUD_MAX_DND`/`FAIL_LOUD_MAX_DVD` catalog-tolerance problem that blocked
`m500.json` from loading at all in the shared engine: both surfaces are marked `layer: "resin"`,
which `src/engine/lens.ts`'s `resolveMedium` explicitly bypasses for that guard (see
`docs/engine/doe.md`'s "Element counting and catalog matching for laminated (resin) layers"). This
lens loads and traces end to end with no engine-side workaround needed, unlike `m500.json`.

## Open problems

1. **`representativeOf` is a strong circumstantial match, not a company confirmation.** See "Why
   `representativeOf` is set..." above — no source states this specific numerical example IS the
   shipped 800mm f/6.3 VR S; the tie rests on an exact element/group/DOE-construction signature match
   plus two independent trackers pointing at the same patent family (not this specific example).
2. **The other six examples in this patent (OL1–OL5, OL7, OL8) were not examined in depth** beyond
   confirming their approximate focal-length classes from the patent's own summary tables (Table 26).
   If a future workstream needs the 1000mm F8 class or the shorter fourth pair, this file's own
   process note (grep the raw fetched text for the example's own Japanese heading, don't trust a
   summarized WebFetch's example labels) should save time.
3. **Estimated semi-diameters run large at the front elements** relative to the real product's
   physical dimensions (see "Other specs" above) — an accepted property of this project's estimation
   method, not something this file can fix on its own, but worth keeping in mind for anything that
   renders this lens's housing.
4. Did not independently verify every digit of Table 16's rear-group surfaces (indices 20–38)
   against a third, differently-sourced transcription beyond the two r.jina.ai re-fetches (both
   through the same underlying Google Patents OCR/translation pipeline) — the self-check's exact
   TL/EFL/BF/element/group match across five independent quantities (TL, EFL, BF, elements, groups)
   is strong internal evidence the whole table is transcribed correctly, but none of it was checked
   against the patent's own PDF page images (patentimages.storage.googleapis.com), which returned no
   accessible URL for this specific patent in this session.
