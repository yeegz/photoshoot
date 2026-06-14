// Capture sequences: single photo, 4-shot vertical strip, and video. All three
// share the countdown + flash primitives so timing and sound stay perfectly in
// sync. Captured pixels come straight from the WebGL canvas, so whatever effect,
// mirror, or background is live is exactly what gets saved.

import { app } from './app';
import { sound } from './sound';
import { byId, qsa, clear, wait, el } from './dom';
import { toast } from './toast';
import { api } from './bridge';
import { refreshGallery, exitReview, isReviewing } from './gallery';
import type { CaptureKind } from '../shared/ipc-contract';

// ---------------------------------------------------------------------------
// Shared busy state + primitives
// ---------------------------------------------------------------------------

function setBusy(busy: boolean): void {
  app.busy = busy;
  (byId('shutter') as HTMLButtonElement).disabled = busy;
  qsa<HTMLButtonElement>('.mode-option').forEach((b) => (b.disabled = busy));
  ['btnEffects', 'btnBackgrounds'].forEach((id) => {
    (byId(id) as HTMLButtonElement).disabled = busy;
  });
}

// Photo Booth-style countdown: the toolbar turns red and the numbers count
// down inside the bar — it never covers the live preview.
async function runCountdown(seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const toolbar = byId('toolbar');
  const nums = byId('cdNums');
  clear(nums);
  const spans: HTMLElement[] = [];
  for (let n = seconds; n >= 1; n--) {
    const span = el('span', { className: 'cd-num', text: String(n) });
    nums.appendChild(span);
    spans.push(span);
  }
  toolbar.classList.add('is-counting');
  for (let i = 0; i < seconds; i++) {
    const current = seconds - i; // counts seconds … 1
    spans.forEach((s, idx) => s.classList.toggle('active', seconds - idx === current));
    sound.play('tick');
    await wait(1000);
  }
  toolbar.classList.remove('is-counting');
  clear(nums);
}

function fireFlash(): void {
  const flash = byId('flash');
  flash.classList.remove('fire');
  void flash.offsetWidth;
  flash.classList.add('fire');
  sound.play('shutter');
  sound.play('flash');
}

/** Render a fresh processed frame and copy it into a detached canvas. */
function grabFrame(): HTMLCanvasElement {
  app.renderer.renderFrame();
  const src = app.renderer.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d')!.drawImage(src, 0, 0);
  return canvas;
}

function makeThumb(src: HTMLCanvasElement, maxEdge: number): string {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(src.width * scale));
  t.height = Math.max(1, Math.round(src.height * scale));
  t.getContext('2d')!.drawImage(src, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.72);
}

// Animates the captured photo "printing" down from the viewfinder into the
// tray, calls onLand() the moment it arrives (to reveal the real thumbnail),
// then removes the flying overlay. Deliberately unhurried.
function flyToTray(thumbnail: string, onLand: () => Promise<void> | void): Promise<void> {
  return new Promise((resolve) => {
    const tray = byId('tray');
    tray.classList.remove('hidden');
    const reduce =
      app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vf = byId('viewfinder').getBoundingClientRect();

    // No animation possible (reduced motion / no viewfinder): just reveal it.
    if (reduce || vf.width === 0) {
      void Promise.resolve(onLand()).then(() => resolve());
      return;
    }

    // Target slot: the right edge of the tray (where the newest photo lands).
    const trayRect = byId('trayScroll').getBoundingClientRect();
    const size = 70;
    const targetX = trayRect.right - size - 5;
    const targetY = trayRect.top + (trayRect.height - size) / 2;

    const overlay = document.createElement('img');
    overlay.className = 'print-fly';
    overlay.src = thumbnail;
    overlay.style.left = `${vf.left}px`;
    overlay.style.top = `${vf.top}px`;
    overlay.style.width = `${vf.width}px`;
    overlay.style.height = `${vf.height}px`;
    document.body.appendChild(overlay);

    const scale = size / vf.width;
    const anim = overlay.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', borderRadius: '5px', offset: 0 },
        { transform: 'translate(0px, 0px) scale(1)', borderRadius: '5px', offset: 0.28 },
        {
          transform: `translate(${targetX - vf.left}px, ${targetY - vf.top}px) scale(${scale})`,
          borderRadius: `${5 / scale}px`,
          offset: 1,
        },
      ],
      { duration: 760, easing: 'cubic-bezier(0.5, 0, 0.18, 1)', fill: 'forwards' }
    );

    // Reveal the real thumbnail on landing. A guaranteed timeout backs up
    // anim.finished so the photo always appears, even if the animation is
    // interrupted or never fires.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      void Promise.resolve(onLand()).then(() => {
        overlay.remove();
        resolve();
      });
    };
    anim.finished.then(finish).catch(finish);
    setTimeout(finish, 850);
  });
}

async function saveCanvas(canvas: HTMLCanvasElement, kind: CaptureKind): Promise<boolean> {
  const format = app.settings.format;
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const dataUrl = canvas.toDataURL(type, format === 'jpg' ? 0.92 : undefined);
  const thumbnail = makeThumb(canvas, kind === 'strip' ? 200 : 280);
  const res = await api.saveCapture({
    kind,
    format,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    effect: app.effect,
    thumbnail,
  });
  if (!res.ok) {
    toast(res.error ?? 'Could not save capture.', 'error');
    sound.play('error');
    return false;
  }
  // Print the photo down into the tray, revealing the real thumbnail on landing.
  await flyToTray(thumbnail, () => refreshGallery(false));
  sound.play('trayDrop'); // lands with a satisfying drop
  return true;
}

// ---------------------------------------------------------------------------
// Single photo
// ---------------------------------------------------------------------------

