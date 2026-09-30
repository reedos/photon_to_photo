// Screen recordings of a set piece, frame-exact on the virtual clock (tools/vt.mjs), plus a contact sheet the critic
// can read (agents cannot watch video).
//
//   node tools/record.mjs tools/choreo/lens.mjs [--base http://127.0.0.1:47501/] [--ratio 169|169hd|phone] [--name lens]
//
// A choreography module exports:
//   export const query = 'piece=lens&lens=p50&fno=1.4'   // URL query for the start state
//   export const seconds = 8                               // clip length
//   export async function setup(vt) {}                     // optional: anything before frame 0 (camera, pins)
//   export async function frame(vt, t, i) {}               // called before each frame; t in seconds
// Inside frame(), drive the page through window.p2p with synchronous calls (vt.page.evaluate(() => p2p.set({...})))
// and never await a page promise that needs rAF or timers: the page's clock only moves when vt advances it, so such
// an await deadlocks. Output: recordings/<name>.mp4 and recordings/<name>-sheet.png (12 frames).
import { open, record, encode, FFMPEG } from './vt.mjs';
import { spawnSync } from 'child_process';
import { resolve, basename } from 'path';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const choreoPath = args.find((a) => a.endsWith('.mjs'));
if (!choreoPath) { console.error('usage: node tools/record.mjs tools/choreo/<piece>.mjs [--base URL] [--ratio 169] [--name N]'); process.exit(2); }
const choreo = await import(pathToFileURL(resolve(choreoPath)).href);
const base = opt('--base', 'http://127.0.0.1:47501/');
const ratio = opt('--ratio', '169');
const name = opt('--name', basename(choreoPath, '.mjs') + (ratio === '169' ? '' : '-' + ratio));
const fps = 30;
const frames = Math.round((choreo.seconds ?? 6) * fps);

const vt = await open(ratio, { url: `${base}?${choreo.query ?? ''}` });
// Wait on synchronous state only. Never await a page promise that needs rAF or timers (e.g. p2p.settle()) inside
// page.evaluate under the virtual clock: nothing advances while Node waits, so it deadlocks (Intelligence Factory
// reels, 09/27). Poll, and let vt.until advance the clock between polls.
await vt.until(() => !!(window.p2p && typeof window.p2p.backend === 'function' && window.p2p.backend()), { max: 120000 });
const backend = await vt.page.evaluate(() => window.p2p.backend());
if (backend !== 'webgpu') throw new Error(`record: backend is ${backend}, not webgpu`);
if (choreo.setup) await choreo.setup(vt);
await vt.wait(300);
const t0 = Date.now();
const { dir } = await record(vt, name, { frames, fps, onFrame: (i, t) => choreo.frame ? choreo.frame(vt, t, i) : null });
if (vt.errors.length) console.warn('page errors:', vt.errors.slice(0, 5));
await vt.browser.close();

const mp4 = resolve('recordings', `${name}.mp4`);
// contact sheet first (needs the frames), then the video (encode deletes the frames)
const sheet = resolve('recordings', `${name}-sheet.png`);
const step = Math.max(1, Math.floor(frames / 12));
const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`,
  '-vf', `select='not(mod(n\\,${step}))',scale=640:-1,tile=4x3:padding=6:color=black`, '-frames:v', '1', sheet], { encoding: 'utf8' });
if (r.status !== 0) console.warn('contact sheet failed:', r.stderr);
encode(dir, mp4, { fps });
console.log(JSON.stringify({ mp4, sheet, frames, seconds: frames / fps, backend, captureSec: Math.round((Date.now() - t0) / 1000), errors: vt.errors.length }));
