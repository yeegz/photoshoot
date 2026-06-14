// Renderer bootstrap. Loads settings + app info, brings up the camera and the
// WebGL pipeline, applies the saved theme, builds every panel, and wires all the
// controls and keyboard shortcuts. This is the only module with a side-effecting
// entry point.

import { app } from './app';
import { api } from './bridge';
import { GLRenderer } from './gl/renderer';
import { CameraManager } from './camera';
import { sound } from './sound';
import { byId, qsa } from './dom';
import { toast } from './toast';
import { loadImportedThemes, applyResolvedTheme, watchDeviceTheme } from './themes';
import { loadCustomFilters, registerFilterSink } from './customFilters';
import { refreshGallery, exitReview } from './gallery';
import { buildEffectsMenu, toggleEffects, closeEffects, isEffectsOpen } from './effectsMenu';
import { initBackgroundsMenu } from './backgroundsMenu';
import { BackgroundReplacer } from './backgroundReplace';
import { initSettings, openSettings } from './settings';
import { setPerfOverlay } from './perf';
import { triggerShutter, videoRecorder } from './capture';
import { openOverlay, closeOverlay, closeTop, isAnyOpen } from './overlays';
import { effectLabel, isDraggable } from './gl/effects';
import type { CameraErrorKind } from './camera';
import type { CaptureKind } from '../shared/ipc-contract';

const camera = new CameraManager();
let bgReplacer: BackgroundReplacer;

// ---------------------------------------------------------------------------
// Viewfinder messaging
// ---------------------------------------------------------------------------

interface MessageAction {
  label: string;
  action: () => void;
}

function showMessage(icon: string, title: string, text: string, action: MessageAction | null): void {
  byId('vfMessageIcon').textContent = icon;
  byId('vfMessageTitle').textContent = title;
  byId('vfMessageText').textContent = text;
  const btn = byId<HTMLButtonElement>('vfMessageAction');
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.action;
    btn.classList.remove('hidden');
  } else {
    btn.onclick = null;
    btn.classList.add('hidden');
  }
  byId('vfMessage').classList.remove('hidden');
}

function hideMessage(): void {
  byId('vfMessage').classList.add('hidden');
}

function setStatus(text: string, kind: '' | 'live' | 'error'): void {
  const lbl = byId('cameraStatusLabel');
  lbl.textContent = text;
  lbl.classList.toggle('is-live', kind === 'live');
  lbl.classList.toggle('is-error', kind === 'error');
  // No "Camera live" label — when the camera is up, the status disappears.
  lbl.classList.toggle('is-hidden', kind === 'live' || text === '');
}

function handleCameraError(kind: CameraErrorKind | undefined): void {
  sound.play('error');
  setStatus('Camera unavailable', 'error');
  const retry: MessageAction = {
    label: 'Try Again',
    action: () => void startCamera(app.settings.cameraId),
  };
  switch (kind) {
    case 'denied':
      showMessage(
        '🔒',
        'Camera access blocked',
        app.info?.platform === 'web'
          ? 'Photoshoot needs your webcam. Allow camera access for this site in your browser (look for the camera icon near the address bar), then try again.'
          : 'Photoshoot needs your webcam. On Windows, allow camera access in Settings → Privacy & security → Camera, then try again.',
        retry
      );
      break;
    case 'notfound':
      showMessage('📷', 'No camera found', 'Connect a webcam, then try again.', retry);
      break;
    case 'inuse':
      showMessage('⏳', 'Camera in use', 'Another app is using your camera. Close it and try again.', retry);
      break;
    default:
      showMessage('⚠', 'Camera could not start', 'Something went wrong starting the camera.', retry);
  }
}

// ---------------------------------------------------------------------------
// Camera lifecycle
// ---------------------------------------------------------------------------

async function startCamera(deviceId: string | null): Promise<void> {
  if (!app.renderer.available) return;
  if (bgReplacer?.isActive()) bgReplacer.stop();
  setStatus('Starting camera…', '');
  showMessage('◌', 'Just a moment', 'Waking up your webcam…', null);

  const res = await camera.start(deviceId);
  if (!res.ok) {
    handleCameraError(res.error);
    return;
  }

  await camera.waitForFrame();
  document.documentElement.style.setProperty('--vf-aspect', String(camera.aspect));
  app.renderer.setSource(camera.video);
  app.renderer.setMirror(app.settings.mirror);
  app.renderer.setEffect(app.effect);
  app.renderer.start();
  hideMessage();
  setStatus('Camera live', 'live');

  if (res.deviceId && res.deviceId !== app.settings.cameraId) {
    await app.updateSettings({ cameraId: res.deviceId });
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setMode(mode: CaptureKind): void {
  if (app.busy) return;
  if (app.mode === 'video' && videoRecorder.recording) videoRecorder.stop();
  app.mode = mode;
  qsa<HTMLButtonElement>('.mode-option').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-checked', String(active));
  });
  const shutter = byId('shutter');
  shutter.classList.toggle('mode-video', mode === 'video');
  shutter.setAttribute(
    'aria-label',
    mode === 'single' ? 'Take photo' : mode === 'strip' ? 'Take 4-shot strip' : 'Record video'
  );
  byId('shutterHint').textContent =
    mode === 'single' ? 'Tap to capture' : mode === 'strip' ? 'Tap for a 4‑shot strip' : 'Tap to record';
  sound.play('button');
}

