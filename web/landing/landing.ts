// Landing page: the app's own GLSL effects render an original sample portrait,
// or the visitor's camera when they opt in. Procedural backdrops are shown
// separately, using the same drawing code as the app.
// Only import-free modules are used, so MediaPipe is never bundled here.

import { BACKGROUNDS, BACKGROUND_BY_ID, drawBackgroundPreview } from '../../src/renderer/backgrounds';
import { EFFECTS } from '../../src/renderer/gl/effects';
import { VERTEX_SRC, FRAGMENTS } from '../../src/renderer/gl/shaders';
import { linkProgram, createQuad, createVideoTexture, type CompiledProgram } from '../../src/renderer/gl/glcore';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
type Source = HTMLCanvasElement | HTMLVideoElement;
let samplePhoto: HTMLImageElement | null = null;
let initialized = false;

// ---------------------------------------------------------------------------
// A tiny effect renderer: one WebGL2 context, one texture, one program per
// effect, the same uniforms the app sets. Renders into an offscreen canvas
// that callers copy from.
// ---------------------------------------------------------------------------

class EffectRenderer {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private tex: WebGLTexture | null = null;
  private programs = new Map<string, CompiledProgram | null>();
  private start = performance.now();

  constructor() {
    this.init();
    this.canvas.addEventListener('webglcontextrestored', () => this.init());
  }

  private init(): void {
    this.programs.clear();
    try {
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
      if (this.gl) {
        this.vao = createQuad(this.gl);
        this.tex = createVideoTexture(this.gl);
      }
    } catch {
      this.gl = null;
    }
  }

  get available(): boolean {
    return this.gl !== null && !this.gl.isContextLost();
  }

  private program(id: string): CompiledProgram | null {
    if (!this.gl) return null;
    if (!this.programs.has(id)) {
      try {
        this.programs.set(id, linkProgram(this.gl, VERTEX_SRC, FRAGMENTS[id] ?? FRAGMENTS.normal));
      } catch {
        this.programs.set(id, null);
      }
    }
    return this.programs.get(id) ?? null;
  }

  /** Upload a source frame once; then draw any number of effects from it. */
  upload(source: Source, w: number, h: number): boolean {
    const gl = this.gl;
    if (!gl || !this.available) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false;
    }
    return true;
  }

  draw(effectId: string, amount: number, mirror: boolean): boolean {
    const gl = this.gl;
    const prog = this.program(effectId);
    if (!gl || !prog || !this.available) return false;
    const { width: w, height: h } = this.canvas;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.program);
    const u = prog.uniforms;
    gl.uniform1i(u.u_tex, 0);
    gl.uniform2f(u.u_res, w, h);
    gl.uniform1f(u.u_time, (performance.now() - this.start) / 1000);
    gl.uniform1f(u.u_amount, amount);
    gl.uniform1f(u.u_mirror, mirror ? 1 : 0);
    gl.uniform2f(u.u_center, 0.5, 0.5);
    gl.uniform1f(u.u_faceFound, 0);
    gl.uniform1f(u.u_faceR, 0.16);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    return true;
  }
}

const fx = new EffectRenderer();

/** Draw a backdrop into a fresh canvas. */
function backdrop(id: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  BACKGROUND_BY_ID.get(id)?.draw(c.getContext('2d')!, w, h);
  return c;
}

/** Crop the same portrait for every effect so their differences are visible. */
function sample(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  if (!samplePhoto) return backdrop('studio', w, h);
  const scale = Math.max(w / samplePhoto.naturalWidth, h / samplePhoto.naturalHeight);
  const sw = samplePhoto.naturalWidth * scale;
  const sh = samplePhoto.naturalHeight * scale;
  c.getContext('2d')!.drawImage(samplePhoto, (w - sw) / 2, (h - sh) / 2, sw, sh);
  return c;
}

/** One effect applied to one source, copied into a 2D context at (x, y, w, h). */
function paint(
  ctx: CanvasRenderingContext2D,
  source: Source,
  effect: string,
  amount: number,
  x: number,
  y: number,
  w: number,
  h: number,
  mirror = false
): boolean {
  if (fx.available && fx.upload(source, w, h) && fx.draw(effect, amount, mirror)) {
    ctx.drawImage(fx.canvas, x, y, w, h);
    return true;
  } else {
    ctx.drawImage(source, x, y, w, h); // no WebGL2: show the plain picture
    return false;
  }
}

