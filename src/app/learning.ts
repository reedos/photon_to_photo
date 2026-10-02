import type { Store, AppState } from './store';
import { compute } from './engine-api';
import { currentRender, onRender, type RenderView } from './render-client';
import { TOUR, PIPELINE, pipelinePixels, rowWindow, sameShot, type PipelineStage } from './learning-model';
import { sensorFor } from '../engine/data';
import { analogGain, readout, maxDn } from '../engine/sensor';
import '../styles/learning.css';
import { emit, on } from './bus';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountLearning(store: Store, startTour = false, startLesson: string | null = null): void {
  const launch = document.createElement('button');
  launch.className = 'btn learn-launch'; launch.id = 'learn-launch'; launch.textContent = 'Learn';
  launch.setAttribute('aria-expanded', 'false'); launch.setAttribute('aria-controls', 'journey');
  document.querySelector('.view-menu')!.before(launch);
  const phone = matchMedia('(max-width: 760px)');
  const placeLaunch = () => phone.matches ? el('steps').append(launch) : document.querySelector('.view-menu')!.before(launch);
  placeLaunch(); phone.addEventListener('change', placeLaunch);
  const journey = document.createElement('section');
  journey.id = 'journey'; journey.hidden = true; journey.setAttribute('aria-label', 'Follow the light');
  journey.innerHTML = `<div class="journey-copy"><label class="journey-label" for="journey-stop">Follow the light</label><select id="journey-stop" aria-label="Tour stop">${TOUR.map((s, i) => `<option value="${i}">${i + 1} / ${TOUR.length} · ${s.title}</option>`).join('')}</select><p id="journey-text" role="status"></p></div>
    <nav aria-label="Tour controls"><button class="btn" id="journey-prev" aria-label="Previous tour stop">‹</button><button class="btn" id="journey-play">Play</button><button class="btn" id="journey-next" aria-label="Next tour stop">Next ›</button><button class="btn" id="journey-restart">Restart</button><button class="btn" id="journey-close" aria-label="Close tour">×</button></nav>`;
  el('viewer').prepend(journey);
  const lesson = document.createElement('section');
  lesson.id = 'sensor-lesson'; lesson.hidden = true; lesson.setAttribute('aria-label', 'Sensor to photo');
  lesson.innerHTML = `<header><div><span class="journey-label">Inside your camera · Sensor → Photo</span><h2 id="lesson-title">Read the sensor</h2></div><button class="btn" id="lesson-close">← Camera</button></header>
    <div class="lesson-tabs" role="group" aria-label="Sensor lessons"><button class="btn" id="lesson-readout" aria-pressed="true">Readout</button><button class="btn" id="lesson-pipeline" aria-pressed="false">Image pipeline</button></div>
    <div id="readout-lesson"><p>Rows collect light for the same duration, but start at different times. Scrub through a full electronic scan.</p>
      <div class="row-demo" id="row-demo" role="img" aria-label="Row exposure timing"></div>
      <label class="lesson-control" for="scan-progress">Scan progress <output id="scan-value" aria-hidden="true"></output><input id="scan-progress" type="range" min="0" max="100" value="50"></label>
      <p id="scan-detail" class="lesson-note"></p>
      <div class="charge-demo"><div><label class="lesson-control" for="charge-level">Collected charge <output id="charge-value" aria-hidden="true"></output><input id="charge-level" type="range" min="0" max="100" value="25"></label><meter id="charge-meter" aria-label="Fraction of full well" min="0" max="100" value="25">25%</meter></div><p id="adc-value" role="status"></p></div>
      <p id="charge-detail" class="lesson-note"></p><p class="lesson-note">Schematic electronic shutter timing; travel direction and row count are illustrative. Mechanical curtains have their own timing. This preview does not add rolling-shutter skew to the photo.</p>
    </div>
    <div id="pipeline-lesson" hidden><label class="lesson-control">Processing stage<select id="pipeline-stage">${PIPELINE.map(([id, title], i) => `<option value="${id}">${i + 1}. ${title}</option>`).join('')}</select></label>
      <div class="pipeline-picture"><canvas id="pipeline-canvas" width="600" height="400" role="img" aria-label="Current shot at the selected processing stage"></canvas><canvas id="pipeline-crop" width="128" height="128" role="img" aria-label="Enlarged center sample of the selected processing stage"></canvas></div>
      <p id="pipeline-description" role="status"></p><p class="lesson-note">Full frame + enlarged center sample. Intermediate stages are shown as stored, without display encoding; they can look dark. Each sample represents a block of sensor pixels.</p>
    </div><p id="lesson-shot" class="lesson-note" role="status"></p>`;
  el('view').append(lesson);
  const shortcuts = document.createElement('div'); shortcuts.className = 'lesson-shortcuts';
  shortcuts.innerHTML = '<button class="btn" id="open-readout">Sensor readout</button><button class="btn" id="open-pipeline">Image pipeline</button>';
  el('scenario').append(shortcuts);
  let index = 0, playing = false, timer = 0, entering = false;
  let mode: 'readout' | 'pipeline' = 'readout';
  let returnState: Pick<AppState, 'piece' | 'cameraPart'> | null = null;
  let tourReturn: Pick<AppState, 'piece' | 'cameraPart'> | null = null;
  let lessonOpener: HTMLElement | null = null;
  const rendered = () => { const v = currentRender(); return v && sameShot(v.scenario, compute(store.get().scenario).scenario) ? v : null; };
  function pause() { playing = false; clearTimeout(timer); el('journey-play').textContent = 'Play'; }
  on('pause-tour', pause);
  function schedule() {
    clearTimeout(timer);
    if (playing) timer = window.setTimeout(() => { if (index < TOUR.length - 1) go(index + 1); else pause(); }, 14000);
  }
  function paintPipeline(view: RenderView | null) {
    const stage = el<HTMLSelectElement>('pipeline-stage').value as PipelineStage;
    const desc = PIPELINE.find(([id]) => id === stage)!;
    el('pipeline-description').textContent = desc[2];
    const canvas = el<HTMLCanvasElement>('pipeline-canvas'), crop = el<HTMLCanvasElement>('pipeline-crop');
    const ctx = canvas.getContext('2d')!, cctx = crop.getContext('2d')!;
    if (!view) { ctx.clearRect(0, 0, canvas.width, canvas.height); cctx.clearRect(0, 0, 128, 128); return; }
    canvas.width = view.width; canvas.height = view.height;
    const data = ctx.createImageData(view.width, view.height); data.data.set(pipelinePixels(view, stage)); ctx.putImageData(data, 0, 0);
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(canvas, Math.floor(view.width / 2) - 8, Math.floor(view.height / 2) - 8, 16, 16, 0, 0, 128, 128);
    canvas.setAttribute('aria-label', `Your shot: ${desc[1]}`);
  }
  function paintReadout() {
    const model = compute(store.get().scenario), sc = model.scenario;
    const spec = sensorFor(sc.format, sc.iso, sc.sensor).spec;
    const progress = Number(el<HTMLInputElement>('scan-progress').value) / 100;
    const total = model.sensor.readoutS + sc.shutter, time = progress * total;
    const rows = 8;
    el('row-demo').replaceChildren(...Array.from({ length: rows }, (_, row) => {
      const line = document.createElement('div'); const window = rowWindow(row, rows, model.sensor.readoutS, sc.shutter);
      const status = time < window.start ? 'waiting' : time < window.end ? 'collecting' : 'read';
      line.className = `scan-row ${status}`;
      const label = document.createElement('span'); label.textContent = String(row + 1);
      const track = document.createElement('i'), exposure = document.createElement('b');
      exposure.style.left = `${100 * window.start / total}%`; exposure.style.width = `${100 * sc.shutter / total}%`;
      track.append(exposure); const state = document.createElement('span'); state.textContent = status;
      line.append(label, track, state); return line;
    }));
    el('row-demo').style.setProperty('--scan', `${100 * progress}%`);
    el('scan-value').textContent = `${(time * 1000).toFixed(2)} ms`;
    el('scan-progress').setAttribute('aria-valuetext', `${(time * 1000).toFixed(2)} milliseconds`);
    const scanEvidence = model.sensor.figs.readoutS;
    const basis = scanEvidence?.ev === 'reported' ? (scanEvidence.loc?.includes('low --') ? 'Reported estimate, low confidence; see Evidence.' : 'Reported measurement, full-frame silent Mode 1; see Evidence.') : 'Assumed illustrative scan time.';
    el('scan-detail').textContent = `${model.sensor.name}: ${(model.sensor.readoutS * 1000).toFixed(2)} ms between the first and last row starts; ${(sc.shutter * 1000).toFixed(2)} ms exposure per row. ${basis} A fast shutter can reduce blur while row-to-row motion still causes skew.`;
    const fraction = Number(el<HTMLInputElement>('charge-level').value) / 100;
    const electrons = fraction * model.sensor.fullWellE, code = readout(spec, electrons, sc.iso);
    el('charge-value').textContent = `${Math.round(electrons).toLocaleString()} e−`;
    el('charge-level').setAttribute('aria-valuetext', `${Math.round(electrons).toLocaleString()} electrons, ${Math.round(fraction * 100)} percent of full well`);
    el<HTMLMeterElement>('charge-meter').value = fraction * 100;
    el('adc-value').textContent = `${Math.round(electrons).toLocaleString()} e− → ${analogGain(spec, sc.iso).toFixed(3)} DN/e− → ${code.toLocaleString()} DN${code === maxDn(spec) ? ' · ADC clipped' : ''}`;
    el('charge-detail').textContent = `ISO ${sc.iso} · ${spec.bitDepth}-bit ADC · ${model.sensor.readNoiseE.toFixed(2)} e− RMS read noise. Conversion shown at zero sampled read noise, including black level and rounding. Full well: ${Math.round(model.sensor.fullWellE).toLocaleString()} e−. The pixel view shows stochastic noise.`;
  }
  function refresh() {
    if (lesson.hidden) return;
    const view = rendered();
    el('lesson-shot').textContent = view ? `Same shot · ${view.scenario.lens} · f/${view.scenario.fno} · ISO ${view.scenario.iso}` : 'Updating your shot…';
    if (mode === 'pipeline') paintPipeline(view); else paintReadout();
  }
  function hideLesson(restore = false) {
    lesson.hidden = true; el('view').classList.remove('show-lesson');
    // Hidden canvas controls cannot take keyboard focus behind the lesson.
    for (const child of Array.from(el('view').children)) if (child !== lesson) (child as HTMLElement).inert = false;
    if (restore && returnState) { entering = true; store.setPiece(returnState.piece); store.setCameraPart(returnState.cameraPart); entering = false; }
    returnState = null; lessonOpener = null;
  }
  function closeLesson() {
    const opener = lessonOpener;
    pause(); hideLesson(true);
    const target = opener?.isConnected && opener !== document.body && opener.getClientRects().length && !opener.closest('[inert]') ? opener : journey.hidden ? launch : el('journey-stop');
    target.focus({ preventScroll: true });
  }
  function openLesson(nextMode: 'readout' | 'pipeline') {
    emit('pause-exposure', {});
    if (lesson.hidden) {
      returnState = { piece: store.get().piece, cameraPart: store.get().cameraPart };
      lessonOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    el('lesson-close').textContent = '← ' + ({ camera: 'Camera', lens: 'Optics', cone: 'Focus', loupe: 'Pixel' }[returnState?.piece ?? 'camera']);
    mode = nextMode; lesson.hidden = false; el('view').classList.add('show-lesson');
    lesson.scrollTop = 0;
    for (const child of Array.from(el('view').children)) if (child !== lesson) (child as HTMLElement).inert = true;
    el('readout-lesson').hidden = mode !== 'readout'; el('pipeline-lesson').hidden = mode !== 'pipeline';
    el('lesson-readout').setAttribute('aria-pressed', String(mode === 'readout'));
    el('lesson-pipeline').setAttribute('aria-pressed', String(mode === 'pipeline'));
    el('lesson-title').textContent = mode === 'readout' ? 'Read the sensor' : 'From raw to photo'; refresh();
  }
  function go(next: number) {
    index = Math.max(0, Math.min(TOUR.length - 1, next)); const stop = TOUR[index];
    entering = true; hideLesson(); store.setPiece(stop.piece); store.setCameraPart(stop.part); entering = false;
    if (stop.lesson) openLesson(stop.lesson);
    el<HTMLSelectElement>('journey-stop').value = String(index); el('journey-text').textContent = stop.text;
    el<HTMLButtonElement>('journey-prev').disabled = index === 0;
    el('journey-next').textContent = index === TOUR.length - 1 ? 'Finish ✓' : 'Next ›';
    schedule();
  }
  function closeTour() {
    pause(); hideLesson(); journey.hidden = true; launch.setAttribute('aria-expanded', 'false');
    if (tourReturn) { entering = true; store.setPiece(tourReturn.piece); store.setCameraPart(tourReturn.cameraPart); entering = false; }
    tourReturn = null; launch.focus({ preventScroll: true });
  }
  function begin() {
    tourReturn = { piece: store.get().piece, cameraPart: store.get().cameraPart };
    journey.hidden = false; launch.setAttribute('aria-expanded', 'true'); go(0); el('journey-stop').focus({ preventScroll: true });
  }
  launch.onclick = () => journey.hidden ? begin() : closeTour();
  el('journey-close').onclick = closeTour;
  el('journey-prev').onclick = () => { pause(); go(index - 1); };
  el('journey-next').onclick = () => { pause(); if (index === TOUR.length - 1) closeTour(); else go(index + 1); };
  el('journey-restart').onclick = () => { pause(); go(0); };
  el('journey-stop').onchange = () => { pause(); go(Number(el<HTMLSelectElement>('journey-stop').value)); };
  el('journey-play').onclick = () => {
    if (playing) pause(); else { if (index === TOUR.length - 1) go(0); playing = true; el('journey-play').textContent = 'Pause'; schedule(); }
  };
  for (const name of ['readout', 'pipeline'] as const) {
    el(`open-${name}`).onclick = () => { pause(); openLesson(name); el('lesson-close').focus({ preventScroll: true }); };
    el(`lesson-${name}`).onclick = () => { pause(); openLesson(name); };
  }
  el('lesson-close').onclick = closeLesson;
  el('pipeline-stage').onchange = () => { pause(); paintPipeline(rendered()); };
  for (const id of ['scan-progress', 'charge-level']) el(id).oninput = () => { pause(); paintReadout(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!lesson.hidden) { event.stopImmediatePropagation(); closeLesson(); }
    else if (!journey.hidden) { event.stopImmediatePropagation(); closeTour(); }
  }, true);
  let previous = store.get();
  store.subscribe(state => {
    if (!entering && state !== previous) {
      pause();
      if (state.piece !== previous.piece || state.cameraPart !== previous.cameraPart) hideLesson();
      if (!journey.hidden && (state.piece !== previous.piece || state.cameraPart !== previous.cameraPart)) el('journey-text').textContent = 'Exploring freely. Next returns to the guided journey; Restart begins at the scene.';
    }
    previous = state; refresh();
  });
  onRender(refresh);
  if (startTour) begin();
  else if (startLesson === 'readout' || startLesson === 'pipeline') openLesson(startLesson);
}
