// Four-photo sheet layouts, like the prints a real photo booth hands you:
// a 2×2 grid, the classic tall strip with a date line, a wide row, and one big
// photo over three small ones. Geometry is pure so it can be unit-tested; the
// canvas compositor below only paints what the geometry says.

import type { StripFrame, StripLayout } from '../shared/ipc-contract';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetGeometry {
  width: number;
  height: number;
  photos: Rect[]; // always four, in shot order
  caption: Rect | null; // the date line under the classic strip
}

export const LAYOUT_LABELS: Record<StripLayout, string> = {
  grid: 'Grid',
  strip: 'Strip',
  row: 'Row',
  feature: 'Feature',
};

export const FRAME_LABELS: Record<StripFrame, string> = {
  white: 'White',
  black: 'Black',
  cream: 'Cream',
};

const PAPER: Record<StripFrame, { paper: string; ink: string }> = {
  white: { paper: '#ffffff', ink: '#3a3a3c' },
  black: { paper: '#141414', ink: '#d1d1d6' },
  cream: { paper: '#f2e9d8', ink: '#6b5a43' },
};

/** Where each of four fw×fh photos sits on the sheet. */
export function sheetGeometry(layout: StripLayout, fw: number, fh: number): SheetGeometry {
  const r = (n: number) => Math.round(n);
  switch (layout) {
    case 'grid': {
      // Photo Booth's sheet: four pictures, one thin white border.
      const gap = Math.max(4, r(fw * 0.012));
      return {
        width: fw * 2 + gap * 3,
        height: fh * 2 + gap * 3,
        photos: [0, 1, 2, 3].map((i) => ({
          x: gap + (i % 2) * (fw + gap),
          y: gap + Math.floor(i / 2) * (fh + gap),
          w: fw,
          h: fh,
        })),
        caption: null,
      };
    }
    case 'strip': {
      const side = r(fw * 0.07);
      const gap = r(fw * 0.045);
      const captionH = r(fw * 0.2);
      return {
        width: fw + side * 2,
        height: side + fh * 4 + gap * 3 + captionH,
        photos: [0, 1, 2, 3].map((i) => ({ x: side, y: side + i * (fh + gap), w: fw, h: fh })),
        caption: { x: side, y: side + fh * 4 + gap * 3, w: fw, h: captionH },
      };
    }
    case 'row': {
      const side = r(fw * 0.06);
      const gap = r(fw * 0.04);
      return {
        width: side * 2 + fw * 4 + gap * 3,
        height: side * 2 + fh,
        photos: [0, 1, 2, 3].map((i) => ({ x: side + i * (fw + gap), y: side, w: fw, h: fh })),
        caption: null,
      };
    }
    case 'feature': {
      const side = r(fw * 0.05);
      const gap = r(fw * 0.03);
      const sw = r((fw - gap * 2) / 3);
      const sh = r((sw * fh) / fw);
      return {
        width: fw + side * 2,
        height: side * 2 + fh + gap + sh,
        photos: [
          { x: side, y: side, w: fw, h: fh },
          ...[0, 1, 2].map((i) => ({ x: side + i * (sw + gap), y: side + fh + gap, w: sw, h: sh })),
        ],
        caption: null,
      };
    }
  }
}

/** The date line printed under the strip, e.g. "26 October 2026". */
export function captionText(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Paint four captured frames onto a sheet. */
export function composeSheet(
  frames: CanvasImageSource[],
  fw: number,
  fh: number,
  layout: StripLayout,
  frame: StripFrame,
  date = new Date()
): HTMLCanvasElement {
  const g = sheetGeometry(layout, fw, fh);
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext('2d')!;
  const colors = PAPER[frame];
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, g.width, g.height);
  ctx.imageSmoothingQuality = 'high';
  g.photos.forEach((rect, i) => {
    const src = frames[i];
    if (src) ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
  });
  if (g.caption) {
    const c = g.caption;
    ctx.fillStyle = colors.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.round(c.h * 0.24)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(captionText(date), c.x + c.w / 2, c.y + c.h * 0.5);
  }
  return canvas;
}
