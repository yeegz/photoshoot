import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskAlpha } from '../../src/renderer/backgroundCompositor';
import { BACKGROUNDS, MAX_BACKGROUND_BYTES, loadCustomBackground, validateBackgroundFile } from '../../src/renderer/backgrounds';
import { PersonSegmenter } from '../../src/renderer/personSegmentation';
import type { SegmenterResponse } from '../../src/renderer/personSegmentationProtocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: SegmenterResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  emit(data: SegmenterResponse): void { this.onmessage?.({ data }); }
}

function client(): { segmenter: PersonSegmenter; ready: Promise<void>; worker: FakeWorker } {
  vi.stubGlobal('document', { baseURI: 'https://photoshoot.test/app/' });
  vi.stubGlobal('Worker', FakeWorker);
  const segmenter = new PersonSegmenter();
  const ready = segmenter.start();
  const worker = FakeWorker.instances.at(-1)!;
  return { segmenter, ready, worker };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });

describe('background choices and input boundaries', () => {
  it('offers useful local background modes', () => {
    expect(BACKGROUNDS.map(({ id }) => id)).toEqual(['blur', 'studio', 'paper', 'slate', 'room', 'custom']);
  });
  it('rejects executable/non-image inputs, empty or oversized photos', () => {
    for (const type of ['image/svg+xml', 'text/html', 'image/gif', '']) {
      expect(() => validateBackgroundFile({ type, size: 12 })).toThrow('JPG, PNG or WebP');
    }
    expect(() => validateBackgroundFile({ type: 'image/png', size: 0 })).toThrow('10 MB');
    expect(() => validateBackgroundFile({ type: 'image/png', size: MAX_BACKGROUND_BYTES + 1 })).toThrow('10 MB');
    expect(() => validateBackgroundFile({ type: 'image/jpeg', size: MAX_BACKGROUND_BYTES })).not.toThrow();
  });
  it('keeps certain foreground sharp with a continuous uncertain edge', () => {
    expect(maskAlpha(0)).toBe(0);
    expect(maskAlpha(0.5)).toBe(128);
    expect(maskAlpha(1)).toBe(255);
    expect(maskAlpha(Number.NaN)).toBe(0);
    expect(maskAlpha(0.4)).toBeLessThan(maskAlpha(0.6));
  });
  it('rejects decoded oversized images and releases the bitmap', async () => {
    const bitmap = { width: 10000, height: 10000, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    await expect(loadCustomBackground({ size: 100, type: 'image/jpeg' } as File)).rejects.toThrow('32 megapixels');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});

describe('person worker lifecycle', () => {
  it('shares initialization and rejects it promptly when stopped', async () => {
    const { segmenter, ready, worker } = client();
    expect(segmenter.start()).toBe(ready);
    const rejected = expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    segmenter.stop();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });
  it('bounds frame capture and worker processing to one, closing late bitmaps after stop', async () => {
    const { segmenter, ready, worker } = client();
    worker.emit({ type: 'ready' });
    await ready;
    let finish!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((resolve) => { finish = resolve; })));
    const first = segmenter.segment({} as HTMLCanvasElement);
    expect(await segmenter.segment({} as HTMLCanvasElement)).toBeNull();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    segmenter.stop();
    finish(bitmap);
    expect(await first).toBeNull();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledTimes(1); // init only, no stale frame
  });
  it('cancels a submitted frame and permits a fresh worker after model failure', async () => {
    const { segmenter, ready, worker } = client();
    worker.emit({ type: 'ready' });
    await ready;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const frame = segmenter.segment({} as HTMLCanvasElement);
    await Promise.resolve();
    expect(segmenter.busy).toBe(true);
    expect(await segmenter.segment({} as HTMLCanvasElement)).toBeNull();
    const failed = expect(frame).rejects.toThrow('model failed');
    worker.emit({ type: 'error', message: 'model failed' });
    await failed;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = segmenter.start();
    FakeWorker.instances.at(-1)!.emit({ type: 'ready' });
    await retry;
    expect(FakeWorker.instances).toHaveLength(2);
    segmenter.stop();
  });
  it('times out worker initialization and inference instead of hanging selection', async () => {
    vi.useFakeTimers();
    const { segmenter, ready } = client();
    const failed = expect(ready).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(20000);
    await failed;
    const retry = segmenter.start();
    FakeWorker.instances.at(-1)!.emit({ type: 'ready' });
    await retry;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const pending = expect(segmenter.segment({} as HTMLCanvasElement)).rejects.toThrow('stopped responding');
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    segmenter.stop();
  });
});
