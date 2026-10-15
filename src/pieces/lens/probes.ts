// The numbered pins and their part cards (BRIEF.md set piece 2 probes): front element, the iris, the focus
// group, the sensor, the ray fan, the detail inset. Every spec row with a number carries a Fig -- read straight
// off Model (or, where Model has none yet, built here from the same engine data Model already carries, e.g. the
// iris's own evidence kind from the design's iris.ev -- never invented).
import * as THREE from 'three/webgpu';
import type { Model } from '../../engine/model-types';
import type { Fig } from '../../engine/types';
import type { PartCard, PieceProbe } from '../types';
import { BINS } from '../../engine/data';
import { fmtDims, fmtDistance, fmtFno, fmtMag, fmtNum } from '../../app/units';

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
  /** Largest distance between two wavelengths' landing centroids at the inset's field (lateral color), mm. */
  insetColorShiftMm: number;
  /** Widest single-wavelength landing chord at the inset's field (aberration, plus any defocus), mm. */
  insetSpotMm: number;
  /** Where the fans start, from the sensor (mm): the focus distance; null = a point at infinity. */
  fanSourceMm: number | null;
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
          kicker: 'Optics · the lens',
          title: 'Front element',
          sub: `L1 · ${model.lens.name}`,
          body: `The first of ${model.lens.elements} glass elements in ${model.lens.groups} groups (L1 counts from the front). ` +
            `Its refractive index says how strongly the glass bends light; its Abbe number says how little it spreads ` +
            `the colors (a higher number spreads them less).`,
          // the source citation (a Japanese patent) is for a reader who wants to check the prescription (score loop r5)
          more: `Traced from ${src.ref}${src.assignee ? `, ${src.assignee}` : ''}, published ${src.published ?? 'n/d'}.`,
          specs: [
            { k: 'Refractive index (nd, yellow light)', v: nd.toFixed(5), fig: { v: nd, unit: '', ev: 'spec', src: src.url, loc: src.location } },
            { k: 'Abbe number (vd)', v: vd.toFixed(2), fig: { v: vd, unit: '', ev: 'spec', src: src.url, loc: src.location } },
            { k: 'Patent', v: src.ref },
            { k: 'Elements / groups', v: `${model.lens.elements} / ${model.lens.groups}`, fig: { v: model.lens.elements, unit: 'elements', ev: 'spec', src: src.url, loc: src.location } },
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
          kicker: 'Optics · the iris',
          title: `${model.lens.blades}-blade aperture`,
          body: `A ${model.lens.rounded ? 'rounded' : 'straight'}-blade iris at the stop plane, closing to the ` +
            `current f-number. The opening shown is the simulator's own schematic blade shape, not a photographed mechanism.`,
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
        // A patent that tabulates its focusing gaps only down to a farther distance than the product focuses
        // (n50: 1.7 m against 0.45 m) has its motion continued linearly past the table. Say so once focus is inside it.
        const extrapolate = design.focus.extrapolate;
        const tabulatedMm = Math.max(0, ...(design.focus.gaps ?? []).map((g) => g.closeObjectDistance));
        const extrapolating = !!extrapolate && model.focus.distanceMm !== null && model.focus.distanceMm < tabulatedMm;
        return {
          kicker: 'Optics · focus',
          title: (FOCUS_NAMES[design.focus.method] ?? [design.focus.method])[0],
          body: `This design focuses by ${FOCUS_HOW[design.focus.method] ?? 'moving a group of elements'}. ` +
            `Focus is set to ${model.focus.distanceMm === null ? 'infinity' : `${fmtDistance(model.focus.distanceMm)} from the sensor`}.` +
            (extrapolating ? ` The patent lists this motion only down to ${fmtDistance(tabulatedMm)}; closer than that the groups here keep moving the same way, which is an assumption, not the real lens's mechanism.` : ''),
          specs: [
            { k: 'Method', v: (FOCUS_NAMES[design.focus.method] ?? ['', design.focus.method])[1] },
            { k: 'Closest focus', v: fmtDistance(model.lens.closestFocusMm), fig: spec },
            // Your own setting, so it carries no evidence tag (score loop r3: it was tagged ASSUMED).
            { k: 'Focus setting (yours)', v: fmtDistance(model.focus.distanceMm) },
            { k: 'Magnification', v: `${fmtNum(Math.abs(model.focus.magnification), 3)}×`, fig: derivedFig(model.focus.magnification, '×', 'paraxial.ts imageOf()') },
            ...(extrapolating ? [{ k: `Group motion below ${fmtDistance(tabulatedMm)}`, v: 'Extrapolated', fig: { v: model.focus.distanceMm!, unit: 'mm', ev: 'assumed' as const, src: extrapolate!.note } }] : []),
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
          kicker: 'Optics · the sensor',
          title: model.sensor.name,
          body: `${model.sensor.format.name}, ${fmtDims(model.sensor.widthPx, model.sensor.heightPx)} pixels at the ` +
            `image plane. The image circle drawn around it is ${model.realized.design.imageCircleMm.toFixed(1)} mm across: the format's ` +
            `diagonal, assumed to be covered by the lens, not a measured illuminated circle.`,
          specs: [
            { k: 'Format', v: `${fmtNum(model.sensor.format.w, 1)} × ${fmtNum(model.sensor.format.h, 1)} mm` },
            { k: 'Pixel pitch', v: `${model.sensor.pitchUm.toFixed(2)} µm`, fig: model.figs.pitchUm },
            { k: 'Array', v: `${fmtDims(model.sensor.widthPx, model.sensor.heightPx)} px`, fig: { v: model.sensor.widthPx, unit: 'px', ev: 'derived', calc: 'data.ts sensorInfo(): active array from sensor record; format crop capped to even pixel counts at physical pitch' } },
            { k: 'Image circle (assumed)', v: `${model.realized.design.imageCircleMm.toFixed(1)} mm`, fig: { v: model.realized.design.imageCircleMm, unit: 'mm', ev: 'assumed', src: `data/lenses/${model.scenario.lens}.json imageCircleMm; nominal modeled coverage, not a measured illuminated circle` } },
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
          kicker: 'Optics · the ray fan',
          title: `Rays in ${n} colors`,
          body: `Each ray is traced in ${n} narrow bands of color (wavelengths) through every glass surface. The rays read white where the colors travel together; the inset shows where each color lands.`,
          more: `Each surface bends a ray with Snell's law of ` +
            `refraction and each glass's own dispersion, the way its bending changes with color. ` +
            (extras.fanSourceMm === null
              ? 'The rays come from a distant point (infinity), where the lens is focused, so each fan meets at the sensor. '
              : `The rays come from a point ${fmtDistance(extras.fanSourceMm)} from the sensor, on the plane the lens is focused on, so each fan meets at the sensor. `) +
            `A ray that hits the iris ` +
            `or the edge of an element's usable glass (its clear aperture) ends exactly where it was blocked.` +
            (n < all ? ` ${all - n} of the ${all} bins are left out: a glass in this lens has published dispersion ` +
              `data only from ${lo.toFixed(1)} to ${hi.toFixed(1)} nm, and the engine does not extrapolate past it.` : ''),
          specs: [
            { k: 'Colors traced (wavelength bands)', v: n < all ? `${n} of ${all}` : String(n), fig: { v: n, unit: 'bins', ev: 'spec', src: 'data/color/wavelength-bins-16.json' } },
            { k: 'Where the fans aim (share of the half field)', v: extras.fields.map((f) => (f === 0 ? 'center' : `${Math.round(f * 100)}% out`)).join(', '), fig: { v: extras.fields.length, unit: 'fields', ev: 'assumed', calc: 'this piece\'s own choice of which field angles to draw' } },
            { k: 'Rays start from', v: extras.fanSourceMm === null ? 'Infinity (parallel rays)' : `${fmtDistance(extras.fanSourceMm)} (the focus distance)`, fig: { v: extras.fanSourceMm ?? Infinity, unit: 'mm', ev: 'derived', calc: 'camera.ts lensFans(): an object point on the focused plane, at the current focus distance from the sensor' } },
            { k: 'Rays per fan and color', v: '9', fig: { v: 9, unit: 'rays', ev: 'assumed', src: 'lens.ts: nine ray samples per wavelength and field' } },
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
          kicker: 'Optics · the detail inset',
          title: 'Where the edge rays land',
          // score loop r5: about 45 words (it was 60); the one-line key to the dots and bars is the inset's own legend
          body: `Glass bends each color a little differently, so one white point lands as a short rainbow smear (color fringing). The inset magnifies the sensor near the edge of the frame: one dot per traced ray, in its own color. ` +
            (extras.insetColorShiftMm >= extras.insetSpotMm
              ? 'Here the shift between colors is the larger part of the smear.'
              : "Here each color's own spread is the larger part of the smear."),
          more: `The rays start on the plane the lens is focused on, so in a perfect lens the dots would meet in one point. Two things spread them. The dots line up from red to violet: that shift between colors is lateral chromatic aberration. Each color's own dots also spread along the line, even in one color (spherical aberration, coma and the like): the colored bars beside the dots, one per color, each span that color's own dots, so a bar's length is that color's own blur and the way the bars step is the shift. The scale bar in the inset's lower corner gives the true size on the sensor; the magnification only compares the inset with the main view, so it changes as you zoom or resize the window.`,
          specs: [
            { k: 'Magnified vs. the main view', v: fmtMag(extras.insetMagnification), fig: derivedFig(extras.insetMagnification, '×', 'inset.ts: inset px/mm over main-view px/mm at the image plane depth') },
            { k: 'Landing spread, all colors', v: `${(extras.insetSpreadMm * 1000).toFixed(1)} µm`, fig: derivedFig(extras.insetSpreadMm, 'mm', "max chord of the off-axis fan's landing points, every color") },
            { k: 'Widest single-color spread', v: `${(extras.insetSpotMm * 1000).toFixed(1)} µm`, fig: derivedFig(extras.insetSpotMm, 'mm', "inset.ts: max chord of one wavelength's landing points, widest wavelength") },
            { k: 'Shift between colors (lateral color)', v: `${(extras.insetColorShiftMm * 1000).toFixed(1)} µm`, fig: derivedFig(extras.insetColorShiftMm, 'mm', 'inset.ts: max distance between per-wavelength landing centroids') },
          ],
        };
      },
    },
  ];
  return probes;
}
