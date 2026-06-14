// Settings + gallery persistence and capture-to-disk. All file system access in
// the app funnels through here (and themeImport.ts). The renderer never sees a
// real path it didn't receive from us.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveDir, settingsFile, galleryFile, isInside } from './paths';
import {
  DEFAULT_SETTINGS,
  Settings,
  GalleryItem,
  SaveRequest,
  SaveResult,
  CaptureFormat,
} from '../shared/ipc-contract';

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024; // 64 MB hard cap per capture
const MAX_GALLERY_ITEMS = 500;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

function coerceSettings(raw: unknown): Settings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const format: CaptureFormat = obj.format === 'jpg' ? 'jpg' : 'png';
  return {
    theme: typeof obj.theme === 'string' && obj.theme.length < 80 ? obj.theme : DEFAULT_SETTINGS.theme,
    autoTheme: typeof obj.autoTheme === 'boolean' ? obj.autoTheme : DEFAULT_SETTINGS.autoTheme,
    cameraId:
      typeof obj.cameraId === 'string' && obj.cameraId.length < 256 ? obj.cameraId : null,
    mirror: typeof obj.mirror === 'boolean' ? obj.mirror : DEFAULT_SETTINGS.mirror,
    countdownSeconds: clamp(obj.countdownSeconds, 0, 5, DEFAULT_SETTINGS.countdownSeconds),
    format,
    volume: clamp(obj.volume, 0, 1, DEFAULT_SETTINGS.volume),
    muted: typeof obj.muted === 'boolean' ? obj.muted : DEFAULT_SETTINGS.muted,
    bgTolerance: clamp(obj.bgTolerance, 0.05, 0.8, DEFAULT_SETTINGS.bgTolerance),
    perfOverlay: typeof obj.perfOverlay === 'boolean' ? obj.perfOverlay : DEFAULT_SETTINGS.perfOverlay,
    reducedMotion:
      typeof obj.reducedMotion === 'boolean' ? obj.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  };
}

export async function readSettings(): Promise<Settings> {
  try {
    const text = await fs.readFile(settingsFile(), 'utf8');
    return coerceSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await readSettings();
  const merged = coerceSettings({ ...current, ...patch });
  await fs.writeFile(settingsFile(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// ---------------------------------------------------------------------------
// Gallery metadata
// ---------------------------------------------------------------------------

export async function readGallery(): Promise<GalleryItem[]> {
  try {
    const text = await fs.readFile(galleryFile(), 'utf8');
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidGalleryItem);
  } catch {
    return [];
  }
}

function isValidGalleryItem(x: unknown): x is GalleryItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.path === 'string' &&
    typeof o.filename === 'string' &&
    typeof o.createdAt === 'number'
  );
}

async function writeGallery(items: GalleryItem[]): Promise<void> {
  const trimmed = items.slice(0, MAX_GALLERY_ITEMS);
  await fs.writeFile(galleryFile(), JSON.stringify(trimmed, null, 2), 'utf8');
}

/** Returns gallery items, dropping any whose backing file has vanished. */
export async function listGalleryWithExistenceCheck(): Promise<GalleryItem[]> {
  const items = await readGallery();
  const checked = await Promise.all(
    items.map(async (item) => {
      try {
        await fs.access(item.path);
        return item;
      } catch {
        return null;
      }
    })
  );
  const alive = checked.filter((x): x is GalleryItem => x !== null);
  if (alive.length !== items.length) await writeGallery(alive);
  return alive;
}

// ---------------------------------------------------------------------------
// Capture saving
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function timestampName(kind: string, ext: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const safeKind = kind.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'photo';
  return `Photoshoot_${safeKind}_${stamp}.${ext}`;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer };
}

