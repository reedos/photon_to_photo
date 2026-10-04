import type { Store, AppState } from './store';
import { compute } from './engine-api';
import { currentRender, onRender, onRenderFailure, type RenderView } from './render-client';
import { TOUR, PIPELINE, PIPELINE_GUIDE, pipelinePixels, rowWindow, sameShot, type PipelineStage } from './learning-model';
import { pipelineSample } from './pipeline-sample';
import { sensorFor } from '../engine/data';
import { analogGain, readout, maxDn } from '../engine/sensor';
import '../styles/learning.css';
import { emit, on } from './bus';
import { learningInsights } from './learning-insights';
import { drawReadout } from './readout-visual';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountLearning(store: Store, startTour = false, startLesson: string | null = null): void {
  const launch = document.createElement('button');
  launch.className = 'btn learn-launch'; launch.id = 'learn-launch'; launch.textContent = matchMedia('(max-width: 760px)').matches ? 'Tour' : 'Guided tour';
  launch.setAttribute('aria-expanded', 'false'); launch.setAttribute('aria-controls', 'journey');
  document.querySelector('#studio-actions')!.before(launch);
  const phone = matchMedia('(max-width: 760px)');
  const placeLaunch = () => {
    if (phone.matches) { el('steps').append(launch); launch.textContent = 'Tour'; }
    else { document.querySelector('#studio-actions')!.before(launch); launch.textContent = 'Guided tour'; }
  };
  placeLaunch(); phone.addEventListener('change', placeLaunch);
  const journey = document.createElement('section');
  journey.id = 'journey'; journey.hidden = true; journey.setAttribute('aria-label', 'Follow the light');
  journey.innerHTML = `<div class="journey-copy"><label class="journey-label" for="journey-stop">Follow the light</label><select id="journey-stop" aria-label="Tour stop">${TOUR.map((s, i) => `<option value="${i}">${i + 1} / ${TOUR.length} · ${s.title}</option>`).join('')}</select><p id="journey-text" role="status"></p><p id="journey-caption" role="status"></p><details id="journey-more"><summary>More</summary><p id="journey-more-text"></p><details id="journey-physics"><summary>Physics & practical use</summary><p id="journey-equation"></p><p id="journey-live"></p><p id="journey-use"></p></details></details></div>
    <nav aria-label="Tour controls"><button class="btn" id="journey-prev" aria-label="Previous tour stop">‹</button><button class="btn" id="journey-play">Play</button><button class="btn" id="journey-next" aria-label="Next tour stop">Next ›</button><button class="btn" id="journey-restart">Restart</button><button class="btn" id="journey-close" aria-label="Close tour">×</button></nav>`;
  el('viewer').prepend(journey);
  phone.addEventListener('change', () => { el<HTMLDetailsElement>('journey-more').open = !phone.matches; });
  const lesson = document.createElement('section');
  lesson.id = 'sensor-lesson'; lesson.hidden = true; lesson.setAttribute('aria-label', 'Sensor to photo');
  lesson.innerHTML = `<header><div><span class="journey-label">Inside your camera · Sensor → Photo</span><h2 id="lesson-title">Read the sensor</h2></div><button class="btn" id="lesson-close">← Camera</button></header>
    <div class="lesson-toolbar"><div class="lesson-tabs" role="group" aria-label="Sensor lessons"><button class="btn" id="lesson-readout" aria-pressed="true">Readout</button><button class="btn" id="lesson-pipeline" aria-pressed="false">Image pipeline</button></div>
    <div class="lesson-playback"><button class="btn" id="lesson-play">Play scan</button><button class="btn" id="lesson-replay">Restart</button><span id="lesson-timing">Time expanded for visibility</span></div></div>
    <div id="readout-lesson"><p>Rows collect light for the same duration, but start at different times. Watch a moving edge bend as it is read row by row.</p>
      <canvas id="readout-visual" width="760" height="210" role="img" aria-label="Electronic scan, charge well and digital conversion"></canvas>
      <div class="row-demo" id="row-demo" role="img" aria-label="Row exposure timing"></div>
      <label class="lesson-control" for="scan-progress">Scan progress <output id="scan-value" aria-hidden="true"></output><input id="scan-progress" type="range" min="0" max="100" step="0.1" value="50"></label>
      <p id="scan-detail" class="lesson-note"></p>
      <div class="charge-demo"><div><label class="lesson-control" for="charge-level">Collected charge <output id="charge-value" aria-hidden="true"></output><input id="charge-level" type="range" min="0" max="100" value="25"></label><meter id="charge-meter" aria-label="Fraction of full well" min="0" max="100" value="25">25%</meter></div><p id="adc-value" role="status"></p></div>
      <p id="charge-detail" class="lesson-note"></p><details class="lesson-context"><summary>How this applies to a real photograph</summary><p class="lesson-note">Try it: a fast shutter reduces motion blur within a row; a fast scan reduces skew between rows. The moving edge is a schematic at 4 sensor widths/s; the dashed line marks its first-row exposure midpoint. Charge and ADC illustrate a separately selected pixel. Mechanical curtains have their own timing. Skew is not added to your photo.</p></details>
    </div>
    <div id="pipeline-lesson" hidden><label class="lesson-control">Processing stage<select id="pipeline-stage">${PIPELINE.map(([id, title], i) => `<option value="${id}">${i + 1}. ${title}</option>`).join('')}</select></label>
      <div id="pipeline-route" aria-label="Processing sequence">${PIPELINE.map(([id, title], i) => `<button class="btn" data-stage="${id}" aria-label="${title}">${i + 1}<span>${['Raw', 'Color', 'Balance', 'Matrix', 'Display'][i]}</span></button>`).join('')}</div>
      <div class="pipeline-picture"><canvas id="pipeline-canvas" width="600" height="400" role="button" tabindex="0" aria-label="Choose a sample in the pipeline image. Click a spot or use arrow keys; Enter centers the sample."></canvas><i id="pipeline-region" aria-hidden="true"></i><canvas id="pipeline-crop" width="128" height="128" role="img" aria-label="Enlarged selected sample of the processing stage"></canvas><span class="pipeline-crop-label" aria-hidden="true">16 × 16 samples</span><i id="pipeline-wipe" hidden></i></div>
      <div class="pipeline-sample-tools"><span>Tap the image to move the enlarged sample. Arrow keys move it; Enter centers it.</span><button type="button" class="btn" id="pipeline-center">Center sample</button></div>
      <label class="lesson-control" for="pipeline-progress">Processing journey<input id="pipeline-progress" type="range" min="0" max="1000" value="0"></label>
      <p class="pipeline-look"><b>Look for</b><span id="pipeline-look-for"></span></p><p id="pipeline-description" role="status"></p><p class="lesson-note">Synthetic shot · actual model buffers. Intermediate stages are shown as stored, without display encoding; they can look dark. Each sample represents a block of sensor pixels.</p>
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
  let lessonModel = compute(store.get().scenario);
  let animation = 0, animating = false, animationTime = 0, lastFrame = 0;
  const pipelineCache = new Map<string, HTMLCanvasElement>();
  let cachedRenderId = -1;
  let sampleX=.5,sampleY=.5;
  const duration = () => mode === 'readout' ? 8000 : 15000;
  function pauseLesson() {
    animating = false; cancelAnimationFrame(animation);
    el('lesson-play').textContent = mode === 'readout' ? 'Play scan' : 'Play pipeline';
  }
  function showInsights() {
    const insight = learningInsights(lessonModel)[index];
    el('journey-equation').textContent = insight.equation;
    el('journey-live').textContent = insight.live;
    el('journey-use').textContent = insight.use;
  }
  const rendered = () => { const v = currentRender(); return v && sameShot(v.scenario, lessonModel.scenario) ? v : null; };
  function pause() { playing = false; clearTimeout(timer); el('journey-play').textContent = 'Play'; }
  on('pause-tour', () => { pause(); pauseLesson(); });
  function schedule() {
    clearTimeout(timer);
    if (playing) timer = window.setTimeout(() => { if (index < TOUR.length - 1) go(index + 1); else pause(); }, 14000);
  }
  function paintPipeline(view: RenderView | null, reveal = 1) {
    const stage = el<HTMLSelectElement>('pipeline-stage').value as PipelineStage;
    const desc = PIPELINE.find(([id]) => id === stage)!;
    if (el('pipeline-description').textContent !== desc[2]) el('pipeline-description').textContent = desc[2];
    el('pipeline-look-for').textContent=PIPELINE_GUIDE[stage];
    for (const button of el('pipeline-route').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.stage === stage));
    const canvas = el<HTMLCanvasElement>('pipeline-canvas'), crop = el<HTMLCanvasElement>('pipeline-crop');
    const ctx = canvas.getContext('2d')!, cctx = crop.getContext('2d')!;
    el('pipeline-region').hidden = !view;
    if (!view) { ctx.clearRect(0, 0, canvas.width, canvas.height); cctx.clearRect(0, 0, 128, 128); return; }
    // Assigning even the same dimensions clears and reallocates the backing store.
    // The pipeline wipe repaints every frame; only resize when the photo changes size.
    if (canvas.width !== view.width) canvas.width = view.width;
    if (canvas.height !== view.height) canvas.height = view.height;
    if (cachedRenderId !== view.renderId) { pipelineCache.clear(); cachedRenderId = view.renderId; }
    const buffer = (id: PipelineStage) => {
      let image = pipelineCache.get(id);
      if (!image) {
        image = document.createElement('canvas'); image.width = view.width; image.height = view.height;
        const context = image.getContext('2d')!, data = context.createImageData(view.width, view.height);
        data.data.set(pipelinePixels(view, id)); context.putImageData(data, 0, 0); pipelineCache.set(id, image);
      }
      return image;
    };
    const step = PIPELINE.findIndex(([id]) => id === stage);
    if (reveal < 1 && step > 0) ctx.drawImage(buffer(PIPELINE[step - 1][0]), 0, 0);
    else { ctx.fillStyle = '#0d141c'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, canvas.width * reveal, canvas.height); ctx.clip(); ctx.drawImage(buffer(stage), 0, 0); ctx.restore();
    el('pipeline-wipe').hidden = reveal >= 1;
    el('pipeline-wipe').style.left = `${reveal * 100}%`;
    cctx.imageSmoothingEnabled = false;
    const sample=pipelineSample(view.width,view.height,sampleX,sampleY);
    cctx.drawImage(canvas,sample.x,sample.y,sample.width,sample.height,0,0,128,128);
    const marker=el('pipeline-region');
    marker.style.left=`${100*sample.x/view.width}%`;marker.style.top=`${100*sample.y/view.height}%`;
    marker.style.width=`${100*sample.width/view.width}%`;marker.style.height=`${100*sample.height/view.height}%`;
    el('pipeline-crop').setAttribute('aria-label',`${desc[1]}: enlarged ${sample.width} by ${sample.height} sample at column ${sample.x+1}, row ${sample.y+1}`);
    canvas.setAttribute('aria-label', `Your shot: ${desc[1]}. Click a spot or use arrow keys to move the enlarged sample. Enter centers it.`);
  }
  function paintReadout() {
    const model = lessonModel, sc = model.scenario;
    const spec = sensorFor(sc.format, sc.iso, sc.sensor).spec;
    const progress = Number(el<HTMLInputElement>('scan-progress').value) / 100;
    const total = model.sensor.readoutS + sc.shutter, time = progress * total;
    const rows = 8;
    if (!el('row-demo').children.length) el('row-demo').replaceChildren(...Array.from({ length: rows }, (_, row) => {
      const line = document.createElement('div'); const window = rowWindow(row, rows, model.sensor.readoutS, sc.shutter);
      const status = time < window.start ? 'waiting' : time < window.end ? 'collecting' : 'read';
      line.className = `scan-row ${status}`;
      const label = document.createElement('span'); label.textContent = String(row + 1);
      const track = document.createElement('i'), exposure = document.createElement('b');
      exposure.style.left = `${100 * window.start / total}%`; exposure.style.width = `${100 * sc.shutter / total}%`;
      track.append(exposure); const state = document.createElement('span'); state.textContent = status;
      line.append(label, track, state); return line;
    }));
    Array.from(el('row-demo').children).forEach((node, row) => {
      const window = rowWindow(row, rows, model.sensor.readoutS, sc.shutter);
      const status = time < window.start ? 'waiting' : time < window.end ? 'collecting' : 'read';
      node.className = `scan-row ${status}`; node.lastElementChild!.textContent = status;
      const bar = node.querySelector('b')!; bar.style.left = `${100 * window.start / total}%`; bar.style.width = `${100 * sc.shutter / total}%`;
    });
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
    const adcText = `${Math.round(electrons).toLocaleString()} e− → ${analogGain(spec, sc.iso).toFixed(3)} DN/e− → ${code.toLocaleString()} DN${code === maxDn(spec) ? ' · ADC clipped' : ''}`;
    if (el('adc-value').textContent !== adcText) el('adc-value').textContent = adcText;
    el('charge-detail').textContent = `ISO ${sc.iso} · ${spec.bitDepth}-bit ADC · ${model.sensor.readNoiseE.toFixed(2)} e− RMS read noise. Conversion shown at zero sampled read noise, including black level and rounding. Full well: ${Math.round(model.sensor.fullWellE).toLocaleString()} e−. The pixel view shows stochastic noise.`;
    drawReadout(el<HTMLCanvasElement>('readout-visual'), time, model.sensor.readoutS, sc.shutter, fraction, code, spec.bitDepth);
  }
  function paintAnimation() {
    if (mode === 'readout') { el<HTMLInputElement>('scan-progress').value = String(100 * animationTime / duration()); paintReadout(); }
    else {
      const step = Math.min(4, Math.floor(animationTime / 3000));
      el<HTMLSelectElement>('pipeline-stage').value = PIPELINE[step][0];
      el<HTMLInputElement>('pipeline-progress').value = String(1000 * animationTime / duration());
      el('pipeline-progress').setAttribute('aria-valuetext', `${PIPELINE[step][1]}, ${Math.round(100 * animationTime / duration())} percent through the journey`);
      paintPipeline(rendered(), Math.min(1, (animationTime - step * 3000) / 1000));
    }
  }
  function animate(now: number) {
    if (!animating) return;
    if (document.hidden || lesson.hidden || document.querySelector('dialog[open]')) { pauseLesson(); return; }
    // A frame timestamp can precede the click's performance.now() within the same refresh interval.
    animationTime = Math.min(duration(), animationTime + Math.max(0, Math.min(100, now - lastFrame))); lastFrame = now;
    paintAnimation();
    if (animationTime >= duration()) pauseLesson(); else animation = requestAnimationFrame(animate);
  }
  function refresh() {
    if (lesson.hidden) return;
    const view = rendered();
    el<HTMLButtonElement>('lesson-play').disabled = mode === 'pipeline' && !view;
    el('lesson-shot').textContent = view ? `Same shot · ${view.scenario.lens} · f/${view.scenario.fno} · ISO ${view.scenario.iso}` : 'Updating your shot…';
    if (mode === 'pipeline') paintPipeline(view); else paintReadout();
  }
  function hideLesson(restore = false) {
    pauseLesson();
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
    pauseLesson();
    emit('pause-exposure', {});
    if (lesson.hidden) {
      returnState = { piece: store.get().piece, cameraPart: store.get().cameraPart };
      lessonOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    el('lesson-close').textContent = '← ' + ({ camera: 'Camera', lens: 'Optics', cone: 'Focus', loupe: 'Pixel' }[returnState?.piece ?? 'camera']);
    mode = nextMode; animationTime = 0; pauseLesson(); lesson.hidden = false; el('view').classList.add('show-lesson');
    el('lesson-timing').textContent = mode === 'readout' ? 'Playback scaled · actual time in ms' : 'Stored buffers · illustrative wipe';
    lesson.scrollTop = 0;
    for (const child of Array.from(el('view').children)) if (child !== lesson) (child as HTMLElement).inert = true;
    el('readout-lesson').hidden = mode !== 'readout'; el('pipeline-lesson').hidden = mode !== 'pipeline';
    el('lesson-readout').setAttribute('aria-pressed', String(mode === 'readout'));
    el('lesson-pipeline').setAttribute('aria-pressed', String(mode === 'pipeline'));
    el('lesson-title').textContent = mode === 'readout' ? 'Read the sensor' : 'From raw to photo';
    if (mode === 'pipeline') {
      animationTime = PIPELINE.findIndex(([id]) => id === el<HTMLSelectElement>('pipeline-stage').value) * 3000 + 1000;
      paintAnimation();
    }
    refresh();
  }
  function go(next: number) {
    index = Math.max(0, Math.min(TOUR.length - 1, next)); const stop = TOUR[index];
    entering = true; hideLesson(); store.setPiece(stop.piece); store.setCameraPart(stop.part); entering = false;
    if (stop.lesson) openLesson(stop.lesson);
    el<HTMLSelectElement>('journey-stop').value = String(index);
    el('journey-text').textContent = stop.text; el('journey-caption').textContent = stop.text; el('journey-more-text').textContent = stop.text;
    el<HTMLDetailsElement>('journey-more').open = !phone.matches;
    el<HTMLDetailsElement>('journey-physics').open = false;
    showInsights();
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
  function pickStage(stage: PipelineStage) {
    pause(); pauseLesson(); el<HTMLSelectElement>('pipeline-stage').value = stage;
    animationTime = PIPELINE.findIndex(([id]) => id === stage) * 3000 + 1000;
    paintAnimation();
  }
  el('pipeline-stage').onchange = () => pickStage(el<HTMLSelectElement>('pipeline-stage').value as PipelineStage);
  for (const button of el('pipeline-route').querySelectorAll('button')) button.onclick = () => pickStage(button.dataset.stage as PipelineStage);
  el('pipeline-canvas').onclick=event=>{
    const box=el('pipeline-canvas').getBoundingClientRect();
    sampleX=(event.clientX-box.left)/box.width;sampleY=(event.clientY-box.top)/box.height;
    pause();pauseLesson();paintAnimation();
  };
  el('pipeline-canvas').onkeydown=event=>{
    const view=rendered();if(!view||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    if(event.key==='Enter'||event.key===' '){sampleX=.5;sampleY=.5;}
    else {sampleX=Math.max(0,Math.min(1,sampleX+(event.key==='ArrowLeft'?-4:event.key==='ArrowRight'?4:0)/view.width));sampleY=Math.max(0,Math.min(1,sampleY+(event.key==='ArrowUp'?-4:event.key==='ArrowDown'?4:0)/view.height));}
    pause();pauseLesson();paintAnimation();
  };
  el('pipeline-center').onclick=()=>{sampleX=.5;sampleY=.5;pause();pauseLesson();paintAnimation();};
  for (const id of ['scan-progress', 'charge-level']) el(id).oninput = () => { pause(); pauseLesson(); paintReadout(); };
  el('pipeline-progress').oninput = () => { pause(); pauseLesson(); animationTime = Number(el<HTMLInputElement>('pipeline-progress').value) * 15; paintAnimation(); };
  el('lesson-play').onclick = () => {
    pause(); if (animating) { pauseLesson(); return; }
    if (mode === 'readout') animationTime = Number(el<HTMLInputElement>('scan-progress').value) * 80;
    if (animationTime >= duration()) animationTime = 0;
    animating = true; lastFrame = performance.now(); el('lesson-play').textContent = 'Pause'; animation = requestAnimationFrame(animate);
  };
  el('lesson-replay').onclick = () => { pause(); pauseLesson(); animationTime = 0; paintAnimation(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); pauseLesson(); } });
  window.addEventListener('resize', () => { if (!lesson.hidden && mode === 'readout') paintReadout(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!lesson.hidden) { event.stopImmediatePropagation(); closeLesson(); }
    else if (!journey.hidden) { event.stopImmediatePropagation(); closeTour(); }
  }, true);
  let previous = store.get();
  store.subscribe(state => {
    if (!entering && state !== previous) {
      pause(); pauseLesson();
      if (state.piece !== previous.piece || state.cameraPart !== previous.cameraPart) hideLesson();
      if (!journey.hidden && (state.piece !== previous.piece || state.cameraPart !== previous.cameraPart)) {
        const text = 'Exploring freely. Next returns to the guided journey; Restart begins at the scene.';
        el('journey-text').textContent = text; el('journey-caption').textContent = text; el('journey-more-text').textContent = text;
        el<HTMLDetailsElement>('journey-more').open = !phone.matches;
      }
    }
    previous = state; lessonModel = compute(state.scenario); showInsights(); refresh();
  });
  onRender(refresh);
  onRenderFailure(refresh);
  if (startTour) begin();
  else if (startLesson === 'readout' || startLesson === 'pipeline') openLesson(startLesson);
}
