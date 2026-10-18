// Calm, useful backdrops shared by the app and its landing-page previews.
// DOM/image work is lazy so importing this registry has no browser side effects.
export interface BackgroundDef {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

function studio(colors: [string, string, string]): BackgroundDef['draw'] {
  return (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w * 0.45, h * 0.32, 0, w * 0.5, h * 0.4, w * 0.85);
    colors.forEach((color, index) => gradient.addColorStop(index / 2, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  };
}

let roomImage: HTMLImageElement | null = null;
let roomLoading: Promise<void> | null = null;
let customImage: HTMLCanvasElement | null = null;
let customLoad = 0;
const cache = new Map<string, HTMLCanvasElement>();

function cover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, iw: number, ih: number, w: number, h: number): void {
  const scale = Math.max(w / iw, h / ih);
  ctx.drawImage(image, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
}

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'blur', label: 'Background blur',
    draw(ctx, w, h) {
      studio(['#c9cbc5', '#949d99', '#616f6e'])(ctx, w, h);
      ctx.save();
      ctx.filter = `blur(${w * 0.045}px)`;
      ctx.fillStyle = '#e4ddd0';
      ctx.fillRect(w * 0.13, h * 0.15, w * 0.27, h * 0.68);
      ctx.fillStyle = '#596861';
      ctx.beginPath();
      ctx.ellipse(w * 0.83, h * 0.65, w * 0.18, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },
  { id: 'studio', label: 'Soft studio', draw: studio(['#ebe9e4', '#d5d3ce', '#b5b4b0']) },
  { id: 'paper', label: 'Warm paper', draw: studio(['#f3e9db', '#dfcfba', '#b8a58e']) },
  { id: 'slate', label: 'Slate', draw: studio(['#697678', '#414e51', '#253134']) },
  {
    id: 'room', label: 'Quiet room',
    draw(ctx, w, h) {
      if (roomImage) cover(ctx, roomImage, roomImage.naturalWidth, roomImage.naturalHeight, w, h);
      else studio(['#e6dfd1', '#c6bdab', '#9d9f90'])(ctx, w, h);
    },
  },
  {
    id: 'custom', label: 'Your photo…',
    draw(ctx, w, h) {
      if (customImage) cover(ctx, customImage, customImage.width, customImage.height, w, h);
      else {
        studio(['#dddeda', '#bfc5bf', '#969f99'])(ctx, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = Math.max(1.5, w / 150);
        // A photo-with-plus glyph in the upper third, clear of the tile's
        // centred label.
        const s = Math.min(w, h) * 0.2;
        const cx = w / 2;
        const cy = h * 0.27;
        ctx.beginPath();
        ctx.roundRect(cx - s * 0.6, cy - s / 2, s * 1.2, s, s * 0.12);
        ctx.moveTo(cx, cy - s * 0.26);
        ctx.lineTo(cx, cy + s * 0.26);
        ctx.moveTo(cx - s * 0.26, cy);
        ctx.lineTo(cx + s * 0.26, cy);
        ctx.stroke();
      }
    },
  },
];

export const BACKGROUND_BY_ID = new Map(BACKGROUNDS.map((background) => [background.id, background]));

export async function prepareBackground(id: string): Promise<void> {
  if (id === 'custom' && !customImage) throw new Error('Choose a photo for your background first.');
  if (id !== 'room' || roomImage) return;
  if (!roomLoading) {
    roomLoading = new Promise<void>((resolve, reject) => {
      const image = new Image();
      const fail = () => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        reject(new Error('The room background could not load. Try another background.'));
      };
      const timer = setTimeout(fail, 10000);
      image.onload = () => {
        clearTimeout(timer);
        roomImage = image;
        image.onload = image.onerror = null;
        cache.clear();
        resolve();
      };
      image.onerror = fail;
      image.src = 'assets/background-room.jpg';
    }).finally(() => { roomLoading = null; });
  }
  return roomLoading;
}

/** Paint synchronously, then repaint photographic thumbnails when decoded. */
export function drawBackgroundPreview(canvas: HTMLCanvasElement, id: string): void {
  const def = BACKGROUND_BY_ID.get(id);
  const ctx = canvas.getContext('2d');
  if (!def || !ctx) return;
  def.draw(ctx, canvas.width, canvas.height);
  if (id === 'room') void prepareBackground(id).then(() => {
    def.draw(ctx, canvas.width, canvas.height);
  }).catch(() => { /* The picker reports load errors when selected. */ });
}

export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateBackgroundFile(file: Pick<File, 'type' | 'size'>): void {
  if (!IMAGE_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (!file.size || file.size > MAX_BACKGROUND_BYTES) throw new Error('Choose a non-empty image of 10 MB or less.');
}

/** Decode locally, reject oversized images and retain a bounded in-memory copy. */
export async function loadCustomBackground(file: File): Promise<void> {
  validateBackgroundFile(file);
  const request = ++customLoad;
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('That image could not be opened. Try another photo.'); }
  try {
    if (request !== customLoad) throw new DOMException('Photo selection cancelled.', 'AbortError');
    if (!image.width || !image.height || image.width * image.height > 32_000_000) {
      throw new Error('Choose an image with no more than 32 megapixels.');
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2560 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device could not prepare the photo.');
    // Flatten transparent pictures so replacement always fills the viewfinder.
    ctx.fillStyle = '#dedbd3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    customImage = canvas;
    cache.clear();
  } finally { image.close(); }
}

/** Returns a cached, full-size replacement. Blur uses the live camera instead. */
export function getBackgroundCanvas(id: string, w: number, h: number): HTMLCanvasElement | null {
  const def = BACKGROUND_BY_ID.get(id);
  if (!def || id === 'blur' || (id === 'room' && !roomImage) || (id === 'custom' && !customImage)) return null;
  const key = `${id}_${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  def.draw(ctx, w, h);
  // Camera switching must not retain an unbounded collection of large canvases.
  if (cache.size >= 6) cache.clear();
  cache.set(key, canvas);
  return canvas;
}
