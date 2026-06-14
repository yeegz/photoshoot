// Zero-trust custom-filter validation. A community "filter" is pure DATA, never
// code: a small set of clamped numeric color grades plus an OPTIONAL look-up
// table (LUT) image. It is applied by ONE fixed, audited shader in the renderer
// (gl/shaders.ts → `customfilter`). Nothing here ever becomes shader source,
// JavaScript, CSS, or HTML — the worst a malicious filter can do is make an ugly
// picture. This module is pure (no Node/DOM) and runs BOTH at import time (main
// or web shim) and again in the renderer before any value reaches WebGL.
//
// Security properties:
//   • Every parameter is coerced to a finite number and hard-clamped to a fixed
//     range. Unknown keys are ignored; extra structure is dropped.
//   • A LUT is validated by PNG magic bytes AND its IHDR dimensions (must be a
//     512×512 64-level cube). The bytes are decoded only by the browser's own
//     image decoder into a texture — never parsed as anything executable.
//   • Strings (name/author) are sanitized and length-capped.

import { sanitizeText, detectImageMime } from './theme-schema';

export const FILTER_SCHEMA_VERSION = 1;

export const FILTER_LIMITS = {
  manifestBytes: 64 * 1024, // 64 KB manifest cap (it's just numbers)
  lutBytes: 2 * 1024 * 1024, // 2 MB LUT image cap
  lutSize: 512, // a 64-level square LUT is exactly 512×512
  maxFilters: 60, // cap the stored library so it can't grow without bound
  maxNameLength: 48,
  maxTextLength: 200,
} as const;

// The complete, fixed vocabulary of grades a filter may set. Each is a plain
// number clamped to [min,max]; `def` is used when the key is absent/invalid.
export const FILTER_PARAM_DEFS = [
  { key: 'brightness', min: -1, max: 1, def: 0 },
  { key: 'contrast', min: 0, max: 2.5, def: 1 },
  { key: 'saturation', min: 0, max: 2.5, def: 1 },
  { key: 'temperature', min: -1, max: 1, def: 0 },
  { key: 'tint', min: -1, max: 1, def: 0 },
  { key: 'gamma', min: 0.2, max: 3, def: 1 },
  { key: 'fade', min: 0, max: 1, def: 0 },
  { key: 'vignette', min: 0, max: 1, def: 0 },
  { key: 'grain', min: 0, max: 1, def: 0 },
  { key: 'hue', min: -180, max: 180, def: 0 },
  { key: 'lutAmount', min: 0, max: 1, def: 1 },
] as const;

export type FilterParamKey = (typeof FILTER_PARAM_DEFS)[number]['key'];

export type FilterParams = Record<FilterParamKey, number>;

export function defaultParams(): FilterParams {
  const out = {} as FilterParams;
  for (const d of FILTER_PARAM_DEFS) out[d.key] = d.def;
  return out;
}

function clampFinite(raw: unknown, min: number, max: number, def: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : def;
  return Math.min(max, Math.max(min, n));
}

/**
 * Clamp an arbitrary (possibly already-stored, possibly tampered) params object
 * to the fixed vocabulary + ranges. The renderer runs this on every filter
 * before any number reaches WebGL — defense in depth, so a corrupted store can
 * never push NaN/Infinity/out-of-range values (e.g. gamma ≤ 0) into the shader.
 */
export function clampParams(raw: unknown): FilterParams {
  const out = defaultParams();
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const d of FILTER_PARAM_DEFS) out[d.key] = clampFinite(src[d.key], d.min, d.max, d.def);
  return out;
}

export interface ValidatedFilter {
  ok: boolean;
  name?: string;
  author?: string;
  description?: string;
  params?: FilterParams;
  lutRef?: string; // sibling file name a manifest asked to load (caller resolves it)
  error?: string;
  warnings?: string[];
}

/**
 * Validate the numeric/string portion of an untrusted filter manifest. The LUT
 * image itself is read + validated by the caller (it lives in a sibling file)
 * and passed to `validateLutPng`. Never throws.
 */
export function validateFilterManifest(raw: unknown): ValidatedFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Filter manifest must be a JSON object.' };
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.schemaVersion === 'number' && m.schemaVersion > FILTER_SCHEMA_VERSION) {
    return { ok: false, error: 'Filter requires a newer version of Photoshoot.' };
  }

  const name = sanitizeText(m.name, FILTER_LIMITS.maxNameLength) || 'Untitled Filter';
  const author = sanitizeText(m.author, FILTER_LIMITS.maxNameLength) || 'Unknown';
  const description = sanitizeText(m.description, FILTER_LIMITS.maxTextLength);

  const params = defaultParams();
  const src = m.params && typeof m.params === 'object' ? (m.params as Record<string, unknown>) : {};
  for (const d of FILTER_PARAM_DEFS) {
    params[d.key] = clampFinite(src[d.key], d.min, d.max, d.def);
  }

  // A LUT reference is just a leaf file name; the caller validates the bytes.
  let lutRef: string | undefined;
  if (typeof m.lut === 'string' && isSafeLutName(m.lut)) lutRef = m.lut;

  return { ok: true, name, author, description, params, lutRef };
}

const ALLOWED_LUT_EXT = ['.png'];

/** A LUT file reference must be a plain leaf name ending in .png — no traversal. */
export function isSafeLutName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 80) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  if (name.startsWith('.')) return false;
  if (/[\x00-\x1f<>:"|?*]/.test(name)) return false;
  return ALLOWED_LUT_EXT.some((ext) => name.toLowerCase().endsWith(ext));
}

export interface LutCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validate raw LUT bytes: must be a PNG (magic bytes) whose IHDR declares the
 * exact LUT cube size (512×512). We read the PNG header directly rather than
 * trusting the file extension or any manifest-declared size.
 */
export function validateLutPng(bytes: Uint8Array): LutCheck {
  if (bytes.length > FILTER_LIMITS.lutBytes) return { ok: false, reason: 'LUT image is too large.' };
  if (detectImageMime(bytes) !== 'image/png') return { ok: false, reason: 'LUT must be a PNG image.' };
  // PNG: 8-byte signature, then IHDR chunk = 4-byte length + "IHDR" + width(4) + height(4).
  // width is at byte offset 16, height at 20 (big-endian uint32).
  if (bytes.length < 24) return { ok: false, reason: 'LUT image is truncated.' };
  const readU32 = (o: number) =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const width = readU32(16);
  const height = readU32(20);
  if (width !== FILTER_LIMITS.lutSize || height !== FILTER_LIMITS.lutSize) {
    return {
      ok: false,
      reason: `LUT must be exactly ${FILTER_LIMITS.lutSize}×${FILTER_LIMITS.lutSize} (a 64-level cube).`,
    };
  }
  return { ok: true };
}
