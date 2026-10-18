import { app } from './app';
import { byId } from './dom';
import { BACKGROUND_BY_ID, getBackgroundCanvas, prepareBackground } from './backgrounds';
import { BackgroundCompositor } from './backgroundCompositor';
import { PersonSegmenter } from './personSegmentation';
import type { SegmentedFrame } from './personSegmentationProtocol';

/** Local person segmentation; selecting a background never needs an empty scene. */
export class BackgroundReplacer {
  active = false;
  backgroundId: string | null = null;
  lastError: string | null = null;
  onStop: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private compositor = new BackgroundCompositor();
  private segmenter = new PersonSegmenter();
  private generation = 0;
  private lastFrame = -1;
  private lastSubmit = 0;
  private size = { width: 0, height: 0 };
  private lastShown = -1;

  isActive(): boolean { return this.active; }

  async start(backgroundId: string): Promise<boolean> {
    this.stop();
    this.lastError = null;
    if (!BACKGROUND_BY_ID.has(backgroundId)) return false;
    if (app.video.readyState < 2 || !app.video.videoWidth || !app.video.videoHeight) {
      this.lastError = 'Backgrounds need the camera running.';
      return false;
    }
    const generation = this.generation;
    this.backgroundId = backgroundId;
    this.showGuide('Preparing person detection…');
    try {
      await Promise.all([this.segmenter.start(), prepareBackground(backgroundId)]);
      if (generation !== this.generation) return false;
      const result = await this.segmenter.segment(app.video);
      if (!result) return false;
      try {
        if (generation !== this.generation) return false;
        this.composite(result);
      } finally { result.frame.close(); }
      this.active = true;
      this.hideGuide();
      app.renderer.setSource(this.compositor.canvas);
      app.renderer.setFrameHook(() => this.update());
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.lastError = error instanceof Error ? error.message : 'Person detection is unavailable. Please try again.';
        this.stop();
      }
      return false;
    }
  }

  stop(): void {
    this.generation++;
    this.active = false;
    this.backgroundId = null;
    this.segmenter.stop();
    this.lastFrame = -1;
    this.lastSubmit = 0;
    this.size = { width: 0, height: 0 };
    this.lastShown = -1;
    app.renderer.setFrameHook(null);
    app.renderer.setSource(app.video);
    this.compositor.clear();
    this.hideGuide();
    this.onStop?.();
  }

  private showGuide(text: string): void {
    byId('bgGuideText').textContent = text;
    byId('bgGuide').classList.remove('hidden');
  }

  private hideGuide(): void { byId('bgGuide').classList.add('hidden'); }

  private composite(result: SegmentedFrame): void {
    const width = result.frame.width;
    const height = result.frame.height;
    this.size = { width, height };
    this.compositor.draw(result.frame, result.mask, width, height, this.background(width, height), app.settings.backgroundBlur);
  }

  /** Show the current camera frame with the latest mask (between model results). */
  private compositeLive(): void {
    const { width, height } = this.size;
    if (!width || !height || !this.compositor.hasMask) return;
    this.compositor.draw(app.video, null, width, height, this.background(width, height), app.settings.backgroundBlur);
  }

  private background(width: number, height: number): CanvasImageSource | null {
    if (this.backgroundId === 'blur') return null;
    const background = getBackgroundCanvas(this.backgroundId!, width, height);
    if (!background) throw new Error('This background could not be loaded.');
    return background;
  }

  private update(): void {
    if (!this.active) return;
    const video = app.video;
    if (video.readyState < 2 || !video.videoWidth || video.ended) {
      this.stop();
      this.onError?.('The background was turned off because the camera paused. Choose it again to continue.');
      return;
    }
    // Every new camera frame is shown at once with the latest mask.
    if (this.lastShown !== video.currentTime) {
      this.lastShown = video.currentTime;
      this.compositeLive();
    }
    if (this.segmenter.busy || this.lastFrame === video.currentTime) return;
    const now = performance.now();
    if (now - this.lastSubmit < 40) return;
    this.lastFrame = video.currentTime;
    this.lastSubmit = now;
    const generation = this.generation;
    void this.segmenter.segment(video).then((result) => {
      if (!result) return;
      try {
        if (generation === this.generation && this.active) this.composite(result);
      } finally { result.frame.close(); }
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.lastError = error instanceof Error ? error.message : 'Person detection stopped. Please try again.';
      this.stop();
      this.onError?.(this.lastError);
    });
  }
}
