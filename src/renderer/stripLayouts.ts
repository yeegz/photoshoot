// Four-photo sheet layouts, like the prints a real photo booth hands you:
// a 2×2 grid, the classic tall strip, a wide row, and one big photo over three
// small ones — each with a printed footer: your caption and the date in the
// font, size, colour and alignment you choose, and a small Photoshoot mark
// tucked in the corner. Geometry is pure so it can be unit-tested; the canvas
// compositor below only paints what the geometry says.

import type { StripAlign, StripFont, StripFrame, StripInk, StripLayout, StripTextSize } from '../shared/ipc-contract';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintOptions {
  name: boolean; // the small Photoshoot mark
  date: boolean;
  caption: string; // empty = no caption line
  rounded: boolean; // rounded photo corners
  font: StripFont;
  size: StripTextSize;
  ink: StripInk;
  align: StripAlign;
}

export const DEFAULT_PRINT: PrintOptions = {
  name: true,
  date: true,
  caption: '',
  rounded: false,
  font: 'classic',
  size: 'm',
  ink: 'auto',
  align: 'center',
};

export type FooterLine = 'name' | 'caption' | 'date';

export interface FooterText {
  kind: FooterLine;
  x: number; // anchor for the alignment below
  y: number; // baseline
  size: number;
  align: StripAlign;
}

export interface SheetGeometry {
  width: number;
  height: number;
  photos: Rect[]; // always four, in shot order
  footer: Rect | null; // the printed band under the photos
  lines: FooterText[];
}

export const LAYOUT_LABELS: Record<StripLayout, string> = {
  grid: 'Grid',
  strip: 'Strip',
  row: 'Row',
  feature: 'Feature',
};

export const FRAME_LABELS: Record<StripFrame, string> = {
  white: 'White',
  cream: 'Cream',
  blush: 'Blush',
  sky: 'Sky',
  black: 'Black',
};

export const FONT_LABELS: Record<StripFont, string> = {
  classic: 'Classic',
  modern: 'Modern',
  rounded: 'Rounded',
  typewriter: 'Typewriter',
  script: 'Script',
};