function wireControls(): void {
  qsa<HTMLButtonElement>('.mode-option').forEach((b) =>
    b.addEventListener('click', () => setMode((b.dataset.mode as CaptureKind) ?? 'single'))
  );

  byId('shutter').addEventListener('click', () => void triggerShutter());

  byId('btnEffects').addEventListener('click', () => toggleEffects());
  byId('btnBackgrounds').addEventListener('click', () => openOverlay('backgroundsPanel'));
  byId('btnSettings').addEventListener('click', () => void openSettings());

  // Click the reviewed photo to return to the live camera.
  byId('review').addEventListener('click', () => exitReview());

  // Frameless window controls.
  byId('tlClose').addEventListener('click', () => api.closeWindow());
  byId('tlMin').addEventListener('click', () => api.minimizeWindow());
  byId('tlZoom').addEventListener('click', () => api.toggleMaximizeWindow());

  qsa<HTMLButtonElement>('[data-close]').forEach((b) =>
    b.addEventListener('click', () => closeOverlay(b.dataset.close ?? ''))
  );

  byId('scrim').addEventListener('click', () => closeTop());
}

// Drag on the live preview to move a distortion effect's center.
function wireDistortionDrag(): void {
  const canvas = byId<HTMLCanvasElement>('glCanvas');
  let dragging = false;
  const update = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    app.renderer.setCenter((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!isDraggable(app.effect)) return;
    dragging = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    update(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) update(e);
  });
  const end = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function wireKeyboard(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isEffectsOpen()) {
        closeEffects();
      } else if (isAnyOpen()) {
        closeTop();
      } else {
        exitReview();
      }
      return;
    }
    if (e.code === 'Space' && e.target === document.body && !isAnyOpen() && !isEffectsOpen()) {
      e.preventDefault();
      void triggerShutter();
    }
  });

  // Unlock the audio context on the very first interaction.
  const unlock = () => {
    sound.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  app.info = await api.getAppInfo();
  app.settings = await api.getSettings();
  app.video = camera.video;

  const renderer = new GLRenderer(byId<HTMLCanvasElement>('glCanvas'));
  app.renderer = renderer;
  registerFilterSink(renderer); // live preview can draw custom filters
  renderer.setSource(camera.video);
  renderer.onShaderError = (id, msg) => {
    toast(`Effect “${effectLabel(id)}” couldn't load; using Normal.`, 'error');
    console.warn('[shader]', id, msg);
  };
  renderer.onContextLost = () =>
    showMessage('⚠', 'Graphics reset', 'The graphics context was lost. It should recover shortly…', null);

  app.applySideEffects();
  await loadImportedThemes();
  await loadCustomFilters();
  applyResolvedTheme();
  watchDeviceTheme();
  setPerfOverlay(app.settings.perfOverlay);
  app.effect = 'normal';
  renderer.setEffect('normal');
  renderer.setMirror(app.settings.mirror);

  bgReplacer = new BackgroundReplacer();
  buildEffectsMenu();
  initBackgroundsMenu(bgReplacer);
  initSettings({
    listCameras: () => camera.listDevices(),
    selectCamera: (id: string) => startCamera(id || null),
  });
  await refreshGallery();

  wireControls();
  wireKeyboard();
  wireDistortionDrag();
  console.info('[photoshoot] renderer ready');

  if (!renderer.available) {
    showMessage(
      '⚠',
      'Graphics unavailable',
      'Photoshoot needs WebGL2 to render the camera, and it is not available on this system. You can still browse settings.',
      null
    );
    setStatus('WebGL unavailable', 'error');
    (byId('shutter') as HTMLButtonElement).disabled = true;
    return;
  }

  window.addEventListener('beforeunload', () => {
    camera.stop();
    renderer.dispose();
  });

  await startCamera(app.settings.cameraId);
}

bootstrap().catch((err) => {
  console.error('[photoshoot] bootstrap failed', err);
  showMessage('⚠', 'Something went wrong', 'Photoshoot could not start. Please restart the app.', null);
});
