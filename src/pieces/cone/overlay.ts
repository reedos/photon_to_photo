// The cone piece's own controls: which scene point is traced. Its distance (log, closest focus to 200 m) and how
// far across the frame it sits (0 = the center, 1 = the corner of the lens's own field), per docs/PROTOTYPE.md's
// set piece 3 notes. These are not the scenario's focus or aperture (those stay in the scenario builder, one
// place each): they only pick the point whose bundle the cone draws. Styled by src/styles/levels.css (.lv-ctl),
// the same hairline card as the camera's exposure readout. Lives in ctx.overlay, which the stage hides with the
// piece.

const STEPS = 200;

export interface ConeControls {
  el: HTMLElement;
  pointDistMm(): number;
  fieldFrac(): number;
  /** Sets both without dispatching a UI event storm; used by tools/choreo/cone.mjs and the accuracy gate via
   *  the piece's own hooks (see cone.ts's hooks.setPoint). */
  set(pointDistMm: number, fieldFrac: number): void;
  /** Re-clamps the slider's floor when the lens (and so its closest focus) changes. */
  setMinMm(mm: number): void;
  onChange(cb: () => void): void;
  dispose(): void;
}

function logStepValue(minMm: number, maxMm: number, step: number): number {
  const t = step / STEPS;
  return Math.exp(Math.log(minMm) + t * (Math.log(maxMm) - Math.log(minMm)));
}
function logStepFromMm(minMm: number, maxMm: number, mm: number): number {
  const t = (Math.log(Math.max(minMm, Math.min(maxMm, mm))) - Math.log(minMm)) / (Math.log(maxMm) - Math.log(minMm));
  return Math.round(t * STEPS);
}

/** Meters, two decimals under 10 m and one above (UI-17: distances stay in meters, 0.45 m, never 450 mm). */
export function fmtDist(mm: number): string {
  const m = mm / 1000;
  return m < 10 ? `${m.toFixed(2)} m` : `${m.toFixed(1)} m`;
}

function fmtField(f: number): string {
  if (f < 0.005) return 'Center';
  if (f > 0.995) return 'Corner';
  return `${Math.round(f * 100)}% out`;
}

/** `minMm`: the lens's closest focus (BRIEF.md: slider runs "from the closest focus to 200 m"). */
export function buildOverlay(minMm: number): ConeControls {
  const maxMm = 200_000; // 200 m
  const el = document.createElement('div');
  el.className = 'lv-ctl';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'The traced point');
  el.innerHTML = `
    <p class="lv-ctl-k">The traced point</p>
    <label class="lv-ctl-row"><span class="lv-ctl-l">Distance</span><output id="cone-dist-v" for="cone-dist"></output>
      <input type="range" id="cone-dist" min="0" max="${STEPS}" step="1" value="0"></label>
    <label class="lv-ctl-row"><span class="lv-ctl-l">Off center</span><output id="cone-field-v" for="cone-field"></output>
      <input type="range" id="cone-field" min="0" max="${STEPS}" step="1" value="0"></label>
  `;

  const distEl = el.querySelector<HTMLInputElement>('#cone-dist')!;
  const distV = el.querySelector<HTMLOutputElement>('#cone-dist-v')!;
  const fieldEl = el.querySelector<HTMLInputElement>('#cone-field')!;
  const fieldV = el.querySelector<HTMLOutputElement>('#cone-field-v')!;

  let onChangeCb: (() => void) | null = null;
  let curMinMm = minMm;

  function syncOutputs() {
    distV.textContent = fmtDist(logStepValue(curMinMm, maxMm, Number(distEl.value)));
    fieldV.textContent = fmtField(Number(fieldEl.value) / STEPS);
    // the amber fill of the site's slider track (base.css reads --pct)
    distEl.style.setProperty('--pct', `${(Number(distEl.value) / STEPS) * 100}%`);
    fieldEl.style.setProperty('--pct', `${(Number(fieldEl.value) / STEPS) * 100}%`);
  }
  syncOutputs();

  const fire = () => { syncOutputs(); onChangeCb?.(); };
  distEl.addEventListener('input', fire);
  fieldEl.addEventListener('input', fire);

  return {
    el,
    pointDistMm() { return logStepValue(curMinMm, maxMm, Number(distEl.value)); },
    fieldFrac() { return Number(fieldEl.value) / STEPS; },
    set(pointDistMm, fieldFrac) {
      distEl.value = String(logStepFromMm(curMinMm, maxMm, pointDistMm));
      fieldEl.value = String(Math.round(Math.min(1, Math.max(0, fieldFrac)) * STEPS));
      syncOutputs();
    },
    setMinMm(mm) {
      if (mm === curMinMm) return;
      const currentMm = logStepValue(curMinMm, maxMm, Number(distEl.value));
      curMinMm = Math.max(1, mm);
      distEl.value = String(logStepFromMm(curMinMm, maxMm, currentMm));
      syncOutputs();
    },
    onChange(cb) { onChangeCb = cb; },
    dispose() {
      distEl.removeEventListener('input', fire);
      fieldEl.removeEventListener('input', fire);
      el.remove();
    },
  };
}
