// Shared IPC contract between the Electron main process, the preload bridge,
// and the renderer. Pure types + channel-name constants only — no Node or DOM
// imports — so it is safe to bundle into all three execution contexts.

import type { VirtualCameraConfig, VirtualCameraStatus } from './virtual-camera';
import type { FilterParams } from './filter-schema';
import type { UpdateInfo } from './update-check';

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
  virtualCameraStatus: 'virtualCamera:status',
  virtualCameraStart: 'virtualCamera:start',
  virtualCameraStop: 'virtualCamera:stop',
  virtualCameraFrame: 'virtualCamera:frame',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowFullscreen: 'window:fullscreen',
  updateCheck: 'update:check',
  updateStatus: 'update:status',
  updateInstall: 'update:install',
} as const;

export type CaptureFormat = 'png' | 'jpg';
export type CaptureKind = 'single' | 'strip' | 'video';
export type StripLayout = 'grid' | 'strip' | 'row' | 'feature';
export type StripFrame = 'white' | 'cream' | 'blush' | 'sky' | 'black';
export const STRIP_LAYOUTS: readonly StripLayout[] = ['grid', 'strip', 'row', 'feature'];
export const STRIP_FRAMES: readonly StripFrame[] = ['white', 'cream', 'blush', 'sky', 'black'];
export const STRIP_CAPTION_MAX = 40;
export type StripFont = 'classic' | 'modern' | 'rounded' | 'typewriter' | 'script';
export type StripTextSize = 's' | 'm' | 'l';
export type StripInk = 'auto' | 'red' | 'blue' | 'green' | 'gold' | 'pink';
export type StripAlign = 'left' | 'center' | 'right';
export const STRIP_FONTS: readonly StripFont[] = ['classic', 'modern', 'rounded', 'typewriter', 'script'];
export const STRIP_TEXT_SIZES: readonly StripTextSize[] = ['s', 'm', 'l'];
export const STRIP_INKS: readonly StripInk[] = ['auto', 'red', 'blue', 'green', 'gold', 'pink'];
export const STRIP_ALIGNS: readonly StripAlign[] = ['left', 'center', 'right'];
export type BuiltInThemeId = 'booth' | 'modern' | 'metal' | 'glass' | 'retro' | 'darkroom';

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
  backgroundBlur: number; // 4..40 background-only blur radius in pixels
  perfOverlay: boolean;
  reducedMotion: boolean;
  screenFlash: boolean; // light up the whole window when a photo is taken
  checkForUpdates: boolean; // look for a newer GitHub release at launch
  autoUpdate: boolean; // desktop installer: download updates and install them on restart
  lastSeenVersion: string; // the version whose What's New was last shown
  stripLayout: StripLayout; // last layout picked for four-photo sheets
  stripFrame: StripFrame; // paper colour around four-photo sheets
  stripShowName: boolean; // print the Photoshoot wordmark under the photos
  stripShowDate: boolean; // print the date under the photos
  stripCaption: string; // optional line printed under the photos
  stripRounded: boolean; // round the photos' corners on the print
  stripFont: StripFont; // typeface for the caption and date
  stripTextSize: StripTextSize;
  stripInk: StripInk; // text colour; auto follows the paper
  stripAlign: StripAlign;
  tipsSeen: boolean; // first-run tips were shown (Settings → Help shows them again)
  stripTourSeen: boolean; // the four-photo tutorial was shown (the ? on the slot row replays it)
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'booth',
  autoTheme: false,
  cameraId: null,
  mirror: true,
  countdownSeconds: 3,
  format: 'png',
  volume: 0.7,
  muted: false,
  bgTolerance: 0.28,
  backgroundBlur: 18,
  perfOverlay: false,
  reducedMotion: false,
  screenFlash: true,
  checkForUpdates: true,
  autoUpdate: true,
  lastSeenVersion: '',
  stripLayout: 'strip',
  stripFrame: 'white',
  stripShowName: true,
  stripShowDate: true,
  stripCaption: '',
  stripRounded: false,
  stripFont: 'classic',
  stripTextSize: 'm',
  stripInk: 'auto',
  stripAlign: 'center',
  tipsSeen: false,
  stripTourSeen: false,
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
  getVirtualCameraStatus(): Promise<VirtualCameraStatus>;
  startVirtualCamera(config: VirtualCameraConfig): Promise<VirtualCameraStatus>;
  stopVirtualCamera(): Promise<VirtualCameraStatus>;
  sendVirtualCameraFrame(frame: Uint8Array): Promise<boolean>;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  toggleFullscreen(): void;
  checkForUpdate(): Promise<UpdateInfo>;
  /** Progress pushed by the desktop updater (downloading, ready). Returns an unsubscribe. */
  onUpdateStatus(listener: (info: UpdateInfo) => void): () => void;
  /** Restart now and install a downloaded update. */
  installUpdate(): void;
  closeWindow(): void;
}
