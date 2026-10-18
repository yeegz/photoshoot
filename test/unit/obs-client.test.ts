import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ObsClient } from '../../src/main/obsClient';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function server(options: { password?: string; silent?: boolean } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  cleanup.push(() => new Promise<void>((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => resolve());
  }));
  const address = wss.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  let identified = false;
  let socket: WebSocket | undefined;
  wss.on('connection', (ws) => {
    socket = ws;
    if (options.silent) return;
    ws.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'known-salt', challenge: 'known-challenge' } } }));
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.op === 1) {
        const secret = createHash('sha256').update((options.password ?? 'correct password') + 'known-salt').digest('base64');
        const authentication = createHash('sha256').update(secret + 'known-challenge').digest('base64');
        if (message.d.authentication !== authentication) return ws.close(4009, 'Authentication failed');
        identified = true;
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (message.op === 6) {
        if (message.d.requestType === 'NoReply') return;
        ws.send(JSON.stringify({ op: 7, d: {
          requestId: message.d.requestId,
          requestType: message.d.requestType,
          requestStatus: message.d.requestType === 'Failure' ? { result: false, code: 601, comment: 'Scene missing' } : { result: true, code: 100 },
          responseData: { echoed: message.d.requestData?.value },
        } }));
      }
    });
  });
  return { port: address.port, identified: () => identified, socket: () => socket };
}

describe('OBS v5 connection over real loopback WebSocket', () => {
  it('authenticates the challenge and correlates concurrent responses', async () => {
    const obs = await server();
    const client = new ObsClient({ timeoutMs: 500 });
    cleanup.push(() => client.close());
    await client.connect({ port: obs.port, password: 'correct password' });
    expect(obs.identified()).toBe(true);
    expect(await Promise.all([client.request('Echo', { value: 'one' }), client.request('Echo', { value: 'two' })]))
      .toEqual([{ echoed: 'one' }, { echoed: 'two' }]);
  });

  it('reports a wrong password without returning the password', async () => {
    const obs = await server();
    const client = new ObsClient({ timeoutMs: 500 });
    cleanup.push(() => client.close());
    await expect(client.connect({ port: obs.port, password: 'wrong-secret' })).rejects.toThrow(/password/i);
  });

  it('propagates an OBS request error, and times out a missing response', async () => {
    const obs = await server();
    const client = new ObsClient({ timeoutMs: 50 });
    cleanup.push(() => client.close());
    await client.connect({ port: obs.port, password: 'correct password' });
    await expect(client.request('Failure')).rejects.toThrow(/Failure.*601.*Scene missing/);
    await expect(client.request('NoReply')).rejects.toThrow(/timed out/i);
  });

  it('cancels a silent connection and rejects an in-flight request on disconnect', async () => {
    const silent = await server({ silent: true });
    const client = new ObsClient({ timeoutMs: 1000 });
    cleanup.push(() => client.close());
    const abort = new AbortController();
    const connect = client.connect({ port: silent.port, password: '' }, abort.signal);
    const rejection = expect(connect).rejects.toThrow(/cancel/i);
    abort.abort();
    await rejection;
    const obs = await server();
    const connected = new ObsClient({ timeoutMs: 500 });
    cleanup.push(() => connected.close());
    await connected.connect({ port: obs.port, password: 'correct password' });
    const pending = expect(connected.request('NoReply')).rejects.toThrow(/disconnect/i);
    obs.socket()!.close();
    await pending;
  });
});
