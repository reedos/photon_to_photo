# data/lenses

One JSON file per transcribed patent prescription. The files are the single source for the engine; the cited prescriptions
must not be edited (see the `source` block in each).

## Registered and unregistered designs

The app's lens list is `LENS_DESIGNS` in `src/engine/data.ts`. A file here that is not in that list is transcribed
and tested but never offered, loaded or drawn.

- **m500.json** (JP 2023-023323 A, a 585 mm f/5.7 Phase Fresnel telephoto, the Z 600 PF class) is the one such file.
  It is kept, unregistered, because `model-glass.test.ts`, `edges.test.ts`, `lenses.test.ts` and `realize.test.ts`
  use it as a second diffractive worked example, and `research/lenses-m500.md` records its sourcing. The product lineup
  uses `z800` for the Nikon Z super-telephoto. To offer m500 it would need an entry in `LENS_DESIGNS`, a lens-exteriors
  record, a GLB and a Blender build file; none of those exist, so `p2p.set({ lens: 'm500' })` now throws instead of
  silently opening the 50 mm.