const amountOf = (id: string) => EFFECTS.find((e) => e.id === id)?.amount ?? 1;

// ---------------------------------------------------------------------------
// Hero prints: a 2×2 sheet (four quick pictures) and a single photo behind it.
// ---------------------------------------------------------------------------

function drawHero(): void {
  const sheet = $<HTMLCanvasElement>('heroSheet');
  const ctx = sheet.getContext('2d')!;
  const gap = 8;
  const fw = Math.round((sheet.width - gap * 3) / 2);
  const fh = Math.round((sheet.height - gap * 3) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const source = sample(fw, fh);
  ['normal', 'bw', 'sepia', 'plasticcamera'].forEach((effect, i) => {
    paint(ctx, source, effect, amountOf(effect), gap + (i % 2) * (fw + gap), gap + Math.floor(i / 2) * (fh + gap), fw, fh);
  });

  const single = $<HTMLCanvasElement>('heroSingle');
  const sctx = single.getContext('2d')!;
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, single.width, single.height);
  const pad = 10;
  const sw = single.width - pad * 2;
  const sh = single.height - pad * 2;
  paint(sctx, sample(sw, sh), 'normal', 0, pad, pad, sw, sh);
}

// ---------------------------------------------------------------------------
// Effects wall: all 17 effects, on the sample or on the visitor's camera.
// ---------------------------------------------------------------------------

const WALL_EFFECTS = EFFECTS.filter((e) => !e.face && e.id !== 'normal');
const TILE_W = 320;
const TILE_H = 200;
const wall = $('wall');
const tiles: { id: string; label: string; caption: HTMLElement; amount: number; ctx: CanvasRenderingContext2D; bg: HTMLCanvasElement }[] = [];

function buildWall(): void {
  const bg = sample(TILE_W, TILE_H);
  WALL_EFFECTS.forEach((def) => {
    const fig = document.createElement('figure');
    fig.className = 'wall-tile';
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const cap = document.createElement('figcaption');
    cap.textContent = def.label;
    fig.append(canvas, cap);
    wall.appendChild(fig);
    tiles.push({ id: def.id, label: def.label, caption: cap, amount: def.amount, ctx: canvas.getContext('2d')!, bg });
  });
}

function paintWallFromSample(): void {
  for (const t of tiles) {
    const rendered = paint(t.ctx, t.bg, t.id, t.amount, 0, 0, TILE_W, TILE_H);
    t.caption.textContent = rendered || !fx.available ? t.label : `${t.label} (unavailable)`;
  }
}

// ---- opt-in camera ----

const camBtn = $<HTMLButtonElement>('wallCamera');
const camLabel = $('wallCameraLabel');
const note = $('wallNote');
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
let stream: MediaStream | null = null;
let raf = 0;
let cursor = 0;
let cameraAttempt = 0;
const frame = document.createElement('canvas');
frame.width = TILE_W;
frame.height = TILE_H;
const frameCtx = frame.getContext('2d')!;

function liveLoop(): void {
  if (!stream) return;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    // Crop to the contact sheet's aspect ratio without stretching faces.
    const scale = Math.max(TILE_W / video.videoWidth, TILE_H / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    frameCtx.drawImage(video, (TILE_W - w) / 2, (TILE_H - h) / 2, w, h);
  }
  if (video.readyState >= 2) {
    if (!fx.available || !fx.upload(frame, TILE_W, TILE_H)) {
      cameraOff();
      note.textContent = 'Live effects stopped. Try your camera again or open the full app.';
      return;
    }
    // Upload once per frame, draw a few tiles from it (round-robin keeps it light).
    for (let k = 0; k < 4; k++) {
      const t = tiles[cursor++ % tiles.length];
      if (fx.draw(t.id, t.amount, true)) {
        t.ctx.drawImage(fx.canvas, 0, 0, TILE_W, TILE_H);
        t.caption.textContent = t.label;
      } else {
        t.ctx.save();
        t.ctx.translate(TILE_W, 0);
        t.ctx.scale(-1, 1);
        t.ctx.drawImage(frame, 0, 0);
        t.ctx.restore();
        t.caption.textContent = `${t.label} (unavailable)`;
      }
    }
  }
  raf = requestAnimationFrame(liveLoop);
}

