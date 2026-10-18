// Builds the deployable static site into web-dist/:
//   web-dist/index.html        -> marketing landing page
//   web-dist/app/              -> the Photoshoot web app (same renderer + a
//                                 browser shim for window.photoshoot)
//
// Bundles + stylesheets are emitted with a content hash in the filename
// (e.g. renderer-ab12cd34.js) and referenced from the HTML by that hashed name.
// Combined with `immutable` caching on hashed assets and `no-cache` on the HTML
// (see firebase.json), this makes every deploy propagate instantly: the HTML is
// always revalidated, and whenever a bundle's content changes its URL changes,
// so browsers fetch the new file instead of serving a stale cached copy.
//
// Run: node web/build-web.mjs

import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'web-dist');
const appOut = path.join(out, 'app');

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

// Bundle one entry with a content-hashed name; return its emitted basename.
async function bundleHashed(entry, define, outdir = appOut) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outdir,
    entryNames: '[name]-[hash]',
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    metafile: true,
    ...(define ? { define } : {}),
    logLevel: 'info',
  });
  const jsOut = Object.keys(result.metafile.outputs).find((k) => k.endsWith('.js'));
  return path.basename(jsOut);
}

// Copy a stylesheet under a content-hashed name; return the hashed basename.
async function hashCss(srcFile, destDir, baseName) {
  const buf = await readFile(srcFile);
  const name = `${baseName}-${hash8(buf)}.css`;
  await writeFile(path.join(destDir, name), buf);
  return name;
}

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(appOut, { recursive: true });
  await mkdir(path.join(appOut, 'styles'), { recursive: true });
  await mkdir(path.join(out, 'assets'), { recursive: true });

  // 1) Bundle the browser shim + the (unchanged) renderer, content-hashed.
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const shimFile = await bundleHashed(path.join(root, 'src/web/shim.ts'), {
    __PHOTOSHOOT_VERSION__: JSON.stringify(pkg.version),
  });
  // The person-segmentation worker is content-hashed like every other bundle
  // (hosting caches .js for a year); the renderer learns its name at build time.
  const workerFile = await bundleHashed(path.join(root, 'src/renderer/personSegmentation.worker.ts'));
  const rendererFile = await bundleHashed(path.join(root, 'src/renderer/main.ts'), {
    __SEGMENTER_WORKER__: JSON.stringify(workerFile),
    'process.env.NODE_ENV': '"production"',
  });

  // 2) Stylesheets (content-hashed) + MediaPipe assets (referenced by fixed path
  //    from code, so they keep stable names).
  const styleNames = ['base', 'layout', 'components', 'themes'];
  const styleMap = {};
  for (const n of styleNames) {
    styleMap[n] = await hashCss(
      path.join(root, 'src/renderer/styles', `${n}.css`),
      path.join(appOut, 'styles'),
      n
    );
  }
  const wasmSrc = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  const modelSrc = path.join(root, 'build/mediapipe/face_landmarker.task');
  await cp(wasmSrc, path.join(appOut, 'mediapipe/wasm'), { recursive: true });
  await cp(modelSrc, path.join(appOut, 'mediapipe/face_landmarker.task'));
  await cp(path.join(root, 'build/mediapipe/selfie_segmenter.tflite'), path.join(appOut, 'mediapipe/selfie_segmenter.tflite'));
  for (const file of ['selfie_segmenter.LICENSE', 'selfie_segmenter.README.md']) {
    await cp(path.join(root, 'build/mediapipe', file), path.join(appOut, 'mediapipe', file));
  }
  await cp(path.join(root, 'src/renderer/assets'), path.join(appOut, 'assets'), { recursive: true });
  await cp(path.join(root, 'src/renderer/assets'), path.join(out, 'assets'), { recursive: true });

  // 3) App HTML, derived from the Electron renderer's index.html, rewired to the
  //    hashed asset names.
  let html = await readFile(path.join(root, 'src/renderer/index.html'), 'utf8');
  html = html.replace('<html lang="en" data-theme="booth">', '<html lang="en" data-theme="booth" data-platform="web">');
  html = html.replace('<title>Photoshoot</title>', '<title>Photoshoot</title>\n    <link rel="icon" href="icon.png" />');
  for (const n of styleNames) html = html.replace(`styles/${n}.css`, `styles/${styleMap[n]}`);
  html = html.replace(
    '<script src="renderer.js"></script>',
    `<script src="${shimFile}"></script>\n    <script src="${rendererFile}"></script>`
  );
  await writeFile(path.join(appOut, 'index.html'), html);

  // 4) Landing page: hashed CSS + its own hashed effects-showcase bundle,
  //    the package version injected, then assets.
  const landingCss = await hashCss(path.join(__dirname, 'landing/landing.css'), out, 'landing');
  const landingJs = await bundleHashed(path.join(__dirname, 'landing/landing.ts'), undefined, out);
  let landing = await readFile(path.join(__dirname, 'landing/index.html'), 'utf8');
  landing = landing.replace('href="landing.css"', `href="${landingCss}"`);
  const sample = await readFile(path.join(__dirname, 'landing/assets/photobooth-sample.jpg'));
  const sampleName = `photobooth-sample-${hash8(sample)}.jpg`;
  await writeFile(path.join(out, 'assets', sampleName), sample);
  landing = landing.replace('assets/photobooth-sample.jpg', `assets/${sampleName}`);
  landing = landing.replaceAll('{{version}}', pkg.version);
  if (!landing.includes('</body>')) throw new Error('landing/index.html has no </body> to attach the bundle to');
  landing = landing.replace('</body>', `    <script defer src="${landingJs}"></script>\n  </body>`);
  await writeFile(path.join(out, 'index.html'), landing);
  await cp(path.join(root, 'build/icon.png'), path.join(out, 'assets/icon.png'));
  await cp(path.join(root, 'build/icon.png'), path.join(appOut, 'icon.png'));

  console.log(`[photoshoot] web build complete → web-dist/  (${rendererFile}, ${shimFile}, ${landingJs})`);
}

run().catch((err) => {
  console.error('[photoshoot] web build failed:', err);
  process.exit(1);
});
