import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { VirtualCameraService } from '../../src/main/virtualCamera';

const jpeg = readFileSync(new URL('../fixtures/virtual-camera-pink.jpg', import.meta.url));
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function obsServer(options: { active?: 'stream' | 'record' | 'virtualcam'; failure?: string; browserMissing?: boolean } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const state = { scene: 'My original scene', scenes: new Set(['My original scene']), inputs: new Set<string>(), virtualcam: options.active === 'virtualcam', feedUrl: '', frames: Buffer.alloc(0), starts: 0, stops: 0, transform: {}, transitionOverride: '' };
  const feedAbort = new AbortController();
  const event = (name: string, data: Record<string, unknown>) => {
    for (const socket of server.clients) socket.send(JSON.stringify({ op: 5, d: { eventType: name, eventData: data } }));
  };
  const requests = [
    'GetVersion', 'GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus', 'GetReplayBufferStatus', 'GetCurrentProgramScene',
    'GetVideoSettings', 'GetStudioModeEnabled', 'GetInputKindList', 'CreateScene', 'CreateInput', 'SetSceneItemTransform',
    'SetCurrentProgramScene', 'StartVirtualCam', 'StopVirtualCam', 'RemoveInput', 'RemoveScene',
    'GetSceneTransitionList', 'SetSceneSceneTransitionOverride',
  ];
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } } }));
    socket.on('message', async (bytes) => {
      const { op, d } = JSON.parse(bytes.toString());
      if (op === 1) {
        const secret = createHash('sha256').update('passwords').digest('base64');
        if (d.authentication !== createHash('sha256').update(secret + 'c').digest('base64')) return socket.close(4009);
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); return;
      }
      if (op !== 6) return;
      let responseData: Record<string, unknown> = {};
      const data = d.requestData;
      let failed = d.requestType === options.failure || !requests.includes(d.requestType);
      if (!failed) switch (d.requestType) {
        case 'GetVersion': responseData = { rpcVersion: 1, obsVersion: '30.2.0', obsWebSocketVersion: '5.5.0', availableRequests: requests }; break;
        case 'GetStreamStatus': responseData = { outputActive: options.active === 'stream' }; break;
        case 'GetRecordStatus': responseData = { outputActive: options.active === 'record' }; break;
        case 'GetReplayBufferStatus': responseData = { outputActive: false }; break;
        case 'GetVirtualCamStatus': responseData = { outputActive: state.virtualcam }; break;
        case 'GetVideoSettings': responseData = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 }; break;
        case 'GetStudioModeEnabled': responseData = { studioModeEnabled: false }; break;
        case 'GetInputKindList': responseData = { inputKinds: ['browser_source'] }; break;
        case 'GetSceneTransitionList': responseData = { currentSceneTransitionName: 'Fade', transitions: [{ transitionName: 'Localized Instant', transitionKind: 'cut_transition' }] }; break;
        case 'SetSceneSceneTransitionOverride': state.transitionOverride = data.transitionName; break;
        case 'GetCurrentProgramScene': responseData = { currentProgramSceneName: state.scene }; break;
        case 'CreateScene': state.scenes.add(data.sceneName); break;
        case 'CreateInput': state.inputs.add(data.inputName); state.feedUrl = data.inputSettings.url; responseData = { sceneItemId: 3 }; break;
        case 'SetSceneItemTransform': state.transform = data.sceneItemTransform; break;
        case 'SetCurrentProgramScene': {
          if (!state.scenes.has(data.sceneName)) { failed = true; break; }
          state.scene = data.sceneName;
          event('CurrentProgramSceneChanged', { sceneName: state.scene });
          if (state.scene !== 'My original scene' && !options.browserMissing) {
            void fetch(new URL('stream', state.feedUrl), { signal: feedAbort.signal }).then(async (res) => {
              const reader = res.body!.getReader();
              for (;;) { const part = await reader.read(); if (part.done) return; state.frames = Buffer.from(part.value); }
            }).catch(() => {});
          }
          break;
        }
        case 'StartVirtualCam': state.virtualcam = true; state.starts++; event('VirtualcamStateChanged', { outputActive: true }); break;
        case 'StopVirtualCam': state.virtualcam = false; state.stops++; event('VirtualcamStateChanged', { outputActive: false }); break;
        case 'RemoveInput': state.inputs.delete(data.inputName); break;
        case 'RemoveScene': state.scenes.delete(data.sceneName); break;
      }
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ op: 7, d: { requestId: d.requestId, requestType: d.requestType,
        requestStatus: failed ? { result: false, code: 701, comment: 'Fixture refused this request' } : { result: true, code: 100 }, responseData } }));
    });
  });
  cleanup.push(async () => { feedAbort.abort(); for (const client of server.clients) client.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { state, port: address.port, event, disconnect: () => { for (const socket of server.clients) socket.terminate(); } };
}

function service(options: ConstructorParameters<typeof VirtualCameraService>[0] = {}) {
  const result = new VirtualCameraService({ platform: 'win32', requestTimeoutMs: 300, frameTimeoutMs: 2500, feedConnectTimeoutMs: 300, ...options });
  cleanup.push(() => result.dispose());
  return result;
}

describe('virtual camera service with real OBS protocol and HTTP transports', () => {
  it('starts its own scene, forwards pixels, fits OBS canvas, and restores/cleans on stop', async () => {
    const obs = await obsServer(); const camera = service();
    const status = await camera.start({ port: obs.port, password: 'password' });
    expect(status.state).toBe('live');
    expect(status.sceneName).toBe(obs.state.scene);
    expect(obs.state.virtualcam).toBe(true);
    expect(obs.state.transform).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080 });
    expect(camera.pushFrame(jpeg)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(obs.state.frames.includes(jpeg)).toBe(true);
    const url = obs.state.feedUrl;
    expect((await camera.stop()).state).toBe('stopped');
    expect(obs.state.virtualcam).toBe(false);
    expect(obs.state.scene).toBe('My original scene');
    expect([...obs.state.scenes]).toEqual(['My original scene']);
    expect(obs.state.inputs.size).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });

  it.each(['stream', 'record', 'virtualcam'] as const)('does not take over active %s output', async (active) => {
    const obs = await obsServer({ active }); const camera = service();
    expect((await camera.start({ port: obs.port, password: 'password' })).state).toBe('error');
    expect(obs.state.scene).toBe('My original scene');
    expect(obs.state.starts).toBe(0); expect(obs.state.stops).toBe(0);
    expect(obs.state.scenes.size).toBe(1);
  });

  it('rolls back after a refused virtual camera start', async () => {
    const obs = await obsServer({ failure: 'StartVirtualCam' }); const camera = service();
    const status = await camera.start({ port: obs.port, password: 'password' });
    expect(status.state).toBe('error'); expect(status.message).toContain('StartVirtualCam');
    expect(obs.state.scene).toBe('My original scene');
    expect(obs.state.inputs.size).toBe(0); expect(obs.state.scenes.size).toBe(1);
    await expect(fetch(obs.state.feedUrl)).rejects.toThrow();
  });

  it('uses a cut on its own scene so startup cannot transmit the previous scene during a fade', async () => {
    const obs = await obsServer(); const camera = service();
    await camera.start({ port: obs.port, password: 'password' });
    expect(obs.state.transitionOverride).toBe('Localized Instant');
  });

  it('reports a refused stop while still revoking all frame access', async () => {
    const obs = await obsServer({ failure: 'StopVirtualCam' }); const camera = service();
    await camera.start({ port: obs.port, password: 'password' });
    const stopped = await camera.stop();
    expect(stopped.state).toBe('error'); expect(stopped.message).toMatch(/manually/i);
    await expect(fetch(obs.state.feedUrl)).rejects.toThrow();
  });

  it('fails setup when the actual browser feed never connects', async () => {
    const obs = await obsServer({ browserMissing: true }); const camera = service({ feedConnectTimeoutMs: 50 });
    const status = await camera.start({ port: obs.port, password: 'password' });
    expect(status.state).toBe('error'); expect(status.message).toMatch(/browser/i);
    expect(obs.state.starts).toBe(0); expect(obs.state.scene).toBe('My original scene');
  });

  it('stops on source loss and on OBS disconnection', async () => {
    const obs = await obsServer(); const camera = service({ frameTimeoutMs: 80 });
    expect((await camera.start({ port: obs.port, password: 'password' })).state).toBe('live');
    camera.pushFrame(jpeg);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(camera.getStatus().state).toBe('error'); expect(obs.state.virtualcam).toBe(false);
    const second = await obsServer(); const disconnected = service();
    await disconnected.start({ port: second.port, password: 'password' });
    second.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(disconnected.getStatus().state).toBe('error');
    await expect(fetch(second.state.feedUrl)).rejects.toThrow();
  });

  it('does not restore the old scene after the user changes it', async () => {
    const obs = await obsServer(); const camera = service();
    await camera.start({ port: obs.port, password: 'password' });
    obs.state.scene = 'User selected scene'; obs.state.scenes.add(obs.state.scene);
    obs.event('CurrentProgramSceneChanged', { sceneName: obs.state.scene });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(camera.getStatus().state).toBe('error'); expect(obs.state.virtualcam).toBe(false);
    expect(obs.state.scene).toBe('User selected scene');
  });

  it('cancels pending browser setup without resurrecting output', async () => {
    const obs = await obsServer({ browserMissing: true }); const camera = service({ feedConnectTimeoutMs: 2000 });
    const starting = camera.start({ port: obs.port, password: 'password' });
    while (!obs.state.feedUrl) await new Promise((resolve) => setTimeout(resolve, 5));
    await camera.stop(); await starting;
    expect(camera.getStatus().state).toBe('stopped'); expect(obs.state.starts).toBe(0);
    expect(obs.state.scene).toBe('My original scene'); expect(obs.state.inputs.size).toBe(0);
  });

  it('reports unsupported native platforms without opening OBS', async () => {
    const camera = service({ platform: 'darwin' });
    expect((await camera.start({ port: 4455, password: 'password' })).state).toBe('unsupported');
    expect(camera.getStatus().supported).toBe(false);
  });
});
