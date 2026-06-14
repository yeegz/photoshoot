// Shared IPC contract between the Electron main process, the preload bridge,
// and the renderer. Pure types + channel-name constants only — no Node or DOM
// imports — so it is safe to bundle into all three execution contexts.

import type { FilterParams } from './filter-schema';

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  captureSave: 'capture:save',
  galleryList: 'gallery:list',
  galleryRead: 'gallery:read',
  galleryExport: 'gallery:export',
  galleryDelete: 'gallery:delete',
  galleryReveal: 'gallery:reveal',
  galleryOpen: 'gallery:open',
  openSaveFolder: 'folder:openSave',
  themeImport: 'theme:import',
  themeListImported: 'theme:list',
  themeRemove: 'theme:remove',
  filterImport: 'filter:import',
  filterList: 'filter:list',
  filterRemove: 'filter:remove',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
} as const;

export type CaptureFormat = 'png' | 'jpg';
export type CaptureKind = 'single' | 'strip' | 'video';
export type BuiltInThemeId = 'modern' | 'metal' | 'glass' | 'retro' | 'darkroom';

export interface AppInfo {
  name: string;
  version: string;
  saveFolder: string;
  themesFolder: string;
  platform: string;
}

export interface Settings {
  // Active theme id: a built-in id or `imported:<id>`.
  theme: string;
  // When true, the theme follows the device's light/dark appearance.
  autoTheme: boolean;
  cameraId: string | null;
  mirror: boolean;
  countdownSeconds: number; // 0 = instant, otherwise 1..5
  format: CaptureFormat;
  volume: number; // 0..1
  muted: boolean;
  bgTolerance: number; // 0..1 (background replacement sensitivity)
  perfOverlay: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'modern',
  autoTheme: true,
  cameraId: null,
  mirror: true,
  countdownSeconds: 3,
  format: 'png',
  volume: 0.7,
  muted: false,
  bgTolerance: 0.28,
  perfOverlay: false,
  reducedMotion: false,
};

export interface SaveRequest {
  kind: CaptureKind;
  format: CaptureFormat;
  // Base64 data URL of the rendered output (image/png|image/jpeg|video/webm).
  dataUrl: string;
  width: number;
  height: number;
  effect: string;
  // Small base64 data URL thumbnail (already downscaled in the renderer).
  thumbnail: string;
}

export interface SaveResult {
  ok: boolean;
  id?: string;
  filename?: string;
  path?: string;
  error?: string;
}

export interface GalleryItem {
  id: string;
  filename: string;
  path: string;
  kind: CaptureKind;
  effect: string;
  format: CaptureFormat;
  createdAt: number;
  thumbnail: string;
  width: number;
  height: number;
}

// A theme manifest as authored by a community member (untrusted input).
export interface RawThemeManifest {
  schemaVersion?: number;
  name?: unknown;
  author?: unknown;
  description?: unknown;
  base?: unknown; // which built-in to extend: modern|metal|glass|retro|darkroom
  tokens?: unknown; // Record<string,string>
  textures?: unknown; // Record<string,string> -> relative file name in package
}

// A fully validated + sanitized theme, safe to apply in the renderer.
export interface ImportedTheme {
  id: string;
  name: string;
  author: string;
  description: string;
  base: BuiltInThemeId;
  tokens: Record<string, string>;
  // tokenName -> data: URI (validated PNG/JPEG/WebP), produced by main.
  textures: Record<string, string>;
}

export interface ThemeImportResult {
  ok: boolean;
  theme?: ImportedTheme;
  error?: string;
  warnings?: string[];
  canceled?: boolean;
}

// A community color filter. After validation it is pure data: clamped numeric
// grades and an optional LUT image as a validated data: URI. Applied by the
// fixed `customfilter` shader — never as code. See shared/filter-schema.ts.
export interface CustomFilter {
  id: string;
  name: string;
  author: string;
  description: string;
  params: FilterParams;
  lut?: string; // data: URI of a validated 512×512 PNG LUT, or absent
}

export interface FilterImportResult {
  ok: boolean;
  filter?: CustomFilter;
  error?: string;
  warnings?: string[];
  canceled?: boolean;
}

// The shape exposed on `window.photoshoot` by the preload bridge.
export interface PhotoshootBridge {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  saveCapture(req: SaveRequest): Promise<SaveResult>;
  listGallery(): Promise<GalleryItem[]>;
  readItem(id: string): Promise<{ ok: boolean; dataUrl?: string; mime?: string }>;
  exportItem(id: string): Promise<{ ok: boolean; canceled?: boolean }>;
  deleteGalleryItem(id: string, deleteFile: boolean): Promise<{ ok: boolean }>;
  revealItem(id: string): Promise<{ ok: boolean }>;
  openItem(id: string): Promise<{ ok: boolean }>;
  openSaveFolder(): Promise<{ ok: boolean }>;
  importTheme(): Promise<ThemeImportResult>;
  listImportedThemes(): Promise<ImportedTheme[]>;
  removeImportedTheme(id: string): Promise<{ ok: boolean }>;
  importFilter(): Promise<FilterImportResult>;
  listCustomFilters(): Promise<CustomFilter[]>;
  removeCustomFilter(id: string): Promise<{ ok: boolean }>;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
}
