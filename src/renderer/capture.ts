// Capture sequences: single photo, 4-shot vertical strip, and video. All three
// share the countdown + flash primitives so timing and sound stay perfectly in
// sync. Captured pixels come straight from the WebGL canvas, so whatever effect,
// mirror, or background is live is exactly what gets saved.

import { app } from './app';
import { sound } from './sound';
import { byId, qsa, clear, wait } from './dom';
import { toast } from './toast';
import { api } from './bridge';
import { refreshGallery, exitReview, isReviewing } from './gallery';
import type { CaptureKind, SaveRequest } from '../shared/ipc-contract';

// ---------------------------------------------------------------------------
// Shared busy state + primitives
// ---------------------------------------------------------------------------

function captureReady(source: MediaProvider | null = app.video.srcObject): boolean {
  return source !== null && source === app.video.srcObject && app.video.readyState >= 2 && app.renderer.available;
}

function setBusy(busy: boolean): void {
  app.busy = busy;
  (byId('shutter') as HTMLButtonElement).disabled = busy || !captureReady();
  qsa<HTMLButtonElement>('.mode-option').forEach((b) => (b.disabled = busy));
  ['btnEffects', 'btnBackgrounds'].forEach((id) => {
    (byId(id) as HTMLButtonElement).disabled = busy || !app.renderer.supportsEffects;
  });
}

// Photo Booth-style countdown: the toolbar becomes a row of numerals that
// light up 3, 2, 1, then the camera glyph, each with a tick.
async function runCountdown(seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const toolbar = byId('toolbar');
  const nums = byId('cdNums');
  clear(nums);
  const spans: HTMLElement[] = [];
  for (let n = seconds; n >= 1; n--) {
    const span = document.createElement('span');
    span.className = 'cd-num';
    span.textContent = String(n);
    nums.appendChild(span);
    spans.push(span);
  }
  const cam = byId('cdCam');
  cam.classList.remove('active');
  toolbar.classList.add('is-counting');
  for (let i = 0; i < seconds; i++) {
    spans.forEach((s, idx) => s.classList.toggle('active', idx === i));
    sound.play('tick');
    await wait(1000);
    if (!toolbar.classList.contains('is-counting')) return; // cancelled
  }
  spans.forEach((s) => s.classList.remove('active'));
  cam.classList.add('active');
  await wait(120);
  toolbar.classList.remove('is-counting');
  cam.classList.remove('active');
  clear(nums);
}

/** Cancel a running countdown (graphics reset, camera loss). */
export function cancelCountdown(): void {
  byId('toolbar').classList.remove('is-counting');
}

/** Option-click skips the countdown, Shift-click skips the flash (as in Photo Booth). */
export interface ShotOptions {
  skipCountdown?: boolean;
  skipFlash?: boolean;
}

function fireFlash(skip = false): void {
  // The screen flash lights the whole window (Settings → Screen flash,
  // Shift-click); the shutter sound plays either way.
  if (!skip && app.settings.screenFlash !== false) {
    const flash = byId('flash');
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
    sound.play('flash');
  }
  sound.play('shutter');
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

    // Target slot: the right edge of the tray (where the newest photo lands),
    // a 90×60 cell in the band.
    const trayRect = byId('trayScroll').getBoundingClientRect();
    const size = 90;
    const targetX = trayRect.right - size;
    const targetY = trayRect.top + (trayRect.height - 60) / 2;

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
          borderRadius: '0px',
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

export async function captureSingle(opts: ShotOptions = {}): Promise<void> {
  const source = app.video.srcObject;
  if (app.busy || !captureReady(source)) return;
  sound.unlock();
  setBusy(true);
  try {
    if (!opts.skipCountdown) await runCountdown(app.settings.countdownSeconds);
    if (!captureReady(source)) return; // a reset mid-countdown cancels the shot, flash and all
    fireFlash(opts.skipFlash);
    await wait(40); // let the flash hit its peak before we grab
    if (!captureReady(source)) return;
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

/** Four quick pictures as a 2×2 sheet with a thin white border, like Photo Booth. */
function composeStrip(frames: HTMLCanvasElement[]): HTMLCanvasElement {
  const fw = frames[0].width;
  const fh = frames[0].height;
  const gap = Math.max(4, Math.round(fw * 0.012));
  const canvas = document.createElement('canvas');
  canvas.width = fw * 2 + gap * 3;
  canvas.height = fh * 2 + gap * 3;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  frames.forEach((f, i) => {
    const x = gap + (i % 2) * (fw + gap);
    const y = gap + Math.floor(i / 2) * (fh + gap);
    ctx.drawImage(f, x, y, fw, fh);
  });
  return canvas;
}

export async function captureStrip(opts: ShotOptions = {}): Promise<void> {
  const source = app.video.srcObject;
  if (app.busy || !captureReady(source)) return;
  sound.unlock();
  setBusy(true);
  stripDots(4);
  const frames: HTMLCanvasElement[] = [];
  try {
    // One countdown, then four quick pictures, each with its own flash.
    if (!opts.skipCountdown) await runCountdown(Math.max(1, app.settings.countdownSeconds));
    for (let i = 0; i < 4; i++) {
      if (!captureReady(source)) return;
      fireFlash(opts.skipFlash);
      await wait(40);
      if (!captureReady(source)) return;
      frames.push(grabFrame());
      markDot(i);
      if (i < 3) await wait(560);
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
  private releaseRecording: (() => void) | null = null;
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
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder;
    const chunks: Blob[] = [];
    try {
      stream = app.renderer.canvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: this.pickMime() });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.start(200);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      toast('Could not start the recorder.', 'error');
      return;
    }
    this.recorder = recorder;
    const metadata = {
      width: app.renderer.canvas.width,
      height: app.renderer.canvas.height,
      effect: app.effect,
    };
    // A prior recorder may deliver its final events after a new recording
    // starts. Keep its data and cleanup local to that recording.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (this.recorder !== recorder) return;
      this.recorder = null;
      this.releaseRecording = null;
      this.recording = false;
      window.clearInterval(this.timer);
      this.timer = 0;
      byId('shutter').classList.remove('is-recording');
      byId('recBadge').classList.add('hidden');
      qsa<HTMLButtonElement>('.mode-option').forEach((b) => (b.disabled = false));
    };
    this.releaseRecording = release;
    recorder.onstop = () => {
      release();
      void this.finalize(chunks, metadata).catch(() => {
        toast('Could not save video.', 'error');
        sound.play('error');
      });
    };
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
    const release = this.releaseRecording;
    try {
      this.recorder.stop();
    } catch {
      /* already stopped */
    } finally {
      release?.();
    }
  }

  private async finalize(chunks: Blob[], metadata: Pick<SaveRequest, 'width' | 'height' | 'effect'>): Promise<void> {
    const blob = new Blob(chunks, { type: 'video/webm' });
    chunks.length = 0;
    if (blob.size === 0) return;
    const dataUrl = await blobToDataUrl(blob);
    const res = await api.saveCapture({
      kind: 'video',
      format: 'png',
      dataUrl,
      ...metadata,
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
export async function triggerShutter(opts: ShotOptions = {}): Promise<void> {
  if (videoRecorder.recording) {
    videoRecorder.stop();
    return;
  }
  if (!captureReady()) return;
  // While viewing a photo the shutter is greyed: tapping it just returns to the
  // live camera without taking a shot.
  if (isReviewing()) {
    exitReview();
    return;
  }
  if (app.mode === 'single') return captureSingle(opts);
  if (app.mode === 'strip') return captureStrip(opts);
  if (app.mode === 'video') return videoRecorder.toggle();
}
