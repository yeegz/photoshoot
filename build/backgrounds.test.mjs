// Real browser canvas + locally bundled MediaPipe model. Uses an ephemeral port
// so it can run alongside the app's Playwright server without sharing state.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let temp;
let origin;
const externalRequests = [];

before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'photoshoot-backgrounds-'));
  await Promise.all([
    build({ entryPoints: [path.join(root, 'src/renderer/personSegmentation.worker.ts')], outfile: path.join(temp, 'personSegmentation.worker.js'), bundle: true, format: 'iife', platform: 'browser', logLevel: 'silent' }),
    build({ stdin: { contents: [
      "export { PersonSegmenter } from './src/renderer/personSegmentation';",
      "export { BackgroundCompositor } from './src/renderer/backgroundCompositor';",
      "export { BackgroundReplacer } from './src/renderer/backgroundReplace';",
      "export { app } from './src/renderer/app';",
      "export * from './src/renderer/backgrounds';",
    ].join('\n'), resolveDir: root }, outfile: path.join(temp, 'harness.js'), bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' }),
  ]);
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let file;
    if (pathname === '/harness.js' || pathname === '/personSegmentation.worker.js') file = path.join(temp, pathname.slice(1));
    else if (pathname.startsWith('/mediapipe/wasm/')) file = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm', path.basename(pathname));
    else if (pathname === '/mediapipe/selfie_segmenter.tflite') file = path.join(root, 'build/mediapipe/selfie_segmenter.tflite');
    else if (pathname === '/portrait.jpg') file = path.join(root, 'web/landing/assets/photobooth-sample.jpg');
    else if (pathname === '/assets/background-room.jpg') file = path.join(root, 'src/renderer/assets/background-room.jpg');
    else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="bgGuide" class="hidden"><span id="bgGuideText"></span></div>');
      return;
    }
    try {
      const data = await readFile(file);
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  if (temp) await rm(temp, { recursive: true, force: true });
});

async function pageForTest() {
  const page = await browser.newPage();
  page.context().on('request', (request) => { if (!request.url().startsWith(origin)) externalRequests.push(request.url()); });
  await page.goto(origin);
  return page;
}

test('real local model detects both people and their clothing, not the curtain', { timeout: 30000 }, async () => {
  const page = await pageForTest();
  try {
    const result = await page.evaluate(async () => {
      const { PersonSegmenter, BackgroundCompositor, prepareBackground, getBackgroundCanvas } = await import('/harness.js');
      const image = new Image(); image.src = '/portrait.jpg'; await image.decode();
      const detector = new PersonSegmenter();
      await detector.start();
      const start = performance.now();
      const result = await detector.segment(image);
      const elapsed = performance.now() - start;
      const { width, height, confidence } = result.mask;
      const mean = (x0, y0, x1, y1) => {
        let total = 0, count = 0;
        for (let y = Math.floor(y0 * height); y < y1 * height; y++) for (let x = Math.floor(x0 * width); x < x1 * width; x++) {
          total += confidence[y * width + x]; count++;
        }
        return total / count;
      };
      const stats = {
        width, height, elapsed,
        leftFace: mean(.28, .32, .4, .55), rightFace: mean(.55, .25, .7, .53),
        leftBody: mean(.22, .78, .45, .95), rightBody: mean(.62, .73, .9, .94),
        background: mean(.02, .02, .19, .4),
      };
      await prepareBackground('room');
      const compositor = new BackgroundCompositor();
      compositor.draw(result.frame, result.mask, 768, 512, getBackgroundCanvas('room', 768, 512), 18);
      document.body.appendChild(compositor.canvas);
      result.frame.close(); detector.stop();
      return stats;
    });
    if (process.env.PHOTOSHOOT_BACKGROUND_SCREENSHOT) await page.locator('canvas').screenshot({ path: process.env.PHOTOSHOOT_BACKGROUND_SCREENSHOT });
    console.log('Real model measurements:', result);
    for (const region of ['leftFace', 'rightFace', 'leftBody', 'rightBody']) assert.ok(result[region] > .9, `${region} confidence ${result[region]}`);
    assert.ok(result.background < .1, `background confidence ${result.background}`);
    assert.deepEqual(externalRequests, [], 'model processing must use only local assets');
  } finally { await page.close(); }
});

test('real canvas replacement preserves foreground; blur removes background detail', { timeout: 30000 }, async () => {
  const page = await pageForTest();
  try {
    const pixels = await page.evaluate(async () => {
      const { BackgroundCompositor } = await import('/harness.js');
      const source = document.createElement('canvas'); source.width = source.height = 128;
      const ctx = source.getContext('2d');
      for (let x = 0; x < 128; x += 4) { ctx.fillStyle = x % 8 ? '#fff' : '#000'; ctx.fillRect(x, 0, 4, 128); }
      ctx.fillStyle = '#f02030'; ctx.fillRect(0, 0, 64, 128);
      const background = document.createElement('canvas'); background.width = background.height = 128;
      const bg = background.getContext('2d'); bg.fillStyle = '#2040e0'; bg.fillRect(0, 0, 128, 128);
      const confidence = new Float32Array(128 * 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) confidence[y * 128 + x] = 1;
      const compositor = new BackgroundCompositor();
      compositor.draw(source, { width: 128, height: 128, confidence }, 128, 128, background, 18);
      const output = compositor.canvas.getContext('2d');
      const pixel = (x, y) => Array.from(output.getImageData(x, y, 1, 1).data);
      const replaced = { foreground: pixel(20, 64), background: pixel(104, 64) };
      compositor.draw(source, { width: 128, height: 128, confidence }, 128, 128, null, 18);
      const blur = { foreground: pixel(20, 64), backgroundA: pixel(96, 64), backgroundB: pixel(100, 64) };
      compositor.clear();
      return { replaced, blur, cleared: compositor.canvas.width === 0 };
    });
    assert.deepEqual(pixels.replaced.foreground, [240, 32, 48, 255]);
    assert.deepEqual(pixels.replaced.background, [32, 64, 224, 255]);
    assert.deepEqual(pixels.blur.foreground, [240, 32, 48, 255]);
    assert.ok(Math.abs(pixels.blur.backgroundA[0] - pixels.blur.backgroundB[0]) < 20);
    assert.ok(pixels.blur.backgroundA[0] > 50 && pixels.blur.backgroundA[0] < 210);
    assert.equal(pixels.cleared, true);
  } finally { await page.close(); }
});

