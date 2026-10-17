// Landing page script: the hero is a working replica of the Photoshoot window
// (real camera, effects, strip printing) and the filmstrip is drawn by the
// app's own backdrops. Bundled by web/build-web.mjs with a content hash.

import { BACKGROUND_BY_ID } from '../../src/renderer/backgrounds';

document.documentElement.dataset.landing = 'ready';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const pb = $('pb');
const video = $<HTMLVideoElement>('pbVideo');
const message = $('pbMessage');
const messageIcon = $('pbMessageIcon');
const messageTitle = $('pbMessageTitle');
const messageText = $('pbMessageText');
const messageAction = $<HTMLButtonElement>('pbMessageAction');
const status = $('pbStatus');
const shutter = $<HTMLButtonElement>('pbShutter');
const effectsBtn = $<HTMLButtonElement>('pbEffects');

let stream: MediaStream | null = null;
let onAction: (() => void) | null = null;

// ---------------------------------------------------------------------------
// The app's own message card and status label
// ---------------------------------------------------------------------------

function showMessage(icon: string, title: string, text: string, action: { label: string; run: () => void } | null): void {
  messageIcon.textContent = icon;
  messageTitle.textContent = title;
  messageText.textContent = text;
  onAction = action?.run ?? null;
  messageAction.textContent = action?.label ?? '';
  messageAction.hidden = !action;
  messageAction.disabled = false;
  message.hidden = false;
}

function hideMessage(): void {
  message.hidden = true;
}

function setStatus(text: string, kind: '' | 'live' | 'error'): void {
  status.textContent = text;
  status.classList.toggle('is-live', kind === 'live');
  status.classList.toggle('is-error', kind === 'error');
}

messageAction.addEventListener('click', () => onAction?.());

const isWindows = /Windows/i.test(navigator.userAgent);

function deniedHelp(): string {
  return (
    'Allow camera access for this site in your browser (the camera icon near the address bar), then try again.' +
    (isWindows ? ' On Windows, also turn on Settings → Privacy & security → Camera → "Camera access".' : '')
  );
}

function busyHelp(): string {
  return isWindows
    ? 'Close other apps that use the camera (Teams, Zoom, Camera, other browser tabs), check the camera shutter or camera key on your laptop, and check Settings → Privacy & security → Camera.'
    : 'Close other apps that use the camera, check any camera shutter, and check your system camera permissions.';
}

// ---------------------------------------------------------------------------
// Camera: try each capture setting, then every other camera, before giving up.
// Windows Hello IR and depth sensors are used only when nothing else works.
// ---------------------------------------------------------------------------

const SENSOR = /\b(ir|infrared|depth)\b|hello/i;

function errName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function release(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}

function frameArrives(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve(true);
      if (Date.now() - start > ms) return resolve(false);
      setTimeout(check, 80);
    };
    check();
  });
}

type Attempt = { stream?: MediaStream; sensor?: string; error?: unknown };

async function tryCamera(id: string | null, skipSensor: boolean): Promise<Attempt> {
  const ladder: (MediaTrackConstraints | true)[] = id
    ? [{ deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }, { deviceId: { exact: id } }]
    : [{ facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, true];
  let lastErr: unknown = null;
  for (const constraints of ladder) {
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
    } catch (err) {
      const name = errName(err);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') throw err;
      lastErr = err;
      continue;
    }
    const track = s.getVideoTracks()[0];
    if (skipSensor && track && SENSOR.test(track.label)) {
      release(s);
      return { sensor: track.getSettings().deviceId };
    }
    video.srcObject = s;
    try {
      await video.play();
      if (await frameArrives(10000)) return { stream: s };
    } catch {
      /* try the next setting */
    }
    video.srcObject = null;
    release(s);
    lastErr = { name: 'NotReadableError' };
  }
  return { error: lastErr };
}

