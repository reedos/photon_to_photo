import type { Model } from '../engine/model-types';
import { compute } from './engine-api';
import { apertureSteps } from './stops';
import { fmtFno, fmtNum, fmtShutter } from './units';
import { wavelengthColor } from '../engine/spectrum';
import { srgbEncode } from '../engine/color';
import { dimReference, rainExperiment, rainSnapshot, RAIN_DURATION, type RainExperiment } from './photon-rain-model';
import '../styles/photon-rain.css';

/** A local experiment: never writes to the workspace or claims to recover a real photograph's photons. */
export function createPhotonRain() {
  const dialog = document.createElement('dialog'); dialog.id = 'photon-rain'; dialog.setAttribute('aria-labelledby', 'rain-title');
  dialog.innerHTML = `<header><div><p class="rain-kicker">A controlled 18% gray experiment</p><h2 id="rain-title">Same light. Unequal arrivals.</h2></div><button class="btn" data-rain="close" autofocus>Close</button></header>
    <p class="rain-intro">Watch eight equally lit pixels catch individual photons. Their counts differ even before the camera adds read noise.</p>
    <div class="rain-controls"><label>Aperture<select data-rain="aperture"></select></label><label>Shutter<select data-rain="shutter"></select></label><label>Reference light<select data-rain="light"></select></label><button class="btn" data-rain="compare">16× more light</button></div>
    <div class="rain-transport"><button class="btn" data-rain="play">Play exposure</button><button class="btn" data-rain="new">New exposure</button><button class="btn rain-mobile-close" data-rain="mobile-close">Close</button><label>Exposure progress<input data-rain="time" type="range" min="0" max="1000" step="1" value="0"></label><output data-rain="clock"></output></div>
    <div class="rain-tabs" aria-label="Experiment view"><button class="btn" data-rain="arrivals-tab" aria-pressed="true">Arrivals</button><button class="btn" data-rain="noise-tab" aria-pressed="false">Noise & counts</button></div>
    <div class="rain-main"><section class="rain-arrivals-panel"><div class="rain-section-title"><h3>Photons arriving</h3><span>1 dot = 1 photon</span></div><canvas data-rain="rain" role="img" aria-label="Wavelength-colored photons arriving at eight identical pixels"></canvas><div class="rain-scale" data-rain="scale"></div></section>
    <section class="rain-noise-panel"><div class="rain-section-title"><h3>256 equally lit pixels</h3><span>One exposure</span></div><canvas data-rain="noise" role="img" aria-label="Sampled pixel counts and their expected Poisson distribution"></canvas><p class="rain-grid-note">Tile brightness is normalized to the expected mean. This is photon-count variation, not a photograph.</p></section></div>
    <div class="rain-stats" data-rain="stats" aria-live="off"></div>
    <p class="rain-takeaway" data-rain="takeaway" role="status"></p>
    <details><summary>What is modeled?</summary><p>The current lens, aperture, shutter and sensor start this separate experiment. Reference lighting is deliberately dimmed to about six expected incident photons per pixel. Controls here leave your workspace unchanged. All pixels see the same on-axis 18% gray surface. Seeded Poisson draws and uniform arrival times model independent photons; replaying a scrubbed exposure repeats the same sample.</p><p>Wavelength hues come from the engine's daylight spectrum and color conversion, with brightness normalized so every counted photon remains visible. Positions, flight paths and travel time are illustrative. Counts are incident photons before color filtering or quantum efficiency; read noise, dark current, fixed-pattern noise and clipping are excluded. ISO does not create photons. The orange curve is the expected Poisson distribution; teal bars show this sample.</p></details>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-rain="${name}"]`)!;
  const rainCanvas = el<HTMLCanvasElement>('rain'), noiseCanvas = el<HTMLCanvasElement>('noise');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const shutterFactors = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8], lightFactors = [.25, .5, 1, 2, 4, 8, 16];
  let base: Model, model: Model, experiment: RainExperiment, seed = 37, time = 0, playing = false, raf = 0, last = 0;
  let opener: HTMLElement | null = null, apertures: number[] = [];
  const colors = new Map<number, string>();
  const color = (nm: number) => { if (!colors.has(nm)) { const linear=wavelengthColor(nm).linear, peak=Math.max(...linear,1e-30); colors.set(nm, `rgb(${linear.map(value => Math.round(255 * srgbEncode(value/peak))).join(' ')})`); } return colors.get(nm)!; };
  function setup(canvas: HTMLCanvasElement) {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight), ratio = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const ctx = canvas.getContext('2d')!; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }
  function draw() {
    if (!experiment || !dialog.open) return;
    const progress = time / RAIN_DURATION, snapshot = rainSnapshot(experiment, progress);
    const { ctx, width: w, height: h } = setup(rainCanvas), gap = (w - 24) / 8, floor = h - 52;
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#07111c'); bg.addColorStop(1, '#152d39'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#355464'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const x = 12 + gap * (i + .5), count = snapshot.counts[i];
      ctx.fillStyle = '#0a1a22'; ctx.fillRect(x - gap * .44, floor, gap * .88, 27);
      const recent = experiment.visible[i].some(a => progress >= a.at && progress - a.at < .025);
      ctx.strokeStyle = recent ? '#b6ffde' : '#447782'; ctx.strokeRect(x - gap * .44, floor, gap * .88, 27);
      ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#d9fff0'; ctx.fillText(String(count), x, floor + 18);
      ctx.font = '10px system-ui'; ctx.fillStyle = '#92acba'; ctx.fillText(String(i + 1), x, h - 8);
      for (const photon of experiment.visible[i]) {
        const remaining = (photon.at - progress) * RAIN_DURATION;
        if (remaining <= 0 || remaining > .75) continue;
        const fall = 1 - remaining / .75, px = x + photon.offset * gap * .56, y = 18 + fall * (floor - 23);
        ctx.strokeStyle = color(photon.nm); ctx.lineWidth = 1.5; ctx.globalAlpha = .72;
        ctx.beginPath(); ctx.moveTo(px, Math.max(12, y - 18)); ctx.lineTo(px, y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = color(photon.nm); ctx.shadowColor=color(photon.nm); ctx.shadowBlur=7; ctx.beginPath(); ctx.arc(px, y, 2.4, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur=0;
      }
    }
    ctx.textAlign = 'left'; ctx.font = '11px system-ui'; ctx.fillStyle = '#bdd2dd'; ctx.fillText('Equal light · hue brightness normalized', 12, 16);
    const chart = setup(noiseCanvas), n = chart.ctx, nw = chart.width, nh = chart.height;
    n.fillStyle = '#09151f'; n.fillRect(0, 0, nw, nh);
    const grid = Math.min(160, nh * .43), cell = grid / 16, gx = (nw - grid) / 2;
    snapshot.counts.forEach((count, i) => {
      const level = Math.round(255 * Math.min(1, snapshot.mean ? count / snapshot.mean * .42 : 0));
      n.fillStyle = `rgb(${level} ${level} ${level})`; n.fillRect(gx + i % 16 * cell, 4 + Math.floor(i / 16) * cell, cell - 1, cell - 1);
    });
    // Every histogram bucket spans the same integer number of possible counts. Fractional
    // bucket boundaries would alternate widths and invent a jagged expected curve.
    const left = 32, right = nw - 14, top = grid + 39, bottom = nh - 30, binWidth = Math.max(1, Math.ceil(snapshot.histogram.length / 40)), bins = Math.ceil(snapshot.histogram.length / binWidth);
    const observed = Array(bins).fill(0) as number[], expected = Array(bins).fill(0) as number[];
    snapshot.histogram.forEach((value, count) => { const b = Math.min(bins - 1, Math.floor(count / binWidth)); observed[b] += value; expected[b] += snapshot.expected[count] * 256; });
    const max = Math.max(1, ...observed, ...expected), step = (right - left) / bins;
    n.fillStyle = '#7ddfd0'; observed.forEach((value, i) => { const bar = value / max * (bottom - top); n.fillRect(left + i * step + 1, bottom - bar, Math.max(1, step - 2), bar); });
    n.strokeStyle = '#ffc47d'; n.lineWidth = 2; n.beginPath(); expected.forEach((value, i) => { const x = left + (i + .5) * step, y = bottom - value / max * (bottom - top); if (i) n.lineTo(x, y); else n.moveTo(x, y); }); n.stroke();
    n.fillStyle = '#c1d2dd'; n.font = '11px system-ui'; n.textAlign = 'left'; n.fillText('Pixels', 5, top - 10); n.fillText('0', left, bottom + 16); n.textAlign = 'right'; n.fillText(String(bins * binWidth - 1), right, bottom + 16); n.textAlign = 'center'; n.fillText('Photons collected per pixel', nw / 2, nh - 3);
    n.fillStyle = '#ffc47d'; n.fillText('Expected Poisson', nw / 2, grid + 23);
    el('stats').replaceChildren(...[[fmtNum(snapshot.mean, 1), 'expected photons / pixel'], [fmtNum(snapshot.observedMean, 1), 'sample mean'], [fmtNum(snapshot.sigma, 2), 'shot-noise σ (photons)'], [snapshot.relativeNoise == null ? '—' : `${fmtNum(snapshot.relativeNoise * 100, 1)}%`, 'relative shot noise']].map(([value, label]) => { const span = document.createElement('span'), b = document.createElement('b'); b.textContent = value; span.append(b, label); return span; }));
    el<HTMLInputElement>('time').value = String(Math.round(progress * 1000)); el('clock').textContent = `${Math.round(progress * 100)}%`;
    const timeScale = RAIN_DURATION / model.scenario.shutter;
    el('scale').textContent = `${fmtNum(experiment.mean / model.scenario.shutter, 1)} photons/s/pixel · ${fmtShutter(model.scenario.shutter)} shown in ${RAIN_DURATION} s · time ${timeScale >= 1 ? 'slowed' : 'sped up'} ${fmtNum(timeScale >= 1 ? timeScale : 1 / timeScale, 1)}× · paths schematic`;
    el('play').textContent = playing ? 'Pause' : time >= RAIN_DURATION ? 'Replay exposure' : 'Play exposure';
    dialog.dataset.mean = String(experiment.mean); dialog.dataset.progress = String(progress); dialog.dataset.playing = String(playing); dialog.dataset.seed = String(seed);
    noiseCanvas.setAttribute('aria-label', `256 equally illuminated pixels: ${fmtNum(snapshot.mean, 1)} expected photons each; ${fmtNum(snapshot.observedMean, 1)} observed mean. Relative shot noise ${snapshot.relativeNoise == null ? 'not yet defined' : fmtNum(snapshot.relativeNoise * 100, 1) + ' percent'}.`);
  }
  function pause() { playing = false; cancelAnimationFrame(raf); draw(); }
  function frame(now: number) { if (!dialog.open || !playing) return; time = Math.min(RAIN_DURATION, time + Math.min(.1, Math.max(0, (now - last) / 1000))); last = now; if (time === RAIN_DURATION) playing = false; draw(); if (playing) raf = requestAnimationFrame(frame); }
  function play() { if (time >= RAIN_DURATION) time = 0; playing = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); draw(); }
  function rebuild() {
    pause(); model = compute({ ...base.scenario, fno: Number(el<HTMLSelectElement>('aperture').value), shutter: Number(el<HTMLSelectElement>('shutter').value), lux: base.scenario.lux! * Number(el<HTMLSelectElement>('light').value) });
    experiment = rainExperiment(model, seed); time = reduced.matches ? RAIN_DURATION : 0;
    el('takeaway').textContent = `Equal light still gives unequal counts. Collecting 16× more photons cuts relative photon shot noise by 4×. This experiment leaves your photo unchanged.`;
    el('compare').textContent = Number(el<HTMLSelectElement>('light').value) === 16 ? 'Dim reference' : 'Bright reference · 16×';
    draw();
  }
  for (const name of ['aperture', 'shutter', 'light']) el(name).onchange = () => { const resume = playing; rebuild(); if (resume && !reduced.matches) play(); };
  el('compare').onclick = () => { el<HTMLSelectElement>('light').value = Number(el<HTMLSelectElement>('light').value) === 16 ? '1' : '16'; rebuild(); if (!reduced.matches) play(); };
  el('play').onclick = () => playing ? pause() : play();
  el('new').onclick = () => { seed++; rebuild(); if (!reduced.matches) play(); };
  el<HTMLInputElement>('time').oninput = () => { time = Number(el<HTMLInputElement>('time').value) / 1000 * RAIN_DURATION; pause(); };
  el('close').onclick = () => dialog.close();
  el('mobile-close').onclick = () => dialog.close();
  for (const [name, view] of [['arrivals-tab', 'arrivals'], ['noise-tab', 'noise']]) el(name).onclick = () => {
    dialog.dataset.view = view;
    el('arrivals-tab').setAttribute('aria-pressed', String(view === 'arrivals'));
    el('noise-tab').setAttribute('aria-pressed', String(view === 'noise'));
    draw();
  };
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => { pause(); if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true }); });
  const onHidden = () => { if (document.hidden) pause(); }, onReduced = () => { if (reduced.matches) pause(); };
  document.addEventListener('visibilitychange', onHidden); reduced.addEventListener('change', onReduced);
  const resize = new ResizeObserver(draw); resize.observe(rainCanvas); resize.observe(noiseCanvas);
  function options(name: string, values: number[], format: (value: number) => string, selected: number) {
    const select = el<HTMLSelectElement>(name); select.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = String(value); option.textContent = format(value); return option; })); select.value = String(selected);
  }
  return {
    open(source: Model, button: HTMLElement) {
      opener = button; base = dimReference(source); seed = 37; dialog.dataset.view = 'arrivals';
      el('arrivals-tab').setAttribute('aria-pressed', 'true'); el('noise-tab').setAttribute('aria-pressed', 'false');
      apertures = [...new Set([base.scenario.fno, ...apertureSteps(base.lens.maxFno).filter(value => value > base.scenario.fno)])];
      options('aperture', apertures, fmtFno, base.scenario.fno);
      options('shutter', [...new Set(shutterFactors.map(value => compute({ ...base.scenario, shutter: base.scenario.shutter * value }).scenario.shutter))], fmtShutter, base.scenario.shutter);
      options('light', lightFactors, value => `${(base.scenario.lux! * value).toLocaleString('en-US', { maximumSignificantDigits: 3 })} lux${value === 1 ? ' · dim reference' : ''}`, 1);
      if (!dialog.open) dialog.showModal(); rebuild(); if (!reduced.matches) play();
    },
    close() { if (dialog.open) dialog.close(); },
    dispose() { pause(); resize.disconnect(); document.removeEventListener('visibilitychange', onHidden); reduced.removeEventListener('change', onReduced); dialog.remove(); },
  };
}
