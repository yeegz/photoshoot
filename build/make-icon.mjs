// Generates build/icon.png — an ORIGINAL Photoshoot icon — with zero deps (just
// Node's zlib). A premium vintage camera with a rainbow lens reflection on a
// soft warm tile: evokes the fun, retro spirit of photobooth software without
// copying any existing artwork. Run: `node build/make-icon.mjs`.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SIZE = 512;
const buf = new Uint8Array(SIZE * SIZE * 4);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const ia = a / 255;
  buf[i] = Math.round(buf[i] * (1 - ia) + r * ia);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - ia) + g * ia);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - ia) + b * ia);
  buf[i + 3] = Math.max(buf[i + 3], a);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function roundedRect(x0, y0, x1, y1, radius, fn) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
      const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius + radius) fn(x, y);
    }
  }
}
function circle(cx, cy, r, fn) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) fn(x, y, Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx));
    }
  }
}
function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// --- Tile: soft warm vertical gradient ---
roundedRect(0, 0, SIZE, SIZE, 112, (x, y) => {
  const t = y / SIZE;
  const c = mix([247, 243, 234], [232, 222, 200], t);
  set(x, y, c[0], c[1], c[2], 255);
});
roundedRect(24, 24, SIZE - 24, SIZE * 0.42, 92, (x, y) => set(x, y, 255, 255, 255, 24));

// --- Soft drop shadow under the camera ---
circle(256, 372, 150, (x, y, d) => set(x, y, 60, 45, 25, Math.max(0, 22 * (1 - d / 150))));

const LCX = 256, LCY = 292; // lens center

// --- Camera body: brass with a darker lower grip ---
roundedRect(92, 168, 420, 392, 30, (x, y) => {
  const t = (y - 168) / (392 - 168);
  let c;
  if (t < 0.62) c = mix([214, 176, 102], [183, 142, 74], t / 0.62);
  else c = mix([120, 92, 52], [92, 70, 40], (t - 0.62) / 0.38); // leather grip
  set(x, y, c[0], c[1], c[2], 255);
});
// top highlight edge
roundedRect(92, 168, 420, 184, 30, (x, y) => set(x, y, 255, 245, 220, 70));

// --- Flash / viewfinder bump ---
roundedRect(150, 138, 232, 172, 9, (x, y) => set(x, y, 150, 116, 64, 255));
roundedRect(160, 144, 222, 158, 5, (x, y) => set(x, y, 220, 200, 150, 180));
// --- Shutter button (top-right) ---
circle(356, 156, 13, (x, y) => set(x, y, 222, 222, 226, 255));
circle(356, 156, 13, (x, y, d) => { if (d > 10) set(x, y, 150, 150, 154, 255); });

// --- Lens ---
circle(LCX, LCY, 94, (x, y) => set(x, y, 206, 166, 86, 255)); // brass ring
circle(LCX, LCY, 84, (x, y) => set(x, y, 246, 224, 168, 255)); // bright ring edge
circle(LCX, LCY, 80, (x, y) => set(x, y, 38, 30, 22, 255)); // dark housing
// rainbow glass
const rGlass = 66, rAp = 22;
circle(LCX, LCY, rGlass, (x, y, d, a) => {
  if (d < rAp) {
    set(x, y, 20, 16, 12, 255); // dark aperture
    return;
  }
  const tr = (d - rAp) / (rGlass - rAp);
  const hue = (a * 180) / Math.PI + 20; // angular rainbow
  const col = hsv(hue, 0.72, lerp(0.55, 1.0, tr));
  set(x, y, col[0], col[1], col[2], 255);
});
// inner dark vignette ring + specular highlight
circle(LCX, LCY, rGlass, (x, y, d) => { if (d > rGlass - 4) set(x, y, 30, 24, 18, 150); });
circle(LCX - 22, LCY - 24, 16, (x, y, d) => set(x, y, 255, 252, 244, Math.max(0, 230 * (1 - d / 16))));

// ---- encode PNG ----
function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE * 4; x++) raw[y * (SIZE * 4 + 1) + 1 + x] = buf[y * SIZE * 4 + x];
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icon.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
