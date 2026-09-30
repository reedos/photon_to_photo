# Photon to Photo

An interactive explainer and simulator of a camera with a lens attached, from the photon to the finished photo. A
generic DSLR and a generic mirrorless body, each with lenses built from public patent prescriptions: focus and the glass
moves where the physics puts it, open the aperture and the light the lens accepts widens, fire the shutter and count the
photons that land in each pixel. Every ray, spot, photon and well level on screen is computed by the typed physics
engine in `src/engine`; nothing is drawn for effect.

Personal educational project based on cited public sources. Not an official publication of my employer or of the
companies whose products are discussed. The camera bodies and lenses are generic, unbranded models built to published
dimensions; where a design is tied to a product, its card says so. Estimates and assumptions are labeled as such.

## Run it

- `npm ci`, then `npm run dev` (http://127.0.0.1:47500)
- `npm test` runs the engine's unit and golden tests; `node tools/test-perf.mjs` runs the render time budget alone
- `npm run typecheck`
- `npm run build` builds the site into `dist/`

The 3D models are scripted in Blender 5.2 (`blender/*.py`) and exported to `public/models/`; the exports are
checked against the published dimensions and the engine's element positions in `src/scene/**/*.test.ts`.

## Sources

The lens prescriptions come from published patents, each cited in its `data/lenses/*.json` with the example and table.
Glass, color, sensor and hardware data are cited per value in `data/**` and described in `research/*.md`, with each
source's license noted there. The site's look follows the author's companion project, The Intelligence Factory.

## License

Code: MIT (see LICENSE). Third-party data keeps its own license, recorded with it in `research/`.
