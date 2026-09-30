# One pane: the camera as a single 3D model (Reed, 09/28/2026)

Reed: "We want this to look like one single visualization pane with the ability to select different components and
analyze them in more detail. We want to see high quality models for the camera body connected to the lens,
rotatable, adjustable aperture, focus point, etc. this should be a high quality 3d model."

This supersedes the three-tab layout (lens / cone / loupe as separate pieces). Those pieces become **detail modes of
components inside one scene**. Their engine-driven geometry, rays, bundles and gates are kept and re-housed.

## The scene

- One Three.js scene, world units **mm**, true scale throughout. The camera frame puts the **sensor plane at z = 0**,
  the lens axis along **-z** (the front of the lens at negative z), y up, and x to the camera's right seen from
  behind. The mount flange face is at z = -flange (D850-style: F geometry, 46.5 mm; Z8-style: Z geometry, 16 mm).
- The engine's optical z maps to world z as z_world = z_engine - (sensorZ + afOffset), with the model from
  compute(). The glass elements, iris, rays and bundles therefore sit exactly inside the barrel where the physics
  puts them.
- **Two bodies**, generic and unbranded, with D850 and Z8 geometry and sensors (data/d850.json, z8.json,
  hardware/dslr.json, body.json). The DSLR body has a mirror box, main mirror and sub-mirror, focusing screen,
  pentaprism and focal-plane shutter. The mirrorless body has a shutter-less sensor stack and an EVF. Both carry the
  sensor package with its filter stack and a visible pixel array.
- **The lineup:** a body switch (DSLR / mirrorless) and three lenses per body, plus the second 500 on the DSLR.
  - DSLR: s35, n50, n500 (PF), n500fl.
  - Mirrorless: z35, m50, z800 (PF).
- **Lens exteriors** are built from the optical stack and the makers' published dimensions (diameter, length,
  filter thread). Their rings are placed where the focus group sits. The focus ring carries an engraved distance
  scale placed by the lens's real focus travel: ring angle is proportional to the solved focus parameter t in
  [0, 1] (infinity to closest focus).

## Interaction

- Orbit, pan and zoom around the whole camera. Rotatable at any time.
- **Controls on the model**, bound to the same scenario as the side panel:
  - drag the focus ring to focus;
  - use the aperture control (a body command dial for lenses without an aperture ring) and watch the iris
    through the front element;
  - set shutter and ISO on the top-plate dials;
  - drag a focus-point marker in the scene to set the focus distance.
- **Select a component** by clicking it on the model or picking it from the part list. The camera flies to it, the
  rest of the camera fades back (becomes see-through, never hidden if it matters), and a detail mode opens:
  - **Lens**: a cutaway on the barrel's wedge, the glass elements, the spectral ray fan and the magnified
    image-plane inset (the former lens piece).
  - **Iris**: the blades close up, closing with the f-stop, the entrance pupil seen through the front element.
  - **Focus / image plane**: the cone of light from a chosen object point converging at the sensor, and the bokeh
    disk on the pixel grid (the former cone piece).
  - **Sensor**: a continuous dive into the sensor: the pixel array, then one pixel's microlens, color filter,
    photodiode and well (the former loupe). The final-image panel stays linked: tapping a pixel dives to it.
  - **Mirror box** (DSLR): the mirror, the sub-mirror and the light path to the viewfinder and AF; the mirror flips
    up at its measured timing when the shutter fires.
  - **Shutter / readout**: the curtains (DSLR) or the electronic row scan (mirrorless).
- A breadcrumb (Camera > Lens > Iris) and Esc go back out, along the same path.

## Light and exposure (Reed, 09/28/2026: "we should see visually how wider/narrower aperture affects the light rays
coming into the lens and how it affects the image. Also shutter speed too and how it determines quantity of photons")

- **Light coming in.** A bundle of light from the scene enters the front element in the whole-camera view and in
  the lens cutaway. Its width at the lens is the entrance pupil (model.cardinal.ep), so opening the aperture visibly
  widens the bundle the lens accepts and closing it narrows it, with the iris seen closing through the glass. Its
  density shows the photon flux, scaled and badged. Area goes as 1/N^2: one stop halves it, and the stat reads it
  out (photons per second through the pupil).
- **Shutter speed as time.** Firing the shutter plays the exposure at a stated slow-motion factor (badged, e.g.
  "time slowed 1,000x"). Photons arrive for exactly the shutter time: the curtains or the electronic scan open and
  close, and the sensor's wells fill while they are open. A photon counter reads the total. Doubling the time
  doubles the count; halving it halves it.
- **What it does to the image.** The final-image panel updates at once and makes the tradeoffs visible side by side:
  - aperture changes brightness and depth of field (the bokeh disks grow as you open up);
  - shutter changes brightness and motion blur (a moving subject in the scene);
  - both set the photon count, and with it the shot noise. Too few photons and the grain shows. That is the same
    Poisson count the well shows in the sensor dive.
  An "equivalent exposure" toggle trades one stop of aperture for one stop of shutter, so the photon count stays the
  same while depth of field and motion blur change.
- The engine supplies every number: the entrance-pupil area, the photon flux, and the photons per pixel for the
  exposure. Nothing is animated for effect. Where a quantity is scaled, the scale badge says so.

## Visual bar

- A high-quality 3D model: beveled edges, no hard CG corners; knurled rubber rings as geometry or normal maps;
  engraved scales; anodized and satin-black materials; the Z-style and F-style mounts' bayonets; a grip with
  rubber texture; dials with detents. Accurate to the published dimensions, generic in branding (no logos or
  trade dress).
- Glass looks like thick optical glass: transmission, coating tint by angle, blackened element edges.
- Lighting and environment per design/LOOK.md, in one signature style with The Intelligence Factory.
- Every set-piece rule still holds: physics colors unlit and exact; the scale badge whenever the view is not true
  scale; the accuracy gates keep passing.

## Code layout

- src/scene/ holds the one scene.
  - camera-rig.ts assembles body + lens for the scenario.
  - bodies/ holds dslr.ts and mirrorless.ts.
  - lens-exterior.ts builds a lens's outside.
  - selection.ts handles picking, fading and breadcrumbs.
  - modes/ holds lens.ts, iris.ts, focus.ts, sensor.ts, mirror.ts and shutter.ts, re-housed from src/pieces.
- The app shell keeps its header, the scenario builder, the stat row and the final-image panel. The level strip
  becomes the component breadcrumb, and the right panel lists the selected component's parts and cards.
