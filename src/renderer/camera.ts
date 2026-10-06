// Webcam acquisition + lifecycle. Wraps getUserMedia with clear, typed error
// states so the UI can show the right "no camera / permission denied / camera
// busy" screen. Tracks are always stopped on teardown.

export type CameraErrorKind = 'denied' | 'notfound' | 'inuse' | 'insecure' | 'playback' | 'timeout' | 'cancelled' | 'unknown';

export interface CameraStartResult {
  ok: boolean;
  error?: CameraErrorKind;
  message?: string;
  deviceId?: string;
}

export interface CameraDevice {
  id: string;
  label: string;
}

export class CameraManager {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private generation = 0;
  onActiveDevice: ((id: string) => void) | null = null;
  onDeviceListChanged: (() => void) | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    // Kept off-screen; pixels flow through WebGL, not this element.
    this.video.style.position = 'absolute';
    this.video.style.width = '1px';
    this.video.style.height = '1px';
    this.video.style.opacity = '0';
    this.video.style.pointerEvents = 'none';
    document.body.appendChild(this.video);

    if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.onDeviceListChanged?.();
      });
    }
  }

  async listDevices(): Promise<CameraDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch {
      return [];
    }
  }

  async start(deviceId?: string | null): Promise<CameraStartResult> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, error: 'insecure', message: 'Camera API unavailable in this context.' };
    }
    this.stop();

    const generation = this.generation;
    const preferred: MediaTrackConstraints = {
      width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
    };
    // Some drivers reject even optional capture settings. Relax them on the
    // requested camera before trying the default device; never retry denial.
    const attempts: (MediaTrackConstraints | true)[] = deviceId
      ? [{ ...preferred, deviceId: { exact: deviceId } }, { deviceId: { exact: deviceId } }, preferred, true]
      : [preferred, true];
    let lastError: unknown;
    for (const constraints of attempts) {
      let stream: MediaStream;
      let expired = false;
      try {
        const acquisition = navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
          .then((media) => {
            // getUserMedia cannot be aborted. Release any result that arrives
            // after our deadline, camera switch, or teardown.
            if (expired || generation !== this.generation) media.getTracks().forEach((track) => track.stop());
            return media;
          });
        stream = await withTimeout(acquisition, 30000);
      } catch (err) {
        expired = true;
        if (generation !== this.generation) return { ok: false, error: 'cancelled' };
        lastError = err;
        if (isDeviceSpecificError(err)) continue;
        return { ok: false, ...classifyError(err) };
      }
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return { ok: false, error: 'cancelled' };
      }
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') throw new Error('No live video track.');
        // Permission to acquire a device does not guarantee video playback.
        await withTimeout(this.video.play(), 10000);
        if (generation !== this.generation) return { ok: false, error: 'cancelled' };
        if (!(await this.waitForFrame(10000))) throw { name: 'TimeoutError' };
        if (generation !== this.generation) return { ok: false, error: 'cancelled' };
        const activeId = track.getSettings().deviceId ?? '';
        track.addEventListener('ended', () => {
          if (generation === this.generation) this.onDeviceListChanged?.();
        });
        if (activeId) this.onActiveDevice?.(activeId);
        return { ok: true, deviceId: activeId };
      } catch (err) {
        if (generation !== this.generation) return { ok: false, error: 'cancelled' };
        this.stop();
        return { ok: false, error: errName(err) === 'TimeoutError' ? 'timeout' : 'playback',
          message: 'The camera opened but did not produce playable video.' };
      }
    }
    return { ok: false, ...classifyError(lastError) };
  }

  /** Wait for a decoded frame, not just metadata. All listeners are bounded. */
  async waitForFrame(timeoutMs = 10000): Promise<boolean> {
    const generation = this.generation;
    const ready = () => generation === this.generation && this.video.readyState >= 2 &&
      this.video.videoWidth > 0 && this.video.videoHeight > 0;
    if (ready()) return true;
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        clearInterval(poll);
        this.video.removeEventListener('loadeddata', onData);
        this.video.removeEventListener('playing', onData);
        resolve(ok);
      };
      const onData = () => { if (ready()) done(true); };
      const timer = setTimeout(() => done(ready()), timeoutMs);
      const poll = setInterval(() => {
        if (generation !== this.generation) done(false);
        else onData();
      }, 50);
      this.video.addEventListener('loadeddata', onData);
      this.video.addEventListener('playing', onData);
    });
  }

  stop(): void {
    this.generation++;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.pause();
    this.video.srcObject = null;
  }

  get aspect(): number {
    if (this.video.videoWidth && this.video.videoHeight) {
      return this.video.videoWidth / this.video.videoHeight;
    }
    return 4 / 3;
  }
}

// getUserMedia rejects with several error types. OverconstrainedError is NOT a
// DOMException, so read `.name` generically rather than gating on DOMException.
function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

function classifyError(err: unknown): { error: CameraErrorKind; message: string } {
  switch (errName(err)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { error: 'denied', message: 'Camera access was blocked.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { error: 'notfound', message: 'No camera was found.' };
    case 'NotReadableError':
    case 'AbortError':
      return { error: 'inuse', message: 'The camera is in use by another app.' };
    case 'TimeoutError':
      return { error: 'timeout', message: 'The camera did not respond. Check the permission prompt and try again.' };
    default:
      return { error: 'unknown', message: 'Could not start the camera.' };
  }
}

// Errors that mean "this specific device couldn't be opened" — worth retrying
// with the default camera (no deviceId constraint) before giving up.
function isDeviceSpecificError(err: unknown): boolean {
  switch (errName(err)) {
    case 'OverconstrainedError':
    case 'NotFoundError':
    case 'NotReadableError':
    case 'AbortError':
      return true;
    default:
      return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject({ name: 'TimeoutError' }), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