async function acquire(): Promise<MediaStream> {
  const first = await tryCamera(null, true);
  if (first.stream) return first.stream;
  let lastErr = first.error;
  let sensor = first.sensor ?? null;
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput' && d.deviceId)
    .sort((a, b) => Number(SENSOR.test(a.label)) - Number(SENSOR.test(b.label)));
  for (const device of devices) {
    if (device.deviceId === sensor) continue;
    const r = await tryCamera(device.deviceId, true);
    if (r.stream) return r.stream;
    if (r.sensor && !sensor) sensor = r.sensor;
    if (r.error && (!lastErr || errName(r.error) === 'NotReadableError')) lastErr = r.error;
  }
  if (sensor) {
    const last = await tryCamera(sensor, false);
    if (last.stream) return last.stream;
  }
  throw lastErr ?? { name: 'NotFoundError' };
}

function cameraFailed(err: unknown): void {
  setStatus('Camera unavailable', 'error');
  const retry = { label: 'Try Again', run: turnOn };
  switch (errName(err)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      showMessage('🔒', 'Camera access blocked', deniedHelp(), retry);
      break;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      showMessage('📷', 'No camera found', 'Connect a webcam, then try again.', retry);
      break;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      showMessage('⏳', 'Camera in use', `The camera could not be read. ${busyHelp()}`, retry);
      break;
    default:
      showMessage('⚠', 'Camera could not start', 'Something went wrong starting the camera.', retry);
  }
}

export async function turnOn(): Promise<void> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMessage('🔒', 'A secure connection is required', 'Open this page over HTTPS to use the camera.', {
      label: 'Try Again',
      run: turnOn,
    });
    return;
  }
  showMessage('◌', 'Just a moment', 'Waking up your webcam…', null);
  setStatus('Starting camera…', '');
  try {
    stream = await acquire();
  } catch (err) {
    cameraFailed(err);
    return;
  }
  hideMessage();
  setStatus('Camera live', 'live');
  pb.dataset.live = 'true';
  shutter.disabled = false;
  effectsBtn.disabled = false;
}

function turnOff(): void {
  release(stream);
  stream = null;
  video.srcObject = null;
  delete pb.dataset.live;
  shutter.disabled = true;
  effectsBtn.disabled = true;
  setStatus('Camera off', '');
  showMessage('◌', 'Camera is off', 'Turn it on to try Photoshoot right here. Nothing leaves your device.', {
    label: 'Turn on camera',
    run: turnOn,
  });
}

export function isLive(): boolean {
  return stream !== null;
}

// Leave the camera off when the tab is hidden; the visitor turns it on again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stream && !pb.dataset.busy) turnOff();
});

// ---------------------------------------------------------------------------
// Mode pill: single photo or 4-shot strip (video is in the app)
// ---------------------------------------------------------------------------

const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#pbMode [data-mode]'));
for (const b of modeButtons) {
  b.addEventListener('click', () => {
    const mode = b.dataset.mode ?? 'single';
    pb.dataset.mode = mode;
    modeButtons.forEach((o) => {
      const active = o === b;
      o.classList.toggle('is-active', active);
      o.setAttribute('aria-checked', String(active));
    });
    shutter.setAttribute('aria-label', mode === 'strip' ? 'Take 4-shot strip' : 'Take photo');
  });
}

onAction = turnOn;

// ---------------------------------------------------------------------------
// Effects: a 3×3 grid of live tiles, each the camera under a CSS look
// ---------------------------------------------------------------------------

const LOOKS: { id: string; label: string }[] = [
  { id: 'sepia', label: 'Sepia' },
  { id: 'bw', label: 'Black & White' },
  { id: 'glow', label: 'Glow' },
  { id: 'noir', label: 'Noir' },
  { id: 'normal', label: 'Normal' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'xray', label: 'X‑Ray' },
  { id: 'popart', label: 'Pop Art' },
  { id: 'cool', label: 'Cool' },
];

const grid = $('pbGrid');
const tileVideos: HTMLVideoElement[] = [];
let look = 'normal';
let gridOpen = false;
let busy = false;

function buildGrid(): void {
  if (grid.childElementCount) return;
  for (const def of LOOKS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'pb-tile';
    tile.dataset.look = def.id;
    tile.setAttribute('aria-label', def.label);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = def.label;
    tile.append(v, label);
    tile.addEventListener('click', () => pickLook(def.id));
    grid.appendChild(tile);
    tileVideos.push(v);
  }
}

