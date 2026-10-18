import type { PersonMask } from './personSegmentationProtocol';

/**
 * Person confidence → mask alpha. A smoothstep over the 0.25–0.75 band: clear
 * background drops out completely (no ghost of the room where the model is
 * unsure, e.g. the shadow between two heads), clear person is fully opaque,
 * and the edge stays continuous.
 */
export function maskAlpha(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  const t = Math.max(0, Math.min(1, (confidence - 0.25) / 0.5));
  return Math.round(t * t * (3 - 2 * t) * 255);
}

/** How much of the previous mask carries into the next (reduces edge flicker). */
const TEMPORAL = 0.35;

export class BackgroundCompositor {
  readonly canvas = document.createElement('canvas');
  private foreground = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private maskFull = document.createElement('canvas');
  private backdrop = document.createElement('canvas');
  private work = document.createElement('canvas');
  private maskPixels: ImageData | null = null;
  private previous: Float32Array | null = null;

  draw(frame: CanvasImageSource, mask: PersonMask, width: number, height: number,
    background: CanvasImageSource | null, blur: number): void {
    for (const c of [this.canvas, this.foreground, this.maskFull, this.backdrop]) {
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
    }
    this.buildMask(mask, width, height);

    // Foreground: the frame cut out by the feathered mask.
    const fctx = this.foreground.getContext('2d')!;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, width, height);
    fctx.drawImage(frame, 0, 0, width, height);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(this.maskFull, 0, 0);
    fctx.globalCompositeOperation = 'source-over';

    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (background) ctx.drawImage(background, 0, 0, width, height);
    else this.drawBlurredBackground(ctx, frame, width, height, blur);
    ctx.drawImage(this.foreground, 0, 0);
  }

  /** Smooth the mask over time, convert to alpha and upscale with a feathered edge. */
  private buildMask(mask: PersonMask, width: number, height: number): void {
    if (!this.maskPixels || this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
      this.maskPixels = new ImageData(mask.width, mask.height);
      this.previous = null;
    }
    const prev = this.previous;
    const next = new Float32Array(mask.confidence.length);
    const pixels = this.maskPixels.data;
    for (let i = 0; i < next.length; i++) {
      const raw = Number.isFinite(mask.confidence[i]) ? mask.confidence[i] : 0;
      const c = prev ? prev[i] * TEMPORAL + raw * (1 - TEMPORAL) : raw;
      next[i] = c;
      const p = i * 4;
      pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
      pixels[p + 3] = maskAlpha(c);
    }
    this.previous = next;
    this.maskCanvas.getContext('2d')!.putImageData(this.maskPixels, 0, 0);

    // Upscaling a low-resolution mask leaves stair-steps; a feather of about
    // one source pixel turns them into a soft, natural edge.
    const feather = Math.max(0.75, (width / mask.width) * 0.6);
    const m = this.maskFull.getContext('2d')!;
    m.clearRect(0, 0, width, height);
    m.imageSmoothingEnabled = true;
    m.imageSmoothingQuality = 'high';
    m.filter = `blur(${feather}px)`;
    m.drawImage(this.maskCanvas, 0, 0, width, height);
    m.filter = 'none';
  }

  /**
   * Blur only the room. The person is cut out first and the hole is filled
   * from the surrounding background (wide blur under narrow blur), so dark
   * hair or clothes never bleed into the blur as a halo. Work happens at half
   * resolution; the result is blurred anyway.
   */
  private drawBlurredBackground(ctx: CanvasRenderingContext2D, frame: CanvasImageSource,
    width: number, height: number, blur: number): void {
    const radius = Math.max(4, Math.min(40, Number.isFinite(blur) ? blur : 18));
    const b = this.backdrop.getContext('2d')!;
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, width, height);
    b.drawImage(frame, 0, 0, width, height);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(this.maskFull, 0, 0);
    b.globalCompositeOperation = 'source-over';

    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    if (this.work.width !== w || this.work.height !== h) {
      this.work.width = w;
      this.work.height = h;
    }
    const r = radius / 2;
    const k = this.work.getContext('2d')!;
    k.clearRect(0, 0, w, h);
    // Widest first; each narrower pass sits on top and keeps local detail.
    for (const scale of [6, 2.5, 1]) {
      k.filter = `blur(${r * scale}px)`;
      k.drawImage(this.backdrop, 0, 0, w, h);
    }
    // Anything still transparent (the middle of a large subject, the frame
    // edge) gets the plain blurred frame underneath; the person covers it.
    k.globalCompositeOperation = 'destination-over';
    k.filter = `blur(${r * 3}px)`;
    k.drawImage(frame, -r * 2, -r * 2, w + r * 4, h + r * 4);
    k.globalCompositeOperation = 'source-over';
    k.filter = 'none';
    ctx.drawImage(this.work, 0, 0, width, height);
  }

  clear(): void {
    this.canvas.width = this.foreground.width = this.maskCanvas.width = 0;
    this.maskFull.width = this.backdrop.width = this.work.width = 0;
    this.maskPixels = null;
    this.previous = null;
  }
}
