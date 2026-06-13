// Builds the deployable static site into web-dist/:
//   web-dist/index.html        -> marketing landing page
//   web-dist/app/              -> the Photoshoot web app (same renderer + a
//                                 browser shim for window.photoshoot)
// Run: node web/build-web.mjs

import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'web-dist');
const appOut = path.join(out, 'app');

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(appOut, { recursive: true });
  await mkdir(path.join(out, 'assets'), { recursive: true });

  // 1) Bundle the browser shim + the (unchanged) renderer.
  await esbuild.build({
    entryPoints: [path.join(root, 'src/web/shim.ts')],
    outfile: path.join(appOut, 'shim.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    logLevel: 'info',
  });
  await esbuild.build({
    entryPoints: [path.join(root, 'src/renderer/main.ts')],
    outfile: path.join(appOut, 'renderer.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });

  // 2) Styles.
  await cp(path.join(root, 'src/renderer/styles'), path.join(appOut, 'styles'), { recursive: true });

  // 3) App HTML, derived from the Electron renderer's index.html.
  let html = await readFile(path.join(root, 'src/renderer/index.html'), 'utf8');
  html = html.replace('<html lang="en" data-theme="modern">', '<html lang="en" data-theme="modern" data-platform="web">');
  html = html.replace('<title>Photoshoot</title>', '<title>Photoshoot</title>\n    <link rel="icon" href="icon.png" />');
  html = html.replace('<script src="renderer.js"></script>', '<script src="shim.js"></script>\n    <script src="renderer.js"></script>');
  await writeFile(path.join(appOut, 'index.html'), html);

  // 4) Landing page + assets.
  await cp(path.join(__dirname, 'landing/index.html'), path.join(out, 'index.html'));
  await cp(path.join(__dirname, 'landing/landing.css'), path.join(out, 'landing.css'));
  await cp(path.join(root, 'build/icon.png'), path.join(out, 'assets/icon.png'));
  await cp(path.join(root, 'build/icon.png'), path.join(appOut, 'icon.png'));

  console.log('[photoshoot] web build complete → web-dist/');
}

run().catch((err) => {
  console.error('[photoshoot] web build failed:', err);
  process.exit(1);
});
