// Build pipeline for Photoshoot.
// Bundles three TypeScript entry points (main, preload, renderer) with esbuild,
// then copies the static renderer HTML/CSS into dist/. No type-checking happens
// here (run `npm run typecheck` for that) so the app always builds and runs.

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = path.join(root, 'dist');

const prod = process.argv.includes('--prod');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: !prod,
  minify: prod,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
  },
};

const targets = [
  {
    name: 'main',
    options: {
      ...common,
      entryPoints: [path.join(root, 'src/main/main.ts')],
      outfile: path.join(dist, 'main.js'),
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
    },
  },
  {
    name: 'preload',
    options: {
      ...common,
      entryPoints: [path.join(root, 'src/preload/preload.ts')],
      outfile: path.join(dist, 'preload.js'),
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
    },
  },
  {
    name: 'renderer',
    options: {
      ...common,
      entryPoints: [path.join(root, 'src/renderer/main.ts')],
      outfile: path.join(dist, 'renderer.js'),
      platform: 'browser',
      format: 'iife',
      target: ['chrome120'],
    },
  },
];

async function copyStatic() {
  const htmlSrc = path.join(root, 'src/renderer/index.html');
  const stylesSrc = path.join(root, 'src/renderer/styles');
  await cp(htmlSrc, path.join(dist, 'index.html'));
  if (existsSync(stylesSrc)) {
    await cp(stylesSrc, path.join(dist, 'styles'), { recursive: true });
  }
  await copyMediapipe(dist);
}

// MediaPipe face-landmarker WASM fileset + model, served locally (no CDN).
async function copyMediapipe(targetDir) {
  const wasmSrc = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  const modelSrc = path.join(root, 'build/mediapipe/face_landmarker.task');
  if (existsSync(wasmSrc)) {
    await cp(wasmSrc, path.join(targetDir, 'mediapipe/wasm'), { recursive: true });
  }
  if (existsSync(modelSrc)) {
    await mkdir(path.join(targetDir, 'mediapipe'), { recursive: true });
    await cp(modelSrc, path.join(targetDir, 'mediapipe/face_landmarker.task'));
  }
}

async function clean() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
}

async function run() {
  await clean();

  if (watch) {
    const contexts = await Promise.all(
      targets.map((t) => esbuild.context(t.options))
    );
    await Promise.all(contexts.map((c) => c.watch()));
    await copyStatic();
    console.log('[photoshoot] watching for changes…');
    return;
  }

  await Promise.all(targets.map((t) => esbuild.build(t.options)));
  await copyStatic();
  console.log(`[photoshoot] build complete (${prod ? 'production' : 'development'})`);
}

run().catch((err) => {
  console.error('[photoshoot] build failed:', err);
  process.exit(1);
});
