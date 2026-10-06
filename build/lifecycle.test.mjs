import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

// Execute the production modules with controlled browser/media boundaries so
// asynchronous model loading and recorder event order can be tested exactly.
async function loadModule(name, imports, globals = {}) {
  const result = await build({
    entryPoints: [`src/renderer/${name}.ts`], bundle: true, write: false,
    platform: 'node', format: 'cjs', plugins: [{ name: 'browser-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) => path in imports ? { path, external: true } : null);
    } }],
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require: (path) => imports[path],
    console, performance: { now: () => 100 }, Blob, ...globals,
  });
  return module.exports;
}

async function faceSetup() {
  let resolveModel;
  let detections = 0;
  const frames = new Map();
  let nextFrame = 0;
  const face = await loadModule('faceTracker', {
    './app': { app: { video: { readyState: 2, videoWidth: 640 } } },
    '@mediapipe/tasks-vision': {
      FilesetResolver: { forVisionTasks: () => new Promise((resolve) => { resolveModel = resolve; }) },
      FaceLandmarker: { createFromOptions: async () => ({ detectForVideo() { detections++; return {}; } }) },
    },
  }, {
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  return { face, frames, resolve: () => resolveModel({}), detections: () => detections };
}

test('deactivation during model loading prevents late inference and animation frames', async () => {
  const s = await faceSetup();
  const pending = s.face.activateFaceTracking();
  s.face.deactivateFaceTracking();
  s.resolve();
  await pending;
  assert.equal(s.detections(), 0);
  assert.equal(s.frames.size, 0);
});

test('overlapping activations create only one cancellable inference loop', async () => {
  const s = await faceSetup();
  const first = s.face.activateFaceTracking();
  const second = s.face.activateFaceTracking();
  s.resolve();
  await Promise.all([first, second]);
  assert.equal(s.frames.size, 1);
  s.face.deactivateFaceTracking();
  assert.equal(s.frames.size, 0);
});

test('reactivation while an obsolete activation loads creates exactly one loop', async () => {
  const s = await faceSetup();
  const first = s.face.activateFaceTracking();
  s.face.deactivateFaceTracking();
  const second = s.face.activateFaceTracking();
  s.resolve();
  await Promise.all([first, second]);
  assert.equal(s.frames.size, 1);
});

async function recorderSetup(failure) {
  const streams = [], recorders = [], saved = [], messages = [];
  const timers = new Set();
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const canvas = { width: 640, height: 480, captureStream() {
    if (failure === 'capture') throw new Error('capture failed');
    const track = { stops: 0, stop() { this.stops++; } };
    const stream = { getTracks: () => [track], track };
    streams.push(stream);
    return stream;
  } };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() {
      if (failure === 'constructor') throw new Error('unsupported');
      recorders.push(this);
    }
    start() { if (failure === 'start') throw new Error('start failed'); }
    stop() { if (failure === 'stop') throw new Error('already inactive'); }
    data(text) { this.ondataavailable({ data: new Blob([text]) }); }
    finish() { this.onstop(); }
  }
  class FileReader {
    async readAsDataURL(blob) {
      if (failure === 'read') { this.onerror(); return; }
      this.result = await blob.text();
      this.onload();
    }
  }
  const app = { renderer: { available: true, canvas }, effect: 'normal' };
  const { videoRecorder } = await loadModule('capture', {
    './app': { app },
    './sound': { sound: { unlock() {}, play() {} } },
    './dom': { byId, qsa: () => [], clear() {}, wait() {}, el() {} },
    './toast': { toast: (message) => messages.push(message) },
    './bridge': { api: { saveCapture: async (data) => {
      if (failure === 'save') throw new Error('storage failed');
      saved.push(data); return { ok: true };
    } } },
    './gallery': { refreshGallery: async () => {}, exitReview() {}, isReviewing: () => false },
  }, {
    MediaRecorder: Recorder, FileReader,
    window: { setInterval: (fn) => { timers.add(fn); return fn; }, clearInterval: (id) => timers.delete(id) },
  });
  return { videoRecorder, streams, recorders, saved, messages, timers, app };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const failure of ['capture', 'constructor', 'start']) {
  test(`recorder ${failure} failure is handled and releases acquired tracks`, async () => {
    const s = await recorderSetup(failure);
    await assert.doesNotReject(s.videoRecorder.toggle());
    assert.equal(s.videoRecorder.recording, false);
    assert.equal(s.timers.size, 0);
    for (const stream of s.streams) assert.equal(stream.track.stops, 1);
    assert.equal(s.messages.length, 1);
  });
}

for (const failure of [undefined, 'stop']) {
  test(`stopping releases canvas tracks and timer${failure ? ' even if MediaRecorder.stop throws' : ''}`, async () => {
    const s = await recorderSetup(failure);
    await s.videoRecorder.toggle();
    s.videoRecorder.stop();
    s.videoRecorder.stop();
    assert.equal(s.streams[0].track.stops, 1);
    assert.equal(s.timers.size, 0);
    assert.equal(s.videoRecorder.recording, false);
  });
}

test('a delayed stop event cannot mix chunks or stop a subsequent recording', async () => {
  const s = await recorderSetup();
  await s.videoRecorder.toggle();
  s.recorders[0].data('first-');
  s.videoRecorder.stop();
  await s.videoRecorder.toggle();
  s.recorders[1].data('second-');
  s.recorders[0].data('last');
  s.recorders[0].finish();
  await flush();
  assert.equal(s.saved[0].dataUrl, 'first-last');
  assert.equal(s.videoRecorder.recording, true);
  assert.equal(s.streams[1].track.stops, 0);
  s.videoRecorder.stop();
  s.recorders[1].data('last');
  s.recorders[1].finish();
  await flush();
  assert.equal(s.saved[1].dataUrl, 'second-last');
  assert.equal(s.streams[0].track.stops, 1);
  assert.equal(s.streams[1].track.stops, 1);
});

test('a recorder stopping itself releases tracks and resets recording UI state', async () => {
  const s = await recorderSetup();
  await s.videoRecorder.toggle();
  s.recorders[0].finish();
  assert.equal(s.videoRecorder.recording, false);
  assert.equal(s.streams[0].track.stops, 1);
  assert.equal(s.timers.size, 0);
});

test('final video metadata belongs to its recording even after the camera changes', async () => {
  const s = await recorderSetup();
  await s.videoRecorder.toggle();
  s.recorders[0].data('video');
  s.videoRecorder.stop();
  s.app.renderer.canvas.width = 1280;
  s.app.renderer.canvas.height = 720;
  s.app.effect = 'sepia';
  s.recorders[0].finish();
  await flush();
  assert.equal(s.saved[0].width, 640);
  assert.equal(s.saved[0].height, 480);
  assert.equal(s.saved[0].effect, 'normal');
});

for (const failure of ['read', 'save']) {
  test(`video ${failure} failure is reported after recording resources are released`, async () => {
    const s = await recorderSetup(failure);
    await s.videoRecorder.toggle();
    s.recorders[0].data('video');
    s.videoRecorder.stop();
    s.recorders[0].finish();
    await flush();
    assert.equal(s.streams[0].track.stops, 1);
    assert.equal(s.videoRecorder.recording, false);
    assert.deepEqual(s.messages, ['Could not save video.']);
  });
}
