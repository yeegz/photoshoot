// Imports untrusted community theme packages. A "package" is a `theme.json`
// manifest plus optional sibling image files in the same folder. Nothing here
// ever executes manifest content — it is parsed as data and squeezed through
// the strict whitelist in shared/theme-schema.ts. Validated themes are stored
// as fully self-contained objects (image bytes become data: URIs) so the
// renderer never needs file access to apply them.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { themesDir, importedThemesFile, isInside } from './paths';
import {
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

export async function listImportedThemes(): Promise<ImportedTheme[]> {
  try {
    const text = await fs.readFile(importedThemesFile(), 'utf8');
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidStoredTheme);
  } catch {
    return [];
  }
}

function isValidStoredTheme(x: unknown): x is ImportedTheme {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.tokens === 'object';
}

async function persist(themes: ImportedTheme[]): Promise<void> {
  await fs.writeFile(importedThemesFile(), JSON.stringify(themes, null, 2), 'utf8');
}

export async function removeImportedTheme(id: string): Promise<{ ok: boolean }> {
  const themes = await listImportedThemes();
  await persist(themes.filter((t) => t.id !== id));
  return { ok: true };
}

/**
 * Validate + import a theme from a manifest file path the user selected.
 * Returns a sanitized ImportedTheme or a helpful error. Never throws on bad
 * input — bad input is the expected case.
 */
export async function importThemeFromPath(manifestPath: string): Promise<ThemeImportResult> {
  const warnings: string[] = [];
  try {
    const stat = await fs.stat(manifestPath);
    if (!stat.isFile()) return { ok: false, error: 'Selected item is not a theme file.' };
    if (stat.size > THEME_LIMITS.manifestBytes) return { ok: false, error: 'Theme manifest is too large.' };

    let manifest: RawThemeManifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      return { ok: false, error: 'Theme manifest is not valid JSON.' };
    }
    if (!manifest || typeof manifest !== 'object')
      return { ok: false, error: 'Theme manifest must be a JSON object.' };

    if (
      typeof manifest.schemaVersion === 'number' &&
      manifest.schemaVersion > THEME_SCHEMA_VERSION
    ) {
      return { ok: false, error: 'Theme requires a newer version of Photoshoot.' };
    }

    const name = sanitizeText(manifest.name, THEME_LIMITS.maxNameLength) || 'Untitled Theme';
    const author = sanitizeText(manifest.author, THEME_LIMITS.maxNameLength) || 'Unknown';
    const description = sanitizeText(manifest.description, THEME_LIMITS.maxTextLength);
    const base: BuiltInThemeId = (ALLOWED_BASES as readonly string[]).includes(manifest.base as string)
      ? (manifest.base as BuiltInThemeId)
      : 'modern';

    // ---- tokens ----
    const tokens: Record<string, string> = {};
    if (manifest.tokens && typeof manifest.tokens === 'object') {
      const entries = Object.entries(manifest.tokens as Record<string, unknown>);
      if (entries.length > THEME_LIMITS.maxTokens)
        return { ok: false, error: `Theme defines too many tokens (max ${THEME_LIMITS.maxTokens}).` };
      for (const [key, raw] of entries) {
        const result = validateTokenValue(key, raw);
        if (result.ok && result.value) tokens[key] = result.value;
        else warnings.push(`Skipped token "${key}": ${result.reason}`);
      }
    }

    // ---- textures (image assets) ----
    const textures: Record<string, string> = {};
    const manifestDir = path.dirname(path.resolve(manifestPath));
    if (manifest.textures && typeof manifest.textures === 'object') {
      const entries = Object.entries(manifest.textures as Record<string, unknown>);
      if (entries.length > THEME_LIMITS.maxAssets)
        return { ok: false, error: `Theme references too many assets (max ${THEME_LIMITS.maxAssets}).` };

      let totalBytes = 0;
      for (const [token, fileRef] of entries) {
        if (!(ALLOWED_TEXTURE_TOKENS as readonly string[]).includes(token)) {
          warnings.push(`Skipped texture for unknown token "${token}".`);
          continue;
        }
        if (!isSafeAssetName(fileRef)) {
          warnings.push(`Skipped unsafe asset reference "${String(fileRef)}".`);
          continue;
        }
        const assetPath = path.resolve(manifestDir, fileRef);
        // Asset must sit directly inside the manifest's folder — no traversal.
        if (!isInside(manifestDir, assetPath)) {
          warnings.push(`Skipped asset outside theme folder: "${fileRef}".`);
          continue;
        }
        let bytes: Buffer;
        try {
          const aStat = await fs.stat(assetPath);
          if (aStat.size > THEME_LIMITS.assetBytes) {
            warnings.push(`Skipped oversized asset "${fileRef}".`);
            continue;
          }
          bytes = await fs.readFile(assetPath);
        } catch {
          warnings.push(`Could not read asset "${fileRef}".`);
          continue;
        }
        const mime = detectImageMime(new Uint8Array(bytes));
        if (!mime) {
          warnings.push(`Skipped "${fileRef}": not a recognized PNG/JPEG/WebP image.`);
          continue;
        }
        totalBytes += bytes.length;
        if (totalBytes > THEME_LIMITS.totalAssetBytes) {
          warnings.push('Asset size limit reached; remaining textures skipped.');
          break;
        }
        textures[token] = `data:${mime};base64,${bytes.toString('base64')}`;
      }
    }

    if (Object.keys(tokens).length === 0 && Object.keys(textures).length === 0) {
      return {
        ok: false,
        error: 'Theme has no usable tokens or textures after validation.',
        warnings,
      };
    }

    const theme: ImportedTheme = {
      id: randomUUID(),
      name,
      author,
      description,
      base,
      tokens,
      textures,
    };

    // Persist into the controlled themes store.
    themesDir();
    const themes = await listImportedThemes();
    themes.push(theme);
    await persist(themes);

    return { ok: true, theme, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Theme import failed.' };
  }
}
