# Spectral and color data: sources, licenses, formulas, caveats

Owner: workstream `color`. Builds `data/color/*.json` from the scripts in `.local/color/`
(`build_color_data.py`, `build_camera_and_checker.py`, `build_srgb_and_bins.py`, run in that order
with `python <script>.py`, no arguments). Every number in `data/color/` is either copied verbatim
from a cited file (evidence `spec` or `reported`) or computed by one of those scripts, with the
method documented both here and in the JSON file's own `calc` field (evidence `derived`). Nothing
here was typed in by hand from memory. Dates below are M/D/Y; everything was accessed 9/28/2026.

The evidence-kind vocabulary (`spec` / `vendor` / `reported` / `derived` / `assumed`) is the same
`EvidenceKind` used in `src/engine/lens-types.ts`, applied here at dataset granularity rather than
per-figure, since each file is one coherent table from one source.

## 1. CIE color-matching functions and illuminants — primary source: cie.co.at

CIE's data-table pages (`cie.co.at/datatable/...`) each link a CSV plus a DataCite-schema
`_metadata.json` with a DOI, the exact upstream report/table, and a `rightsList`. I fetched both
for every file below and read the `rightsList` directly rather than assuming; all five are
**CC BY-SA 4.0** (`https://creativecommons.org/licenses/by-sa/4.0/`), confirmed per-file, not
assumed from one page for all of them. Raw CSVs + metadata JSONs are kept in `.local/color/` for
audit (gitignored).

| File | Dataset | CIE source | Range / step | DOI |
|---|---|---|---|---|
| `data/color/cie1931-2deg-cmf.json` | 1931 2-deg standard observer x̄,ȳ,z̄ | CIE 018:2019 Table 6 (= ISO/CIE 11664-1:2019) | 360-830 nm, 1 nm | `10.25039/CIE.DS.xvudnb9b` |
| `data/color/cie1931-2deg-cmf-5nm.json` | same, 5 nm | **derived** here — see below | 380-780 nm, 5 nm | (subsample of above) |
| `data/color/cie2006-2deg-physiological-cmf.json` | CIE 170-2:2015 cone-fundamental-based x̄F,ȳF,z̄F ("CIE 2006 physiological" / "2015 XYZ") 2-deg | CIE 170-2:2015 Table 10.7a | 390-830 nm, 1 nm | `10.25039/CIE.DS.548rw69q` |
| `data/color/illuminant-d65.json` | D65 relative SPD | ISO/CIE 11664-2:2022 Table B.1 | 300-830 nm, 1 nm | (D65 CSV metadata) |
| `data/color/illuminant-a.json` | A relative SPD (Planckian, 2856 K) | ISO/CIE 11664-2:2022 Table A.1, eq. 4.1 of CIE 015:2018 | 300-830 nm, 1 nm | (A CSV metadata) |
| `data/color/daylight-basis-s0s1s2.json` | S0, S1, S2 daylight basis components | CIE 015:2018 Table 6 | 300-830 nm, 5 nm | `10.25039/CIE.DS.w7zunnny` |

Download URLs (all under `https://files.cie.co.at/Publications-datasets/`):
`CIE_xyz_1931_2deg.csv`, `CIE_cfb_stv_2deg.csv`, `CIE_std_illum_D65.csv`, `CIE_std_illum_A_1nm.csv`,
`CIE_illum_Dxx_comp.csv`, each with a `<name>.csv_metadata.json` (D65/A/Dxx use the suffix
`_metadata_v2.json`; the 1931 and 170-2 ones use `_metadata.json` — CIE isn't consistent about
this, so I fetched both suffixes and kept whichever returned 200).

**Caveats, not glossed over:**
- **5 nm CMF file is `derived`, not `spec`.** The brief asked for "5 nm or 1 nm." CIE's free
  download for the classic 1931 observer is the 1 nm table only (CIE 018:2019 Table 6); I did not
  find a separately-published free 5 nm CIE datatable page for it (a 5 nm table exists inside paid
  CIE 015:2018, not on the free datatable list I could reach). `cie1931-2deg-cmf-5nm.json` is
  every 5th row of the same official 1 nm table (380, 385, ..., 780), which reproduces the
  historical 5 nm values exactly at those wavelengths (CIE's 1 nm table is itself the standardized
  Sprague-interpolation of the historical 5/10 nm data, and the CIE explicitly intends the two to
  agree at coincident points) — but since the subsampling step is ours, it's labeled `derived`
  with the calculation spelled out in the file, not `spec`.