function markLook(): void {
  grid.querySelectorAll<HTMLElement>('.pb-tile').forEach((t) => t.classList.toggle('is-active', t.dataset.look === look));
}

function openGrid(): void {
  if (!isLive() || busy || gridOpen) return;
  buildGrid();
  tileVideos.forEach((v) => {
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  });
  markLook();
  grid.hidden = false;
  requestAnimationFrame(() => grid.classList.add('is-open'));
  gridOpen = true;
  effectsBtn.setAttribute('aria-expanded', 'true');
}

function closeGrid(): void {
  if (!gridOpen) return;
  gridOpen = false;
  grid.classList.remove('is-open');
  effectsBtn.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (gridOpen) return;
    grid.hidden = true;
    tileVideos.forEach((v) => (v.srcObject = null));
  }, 320);
}

function pickLook(id: string): void {
  look = id;
  if (id === 'normal') delete pb.dataset.look;
  else pb.dataset.look = id;
  effectsBtn.classList.toggle('is-on', id !== 'normal');
  markLook();
  closeGrid();
}

effectsBtn.addEventListener('click', () => (gridOpen ? closeGrid() : openGrid()));

// ---------------------------------------------------------------------------
// Sounds: synthesized with Web Audio, unlocked by the first click, optional
// ---------------------------------------------------------------------------

let audio: AudioContext | null | undefined;

function audioCtx(): AudioContext | null {
  if (audio === undefined) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      audio = AC ? new AC() : null;
    } catch {
      audio = null;
    }
  }
  if (audio && audio.state === 'suspended') void audio.resume().catch(() => undefined);
  return audio;
}

function soundTick(): void {
  try {
    const ac = audioCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.07);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.08);
  } catch {
    /* sound is optional */
  }
}

function soundShutter(): void {
  try {
    const ac = audioCtx();
    if (!ac) return;
    const length = Math.floor(ac.sampleRate * 0.09);
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 0.8;
    const gain = ac.createGain();
    gain.gain.value = 0.35;
    noise.connect(band).connect(gain).connect(ac.destination);
    noise.start();
    const thump = ac.createOscillator();
    const tg = ac.createGain();
    thump.frequency.setValueAtTime(220, ac.currentTime);
    thump.frequency.exponentialRampToValueAtTime(90, ac.currentTime + 0.06);
    tg.gain.setValueAtTime(0.25, ac.currentTime);
    tg.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.07);
    thump.connect(tg).connect(ac.destination);
    thump.start();
    thump.stop(ac.currentTime + 0.08);
  } catch {
    /* sound is optional */
  }
}

// ---------------------------------------------------------------------------
// Capture: countdown in the viewfinder, window flash, thumbnails, strips
// ---------------------------------------------------------------------------

const count = $('pbCount');
const countNum = $('pbCountNum');
const flash = $('pbFlash');
const tray = $('pbTray');
const trayScroll = $('pbTrayScroll');
const stripOut = $('pbStrip');
const stripImg = $<HTMLImageElement>('pbStripImg');
const stripSave = $<HTMLAnchorElement>('pbStripSave');
const progress = $('pbStripProgress');

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function countdown(seconds: number): Promise<void> {
  count.hidden = false;
  for (let n = seconds; n >= 1; n--) {
    countNum.textContent = String(n);
    countNum.classList.remove('tick');
    void countNum.offsetWidth;
    countNum.classList.add('tick');
    soundTick();
    await wait(700);
  }
  countNum.classList.remove('tick');
  count.hidden = true;
}

function fireFlash(): void {
  flash.classList.remove('fire');
  void flash.offsetWidth;
  flash.classList.add('fire');
  soundShutter();
}

