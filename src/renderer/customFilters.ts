// Renderer-side custom-filter state. Loads the validated community filters from
// the bridge, pushes them into every GLRenderer that needs to draw them (the
// live preview and the effects-menu previews), and exposes them as effect
// definitions so they appear as extra tiles in the Effects grid. A custom
// filter is identified by the effect id `custom:<uuid>`.

import { app } from './app';
import { api } from './bridge';
import type { CustomFilter, FilterImportResult } from '../shared/ipc-contract';
import type { EffectDef } from './gl/effects';
import { effectLabel } from './gl/effects';

let cache: CustomFilter[] = [];
// Renderers that should receive the filter list (live + menu preview).
const sinks = new Set<{ setCustomFilters(list: CustomFilter[]): void }>();

export function registerFilterSink(r: { setCustomFilters(list: CustomFilter[]): void }): void {
  sinks.add(r);
  r.setCustomFilters(cache);
}

export function getCustomFilters(): CustomFilter[] {
  return cache;
}

/** Effect tiles for the Effects menu, one per imported filter. */
export function customFilterDefs(): EffectDef[] {
  return cache.map((f) => ({ id: `custom:${f.id}`, label: f.name, amount: 1, animated: f.params.grain > 0 }));
}

/** A human label for any effect id, including custom filters. */
export function effectDisplayLabel(id: string): string {
  if (id.startsWith('custom:')) {
    const f = cache.find((x) => `custom:${x.id}` === id);
    return f ? f.name : 'Filter';
  }
  return effectLabel(id);
}

export async function loadCustomFilters(): Promise<CustomFilter[]> {
  cache = await api.listCustomFilters();
  for (const r of sinks) r.setCustomFilters(cache);
  return cache;
}

export async function importCustomFilterFlow(): Promise<FilterImportResult> {
  const result = await api.importFilter();
  if (result.ok && result.filter) await loadCustomFilters();
  return result;
}

export async function removeCustomFilter(id: string): Promise<void> {
  await api.removeCustomFilter(id);
  await loadCustomFilters();
  // If the removed filter was active, fall back to Normal.
  if (app.effect === `custom:${id}`) {
    app.effect = 'normal';
    app.renderer.setEffect('normal');
  }
}