function extFor(kind: string, format: CaptureFormat, mime: string): string {
  if (kind === 'video' || mime.startsWith('video/')) return 'webm';
  return format === 'jpg' ? 'jpg' : 'png';
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let counter = 1;
  // Defend against (very unlikely) same-second collisions.
  for (;;) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${stem}_${counter}${ext}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

export async function saveCapture(req: SaveRequest): Promise<SaveResult> {
  try {
    if (!req || typeof req.dataUrl !== 'string') return { ok: false, error: 'Invalid capture payload.' };

    const parsed = parseDataUrl(req.dataUrl);
    if (!parsed) return { ok: false, error: 'Could not decode capture data.' };
    if (parsed.buffer.length === 0) return { ok: false, error: 'Capture was empty.' };
    if (parsed.buffer.length > MAX_CAPTURE_BYTES) return { ok: false, error: 'Capture too large.' };

    const allowed = ['image/png', 'image/jpeg', 'video/webm'];
    if (!allowed.includes(parsed.mime)) return { ok: false, error: 'Unsupported capture type.' };

    const kind = req.kind === 'strip' ? 'strip' : req.kind === 'video' ? 'video' : 'single';
    const format: CaptureFormat = req.format === 'jpg' ? 'jpg' : 'png';
    const ext = extFor(kind, format, parsed.mime);

    const dir = saveDir();
    const filename = path.basename(await uniquePath(dir, timestampName(kind, ext)));
    const fullPath = path.join(dir, filename);

    // Final safety: the resolved write target must live inside the save folder.
    if (!isInside(dir, fullPath)) return { ok: false, error: 'Refused to write outside the save folder.' };

    await fs.writeFile(fullPath, parsed.buffer);

    const item: GalleryItem = {
      id: randomUUID(),
      filename,
      path: fullPath,
      kind,
      effect: typeof req.effect === 'string' ? req.effect.slice(0, 40) : 'normal',
      format,
      createdAt: Date.now(),
      thumbnail:
        typeof req.thumbnail === 'string' && req.thumbnail.startsWith('data:image/')
          ? req.thumbnail.slice(0, 400_000)
          : '',
      width: typeof req.width === 'number' ? req.width : 0,
      height: typeof req.height === 'number' ? req.height : 0,
    };

    const items = await readGallery();
    items.unshift(item);
    await writeGallery(items);

    return { ok: true, id: item.id, filename, path: fullPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Save failed.' };
  }
}

export async function getGalleryItem(id: string): Promise<GalleryItem | null> {
  const items = await readGallery();
  return items.find((i) => i.id === id) ?? null;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
};

/** Reads a capture back as a data URL for full-resolution in-app preview. */
export async function readItemDataUrl(
  id: string
): Promise<{ ok: boolean; dataUrl?: string; mime?: string }> {
  const item = await getGalleryItem(id);
  if (!item) return { ok: false };
  // Only ever read inside the save folder.
  if (!isInside(saveDir(), item.path)) return { ok: false };
  try {
    const stat = await fs.stat(item.path);
    if (stat.size > MAX_CAPTURE_BYTES) return { ok: false };
    const mime = MIME_BY_EXT[path.extname(item.path).toLowerCase()] ?? 'application/octet-stream';
    const buffer = await fs.readFile(item.path);
    return { ok: true, mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  } catch {
    return { ok: false };
  }
}

/** Copies a capture out of the save folder to a user-chosen destination. */
export async function exportItemTo(srcPath: string, destPath: string): Promise<{ ok: boolean }> {
  try {
    if (!isInside(saveDir(), srcPath)) return { ok: false };
    await fs.copyFile(srcPath, destPath);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function deleteGalleryItem(id: string, deleteFile: boolean): Promise<{ ok: boolean }> {
  const items = await readGallery();
  const target = items.find((i) => i.id === id);
  const remaining = items.filter((i) => i.id !== id);
  await writeGallery(remaining);
  if (deleteFile && target) {
    try {
      // Only ever delete inside our save folder.
      if (isInside(saveDir(), target.path)) await fs.unlink(target.path);
    } catch {
      /* file may already be gone — ignore */
    }
  }
  return { ok: true };
}
