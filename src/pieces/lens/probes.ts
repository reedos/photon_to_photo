// The numbered pins and their part cards (BRIEF.md set piece 2 probes): front element, the iris, the focus
// group, the sensor, the ray fan, the detail inset. Every spec row with a number carries a Fig -- read straight
// off Model (or, where Model has none yet, built here from the same engine data Model already carries, e.g. the
// iris's own evidence kind from the design's iris.ev -- never invented).
import * as THREE from 'three/webgpu';
import type { Model } from '../../engine/model-types';
import type { Fig } from '../../engine/types';
import type { PartCard, PieceProbe } from '../types';
import { BINS } from '../../engine/data';
import { fmtDims, fmtDistance, fmtFno, fmtNum } from '../../app/units';

// How each focus method reads on a card: the title, and the value on the Method row.
const FOCUS_NAMES: Record<string, [string, string]> = {
  unit: ['Unit focusing', 'Whole lens'],
  'front-group': ['Front-group focusing', 'Front group'],
  inner: ['Inner focusing', 'Inner group'],
  rear: ['Rear-group focusing', 'Rear group'],
  floating: ['Floating focus', 'Floating groups'],
};
const FOCUS_HOW: Record<string, string> = {
  unit: 'moving all of its glass together',
  'front-group': 'moving the front group',
  inner: 'moving a group inside the barrel',
  rear: 'moving the rear group',
  floating: 'moving two groups by different amounts',
};

export interface ProbeExtras {
  irisDrawnRadius: number;
  insetMagnification: number;
  insetSpreadMm: number;
  fields: number[];
  /** The wavelength bins actually traced (every bin every glass in the lens has dispersion data for). */
  bins: number[];
}

function derivedFig(v: number, unit: string, calc: string): Fig {
  return { v, unit, ev: 'derived', calc };
}

export interface ProbeAnchors {
  frontElement: THREE.Vector3;
  iris: THREE.Vector3;
  focusGroup: THREE.Vector3;
  sensor: THREE.Vector3;
  rayFan: THREE.Vector3;
  inset: THREE.Vector3;
}

