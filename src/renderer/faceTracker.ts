// Face landmark tracking for the "fun face" effects, powered by MediaPipe
// FaceLandmarker. Everything runs locally (WASM + model served from the app
// origin); nothing is uploaded. The model + WASM are fetched lazily the first
// time a face effect is used, and the whole thing degrades gracefully: if it
// can't load, face effects simply fall back to the normal image.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { app } from './app';

export type Pt = [number, number];

export interface FacePoints {
  found: boolean;
  eyeL: Pt;
  eyeR: Pt;
  nose: Pt;
  mouth: Pt;
  chin: Pt;
  brow: Pt;
  cheekL: Pt;
  cheekR: Pt;
  faceC: Pt;
  faceR: number; // inter-eye distance, a scale for the warps
}

const EMPTY: FacePoints = {
  found: false,
  eyeL: [0.42, 0.45],
  eyeR: [0.58, 0.45],
  nose: [0.5, 0.55],
  mouth: [0.5, 0.68],
  chin: [0.5, 0.85],
  brow: [0.5, 0.28],
  cheekL: [0.36, 0.6],
  cheekR: [0.64, 0.6],
  faceC: [0.5, 0.55],
  faceR: 0.16,
};

let landmarker: FaceLandmarker | null = null;
let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let loadPromise: Promise<boolean> | null = null;
let running = false;
let rafId = 0;
let lastDetect = 0;
let latest: FacePoints = EMPTY;

export function getFace(): FacePoints {
  return latest;
}

export function faceTrackingReady(): boolean {
  return loadState === 'ready';
}

async function load(): Promise<boolean> {
  if (loadState === 'ready') return true;
  if (loadState === 'failed') return false;
  if (loadPromise) return loadPromise;
  loadState = 'loading';
  loadPromise = (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks('mediapipe/wasm');
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: 'mediapipe/face_landmarker.task' },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      loadState = 'ready';
      return true;
    } catch (err) {
      console.warn('[photoshoot] face tracking unavailable:', err);
      loadState = 'failed';
      return false;
    }
  })();
  return loadPromise;
}

export async function activateFaceTracking(): Promise<void> {
  if (running) return;
  const ok = await load();
  if (!ok) return;
  running = true;
  loop();
}

export function deactivateFaceTracking(): void {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  latest = EMPTY;
}

function mid(a: Pt, b: Pt): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
function distOf(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function loop(): void {
  if (!running || !landmarker) return;
  const video = app.video;
  const now = performance.now();
  // ~22fps detection is plenty for faces and leaves the render loop at 60.
  if (video && video.readyState >= 2 && video.videoWidth > 0 && now - lastDetect > 45) {
    lastDetect = now;
    try {
      const res = landmarker.detectForVideo(video, now);
      const lm = res.faceLandmarks && res.faceLandmarks[0];
      if (lm && lm.length >= 468) {
        const p = (i: number): Pt => [lm[i].x, lm[i].y];
        const eyeL: Pt = lm.length > 468 ? p(468) : mid(p(33), p(133));
        const eyeR: Pt = lm.length > 473 ? p(473) : mid(p(362), p(263));
        const brow = p(10);
        const chin = p(152);
        latest = {
          found: true,
          eyeL,
          eyeR,
          nose: p(1),
          mouth: mid(p(13), p(14)),
          chin,
          brow,
          cheekL: p(234),
          cheekR: p(454),
          faceC: mid(brow, chin),
          faceR: Math.max(0.05, distOf(eyeL, eyeR)),
        };
      } else {
        latest = EMPTY;
      }
    } catch {
      /* skip this frame */
    }
  }
  rafId = requestAnimationFrame(loop);
}
