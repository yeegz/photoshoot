// Imports untrusted community color filters. A filter "package" is a
// `filter.json` manifest (numbers only) plus an OPTIONAL sibling LUT PNG. As
// with themes, nothing here executes manifest content: it is parsed as data and
// squeezed through the strict validator in shared/filter-schema.ts. The LUT is
// validated by magic bytes + IHDR dimensions and stored as a self-contained
// data: URI, so the renderer never needs file access to apply a filter.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { filtersDir, customFiltersFile, isInside } from './paths';
import { CustomFilter, FilterImportResult } from '../shared/ipc-contract';
import {
  FILTER_LIMITS,
  validateFilterManifest,
  validateLutPng,
} from '../shared/filter-schema';

export async function listCustomFilters(): Promise<CustomFilter[]> {
  try {
    const text = await fs.readFile(customFiltersFile(), 'utf8');
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidStoredFilter);
  } catch {
    return [];
  }
}

function isValidStoredFilter(x: unknown): x is CustomFilter {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.params === 'object';
}

async function persist(filters: CustomFilter[]): Promise<void> {
  await fs.writeFile(customFiltersFile(), JSON.stringify(filters, null, 2), 'utf8');
}

export async function removeCustomFilter(id: string): Promise<{ ok: boolean }> {
  const filters = await listCustomFilters();
  await persist(filters.filter((f) => f.id !== id));
  return { ok: true };
}

/**
 * Validate + import a filter from a manifest file path the user selected.
 * Never throws on bad input — bad input is the expected case.
 */
export async function importFilterFromPath(manifestPath: string): Promise<FilterImportResult> {
  const warnings: string[] = [];
  try {
    const stat = await fs.stat(manifestPath);
    if (!stat.isFile()) return { ok: false, error: 'Selected item is not a filter file.' };
    if (stat.size > FILTER_LIMITS.manifestBytes) return { ok: false, error: 'Filter manifest is too large.' };

    let manifest: unknown;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      return { ok: false, error: 'Filter manifest is not valid JSON.' };
    }

    const v = validateFilterManifest(manifest);
    if (!v.ok || !v.params) return { ok: false, error: v.error ?? 'Filter manifest is invalid.' };

    // Optional LUT: resolve the sibling file, re-check it stays in the folder,
    // validate magic bytes + dimensions, and inline it as a data: URI.
    let lut: string | undefined;
    if (v.lutRef) {
      const manifestDir = path.dirname(path.resolve(manifestPath));
      const lutPath = path.resolve(manifestDir, v.lutRef);
      if (!isInside(manifestDir, lutPath)) {
        warnings.push(`Skipped LUT outside the filter folder: "${v.lutRef}".`);
      } else {
        try {
          // Reject symlinks: isInside is lexical, so a symlink named lut.png could
          // otherwise point its target anywhere on disk. lstat doesn't follow it.
          const ls = await fs.lstat(lutPath);
          if (ls.isSymbolicLink() || !ls.isFile()) {
            warnings.push(`Skipped LUT "${v.lutRef}": symlinks are not allowed.`);
          } else {
            const bytes = await fs.readFile(lutPath);
            const check = validateLutPng(new Uint8Array(bytes));
            if (check.ok) lut = `data:image/png;base64,${bytes.toString('base64')}`;
            else warnings.push(`Skipped LUT "${v.lutRef}": ${check.reason}`);
          }
        } catch {
          warnings.push(`Could not read LUT "${v.lutRef}".`);
        }
      }
    }

    const filter: CustomFilter = {
      id: randomUUID(),
      name: v.name ?? 'Untitled Filter',
      author: v.author ?? 'Unknown',
      description: v.description ?? '',
      params: v.params,
      lut,
    };

    filtersDir();
    const filters = await listCustomFilters();
    if (filters.length >= FILTER_LIMITS.maxFilters) {
      return { ok: false, error: 'Filter library is full; remove some filters first.' };
    }
    filters.push(filter);
    await persist(filters);

    return { ok: true, filter, warnings: warnings.length ? warnings : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Filter import failed.' };
  }
}
