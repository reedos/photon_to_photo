// Builds the app shell and serves it via Vite's own preview server on 127.0.0.1:47501 -- the gate/screenshot
// port (the dev server at :47500, package.json's `dev` script, is separate). Used standalone
// (`node tools/preview.mjs`, stays running -- Ctrl-C to stop) and imported by tools/shot.mjs, which manages the
// server's lifecycle itself around a batch of screenshots.
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

export const PREVIEW_HOST = '127.0.0.1';
// P2P_PREVIEW_PORT lets parallel worktrees run their gates at once (lens 47511, cone 47512, loupe 47513, ...)
export const PREVIEW_PORT = Number(process.env.P2P_PREVIEW_PORT) || 47501;
// P2P_OUT_DIR lets a run build into a folder of its own (score loop r5: two gates building into dist-gates at once overwrote each other)
export const OUT_DIR = process.env.P2P_OUT_DIR || 'dist-gates';

export async function buildApp() {
  await build({ build: { outDir: OUT_DIR }, logLevel: 'warn' });
}

/** Builds (unless `skipBuild`, for a caller that already built) and starts `vite preview` bound to
 *  PREVIEW_HOST:PREVIEW_PORT. Returns the resolved URL and a `close()` to stop the server. */
export async function startPreview({ skipBuild = false } = {}) {
  if (!skipBuild) await buildApp();
  const server = await preview({
    build: { outDir: OUT_DIR },
    preview: { host: PREVIEW_HOST, port: PREVIEW_PORT, strictPort: true },
    logLevel: 'warn',
  });
  const url = server.resolvedUrls?.local?.[0] ?? `http://${PREVIEW_HOST}:${PREVIEW_PORT}/`;
  return {
    url,
    close() {
      return new Promise((resolve, reject) => {
        server.httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** The server a browser gate tests: P2P_URL when it is set (a dev server, or a production candidate), otherwise a
 *  fresh build served by startPreview() on PREVIEW_PORT. Every tools/test-*.mjs gate takes its URL this way, so each
 *  one runs standalone with no setup and against a shared server with P2P_URL. `close()` is a no-op for P2P_URL. */
export async function gateServer() {
  if (process.env.P2P_URL) return { url: process.env.P2P_URL, close: async () => {} };
  return startPreview();
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { url } = await startPreview();
  console.log(`preview.mjs: serving ${url} (outDir: ${OUT_DIR}) -- Ctrl-C to stop`);
}
