import type { SegmentedFrame, SegmenterRequest, SegmenterResponse } from './personSegmentationProtocol';

// Set by the build: a content-hashed name on the web, a fixed name in Electron.
declare const __SEGMENTER_WORKER__: string | undefined;
const WORKER_FILE = typeof __SEGMENTER_WORKER__ === 'string' ? __SEGMENTER_WORKER__ : 'personSegmentation.worker.js';


/** One worker, one transferable frame in flight, and no queued video frames. */
export class PersonSegmenter {
  private worker: Worker | null = null;
  private ready = false;
  private loading: Promise<void> | null = null;
  private pending: { resolve: (frame: SegmentedFrame) => void; reject: (error: Error) => void } | null = null;
  private finishLoad: (() => void) | null = null;
  private failLoad: ((error: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private capturing = false;
  private generation = 0;

  get busy(): boolean { return this.capturing || this.pending !== null; }

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = new Promise<void>((resolve, reject) => {
      this.finishLoad = resolve;
      this.failLoad = reject;
    });
    const loading = this.loading;
    try {
      this.worker = new Worker(new URL(WORKER_FILE, document.baseURI));
      this.worker.onmessage = ({ data }: MessageEvent<SegmenterResponse>) => {
        if (data.type === 'ready') {
          this.clearTimer();
          this.ready = true;
          this.finishLoad?.();
          this.finishLoad = this.failLoad = null;
        } else if (data.type === 'result') {
          this.clearTimer();
          const pending = this.pending;
          this.pending = null;
          if (pending) pending.resolve(data);
          else data.frame.close();
        } else this.dispose(new Error(data.message));
      };
      this.worker.onerror = () => this.dispose(new Error('Person detection could not start. Please try again.'));
      this.worker.onmessageerror = () => this.dispose(new Error('Person detection lost its frame. Please try again.'));
      this.timer = setTimeout(() => this.dispose(new Error('Person detection took too long to load. Please try again.')), 20000);
      this.post({ type: 'init', baseUrl: document.baseURI });
    } catch (error) {
      this.dispose(error instanceof Error ? error : new Error('Person detection is unavailable.'));
    }
    return loading;
  }

  async segment(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<SegmentedFrame | null> {
    if (!this.ready || this.busy) return null;
    const generation = this.generation;
    this.capturing = true;
    let frame: ImageBitmap;
    try {
      frame = await createImageBitmap(source);
    } finally {
      if (generation === this.generation) this.capturing = false;
    }
    if (generation !== this.generation || !this.ready) {
      frame.close();
      return null;
    }
    return new Promise<SegmentedFrame>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => this.dispose(new Error('Person detection stopped responding. Please try again.')), 10000);
      try {
        this.post({ type: 'frame', frame, timestamp: performance.now() }, [frame]);
      } catch (error) {
        frame.close();
        this.dispose(error instanceof Error ? error : new Error('Could not process the camera frame.'));
      }
    });
  }

  stop(): void { this.dispose(new DOMException('Person detection cancelled.', 'AbortError')); }

  private post(message: SegmenterRequest, transfer: Transferable[] = []): void {
    if (!this.worker) throw new Error('Person detection is unavailable.');
    this.worker.postMessage(message, transfer);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private dispose(error: Error): void {
    this.generation++;
    this.clearTimer();
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.capturing = false;
    this.failLoad?.(error);
    this.pending?.reject(error);
    this.finishLoad = this.failLoad = null;
    this.pending = null;
    this.loading = null;
  }
}