function errName(err: unknown): string {
  return (err as { name?: string } | null)?.name ?? '';
}

async function cameraOn(): Promise<void> {
  if (!initialized || !fx.available) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    note.textContent = 'This browser cannot open a camera here. The app may still work.';
    return;
  }
  camBtn.disabled = true;
  note.textContent = 'Asking for your camera…';
  const attempt = ++cameraAttempt;
  const current = () => attempt === cameraAttempt && !document.hidden;
  try {
    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
    } catch (err) {
      if (!current() || ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(errName(err))) throw err;
      acquired = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    if (!current()) {
      acquired.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquired;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new DOMException('No video track', 'NotReadableError');
    track.addEventListener('ended', () => {
      if (stream !== acquired) return;
      cameraOff();
      note.textContent = 'The camera disconnected. Reconnect it and try again.';
    }, { once: true });
    video.srcObject = stream;
    let playError: unknown;
    void video.play().catch((err: unknown) => { playError = err; });
    const started = performance.now();
    while (current() && (video.readyState < 2 || !video.videoWidth)) {
      if (playError) throw playError;
      if (performance.now() - started > 10000) throw new DOMException('No camera frame', 'NotReadableError');
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (!current()) return;
    wall.dataset.source = 'camera';
    camBtn.setAttribute('aria-pressed', 'true');
    camLabel.textContent = 'Stop camera';
    note.textContent = 'Live. Your camera stays on this page; nothing is recorded or sent.';
    liveLoop();
  } catch (err) {
    if (!current()) return;
    stopStream();
    const name = errName(err);
    note.textContent =
      name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError'
        ? 'Camera access was blocked. Allow it for this site (the camera icon by the address bar) to try the effects on yourself.'
        : name === 'NotFoundError'
          ? 'No camera found. Connect one and try again.'
          : 'The camera is busy or switched off. Close other apps using it and try again.';
  } finally {
    if (attempt === cameraAttempt) camBtn.disabled = !initialized || !fx.available;
  }
}

function stopStream(): void {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
}

function cameraOff(): void {
  cameraAttempt++;
  stopStream();
  wall.dataset.source = samplePhoto ? 'sample' : 'backdrops';
  camBtn.setAttribute('aria-pressed', 'false');
  camLabel.textContent = 'Use my camera';
  camBtn.disabled = !initialized || !fx.available;
  note.textContent = fx.available
    ? 'Your camera stays on this page. Nothing is recorded or sent.'
    : 'Live effects are unavailable in this browser. Showing the original picture.';
  paintWallFromSample();
}

camBtn.addEventListener('click', () => void (stream ? cameraOff() : cameraOn()));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cameraOff();
});
window.addEventListener('pagehide', cameraOff);
fx.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  cameraOff();
  drawHero();
});
fx.canvas.addEventListener('webglcontextrestored', () => {
  cameraOff();
  drawHero();
});

// ---------------------------------------------------------------------------
// Backdrops grid
// ---------------------------------------------------------------------------

function buildBackdrops(): void {
  const grid = $('backdropGrid');
  for (const def of BACKGROUNDS) {
    const fig = document.createElement('figure');
    fig.className = 'backdrop';
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 300;
    drawBackgroundPreview(c, def.id);
    const cap = document.createElement('figcaption');
    cap.textContent = def.label;
    fig.append(c, cap);
    grid.appendChild(fig);
  }
}

async function init(): Promise<void> {
  const image = new Image();
  image.src = $<HTMLLinkElement>('samplePhoto').href;
  try {
    await image.decode();
    samplePhoto = image;
  } catch {
    // A missing sample must not prevent the camera or app links from working.
  }
  drawHero();
  buildWall();
  initialized = true;
  cameraOff();
  buildBackdrops();
  document.documentElement.dataset.landing = 'ready';
}
void init();
