import type { Model } from '../engine/model-types';
import type { PieceContext } from './types';
import { diffractionDisplay, diffractionPattern, DIFFRACTION_GRID, DIFFRACTION_SIZE, type DiffractionPattern } from './diffraction-pattern';
import '../styles/diffraction.css';

/** A focused diffraction layer; geometric traces remain available in the parent view. */
export function diffractionView(ctx: PieceContext, id: string) {
  const launch = document.createElement('div'); launch.className = 'diffraction-launch'; launch.hidden = true;
  launch.innerHTML = '<button class="btn" type="button">Waves & diffraction</button><span>Why stopping down spreads a point across pixels</span>';
  document.getElementById('model-experiments')!.append(launch);
  const dialog = document.createElement('dialog'); dialog.className = 'diffraction-dialog'; dialog.id = `diffraction-${id}`;
  dialog.setAttribute('aria-labelledby', `${dialog.id}-title`);
  dialog.innerHTML = `<header><div><span class="diffraction-kicker">OPTICS · IDEAL CIRCULAR APERTURE</span><h2 id="${dialog.id}-title">A point becomes a pattern</h2></div><button class="btn diffraction-close" type="button">Close</button></header>
    <div class="diffraction-layout"><figure><div class="diffraction-plot"><canvas class="diffraction-pattern" width="408" height="408" role="img"></canvas><span class="diffraction-scale"></span><span class="diffraction-radius"></span></div><figcaption>1 square = 1 sensor pixel · fixed spatial scale<br>Brightness normalized · faint rings lifted (¼ power)</figcaption><canvas class="diffraction-waves" width="600" height="110" role="img" aria-label="Illustrative wavefronts passing through an aperture"></canvas><div class="diffraction-wave-controls"><button class="btn diffraction-play" type="button">Animate wavefronts</button><span>Motion schematic · not a full-wave simulation</span></div></figure>
    <aside><p class="diffraction-takeaway">A smaller aperture makes the diffraction pattern wider. Keep your eye on the first dark ring as you stop down.</p>
    <label>Aperture <output class="diffraction-fno"></output><input class="diffraction-aperture" type="range" min="1.8" max="22" step="0.01" aria-label="Diffraction aperture"></label>
    <label>Wavelength <output class="diffraction-nm">550 nm</output><input class="diffraction-wavelength" type="range" min="450" max="650" step="10" value="550" aria-label="Diffraction wavelength"></label>
    <p class="diffraction-control-note">Aperture updates the camera model. Wavelength is local to this view.</p>
    <div class="diffraction-modes" role="group" aria-label="Diffraction display"><button class="btn" type="button" data-mode="pattern" aria-pressed="true">Airy pattern</button><button class="btn" type="button" data-mode="pixels" aria-pressed="false">Collected by pixels</button></div>
    <label class="diffraction-ring"><input type="checkbox" checked> Mark first dark ring</label>
    <dl class="diffraction-stats"></dl>
    <details><summary>What is computed?</summary><p>The engine evaluates the Airy solution for a monochromatic point and an ideal circular pupil, using the current working f-number. Pixel values integrate that pattern over square pixels with 100% fill. Aberrations, blade shape and defocus are excluded here.</p><p>Radius to first dark ring ≈ 1.22 × wavelength × working f-number. Pattern brightness is normalized and raised to the ¼ power to reveal faint rings; it does not compare total light throughput. The pixel grid keeps its physical scale as aperture changes.</p></details>
    <p class="diffraction-evidence">Derived · engine Airy solution and pixel integration</p></aside></div>`;
  document.body.append(dialog);
  const find = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const canvas = find<HTMLCanvasElement>('.diffraction-pattern'), g = canvas.getContext('2d')!;
  const waves = find<HTMLCanvasElement>('.diffraction-waves'), waveContext = waves.getContext('2d')!;
  const aperture = find<HTMLInputElement>('.diffraction-aperture'), wavelength = find<HTMLInputElement>('.diffraction-wavelength');
  const ring = find<HTMLInputElement>('.diffraction-ring input'), play = find<HTMLButtonElement>('.diffraction-play');
  let model: Model | null = null, pattern: DiffractionPattern | null = null, key = '', mode = 'pattern', phase = 0, playing = false, active = false;
  let raf = 0, previous = 0, updateTimer = 0, apertureTimer = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function color() { const c = ctx.look.wavelengthToThreeColor(Number(wavelength.value)).convertLinearToSRGB(); return [c.r, c.g, c.b]; }
  function drawWaves() {
    if (!model) return;
    const c = waveContext, rgb = color().map(v => Math.round(v * 255)), hue = `rgb(${rgb.join(' ')})`;
    c.clearRect(0, 0, 600, 110); c.fillStyle = '#070d15'; c.fillRect(0, 0, 600, 110);
    const half = 42 * model.lens.maxFno / model.scenario.fno;
    c.fillStyle = '#4e6173'; c.fillRect(240, 0, 12, 55 - half); c.fillRect(240, 55 + half, 12, 55 - half);
    c.strokeStyle = hue; c.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) { const x = ((i / 7 + phase) % 1) * 230; c.globalAlpha = .25 + .65 * x / 230; c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 98); c.stroke(); }
    c.save(); c.beginPath(); c.rect(252, 0, 348, 110); c.clip();
    const spread = Math.min(.9, .10 * model.scenario.fno / model.lens.maxFno * Number(wavelength.value) / 550);
    for (let i = 0; i < 8; i++) { const radius = ((i / 8 + phase) % 1) * 390; c.globalAlpha = .7 * (1 - radius / 460); c.beginPath(); c.arc(246, 55, radius, -spread, spread); c.stroke(); }
    c.restore(); c.globalAlpha = 1;
  }
  function paint() {
    if (!pattern) return;
    const p = pattern, size = DIFFRACTION_SIZE, cell = size / DIFFRACTION_GRID, rgb = color();
    const image = g.createImageData(size, size);
    const maxCell = Math.max(...p.pixels.cells.map(c => c.fraction));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const energy = mode === 'pattern' ? p.intensity[i] : p.pixels.cells[Math.floor(y / cell) * DIFFRACTION_GRID + Math.floor(x / cell)].fraction / maxCell;
      const level = diffractionDisplay(energy);
      image.data[i * 4] = Math.round(4 + 251 * rgb[0] * level);
      image.data[i * 4 + 1] = Math.round(9 + 246 * rgb[1] * level);
      image.data[i * 4 + 2] = Math.round(15 + 240 * rgb[2] * level); image.data[i * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    g.strokeStyle = '#a7c8e32a'; g.lineWidth = .7; g.beginPath();
    for (let n = 0; n <= DIFFRACTION_GRID; n++) { const at = n * cell; g.moveTo(at, 0); g.lineTo(at, size); g.moveTo(0, at); g.lineTo(size, at); } g.stroke();
    if (ring.checked) { g.setLineDash([3, 4]); g.strokeStyle = '#f2f7ff'; g.lineWidth = 1; g.beginPath(); g.arc(size / 2, size / 2, p.radiusRaster, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]); }
    const center = p.centerFraction * 100;
    find('.diffraction-radius').textContent = `r ≈ ${(p.radiusMm * 1000).toFixed(2)} µm · ${p.radiusPx.toFixed(2)} pixels`;
    find('.diffraction-scale').textContent = `${(p.spanMm * 1000).toFixed(1)} µm across`;
    find('.diffraction-stats').innerHTML = `<div><dt>First dark ring · radius</dt><dd>${(p.radiusMm * 1000).toFixed(2)} µm <small>(${p.radiusPx.toFixed(2)} pixels)</small></dd></div><div><dt>Center pixel collects</dt><dd>${center.toFixed(1)}% <small>of total ideal PSF energy</small></dd></div><div><dt>Current sensor pitch</dt><dd>${(p.pitchMm * 1000).toFixed(2)} µm</dd></div><div><dt>Working f-number</dt><dd>f/${p.workingFno.toFixed(2)}</dd></div>`;
    canvas.setAttribute('aria-label', `${mode === 'pattern' ? 'Computed Airy pattern' : 'Integrated pixel energy'} at ${p.nm} nanometers, working f-number ${p.workingFno.toFixed(2)}. First dark ring radius ${(p.radiusMm * 1000).toFixed(2)} micrometers, ${p.radiusPx.toFixed(2)} sensor pixels. ${center.toFixed(1)} percent of total energy reaches the center pixel. Brightness normalized with fourth-root lift.`);
    dialog.dataset.mode = mode; drawWaves();
  }
  function refresh() {
    if (!model || !dialog.open) return;
    const next = `${model.focus.workingFno}:${model.sensor.pitchUm}:${wavelength.value}`;
    if (key !== next) { pattern = diffractionPattern(model, Number(wavelength.value)); key = next; }
    // A range's step is anchored at min. Patent apertures can have five decimals;
    // floor only the UI bound so standard values (f/8, f/16) remain keyboard-valid.
    // The shared engine still clamps the requested value to the exact physical limit.
    aperture.min = String(Math.floor(model.lens.maxFno * 100) / 100); aperture.value = String(model.scenario.fno);
    find('.diffraction-fno').textContent = `f/${model.scenario.fno.toFixed(1)}`;
    find('.diffraction-nm').textContent = `${wavelength.value} nm`;
    paint();
  }
  function pause() { playing = false; cancelAnimationFrame(raf); play.textContent = 'Animate wavefronts'; }
  function tick(now: number) {
    if (!dialog.open || document.hidden || !playing) { pause(); return; }
    phase = (phase + Math.max(0, Math.min(100, now - previous)) / 5000) % 1; previous = now;
    drawWaves(); raf = requestAnimationFrame(tick);
  }
  play.onclick = () => { if (playing) pause(); else { playing = true; previous = performance.now(); play.textContent = 'Pause wavefronts'; raf = requestAnimationFrame(tick); } };
  aperture.oninput = () => {
    const fno = Number(aperture.value);
    find('.diffraction-fno').textContent = `f/${fno.toFixed(1)}`;
    clearTimeout(apertureTimer); apertureTimer = window.setTimeout(() => ctx.bus.emit('scenario-set', { fno }), 60);
  };
  wavelength.oninput = () => { clearTimeout(updateTimer); updateTimer = window.setTimeout(refresh, 50); };
  ring.onchange = paint;
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.onclick = () => {
    mode = button.dataset.mode!;
    for (const peer of dialog.querySelectorAll('[data-mode]')) peer.setAttribute('aria-pressed', String(peer === button));
    paint();
  };
  const opener = launch.querySelector<HTMLButtonElement>('button')!;
  opener.onclick = () => { ctx.bus.emit('pause-exposure', {}); ctx.bus.emit('pause-tour', {}); dialog.showModal(); refresh(); };
  find<HTMLButtonElement>('.diffraction-close').onclick = () => dialog.close();
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('close', () => { pause(); clearTimeout(updateTimer); clearTimeout(apertureTimer); if (active) opener.focus({ preventScroll: true }); });
  const visibility = () => { if (document.hidden) pause(); };
  const motion = () => { if (reduced.matches) pause(); };
  document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', motion);
  return {
    update(next: Model) { model = next; refresh(); },
    activate() { active = true; launch.hidden = false; },
    deactivate() { active = false; launch.hidden = true; if (dialog.open) dialog.close(); },
    state() { return pattern ? { open: dialog.open, playing, mode, phase, nm: pattern.nm, workingFno: pattern.workingFno, pitchMm: pattern.pitchMm, radiusMm: pattern.radiusMm, radiusPx: pattern.radiusPx, radiusRaster: pattern.radiusRaster, spanMm: pattern.spanMm, centerFraction: pattern.centerFraction, size: DIFFRACTION_SIZE, grid: DIFFRACTION_GRID, cells: pattern.pixels.cells } : { open: false }; },
    dispose() { pause(); clearTimeout(updateTimer); clearTimeout(apertureTimer); launch.remove(); dialog.remove(); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', motion); },
  };
}

