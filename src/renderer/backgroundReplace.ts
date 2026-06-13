// Classic background replacement. We capture a reference frame of the empty
// scene, then every frame compare the live image to it: pixels close to the
// reference are "background" and get replaced; different pixels are "you".
//
// Performance: the per-pixel comparison runs on a small (~192px) sampled canvas
// — the only place we deliberately use a CPU pixel loop, exactly as the brief
// allows. The resulting low-res mask is scaled up by the GPU during compositing,
// which also softens the matte edges for free. The composited full-res canvas is
// then fed to the WebGL pipeline so effects + mirror still apply on top.

import { app } from './app';
import { sound } from './sound';
import { byId } from './dom';
import { getBackgroundCanvas } from './backgrounds';

const SAMPLE_WIDTH = 192;

export class BackgroundReplacer {
  active = false;
  backgroundId: string | null = null;

  private composite = document.createElement('canvas');
  private tmp = document.createElement('canvas');
  private sample = document.createElement('canvas');
  private mask = document.createElement('canvas');
  private refData: Uint8ClampedArray | null = null;
  private lw = 0;
  private lh = 0;

  private guide = byId('bgGuide');
  private guideText = byId('bgGuideText');

  isActive(): boolean {
    return this.active;
  }

  private setupSizes(): boolean {
    const w = app.video.videoWidth;
    const h = app.video.videoHeight;
    if (!w || !h) return false;
    this.composite.width = w;
    this.composite.height = h;
    this.tmp.width = w;
    this.tmp.height = h;
    this.lw = SAMPLE_WIDTH;
    this.lh = Math.max(1, Math.round((SAMPLE_WIDTH * h) / w));
    this.sample.width = this.lw;
    this.sample.height = this.lh;
    this.mask.width = this.lw;
    this.mask.height = this.lh;
    return true;
  }

  private showGuide(text: string): void {
    this.guideText.textContent = text;
    this.guide.classList.remove('hidden');
  }

  private hideGuide(): void {
    this.guide.classList.add('hidden');
  }

  async start(backgroundId: string): Promise<boolean> {
    if (!this.setupSizes()) return false;
    this.backgroundId = backgroundId;

    // Step out + countdown.
    this.showGuide('Step out of the frame…');
    await wait(900);
    for (let n = 3; n >= 1; n--) {
      this.showGuide(`Capturing the empty scene in ${n}…`);
      sound.play('tick');
      await wait(800);
    }

    this.captureReference();

    this.showGuide('Now step back in.');
    await wait(1400);
    this.hideGuide();

    this.active = true;
    app.renderer.setSource(this.composite);
    app.renderer.setFrameHook(() => this.update());
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.backgroundId = null;
    this.refData = null;
    app.renderer.setFrameHook(null);
    app.renderer.setSource(app.video);
    this.hideGuide();
  }

  private captureReference(): void {
    const ctx = this.sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(app.video, 0, 0, this.lw, this.lh);
    this.refData = ctx.getImageData(0, 0, this.lw, this.lh).data.slice();
  }

  private update(): void {
    if (!this.active || !this.refData || !this.backgroundId) return;
    const sctx = this.sample.getContext('2d', { willReadFrequently: true });
    const mctx = this.mask.getContext('2d');
    const cctx = this.composite.getContext('2d');
    const tctx = this.tmp.getContext('2d');
    if (!sctx || !mctx || !cctx || !tctx) return;

    const W = this.composite.width;
    const H = this.composite.height;

    // 1) Sample current frame small and diff against the reference.
    sctx.drawImage(app.video, 0, 0, this.lw, this.lh);
    const cur = sctx.getImageData(0, 0, this.lw, this.lh);
    const ref = this.refData;
    const data = cur.data;
    const tol = app.settings.bgTolerance * 3 * 255; // sum-of-channels threshold
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - ref[i]) + Math.abs(data[i + 1] - ref[i + 1]) + Math.abs(data[i + 2] - ref[i + 2]);
      const foreground = d > tol;
      // White + opaque where it's you; transparent where it's background.
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = foreground ? 255 : 0;
    }
    mctx.putImageData(cur, 0, 0);

    // 2) Composite: background, then the masked person on top.
    const bg = getBackgroundCanvas(this.backgroundId, W, H);
    if (bg) cctx.drawImage(bg, 0, 0, W, H);
    else {
      cctx.fillStyle = '#101018';
      cctx.fillRect(0, 0, W, H);
    }

    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(app.video, 0, 0, W, H);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(this.mask, 0, 0, W, H); // upscaled mask softens the matte
    tctx.globalCompositeOperation = 'source-over';

    cctx.drawImage(this.tmp, 0, 0);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
