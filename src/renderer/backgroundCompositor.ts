import type { PersonMask } from './personSegmentationProtocol';

/** Confidence stays continuous at the edge, with certain pixels fully opaque. */
export function maskAlpha(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  const t = Math.max(0, Math.min(1, (confidence - 0.15) / 0.7));
  return Math.round(t * t * (3 - 2 * t) * 255);
}

export class BackgroundCompositor {
  readonly canvas = document.createElement('canvas');
  private foreground = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private maskPixels: ImageData | null = null;

  draw(frame: CanvasImageSource, mask: PersonMask, width: number, height: number,
    background: CanvasImageSource | null, blur: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = this.foreground.width = width;
      this.canvas.height = this.foreground.height = height;
    }
    if (!this.maskPixels || this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
      this.maskPixels = new ImageData(mask.width, mask.height);
    }
    const pixels = this.maskPixels.data;
    for (let i = 0; i < mask.confidence.length; i++) {
      const p = i * 4;
      pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
      pixels[p + 3] = maskAlpha(mask.confidence[i]);
    }
    const mctx = this.maskCanvas.getContext('2d')!;
    const fctx = this.foreground.getContext('2d')!;
    const ctx = this.canvas.getContext('2d')!;
    mctx.putImageData(this.maskPixels, 0, 0);
    fctx.clearRect(0, 0, width, height);
    fctx.drawImage(frame, 0, 0, width, height);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.imageSmoothingEnabled = true;
    fctx.drawImage(this.maskCanvas, 0, 0, width, height);
    fctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    if (background) ctx.drawImage(background, 0, 0, width, height);
    else {
      const radius = Math.max(4, Math.min(40, Number.isFinite(blur) ? blur : 18));
      ctx.save();
      ctx.filter = `blur(${radius}px)`;
      // Overscan prevents the transparent canvas edge from darkening the blur.
      const pad = radius * 2;
      ctx.drawImage(frame, -pad, -pad, width + pad * 2, height + pad * 2);
      ctx.restore();
    }
    ctx.drawImage(this.foreground, 0, 0);
  }

  clear(): void {
    this.canvas.width = this.foreground.width = this.maskCanvas.width = 0;
    this.maskPixels = null;
  }
}