test('blur keeps the subject out of the blurred background (no dark halo)', { timeout: 30000 }, async () => {
  const page = await pageForTest();
  try {
    const near = await page.evaluate(async () => {
      const { BackgroundCompositor } = await import('/harness.js');
      const size = 256;
      const source = document.createElement('canvas'); source.width = source.height = size;
      const ctx = source.getContext('2d');
      ctx.fillStyle = 'rgb(200,200,200)'; ctx.fillRect(0, 0, size, size); // light room
      ctx.fillStyle = 'rgb(20,20,20)'; ctx.fillRect(0, 0, 128, size);     // dark subject, left half
      const confidence = new Float32Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < 128; x++) confidence[y * size + x] = 1;
      const compositor = new BackgroundCompositor();
      compositor.draw(source, { width: size, height: size, confidence }, size, size, null, 24);
      const out = compositor.canvas.getContext('2d');
      // Background pixels 8 and 20 px from the subject's edge.
      return [136, 148].map((x) => out.getImageData(x, 128, 1, 1).data[0]);
    });
    for (const value of near) assert.ok(value > 180, `background beside the subject darkened to ${value}`);
  } finally { await page.close(); }
});

test('replacement activation, cancellation, reselection and custom photo recovery', { timeout: 30000 }, async () => {
  const page = await pageForTest();
  try {
    const state = await page.evaluate(async () => {
      const { app, BackgroundReplacer, loadCustomBackground, prepareBackground, getBackgroundCanvas } = await import('/harness.js');
      const image = new Image(); image.src = '/portrait.jpg'; await image.decode();
      const source = document.createElement('canvas'); source.width = 480; source.height = 320;
      source.getContext('2d').drawImage(image, 0, 0, 480, 320);
      const stream = source.captureStream(25);
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
      app.video = video;
      let hooked = null, selected = null;
      app.renderer = { setSource(value) { selected = value; }, setFrameHook(value) { hooked = value; } };
      const replacer = new BackgroundReplacer();
      const pending = replacer.start('studio'); replacer.stop();
      const cancelled = await pending === false && !replacer.isActive() && hooked === null && selected === video;
      const active = await replacer.start('studio');
      const replaced = selected !== video && hooked !== null && replacer.isActive();
      const blurActive = await replacer.start('blur');
      const fresh = replacer.backgroundId === 'blur' && replacer.isActive();
      video.srcObject = null; video.load(); hooked();
      const sourceLost = !replacer.isActive() && hooked === null && selected === video;
      replacer.stop();
      let corrupt = '';
      try { await loadCustomBackground(new File(['broken'], 'bad.png', { type: 'image/png' })); }
      catch (error) { corrupt = error.message; }
      const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'));
      await loadCustomBackground(new File([blob], 'photo.png', { type: 'image/png' }));
      await prepareBackground('custom');
      const custom = getBackgroundCanvas('custom', 240, 160);
      await prepareBackground('room');
      const room = getBackgroundCanvas('room', 240, 160);
      stream.getTracks().forEach((track) => track.stop());
      return { cancelled, active, replaced, blurActive, fresh, sourceLost, stopped: hooked === null && selected === video, corrupt, custom: Boolean(custom), room: Boolean(room), guideHidden: document.getElementById('bgGuide').classList.contains('hidden') };
    });
    for (const key of ['cancelled', 'active', 'replaced', 'blurActive', 'fresh', 'sourceLost', 'stopped', 'custom', 'room', 'guideHidden']) assert.equal(state[key], true, key);
    assert.match(state.corrupt, /could not be opened/);
  } finally { await page.close(); }
});

test('a real model load failure restores the camera and can be retried', { timeout: 30000 }, async () => {
  const page = await pageForTest();
  try {
    await page.context().route('**/mediapipe/selfie_segmenter.tflite', (route) => route.fulfill({ status: 404, body: 'missing' }));
    const failed = await page.evaluate(async () => {
      const { app, BackgroundReplacer } = await import('/harness.js');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      canvas.getContext('2d').fillRect(0, 0, 256, 256);
      const stream = canvas.captureStream(10);
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
      app.video = video;
      let source = null, hook = null;
      app.renderer = { setSource(value) { source = value; }, setFrameHook(value) { hook = value; } };
      const replacer = new BackgroundReplacer();
      const active = await replacer.start('studio');
      stream.getTracks().forEach((track) => track.stop());
      return { active, error: replacer.lastError, restored: source === video && hook === null, guideHidden: document.getElementById('bgGuide').classList.contains('hidden') };
    });
    assert.equal(failed.active, false);
    assert.equal(failed.restored, true);
    assert.equal(failed.guideHidden, true);
    assert.match(failed.error, /could not load/);
    await page.context().unroute('**/mediapipe/selfie_segmenter.tflite');
    const recovered = await page.evaluate(async () => {
      const { PersonSegmenter } = await import('/harness.js');
      const client = new PersonSegmenter(); await client.start(); client.stop(); return true;
    });
    assert.equal(recovered, true);
  } finally { await page.close(); }
});