export function buildProbes(anchors: ProbeAnchors, getExtras: () => ProbeExtras): PieceProbe[] {
  const probes: PieceProbe[] = [
    {
      id: 'front-element',
      label: 'Front element',
      anchor: anchors.frontElement,
      card(model: Model): PartCard {
        const surf = model.realized.design.surfaces[0];
        const nd = surf.nd ?? 0;
        const vd = surf.vd ?? 0;
        const src = model.lens.source;
        return {
          kicker: 'Level 2 · the lens',
          title: `L1 — ${model.lens.name}`,
          body: `The front element of ${model.lens.elements} in ${model.lens.groups} groups. Traced from ` +
            `${src.ref}${src.assignee ? `, ${src.assignee}` : ''}, published ${src.published ?? 'n/d'}.`,
          specs: [
            { k: 'Index nd', v: nd.toFixed(5), fig: { v: nd, unit: '', ev: 'spec', src: src.url, loc: src.location } },
            { k: 'Abbe vd', v: vd.toFixed(2), fig: { v: vd, unit: '', ev: 'spec', src: src.url, loc: src.location } },
            { k: 'Patent', v: src.ref },
            { k: 'Elements / groups', v: `${model.lens.elements} / ${model.lens.groups}` },
          ],
        };
      },
    },
    {
      id: 'iris',
      label: 'Iris',
      anchor: anchors.iris,
      card(model: Model): PartCard {
        const extras = getExtras();
        const design = model.realized.design;
        return {
          kicker: 'Level 2 · the iris',
          title: `${model.lens.blades}-blade aperture`,
          body: `A ${model.lens.rounded ? 'rounded' : 'straight'}-blade iris at the stop plane, closing to the ` +
            `current f-number. The opening shown is the engine's own schematic blade geometry, not a photographed mechanism.`,
          specs: [
            { k: 'Blades', v: String(model.lens.blades), fig: { v: model.lens.blades, unit: 'blades', ev: design.iris.ev, src: design.iris.source } },
            { k: 'Blade shape', v: model.lens.rounded ? 'Rounded' : 'Straight' },
            { k: 'F-number', v: fmtFno(model.scenario.fno), fig: model.figs.fno },
            { k: 'Opening diameter', v: `${(model.iris.radius * 2).toFixed(2)} mm`, fig: derivedFig(model.iris.radius * 2, 'mm', 'iris.ts stopRadiusFor(), 2x radius') },
          ],
        };
      },
    },
    {
      id: 'focus-group',
      label: 'Focus group',
      anchor: anchors.focusGroup,
      card(model: Model): PartCard {
        const design = model.realized.design;
        const realization = model.realized.realization;
        const spec: Fig = realization.closestFocusSource === 'focus.minFocusM'
          ? { v: model.lens.closestFocusMm / 1000, unit: 'm', ev: 'spec', src: design.focus.minFocusSource }
          : derivedFig(model.lens.closestFocusMm / 1000, 'm', 'realize.ts: focus.gaps at their close condition');
        return {
          kicker: 'Level 2 · focus',
          title: (FOCUS_NAMES[design.focus.method] ?? [design.focus.method])[0],
          body: `This design focuses by ${FOCUS_HOW[design.focus.method] ?? 'moving a group of elements'}. ` +
            `Focus is set to ${model.focus.distanceMm === null ? 'infinity' : `${fmtDistance(model.focus.distanceMm)} from the sensor`}.`,
          specs: [
            { k: 'Method', v: (FOCUS_NAMES[design.focus.method] ?? ['', design.focus.method])[1] },
            { k: 'Closest focus', v: fmtDistance(model.lens.closestFocusMm), fig: spec },
            { k: 'Focus setting', v: fmtDistance(model.focus.distanceMm) },
            { k: 'Magnification', v: `${fmtNum(Math.abs(model.focus.magnification), 3)}×`, fig: derivedFig(model.focus.magnification, '×', 'paraxial.ts imageOf()') },
          ],
        };
      },
    },
    {
      id: 'sensor',
      label: 'Sensor',
      anchor: anchors.sensor,
      card(model: Model): PartCard {
        return {
          kicker: 'Level 2 · the sensor',
          title: model.sensor.name,
          body: `${model.sensor.format.name}, ${fmtDims(model.sensor.widthPx, model.sensor.heightPx)} pixels at the ` +
            `image plane. The lens's own image circle is ${model.realized.design.imageCircleMm.toFixed(1)} mm across.`,
          specs: [
            { k: 'Format', v: `${fmtNum(model.sensor.format.w, 1)} × ${fmtNum(model.sensor.format.h, 1)} mm` },
            { k: 'Pixel pitch', v: `${model.sensor.pitchUm.toFixed(2)} µm`, fig: model.figs.pitchUm },
            { k: 'Array', v: `${fmtDims(model.sensor.widthPx, model.sensor.heightPx)} px` },
            { k: 'Image circle', v: `${model.realized.design.imageCircleMm.toFixed(1)} mm`, fig: derivedFig(model.realized.design.imageCircleMm, 'mm', 'lens-types.ts LensDesign.imageCircleMm') },
          ],
        };
      },
    },
    {
      id: 'ray-fan',
      label: 'Ray fan',
      anchor: anchors.rayFan,
      card(): PartCard {
        const extras = getExtras();
        const all = BINS.centers.length, n = extras.bins.length;
        const lo = Math.min(...extras.bins), hi = Math.max(...extras.bins);
        return {
          kicker: 'Level 2 · the ray fan',
          title: `${n}-bin spectral trace`,
          body: `Every ray is traced surface by surface with real Snell's-law refraction and each glass's own ` +
            `dispersion. A ray that clips the iris or an element's clear aperture ends exactly where it was blocked.` +
            (n < all ? ` ${all - n} of the ${all} bins are left out: a glass in this lens has published dispersion ` +
              `data only from ${lo.toFixed(1)} to ${hi.toFixed(1)} nm, and the engine does not extrapolate past it.` : ''),
          specs: [
            { k: 'Wavelength bins', v: n < all ? `${n} of ${all}` : String(n), fig: { v: n, unit: 'bins', ev: 'spec', src: 'data/color/wavelength-bins-16.json' } },
            { k: 'Field fractions', v: extras.fields.map((f) => f.toFixed(2)).join(', '), fig: { v: extras.fields.length, unit: 'fields', ev: 'assumed', calc: 'this piece\'s own choice of which field angles to draw' } },
            { k: 'Rays per field', v: '9' },
          ],
        };
      },
    },
    {
      id: 'detail-inset',
      label: 'Edge of frame',
      anchor: anchors.inset,
      card(): PartCard {
        const extras = getExtras();
        return {
          kicker: 'Level 2 · the detail inset',
          title: 'Where the edge rays land',
          body: `The colors split by far less than a pixel of the main view, so the inset looks straight at the ` +
            `sensor where the off-axis rays arrive, magnified, with a dot for each traced ray in its own color.`,
          specs: [
            { k: 'Magnification', v: `${Math.round(extras.insetMagnification)}×`, fig: derivedFig(extras.insetMagnification, '×', 'inset.ts: inset px/mm over main-view px/mm at the image plane depth') },
            { k: 'Landing spread', v: `${(extras.insetSpreadMm * 1000).toFixed(1)} µm`, fig: derivedFig(extras.insetSpreadMm, 'mm', 'max chord of the off-axis fan\'s landing points') },
          ],
        };
      },
    },
  ];
  return probes;
}
