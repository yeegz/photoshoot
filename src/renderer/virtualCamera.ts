// Sends only the final processed canvas. Credentials live in this module's memory,
// never in settings, localStorage, URLs or the public loopback feed.
import { api } from './bridge';
import { app } from './app';
import { el } from './dom';
import {
  VIRTUAL_CAMERA_MAX_WIDTH, VIRTUAL_CAMERA_MAX_HEIGHT,
  VIRTUAL_CAMERA_MAX_FPS, VIRTUAL_CAMERA_MAX_FRAME_BYTES,
  type VirtualCameraStatus,
} from '../shared/virtual-camera';

let status: VirtualCameraStatus = { supported: false, state: 'unsupported', message: 'Virtual camera requires the Windows desktop app and OBS Studio.' };
let password = '';
let port = 4455;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let section: HTMLElement | null = null;
let stopping = false;

export function virtualCameraActive(): boolean {
  return status.state === 'connecting' || status.state === 'live';
}

function updateStatus(next: VirtualCameraStatus): void {
  status = next;
  const label = section?.querySelector<HTMLElement>('[data-camera-status]');
  if (label) { label.textContent = next.message; label.dataset.state = next.state; }
  const button = section?.querySelector<HTMLButtonElement>('[data-camera-toggle]');
  if (button) {
    button.textContent = stopping ? 'Stopping…' : virtualCameraActive() ? 'Stop virtual camera' : 'Start virtual camera';
    button.disabled = !next.supported || stopping;
  }
  section?.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.disabled = virtualCameraActive() || stopping; });
  const badge = document.getElementById('virtualCameraBadge');
  if (badge) {
    badge.classList.toggle('hidden', !virtualCameraActive());
    badge.textContent = next.state === 'live' ? 'Camera → OBS' : 'Connecting to OBS…';
  }
}

export async function initVirtualCamera(): Promise<void> {
  try { updateStatus(await api.getVirtualCameraStatus()); }
  catch { updateStatus({ supported: false, state: 'error', message: 'Virtual camera could not initialize. Restart Photoshoot.' }); }
}

function clearTimers(): void {
  clearTimeout(timer);
  clearTimeout(statusTimer);
}

export async function stopVirtualCamera(message?: string): Promise<void> {
  ++generation;
  clearTimers();
  if (!virtualCameraActive() && !stopping) return;
  stopping = true;
  updateStatus(status);
  try {
    const next = await api.stopVirtualCamera();
    updateStatus(message ? { ...next, message } : next);
  } catch {
    updateStatus({ supported: true, state: 'error', message: 'Could not contact OBS. Stop its Virtual Camera in OBS before leaving.' });
  } finally { stopping = false; updateStatus(status); }
}

function cameraReady(): boolean {
  const stream = app.video?.srcObject as MediaStream | null;
  return !!app.renderer?.available && !!app.video && app.video.readyState >= 2 &&
    !!stream?.getVideoTracks().some((track) => track.readyState === 'live');
}