- **CIE 170-2:2015 (2006 physiological) starts at 390 nm, not 380.** CIE does not tabulate this
  observer below 390 nm (Stockman & Sharpe cone fundamentals are negligible there and the standard
  doesn't extend the table). If the engine needs a 380-830 array aligned with the 1931 CMFs, it
  must zero-pad 380-389 nm itself and should label that padding — it is not a CIE-stated zero, and
  the JSON's `note` field says so.
- **D65/A "relative" units**: the standard convention pins S(560 nm) = 100 for the daylight/A
  series; I did not rescale the CIE's own numbers to any convention, they're stored exactly as
  downloaded, unit `relative spectral power`.
- **The Planck function and the daylight-locus CCT→(xD,yD)→(M1,M2) formula are explicitly not
  data** per the brief — they're in `daylight-basis-s0s1s2.json`'s `note` field as engine-side
  formulas (CIE 015:2018 eq. 3.3-3.4 for M1/M2; any single-CCT source, e.g. Planck's law with h, c,
  k_B, for a non-daylight blackbody). Not reproduced as a data file since they're pure functions of
  a scalar CCT input, not tabulated.

## 2. Camera spectral sensitivities — Jiang, Liu, Gu & Süsstrunk (WACV 2013)

`data/color/camera-sensitivity-jiang2013.json`: the paper named in the brief. Database page
<https://www.gujinwei.org/research/camspec/db.html>, data file
`camspec_database.txt` (24.5 KB, 28 cameras × R/G/B × 33 values at 400-720 nm, 10 nm step,
each channel normalized to its own peak = 1). Also mirrored on Zenodo
(<https://zenodo.org/records/3245883>, DOI `10.5281/zenodo.3245883`) — I fetched both pages and
they agree on file size/content and license.

**License is clear, and it's a real restriction: CC BY-NC-SA 4.0, "Copyright (C) Rochester
Institute of Technology."** Both the original page and the Zenodo record state this explicitly —
this was not an "unclear license" case, so per the brief I did **not** treat it as license-unclear,
but the **NC** (NonCommercial) term is still a genuine constraint worth flagging loudly: this
project is currently private, but the brief says it may go public later, and "public + monetized/
commercial" is exactly what NC forbids. I pulled the full 28-camera table anyway (it's small, and
useful for research/comparison), set `default_camera: "Nikon D700"` (a full-frame body, matching
the project's full-frame lens set), and wrote the restriction directly into the file's `license`
field so it can't be missed at integration time. **Flag to Reed before any public/commercial
deployment ships this file as-is.**

**Fallback, unencumbered**: `data/color/camera-sensitivity-gaussian-model.json`. Per the brief's
instruction ("if licensing is unclear, ALSO provide a documented parametric model... marked
derived") I built this even though the license wasn't unclear, because NC is exactly the situation
that instruction is for. Method: for each of the Nikon D700's R/G/B curves, compute the
**method-of-moments Gaussian** — weighted mean wavelength (= peak), weighted standard deviation
(= sigma), curve maximum (= amplitude) — over the measured curve. This is *not* a nonlinear
least-squares fit to the curve's shape; it's a cheap, fully-documented three-number summary
(`peak_nm`, `sigma_nm`, `amplitude` per channel), computed in `build_camera_and_checker.py`.
Labeled `derived`. It reproduces the broad peak/width of each channel but not fine structure (the
red channel's blue-tail bump from IR-cut/CFA crosstalk, etc.) — the file's `note` says to label any
UI use of it "representative CFA shape, not a measured camera." Because only three numbers per
channel are original statistics of the measured curve rather than a copy of the table, this file's
own `license` field calls it unencumbered — but it does have Jiang-data lineage (the fit is *of*
that data), so if Reed wants zero lineage even for six summary numbers, it should be refit from a
differently-licensed source instead of "cleaned up" from this one.

**Not attempted**: separating QE from CFA transmittance. The Jiang measurements are the *whole*
camera's response (through the lens/filter stack to the sensor), which is explicitly what the
paper measures and what the brief asks for ("R, G, B curves including QE and CFA" — i.e. the
convolved response), so this isn't a gap, just noting it's not decomposable from this source.

## 3. ColorChecker 24 patches — BabelColor Average, via `colour-science` (PyPI, BSD-3)

`data/color/colorchecker24-babelcolor.json`. The brief named two options: BabelColor averages, or
the data shipped in `colour-science` (Python, BSD-3). I used the second to get the first: installed
`colour-science==0.4.7` (`pip install colour-science`) and read
`colour.characterisation.SDS_COLOURCHECKERS['BabelColor Average']` directly (24 patches, 380-730 nm,
10 nm, reflectance factor). This *is* Danny Pascale/BabelColor's published average of 30 physical
ColorChecker Classic charts — `colour-science`'s own dataset docstring
(`colour/characterisation/datasets/colour_checkers/sds.py`) states
`__license__ = "BSD-3-Clause"` and separately credits
`"BabelColor ColorChecker data: Copyright (C) 2004-2012 Danny Pascale (www.babelcolor.com); used
by permission"` — i.e. colour-science's maintainers got permission to redistribute it under their
package's overall BSD-3-Clause license, which I read from the wheel's own
`colour_science-0.4.7.dist-info/licenses/LICENSE` (copied into `.local/color/` for audit) rather
than taking the docstring's word for the license name alone. (The same module also ships
`SDS_COLOURCHECKERS['ColorChecker N Ohta']` and `['ISO 17321-1']`, which its own module notes say
have been verified identical to each other — that cross-check is between those two, not a
confirmation of the BabelColor Average numbers used here; don't conflate the three.)

Patch names and order are `colour-science`'s own (`"dark skin"`, `"blue sky"`, ... `"black 2
(1.5 D)"`), preserved verbatim in `patch_order` so the JSON's `patches` map is unambiguous.

**Natural spectra (foliage, sky) — not completed, open problem.** The brief asked for "a few
natural spectra if openly licensed." I looked: NREL's ASTM G173-03 reference solar spectrum page
(`nrel.gov/grid/solar-resource/spectra-am1.5.html`, a plausible "sky/daylight" candidate, public
data from a US federal lab) failed to resolve over DNS when fetched (`ENOTFOUND www.nrel.gov`) —
per the brief's own instruction ("if a web page will not load... say so and move on"), I stopped
rather than guess its contents or retype remembered numbers. For foliage, EcoSIS
(`ecosis.org`, e.g. the LOPEX93 leaf-optics database) looked promising but its package page
returned no readable license/download content through the fetch tool available to me (title only,
no body). Neither is in `data/color/`. **Candidates for a follow-up pass**: NREL ASTM G173-03 (try
again, or via `pvlib`'s bundled copy which mirrors the same public data under a stated open
license), and EcoSIS LOPEX93 or one of the CABO leaf-spectra packages (read the per-dataset license
badge directly on the package page in a real browser, since the fetch tool couldn't render it).

## 4. Wavelength → display sRGB (`data/color/wavelength-to-srgb.json`)

Computed here (`build_srgb_and_bins.py`), `derived`, from `cie1931-2deg-cmf.json` — no other
source needed since this is pure colorimetry math, but the constant matrix used has a named source:
**XYZ→linear-sRGB matrix** (D65 white, IEC 61966-2-1 primaries) taken from Bruce Lindbloom's
published derivation (`brucelindbloom.com`, "RGB/XYZ Matrices"), self-checked in the script by
confirming it sends the D65 white point `(0.95047, 1.00000, 1.08883)` to linear `(1,1,1)` (within
2e-3) before it's used on anything.

**Method** (also in the JSON's own `calc` field, in full):
1. For wavelength λ, XYZ = (x̄(λ), ȳ(λ), z̄(λ)) — the tristimulus response to a unit-radiance
   monochromatic stimulus. Most of the visible spectrum lies outside the sRGB gamut here (at least
   one linear-sRGB channel goes negative).
2. **Gamut-mapping choice**: blend toward the D65 white point *at constant Y* (white is scaled to
   the same Y first, so the blend never changes luminance) until every channel is ≥ 0, i.e.
   desaturate rather than per-channel-clip. This is the documented choice the brief asked for, and
   the reason for it is concrete: per-channel clipping collapses a wide band of adjacent
   wavelengths onto the *same* clipped RGB (they all "hit the wall" at the same value), which is
   exactly the "clipped to the same hue" failure the brief calls out; constant-Y desaturation moves
   continuously with λ, so adjacent wavelengths stay visually distinct all the way to 380 and
   780 nm. `desaturation_t_natural`/`_display` record how far each λ had to move toward white (0 =
   already in gamut; the worst offenders are ~380-430 nm and ~520-560 nm, which is expected — those
   are the parts of the spectral locus farthest outside the sRGB triangle).
3. Two brightness variants, because one dataset can't serve both "physically honest" and "usable
   for drawing photons" at once:
   - **`natural`**: keeps the CMF's own ȳ(λ) as the luminance. Physically faithful (matches real
     photopic sensitivity), but that means it's genuinely near-black at both ends (ȳ(380 nm) ≈
     4×10⁻⁵) — correct, but useless as a photon-rain spark color, since a photon at 400 nm would
     render as an invisible dot.
   - **`display`**: rescales XYZ so **Y = 0.5 for every wavelength first** (a uniform scalar
     multiply preserves the x,y chromaticity exactly — hue and saturation are untouched — only
     magnitude changes), then the same constant-Y desaturation. Every wavelength renders at equal
     brightness; recommended for the photon-rain / ray-fan set pieces, where the brief wants
     wavelength to read as color and exposure/photon-count to read as brightness separately
     ("clarity beats glow," "what you see is computed"). `natural` is the one to use anywhere the
     page is making a claim about relative visibility/luminous efficiency itself.
4. `encoded` = IEC 61966-2-1 sRGB OETF applied to `linear` (standard piecewise gamma).

## 5. Wavelength binning proposals (`wavelength-bins-16.json`, `wavelength-bins-24.json`)

Computed here, `derived`, also from `cie1931-2deg-cmf.json`. **Equal-width bins** across
380-780 nm (25.0000 nm for 16 bins; 16.6667 nm for 24 — not a round number, but equal width was
weighted higher than round edges, see below). Reasoning, spelled out in each file's `calc` field:

- **Why equal width, not equal-energy or ȳ-weighted**: the brief's requirement is a bin *count*
  for spectral ray tracing, not a bias-minimization scheme. Equal width is the simplest thing to
  explain on the page and the cheapest to index from a wavelength inside a shader
  (`bin = floor((λ - 380) / width)`, no lookup table). An importance-weighted scheme (e.g. more,
  narrower bins where ȳ is large) would reduce reconstruction error for a fixed bin count, at the
  cost of that O(1) index no longer being a single division — a real tradeoff, noted but not taken,
  since this is an explainer, not a production spectral renderer.
- **Center = arithmetic midpoint** of the bin, for the same simplicity reason (a ȳ-weighted
  centroid would pull centers toward 555 nm and make "bin i's representative wavelength" a second
  lookup rather than arithmetic).
- **`cmf_integral`**: the *exact* bin-integrated `(X, Y, Z)` = ∫ x̄,ȳ,z̄ dλ over the bin, computed
  by linearly interpolating the 1 nm CIE table to 0.1 nm and Riemann-summing (documented, not a
  hidden approximation). This is what makes the bins actually useful for rendering: if a spectral
  path tracer assigns one radiance value `L_i` to bin `i` (piecewise-constant-in-λ within the bin,
  the standard assumption for this kind of stratification), it can reconstruct
  `XYZ ≈ Σ_i L_i · cmf_integral_i` directly, without re-integrating CMFs every frame.
- **`luminance_share`**: `cmf_integral.Y` normalized to sum to 1 across all bins — how much each
  bin contributes to perceived brightness under a flat (equal-radiance-per-bin) spectrum. Useful if
  bins are ever stochastically sub-sampled (e.g. one random bin traced per pixel per frame instead
  of all of them) — low-share bins (the violet and far-red ends) are exactly where that would add
  the most visible noise relative to their contribution.
- Sanity check run after generation: `Σ luminance_share == 1.000001` for both 16 and 24 bins
  (rounding only, not a bug).

## Reproducing this

```
cd .local/color
python build_color_data.py           # CIE CMFs, illuminants, daylight basis
python build_camera_and_checker.py   # camera sensitivities, ColorChecker (needs `pip install colour-science`)
python build_srgb_and_bins.py        # wavelength-to-sRGB table, 16/24-bin proposals
```
Raw fetched CSVs/TXT/JSON (CIE files, `camspec_database.txt`, `colour-science`'s own LICENSE) are
kept in `.local/color/` for audit; nothing there is imported by the engine, only `data/color/*.json`
is.

## Open problems for whoever integrates this

1. **Jiang camera data is CC BY-NC-SA 4.0.** Fine for the current private build; needs a decision
   before any public/commercial launch (ship the Gaussian model instead, or get separate
   permission, or pick a differently-licensed camera dataset).
2. **Natural spectra (foliage, sky) not delivered** — two candidate sources identified
   (NREL ASTM G173-03, EcoSIS LOPEX93) but neither loaded cleanly through the tools available this
   pass; needs a retry, not a re-guess.
3. **CIE 170-2:2015 (2006 physiological) CMFs are 390-830 nm, not 380-830** — anyone aligning them
   array-index-for-array-index with the 1931 CMFs needs to zero-pad 380-389 nm and say so.
4. The 5 nm CIE 1931 CMF file is a subsample of the 1 nm file, not a separately fetched CIE table —
   labeled `derived` rather than `spec` for that reason; see §1 if a stricter "spec-only" table is
   ever required.
