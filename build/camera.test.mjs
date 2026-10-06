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
function stream(id = 'working') {
  const track = new EventTarget();
  track.readyState = 'live';
  track.stopped = false;
  track.stop = () => { track.stopped = true; };
  track.getSettings = () => ({ deviceId: id });
  return { getTracks: () => [track], getVideoTracks: () => [track], track };
}
function setup(getUserMedia) {
  const video = new Video();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => video, body: { appendChild() {} },
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
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
