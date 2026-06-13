// Original, procedurally-drawn backdrops for background replacement. No external
// images — everything is generated with Canvas2D so the assets are unambiguously
// our own. Each background renders at any size for both the compositing path and
// the small menu tiles.

export interface BackgroundDef {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'clouds',
    label: 'Dreamy Clouds',
    draw(ctx, w, h) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#7db8ff');
      sky.addColorStop(0.55, '#bfe0ff');
      sky.addColorStop(1, '#eef7ff');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const cx = (i * 97.3) % w;
        const cy = h * (0.25 + ((i * 53) % 100) / 320);
        const r = w * (0.08 + ((i * 31) % 60) / 360);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'dots',
    label: 'Retro Dots',
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ffd36e');
      g.addColorStop(1, '#ff7eb3');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const step = Math.max(26, w / 26);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, step * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'space',
    label: 'Space Horizon',
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#05030f');
      g.addColorStop(0.6, '#10123a');
      g.addColorStop(1, '#2a1d5e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h * 0.8;
        const s = Math.random() * 1.6;
        ctx.globalAlpha = 0.3 + Math.random() * 0.7;
        ctx.fillRect(x, y, s, s);
      }
      ctx.globalAlpha = 1;
      // Planet limb glow along the bottom.
      const glow = ctx.createRadialGradient(w / 2, h * 1.15, h * 0.2, w / 2, h * 1.15, h * 0.9);
      glow.addColorStop(0, 'rgba(120,90,255,0.55)');
      glow.addColorStop(1, 'rgba(120,90,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sunset',
    label: 'Mountain Sunset',
    draw(ctx, w, h) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#2a1a55');
      sky.addColorStop(0.45, '#ff6e7f');
      sky.addColorStop(0.7, '#ffb36b');
      sky.addColorStop(1, '#ffe39e');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      const sun = ctx.createRadialGradient(w * 0.5, h * 0.62, 0, w * 0.5, h * 0.62, w * 0.22);
      sun.addColorStop(0, 'rgba(255,240,200,1)');
      sun.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);
      const ridges = [
        { y: 0.74, c: '#7a3b6e' },
        { y: 0.82, c: '#54265a' },
        { y: 0.9, c: '#331a44' },
      ];
      for (const ridge of ridges) {
        ctx.fillStyle = ridge.c;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, h * ridge.y);
        const peaks = 6;
        for (let i = 0; i <= peaks; i++) {
          const x = (w / peaks) * i;
          const jag = (Math.sin(i * 12.9 + ridge.y * 40) * 0.5 + 0.5) * h * 0.08;
          ctx.lineTo(x, h * ridge.y - jag);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  {
    id: 'underwater',
    label: 'Underwater',
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0fb6c9');
      g.addColorStop(0.5, '#0a6e9e');
      g.addColorStop(1, '#063a63');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = 'rgba(180,240,255,0.07)';
        ctx.save();
        ctx.translate(lerp(0, w, i / 6), 0);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w * 0.08, 0);
        ctx.lineTo(w * 0.28, h);
        ctx.lineTo(w * 0.18, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.1 + Math.random() * 0.4;
        ctx.fillStyle = 'rgba(220,250,255,0.9)';
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'stage',
    label: 'Stage Lights',
    draw(ctx, w, h) {
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(0, 0, w, h);
      const colors = ['rgba(255,70,140,0.55)', 'rgba(90,160,255,0.55)', 'rgba(120,255,180,0.5)'];
      ctx.globalCompositeOperation = 'lighter';
      colors.forEach((c, i) => {
        const x = lerp(w * 0.2, w * 0.8, i / 2);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x, -h * 0.1);
        ctx.lineTo(x - w * 0.22, h);
        ctx.lineTo(x + w * 0.22, h);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      const floor = ctx.createLinearGradient(0, h * 0.7, 0, h);
      floor.addColorStop(0, 'rgba(0,0,0,0)');
      floor.addColorStop(1, 'rgba(255,255,255,0.12)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
    },
  },
];

export const BACKGROUND_BY_ID = new Map(BACKGROUNDS.map((b) => [b.id, b]));

const cache = new Map<string, HTMLCanvasElement>();

/** Returns a cached, full-size background canvas for compositing. */
export function getBackgroundCanvas(id: string, w: number, h: number): HTMLCanvasElement | null {
  const def = BACKGROUND_BY_ID.get(id);
  if (!def) return null;
  const key = `${id}_${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  def.draw(ctx, w, h);
  cache.set(key, canvas);
  return canvas;
}
