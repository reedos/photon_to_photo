# Optical glass catalog: sources, license, formulas, validation

Owner: workstream `glass`. Builds `data/glass/catalog.json` from `tools/build-glass.mjs`. Everything below was produced
by running that script against the local database copy; the validation and nearest-match tables are pasted
verbatim from its output (`node tools/build-glass.mjs`), not retyped.

## Source and license

- Database: [polyanskiy/refractiveindex.info-database](https://github.com/polyanskiy/refractiveindex.info-database)
  (GitHub), the data behind [refractiveindex.info](https://refractiveindex.info).
- Release used: tag `v2026-05-24`, commit `aa6abb827d852dac62e30a3add14a4bf1b49c176`, asset
  `rii-database-2026-05-24.zip` (13,440,092 bytes), downloaded from
  https://github.com/polyanskiy/refractiveindex.info-database/releases/download/v2026-05-24/rii-database-2026-05-24.zip
  on 09/28/2026.
- License: **CC0-1.0** (public domain dedication), confirmed two ways on 09/28/2026:
  - GitHub's repo license API (`GET /repos/polyanskiy/refractiveindex.info-database/license`) reports
    `"spdx_id": "CC0-1.0"`.
  - The repo's own `LICENSE` file at the repo root is the Creative Commons CC0 1.0 Universal legal text, and every
    individual data file we read starts with the header
    `# refractiveindex.info database is in the public domain / # copyright and related rights waived via CC0 1.0`.
  - This confirms the brief's expectation (CC0). No attribution is legally required; the citations below are for
    traceability, not because the license demands them.
- Local copy: unzipped into `.local/glass/database/` (gitignored, per-workstream scratch as instructed). Not
  committed. To reproduce: download the zip URL above and unzip so `.local/glass/database/data/...` exists, or
  `git clone https://github.com/polyanskiy/refractiveindex.info-database` into `.local/glass/` and check out
  `aa6abb827d852dac62e30a3add14a4bf1b49c176`.
- The database's own `doc/Dispersion formulas.pdf` (RefractiveIndex.INFO, 2014-06-29) is the primary source for the
  formula definitions below; I read it directly rather than relying on memory of the convention.

## Upstream catalogs used

All under `database/data/specs/<maker>/optical/*.yml` in the local copy, one file per glass:

| Catalog (key prefix) | Files (glasses) | Upstream source recorded in each file's `REFERENCES` |
|---|---|---|
| SCHOTT | 156 | `schott_2017-01-20b.agf` (SCHOTT Zemax catalog), from schott.com |
| OHARA | 410 | `ohara_2017-11-30.agf` (OHARA Zemax catalog), from ohara-inc.co.jp |
| HIKARI | 363 | Hikari Zemax catalog, from hikari-glass.co.jp |
| CDGM | 314 | `CDGM-ZEMAX202206new.AGF` (CDGM Zemax catalog, 2022-06), from cdgmgd.com |
| HOYA | 190 | `hoya_2017-04-01.agf` (HOYA Zemax catalog), from hoya-opticalworld.com |
| SUMITA | 176 | `sumita_2017-02-02.agf` (SUMITA Zemax catalog), plus the SUMITA optical glass data book PDF |

Plus four non-maker special materials from `database/data/main/<compound>/nk/<author>.yml` (elemental/simple-compound
shelf, not a vendor catalog): fused silica, calcium fluoride (fluorite), magnesium fluoride ordinary and
extraordinary rays. See "Special materials" below.

**Not included** (looked at, not converted; each is grep-able in `tools/build-glass.mjs`'s `SKIPPED` list when you
run it):
- **LZOS** (`database/data/specs/lzos/optical/`, 51 glass files). Every one of these ships only `type: tabulated n`
  (a raw wavelength/index table, no dispersion formula at all) — there is nothing to convert, and fitting our own
  Sellmeier curve to the table would be a derived approximation the brief doesn't ask for ("never invent a number").
  Excluded entirely; not in the skip-reasons list because the build script never opens the directory.
- **`other/optical adhesives/NOA-61`** (Norland Optical Adhesive 61, a UV-cure cement used for real cemented
  doublets) — the one candidate found for "any optical cement you can source." Its dispersion is RII "formula 5"
  (Cauchy: `n = C1 + C2*lam^C3 + C4*lam^C5 + ...`, note **n itself**, not n²). That's a different equation shape
  from the `formula: 'other'` convention adopted here (RII formula 3, a polynomial in **n²** — see below), and
  `GlassEntry.formula`/`coef` has no field to say which shape a given `'other'` entry uses. Rather than silently
  mix two incompatible coefficient layouts under one label, this glass is skipped and counted. **Open problem for
  whoever owns `lens-types.ts`/`glass.ts`**: either add a fourth formula kind (or a formula-variant discriminator)
  for Cauchy-type materials, or accept that cemented doublets use an assumed nd/vd for the cement layer. The
  coefficients are cheap to add later: `NOA-61: n = 1.5375 + 0.00829045/lam^2 - 0.000211046/lam^4` (lam in um,
  range 0.45-1.55 um; source `database/data/other/optical adhesives/NOA-61/nk/Norland.yml`, from
  norlandprod.com, accessed via the database 09/28/2026).
- Vendor "misc" (non-photographic: display glass, filter glass), infrared-glass and filter-glass sub-catalogs
  (SCHOTT-misc, HIKARI-misc, CORNING-display, CRYSTRAN-optical, the AMI/VITRON/SCHOTT/LightPath infrared books,
  BARBERINI/ISUZU filter books) were not pulled in — out of scope for a camera-lens engine (the brief asks for
  glass a photographic lens design would use). They're all present in `.local/glass/database/` if a later need
  arises.

## Formula notes

Verbatim from the database's `doc/Dispersion formulas.pdf` (lambda in micrometers), the three forms that appear in
these catalogs:

- **Formula 1 (Sellmeier, preferred)**: `n² - 1 = c0 + B1·λ²/(λ²-c1²) + B2·λ²/(λ²-c2²) + B3·λ²/(λ²-c3²) + ...`. The
  yml lists `c0, B1, c1, B2, c2, B3, c3` — **c1/c2/c3 are wavelengths, not their squares.**
- **Formula 2 (Sellmeier-2)**: `n² - 1 = c0 + B1·λ²/(λ²-C1) + B2·λ²/(λ²-C2) + B3·λ²/(λ²-C3) + ...`. The yml lists
  `c0, B1, C1, B2, C2, B3, C3` — here **C1/C2/C3 are already λ² (um²)**, i.e. exactly our `sellmeier3` layout.
  Confirmed against the well-known SCHOTT N-BK7 coefficients: the file gives `0 1.03961212 0.00600069867
  0.231792344 0.0200179144 1.01046945 103.560653`, which are the textbook N-BK7 Sellmeier numbers.
- **Formula 3 (Polynomial)**: `n² = c0 + a1·λ^e1 + a2·λ^e2 + ...`. The yml lists `c0, a1, e1, a2, e2, ...`. The
  classic 6-coefficient "Schott formula" (`n² = a0 + a1λ² + a2/λ² + a3/λ⁴ + a4/λ⁶ + a5/λ⁸`) is formula 3 with the
  fixed exponent set `[2, -2, -4, -6, -8]` — confirmed by inspecting every formula-3 file's exponent list
  programmatically (see below). This is what `lens-types.ts`'s `GlassEntry.formula: 'schott'` is for.

Scan of every `optical/*.yml` file's `type:` line across the six maker catalogs (1609 files):

| Catalog | formula 2 (Sellmeier) | formula 3 (Polynomial) |
|---|---|---|
| SCHOTT | 156 | 0 |
| OHARA | 222 | 188 |
| HIKARI | 0 | 363 |
| CDGM | 259 | 55 |
| HOYA | 0 | 190 |
| SUMITA | 0 | 176 |

No maker file used formula 1 (Sellmeier "preferred" form); it does appear for the four special materials below.
Every formula-2 entry found has exactly 7 coefficients (`c0` + 3 Sellmeier terms) with `c0 == 0` — all convert
exactly. Formula-3 exponent-pair patterns found (coefficient count, exponents):

- 791 files: 11 coefficients, exponents `[2, -2, -4, -6, -8]` — the classic Schott 6-term polynomial, exactly.
- 181 files (all HIKARI, extended wavelength range): 13 or 15 coefficients, one or two extra terms (exponents
  `4`, `-10`, `-12` beyond the classic set) — not the classic 6-term form, but still formula 3.

### Conversion policy actually implemented (`tools/build-glass.mjs`)

1. **`formula: 'sellmeier3'`** — formula 1 or 2, exactly 3 Sellmeier terms, `c0 == 0`.
   `coef = [B1, C1, B2, C2, B3, C3]`, C in um². For formula 1, the stored per-term value is a wavelength and gets
   squared to produce C; for formula 2 it's already C. 637 maker-catalog glasses + the 4 special materials = 641.
2. **`formula: 'schott'`** — formula 3, exactly the classic 11-coefficient/`[2,-2,-4,-6,-8]` shape.
   `coef = [a0, a1, a2, a3, a4, a5]` (the exponents are dropped since they're fixed and implied by `'schott'`).
   791 glasses.
3. **`formula: 'other'`** — formula 3 with extra terms (the 181 HIKARI files above). Rather than force these into
   the fixed 6-term Schott shape (which would silently drop the extra terms and corrupt the index at the margins of
   the wavelength range) or invent a second incompatible convention for `'other'`, this catalog defines `'other'`
   as **exactly** RII's own formula 3, coefficients stored raw and unmodified: `coef = [c0, a1, e1, a2, e2, ...]`,
   evaluated as `n² = c0 + Σ coef[2i-1]·λ^coef[2i]` for `i = 1..(coef.length-1)/2`, λ in um. This is the *only*
   thing `'other'` means in this catalog. 181 glasses. **If another formula shape is ever added under `'other'`
   (e.g. the Cauchy cement noted above), `GlassEntry` needs a discriminator field first** — don't silently overload
   the meaning of `coef` for `'other'`.
4. Anything else is skipped and counted (see "Not included" above). 0 maker-catalog files hit this path; only the
   1 cement entry did.

### Special materials (fused silica, fluorite, magnesium fluoride)

Sourced from the database's `main/` shelf (simple compounds, not a vendor catalog), all formula 1 (Sellmeier
preferred), all 3-term with `c0 = 0`, so all convert to `sellmeier3` by the same rule as above:

| Key | Material | Source file | Reference |
|---|---|---|---|
| `RII:FUSED-SILICA` | Fused silica (fused quartz) | `main/SiO2/nk/Malitson.yml` | I. H. Malitson, "Interspecimen comparison of the refractive index of fused silica," *J. Opt. Soc. Am.* **55**, 1205-1208 (1965), https://doi.org/10.1364/JOSA.55.001205. Range 0.21-6.7 um (extended range per C. Z. Tan 1998, cited in the same file). |
| `RII:CAF2` | Calcium fluoride / fluorite | `main/CaF2/nk/Malitson.yml` | I. H. Malitson, "A redetermination of some optical properties of calcium fluoride," *Appl. Opt.* **2**, 1103-1107 (1963), https://doi.org/10.1364/AO.2.001103. Range 0.23-9.7 um. This is the classic fluorite reference used for telephoto/super-telephoto ED elements. |
| `RII:MGF2-O` | Magnesium fluoride, ordinary ray | `main/MgF2/nk/Dodge-o.yml` | M. J. Dodge, "Refractive properties of magnesium fluoride," *Appl. Opt.* **23**, 1980-1985 (1984), https://doi.org/10.1364/AO.23.001980. Range 0.2-7.0 um. MgF2 is uniaxial (birefringent); this is the ordinary ray. |
| `RII:MGF2-E` | Magnesium fluoride, extraordinary ray | `main/MgF2/nk/Dodge-e.yml` | Same reference, extraordinary ray. |

These four `main/` files carry **no vendor `PROPERTIES` block** (no stated nd/Vd — unlike every maker-catalog
file), so `nd`/`vd` in `catalog.json` for these four entries are **derived**: computed by this script evaluating
the cited Sellmeier equation at the d/F/C lines, the identical calculation the validation step below uses. That's
noted in each entry's `source` string. MgF2 is included as coating material (brief's ask) even though the engine
models are scalar-index; both rays are provided so a birefringence-aware model can use either later, and a scalar
model can pick one (ordinary, `MGF2-O`, is the more commonly quoted single value for AR coatings).

## Validation

Required check: for every glass, recompute nd at 587.5618 nm and vd = (nd-1)/(nF-nC) with F = 486.1327 nm,
C = 656.2725 nm **from the stored coefficients**, and compare to the catalog (or, for the 4 special materials,
derived) nd/vd. These are the same Fraunhofer line values `docs/ENGINE.md` says `spectrum.ts` uses.

```
within tolerance (1e-4 nd, 0.1 vd): 1605 / 1613
outliers: 8
  SUMITA:K-CSK120:      nd catalog=1.58700 computed=1.586986  d=1.37e-5 | vd catalog=59.6  computed=59.4788  d=1.21e-1
  SUMITA:K-CaFK95:      nd catalog=1.43425 computed=1.434254  d=3.63e-6 | vd catalog=95.0  computed=94.7711  d=2.29e-1
  SUMITA:K-CaFK95(M):   nd catalog=1.43312 computed=1.433119  d=9.56e-7 | vd catalog=95.0  computed=94.8313  d=1.69e-1
  SUMITA:K-LaKn5:       nd catalog=1.65000 computed=1.650000  d=1.43e-7 | vd catalog=55.8  computed=55.9018  d=1.02e-1
  SUMITA:K-LaSFn21:     nd catalog=1.85000 computed=1.850021  d=2.14e-5 | vd catalog=32.4  computed=32.5064  d=1.06e-1
  SUMITA:K-PFK80:       nd catalog=1.49700 computed=1.496999  d=1.38e-6 | vd catalog=81.5  computed=81.3504  d=1.50e-1
  SUMITA:K-PFK80(M):    nd catalog=1.49533 computed=1.495328  d=2.29e-6 | vd catalog=80.8  computed=80.6653  d=1.35e-1
  SUMITA:K-VC91:        nd catalog=1.88660 computed=1.886595  d=5.40e-6 | vd catalog=35.0  computed=34.8931  d=1.07e-1
```

All 8 outliers are `nd` matches to 5-6 significant figures (dNd ≤ 2.3e-5, well inside tolerance) with `vd` just
outside the 0.1 tolerance (0.10-0.23). In every case the catalog's own `PROPERTIES.Vd` (and often `nd`) is printed
to only 2-4 significant figures (`59.6`, `95`, `55.8`, `32.4`, `81.5`, `80.8`, `35`) — visibly rounded relative to
the 6-7 significant figures SUMITA gives everywhere else (e.g. a typical entry reads `nd: 1.518229  Vd: 68.93264`).
These read as SUMITA's own published "nominal"/typical-melt values for that glass type (several are literally its
`...n#` or lab-code variants) rather than a precise fit-consistent figure — a genuine catalog quirk, not a
conversion bug. (The scientific-notation `nd`/`Vd` on 3 SCHOTT lanthanum-flint glasses — `N-LAF32`, `N-LASF31`,
`N-LASF46`, printed as `4.55300E+01` etc — was an actual parser bug during development: the first regex only
matched `[\d.]+` and truncated at the `E`, misreading `Vd` as `4.553` instead of `45.53`. Fixed in
`tools/build-glass.mjs`'s `parseGlassYml` and reverified — those three are no longer outliers.)

`'other'`-formula entries (the 181 HIKARI extended-range glasses) pass this validation with the rest; spot-checked
`HIKARI:E-KZFH1` by hand against its source file — computed nd 1.6126599 / vd 44.46138 vs. catalog nd 1.61266 /
vd 44.461379, and the 13 stored coefficients match the yml's `coefficients:` line token-for-token.

## Nearest-match check

For the ten (nd, vd) pairs typical of lens patents, the 3 nearest catalog glasses by normalized distance
`sqrt(((nd-nd0)/spreadNd)² + ((vd-vd0)/spreadVd)²)`, where `spreadNd`/`spreadVd` are the max-min spread of nd/vd
across all 1613 catalog entries (spreadNd = 0.77626, spreadVd = 89.7376 — an assumed but data-derived
normalization, chosen so the two axes are weighted roughly by how much each actually varies across the catalog
rather than an arbitrary constant):

```
patent nd=1.80400 vd=46.58:
    OHARA:S-LAH65V   nd=1.803999 vd=46.583432 dist=0.0000
    HIKARI:E-LASF015 nd=1.804000 vd=46.575968 dist=0.0000
    OHARA:LAH65      nd=1.804000 vd=46.575911 dist=0.0000
patent nd=1.49700 vd=81.54:
    OHARA:S-FPL51      nd=1.496999 vd=81.545888 dist=0.0001
    HOYA:MC-FCD1-M20   nd=1.496900 vd=81.530000 dist=0.0002
    HOYA:MP-FCD1-M20   nd=1.496900 vd=81.530000 dist=0.0002
patent nd=1.92286 vd=18.90:
    OHARA:S-NPH2     nd=1.922860 vd=18.896912 dist=0.0000
    CDGM:H-ZF72A     nd=1.922860 vd=18.895887 dist=0.0000
    CDGM:H-ZF72AGT   nd=1.922860 vd=18.895887 dist=0.0000
patent nd=1.58913 vd=61.14:
    OHARA:S-BAL35    nd=1.589130 vd=61.135024 dist=0.0001
    SCHOTT:P-SK58A   nd=1.589130 vd=61.150000 dist=0.0001
    OHARA:L-BAL35    nd=1.589130 vd=61.152601 dist=0.0001
patent nd=1.43875 vd=94.95:
    OHARA:S-FPL53    nd=1.438750 vd=94.946025 dist=0.0000
    OHARA:FPL53      nd=1.438750 vd=94.960437 dist=0.0001
    HOYA:FCD100      nd=1.437000 vd=95.100000 dist=0.0028
patent nd=1.51633 vd=64.14:
    OHARA:S-BSL7     nd=1.516330 vd=64.142022 dist=0.0000
    OHARA:BSL7       nd=1.516330 vd=64.150145 dist=0.0001
    SUMITA:K-BK7     nd=1.516330 vd=64.100000 dist=0.0004
patent nd=1.84666 vd=23.78:
    HOYA:FDS90       nd=1.846660 vd=23.780000 dist=0.0000
    HOYA:FDS90-SG    nd=1.846660 vd=23.780000 dist=0.0000
    SCHOTT:N-SF57    nd=1.846660 vd=23.780000 dist=0.0000
patent nd=1.72916 vd=54.68:
    OHARA:S-LAL18    nd=1.729157 vd=54.680013 dist=0.0000
    OHARA:LAL18      nd=1.729157 vd=54.683134 dist=0.0000
    CDGM:H-LAK52     nd=1.729160 vd=54.684737 dist=0.0001
patent nd=1.83481 vd=42.72:
    HOYA:TAFD5F      nd=1.834810 vd=42.720000 dist=0.0000
    HOYA:TAFD5G      nd=1.834810 vd=42.720000 dist=0.0000
    HIKARI:E-LASF05  nd=1.834807 vd=42.722417 dist=0.0000
patent nd=1.61800 vd=63.33:
    OHARA:S-PHM52    nd=1.618000 vd=63.333504 dist=0.0000
    HIKARI:J-PSK02   nd=1.618000 vd=63.339027 dist=0.0001
    HIKARI:E-PSK02   nd=1.618000 vd=63.372017 dist=0.0005
```

All ten patent pairs resolve extremely cleanly — every nearest match has `dist < 0.003`, and 9 of 10 have a
same-catalog-family match within `dist ≈ 0.0001` or better (e.g. `1.80400/46.58` is almost exactly OHARA S-LAH65V
and HIKARI E-LASF015; `1.84666/23.78` is exact-to-5-places on HOYA FDS90 and SCHOTT N-SF57). This isn't surprising
— these ten pairs are themselves textbook nd/vd values (S-LAH65, N-SF57, FPL53, BSL7, BK7, etc. are among the most
commonly cited lens-patent glasses) — but it does show the catalog resolves patent-typical glass melts to
essentially their exact match rather than a coarse neighbor, which is what `resolveGlass(nd, vd)` in
`engine/lens-systems/glass.ts` needs when a patent only states nd/vd without naming a catalog glass (`medium:
"glass"` in the lens-types.ts convention).

## Output

`data/glass/catalog.json`: 1613 `GlassEntry` records, sorted by key.

| formula | count |
|---|---|
| `sellmeier3` | 641 (637 maker-catalog + 4 special materials) |
| `schott` | 791 |
| `other` | 181 |
| **total** | **1613** |

| catalog | count |
|---|---|
| Ohara | 410 |
| Hikari | 363 |
| CDGM | 314 |
| Hoya | 190 |
| Sumita | 176 |
| Schott | 156 |
| RefractiveIndex.INFO (special materials) | 4 |

Reproduce with `node tools/build-glass.mjs` (writes the file and reprints the validation/match report above) or
`node tools/build-glass.mjs --check` (report only, no write) once `.local/glass/database/` is populated per
"Source and license" above.

## Open problems for the engine team

1. **Cement**: NOA-61 (or any other optical cement) isn't in the catalog — see "Not included" above. If cemented
   doublets need a real cement index rather than an assumed one, `GlassEntry` needs a way to say which equation
   `'other'` coefficients mean (or a fourth formula kind for Cauchy-shaped materials).
2. **MgF2 birefringence**: two entries (`RII:MGF2-O`, `RII:MGF2-E`) for one physical coating material. A scalar
   `indexAt(entry, nm)` model should probably default to `MGF2-O` for AR-coating math unless/until the engine
   models polarization.
3. **LZOS**: entirely absent (tabulated-only source data, no formula). Fine as long as no lens design in
   `data/lenses/*.json` names an LZOS glass; flag if one does.
