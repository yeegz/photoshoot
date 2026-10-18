import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { VirtualCameraFeed } from '../../src/main/virtualCameraFeed';

const jpeg = readFileSync(new URL('../fixtures/virtual-camera-pink.jpg', import.meta.url));
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

describe('protected local camera feed', () => {
  it('requires the token, exact loopback Host, and rejects foreign origins', async () => {
    const feed = new VirtualCameraFeed();
    cleanup.push(() => feed.stop());
    const url = await feed.start();
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    expect(await page.text()).toContain('<img');
    expect((await fetch(new URL('/', url))).status).toBe(404);
    expect((await fetch(url, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(forgedHost).toBe(403);
  });

  it('delivers actual JPEG bytes and clears stale frames before notifying source loss', async () => {
    let stale = false;
    const feed = new VirtualCameraFeed({ staleMs: 100, onStale: () => { stale = true; } });
    cleanup.push(() => feed.stop());
    const url = await feed.start();
    expect(feed.pushFrame(jpeg)).toBe(true);
    const response = await fetch(new URL('stream', url));
    const reader = response.body!.getReader();
    cleanup.push(() => reader.cancel());
    await feed.waitForConsumer(300);
    const first = await reader.read();
    expect(Buffer.from(first.value!).includes(jpeg)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(stale).toBe(true);
    const status = await (await fetch(new URL('status', url))).json();
    expect(status.live).toBe(false);
    const neutral = await reader.read();
    expect(Buffer.from(neutral.value!).includes(jpeg)).toBe(false);
    expect(Buffer.from(neutral.value!).toString('ascii')).toContain('Content-Type: image/jpeg');
  });

  it('rejects non-JPEG, oversized, over-resolution, and excess-rate frames', async () => {
    const feed = new VirtualCameraFeed();
    cleanup.push(() => feed.stop());
    await feed.start();
    expect(feed.pushFrame(Buffer.from('not a jpeg'))).toBe(false);
    expect(feed.pushFrame(Buffer.alloc(600_000))).toBe(false);
    const hugeDimensions = Buffer.from(jpeg);
    const sof = hugeDimensions.indexOf(Buffer.from([0xff, 0xc0]));
    hugeDimensions.writeUInt16BE(8000, sof + 5);
    expect(feed.pushFrame(hugeDimensions)).toBe(false);
    expect(feed.pushFrame(jpeg)).toBe(true);
    expect(feed.pushFrame(jpeg)).toBe(false);
  });

  it('bounds concurrent consumers and closes its listener on stop', async () => {
    const feed = new VirtualCameraFeed();
    cleanup.push(() => feed.stop());
    const url = await feed.start();
    const one = await fetch(new URL('stream', url));
    const two = await fetch(new URL('stream', url));
    cleanup.push(() => one.body!.cancel());
    cleanup.push(() => two.body!.cancel());
    expect((await fetch(new URL('stream', url))).status).toBe(503);
    await feed.stop();
    expect(feed.pushFrame(jpeg)).toBe(false);
    await expect(fetch(url)).rejects.toThrow();
  });
});
