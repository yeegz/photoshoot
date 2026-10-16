import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager } from '../src/renderer/camera.ts';

class Video extends EventTarget {
  style = {};
  videoWidth = 640;
  videoHeight = 480;
  readyState = 2;
  srcObject = null;
  setAttribute() {}
  play() { return Promise.resolve(); }
  pause() {}
}
function stream(id = 'working', label = '') {
  const track = new EventTarget();
  track.label = label;
  track.readyState = 'live';
  track.stopped = false;
  track.stop = () => { track.stopped = true; };
  track.getSettings = () => ({ deviceId: id });
  return { getTracks: () => [track], getVideoTracks: () => [track], track };
}
function setup(getUserMedia, devices = []) {
  const video = new Video();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => video, body: { appendChild() {} },
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia, enumerateDevices: async () => devices.map(([deviceId, label]) => ({ kind: 'videoinput', deviceId, label })) },
  } });
  return { camera: new CameraManager(), video };
}

test('retries basic video when the default camera rejects capture constraints', async () => {
  const calls = [];
  const { camera } = setup(async (constraints) => {
    calls.push(constraints);
    if (constraints.video !== true) throw { name: 'OverconstrainedError' };
    return stream();
  });
  assert.equal((await camera.start()).ok, true);
  assert.equal(calls.at(-1).video, true);
  camera.stop();
});

test('keeps the selected camera while relaxing capture constraints', async () => {
  const { camera } = setup(async ({ video }) => {
    if (video.frameRate) throw { name: 'OverconstrainedError' };
    assert.deepEqual(video, { deviceId: { exact: 'external' } });
    return stream('external');
  });
  assert.equal((await camera.start('external')).deviceId, 'external');
  camera.stop();
});

test('permission denial is returned once without repeatedly requesting access', async () => {
  let calls = 0;
  const { camera } = setup(async () => { calls++; throw { name: 'NotAllowedError' }; });
  assert.equal((await camera.start('saved')).error, 'denied');
  assert.equal(calls, 1);
});

test('playback failure is not reported as a live camera and releases the stream', async () => {
  const media = stream();
  const { camera, video } = setup(async () => media);
  video.play = async () => { throw { name: 'NotAllowedError' }; };
  assert.equal((await camera.start()).ok, false);
  assert.equal(media.track.stopped, true);
  assert.equal(video.srcObject, null);
});

test('an obsolete camera request cannot replace the newer selected stream', async () => {
  let resolveOld;
  const old = stream('old');
  const current = stream('current');
  const { camera, video } = setup(({ video }) => video.deviceId?.exact === 'old'
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(current));
  const first = camera.start('old');
  assert.equal((await camera.start('current')).ok, true);
  resolveOld(old);
  assert.equal((await first).ok, false);
  assert.equal(video.srcObject, current);
  assert.equal(old.track.stopped, true);
  camera.stop();
});

test('stop also releases a stream acquired after teardown', async () => {
  let finish;
  const media = stream();
  const { camera, video } = setup(() => new Promise((resolve) => { finish = resolve; }));
  const pending = camera.start();
  camera.stop();
  finish(media);
  assert.equal((await pending).ok, false);
  assert.equal(media.track.stopped, true);
  assert.equal(video.srcObject, null);
});

test('dimensions alone do not count as a decoded video frame', async () => {
  const { camera, video } = setup(async () => stream());
  video.readyState = 0;
  assert.equal(await camera.waitForFrame(5), false);
});

test('a stalled acquisition times out and releases a stream arriving later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const media = stream();
  const { camera, video } = setup(() => new Promise((resolve) => { finish = resolve; }));
  const pending = camera.start();
  t.mock.timers.tick(30001);
  assert.equal((await pending).error, 'timeout');
  finish(media);
  await Promise.resolve();
  assert.equal(media.track.stopped, true);
  assert.equal(video.srcObject, null);
});

const laptop = [['ir', 'Integrated IR Camera'], ['rgb', 'Integrated Camera']];
const byId = (video) => video.deviceId?.exact;

test('a default camera that never sends frames falls through to another camera', async () => {
  const { camera, video } = setup(async ({ video: c }) => {
    video.readyState = byId(c) === 'rgb' ? 2 : 0;
    return stream(byId(c) ?? 'dead');
  }, [['dead', 'Virtual Camera'], ['rgb', 'Integrated Camera']]);
  camera.waitForFrame = function (ms) { return Promise.resolve(this.video.readyState >= 2); };
  const res = await camera.start();
  assert.equal(res.ok, true);
  assert.equal(res.deviceId, 'rgb');
  camera.stop();
});

test('a Windows Hello IR sensor opened by default is skipped for the colour camera', async () => {
  const opened = [];
  const { camera } = setup(async ({ video: c }) => {
    const id = byId(c) ?? 'ir';
    opened.push(id);
    return stream(id, laptop.find(([d]) => d === id)[1]);
  }, laptop);
  const res = await camera.start();
  assert.equal(res.deviceId, 'rgb');
  assert.deepEqual(opened, ['ir', 'rgb']);
  camera.stop();
});

test('an IR sensor is still used when it is the only camera that works', async () => {
  const { camera } = setup(async ({ video: c }) => {
    const id = byId(c) ?? 'ir';
    if (id === 'rgb') throw { name: 'NotReadableError' };
    return stream(id, 'Integrated IR Camera');
  }, laptop);
  assert.equal((await camera.start()).deviceId, 'ir');
  camera.stop();
});

test('every camera busy reports in use after trying each one', async () => {
  const asked = new Set();
  const { camera } = setup(async ({ video: c }) => {
    asked.add(c === true ? 'basic' : byId(c) ?? 'default');
    throw { name: 'NotReadableError' };
  }, laptop);
  assert.equal((await camera.start()).error, 'inuse');
  assert.deepEqual([...asked].sort(), ['basic', 'default', 'ir', 'rgb']);
});

test('legacy Chromium error names are understood', async () => {
  const { camera } = setup(async ({ video: c }) => {
    if (c !== true) throw { name: 'ConstraintNotSatisfiedError' };
    return stream();
  });
  assert.equal((await camera.start()).ok, true);
  camera.stop();
});
