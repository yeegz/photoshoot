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
  // Expressions, smoothed 0..1: [mouth open, eyebrows raised, smile, blink].
  expr: [number, number, number, number];
}

/** How many people the face effects follow at once. */
export const MAX_FACES = 4;

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
  expr: [0, 0, 0, 0],
};

let landmarker: FaceLandmarker | null = null;
let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let loadPromise: Promise<boolean> | null = null;
let running = false;
let activation = 0;
let rafId = 0;
let lastFrameTime = -1;
let lastStamp = 0;
let latest: FacePoints[] = [];
// Per face: how fast each point moves (units per ms) and when it was measured.
type Motion = { v: Record<PointKey, Pt>; at: number };
type PointKey = 'eyeL' | 'eyeR' | 'nose' | 'mouth' | 'chin' | 'brow' | 'cheekL' | 'cheekR' | 'faceC';
const POINT_KEYS: PointKey[] = ['eyeL', 'eyeR', 'nose', 'mouth', 'chin', 'brow', 'cheekL', 'cheekR', 'faceC'];
let motion: Motion[] = [];
let predicted: { at: number; faces: FacePoints[] } = { at: -1, faces: [] };
const LEAD_MAX_MS = 110; // never predict further ahead than this

/**
 * Every tracked face (up to MAX_FACES). Between detections each face is moved
 * ahead along its measured velocity, so masks stay on a moving head instead of
 * trailing the last detection.
 */
export function getFaces(): readonly FacePoints[] {
  const now = performance.now();
  if (predicted.at === now) return predicted.faces;
  const faces = latest.map((f, i) => {
    const m = motion[i];
    if (!m) return f;
    const lead = Math.min(LEAD_MAX_MS, now - m.at);
    if (lead <= 0) return f;
    const out = { ...f };
    for (const k of POINT_KEYS) out[k] = [f[k][0] + m.v[k][0] * lead, f[k][1] + m.v[k][1] * lead];
    return out;
  });
  predicted = { at: now, faces };
  return faces;
}

/** The first face, or a neutral placeholder. */
export function getFace(): FacePoints {
  return latest[0] ?? EMPTY;
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
        numFaces: MAX_FACES,
        outputFaceBlendshapes: true, // drives the expression triggers (open mouth, raised brows…)
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
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
  const request = activation;
  const ok = await load();
  if (!ok || request !== activation || running) return;
  running = true;
  loop();
}

export function deactivateFaceTracking(): void {
  activation++;
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  latest = [];
  motion = [];
  predicted = { at: -1, faces: [] };
}

function mid(a: Pt, b: Pt): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
function pxDist(a: Pt, b: Pt, w: number, h: number): number {
  return Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h);
}
function distOf(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

const mixPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Follow each person from frame to frame (nearest previous face) and ease the
 * points and expressions, so masks sit still instead of jittering and
 * expression triggers ramp in and out smoothly.
 */
function smooth(next: FacePoints[], prev: FacePoints[], dt: number): FacePoints[] {
  const used = new Set<number>();
  return next.map((f) => {
    let best = -1;
    let bestD = 0.12;
    prev.forEach((q, i) => {
      const d = distOf(f.faceC, q.faceC);
      if (!used.has(i) && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best < 0) return f;
    used.add(best);
    const q = prev[best];
    // Adaptive (one-euro style): heavy smoothing while still kills jitter; the
    // faster the head moves, the more directly the mask follows it.
    const speed = distOf(f.faceC, q.faceC) / (q.faceR || 0.1) / (dt / 33);
    const t = Math.min(1, 0.32 + speed * 2.2);
    const keys = ['eyeL', 'eyeR', 'nose', 'mouth', 'chin', 'brow', 'cheekL', 'cheekR', 'faceC'] as const;
    const out = { ...f };
    for (const k of keys) out[k] = mixPt(q[k], f[k], t);
    out.faceR = q.faceR + (f.faceR - q.faceR) * t;
    out.expr = f.expr.map((v, i) => q.expr[i] + (v - q.expr[i]) * 0.5) as FacePoints['expr'];
    return out;
  });
}

/** The model can report one fast-moving face twice; keep one per person. */
function dedupe(faces: FacePoints[]): FacePoints[] {
  const kept: FacePoints[] = [];
  for (const f of faces) {
    if (!kept.some((k) => distOf(k.faceC, f.faceC) < Math.max(k.faceR, f.faceR) * 1.2)) kept.push(f);
  }
  return kept;
}

/** Velocity per point, eased, for faces that match one from the previous detection. */
function track(next: FacePoints[], prev: FacePoints[], prevMotion: Motion[], dt: number, now: number): Motion[] {
  return next.map((f) => {
    let best = -1;
    let bestD = 0.12;
    prev.forEach((q, i) => {
      const d = distOf(f.faceC, q.faceC);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    const v = {} as Record<PointKey, Pt>;
    for (const k of POINT_KEYS) {
      if (best < 0) {
        v[k] = [0, 0];
        continue;
      }
      const raw: Pt = [(f[k][0] - prev[best][k][0]) / dt, (f[k][1] - prev[best][k][1]) / dt];
      const old = prevMotion[best]?.v[k] ?? raw;
      v[k] = [old[0] + (raw[0] - old[0]) * 0.6, old[1] + (raw[1] - old[1]) * 0.6];
    }
    return { v, at: now };
  });
}

function loop(): void {
  if (!running || !landmarker) return;
  const video = app.video;
  const now = performance.now();
  // Detect on every new camera frame, so masks stay attached as heads move.
  if (video && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastFrameTime) {
    lastFrameTime = video.currentTime;
    const dt = Math.max(1, now - lastStamp);
    lastStamp = now;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    try {
      const res = landmarker.detectForVideo(video, now);
      const faces: FacePoints[] = [];
      (res.faceLandmarks ?? []).forEach((lm, index) => {
        if (!lm || lm.length < 468) return;
        const p = (i: number): Pt => [lm[i].x, lm[i].y];
        const eyeL: Pt = lm.length > 468 ? p(468) : mid(p(33), p(133));
        const eyeR: Pt = lm.length > 473 ? p(473) : mid(p(362), p(263));
        const brow = p(10);
        const chin = p(152);
        const shapes = res.faceBlendshapes?.[index]?.categories ?? [];
        const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
        faces.push({
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
          // Size in picture-width units, measured in pixels so tilting doesn't
          // change it, with face height as a floor so turning your head doesn't
          // shrink the masks.
          faceR: Math.max(0.03, Math.max(pxDist(eyeL, eyeR, vw, vh), 0.33 * pxDist(brow, chin, vw, vh)) / vw),
          expr: [
            score('jawOpen'),
            // Inner and outer together: a squint lifts only the inner brows.
            (score('browInnerUp') + (score('browOuterUpLeft') + score('browOuterUpRight')) / 2) / 2,
            (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
            (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2,
          ],
        });
      });
      const prev = latest;
      latest = smooth(dedupe(faces), latest, dt);
      motion = track(latest, prev, motion, dt, now);
    } catch {
      /* skip this frame */
    }
  }
  rafId = requestAnimationFrame(loop);
}
