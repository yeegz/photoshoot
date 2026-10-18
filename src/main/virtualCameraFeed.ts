import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { VIRTUAL_CAMERA_MAX_FPS, VIRTUAL_CAMERA_MAX_FRAME_BYTES, VIRTUAL_CAMERA_MAX_HEIGHT, VIRTUAL_CAMERA_MAX_WIDTH } from '../shared/virtual-camera';

// A solid, neutral 8x8 JPEG. Sent before disconnect so an MJPEG decoder cannot retain a private frame.
const NEUTRAL_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKKYj//2Q==', 'base64');

function validJpeg(frame: Uint8Array): boolean {
  if (frame.byteLength < 12 || frame.byteLength > VIRTUAL_CAMERA_MAX_FRAME_BYTES) return false;
  if (frame[0] !== 0xff || frame[1] !== 0xd8 || frame[frame.length - 2] !== 0xff || frame[frame.length - 1] !== 0xd9) return false;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = 2;
  while (offset + 8 < frame.length) {
    if (frame[offset++] !== 0xff) return false;
    while (frame[offset] === 0xff) offset++;
    const marker = frame[offset++];
    if (marker === 0xda || marker === 0xd9) return false;
    if (offset + 2 > frame.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > frame.length) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8) return false;
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      return height > 0 && height <= VIRTUAL_CAMERA_MAX_HEIGHT && width > 0 && width <= VIRTUAL_CAMERA_MAX_WIDTH;
    }
    offset += length;
  }
  return false;
}

/** No external network interface, disk frame storage, or unbounded frame queue. */
export class VirtualCameraFeed {
  private server?: Server;
  private root = '';
  private host = '';
  private current?: Buffer;
  private lastFrameAt = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private clients = new Set<ServerResponse>();
  private consumerWaiters = new Set<(error?: Error) => void>();
  private readonly staleMs: number;

  constructor(private readonly options: { staleMs?: number; onStale?: () => void } = {}) { this.staleMs = options.staleMs ?? 2500; }

  async start(): Promise<string> {
    if (this.server) throw new Error('The virtual camera feed is already running.');
    this.root = `/${randomBytes(24).toString('hex')}/`;
    const server = this.server = createServer((req, res) => this.handle(req, res));
    server.maxConnections = 12;
    server.headersTimeout = 5000;
    server.requestTimeout = 5000;
    server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not open the local camera feed.');
    this.host = `127.0.0.1:${address.port}`;
    this.watchdog = setInterval(() => {
      if (this.current && Date.now() - this.lastFrameAt > this.staleMs) {
        this.clearFrame();
        this.options.onStale?.();
      }
    }, Math.min(250, this.staleMs / 2));
    this.watchdog.unref();
    return `http://${this.host}${this.root}`;
  }

  pushFrame(frame: Uint8Array): boolean {
    if (!this.server || !(frame instanceof Uint8Array) || !validJpeg(frame)) return false;
    const now = Date.now();
    if (this.current && now - this.lastFrameAt < 1000 / VIRTUAL_CAMERA_MAX_FPS) return false;
    this.lastFrameAt = now;
    this.current = Buffer.from(frame);
    this.broadcast(this.current);
    return true;
  }

  private sendFrame(res: ServerResponse, frame: Buffer): void {
    // A slow receiver gets disconnected, never an ever-growing queue of private images.
    if (res.destroyed || res.writableLength > VIRTUAL_CAMERA_MAX_FRAME_BYTES + 1024) { res.destroy(); this.clients.delete(res); return; }
    const part = Buffer.concat([Buffer.from(`--photoshoot\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`), frame, Buffer.from('\r\n')]);
    res.write(part);
  }

  private broadcast(frame: Buffer): void { for (const client of this.clients) this.sendFrame(client, frame); }

  private clearFrame(): void { this.current = undefined; this.lastFrameAt = 0; this.broadcast(NEUTRAL_JPEG); }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== this.host || (req.headers.origin && req.headers.origin !== `http://${this.host}`)) {
      res.writeHead(403).end(); return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url === this.root) {
      const nonce = randomBytes(16).toString('base64');
      res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Independent browser watchdog hides the last image even if the main process crashes.
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#181a1e}img{width:100%;height:100%;object-fit:contain;visibility:hidden}</style></head><body><img id="camera" src="stream" alt=""><script nonce="${nonce}">const camera=document.getElementById('camera');camera.onerror=()=>camera.style.visibility='hidden';async function check(){try{const result=await fetch('status',{cache:'no-store',signal:AbortSignal.timeout(1000)});const state=await result.json();camera.style.visibility=state.live?'visible':'hidden';}catch{camera.style.visibility='hidden';}setTimeout(check,250);}check();</script></body></html>`);
    } else if (req.url === `${this.root}status`) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ live: !!this.current && Date.now() - this.lastFrameAt <= this.staleMs }));
    } else if (req.url === `${this.root}stream`) {
      if (this.clients.size >= 2) { res.writeHead(503).end(); return; }
      res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=photoshoot');
      res.setHeader('Connection', 'close');
      res.flushHeaders();
      this.clients.add(res);
      res.once('close', () => this.clients.delete(res));
      this.sendFrame(res, this.current ?? NEUTRAL_JPEG);
      for (const waiter of [...this.consumerWaiters]) waiter();
    } else { res.writeHead(404).end(); }
  }

  waitForConsumer(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error('Virtual camera setup cancelled.'));
    if (this.clients.size) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.consumerWaiters.delete(finish);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new Error('Virtual camera setup cancelled.'));
      const timer = setTimeout(() => finish(new Error('OBS Browser source did not load. Install the standard OBS Studio build with Browser Source support, then retry.')), timeoutMs);
      this.consumerWaiters.add(finish);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async stop(): Promise<void> {
    clearInterval(this.watchdog);
    this.clearFrame();
    for (const waiter of [...this.consumerWaiters]) waiter(new Error('Virtual camera setup cancelled.'));
    for (const client of this.clients) client.end('--photoshoot--\r\n');
    this.clients.clear();
    const server = this.server;
    this.server = undefined;
    this.root = '';
    if (server) await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Idle/unresponsive local HTTP clients cannot delay quit indefinitely.
      server.closeAllConnections();
    });
  }
}
