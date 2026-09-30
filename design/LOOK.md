# Look bible — Photon to Photo

Status 09/28/2026, art-director. Written before any building, per the brief. Concrete enough to follow without
asking; where a number is a placeholder pending the engine's own data, it says so.

Reference board: [design/reference-board.html](reference-board.html). Rubric for gates: [design/RUBRIC.md](RUBRIC.md).

## Principle

What you see is computed. Every ray, spot, fringe, photon and well level on screen comes from the physics engine
for the current settings. The look bible's job is to make that computed truth *legible and beautiful*, never to
decorate it or stand in for it. Clarity beats glow. When a choice here would fight that principle, the principle
wins and this document is wrong until fixed.

## One signature style (Reed, 09/28/2026)

Reed: "I like the look and want to maintain a coherent signature style" (pointing at
https://reedos.github.io/intelligence_factory/?view=0.power). So this site does not get its own accent or its own
components. It uses The Intelligence Factory's, and differs only in its subject and its physics colors.
Screenshots of the live page for builders and the critic: `design/if-style/` (desktop, phone, visualizer).

Carry over as they are, porting the CSS from `~/projects/intelligence_factory/src/styles.css` rather than
redrawing:
- the top bar: three-bar brand mark, Barlow Condensed uppercase name, uppercase nav with the amber underline on
  the active item, the phone MENU button;
- section headers: mono counter in amber ("01 / 05"), huge condensed title, a short lede in Manrope;
- the scenario builder: slider (white thumb, amber fill), preset chips, segmented groups with a white active cell
  and mono sublines, the stat row (big condensed numbers with mono uppercase captions), "Pin to compare";
- the level strip: number, condensed title, a colored dot and a mono subline per level;
- the view chrome: level title with its mono subtitle, the layer toggle (segmented, colored dots), outlined
  uppercase action buttons (Tours, Play layer, Share), the faint mono keyboard hint line, the scale bar;
- numbered pins (white circle, dark numeral) with mono uppercase labels; the right panel with prose, the
  "LAYER · LEVEL n · k PARTS" line, the Play button and the numbered part list with square number boxes;
- part cards with spec rows and evidence chips, the tour player and its transport, the publication statement.

What is new here and must still sit inside that style: the physics colors (wavelength colors, charge), the scale
badge, the final-image panel and the loupe. They follow the rules below.

## Does this join The Intelligence Factory's family?

(The art director's original reasoning, kept for the record. Superseded where it differs: Reed's call above
settles the accent too, which is now the shared amber.)

**Yes, with its own accent.** Reasons:

- Reed's three explainer sites (Intelligence Factory, this one, and whatever follows) read as one body of work when
  a visitor lands on any of them: same black ground, same display/body/mono type stack, same part-card and pin
  language, same evidence-chip discipline. That coherence is a portfolio asset the brief itself asks for
  ("the design lineage of Reed's sites").
- The two projects share real structure, not just style: both are "dive through real scales, everything numbered,
  evidence on every figure" explainers built the same way (`src/model`, `evidence.js`, `tools/*.mjs` gates). Sharing
  the visual language makes that shared structure *visible*, which is honest — they are the same kind of thing.
- A camera is a different object than a data-center campus: cool metal and glass, not warm industrial amber. Giving
  it its own accent (below) keeps the two sites from being confusable at a glance while keeping everything else —
  ground, type, card and pin grammar, evidence chips — identical. A reader who has seen one site should never have
  to relearn the other's UI, only notice a new subject.
- The evidence-basis colors (spec/vendor/reported/derived/assumed) carry over **unchanged**. This site uses the
  same five-kind evidence system (`docs/BRIEF.md`, "ACCURACY DISCIPLINE"), so the same five colors mean the same
  thing on both sites. Reinventing them here would just be noise.

## Palette

Dark-first. `:root` tokens, hex values, WCAG contrast ratios computed against the backgrounds they're actually used
on (formula: relative luminance, sRGB, `(L_lighter + 0.05) / (L_darker + 0.05)`).

```css
:root {
  color-scheme: dark;

  /* structure — identical to intelligence_factory, so the two sites share one grammar */
  --ground: #000000;
  --surface: #0b1015;
  --raise: #121920;
  --line: rgba(240, 240, 250, 0.14);
  --line-2: rgba(240, 240, 250, 0.30);
  --ink: #f0f0fa;
  --muted: #aab2b9;
  --faint: #6b747c;

  /* the shared accent: The Intelligence Factory's amber (Reed, 09/28/2026: one signature style).
     It is a desaturated tan, well inside the gamut, so it cannot pass for a spectral ray color;
     the spectral rule below still forbids using it for light. (The art director first proposed
     a rose #e592b3 here; superseded.) */
  --accent: #e6ba82;

  /* evidence basis — unchanged from intelligence_factory/src/evidence.js, same five kinds,
     same meaning, so a reader who knows one site reads the other's chips for free */
  --spec: #7ee0a1;
  --vendor: #f2a66b;
  --reported: #e6c86e;
  --derived: #8fc3f0;
  --assumed: #b7b0cf;

  /* materials — UI-only tokens for chrome around the 3D view (rings, gauges, HUD accents that
     represent hardware, not light). Never used to color a ray, a photon or a spectral swatch. */
  --metal-cool: #9aa3ab;   /* brushed aluminum barrel, chrome bezels */
  --metal-warm: #8a7a63;   /* brass/bronze trim, aperture ring knurling highlight */
  --anodize-black: #17181b;/* black-anodized barrel base color */
  --silicon: #1b2029;      /* die and package substrate */

  /* physics-only channel colors — never used as UI chrome, only as emissive/material tint on
     the thing they name, and never confusable with a wavelength color (see the spectral rule) */
  --charge: #bfe4ff;       /* electrons: icy blue-white — light has no "electron color"; this
                              is deliberately desaturated and cool so it never reads as a
                              480 nm spectral blue */
  --scale-badge: #f0f0fa;  /* the scale badge always renders in --ink, not --accent, so it
                              never competes with the accent's own meaning (see below) */

  --display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --sans: "Manrope", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
}
```

Contrast, text pairs actually used on screen:

| Pair | Ratio | WCAG |
|---|---|---|
| `--ink` on `--ground` | 18.55:1 | AAA |
| `--ink` on `--surface` | 16.88:1 | AAA |
| `--ink` on `--raise` | 15.65:1 | AAA |
| `--muted` on `--ground` | 9.78:1 | AAA |
| `--faint` on `--ground` | 4.41:1 | AA large / UI only — never body text, matches intelligence_factory's own use of `--faint` for eyebrows and meta labels, not prose |
| `--faint` on `--surface` | 4.02:1 | AA large / UI only, same caveat |
| `--accent` on `--ground` | 9.09:1 | AAA |
| `--accent` on `--surface` | 8.27:1 | AAA |
| `--spec` on `--ground` | 13.06:1 | AAA |
| `--vendor` on `--ground` | 10.44:1 | AAA |
| `--reported` on `--ground` | 12.85:1 | AAA |
| `--derived` on `--ground` | 11.23:1 | AAA |
| `--assumed` on `--ground` | 10.12:1 | AAA |
| `--metal-cool` on `--ground` | 8.20:1 | AAA |
| `--charge` on `--ground` | 15.76:1 | AAA |

Every text color clears AA at minimum, and everything but `--faint` clears AAA. `--faint` is reserved the same way
intelligence_factory reserves it: uppercase mono labels ≥11px, never a sentence.

### Light theme

**Skipped, deliberately, because it is not cheap here.** Intelligence Factory's UI chrome could plausibly re-skin
to light without touching its 3D scenes. This project's entire visual identity is *glass and metal lit against a
black void* — the transmission, edge-blackening and coating-tint parameters below are tuned against `--ground:
#000`. A light theme would mean re-lighting, re-tuning attenuation and re-checking every material, not flipping a
token. One cheap exception: the flat 2D analysis plots (ray fan, spot diagram, MTF, the Zemax/Photons-to-Photos
style views in set piece composition notes below) can honor `prefers-color-scheme: light` on their own, since
they're SVG/canvas line art on a flat background exactly like the optical-bench references — the same white-paper
convention those tools already use. That is the one place a light mode is close to free; the 3D scene stays dark
always.

### The spectral color rule (non-negotiable)

**Wavelength colors are physical. They are computed once, from CIE data, by one function, and used everywhere the
site shows real light. UI accents must never be confusable with a wavelength.**

- One function, `wavelengthToRGB(nm)`, owned by the engine (not by this document), computes color from the CIE
  1931 2° standard observer color-matching functions, D65 white, converted to linear sRGB and gamma-encoded. Every
  place the site tints something by wavelength — spectral rays inside the lens, the Airy pattern, coating
  interference fringes, the glossary's spectrum swatch — calls this same function with the same inputs. Two
  spectral swatches for the same wavelength must be pixel-identical; if they're not, that's a rendering bug, not a
  style choice.
- **Display-brightness normalization, stated honestly.** The true CIE luminous-efficiency function makes 410 nm and
  700 nm read as nearly black next to 555 nm at equal radiometric power, which would make a rainbow ray fan
  unreadable. `wavelengthToRGB` normalizes to a constant *lightness* (fixed L in a perceptual space, e.g. OKLab) so
  hue and rough saturation vary with wavelength but on-screen brightness does not collapse at the ends of the
  visible range. This is a **display convention**, not a physical claim, and the method page must say so in one
  sentence next to the spectrum swatch. Actual light *intensity* (irradiance, photon count) is never encoded in
  this hue-brightness channel — it's encoded separately, as literal dot density (photon rain) or emissive
  brightness (the well fill, per the pitfall below), so the two never get confused.
- **UI accent vs. spectral hue.** `--accent` is the shared amber #e6ba82 (Reed's call, above). It is a pale,
  desaturated tan, far inside the spectral locus, while light is drawn with saturated spectral colors, so the two
  read differently; and the accent is never used to draw light, a photon or a wavelength swatch. Ray colors near
  580-600 nm are the closest neighbors: where a ray fan and an amber UI element share a frame, keep the amber on
  chrome (text, underlines, button fills) and never on a line or dot inside the 3D view.
  The evidence-basis colors (spec/vendor/reported/derived/assumed) are all kept desaturated and pastel for the same
  reason — none of them should read as "a wavelength," all of them should read as "ink."
  - Practical check for anyone adding a color: convert the candidate to CIE xy and see whether it falls near the
    spectral locus (the curved edge of the horseshoe) or firmly inside it. UI colors must sit well inside, toward
    the achromatic center — desaturated, not saturated-and-pure.
- Sellmeier-derived dispersion (the actual chromatic splitting of rays through glass) drives *where* a ray bends,
  which is physics the engine computes from each element's glass (real coefficients, `data/glass/catalog.json`);
  `wavelengthToRGB` only decides what color to paint that ray once its path is known. Never let the color mapping
  back-influence the ray path, and never fake dispersion by just tinting a single traced ray gradient-rainbow —
  trace each wavelength bin's own path (≥16 bins per the brief) and color each one from the same function.

## Materials (Three.js parameters)

Every material below names the Three.js properties a builder sets and *where the number comes from*. Where this
document gives a number, it's a typical/representative value for the material class — **read the authoritative
figure from the engine's own data** (`data/glass/catalog.json`, `lens-types.ts` `GlassEntry.nd/vd`, or the sensor
module's own QE/CFA tables) wherever the engine has one; never hardcode a glass's index in the renderer. Figures
below that aren't tied to the engine's data are marked *typical* and are for starting values only.

### Optical glass (lens elements)

`MeshPhysicalMaterial`:

| Property | Value | Source |
|---|---|---|
| `transmission` | `1.0` | optical glass is essentially fully transmissive at these thicknesses; any absorption tint comes from `attenuationColor`/`attenuationDistance`, not from lowering transmission |
| `ior` | per-element `nd`, read from the resolved catalog glass (`GlassEntry.nd`) | **engine data, not this document** — common crown/flint glasses span roughly nd ≈ 1.45–1.95; pull the exact figure per element at build/render time |
| `roughness` | `0.02–0.04` | typical for a polished optical surface; not `0` — a small roughness avoids a perfect-mirror Fresnel edge that reads as a rendering artifact rather than glass, and softens the coated-highlight slightly the way a real air-glass interface does under a diffuse studio light |
| `thickness` | per-element axial thickness in mm, from the surface's own `t` in `lens-types.ts` | engine data |
| `attenuationColor` | near-white for crown glasses (`#fbfbf8`), a faint warm tint (`#f5efd8`) for dense flints at real thickness | typical; dense flint (high-index) glasses show a faint yellow-green cast at centimeters of path length, crown glasses are effectively colorless at lens-element thicknesses |
| `attenuationDistance` | `300–600` mm | typical — keeps the tint nearly invisible at a single element's thickness (correct: it should be) and only visible if a ray's cumulative glass path is unusually long |
| `clearcoat` | `0` | the coating is modeled separately, below, as `iridescence` — don't double it with clearcoat |
| `ior` used for edges | n/a | see edge blackening, next |

**Edge blackening.** Every real lens element is blackened or flocked at its clear-aperture edge (the `sd` semi-
diameter in `lens-types.ts`) to kill internal reflection off the ground glass edge. Model this as a thin separate
ring mesh at each element's rim: matte black (`roughness: 0.9`, `metalness: 0`, `color: #050505`), not part of the
glass material. This is one of the sael.net reference's clearest tells that its glass is real geometry, not a
flat disc texture — the rim reads as a machined edge, and it's also where a spectral ray fan should visibly
terminate at the element's actual clear aperture, not float past it.

**AR coating tint by angle.** Anti-reflection coatings are thin-film interference, which is angle-dependent — the
faint magenta/green/amber sheen you see on a real lens changes with viewing angle. Use `iridescence`,
`iridescenceIOR` and `iridescenceThicknessRange` on the same `MeshPhysicalMaterial`:

- `iridescenceIOR`: **≈1.38** *(typical for MgF₂, the most common single-layer AR coating material — representative, not pulled from a catalog today; if the engine's coatings module carries a real per-coating IOR, use that instead)*
- `iridescenceThicknessRange`: `[100, 400]` nm *(typical span from a quarter-wave single layer up through a multi-layer stack; wider range = more visible color shift with angle)*
- Toggling "coatings off" in the layer switch should set `iridescence: 0` directly — the ghosts-and-coatings set
  piece (5) depends on this exact toggle visibly dimming the ghost paths, so it must be the same boolean the ghost-
  ray intensity calculation reads, not a separate cosmetic switch.

### Anodized aluminum barrel

`MeshPhysicalMaterial`, `metalness: 1`:

| Property | Value |
|---|---|
| `color` | `--anodize-black` (#17181b) for the barrel body; `--metal-cool` (#9aa3ab) for exposed bezels/rings |
| `roughness` | `0.35–0.5` — brushed/anodized, not mirror-polished; vary ±0.05 via a procedural radial-brush normal/roughness map so it doesn't read as flat CG metal |
| `clearcoat` | `0.15–0.25` | the thin anodize layer's slight sheen |
| `clearcoatRoughness` | `0.3` | keeps the clearcoat from turning the barrel glossy-plastic |

Engraved markings (distance scale, focal-length window, f-stop numerals) are a separate decal/texture layer, paint-
filled white or `--metal-warm`, never emissive — they're read by the key light like everything else.

### Matte black internals (baffles, barrel interior)

`MeshStandardMaterial`: `color: #050505`, `roughness: 0.88`, `metalness: 0.08`. Deliberately **not** `roughness: 1,
metalness: 0` flat black — a real flocked/matte-black-painted interior still picks up a faint environment
reflection, and zero reflectance is one of the "looks cheap" tells (a pure black void reads as a rendering hole,
not a material). This is fine to keep opaque, unlike the barrel itself: the glass sheath around it is what has to
be transparent so a reader can see the ray path pass through the whole assembly (see the do-not list).

### Iris blades

`MeshPhysicalMaterial`: blackened steel — `color: #0c0d0f`, `roughness: 0.5`, `metalness: 0.9`, a thin bright edge
highlight (a separate 1–2 px emissive-free rim via a fresnel-driven roughness dip) so overlapping blades read as
distinct thin sheets, not a single black disc. Blade count and rounding come straight from each lens's
`iris.blades`/`iris.rounded` — never a fixed hexagon. Geometry is procedural (computed blade polygon at the current
f-stop from blade count + rotation), not a baked animation, so bokeh shape and cat's-eye vignetting derived from it
stay correct at any aperture, including values between the lens's marked stops.

### Silicon die and pixel array

- Die/substrate: `MeshPhysicalMaterial`, `color: --silicon` (#1b2029), `roughness: 0.25`, `metalness: 0.6` — smooth
  but not mirror; real die surfaces under passivation read as a dark, slightly metallic slab.
- **Grating iridescence** (the rainbow sheen real die photos show off the metal interconnect grid): `iridescence:
  0.6–0.8`, `iridescenceThicknessRange: [200, 800]` nm as a starting approximation, *plus* a fine procedural normal
  map at the interconnect pitch so the iridescence shifts correctly with view angle across the array rather than
  looking like a flat painted-on rainbow. Flag for the sensor-rendering workstream: this is genuinely angle- and
  pitch-dependent diffraction, and if there's time to compute it as an actual grating response (pixel pitch is
  already known from engine data) rather than an iridescence approximation, that's the more honest version — this
  document specifies the fallback, not a ceiling.
- Color filter dyes (Bayer CFA): `transmission: 0.7–0.85`, thickness on the order of a micron (exaggerated for
  visibility at loupe scale, since real CFA layers are sub-wavelength-scale thin relative to the pixel), `ior:
  ~1.5` *(typical polymer dye layer)*. Colors are **not** pure `#ff0000`/`#00ff00`/`#0000ff` — real Bayer dyes pass
  meaningful out-of-band light (that cross-talk is part of why demosaicing and the color matrix exist downstream).
  If the sensor module (E3) exposes per-channel QE-by-wavelength curves, derive the swatch color from integrating
  that curve against `wavelengthToRGB`; until then use desaturated representative tints (`#c94b3f` red, `#3fae5c`
  green, `#3f6fc9` blue) rather than saturated primaries, and mark them `assumed` on any spec card that shows them.
- Microlenses: `transmission: 1`, `ior: ~1.58` *(typical molded photoresist microlens material)*, `roughness:
  ~0.02`, modeled as an actual plano-convex bump per pixel at loupe scale, not a decal. Fill factor (the gap
  between lenses, BSI vs. FSI) is geometry driven by the engine's own pixel-pitch and fill-factor figures, never a
  fixed gap.

### Charge, electrons, and the glass wells

Electrons are not light and get no wavelength color — that's the entire point of the `--charge` token (icy
blue-white, deliberately desaturated so it can't be mistaken for a 470 nm spectral blue). Render converted photons
as small `--charge`-colored emissive sparks flashing at the photodiode, then pouring into the well.

**The wells must be glass, not opaque tanks** (the brief's own pitfall). `MeshPhysicalMaterial`, `transmission:
0.95`, `roughness: 0.03`, thin walls, so the charge fill is visible from every angle including straight down.
**Fill level is encoded twice, redundantly, on purpose**: both as literal liquid height (`fill = electrons /
fullWellCapacity`, from the engine) *and* as the fill's emissive brightness scaling with the same fraction. This is
the direct fix for the "seen from above, the eye reads area, not height" pitfall — a reader looking straight down
the loupe dive (set piece 9) at a grid of wells must still be able to rank which pixel is nearer full, and area/
diameter alone won't do that when every well is the same diameter. Brightness must.

### Lighting and environment

A black void, not a lit studio floor — consistent with the family's `--ground: #000` and with keeping the reader's
attention on the computed geometry, not a photographed backdrop. But `MeshPhysicalMaterial` glass and metal read as
flat/dead with no environment to reflect (one of the clearest "default Three.js material" tells) — so:

- A small procedural **PMREM environment**, not a photographic HDRI (keeps the world abstract and consistent with
  the black-void family look rather than looking like it's sitting in someone's studio): a cool, low-intensity
  upper hemisphere, one soft neutral-white highlight band positioned to rake across the barrel and give glass
  elements a readable specular response, and a faint warm rim from below-behind for edge separation against pure
  black. Regenerate at each quality tier's resolution (phone tier can use a smaller PMREM cube without changing its
  actual pixel colors).
- One practical key light (soft, near-white, slightly cool) plus a dim fill from camera-left, both non-physical
  "studio" lights for legibility — but they light *materials only*. They must never touch anything whose color
  comes from `wavelengthToRGB` or from a photon/electron count: rays, the Airy pattern, spectral swatches and
  charge sparks are emissive/unlit with respect to the scene's key/fill lights, or the physically-computed color
  would get relit and stop meaning what the engine says it means.

### Post-processing rules

- **AO**: GTAO (or SSAO if GTAO isn't practical on the phone tier), moderate radius tuned to element-gap and
  barrel-machining scale. AO may darken *materials* (glass, metal, silicon) in their crevices and gaps. AO must
  **never** darken anything whose brightness is itself a computed physics value — a photon spark, a ray, an Airy
  ring, a well's fill glow. Implementation note for the rendering workstream: keep physics-value emissive output in
  a separate render pass/AOV from the AO-affected beauty pass, or gate AO's multiply by a "this is a light source"
  flag per material.
- **Bloom**: **off by default everywhere.** Clarity beats glow — this is the brief's own bar, and Ryan Sael's
  reference already proves you don't need bloom to look expensive; the plane-of-focus scene reads as high-end
  through geometry, materials and lighting alone, no glow. Where a bloom pass is used at all (a single tightly-
  thresholded highlight on the very brightest physical highlights — the Airy disk's central maximum, a direct
  photon hit at wide-open aperture — nothing else), its threshold must sit **strictly above** every value
  `wavelengthToRGB` or the intensity mapping can produce for a normal (non-saturating) sample, so it can never
  blend into and wash out a physics color. It must be a per-view toggle, defaulted off, and the "raw physics" view
  mode (see rubric) always renders with it off.
- **Tone mapping — the OutputPass pitfall, spelled out.** `EffectComposer`'s `OutputPass` tone-maps the whole
  frame regardless of any per-object `toneMapped: false`; setting that flag on a ray or spectral-swatch material
  and trusting it to survive `OutputPass` is exactly the mistake the brief warns about, and it will silently
  bleach every wavelength color into a slightly-wrong-looking pastel. Two acceptable fixes, either is fine, mixing
  them is not: (1) render physics-color elements (rays, spectral swatches, Airy pattern, charge/photon emissive) in
  a pass that is composited *after* `OutputPass`'s tone mapping, so they hit the screen at their exact computed sRGB
  value; or (2) in `WebGPURenderer`/TSL, apply the tone-map node only to the beauty AOV and composite the
  physics-color AOV in untouched. Either way, the accuracy gate (below) must sample an actual rendered pixel for a
  known wavelength and check it against `wavelengthToRGB`'s own output, not just check that a flag is set in code —
  a flag can be set and still be defeated by the pass ordering, which is the whole reason this is a named pitfall.

## Typography

Same three families as Intelligence Factory, so both sites read as one hand:

- **Display** — `"Barlow Condensed"`, weight 600, uppercase, tight leading (`.86–.95`), negative tracking
  (`-0.005em` to `-0.012em`) at large sizes. Level titles, set-piece headers, big stat numbers.
- **Body** — `"Manrope"`, weight 400 body / 600 UI labels and buttons. Prose, part-card descriptions, button text.
- **Mono** — `"IBM Plex Mono"`, weight 400–600, letter-spacing `0.06–0.14em`, uppercase for labels. Eyebrows,
  spec-row keys, HUD readouts, pin labels, the scale badge, every numeric value with a unit.

### Scale

| Role | Size | Weight | Family |
|---|---|---|---|
| Hero H1 | `clamp(52px, 9vw, 136px)` / 0.86 | 600 | display |
| Level title (in-3D HUD) | `clamp(26px, 3vw, 40px)` / 0.95 | 600 | display |
| Section H2 | `clamp(36px, 5vw, 68px)` / 0.94 | 600 | display |
| Card title | 30px / .95 | 600 | display |
| Big stat / readout | `clamp(28px, 2.8vw, 52px)` / .95 | 600 | display, tabular-nums |
| Body / lede | 14.5–17px / 1.6–1.65 | 400 | sans |
| Eyebrow / kicker | 11px / 1.5, +0.14em | 400 | mono, uppercase |
| Spec row key | 10.5px / 1.4, +0.1em | 400 | mono, uppercase, `--faint` |
| Spec row value | 13.5px / 1.35 | 500 | mono, tabular-nums |
| Pin number | 11px / 1 | 600 | mono |
| HUD label (annotation in the 3D view) | 11px / 1.15, +0.06em | 600 | mono, uppercase, text-shadow for legibility over the scene |

### In-3D labels, pins and annotations

- Pins are numbered circles (`--ink` fill, `#0b0e13` numeral) that switch to `--accent` fill when active/selected —
  identical convention to Intelligence Factory's `.pin` so the interaction language transfers instantly.
- Annotation labels over the 3D scene always carry a text-shadow (`0 1px 6px #000, 0 0 2px #000`) so they stay
  legible over bright glass/metal without needing a background chip that would occlude the geometry it's labeling.
- A callout line connects a pin to its label only when the label can't sit adjacent without overlapping another —
  prefer proximity over leader lines; leader lines are a legibility smell if there are more than two or three on
  screen at once (see rubric, "overlapping labels").

### Number formatting

- Units always attached, always the metric/photographic convention a photographer or optics reader expects:
  `f/2.8` not `2.8`, `1/250 s` not `0.004 s` (unless the derivation *is* the point, in which case show both, evidence-chipped), `37 cm` not `0.37`, `ISO 400` not `400`.
- Tabular figures (`font-variant-numeric: tabular-nums`) on every readout that updates live — a slider-driven
  number must not visibly reflow its digit widths as it changes, that's a cheap-looking jitter.
- Every number that isn't a live physics readout carries an evidence chip (spec/vendor/reported/derived/assumed),
  identical chip component and colors to Intelligence Factory's (`src/evidence.js`'s `chip()` — reuse the pattern,
  new project's own copy of the code, same visual contract).

## Motion

### Easing and durations

| Motion | Curve | Duration | Notes |
|---|---|---|---|
| UI panel open/close, hover, focus | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint-ish) | 180–260ms | matches Intelligence Factory's snappy UI feel |
| Tab/segment switch (mode toggle, layer switch) | `cubic-bezier(0.22, 1, 0.36, 1)` | 150ms | |
| **Dive between scale levels** (the camera path across a level change) | `cubic-bezier(0.65, 0, 0.35, 1)` (slow in, fast middle, slow out) | `900ms + 220ms × decades crossed`, capped at 2400ms | camera path is a **logarithmic** dolly along the optical axis, not a linear zoom — crossing from meters to micrometers (~6 decades) must not feel six times longer than crossing one decade in a way that's proportionally jarring; the log path is what makes the felt speed roughly constant across a huge span. The scale badge (below) updates its exponent continuously during the dive, not just at the endpoints. |
| What fades during a dive | outgoing level's HUD labels/pins fade over the first 120ms, incoming level's over the last 150ms; the 3D geometry itself never fades — it scales/recedes, because faking a level's geometry disappearing would misrepresent what's actually there | | |
| Physics-driven change (f-stop, ISO, focus distance, focal length slider) | **no decorative easing** | see below | |

**Physics updates must be immediate or physically timed, never decorative.** Two cases, and a change must fall
cleanly into one:

1. **Numeric/derived readouts** (DOF figures, EV, SNR, any spec-row value): update the instant the input changes,
   no tween, no counting-up animation. A number that visibly "catches up" to the true value is lying about the
   physics for the duration of the catch-up.
2. **Mechanisms with a real physical speed** (iris blades closing, focus ring turning, mirror/shutter action):
   animate at a representative real speed for that mechanism, not a UI-convenient one. Iris blade actuation on a
   modern stepper-driven aperture is commonly well under 150ms; use that as the ceiling and treat the exact figure
   as *assumed* on any spec card that would show it, since no public spec states a general figure. The moment a
   duration is chosen because it "feels nice" rather than because something physical takes that long, it's
   decorative and belongs in case 1 instead — snap it to instant.

### Reduced motion

`prefers-reduced-motion: reduce`:

- Dives become a hard cut with a ≤150ms crossfade — no camera flight path.
- Any idle/ambient camera drift or auto-playing tour motion is disabled outright.
- Physics-timed mechanisms (case 2 above) lose their eased eye-candy but **keep** their real duration where that
  duration itself carries information (e.g., the rolling-shutter scan sweeping down the array *is* the readout
  being explained — collapsing it to instant would remove the content, not just the decoration). Use judgment per
  set piece; when in doubt, keep motion that *is* the explanation and cut motion that only *decorates* it.

## The scale badge

Every set piece that shows a deliberately non-1:1 representation — scaled photon density, slowed time, exaggerated
pixel/microlens size relative to the lens — must say so on screen, always, the same way, so a reader is never
fooled into thinking a picture is literal when it's been scaled for visibility.

- **Design**: a small `--mono` line, `--ink` color (not `--accent` — it's a factual caption, not a UI affordance,
  and using the accent color would visually associate it with the interactive chrome instead of the physics), e.g.
  `1 DOT = 1,000 PHOTONS` or `TIME SLOWED 10⁹×`, optionally paired with a small tick-marked scale bar exactly like
  Intelligence Factory's existing `.scalebar` component (reuse that convention: a short ruled line under the HUD
  title corner).
- **Placement**: bottom-left of the 3D viewport, inside the frame, never occluding a pin or a labeled feature.
  Fixed position across set pieces so a reader learns where to look for it once.
- **When it must show**: any time a rendered quantity on screen is not literal — photon rain density (always
  scaled; real photon arrival rates are billions of photons/second even at modest exposures), any timescale
  slowed down to be watchable (readout sweep, well filling, shutter/rolling-shutter timing), and any deliberate
  size exaggeration (a microlens or CFA layer rendered many times its real size relative to the lens elements next
  to it in the same shot, if that ever happens across a dive). It must **not** show during set pieces that are
  already at a legible native scale with no distortion (e.g., the assembled lens cutaway itself, viewed at roughly
  its true relative proportions) — showing it everywhere regardless would train readers to ignore it, which
  defeats the point.
- It updates live and instantly (no easing — it's a readout, case 1 above) whenever the underlying scale or time
  factor changes, including continuously during a dive's dolly (its exponent should visibly tick as the camera
  moves, not jump only at the arrival level).

## Composition notes, the ten set pieces

Numbered per `docs/BRIEF.md`/`docs/PLAN.md`. Most detail on 2, 3 and 9 — the three in the first look prototype.

### 2. The lens as glass you can see into *(prototype, high detail)*

- **Camera**: a three-quarter angle looking slightly down the optical axis from front-left, close enough that
  individual elements read as distinct glass bodies, matching the sael.net reference's default framing almost
  exactly (see `design/reference/sael-assembled.webp`) — that framing earns its place because it's the angle that
  shows element curvature, spacing *and* lets a ray fan's bend at each surface stay legible, all at once. Straight-
  on (looking down the axis) hides curvature; too oblique and ray bends foreshorten into noise.
  - **Assembled / exploded toggle** (matching the reference's own control, `design/reference/sael-exploded.webp`):
    exploded view pulls elements apart along the optical axis only, proportional gaps, so a reader can see each
    surface's actual curvature and the iris's position in the stack without them occluding each other. This is a
    real, useful second composition for this exact set piece, not a separate one.
- **In frame**: the full element stack in its barrel cutaway (barrel walls cut away in a wedge, not hidden — a
  reader should see the mechanical housing is really there, just opened), the iris at its stop position, and the
  live ray fan (≥16 wavelength bins per the brief) traced surface-by-surface from an off-axis object point so
  chromatic splitting is visible *where it happens* inside the glass, not just as a blur at the image plane.
- **Labeled**: element group boundaries (cemented groups shown as touching, single elements gapped), the aperture
  stop, focal-length and f-number in the HUD corner (matching Intelligence Factory's `.hud.tl` convention), a pin
  on the iris itself that opens its blade-count spec.
- **Hidden**: individual surface radii/thickness numbers by default (that's part-card detail, opened via a pin,
  not painted across the scene) — the geometry should read as *glass*, not as an annotated blueprint, at rest.
- Iris blades close procedurally as the f-stop control moves (see Motion — physically timed, not eased for
  effect), and the ray fan's marginal rays visibly clip against the closing blades — that clipping is real geometry
  intersecting real rays, not a separate vignette effect layered on top.
- Materials: optical glass + edge blackening + AR coating tint per the Materials section; barrel is anodized
  aluminum with matte black interior baffles.

### 3. Focus as a cone of light *(prototype, high detail)*

- **Camera**: side-on or a shallow three-quarter, framed so the converging cone from the lens's exit pupil to the
  focal plane reads as an actual 3D cone in space (not foreshortened into a line) — Ciechanowski's pinhole-box
  diagrams (`design/reference/ciechanowski-pinhole.webp`) are the reference for *how little geometry it takes* to
  make a cone's convergence unambiguous: clean edges, a shaded translucent cone surface, no texture.
- **In frame**: one point-source bundle traced from a scene point, through the aperture, to its focus (or defocus)
  on the sensor plane; the sensor plane itself shown edge-on with a small inset or a secondary camera showing the
  *disk* the cone actually paints there.
- **Labeled**: circle of confusion diameter (drawn to scale against actual pixel pitch — this is the brief's own
  explicit ask, and it's the detail that makes the abstraction land: a CoC that's "2.1 px" reads completely
  differently from one described only in micrometers), the CoC assumption used (which standard — e.g. a print/
  viewing-condition assumption — evidence-chipped as `assumed`), current f-stop and focus distance in the HUD.
- **Hidden**: the full lens element stack — this set piece is about the cone and the disk, not the glass; show at
  most a schematic exit-pupil disc, not the whole barrel, so attention stays on the geometry that's the point.
- The disk-growing-from-a-point slider (brief's own description) is a *physics-driven* control — dragging it
  changes actual focus/defocus distance and the disk diameter is read straight from the engine's CoC calculation,
  never a decorative disk that merely "looks about right."
- Bokeh shape inherits the iris blade count/rounding from set piece 2's same iris model — going cat's-eye toward
  the frame edge is real vignetting geometry (the exit pupil clipped by the barrel/mechanical vignette at oblique
  angles), not a warped-circle texture trick.

### 9. The loupe — final-image pixel to its well *(prototype, high detail)*

- **Camera**: starts as a flat 2D tap on the always-visible final-image panel (a literal pixel in the rendered
  photo), then a single continuous dive straight down through scale — from "a pixel in a photo" through the
  microlens, the CFA, the photodiode, to the well's charge level — following the Motion section's logarithmic-dolly
  rule exactly, since this crosses the most decades of any set piece in the site (image-pixel scale to sub-
  micrometer sensor structure).
- **In frame at the bottom of the dive**: the microlens focusing its cone through the CFA dye layer into the
  photodiode, converted electrons flashing `--charge`-colored and pouring into the glass well (transmission
  material per the Materials section — **glass, not an opaque tank**, this is the pitfall the brief names by
  example), fill height *and* brightness both tracking `electrons / fullWellCapacity`.
- **Labeled**: the pixel's row/column or coordinate it came from (ties the dive back to the photo it started in),
  the well's fill fraction as a number, not just the visual, and — since this is the signature interaction — a
  persistent breadcrumb (e.g. a small inset thumbnail of the source photo with the tapped pixel marked) so a
  reader never loses the thread back to "this came from that photo."
- **Hidden**: neighboring pixels' full detail — show enough of the array around the target well for scale context
  (a few neighbors, dimmer/less detailed) without turning the shot into a busy grid; the target well is the only
  fully detailed one.
- The scale badge is mandatory and continuously updating for the entire dive (this is the clearest single case in
  the whole site of "size exaggerated for visibility" — sub-micrometer structure rendered at a legible screen
  size), per the Scale badge section above.
- Reverse of the dive (returning to the photo) reuses the same camera path backward, same duration rule — it
  should feel like the same motion in reverse, not a different, faster "return" shortcut, or the geometry stops
  feeling like one continuous, trustworthy space.

### 1. Photon rain

- **Camera**: wide establishing angle over the whole scene-to-sensor path, low enough that falling photon sparks
  read as depth (parallax as they fall) rather than a flat overlay.
- **In frame**: sparks colored by `wavelengthToRGB`, density scaled-and-badged to the current exposure; stopping
  down or shortening the shutter visibly thins the rain live, no re-simulation delay.
- **Labeled**: the scale badge (mandatory here, always — this is the canonical scaled representation), exposure
  settings in the HUD corner.
- **Hidden**: individual photon trajectories through the lens (that's set piece 2's job) — here they simply arrive
  and are counted, keeping this piece about *rate and shot noise*, not ray geometry.
- In dim light, arrival becomes visibly sparse and uneven — this is real Poisson-sampled arrival from the engine,
  not a manually dialed-in "grainy" effect; the same underlying draw feeds the histogram in set piece 6, so the two
  must agree if a reader checks both.

### 4. Waves, not rays (Airy pattern)

- **Camera**: near-orthogonal view onto the sensor's pixel grid at the point of interest, so the Airy disk's rings
  visibly span a countable number of pixels — this only reads if the camera is close to perpendicular; an oblique
  angle would foreshorten the ring spacing into ambiguity.
- **Labeled**: Airy disk radius (`1.22 λ N`) against the pixel pitch, current f-stop.
- **Hidden**: the ray-optics view entirely — this is a *layer swap*, not an overlay; showing rays and wavefronts
  simultaneously in the same shot would misrepresent them as compatible pictures of the same instant rather than
  two different models of the same light.
- As the reader stops down, ring growth is continuous and driven by the same f-number the rest of the site uses —
  never a separate "diffraction demo" f-stop control disconnected from the real scenario state.

### 5. Ghosts and coatings

- **Camera**: same framing family as set piece 2 (it's hosted at the same level), with ghost paths as thin, dim,
  clearly-secondary ray traces distinguishable from the primary ray fan by lower intensity, never by a different
  color scheme (they're still real wavelengths).
- **Labeled**: a coatings on/off toggle (the same boolean that drives `iridescence` in the Materials section) with
  a live ghost-intensity change tied to it.
- **Hidden**: ghost paths below a legibility/intensity floor — real lenses generate many extremely faint internal
  reflections; showing every one at readable intensity would be dishonest about their relative strength, so only
  the strongest few render at visible brightness, with a note that fainter ones exist but aren't drawn.
- A coating zoom-in (brief's own ask) is a separate close inset, not a replacement of the wide shot, showing thin-
  film interference color on a small patch of one surface.

### 6. Into the pixel

- Shares its bottom-of-dive composition with set piece 9 (same microlens/CFA/well geometry) — build it once, enter
  it from two different narrative paths (a guided level stop here, a reader-initiated tap in the loupe).
- **Additional to 9's notes**: a live histogram panel beside the 3D view, built from the same Poisson draw as set
  piece 1's photon rain, across a small neighborhood of pixels (not the whole frame) so its shape is legible.

### 7. Readout as a wave

- **Camera**: top-down or near-top-down over the full pixel array, wide enough to show the rolling-shutter's row-
  by-row scan line sweeping the whole frame.
- **Labeled**: current row being read, a visible skew overlay when a moving subject is in the scene (the actual
  geometric skew the rolling shutter produces, not a motion-blur filter standing in for it).
- Column ADC quantization: shown as a small secondary readout (a staircase/step visualization) tied to the actual
  bit depth in the current settings, adjacent to, not blended into, the main array view.

### 8. From mosaic to photo

- **Camera**: flat, 2D, on the final-image panel itself or a paired inset — this set piece is about a pipeline of
  2D transforms, not 3D geometry, and forcing it into a 3D camera move would be decoration, not clarity.
- Each pipeline stage (demosaic, white balance, color matrix, tone curve, NR, sharpening) is scrubbable back and
  forth along one timeline control; scrubbing must show the actual intermediate buffer at that stage, not a
  crossfade between "before" and "after" that only approximates the intermediate state.

### 10. Focal length sweep / dolly zoom

- **Camera**: the site's own camera — this set piece *is* a continuous 20–500mm focal length morph, optionally in
  dolly-zoom mode (subject size held constant by moving physical distance as focal length changes).
- **Labeled**: current focal length and, in dolly-zoom mode, current subject distance, updating live — the entire
  point of this set piece is that perspective/compression tracks *distance*, not focal length, so the two numbers
  must both be visibly live at once, side by side, never one implied.
- **Hidden**: nothing structural — this is the one set piece where the "trick" (perspective is unaffected by focal
  length alone) has to be provable by the reader watching both numbers move independently, so nothing about the
  geometry should be hidden or simplified.

## Phone rules

Every set piece must stay readable at phone width; what drops is *effect budget*, never *content*.

| Tier | Drops first | Keeps always |
|---|---|---|
| Phone | Bloom (already off by default, so nothing to drop), AO radius/samples reduced, PMREM environment resolution reduced, ghost-path count capped lower, particle/spark count for photon rain reduced (density *ratio* preserved, not absolute count — the scale badge's number must still be true at whatever count is actually drawn, so reduce and re-badge together, never reduce silently) | Real geometry (element count, barrel shape, iris blade count), the spectral rule (wavelength colors never get cheaper), evidence chips, HUD numbers, the scale badge, pins and labels at legible size (never shrink below the type scale's minimum), physically-timed motion durations |
| Tablet/desktop mid | AO, reduced PMREM resolution | everything phone keeps, plus fuller AO and ghost paths |
| Desktop high | full AO/GTAO, full PMREM, full ghost-path count, the single tightly-thresholded highlight-bloom pass if enabled | — |

A quality governor picks the tier from measured frame time, not device sniffing (matches the brief's own
"quality governor with tiers" ask) — the table above is what each tier is allowed to touch, not how the governor
decides.

## Do / do-not

**Do**

- Trace every wavelength bin's own path and color it from the one shared `wavelengthToRGB` function.
- Give glass elements edge blackening and an environment to reflect.
- Encode every quantity that might be viewed from directly above in brightness as well as size/height (the well
  fill, any top-down array view).
- Use glass for any container whose contents are the point (wells, and anywhere else this pattern recurs).
- Keep AO off physics-computed emissive values; keep bloom off by default everywhere.
- Time mechanical motion (iris, shutter) at a real physical speed; snap numeric readouts instantly.
- Show the scale badge whenever a picture is deliberately not to true scale or true time.
- Reuse Intelligence Factory's evidence-chip component and colors unchanged.

**Do not**

- Rely on `toneMapped: false` to survive `EffectComposer`'s `OutputPass` — it does not; composite physics-color
  passes after tone mapping instead (see Post-processing rules).
- Give any mesh zero height and assume it won't draw a top face — a "flat" element (a filter, a flat surface) still
  needs its faces considered; a zero-height box still draws its top face and will show up as a stray plane from a
  grazing camera angle.
- Let a top-down view rely on area/diameter alone to communicate a quantity — brightness must carry it too.
- Hide contents behind an opaque wall anywhere the contents are the reason for the shot.
- Use a saturated, spectrum-adjacent hue for any UI element — check it against the spectral locus (see the
  spectral color rule) before shipping a new UI color.
- Add a decorative tween to any number that's supposed to be the live physics truth.
- Let bloom's threshold sit at or below a value `wavelengthToRGB`/the intensity mapping can normally produce —
  that's an invitation for it to wash out real colors, not just spike on real highlights.
- Ship a set piece with default/unmodified Three.js `MeshStandardMaterial` gray — every visible surface earns its
  material from this document, none fall back to library defaults.
- Confuse "reduced effects on phone" with "reduced content on phone" — the tier table above only ever touches
  effect budget.
