// Effects browser: a full-bleed 3×3 grid of LIVE preview tiles that replaces
// the viewfinder (Photo Booth style), paged with dots in the toolbar. The
// effect pages come first; the backdrops follow as their own pages, each with
// "Normal" in the centre cell. A second, small WebGL renderer shares the camera
// video and renders each effect into its tile on a round-robin (upload once per
// tick, draw several effects from it), running only while the view is open.
// Picking a tile applies it and exits. ←/→ (Home/End) flip pages.

import { app } from './app';
import { GLRenderer } from './gl/renderer';
import { EFFECTS, isDraggable, isFaceEffect } from './gl/effects';
import type { EffectDef } from './gl/effects';
import { BACKGROUNDS, drawBackgroundPreview } from './backgrounds';
import type { BackgroundDef } from './backgrounds';
import { pickBackground, currentBackground } from './backgroundsMenu';
import { byId, el, clear } from './dom';
import { sound } from './sound';
import { isAnyOpen } from './overlays';
import { activateFaceTracking, deactivateFaceTracking } from './faceTracker';
import { customFilterDefs, effectDisplayLabel, registerFilterSink } from './customFilters';
import { exitReview, isReviewing } from './gallery';

const PAGE_SIZE = 9;
const CENTER = 4;

type PageItem =
  | { kind: 'effect'; def: EffectDef }
  | { kind: 'backdrop'; def: BackgroundDef }
  | { kind: 'normal' }
  | null;

interface Tile {
  id: string;
  amount: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  el: HTMLElement;
}

let menuRenderer: GLRenderer | null = null;
let tiles: Tile[] = [];
let pages: PageItem[][] = [];
let currentPage = 0;
let cycle = 0;
let running = false;
let rafHandle = 0;
// While choosing the effect for one photo of a four-photo run, the pick goes to
// that photo instead of becoming the live effect (see stripPlan.ts).
let slotPicker: ((id: string) => void) | null = null;
let slotCurrent = '';

