// Runs every browser gate (tools/test-*.mjs and tools/accuracy/{cone,lens,loupe}.mjs) one after another against
// one shared dev server, then prints a summary table. Each gate's full output goes to shots/gates/<name>.log.
//
//   node tools/run-gates.mjs                      # starts a dev server on 127.0.0.1:47670
//   P2P_URL=http://127.0.0.1:47500/ node tools/run-gates.mjs   # use a server that is already running
//   node tools/run-gates.mjs --prod               # builds the app and serves that build (what ships), not the dev server
//   node tools/run-gates.mjs navigation selection # only gates whose name contains one of these words
//   P2P_GATE_TIMEOUT=600 node tools/run-gates.mjs # per-gate timeout in seconds (default 900)
//   node tools/run-gates.mjs --shard=2/8          # only the 2nd of 8 deterministic slices (or P2P_GATES_SHARD=2/8)
//
// --shard=i/N (1-based) deals the sorted gate list out round-robin, so gate k goes to shard (k mod N) + 1: every gate
// lands in exactly one shard and the N shards together run exactly the gates one unsharded run would. CI runs the
// shards as a parallel job matrix (.github/workflows/gates.yml) because the full serial run outlasts one job's timeout.
//
// Gates that build their own server (cone, lens, test-startup, test-runtime-reliability, ...) still do; the
// accuracy gates get P2P_PREVIEW_PORT=47671 so they don't collide with a preview on the default 47501.
// A failure is a failure: none is labelled environmental. A gate that cannot find a module (an agent worktree keeps
// node_modules in a parent folder) resolves it with createRequire instead, and a failure is rerun by hand before it is
// described as anything but a failure.
// Exit code: 0 when every selected gate passed, 1 otherwise.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender } from './check-glb-fresh.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.P2P_GATES_PORT) || 47670;
const TIMEOUT_S = Number(process.env.P2P_GATE_TIMEOUT) || 900;
// --prod (or P2P_GATES_PROD=1): the gates run against a production build. The dev server serves every stylesheet and
// module on its own, so a defect that only exists once the build joins them passes there (score loop r4: a missing brace
// in learning.css broke every later rule in the built CSS below 901 px; four gates failed on the build for three rounds
// and passed on the dev server, and the failures were called environmental).
const prod = process.argv.includes('--prod') || process.env.P2P_GATES_PROD === '1';
const shardArg = process.argv.find((a) => a.startsWith('--shard='))?.slice('--shard='.length) ?? process.env.P2P_GATES_SHARD;
const filters = process.argv.slice(2).filter((a) => a !== '--prod' && !a.startsWith('--shard='));
let shard = null;
if (shardArg) {
  const m = /^(\d+)\/(\d+)$/.exec(shardArg.trim());
  shard = m && { index: Number(m[1]), total: Number(m[2]) };
  if (!shard || shard.total < 1 || shard.index < 1 || shard.index > shard.total) {
    console.error(`run-gates: --shard must be i/N with 1 <= i <= N, got "${shardArg}"`);
    process.exit(2);
  }
}

// The shipped body GLBs must match a fresh build of their Blender scripts (score loop r6, 10/11/2026: both were stale for
// two rounds because the check was opt-in). It rebuilds both bodies, about 40 s, so it needs Blender; without Blender it is
// left out and says so. A script edit that was not exported now fails the run.
const blender = findBlender();
if (!blender) console.log('run-gates: Blender not found (set BLENDER): tools/check-glb-fresh.mjs is not run, so a stale body GLB would not be caught');
const gates = [
  ...readdirSync(join(ROOT, 'tools')).filter((f) => /^test-.*\.mjs$/.test(f)).sort().map((f) => `tools/${f}`),
  ...['cone', 'lens', 'loupe'].map((f) => `tools/accuracy/${f}.mjs`),
  ...(blender ? ['tools/check-glb-fresh.mjs'] : []),
].filter((g) => !filters.length || filters.some((w) => g.includes(w)))
  .filter((_, k) => !shard || k % shard.total === shard.index - 1);