async function start(): Promise<void> {
  if (!cameraReady()) {
    updateStatus({ ...status, state: 'error', message: 'Start your camera in Photoshoot before starting the virtual camera.' });
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !password) {
    updateStatus({ ...status, state: 'error', message: 'Enter the WebSocket server port and password shown in OBS.' });
    return;
  }
  const token = ++generation;
  updateStatus({ supported: true, state: 'connecting', message: 'Connecting to OBS…' });
  // The preview stays live behind gallery review while it is being sent to OBS.
  app.renderer.start();
  const canvas = document.createElement('canvas');
  canvas.width = VIRTUAL_CAMERA_MAX_WIDTH;
  canvas.height = VIRTUAL_CAMERA_MAX_HEIGHT;
  const ctx = canvas.getContext('2d');
  let lastCameraTime = -1;
  let lastCameraChange = performance.now();
  const pump = async () => {
    if (token !== generation || !virtualCameraActive()) return;
    if (!ctx || !cameraReady()) {
      await stopVirtualCamera('Virtual camera stopped because the camera became unavailable.');
      return;
    }
    const now = performance.now();
    if (app.video.currentTime !== lastCameraTime) {
      lastCameraTime = app.video.currentTime;
      lastCameraChange = now;
    } else if (now - lastCameraChange > 3000) {
      await stopVirtualCamera('Virtual camera stopped because the camera stopped sending frames.');
      return;
    }
    try {
      // Timer-driven refresh also works while the desktop window is minimized.
      // It runs the existing background hook before the effect, without replacing it.
      app.renderer.renderLiveFrame();
      const source = app.renderer.canvas;
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (token !== generation) return;
      if (!blob || blob.size > VIRTUAL_CAMERA_MAX_FRAME_BYTES) throw new Error('Frame encoding failed.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (token !== generation) return;
      await api.sendVirtualCameraFrame(bytes);
      // Exactly one encode + IPC send is in flight. Slow OBS drops rate, not memory.
      if (token === generation) timer = setTimeout(() => void pump(), 1000 / VIRTUAL_CAMERA_MAX_FPS);
    } catch {
      if (token === generation) await stopVirtualCamera('Virtual camera stopped because the processed frame could not be sent.');
    }
  };
  void pump();
  try {
    const next = await api.startVirtualCamera({ port, password });
    if (token !== generation) return;
    updateStatus(next);
    if (!virtualCameraActive()) { ++generation; clearTimers(); return; }
    const poll = async () => {
      if (token !== generation) return;
      try {
        const nextStatus = await api.getVirtualCameraStatus();
        if (token !== generation) return;
        updateStatus(nextStatus);
        if (!virtualCameraActive()) { ++generation; clearTimers(); return; }
        statusTimer = setTimeout(() => void poll(), 1000);
      } catch {
        if (token === generation) await stopVirtualCamera('Connection to OBS was lost. Reopen OBS and try again.');
      }
    };
    statusTimer = setTimeout(() => void poll(), 1000);
  } catch {
    if (token === generation) await stopVirtualCamera('Could not start OBS Virtual Camera. Check the setup steps and try again.');
  }
}

export function buildVirtualCameraSection(): HTMLElement {
  const note = (text: string) => el('p', { className: 'setting-desc', text });
  const link = (text: string, href: string) => el('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
  const steps = el('ol', { className: 'virtual-camera-steps' }, [
    el('li', {}, ['Install ', link('OBS Studio 28 or newer', 'https://obsproject.com/download'), ' for Windows and keep OBS open. OBS is required: it provides the camera device other apps use.']),
    el('li', { text: 'In OBS, open Tools → WebSocket Server Settings. Enable the server and authentication. Copy the server port (usually 4455) and password into the fields below.' }),
    el('li', { text: 'In OBS Controls, click the gear beside Start Virtual Camera. Set Output Type to Program (Default). Turn Studio Mode off. Stop any OBS stream, recording or virtual camera before connecting.' }),
    el('li', { text: 'Start your camera and choose effects or a background in Photoshoot. Click Start virtual camera below. Photoshoot creates a temporary OBS scene and starts OBS Virtual Camera.' }),
    el('li', { text: 'In Discord: User Settings → Voice & Video → Camera → OBS Virtual Camera. In Zoom: Settings → Video & effects → Camera. In Teams: Settings → Devices → Camera. Select OBS Virtual Camera there too.' }),
  ]);
  const details = el('details', { className: 'virtual-camera-guide' }, [el('summary', { text: 'Setup and use in Discord, Zoom or Teams' }), steps,
    note('Keep Photoshoot and OBS running during your call. Your effects, mirror and background are included; the app interface and saved-photo review are excluded. Select your microphone separately in the calling app. Output is up to 1280 × 720 at 15 fps.'),
    note('If OBS Virtual Camera is missing, restart the calling app after installing OBS. If the picture is wrong, check OBS Virtual Camera’s gear is set to Program (Default). Close other apps using your physical webcam.'),
  ]);
  const statusLabel = el('p', { className: 'virtual-camera-status', attrs: { 'data-camera-status': '', role: 'status', 'aria-live': 'polite' } });
  const children: Node[] = [
    note('Windows 10 and 11 · OBS Studio required. Send your processed Photoshoot camera to other apps through OBS Virtual Camera.'), details,
  ];
  if (app.info?.platform === 'win32') {
    const portInput = el('input', { type: 'number', attrs: { min: '1', max: '65535', inputmode: 'numeric', 'aria-label': 'OBS WebSocket port' } });
    portInput.value = String(port);
    portInput.addEventListener('input', () => { port = Number(portInput.value); });
    const passwordInput = el('input', { type: 'password', attrs: { autocomplete: 'off', 'aria-label': 'OBS WebSocket password', spellcheck: 'false' } });
    passwordInput.value = password;
    passwordInput.addEventListener('input', () => { password = passwordInput.value; });
    children.push(el('div', { className: 'virtual-camera-fields' }, [
      el('label', {}, ['OBS WebSocket port', portInput]), el('label', {}, ['OBS WebSocket password', passwordInput]),
    ]), note('The connection stays on this computer. Your OBS password is kept only until Photoshoot closes.'),
    el('button', { className: 'btn btn-sm', type: 'button', attrs: { 'data-camera-toggle': '' }, onClick: () => {
      if (virtualCameraActive()) void stopVirtualCamera(); else void start();
    } }));
  } else {
    children.push(el('p', { className: 'setting-desc' }, [
      'This feature requires the Windows desktop app; the browser version cannot provide a camera device. ',
      link('Download Photoshoot for Windows', 'https://github.com/yeegz/photoshoot/releases/latest'),
    ]));
  }
  // The status line only means something where the feature can run; on the
  // web it would repeat the explanation above.
  if (status.supported !== false) children.push(statusLabel);
  section = el('section', { className: 'settings-group', attrs: { id: 'virtualCameraSettings' } }, [
    el('h3', { className: 'settings-group-title', text: 'Virtual camera' }),
    el('div', { className: 'settings-card' }, [el('div', { className: 'settings-block virtual-camera-block' }, children)]),
  ]);
  updateStatus(status);
  return section;
}