// Built-in effects followed by any imported community filters.
function allEffects(): EffectDef[] {
  return EFFECTS.concat(customFilterDefs());
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Effect pages, then backdrop pages (eight backdrops + "Normal" in the middle). */
function buildPages(): PageItem[][] {
  const effectPages: PageItem[][] = chunk(allEffects(), PAGE_SIZE).map((defs) =>
    defs.map((def) => ({ kind: 'effect', def }) as PageItem)
  );
  const backdropPages: PageItem[][] = chunk(BACKGROUNDS, PAGE_SIZE - 1).map((defs) => {
    const items: PageItem[] = defs.map((def) => ({ kind: 'backdrop', def }) as PageItem);
    items.splice(CENTER, 0, { kind: 'normal' });
    return items;
  });
  return effectPages.concat(backdropPages).map((items) => {
    while (items.length < PAGE_SIZE) items.push(null);
    return items;
  });
}

/** Index of the first backdrop page (moves when community filters are imported). */
export function backdropPageStart(): number {
  return Math.max(1, Math.ceil(allEffects().length / PAGE_SIZE));
}

export function buildEffectsMenu(): void {
  const glCanvas = document.createElement('canvas');
  menuRenderer = new GLRenderer(glCanvas);
  menuRenderer.setSource(app.video);
  menuRenderer.setMaxSize(420);
  registerFilterSink(menuRenderer); // menu previews can draw custom filters too
  pages = buildPages();
  renderPage(0);
}

/** Recompute pages after the set of custom filters changes. */
export function refreshEffectsMenu(): void {
  pages = buildPages();
  renderPage(Math.min(currentPage, pages.length - 1));
}

function renderPage(page: number): void {
  currentPage = Math.min(Math.max(0, page), pages.length - 1);
  const grid = byId('effectsGrid');
  clear(grid);
  tiles = [];

  for (const item of pages[currentPage] ?? []) {
    if (!item) {
      grid.appendChild(el('div', { className: 'effect-tile tile-empty' }));
      continue;
    }
    if (item.kind === 'effect') grid.appendChild(effectTile(item.def));
    else if (item.kind === 'backdrop') grid.appendChild(backdropTile(item.def));
    else grid.appendChild(normalTile());
  }

  renderPageDots();
  markActive();
}

function effectTile(def: EffectDef): HTMLElement {
  const tileEl = el('button', {
    className: 'effect-tile',
    type: 'button',
    ariaLabel: def.label,
    dataset: { id: def.id },
    onClick: () => pick(def.id),
  });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  tileEl.append(canvas, el('span', { className: 'effect-name', text: def.label }));
  tiles.push({ id: def.id, amount: def.amount, canvas, ctx, el: tileEl });
  return tileEl;
}

function backdropTile(def: BackgroundDef): HTMLElement {
  const tileEl = el('button', {
    className: 'effect-tile',
    type: 'button',
    ariaLabel: def.id === 'custom' ? 'Choose your own background photo' : def.label,
    dataset: { backdrop: def.id },
    onClick: () => pickBackdrop(def.id),
  });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  drawBackgroundPreview(canvas, def.id);
  tileEl.append(canvas, el('span', { className: 'effect-name', text: def.label }));
  return tileEl;
}

// The centre cell of a backdrop page: no backdrop, no effect.
function normalTile(): HTMLElement {
  const tileEl = el('button', {
    className: 'effect-tile',
    type: 'button',
    ariaLabel: 'Normal',
    dataset: { id: 'normal', backdrop: 'none' },
    onClick: () => pick('normal'),
  });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  tileEl.append(canvas, el('span', { className: 'effect-name', text: 'Normal' }));
  tiles.push({ id: 'normal', amount: 0, canvas, ctx, el: tileEl });
  return tileEl;
}

function chevron(d: string): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function renderPageDots(): void {
  const bar = byId('barPages');
  clear(bar);
  if (pages.length <= 1) return;

  const prev = el('button', { className: 'page-arrow', type: 'button', ariaLabel: 'Previous page' });
  prev.appendChild(chevron('M10 3.5 5.5 8l4.5 4.5'));
  (prev as HTMLButtonElement).disabled = currentPage === 0;
  prev.addEventListener('click', () => goToPage(currentPage - 1));
  bar.appendChild(prev);

  for (let p = 0; p < pages.length; p++) {
    const dot = el('span', { className: `page-dot${p === currentPage ? ' active' : ''}` });
    bar.appendChild(dot);
  }

  const next = el('button', { className: 'page-arrow', type: 'button', ariaLabel: 'Next page' });
  next.appendChild(chevron('M6 3.5 10.5 8 6 12.5'));
  (next as HTMLButtonElement).disabled = currentPage === pages.length - 1;
  next.addEventListener('click', () => goToPage(currentPage + 1));
  bar.appendChild(next);
}

function markActive(): void {
  const backdrop = slotPicker ? '' : currentBackground();
  const effect = slotPicker ? slotCurrent : app.effect;
  byId('effectsGrid')
    .querySelectorAll<HTMLElement>('.effect-tile')
    .forEach((t) => {
      const active =
        t.dataset.backdrop !== undefined
          ? t.dataset.backdrop === backdrop && (backdrop !== 'none' || app.effect === 'normal')
          : t.dataset.id === effect;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-pressed', String(active));
    });
}

export function modeHint(): string {
  return app.mode === 'strip' ? 'Tap for four photos' : app.mode === 'video' ? 'Tap to record' : 'Tap to capture';
}

/** Make `id` the live effect (also used to show each photo's effect during a four-photo run). */
export function applyEffect(id: string): void {
  app.effect = id;
  app.renderer.setEffect(id);
  app.renderer.setCenter(0.5, 0.5); // each effect starts centered; drag to move it
  markActive();
  byId('btnEffects').classList.toggle('is-on', id !== 'normal');
  byId('viewfinder').classList.toggle('is-draggable', isDraggable(id));
  if (isFaceEffect(id)) void activateFaceTracking();
  byId('shutterHint').textContent = id === 'normal' ? modeHint() : `Effect · ${effectDisplayLabel(id)}`;
  document.dispatchEvent(new CustomEvent('photoshoot:effect')); // the four-photo plan follows it
}

/** Pick an effect from a tile: apply it and exit the effects view. "Normal"
 *  also turns any backdrop off, like Photo Booth. */
// ---- Photo Booth motion ----
// Opening zooms out from the active tile (the live view shrinks into its place),
// closing zooms back into the chosen or active tile, and pages slide sideways.

const EASE_OUT = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
let closing: Animation | null = null;
let paging = false;

function reducedMotion(): boolean {
  return app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ms(duration: number): number {
  return reducedMotion() ? 0 : duration;
}

/** The tile the zoom should centre on: given, else the active one, else the centre cell. */
function focusTile(tile?: Element | null): Element | null {
  const grid = byId('effectsGrid');
  return tile ?? grid.querySelector('.effect-tile.is-active') ?? grid.children[CENTER] ?? null;
}

function setOrigin(tile: Element | null): void {
  const grid = byId('effectsGrid');
  const g = grid.getBoundingClientRect();
  if (!tile || g.width === 0) {
    grid.style.transformOrigin = `${g.width / 2}px ${g.height / 2}px`;
    return;
  }
  const t = tile.getBoundingClientRect();
  grid.style.transformOrigin = `${t.left - g.left + t.width / 2}px ${t.top - g.top + t.height / 2}px`;
}

/** Slide to another page: out one side, in from the other. */
let queuedPage: number | null = null;

function goToPage(page: number): void {
  const target = Math.min(Math.max(0, page), pages.length - 1);
  if (paging) {
    queuedPage = target; // a click or key during a slide runs when it ends
    return;
  }
  if (target === currentPage) return;
  const dir = target > currentPage ? 1 : -1;
  const grid = byId('effectsGrid');
  const duration = ms(170);
  if (!duration) {
    renderPage(target);
    return;
  }
  paging = true;
  const out = grid.animate([{ transform: 'translateX(0px)' }, { transform: `translateX(${-dir * 100}%)` }], { duration, easing: 'ease-in' });
  out.finished.then(() => {
    renderPage(target);
    return grid.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0px)' }], { duration, easing: EASE_OUT }).finished;
  }).catch(() => undefined).finally(() => {
    paging = false;
    const next = queuedPage;
    queuedPage = null;
    if (next !== null && running) goToPage(next);
  });
}

function pick(id: string): void {
  const tile = byId('effectsGrid').querySelector(`.effect-tile[data-id="${CSS.escape(id)}"]`);
  if (slotPicker) {
    const assign = slotPicker;
    slotPicker = null;
    assign(id);
    sound.play('button');
    closeEffects(tile);
    return;
  }
  applyEffect(id);
  if (id === 'normal') void pickBackground('none');
  sound.play('button');
  closeEffects(tile);
}

/** Pick a backdrop from a tile: start background replacement and exit. */
function pickBackdrop(id: string): void {
  const tile = byId('effectsGrid').querySelector(`.effect-tile[data-backdrop="${CSS.escape(id)}"]`);
  void pickBackground(id);
  markActive();
  sound.play('button');
  closeEffects(tile);
}

// ---- open / close ----

export function isEffectsOpen(): boolean {
  return running;
}

/** Open the browser to choose one photo's effect; `onPick` receives the effect id. */
export function openEffectsForSlot(currentId: string, title: string, onPick: (id: string) => void): void {
  if (!menuRenderer || !menuRenderer.available) return;
  const index = allEffects().findIndex((e) => e.id === currentId);
  if (running) closeEffects();
  slotPicker = onPick;
  slotCurrent = currentId;
  byId('slotPickerTitle').textContent = title;
  openEffects(index >= 0 ? Math.floor(index / PAGE_SIZE) : 0);
}

export function openEffects(page = 0): void {
  if (!menuRenderer || !menuRenderer.available) return;
  // Effects belong to the live camera: leave photo review first.
  if (isReviewing()) exitReview();
  if (running) {
    goToPage(page); // already browsing: slide to the page
    return;
  }
  running = true;
  closing?.cancel();
  closing = null;
  const grid = byId('effectsGrid');
  renderPage(page);
  byId('effectsPanel').classList.add('is-open');
  byId('effectsPanel').classList.toggle('is-slot-picker', slotPicker !== null);
  byId('toolbar').classList.add('is-effects');
  document.addEventListener('keydown', onKey);
  sound.play('button');
  // The live view shrinks into its tile as the other effects appear around it.
  // Every tile gets one frame first; live updates start once the zoom settles,
  // so the zoom stays smooth on slow graphics.
  paintAllOnce();
  setOrigin(focusTile());
  const zoom = grid.animate([{ transform: 'scale(3)' }, { transform: 'scale(1)' }], { duration: ms(380), easing: EASE_OUT });
  void zoom.finished.catch(() => undefined).then(() => {
    if (!running || rafHandle) return;
    void activateFaceTracking(); // so face-effect tiles preview live
    loop();
  });
}

/** Close the browser, zooming into `tile` (the pick) or the active effect. */
export function closeEffects(tile?: Element | null): void {
  const wasOpen = running;
  running = false;
  slotPicker = null;
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = 0;
  document.removeEventListener('keydown', onKey);
  byId('toolbar').classList.remove('is-effects');
  if (!isFaceEffect(app.effect)) deactivateFaceTracking();
  const panel = byId('effectsPanel');
  const duration = wasOpen ? ms(320) : 0;
  if (!duration) {
    panel.classList.remove('is-open');
    return;
  }
  const grid = byId('effectsGrid');
  setOrigin(focusTile(tile));
  const anim = grid.animate([{ transform: 'scale(1)' }, { transform: 'scale(3)' }], { duration, easing: EASE_IN_OUT, fill: 'forwards' });
  closing = anim;
  anim.finished.then(() => {
    if (closing !== anim) return;
    closing = null;
    if (!running) panel.classList.remove('is-open');
    anim.cancel();
  }).catch(() => undefined);
}

export function toggleEffects(): void {
  if (running) closeEffects();
  else openEffects(currentPage);
}

function onKey(e: KeyboardEvent): void {
  if (!running) return;
  // Only plain arrow keys aimed at the page: never steal keystrokes from a
  // slider, select or text field, or from a panel open above the browser.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, [contenteditable="true"]') || isAnyOpen()) return;
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Home':
    case 'End': {
      const target =
        e.key === 'ArrowLeft' ? currentPage - 1 : e.key === 'ArrowRight' ? currentPage + 1 : e.key === 'Home' ? 0 : pages.length - 1;
      const clamped = Math.min(Math.max(0, target), pages.length - 1);
      if (clamped !== currentPage) goToPage(clamped); // no rebuild at either end
      break;
    }
    default:
      return;
  }
  e.preventDefault();
}

/** Draw the current camera frame into every tile once. */
function paintAllOnce(): void {
  if (!menuRenderer || !menuRenderer.prepareFrame()) return;
  for (const t of tiles) {
    menuRenderer.drawEffect(t.id, t.amount, app.settings.mirror);
    const gc = menuRenderer.canvas;
    if (t.canvas.width !== gc.width || t.canvas.height !== gc.height) {
      t.canvas.width = gc.width;
      t.canvas.height = gc.height;
    }
    t.ctx.drawImage(gc, 0, 0);
  }
}

function loop(): void {
  if (!running || !menuRenderer) return;
  if (menuRenderer.prepareFrame()) {
    const perFrame = 3;
    for (let k = 0; k < perFrame; k++) {
      if (tiles.length === 0) break;
      const idx = cycle++ % tiles.length;
      const t = tiles[idx];
      menuRenderer.drawEffect(t.id, t.amount, app.settings.mirror);
      const gc = menuRenderer.canvas;
      if (t.canvas.width !== gc.width || t.canvas.height !== gc.height) {
        t.canvas.width = gc.width;
        t.canvas.height = gc.height;
      }
      t.ctx.drawImage(gc, 0, 0);
    }
  }
  rafHandle = requestAnimationFrame(loop);
}