async function startProd() {
  // its own output folder: gates that build and serve their own copy (the budgets) write to dist-gates meanwhile
  const { build, preview } = await import('vite');
  const outDir = 'dist-gates-run';
  await build({ root: ROOT, build: { outDir }, logLevel: 'warn' });
  const server = await preview({ root: ROOT, build: { outDir }, preview: { host: '127.0.0.1', port: PORT, strictPort: true }, logLevel: 'warn' });
  const url = `http://127.0.0.1:${PORT}/`;
  await warmDev(url);
  return { url, close: () => new Promise((resolve) => server.httpServer.close(() => resolve())) };
}

async function startDev() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, logLevel: 'warn', server: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
  await server.listen();
  const url = `http://127.0.0.1:${PORT}/`;
  await warmDev(url);
  return { url, close: () => server.close() };
}

// A cold dev server transforms every module and optimizes three's dependencies on the first page load, which took
// longer than the first gate's 30 s page.goto (score loop r3: test-compatibility failed that way and passed against a
// warm server). One full load of the camera and the Models page before the first gate does that work up front.
async function warmDev(url) {
  const t0 = Date.now();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  try {
    for (const path of ['?piece=camera&lens=n50', 'models.html', 'reference.html']) {
      const page = await browser.newPage();
      try {
        await page.goto(url + path, { timeout: 180000 });
        await page.waitForFunction(() => document.getElementById('veil')?.classList.contains('off') || document.readyState === 'complete' && !document.getElementById('veil'), null, { timeout: 180000 });
      } catch (e) { console.log(`run-gates: warming ${path || '/'} did not finish (${String(e?.message ?? e).split('\n')[0]})`); }
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`run-gates: dev server warmed in ${Math.round((Date.now() - t0) / 1000)} s`);
}

function run(gate, env) {
  return new Promise((done) => {
    const t0 = Date.now();
    let out = '';
    const child = spawn(process.execPath, [gate], { cwd: ROOT, env });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += `\n[run-gates] TIMEOUT after ${TIMEOUT_S} s\n`; child.kill('SIGKILL'); }, TIMEOUT_S * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // the last meaningful line: an assertion or error message for a failure, the final PASS line otherwise
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // a gate that exits 0 but ends on a WARN line judged every row it could and left some unjudged (score loop r6: the runtime
      // budgets on a busy host): it passes, and the summary says so instead of printing a clean PASS
      const status = signal ? 'TIMEOUT' : code === 0 ? (/^WARN\b/.test(lines.at(-1) ?? '') ? 'WARN' : 'PASS') : 'FAIL';
      const err = lines.find((l) => /^(AssertionError|Error|TypeError|ReferenceError|page\.\w+: |locator\.\w+: )/.test(l) || /Timeout \d+ms exceeded/.test(l));
      const note = (status === 'PASS' || status === 'WARN' ? lines.at(-1) : err ?? lines.at(-1)) ?? '';
      done({ gate, status, seconds: Math.round((Date.now() - t0) / 1000), note: note.slice(0, 160), out });
    });
  });
}

const dev = process.env.P2P_URL ? null : prod ? await startProd() : await startDev();
const url = process.env.P2P_URL || dev.url;
const env = { ...process.env, P2P_URL: url, P2P_PREVIEW_PORT: process.env.P2P_PREVIEW_PORT || '47671' };
mkdirSync(join(ROOT, 'shots/gates'), { recursive: true });
console.log(`run-gates: ${gates.length} gates${shard ? ` (shard ${shard.index}/${shard.total})` : ''} against ${url}`);
const results = [];
try {
  for (const gate of gates) {
    const r = await run(gate, env);
    writeFileSync(join(ROOT, 'shots/gates', `${gate.split('/').at(-1)}.log`), r.out);
    results.push(r);
    console.log(`${r.status.padEnd(7)} ${String(r.seconds).padStart(4)} s  ${gate}  ${r.status === 'PASS' ? '' : r.note}`);
  }
} finally {
  await dev?.close();
}
console.log('\n| Gate | Status | Time | Note |\n|---|---|---|---|');
for (const r of results) console.log(`| \`${r.gate}\` | ${r.status} | ${r.seconds} s | ${r.note.replace(/\|/g, '\\|')} |`);
const failed = results.filter((r) => r.status !== 'PASS' && r.status !== 'WARN').length;
const warned = results.filter((r) => r.status === 'WARN');
console.log(`\n${results.length - failed}/${results.length} passed${warned.length ? ` (${warned.length} with rows not gated: ${warned.map((r) => r.gate).join(', ')})` : ''}`);
process.exit(failed ? 1 : 0);
