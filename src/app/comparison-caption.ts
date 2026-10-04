import type { Scenario } from '../engine/types';
import { lensSummary } from './engine-api';
import { fmtDistance, fmtFno, fmtNum, fmtShutter } from './units';

const SCENE_LABELS: Record<string, string> = {
  bench: 'Tabletop',
  dusk: 'Low light',
  field: 'Field',
  flight: 'Bird glide',
};

function sceneLabel(id: string): string {
  return SCENE_LABELS[id] ?? id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Human-readable settings for a comparison caption. Formatting never changes the engine scenario. */
export function formatComparisonCaption(scenario: Scenario): string {
  const lens = lensSummary(scenario.lens);
  const focalLength = fmtNum(lens.focalLength, 1);
  const focus = fmtDistance(scenario.focusM === null ? null : scenario.focusM * 1000);
  return `${focalLength} mm ${fmtFno(lens.markedFno)} · ${sceneLabel(scenario.scene)} · ${fmtFno(scenario.fno)} · ${fmtShutter(scenario.shutter)} · ISO ${fmtNum(scenario.iso, 0)} · focus ${focus}`;
}
