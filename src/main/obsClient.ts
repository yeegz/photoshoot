import { createHash, randomUUID } from 'node:crypto';
import type { VirtualCameraConfig } from '../shared/virtual-camera';

type Data = Record<string, unknown>;
type PendingRequest = { resolve: (data: Data) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class ObsRequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, comment: string) {
    super(`OBS ${requestType} failed (${code}): ${comment}`);
  }
}

/** Small, bounded OBS WebSocket v5 JSON client; the endpoint is always loopback. */
export class ObsClient {
  private socket?: WebSocket;
  private ready = false;
  private closed = false;
  private pending = new Map<string, PendingRequest>();
  private failConnect?: (error: Error) => void;
  private readonly timeoutMs: number;

  constructor(private readonly options: {
    timeoutMs?: number;
    onDisconnect?: (error: Error) => void;
    onEvent?: (name: string, data: Data) => void;
  } = {}) { this.timeoutMs = options.timeoutMs ?? 4000; }

  async connect(config: VirtualCameraConfig, signal?: AbortSignal): Promise<void> {
    if (this.socket) throw new Error('OBS connection is already in use.');
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Enter an OBS WebSocket port from 1 to 65535.');
    if (typeof config.password !== 'string' || config.password.length > 1024) throw new Error('Enter a valid OBS WebSocket password.');
    if (signal?.aborted) throw new Error('OBS connection cancelled.');
    this.closed = false;
    const socket = this.socket = new WebSocket(`ws://127.0.0.1:${config.port}`);
    let password = config.password;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let helloReceived = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        password = '';
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.failConnect = undefined;
        if (error) { reject(error); this.close(); }
        else { this.ready = true; resolve(); }
      };
      const onAbort = () => finish(new Error('OBS connection cancelled.'));
      const timer = setTimeout(() => finish(new Error('OBS connection timed out. Open OBS and enable Tools > WebSocket Server Settings.')), this.timeoutMs);
      this.failConnect = finish;
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('message', (event) => {
        if (this.closed || typeof event.data !== 'string') return;
        // OBS screenshot responses can be larger; ordinary service replies are small.
        if (event.data.length > 8 * 1024 * 1024) { this.fail(new Error('OBS sent an oversized response.')); return; }
        try {
          const message = JSON.parse(event.data);
          const data = message.d;
          if (!data || typeof data !== 'object') throw new Error('Missing OBS message data.');
          if (message.op === 0 && !settled && !helloReceived) {
            helloReceived = true;
            if (typeof data.rpcVersion !== 'number' || data.rpcVersion < 1) throw new Error('OBS Studio 28 or newer with WebSocket v5 is required.');
            const auth = data.authentication;
            if (!auth || typeof auth.salt !== 'string' || typeof auth.challenge !== 'string') throw new Error('Enable authentication in OBS Tools > WebSocket Server Settings, then enter its password.');
            const secret = createHash('sha256').update(password + auth.salt).digest('base64');
            const authentication = createHash('sha256').update(secret + auth.challenge).digest('base64');
            password = '';
            socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: 71 /* General | Config | Scenes | Outputs */ } }));
          } else if (message.op === 2 && helloReceived && !settled) {
            if (data.negotiatedRpcVersion !== 1) throw new Error('OBS WebSocket protocol version is unsupported. Update OBS Studio.');
            finish();
          } else if (message.op === 7 && this.ready) {
            const request = this.pending.get(data.requestId);
            if (!request) return;
            clearTimeout(request.timer);
            this.pending.delete(data.requestId);
            if (data.requestStatus?.result === true) request.resolve(data.responseData ?? {});
            else request.reject(new ObsRequestError(String(data.requestType), Number(data.requestStatus?.code), String(data.requestStatus?.comment ?? 'Check OBS and try again.')));
          } else if (message.op === 5 && this.ready && typeof data.eventType === 'string') {
            this.options.onEvent?.(data.eventType, data.eventData ?? {});
          }
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error('OBS returned an invalid response.'));
        }
      });
      socket.addEventListener('error', () => this.fail(new Error('Could not connect to OBS. Keep OBS running and check its WebSocket port and server setting.')));
      socket.addEventListener('close', (event) => {
        const error = new Error(event.code === 4009
          ? 'OBS rejected the password. Copy it from Tools > WebSocket Server Settings.'
          : 'OBS disconnected. Keep OBS running and reconnect Photoshoot.');
        this.fail(error);
      });
    });
  }

  request(type: string, data: Data = {}): Promise<Data> {
    if (!this.ready || !this.socket || this.closed) return Promise.reject(new Error('OBS is disconnected.'));
    if (this.pending.size >= 32) return Promise.reject(new Error('OBS has too many pending requests.'));
    const requestId = randomUUID();
    return new Promise<Data>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS ${type} timed out. Check OBS and try again.`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('OBS is disconnected.')); }
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    const wasReady = this.ready;
    this.failConnect?.(error);
    this.close(error);
    if (wasReady) this.options.onDisconnect?.(error);
  }

  close(error = new Error('OBS connection cancelled.')): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.failConnect?.(error);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }
}
