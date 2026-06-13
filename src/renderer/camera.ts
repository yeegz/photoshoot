// Webcam acquisition + lifecycle. Wraps getUserMedia with clear, typed error
// states so the UI can show the right "no camera / permission denied / camera
// busy" screen. Tracks are always stopped on teardown.

export type CameraErrorKind = 'denied' | 'notfound' | 'inuse' | 'insecure' | 'unknown';

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

    const video: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const activeId = track?.getSettings().deviceId ?? deviceId ?? '';
      if (track) {
        track.addEventListener('ended', () => this.onDeviceListChanged?.());
      }
      if (activeId) this.onActiveDevice?.(activeId);
      return { ok: true, deviceId: activeId };
    } catch (err) {
      return { ok: false, ...classifyError(err) };
    }
  }

  /** Wait until the video has real dimensions (or time out). */
  async waitForFrame(timeoutMs = 6000): Promise<boolean> {
    if (this.video.videoWidth > 0) return true;
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        this.video.removeEventListener('loadeddata', onData);
        resolve(ok);
      };
      const onData = () => done(this.video.videoWidth > 0);
      this.video.addEventListener('loadeddata', onData);
      setTimeout(() => done(this.video.videoWidth > 0), timeoutMs);
    });
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  get aspect(): number {
    if (this.video.videoWidth && this.video.videoHeight) {
      return this.video.videoWidth / this.video.videoHeight;
    }
    return 4 / 3;
  }
}

function classifyError(err: unknown): { error: CameraErrorKind; message: string } {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { error: 'denied', message: 'Camera access was blocked.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { error: 'notfound', message: 'No camera was found.' };
    case 'NotReadableError':
    case 'AbortError':
      return { error: 'inuse', message: 'The camera is in use by another app.' };
    default:
      return { error: 'unknown', message: 'Could not start the camera.' };
  }
}
