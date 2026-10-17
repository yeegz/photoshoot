// Landing page script: the hero is a working replica of the Photoshoot window
// (real camera, effects, strip printing) and the filmstrip is drawn by the
// app's own backdrops. Bundled by web/build-web.mjs with a content hash.

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
