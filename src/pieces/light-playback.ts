import * as THREE from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { PieceContext } from './types';
import { clippedTrail, prepareTrail, type Trail } from './trace-playback';

/** A teaching overlay on the traced geometry, not another optical model. Travel is deliberately time-scaled. */
export function lightPlayback(ctx: PieceContext, owner: THREE.Group, label: string, layer = 0) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6)); geometry.setColors(new Float32Array(6));
  const material = new THREE.Line2NodeMaterial({ vertexColors: true, linewidth: 4, transparent: true, opacity: .92, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new LineSegments2(geometry, material);
  mesh.name = 'animated-traced-light'; mesh.frustumCulled = false; mesh.renderOrder = 12; mesh.layers.set(layer); mesh.visible = false;
  owner.add(mesh);
  // A wider, dimmer copy gives moving light the same layered glow as the shot player.
  // Both draws share the exact traced geometry and wavelength colors.
  const haloMaterial = new THREE.Line2NodeMaterial({ vertexColors:true, linewidth:12, transparent:true, opacity:.16, depthTest:false, depthWrite:false, toneMapped:false });
  const halo = new LineSegments2(geometry,haloMaterial);
  halo.name='animated-traced-light-halo';halo.frustumCulled=false;halo.renderOrder=11;halo.layers.set(layer);halo.visible=false;owner.add(halo);
  const bar = document.createElement('div'); bar.className = 'light-playback'; bar.hidden = true;
  bar.innerHTML = `<button class="btn" type="button">Animate light</button><label>${label}<input type="range" min="0" max="1000" value="0" aria-label="Light travel progress"></label><span>Traced paths · illustrative timing</span>`;
  document.getElementById('studio-exposure')!.before(bar);
  const button = bar.querySelector('button')!, range = bar.querySelector('input')!;
  let paths: { trail: Trail; color: THREE.Color }[] = [], elapsed = 0, playing = false;
  const duration = 6000;
  function paint() {
    const p: number[] = [], c: number[] = [];
    for (const { trail, color } of paths) {
      const segments = clippedTrail(trail, Math.max(0, elapsed / duration - .12), elapsed / duration);
      for (const [a, b] of segments) {
        p.push(...a, ...b); c.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }
    mesh.visible = halo.visible = p.length > 0;
    if (p.length) {
      const position = geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      const color = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
      position.data.array.set(p); color.data.array.set(c);
      position.data.needsUpdate = true; color.data.needsUpdate = true;
      geometry.instanceCount = p.length / 6;
    }
    range.value = String(Math.round(1000 * elapsed / duration));
    range.setAttribute('aria-valuetext', `${Math.round(100 * elapsed / duration)} percent along the displayed paths; timing is illustrative`);
  }
  function pause() { playing = false; button.textContent = elapsed >= duration ? 'Replay light' : elapsed > 0 ? 'Resume light' : 'Animate light'; }
  button.onclick = () => {
    if (playing) pause();
    else { if (elapsed >= duration) elapsed = 0; playing = true; button.textContent = 'Pause light'; }
  };
  range.oninput = () => { elapsed = Number(range.value) / 1000 * duration; pause(); paint(); };
  const onHidden = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', onHidden);
  const off = ctx.bus.on('pause-exposure', pause);
  return {
    update(samples: { world: [number, number, number][]; nm: number }[]) {
      // Uniform selection preserves both field and wavelength diversity without animating thousands of meshes.
      const stride = Math.max(1, Math.ceil(samples.length / 96));
      paths = samples.filter((_, i) => i % stride === 0).filter(s => s.world.length > 1)
        .map(s => ({ trail: prepareTrail(s.world), color: ctx.look.wavelengthToThreeColor(s.nm) }));
      const capacity = Math.max(1, paths.reduce((n, p) => n + p.trail.points.length - 1, 0));
      geometry.setPositions(new Float32Array(capacity * 6)); geometry.setColors(new Float32Array(capacity * 6));
      elapsed = 0; pause(); paint();
    },
    tick(dt: number) {
      if (!playing || document.hidden || ctx.renderer.domElement.inert || document.querySelector('dialog[open]')) { if (playing) pause(); return; }
      elapsed = Math.min(duration, elapsed + Math.max(0,Math.min(dt, 100))); paint(); if (elapsed === duration) pause();
    },
    activate() { bar.hidden = false; },
    deactivate() { pause(); bar.hidden = true; },
    state: () => ({ playing, progress: elapsed / duration, paths: paths.length }),
    dispose() { off(); document.removeEventListener('visibilitychange', onHidden); bar.remove(); geometry.dispose(); material.dispose(); haloMaterial.dispose(); },
  };
}
