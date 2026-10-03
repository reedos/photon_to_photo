import * as THREE from 'three/webgpu';
import { BlendedLineMaterial } from './blended-line-material';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { PieceContext } from './types';
import { clippedTrail, prepareTrail, type Trail } from './trace-playback';
import { ribbonTrail } from './light-ribbon';

/** A teaching overlay on the traced geometry, not another optical model. Travel is deliberately time-scaled. */
export function lightPlayback(ctx: PieceContext, owner: THREE.Group, label: string, layer = 0) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6)); geometry.setColors(new Float32Array(6));
  const material = new BlendedLineMaterial({ vertexColors: true, linewidth: 2.4, transparent: true, opacity: .95, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new LineSegments2(geometry, material);
  mesh.name = 'animated-traced-light'; mesh.frustumCulled = false; mesh.renderOrder = 12; mesh.layers.set(layer); mesh.visible = false;
  owner.add(mesh);
  // Four bounded draws: soft halo, tapered ribbon, crisp core and a short moving head.
  // Normal alpha blending preserves wavelength hues rather than bleaching them additively.
  const haloMaterial = new BlendedLineMaterial({ vertexColors:true, linewidth:16, transparent:true, opacity:.07, depthTest:false, depthWrite:false, toneMapped:false });
  const halo = new LineSegments2(geometry,haloMaterial);
  halo.name='animated-traced-light-halo';halo.frustumCulled=false;halo.renderOrder=10.5;halo.layers.set(layer);halo.visible=false;owner.add(halo);
  const ribbonMaterial = new BlendedLineMaterial({vertexColors:true,linewidth:6,transparent:true,opacity:.34,depthTest:false,depthWrite:false,toneMapped:false});
  const ribbon = new LineSegments2(geometry,ribbonMaterial);
  ribbon.name='animated-traced-light-ribbon';ribbon.frustumCulled=false;ribbon.renderOrder=11;ribbon.layers.set(layer);ribbon.visible=false;owner.add(ribbon);
  const headGeometry = new LineSegmentsGeometry();headGeometry.setPositions(new Float32Array(6));headGeometry.setColors(new Float32Array(6));
  const headMaterial = new BlendedLineMaterial({vertexColors:true,linewidth:3.8,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
  const head = new LineSegments2(headGeometry,headMaterial);
  head.name='animated-traced-light-head';head.frustumCulled=false;head.renderOrder=13;head.layers.set(layer);head.visible=false;owner.add(head);
  const bar = document.createElement('div'); bar.className = 'light-playback'; bar.hidden = true;
  bar.innerHTML = `<button class="btn" type="button" aria-pressed="false">▶ Play light</button><label><span class="playback-caption">${label}<small>Illustrative time · drag to inspect</small></span><input type="range" min="0" max="1000" value="0" aria-label="Light travel progress"></label><span>Computed paths<br>Slowed to reveal the journey</span>`;
  document.getElementById('model-experiments')!.before(bar);
  const button = bar.querySelector('button')!, range = bar.querySelector('input')!;
  let paths: { trail: Trail; color: THREE.Color; nm: number }[] = [], elapsed = 0, playing = false;
  let lastPaintMs = 0, lastSegments = 0, lastHeadSegments = 0;
  const duration = 6000;
  function paint() {
    const began = performance.now();
    const p: number[] = [], c: number[] = [], hp: number[] = [], hc: number[] = [];
    for (const { trail, color } of paths) {
      for (const { a, b, startWeight, endWeight } of ribbonTrail(trail, elapsed / duration)) {
        p.push(...a, ...b);
        c.push(color.r*startWeight,color.g*startWeight,color.b*startWeight,color.r*endWeight,color.g*endWeight,color.b*endWeight);
      }
      for (const [a,b] of clippedTrail(trail, Math.max(0,elapsed/duration-.025),elapsed/duration)) {
        hp.push(...a,...b);hc.push(color.r,color.g,color.b,color.r,color.g,color.b);
      }
    }
    mesh.visible = halo.visible = ribbon.visible = p.length > 0;
    head.visible = hp.length > 0;
    if (p.length) {
      const position = geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      const color = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
      position.data.array.set(p); color.data.array.set(c);
      position.data.needsUpdate = true; color.data.needsUpdate = true;
      geometry.instanceCount = p.length / 6;
    }
    if (hp.length) {
      const position=headGeometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      const color=headGeometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
      position.data.array.set(hp);color.data.array.set(hc);
      position.data.needsUpdate=true;color.data.needsUpdate=true;headGeometry.instanceCount=hp.length/6;
    }
    lastSegments=p.length/6;lastHeadSegments=hp.length/6;lastPaintMs=performance.now()-began;
    range.value = String(Math.round(1000 * elapsed / duration));
    range.setAttribute('aria-valuetext', `${Math.round(100 * elapsed / duration)} percent along the displayed paths; timing is illustrative`);
  }
  function pause() { playing = false; button.setAttribute('aria-pressed', 'false'); button.textContent = elapsed >= duration ? '↻ Replay light' : elapsed > 0 ? '▶ Resume light' : '▶ Play light'; }
  button.onclick = () => {
    if (playing) pause();
    else { if (elapsed >= duration) elapsed = 0; playing = true; button.textContent = 'Ⅱ Pause light'; button.setAttribute('aria-pressed', 'true'); }
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
        .map(s => ({ trail: prepareTrail(s.world), color: ctx.look.wavelengthToThreeColor(s.nm), nm:s.nm }))
        .sort((a,b)=>Math.abs(b.nm-500)-Math.abs(a.nm-500));
      const capacity = Math.max(1, paths.reduce((n, p) => n + p.trail.points.length - 1, 0));
      geometry.setPositions(new Float32Array(capacity * 6)); geometry.setColors(new Float32Array(capacity * 6));
      headGeometry.setPositions(new Float32Array(capacity*6));headGeometry.setColors(new Float32Array(capacity*6));
      elapsed = 0; pause(); paint();
    },
    tick(dt: number) {
      if (!playing || document.hidden || ctx.renderer.domElement.inert || document.querySelector('dialog[open]')) { if (playing) pause(); return; }
      elapsed = Math.min(duration, elapsed + Math.max(0,Math.min(dt, 100))); paint(); if (elapsed === duration) pause();
    },
    activate() { bar.hidden = false; },
    deactivate() { pause(); bar.hidden = true; },
    state: () => ({ playing, progress: elapsed / duration, paths: paths.length, segments:lastSegments, headSegments:lastHeadSegments, lastPaintMs, draws:4 }),
    probe: () => ({ paths:paths.map(p=>({nm:p.nm,world:p.trail.points})),
      positions:Array.from((geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array).slice(0,lastSegments*6),
      heads:Array.from((headGeometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data.array).slice(0,lastHeadSegments*6) }),
    dispose() { off(); document.removeEventListener('visibilitychange', onHidden); bar.remove(); geometry.dispose();headGeometry.dispose();material.dispose();haloMaterial.dispose();ribbonMaterial.dispose();headMaterial.dispose(); },
  };
}
