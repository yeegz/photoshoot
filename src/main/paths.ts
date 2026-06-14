// Centralized, audited path resolution for the main process. Every on-disk
// location the app touches is derived here so the rest of the code never builds
// paths from untrusted input.

import { app } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export const SAVE_FOLDER_NAME = 'Photoshoot';

export function picturesDir(): string {
  // Falls back to the home directory if Pictures is unavailable.
  try {
    return app.getPath('pictures');
  } catch {
    return app.getPath('home');
  }
}

/** Pictures/Photoshoot — the only place captured media is written. */
export function saveDir(): string {
  const dir = path.join(picturesDir(), SAVE_FOLDER_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function userDataDir(): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** userData/themes — controlled store for imported community themes. */
export function themesDir(): string {
  const dir = path.join(userDataDir(), 'themes');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function settingsFile(): string {
  return path.join(userDataDir(), 'settings.json');
}

export function galleryFile(): string {
  return path.join(userDataDir(), 'gallery.json');
}

export function importedThemesFile(): string {
  return path.join(themesDir(), 'index.json');
}

export function filtersDir(): string {
  const dir = path.join(userDataDir(), 'filters');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function customFiltersFile(): string {
  return path.join(filtersDir(), 'index.json');
}

/**
 * Returns true only when `target` resolves to a location inside `base`.
 * Used to guarantee no operation ever escapes an allowed directory.
 */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}
