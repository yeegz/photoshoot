// Browser implementation of the Photoshoot bridge. The renderer is unchanged —
// it just talks to window.photoshoot. On the web there is no Electron main
// process, so captures live in IndexedDB, settings/themes in localStorage, and
// "export" / "open" become browser downloads / new tabs. Camera processing still
// happens entirely on-device; nothing is uploaded.

import {
  PhotoshootBridge,
  AppInfo,
  Settings,
  DEFAULT_SETTINGS,
  SaveRequest,
  SaveResult,
  GalleryItem,
  ImportedTheme,
  ThemeImportResult,
  RawThemeManifest,
  BuiltInThemeId,
} from '../shared/ipc-contract';
import {
  THEME_LIMITS,
  THEME_SCHEMA_VERSION,
  ALLOWED_BASES,
  ALLOWED_TEXTURE_TOKENS,
  validateTokenValue,
  sanitizeText,
  isSafeAssetName,
  detectImageMime,
} from '../shared/theme-schema';

const SETTINGS_KEY = 'photoshoot.settings';
const THEMES_KEY = 'photoshoot.themes';
const DB_NAME = 'photoshoot';
const STORE = 'captures';

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

interface CaptureRecord extends GalleryItem {
  dataUrl: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(): Promise<CaptureRecord[]> {
  const db = await openDB();
  const store = db.transaction(STORE, 'readonly').objectStore(STORE);
  return reqToPromise(store.getAll() as IDBRequest<CaptureRecord[]>);
}
async function dbGet(id: string): Promise<CaptureRecord | undefined> {
  const db = await openDB();
  const store = db.transaction(STORE, 'readonly').objectStore(STORE);
  return reqToPromise(store.get(id) as IDBRequest<CaptureRecord | undefined>);
}
async function dbPut(record: CaptureRecord): Promise<void> {
  const db = await openDB();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await reqToPromise(store.put(record));
}
async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await reqToPromise(store.delete(id));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

function coerceSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    theme: typeof o.theme === 'string' ? o.theme : DEFAULT_SETTINGS.theme,
    autoTheme: typeof o.autoTheme === 'boolean' ? o.autoTheme : DEFAULT_SETTINGS.autoTheme,
    cameraId: typeof o.cameraId === 'string' ? o.cameraId : null,
    mirror: typeof o.mirror === 'boolean' ? o.mirror : DEFAULT_SETTINGS.mirror,
    countdownSeconds: clampNum(o.countdownSeconds, 0, 5, DEFAULT_SETTINGS.countdownSeconds),
    format: o.format === 'jpg' ? 'jpg' : 'png',
    volume: clampNum(o.volume, 0, 1, DEFAULT_SETTINGS.volume),
    muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_SETTINGS.muted,
    bgTolerance: clampNum(o.bgTolerance, 0.05, 0.8, DEFAULT_SETTINGS.bgTolerance),
    perfOverlay: typeof o.perfOverlay === 'boolean' ? o.perfOverlay : DEFAULT_SETTINGS.perfOverlay,
    reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
function timestampName(kind: string, ext: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Photoshoot_${kind}_${stamp}.${ext}`;
}

function download(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function readImported(): ImportedTheme[] {
  try {
    const arr = JSON.parse(localStorage.getItem(THEMES_KEY) ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeImported(themes: ImportedTheme[]): void {
  localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
}

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,image/png,image/jpeg,image/webp';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    });
    // If the dialog is dismissed there is no reliable event; rely on change.
    input.click();
  });
}

async function importThemeFromFiles(files: File[]): Promise<ThemeImportResult> {
  const warnings: string[] = [];
  const manifestFile = files.find((f) => f.name.toLowerCase().endsWith('.json'));
  if (!manifestFile) return { ok: false, error: 'No theme.json was selected.' };
  if (manifestFile.size > THEME_LIMITS.manifestBytes) return { ok: false, error: 'Theme manifest is too large.' };

  let manifest: RawThemeManifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    return { ok: false, error: 'Theme manifest is not valid JSON.' };
  }
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'Theme manifest must be a JSON object.' };
  if (typeof manifest.schemaVersion === 'number' && manifest.schemaVersion > THEME_SCHEMA_VERSION) {
    return { ok: false, error: 'Theme requires a newer version of Photoshoot.' };
  }

  const name = sanitizeText(manifest.name, THEME_LIMITS.maxNameLength) || 'Untitled Theme';
  const author = sanitizeText(manifest.author, THEME_LIMITS.maxNameLength) || 'Unknown';
  const description = sanitizeText(manifest.description, THEME_LIMITS.maxTextLength);
  const base: BuiltInThemeId = (ALLOWED_BASES as readonly string[]).includes(manifest.base as string)
    ? (manifest.base as BuiltInThemeId)
    : 'modern';

  const tokens: Record<string, string> = {};
  if (manifest.tokens && typeof manifest.tokens === 'object') {
    const entries = Object.entries(manifest.tokens as Record<string, unknown>);
    if (entries.length > THEME_LIMITS.maxTokens) return { ok: false, error: 'Theme defines too many tokens.' };
    for (const [key, raw] of entries) {
      const r = validateTokenValue(key, raw);
      if (r.ok && r.value) tokens[key] = r.value;
      else warnings.push(`Skipped token "${key}": ${r.reason}`);
    }
  }

  const textures: Record<string, string> = {};
  if (manifest.textures && typeof manifest.textures === 'object') {
    let total = 0;
    for (const [token, fileRef] of Object.entries(manifest.textures as Record<string, unknown>)) {
      if (!(ALLOWED_TEXTURE_TOKENS as readonly string[]).includes(token)) continue;
      if (!isSafeAssetName(fileRef)) {
        warnings.push(`Skipped unsafe asset "${String(fileRef)}".`);
        continue;
      }
      const file = files.find((f) => f.name === fileRef);
      if (!file) {
        warnings.push(`Asset "${fileRef}" was not included in the selection.`);
        continue;
      }
      if (file.size > THEME_LIMITS.assetBytes) {
        warnings.push(`Skipped oversized asset "${fileRef}".`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = detectImageMime(bytes);
      if (!mime) {
        warnings.push(`Skipped "${fileRef}": not a recognized image.`);
        continue;
      }
      total += bytes.length;
      if (total > THEME_LIMITS.totalAssetBytes) {
        warnings.push('Asset size limit reached.');
        break;
      }
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      textures[token] = `data:${mime};base64,${btoa(binary)}`;
    }
  }

  if (Object.keys(tokens).length === 0 && Object.keys(textures).length === 0) {
    return { ok: false, error: 'Theme has no usable tokens or textures.', warnings };
  }

  const theme: ImportedTheme = {
    id: crypto.randomUUID(),
    name,
    author,
    description,
    base,
    tokens,
    textures,
  };
  const themes = readImported();
  themes.push(theme);
  writeImported(themes);
  return { ok: true, theme, warnings: warnings.length ? warnings : undefined };
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const bridge: PhotoshootBridge = {
  getAppInfo: async (): Promise<AppInfo> => ({
    name: 'Photoshoot',
    version: '1.0.0',
    saveFolder: 'your browser downloads',
    themesFolder: '',
    platform: 'web',
  }),

  getSettings: async () => {
    try {
      return coerceSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  setSettings: async (patch: Partial<Settings>) => {
    const current = coerceSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'));
    const merged = coerceSettings({ ...current, ...patch });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  },

  saveCapture: async (req: SaveRequest): Promise<SaveResult> => {
    try {
      if (!req || typeof req.dataUrl !== 'string') return { ok: false, error: 'Invalid capture.' };
      const kind = req.kind === 'strip' ? 'strip' : req.kind === 'video' ? 'video' : 'single';
      const ext = kind === 'video' ? 'webm' : req.format === 'jpg' ? 'jpg' : 'png';
      const id = crypto.randomUUID();
      const filename = timestampName(kind, ext);
      const record: CaptureRecord = {
        id,
        filename,
        path: '',
        kind,
        effect: typeof req.effect === 'string' ? req.effect : 'normal',
        format: req.format === 'jpg' ? 'jpg' : 'png',
        createdAt: Date.now(),
        thumbnail: typeof req.thumbnail === 'string' ? req.thumbnail : '',
        width: req.width ?? 0,
        height: req.height ?? 0,
        dataUrl: req.dataUrl,
      };
      await dbPut(record);
      return { ok: true, id, filename };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Save failed.' };
    }
  },

  listGallery: async (): Promise<GalleryItem[]> => {
    const all = await dbGetAll();
    return all
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ dataUrl, ...meta }) => meta as GalleryItem);
  },

  readItem: async (id: string) => {
    const rec = await dbGet(id);
    if (!rec) return { ok: false };
    const mime = rec.kind === 'video' ? 'video/webm' : rec.format === 'jpg' ? 'image/jpeg' : 'image/png';
    return { ok: true, dataUrl: rec.dataUrl, mime };
  },

  exportItem: async (id: string) => {
    const rec = await dbGet(id);
    if (!rec) return { ok: false };
    download(rec.dataUrl, rec.filename);
    return { ok: true };
  },

  deleteGalleryItem: async (id: string) => {
    await dbDelete(id);
    return { ok: true };
  },

  revealItem: async (id: string) => {
    const rec = await dbGet(id);
    if (rec) window.open(rec.dataUrl, '_blank');
    return { ok: !!rec };
  },

  openItem: async (id: string) => {
    const rec = await dbGet(id);
    if (rec) window.open(rec.dataUrl, '_blank');
    return { ok: !!rec };
  },

  openSaveFolder: async () => ({ ok: true }),

  importTheme: async (): Promise<ThemeImportResult> => {
    const files = await pickFiles();
    if (files.length === 0) return { ok: false, canceled: true };
    return importThemeFromFiles(files);
  },

  listImportedThemes: async () => readImported(),

  removeImportedTheme: async (id: string) => {
    writeImported(readImported().filter((t) => t.id !== id));
    return { ok: true };
  },

  minimizeWindow: () => undefined,
  toggleMaximizeWindow: () => undefined,
  closeWindow: () => undefined,
};

(window as unknown as { photoshoot: PhotoshootBridge }).photoshoot = bridge;