/** The current frame, mirrored and under the current look, like the preview. */
function grab(width = 640): HTMLCanvasElement {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((width * vh) / vw);
  const ctx = canvas.getContext('2d')!;
  const filter = getComputedStyle(video).filter;
  if (filter && filter !== 'none') ctx.filter = filter;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function addThumb(source: HTMLCanvasElement): void {
  const img = new Image();
  img.className = 'pb-thumb is-new';
  img.alt = 'Captured photo';
  img.src = source.toDataURL('image/jpeg', 0.8);
  trayScroll.appendChild(img);
  while (trayScroll.childElementCount > 8) trayScroll.firstElementChild?.remove();
  tray.hidden = false;
  trayScroll.scrollLeft = trayScroll.scrollWidth;
}

/** Four frames down a strip with a paper border and a footer, like the app. */
function composeStrip(frames: HTMLCanvasElement[]): HTMLCanvasElement {
  const width = 360;
  const height = Math.round((width * frames[0].height) / frames[0].width);
  const pad = 22;
  const gap = 14;
  const foot = 74;
  const strip = document.createElement('canvas');
  strip.width = width + pad * 2;
  strip.height = pad + frames.length * height + (frames.length - 1) * gap + foot;
  const ctx = strip.getContext('2d')!;
  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(0, 0, strip.width, strip.height);
  frames.forEach((f, i) => ctx.drawImage(f, pad, pad + i * (height + gap), width, height));
  ctx.fillStyle = '#16130f';
  ctx.textAlign = 'center';
  ctx.font = '600 20px -apple-system, "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  ctx.fillText('PHOTOSHOOT', strip.width / 2, strip.height - foot / 2 + 2);
  ctx.fillStyle = '#7a7266';
  ctx.font = '400 14px -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString(undefined, { dateStyle: 'medium' }), strip.width / 2, strip.height - foot / 2 + 24);
  return strip;
}

function setBusy(on: boolean): void {
  busy = on;
  if (on) pb.dataset.busy = 'true';
  else delete pb.dataset.busy;
  shutter.disabled = on || !isLive();
  effectsBtn.disabled = on || !isLive();
  modeButtons.forEach((b) => (b.disabled = on || b.dataset.mode === 'video'));
}

async function shoot(): Promise<void> {
  if (busy || !isLive()) return;
  closeGrid();
  setBusy(true);
  if (pb.dataset.mode === 'strip') {
    progress.hidden = false;
    progress.replaceChildren(...Array.from({ length: 4 }, () => document.createElement('i')));
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < 4; i++) {
      await countdown(i === 0 ? 3 : 2);
      fireFlash();
      frames.push(grab());
      progress.children[i]?.classList.add('done');
      await wait(450);
    }
    progress.hidden = true;
    const strip = composeStrip(frames);
    const url = strip.toDataURL('image/png');
    stripImg.src = url;
    stripSave.href = url;
    stripOut.hidden = false;
    addThumb(strip);
  } else {
    await countdown(3);
    fireFlash();
    addThumb(grab());
  }
  setBusy(false);
}

shutter.addEventListener('click', () => void shoot());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeGrid();
  if (e.code === 'Space' && e.target === document.body && isLive()) {
    e.preventDefault();
    void shoot();
  }
});

// ---------------------------------------------------------------------------
// Filmstrip: every backdrop frame is drawn by the app's own backdrop code;
// drag (mouse) or swipe (touch) to move along the strip.
// ---------------------------------------------------------------------------

for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.frame canvas[data-backdrop]')) {
  const def = BACKGROUND_BY_ID.get(canvas.dataset.backdrop ?? '');
  const ctx = canvas.getContext('2d');
  if (def && ctx) def.draw(ctx, canvas.width, canvas.height);
}

const film = $('film');
let drag: { x: number; left: number } | null = null;
film.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return; // touch scrolls natively
  drag = { x: e.clientX, left: film.scrollLeft };
  film.style.scrollSnapType = 'none';
  film.setPointerCapture(e.pointerId);
});
film.addEventListener('pointermove', (e) => {
  if (drag) film.scrollLeft = drag.left - (e.clientX - drag.x);
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  film.style.scrollSnapType = '';
};
film.addEventListener('pointerup', endDrag);
film.addEventListener('pointercancel', endDrag);
film.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    film.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * 308, behavior: 'smooth' });
  }
});