/** System typefaces only (nothing is downloaded); each falls back sensibly on Windows. */
export const FONT_STACKS: Record<StripFont, { family: string; style: string; weight: number }> = {
  classic: { family: '"New York", "Iowan Old Style", Georgia, "Times New Roman", serif', style: 'italic', weight: 500 },
  modern: { family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif', style: 'normal', weight: 600 },
  rounded: { family: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif', style: 'normal', weight: 700 },
  typewriter: { family: '"American Typewriter", "Courier New", Courier, monospace', style: 'normal', weight: 500 },
  script: { family: '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Apple Chancery", cursive', style: 'normal', weight: 600 },
};

export const INK_LABELS: Record<StripInk, string> = {
  auto: 'Match paper',
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  gold: 'Gold',
  pink: 'Pink',
};

export const INKS: Record<Exclude<StripInk, 'auto'>, string> = {
  red: '#c8102e',
  blue: '#1f5fbf',
  green: '#2e7d4f',
  gold: '#a8761b',
  pink: '#d4477f',
};

const TEXT_SCALE: Record<StripTextSize, number> = { s: 0.78, m: 1, l: 1.3 };

export const PAPER: Record<StripFrame, { paper: string; ink: string; soft: string }> = {
  white: { paper: '#ffffff', ink: '#1d1d1f', soft: '#86868b' },
  cream: { paper: '#f3ebdc', ink: '#4a3b28', soft: '#93826b' },
  blush: { paper: '#f7e1e1', ink: '#6e2f3a', soft: '#ad7b83' },
  sky: { paper: '#deebf6', ink: '#1f3f5c', soft: '#6f8aa3' },
  black: { paper: '#141414', ink: '#f5f5f7', soft: '#8e8e93' },
};

/** Which footer lines print: the main text top to bottom, then the small mark. */
export function footerLines(o: PrintOptions): FooterLine[] {
  const lines: FooterLine[] = [];
  if (o.caption.trim()) lines.push('caption');
  if (o.date) lines.push('date');
  if (o.name) lines.push('name');
  return lines;
}

/** Where each of four fw×fh photos sits on the sheet, plus the footer. */
export function sheetGeometry(layout: StripLayout, fw: number, fh: number, print: PrintOptions = DEFAULT_PRINT): SheetGeometry {
  const r = (n: number) => Math.round(n);
  let width: number;
  let photos: Rect[];
  let side: number;
  switch (layout) {
    case 'grid': {
      side = r(fw * 0.045);
      const gap = r(fw * 0.025);
      width = fw * 2 + gap + side * 2;
      photos = [0, 1, 2, 3].map((i) => ({ x: side + (i % 2) * (fw + gap), y: side + Math.floor(i / 2) * (fh + gap), w: fw, h: fh }));
      break;
    }
    case 'strip': {
      side = r(fw * 0.065);
      const gap = r(fw * 0.04);
      width = fw + side * 2;
      photos = [0, 1, 2, 3].map((i) => ({ x: side, y: side + i * (fh + gap), w: fw, h: fh }));
      break;
    }
    case 'row': {
      side = r(fw * 0.06);
      const gap = r(fw * 0.04);
      width = side * 2 + fw * 4 + gap * 3;
      photos = [0, 1, 2, 3].map((i) => ({ x: side + i * (fw + gap), y: side, w: fw, h: fh }));
      break;
    }
    case 'feature': {
      side = r(fw * 0.055);
      const gap = r(fw * 0.03);
      const sw = r((fw - gap * 2) / 3);
      const sh = r((sw * fh) / fw);
      width = fw + side * 2;
      photos = [
        { x: side, y: side, w: fw, h: fh },
        ...[0, 1, 2].map((i) => ({ x: side + i * (sw + gap), y: side + fh + gap, w: sw, h: sh })),
      ];
      break;
    }
  }
  const photosBottom = Math.max(...photos.map((p) => p.y + p.h));
  const kinds = footerLines(print);
  if (kinds.length === 0) {
    return { width, height: photosBottom + side, photos, footer: null, lines: [] };
  }
  const scale = TEXT_SCALE[print.size];
  const left = side;
  const right = width - side;
  const anchorX = (a: StripAlign) => (a === 'left' ? left : a === 'right' ? right : width / 2);
  const lines: FooterText[] = [];
  const main = kinds.filter((k) => k !== 'name');
  let y = photosBottom + r(fh * (main.length ? 0.12 : 0.08));
  main.forEach((kind, i) => {
    const size = r(fh * (kind === 'caption' ? 0.13 : 0.075) * scale);
    if (i > 0) y += r(fh * 0.045 * scale);
    y += size;
    lines.push({ kind, x: anchorX(print.align), y, size, align: print.align });
  });
  if (print.name) {
    // A small mark on the side: the corner opposite the text, or centred alone.
    const size = r(fh * 0.055);
    const align: StripAlign = !main.length ? 'center' : print.align === 'right' ? 'left' : 'right';
    y += r(fh * (main.length ? 0.09 : 0)) + size;
    lines.push({ kind: 'name', x: anchorX(align), y, size, align });
  }
  const height = y + r(fh * (main.length ? 0.1 : 0.08));
  return {
    width,
    height,
    photos,
    footer: { x: side, y: photosBottom, w: width - side * 2, h: height - photosBottom },
    lines,
  };
}

/** The date line, e.g. "26 October 2026" in the viewer's own order. */
export function captionDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// The app's camera glyph (same drawing as the shutter), on a 28-unit grid.
const CAMERA = 'M9.6 5.4 8.4 7H5A2.2 2.2 0 0 0 2.8 9.2V19.4A2.2 2.2 0 0 0 5 21.6H23A2.2 2.2 0 0 0 25.2 19.4V9.2A2.2 2.2 0 0 0 23 7H19.6L18.4 5.4Z M14 9.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Z M14 11.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z';

const MARK_FONT = '600 {size}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Paint four captured frames onto a sheet. */
export function composeSheet(
  frames: CanvasImageSource[],
  fw: number,
  fh: number,
  layout: StripLayout,
  frame: StripFrame,
  print: PrintOptions = DEFAULT_PRINT,
  date = new Date()
): HTMLCanvasElement {
  const g = sheetGeometry(layout, fw, fh, print);
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
    if (!src) return;
    ctx.save();
    if (print.rounded) {
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, Math.round(Math.min(rect.w, rect.h) * 0.06));
      ctx.clip();
    }
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  });

  const maxW = (g.footer?.w ?? g.width) * 0.96;
  const face = FONT_STACKS[print.font];
  const ink = print.ink === 'auto' ? colors.ink : INKS[print.ink];
  ctx.textBaseline = 'alphabetic';
  for (const line of g.lines) {
    if (line.kind === 'name') {
      // Small camera glyph + "Photoshoot" in the paper's soft tone.
      ctx.font = MARK_FONT.replace('{size}', String(line.size));
      const text = 'Photoshoot';
      const textW = ctx.measureText(text).width;
      const glyph = line.size * 1.05;
      const gap = line.size * 0.35;
      const total = glyph + gap + textW;
      const startX = line.align === 'left' ? line.x : line.align === 'right' ? line.x - total : line.x - total / 2;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colors.soft;
      ctx.translate(startX, line.y - line.size * 0.86);
      ctx.scale(glyph / 28, glyph / 28);
      ctx.fill(new Path2D(CAMERA), 'evenodd');
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colors.soft;
      ctx.textAlign = 'left';
      ctx.fillText(text, startX + glyph + gap, line.y);
      ctx.restore();
      continue;
    }
    ctx.textAlign = line.align;
    if (line.kind === 'caption') {
      ctx.font = `${face.style} ${face.weight} ${line.size}px ${face.family}`;
      ctx.fillStyle = ink;
      ctx.fillText(fitText(ctx, print.caption.trim(), maxW), line.x, line.y);
    } else {
      ctx.font = `${face.style === 'italic' ? 'normal' : face.style} 500 ${line.size}px ${face.family}`;
      ctx.fillStyle = print.ink === 'auto' ? colors.soft : ink;
      ctx.globalAlpha = print.ink === 'auto' ? 1 : 0.8;
      ctx.fillText(captionDate(date), line.x, line.y);
      ctx.globalAlpha = 1;
    }
  }
  return canvas;
}
