// Frame-exact capture of the site on a virtual clock, adapted from the Intelligence Factory reel kit
// (~/Videos/intelligence-factory/capture/vt.mjs, projects-13). performance.now, Date.now, rAF, timers and CSS animations
// advance only when we say so, and every frame is a GPU screenshot, so the output is a smooth 30 fps however slow the
// capture runs. WebGPU needs --enable-unsafe-webgpu headless and a secure origin (http://127.0.0.1 counts).
//
//   import { open, record, encode } from './vt.mjs'
//   const vt = await open('169', { url: 'http://127.0.0.1:47501/?piece=lens' })
//   const { dir } = await record(vt, 'lens', { frames: 150, onFrame: (i) => vt.page.evaluate(i => p2p.set({ fno: ... }), i) })
//   encode(dir, 'recordings/lens.mp4')
import { createRequire } from 'module';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'package.json'));
const { chromium } = require('playwright');

// ffmpeg: the FFMPEG environment variable, else whatever `ffmpeg` is on the PATH
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const OUT = resolve(ROOT, 'recordings');

export const RATIOS = {
  '169': { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  '169hd': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export const GPU_ARGS = ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'];

// Injected before any page script runs.
function shim() {
  let now = 0;
  const wallStart = Date.now(), realRAF = window.requestAnimationFrame.bind(window), realST = window.setTimeout.bind(window);
  const timers = new Map(); let tid = 1;
  const rafs = new Map(); let rid = 1;
  const seen = new WeakMap();
  performance.now = () => now;
  Date.now = () => wallStart + now;
  const add = (fn, ms, every, args) => { const id = tid++; timers.set(id, { t: now + Math.max(0, +ms || 0), fn, every, args }); return id; };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, 0, args);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, Math.max(1, +ms || 1), args);
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = fn => { const id = rid++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };
  const call = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : (0, eval)(fn); } catch (e) { console.error('vt: ' + (e && e.stack || e)); } };
  function seekAnimations() {
    for (const a of document.getAnimations()) {
      let s = seen.get(a);
      if (s == null) { s = now - (a.currentTime || 0); seen.set(a, s); try { a.pause(); } catch { /* already gone */ } }
      try { a.currentTime = now - s; } catch { /* cancelled */ }
    }
  }
  window.__vt = {
    get now() { return now; },
    // Run every timer due within ms (in order), then one animation frame at the new time.
    async advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let best = null;
        for (const [id, t] of timers) if (t.t <= end && (!best || t.t < best[1].t)) best = [id, t];
        if (!best) break;
        const [id, t] = best;
        now = Math.max(now, t.t);
        if (t.every) t.t += t.every; else timers.delete(id);
        call(t.fn, t.args);
        await new Promise(r => realST(r, 0));
      }
      now = end;
      seekAnimations();
      const batch = [...rafs.values()]; rafs.clear();
      for (const f of batch) call(f, [now]);
      // WebGPU submits asynchronously: wait for the queue, then for the compositor to present what this frame drew
      if (window.p2p && window.p2p.gpuIdle) { try { await window.p2p.gpuIdle(); } catch { /* no device yet */ } }
      await new Promise(r => realRAF(() => r()));
      return true;
    },
  };
}

// channel 'chrome' (the installed Google Chrome): Playwright's bundled Chromium finds the adapter but requestDevice fails
// on this machine (Dawn: "dxil.dll Windows Error 87"), and Three.js then falls back to WebGL2 with only a warning.
export async function open(ratio, { url, virtual = true, headless = true, channel = 'chrome' } = {}) {
  const browser = await chromium.launch({ headless, channel, args: GPU_ARGS });
  const ctx = await browser.newContext({ ...RATIOS[ratio], colorScheme: 'dark', reducedMotion: 'no-preference' });
  if (virtual) await ctx.addInitScript(shim);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  const vt = {
    page, errors, browser,
    advance: ms => page.evaluate(ms => window.__vt.advance(ms), ms),
    async until(f, { step = 50, max = 60000, arg } = {}) {
      for (let t = 0; t < max; t += step) { if (await page.evaluate(f, arg)) return true; if (virtual) await vt.advance(step); else await page.waitForTimeout(step); }
      throw new Error('vt.until timed out: ' + f);
    },
    async wait(ms, step = 50) { for (let t = 0; t < ms; t += step) { if (virtual) await vt.advance(step); else await page.waitForTimeout(step); } },
  };
  return vt;
}

// Record frames at `fps` of virtual time. onFrame(i, seconds) runs before each frame (settings changes, taps, drags).
export async function record(vt, name, { frames = 90, fps = 30, onFrame, clip } = {}) {
  const dir = `${OUT}/frames/${name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const dt = 1000 / fps;
  for (let f = 0; f < frames; f++) {
    if (onFrame) await onFrame(f, f / fps);
    await vt.advance(dt);
    await vt.page.screenshot({ path: `${dir}/${String(f).padStart(5, '0')}.png`, scale: 'device', animations: 'allow', caret: 'initial', clip });
  }
  return { dir, frames, fps };
}

// Encode a frame folder to H.264, then delete the frames (disk is tight: 6.6 GB free on 09/28/2026).
export function encode(dir, file, { fps = 30, scale = null, keepFrames = false } = {}) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const vf = [`fps=${fps}`];
  if (scale) vf.push(`scale=${scale}:flags=lanczos`);
  vf.push('format=yuv420p');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`,
    '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-movflags', '+faststart', '-an', file];
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
  if (!keepFrames && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return file;
}
