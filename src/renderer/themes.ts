// Theme application. Built-in themes are just a `data-theme` attribute. Imported
// community themes set their base theme's attribute, then layer validated design
// tokens on top via CSSOM (element.style.setProperty) — which is governed by the
// page's script-src, never style-src, so we satisfy a strict CSP with no
// 'unsafe-inline'. Every token is re-validated here even though main already
// validated it (defense in depth); the renderer trusts nothing.

import { app } from './app';
import { api } from './bridge';
import type { ImportedTheme } from '../shared/ipc-contract';
import {
  validateTokenValue,
  ALLOWED_TEXTURE_TOKENS,
  tokenKind,
} from '../shared/theme-schema';

export const BUILTIN_THEMES = [
  { id: 'modern', name: 'Studio', sub: 'Bright & neutral', swatches: ['#ececec', '#1a1a1a', '#ff3b30', '#007aff'] },
  { id: 'metal', name: 'Classic Metal', sub: 'Brushed aluminium', swatches: ['#c8cacd', '#7d8186', '#d63a2f', '#3a6ea5'] },
  { id: 'glass', name: 'Studio Dark', sub: 'Dark & cinematic', swatches: ['#1e1e1e', '#323232', '#ff453a', '#0a84ff'] },
  { id: 'retro', name: 'Retro Film', sub: 'Warm & vintage', swatches: ['#ece2cd', '#e2542e', '#1f7a6e', '#3a2e20'] },
];

const BUILTIN_IDS = BUILTIN_THEMES.map((t) => t.id);
const appliedProps = new Set<string>();
let importedCache: ImportedTheme[] = [];

export async function loadImportedThemes(): Promise<ImportedTheme[]> {
  importedCache = await api.listImportedThemes();
  return importedCache;
}

export function getImportedThemes(): ImportedTheme[] {
  return importedCache;
}

function clearImportedTokens(root: HTMLElement): void {
  for (const name of appliedProps) root.style.removeProperty(name);
  appliedProps.clear();
}

function applyImported(root: HTMLElement, theme: ImportedTheme): void {
  root.dataset.theme = BUILTIN_IDS.includes(theme.base) ? theme.base : 'modern';
  for (const [name, value] of Object.entries(theme.tokens)) {
    const result = validateTokenValue(name, value);
    if (result.ok && result.value) {
      root.style.setProperty(name, result.value);
      appliedProps.add(name);
    }
  }
  for (const [name, dataUri] of Object.entries(theme.textures)) {
    if (
      (ALLOWED_TEXTURE_TOKENS as readonly string[]).includes(name) &&
      tokenKind(name) === 'texture' &&
      typeof dataUri === 'string' &&
      dataUri.startsWith('data:image/')
    ) {
      // Wrapping a validated data: URI is the only place url() is ever produced.
      root.style.setProperty(name, `url("${dataUri}")`);
      appliedProps.add(name);
    }
  }
}

export function applyTheme(themeId: string): void {
  const root = document.documentElement;
  clearImportedTokens(root);

  if (themeId.startsWith('imported:')) {
    const id = themeId.slice('imported:'.length);
    const theme = importedCache.find((t) => t.id === id);
    if (theme) {
      applyImported(root, theme);
      return;
    }
    root.dataset.theme = 'modern'; // referenced theme was removed
    return;
  }

  root.dataset.theme = BUILTIN_IDS.includes(themeId) ? themeId : 'modern';
}

export async function setTheme(themeId: string): Promise<void> {
  applyTheme(themeId);
  await app.updateSettings({ theme: themeId });
}

export async function importThemeFlow(): Promise<import('../shared/ipc-contract').ThemeImportResult> {
  const result = await api.importTheme();
  if (result.ok && result.theme) {
    await loadImportedThemes();
    await setTheme(`imported:${result.theme.id}`);
  }
  return result;
}

export async function removeImportedTheme(id: string): Promise<void> {
  await api.removeImportedTheme(id);
  await loadImportedThemes();
  if (app.settings.theme === `imported:${id}`) {
    await setTheme('modern');
  }
}
