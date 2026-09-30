// Computes, per lineup lens (docs/PANE.md's seven: s35, n50, n500, n500fl, z35, m50, z800), the realized
// optical stack in the PANE.md world frame -- z_world = z_engine - (sensorZ + afOffset), sensor plane at
// z = 0, lens axis along -z -- so the Blender build scripts (blender/build_lens.py) can size a hollow bore
// that clears every element's realized clear aperture without duplicating any engine math.
//
// Run with: npx tsx blender/data/export-optics.ts
// Writes blender/data/<id>-optics.json for each lens.
import { writeFileSync } from 'node:fs';
import { compute } from '../../src/engine/camera';
import { sensorZEffective } from '../../src/engine/camera';
import { focusRingAngleRad } from '../../src/engine/focus-travel';
import type { Scenario } from '../../src/engine/types';

const LENS_IDS = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'] as const;

// Representative distance-scale marks, mirroring src/scene/lens-exterior.ts's own list (in mm from sensor).
const SCALE_MARKS_MM: (number | null)[] = [null, 10000, 5000, 3000, 2000, 1500, 1000, 700, 500];

function scenarioFor(lensId: string, focusM: number | null): Scenario {
  return {
    lens: lensId,
    fno: 100, // overwritten to maxFno by compute() itself when smaller than the lens's own max
    shutter: 1 / 100,
    iso: 100,
    focusM,
    format: 'ff',
    shutterType: 'mechanical',
    scene: 'bench',
  };
}

for (const lensId of LENS_IDS) {
  const model = compute(scenarioFor(lensId, null));
  const realized = model.realized;
  const sensorZEff = sensorZEffective(model.system);
  const sys = model.system;

  // Every realized surface, converted to the world frame. sdRealized is indexed the same as raw/surfaces.
  const surfaces = sys.surfaces.map((s, i) => ({
    index: i,
    kind: s.kind,
    zEngine: s.z,
    zWorld: s.z - sensorZEff,
    sdRealized: realized.realization.sdRealized[i] ?? null,
    // the shape and the medium behind, so blender/lens_v2.py lathes each element from the prescription itself
    c: s.c,
    k: s.k,
    a: s.a,
    mediumAfter: s.mediumAfter,
    stop: s.kind === 'stop',
    doe: !!s.doe,
    plate: realized.design.surfaces[i]?.plate ?? null,
    layer: realized.design.surfaces[i]?.layer ?? null,
  }));

  // Elements: front/back surface world z + the larger of the two realized semi-diameters (what the barrel's
  // bore must clear at that axial position), plus the element's own max OD if surfaces bulge outward — using
  // sdRealized directly is the conservative, engine-exact figure the brief asks for ("clears every element's
  // realized clear aperture").
  const elements = realized.elements.map((el) => {
    const [f, b] = el.surfaces;
    const sdF = realized.realization.sdRealized[f] ?? 0;
    const sdB = realized.realization.sdRealized[b] ?? 0;
    return {
      index: el.index,
      frontSurface: f,
      backSurface: b,
      zFrontWorld: sys.surfaces[f].z - sensorZEff,
      zBackWorld: sys.surfaces[b].z - sensorZEff,
      sdFront: sdF,
      sdBack: sdB,
      maxSd: Math.max(sdF, sdB),
    };
  });

  const maxRealizedSd = Math.max(...realized.realization.sdRealized.filter((v) => Number.isFinite(v)));

  // Distance-scale marks: angle (rad) per real focus distance, from the engine's own real focus travel.
  const scaleMarks = SCALE_MARKS_MM
    .filter((mm) => mm === null || mm >= realized.realization.closestFocusMm - 1e-6)
    .map((mm) => ({ mm, angleRad: focusRingAngleRad(realized, mm, lensId) }));
  scaleMarks.push({
    mm: realized.realization.closestFocusMm,
    angleRad: focusRingAngleRad(realized, realized.realization.closestFocusMm, lensId),
  });

  const out = {
    lensId,
    sensorZEff,
    afOffset: realized.afOffset ?? 0,
    closestFocusMm: realized.realization.closestFocusMm,
    maxRealizedSd,
    surfaces,
    elements,
    scaleMarks,
    focalLength: realized.design.focalLength,
    maxFno: realized.design.maxFno,
    markedFno: realized.design.markedFno ?? realized.design.maxFno,
    iris: { ...realized.design.iris, stopRadius: realized.realization.stopRadius },
    elementCount: realized.design.elements,
    groupCount: realized.design.groups,
    representativeOf: realized.design.representativeOf ?? null,
  };

  const path = new URL(`./${lensId}-optics.json`, import.meta.url);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${lensId}-optics.json: maxRealizedSd=${maxRealizedSd.toFixed(3)}mm, ${elements.length} elements, closest focus ${out.closestFocusMm}mm`);
}
