# Mount geometry — mounts research note

Agent: mounts. Covers `data/hardware/mounts.json` only. Accessed date for every web source in
this note: 9/28/2026. Machine-readable figures with evidence labels are in
`data/hardware/mounts.json`; this file is the prose version, sources and conflicts.

## Task A: native mount geometry

| Mount | Flange (mm) | Throat / inner diameter (mm) | Lugs | Contacts | Source |
|---|---|---|---|---|---|
| Sony E (full-frame / FE) | 18.0 (spec) | 46.1 (spec) | 3 (reported) | 10 (reported; one other source seen says 8 — see conflict below) | [Wikipedia, Sony E-mount](https://en.wikipedia.org/wiki/Sony_E-mount); lug/contact counts from a web search aggregating [Camera-wiki.org, Sony NEX](https://camera-wiki.org/wiki/Sony_NEX) |
| Canon RF | 20.0 (spec) | 54.0 (spec) | 3 (spec) | 12 (spec) | [Wikipedia, Canon RF lens mount](https://en.wikipedia.org/wiki/Canon_RF_lens_mount) |
| Nikon Z (full-frame) | 16.0 (spec) | 55.0 (spec) | 4 (spec) | 11 (spec) | [Wikipedia, Nikon Z-mount](https://en.wikipedia.org/wiki/Nikon_Z-mount) |
| Canon EF | 44.0 (spec) | 54.0 (spec) | 3 (derived) | 8 (spec) | [Wikipedia, Canon EF lens mount](https://en.wikipedia.org/wiki/Canon_EF_lens_mount) |
| Nikon F | 46.5 (spec) | 44.0 (spec) | 3 (spec) | 8 (reported) | [Wikipedia, Nikon F-mount](https://en.wikipedia.org/wiki/Nikon_F-mount) |
| Sigma SA | 44.0 (spec) | 45.0 (assumed) | 3 (assumed) | 8 (derived) | [Wikipedia, Sigma SA-mount](https://en.wikipedia.org/wiki/Sigma_SA-mount) |
| Leica L (L-Mount Alliance) | 20.0 (spec) | 51.6 (spec) | 4 (spec) | 10 (spec) | [Wikipedia, Leica L-Mount](https://en.wikipedia.org/wiki/Leica_L-Mount) |

Notes and conflicts:

- **Sony E contacts.** One search result (paraphrasing general E-mount summaries) says 8 electrical
  contacts; the more specific Camera-wiki.org "Sony NEX" article says 10, describing "a set of 10
  electrical contacts along the bottom." `mounts.json` records 10 as `reported` and notes the
  conflict rather than picking silently.
- **Canon EF lug count.** Wikipedia's EF article states the mount design reversed the Canon FD
  mount's "three-eared bayonet" logic (moving the bayonet from the body to the lens) but does not
  itself print a lug count for EF. 3 lugs is the number consistently reported for EF elsewhere
  (e.g., the AliExpress wiki summary of EF dimensions) and is the standard SLR-era bayonet count
  Canon carried over from FD, so it is recorded as `derived`, not `spec`.
  Canon EF: [Wikipedia, Canon EF lens mount](https://en.wikipedia.org/wiki/Canon_EF_lens_mount).
- **Nikon F contacts.** Wikipedia's F-mount connector table lists 5/6/7/8/10-pin variants across
  the mount's many generations, with no single "the" F-mount figure. 8 pins is used here because
  it is also the exact number the Nikon Z-mount article cites as the F-mount baseline it doubled
  the tab count and grew the contact count from ("from eight (on the F-mount) to eleven"), so the
  two sources corroborate each other on 8 for modern AF-S G/E lenses. Recorded as `reported`.
  [Wikipedia, Nikon F-mount](https://en.wikipedia.org/wiki/Nikon_F-mount);
  [Wikipedia, Nikon Z-mount](https://en.wikipedia.org/wiki/Nikon_Z-mount).
- **Sigma SA throat and lug count are not published anywhere found.** Wikipedia's SA-mount article
  states the mount is "mechanically similar to the Pentax K-mount... with this reduced flange
  distance compared to Pentax's 45.5 mm," and a separate search on the Pentax K-mount throat found
  45 mm / 45.46 mm reported. SA's throat is therefore `assumed` at 45.0 mm (borrowed from the
  mount it is described as mechanically modeled on) and its lug count `assumed` at 3 (the SLR-era
  count shared by Pentax K, Canon EF and Nikon F, none of which the source says SA departs from).
  [Wikipedia, Sigma SA-mount](https://en.wikipedia.org/wiki/Sigma_SA-mount).
- **Sigma SA contacts.** The same SA-mount article states SA "uses the same signalling lines and
  protocol as the EF-mount." Contact count is `derived` as equal to EF's sourced figure (8) on that
  basis, since no independent SA pin count was found.

## The generic body mount

Reed's 09/28/2026 decision: the body is a generic, unbranded full-frame mirrorless design, exact
where the physics depends on it (sensor position, mount opening, flange distance). No product's
mount shape is copied; only two numbers are set, chosen so every lens in `data/lenses/*.json`
mounts through an adapter of zero or positive length.

**Constraint.** The mirrorless-native mounts actually used by our lens set (see Task B below) are
Sony E (18.0 mm flange, on p135) and Canon RF (20.0 mm flange, on p24 and p28). The SLR mounts used
(Canon EF 44.0 mm, Nikon F 46.5 mm) are far longer and never bind the minimum. So the generic
flange must be ≤ 18.0 mm, the shorter of the two mirrorless flanges in use.

**Choice: 16.0 mm flange, 55.0 mm throat (assumed).**

- *Flange.* 16.0 mm is set strictly below 18.0 mm (Sony E) rather than exactly at it, so every
  lens — including the mirrorless-native ones — gets a strictly positive adapter length instead of
  a zero-length special case for one lens and not the others. The number itself is not invented:
  16.0 mm is the real, sourced Nikon Z flange distance above, the shortest published full-frame
  mirrorless flange found in this survey, so the assumption borrows a demonstrated real value
  rather than picking an arbitrary smaller number.
- *Throat.* 55.0 mm matches the largest sourced throat among the seven mounts above (Nikon Z). The
  widest adapter-limited throat any lens in this set actually needs is Canon EF/RF's 54.0 mm
  (the EF- and RF-native lenses' rear groups and mount adapters, per Task C), so 55.0 mm clears
  every rear element and every adapter tube in the set with roughly 1 mm of margin.

## Task B: each lens's native mount

Back focus, per lens, is the sum of surface `t` (thickness to the next surface) starting from the
last surface of the lens's own optical elements — i.e., excluding any filter/cover-glass plate,
but including the plate's own thickness and the final air gap after it — through to the image
plane. Concretely: find the last surface in the file whose `medium` is `"glass"` and whose label
does not mention a filter or cover glass; the back focus is the sum of every subsequent surface's
`t`, to the end of the array. Values below were computed directly from `data/lenses/*.json` with a
small Node script; array indices are 0-based.

| Lens | representativeOf | Assignee, filed | Back focus (mm) | Mount | Label |
|---|---|---|---|---|---|
| p20 | Sigma 20mm F1.4 DG HSM \| Art | Sigma Corp, 7/18/2019 | 38.951 (surfaces[25..28]) | Canon EF | derived |
| p24 | none | Canon Inc., 2/15/2021 | 15.000 (surfaces[29..30]) | Canon RF | derived |
| p28 | none | Canon Inc., 2/15/2021 | 15.850 (surfaces[27..28]) | Canon RF | derived |
| p35 | none | Nikon Corp, 2/16/2010 | 38.029 (surfaces[15..16]) | Nikon F | derived |
| p50 | Sigma 50mm F1.4 DG HSM \| Art | Sigma Corp, 6/22/2015 | 38.800 (surfaces[21..22]) | Canon EF | derived |
| p85 | Sigma 85mm F1.4 EX DG HSM | Sigma Corp, 9/1/2011 | 39.870 (surfaces[18..19]) | Canon EF | derived |
| p105 | Nikon AF-S NIKKOR 105mm f/1.4E ED | Nikon Corp, 6/20/2019 | 39.632 (surfaces[22..23]) | Nikon F | **spec** |
| p135 | Sony FE 135mm F1.8 GM | Sony Corp, 10/3/2019 | 21.395 (surfaces[23..25]) | Sony E | **spec** |
| p200 | none | Nikon Corporation, 2/6/1996 | 78.986 (surfaces[20..21]) | Nikon F | derived |
| p300 | none | Canon Kabushiki Kaisha, 9/5/2000 | 69.320 (surfaces[26..28]) | Canon EF | derived |
| p400 | none | Canon Kabushiki Kaisha, 9/5/2000 | 74.910 (surfaces[27..30]) | Canon EF | derived |
| p500 | none | Canon Kabushiki Kaisha, 9/5/2000 | 128.570 (surfaces[25..28]) | Canon EF | derived |

**Why "spec" for p105 and p135, "derived" for the rest.** p105 is a Nikon-branded product
(AF-S NIKKOR) sold in exactly one mount, Nikon F; p135 is Sony-branded ("FE" specifically denotes
Sony's full-frame E-mount line) sold in exactly one mount, Sony E. Both ties come straight from
`research/lenses-normal.md`'s photonstophotos.net Optical Bench Hub sourcing, so mount assignment
needs no further reasoning — label `spec`.

The other five tied lenses (p20, p50, p85) carry the "DG HSM" / "EX DG HSM" naming Sigma uses only
for its SLR-era autofocus lenses (built around an in-lens Hyper Sonic Motor); none of these three
specific products was ever sold as a mirrorless "DG DN" version. That fixes the mount family
(Canon EF, Nikon F or Sigma SA) but not a single mount, so the mount itself is `derived`: Canon EF
is picked for all three, both because it is each lens's Optical Bench Hub tie in
`research/lenses-normal.md` / `research/lenses-20.md`, and because EF's 44.0 mm flange is the
shortest of the three SLR candidates (EF 44.0 = Sigma SA 44.0 < Nikon F 46.5), which gives the
most conservative (shortest) adapter-length check against the generic body.

The seven untied lenses (p24, p28, p35, p200, p300, p400, p500) have no representativeOf, so the
mount is inferred entirely from assignee, filing date and computed back focus:

- **p24, p28** — Canon Inc., filed 2/15/2021. Canon stopped new EF development around 2018-2019 in
  favor of RF ([Wikipedia, Canon EF lens mount](https://en.wikipedia.org/wiki/Canon_EF_lens_mount)
  history; [Wikipedia, Canon RF lens mount](https://en.wikipedia.org/wiki/Canon_RF_lens_mount),
  announced September 2018), so a Canon patent filed in 2021 is overwhelmingly likely to be RF.
  Confirmed by back focus: 15.000 mm and 15.850 mm are far short of the ~35 mm an SLR mirror box
  needs, and consistent with RF's 20.0 mm flange plus a short working gap.
- **p35** — Nikon Corp, filed 2/16/2010. Nikon's Z-mount did not exist until 2018 (announced
  8/23/2018 per [Wikipedia, Nikon Z-mount](https://en.wikipedia.org/wiki/Nikon_Z-mount)), so a 2010
  Nikon lens patent is F-mount. Back focus 38.029 mm is over the ~35 mm threshold, consistent.
- **p200** — Nikon Corporation, filed 2/6/1996: same reasoning, F-mount only existed. Back focus
  78.986 mm is far over threshold; long back focus on a long telephoto is typical (the internal
  focus group sits well forward of the mechanical back of the barrel).
- **p300, p400, p500** — Canon Kabushiki Kaisha, all three from US 6,115,188, filed 9/5/2000. RF
  did not exist until 2018, so these are EF-mount telephotos (EF-mount super-telephotos of this
  era, e.g. the EF 300mm f/2.8L, are well documented). Back focus 69.320 / 74.910 / 128.570 mm are
  all far over the SLR threshold, consistent with EF and with long telephoto back-focus geometry.

## Task C: adapters

Adapter length = native flange − generic body flange (16.0 mm), derived:

| Lens | Native mount | Native flange (mm) | Adapter length (mm) | A real adapter for this mount pair exists? |
|---|---|---|---|---|
| p20, p50, p85, p300, p400, p500 | Canon EF | 44.0 | 28.0 | Yes — Canon's own EF-EOS R mount adapter carries EF lenses to the 20.0 mm RF flange (a 24.0 mm adapter, close in kind to this 28.0 mm figure against a shorter 16.0 mm generic flange); [Canon EOS R System page](https://www.canon.ca/en/Features/EOS-R/EOS-R-System) lists the EF-EOS R adapter family. |
| p24, p28 | Canon RF | 20.0 | 4.0 | RF's own flange (20.0 mm) is already longer than a native EF-mount lens design would need on this generic body, but no official adapter mounts RF lenses onto a shorter-flange body (RF glass is designed to sit close to the sensor); this 4.0 mm figure is the geometric gap only, not a claim that a product exists for it. |
| p35, p105, p200 | Nikon F | 46.5 | 30.5 | Yes — Nikon's own FTZ adapter carries F-mount lenses to the Z-mount's 16.0 mm flange, i.e. exactly this generic body's flange, so the FTZ adapter's real length (46.5 − 16.0 = 30.5 mm) matches this figure directly; [Nikon USA, Z Mount System](https://www.nikonusa.com/learn-and-explore/c/products-and-innovation/nikon-z-series-z-mount-system) references the FTZ adapter. |
| p135 | Sony E | 18.0 | 2.0 | No dedicated 2 mm adapter is a real product (E-mount lenses mount natively at 18.0 mm on Sony bodies); a 2.0 mm spacer to this shorter 16.0 mm generic flange is a geometric consequence of the generic body's flange choice, not a real accessory. |

The Nikon F → 16.0 mm case is the one pairing where the generic body's flange exactly matches a
real, shipping product (Nikon's Z-mount, via the FTZ adapter), which is why that row's derived
adapter length equals a real adapter's real length. The other rows are honest approximations: the
generic body is not any single one of these seven mounts, so its adapter lengths are geometrically
derived, not measured off a real accessory, except where noted.

## Sources (all accessed 9/28/2026)

- [Wikipedia, Sony E-mount](https://en.wikipedia.org/wiki/Sony_E-mount)
- [Camera-wiki.org, Sony NEX](https://camera-wiki.org/wiki/Sony_NEX)
- [Wikipedia, Canon RF lens mount](https://en.wikipedia.org/wiki/Canon_RF_lens_mount)
- [Wikipedia, Nikon Z-mount](https://en.wikipedia.org/wiki/Nikon_Z-mount)
- [Wikipedia, Canon EF lens mount](https://en.wikipedia.org/wiki/Canon_EF_lens_mount)
- [Wikipedia, Nikon F-mount](https://en.wikipedia.org/wiki/Nikon_F-mount)
- [Wikipedia, Sigma SA-mount](https://en.wikipedia.org/wiki/Sigma_SA-mount)
- [Wikipedia, Leica L-Mount](https://en.wikipedia.org/wiki/Leica_L-Mount)
- [Canon EOS R System](https://www.canon.ca/en/Features/EOS-R/EOS-R-System)
- [Nikon USA, Z Mount System](https://www.nikonusa.com/learn-and-explore/c/products-and-innovation/nikon-z-series-z-mount-system)
- `research/lenses-normal.md`, `research/lenses-20.md`, `research/lenses-wide.md`,
  `research/lenses-tele.md` (this project) for each lens's representativeOf tie, assignee and
  filing date
- `data/lenses/p20.json`, `p24.json`, `p28.json`, `p35.json`, `p50.json`, `p85.json`, `p105.json`,
  `p135.json`, `p200.json`, `p300.json`, `p400.json`, `p500.json` for surface data and computed
  back focus