export async function captureSingle(): Promise<void> {
  if (app.busy || !app.renderer.available) return;
  sound.unlock();
  setBusy(true);
  try {
    await runCountdown(app.settings.countdownSeconds);
    fireFlash();
    await wait(40); // let the flash hit its peak before we grab
    const frame = grabFrame();
    await saveCanvas(frame, 'single');
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// 4-shot vertical strip
// ---------------------------------------------------------------------------

function stripDots(count: number): void {
  const wrap = byId('stripProgress');
  clear(wrap);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'strip-dot';
    dot.dataset.i = String(i);
    wrap.appendChild(dot);
  }
  wrap.classList.remove('hidden');
}

function markDot(i: number): void {
  const dot = byId('stripProgress').querySelector(`[data-i="${i}"]`);
  dot?.classList.add('done');
}

function composeStrip(frames: HTMLCanvasElement[]): HTMLCanvasElement {
  const fw = frames[0].width;
  const fh = frames[0].height;
  const pad = Math.round(fw * 0.04);
  const footer = Math.round(fw * 0.13);
  const stripW = fw + pad * 2;
  const stripH = pad + (fh + pad) * frames.length + footer;
  const canvas = document.createElement('canvas');
  canvas.width = stripW;
  canvas.height = stripH;
  const ctx = canvas.getContext('2d')!;

  // Warm paper base with a subtle vertical sheen.
  const paper = ctx.createLinearGradient(0, 0, 0, stripH);
  paper.addColorStop(0, '#fdfcf8');
  paper.addColorStop(0.5, '#f6f4ec');
  paper.addColorStop(1, '#fbf9f3');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, stripW, stripH);
  // Faint paper grain.
  ctx.globalAlpha = 0.04;
  for (let i = 0; i < stripW * stripH * 0.0008; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * stripW, Math.random() * stripH, 1, 1);
  }
  ctx.globalAlpha = 1;

  frames.forEach((f, i) => {
    const y = pad + (fh + pad) * i;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = pad * 0.4;
    ctx.drawImage(f, pad, y, fw, fh);
    ctx.restore();
  });

  // Tasteful footer wordmark.
  ctx.fillStyle = '#3a3a40';
  ctx.font = `600 ${Math.round(footer * 0.34)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Photoshoot', stripW / 2, stripH - footer * 0.5);

  return canvas;
}

export async function captureStrip(): Promise<void> {
  if (app.busy || !app.renderer.available) return;
  sound.unlock();
  setBusy(true);
  stripDots(4);
  const frames: HTMLCanvasElement[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const cd = i === 0 ? Math.max(1, app.settings.countdownSeconds) : 2;
      await runCountdown(cd);
      fireFlash();
      await wait(40);
      frames.push(grabFrame());
      markDot(i);
      if (i < 3) await wait(650);
    }
    const strip = composeStrip(frames);
    if (await saveCanvas(strip, 'strip')) sound.play('stripComplete');
  } finally {
    byId('stripProgress').classList.add('hidden');
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer = 0;
  recording = false;

  private pickMime(): string {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
    }
    return 'video/webm';
  }

  async toggle(): Promise<void> {
    if (this.recording) this.stop();
    else await this.startRecording();
  }

  private async startRecording(): Promise<void> {
    if (!app.renderer.available) return;
    if (typeof MediaRecorder === 'undefined') {
      toast('Video recording is not supported here.', 'error');
      return;
    }
    sound.unlock();
    const stream = app.renderer.canvas.captureStream(30);
    try {
      this.recorder = new MediaRecorder(stream, { mimeType: this.pickMime() });
    } catch {
      toast('Could not start the recorder.', 'error');
      return;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => void this.finalize();
    this.recorder.start(200);
    this.recording = true;
    this.startedAt = performance.now();
    sound.play('button');

    const shutter = byId('shutter');
    shutter.classList.add('is-recording');
    byId('recBadge').classList.remove('hidden');
    qsa<HTMLButtonElement>('.mode-option').forEach((b) => (b.disabled = true));
    this.tick();
    // Safety cap at 60s.
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  private tick(): void {
    const secs = Math.floor((performance.now() - this.startedAt) / 1000);
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toString().padStart(2, '0');
    byId('recTime').textContent = `${m}:${s}`;
    if (secs >= 60) this.stop();
  }

  stop(): void {
    if (!this.recording || !this.recorder) return;
    this.recording = false;
    window.clearInterval(this.timer);
    try {
      this.recorder.stop();
    } catch {
      /* already stopped */
    }
    byId('shutter').classList.remove('is-recording');
    byId('recBadge').classList.add('hidden');
    qsa<HTMLButtonElement>('.mode-option').forEach((b) => (b.disabled = false));
  }

  private async finalize(): Promise<void> {
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    this.chunks = [];
    if (blob.size === 0) return;
    const dataUrl = await blobToDataUrl(blob);
    const res = await api.saveCapture({
      kind: 'video',
      format: 'png',
      dataUrl,
      width: app.renderer.canvas.width,
      height: app.renderer.canvas.height,
      effect: app.effect,
      thumbnail: '',
    });
    if (res.ok) {
      await refreshGallery(true);
      sound.play('trayDrop');
      toast(`Saved ${res.filename}`, 'success');
    } else {
      toast(res.error ?? 'Could not save video.', 'error');
      sound.play('error');
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const videoRecorder = new VideoRecorder();

/** Dispatch the shutter action based on the active mode. */
export async function triggerShutter(): Promise<void> {
  // While viewing a photo the shutter is greyed: tapping it just returns to the
  // live camera without taking a shot.
  if (isReviewing()) {
    exitReview();
    return;
  }
  if (app.mode === 'single') return captureSingle();
  if (app.mode === 'strip') return captureStrip();
  if (app.mode === 'video') return videoRecorder.toggle();
}
