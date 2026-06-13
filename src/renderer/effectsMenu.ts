// Effects view: a full-bleed 3×3 grid of LIVE preview tiles that replaces the
// viewfinder (Photo Booth style), paged with dots in the toolbar. A second,
// small WebGL renderer shares the camera video and renders each effect into its
// tile on a round-robin (upload once per tick, draw several effects from it),
// running only while the view is open. Picking a tile applies it and exits.

import { app } from './app';
import { GLRenderer } from './gl/renderer';
import { EFFECTS, effectLabel } from './gl/effects';
import { byId, el, clear } from './dom';
import { sound } from './sound';

const PAGE_SIZE = 9;

interface Tile {
  id: string;
  amount: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  el: HTMLElement;
}

let menuRenderer: GLRenderer | null = null;
let tiles: Tile[] = [];
let pageCount = 1;
let currentPage = 0;
let cycle = 0;
let running = false;
let rafHandle = 0;

export function buildEffectsMenu(): void {
  const glCanvas = document.createElement('canvas');
  menuRenderer = new GLRenderer(glCanvas);
  menuRenderer.setSource(app.video);
  menuRenderer.setMaxSize(420);
  pageCount = Math.max(1, Math.ceil(EFFECTS.length / PAGE_SIZE));
  renderPage(0);
}

function renderPage(page: number): void {
  currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const grid = byId('effectsGrid');
  clear(grid);
  tiles = [];

  const start = currentPage * PAGE_SIZE;
  const slice = EFFECTS.slice(start, start + PAGE_SIZE);

  for (let i = 0; i < PAGE_SIZE; i++) {
    const def = slice[i];
    if (!def) {
      grid.appendChild(el('div', { className: 'effect-tile tile-empty' }));
      continue;
    }
    const tileEl = el('button', {
      className: 'effect-tile',
      type: 'button',
      ariaLabel: def.label,
      dataset: { id: def.id },
      attrs: { 'aria-pressed': String(def.id === app.effect) },
      onClick: () => pick(def.id),
    });
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    tileEl.append(canvas, el('span', { className: 'effect-name', text: def.label }));
    grid.appendChild(tileEl);
    tiles.push({ id: def.id, amount: def.amount, canvas, ctx, el: tileEl });
  }

  renderPageDots();
  markActive(app.effect);
}

function renderPageDots(): void {
  const bar = byId('barPages');
  clear(bar);
  if (pageCount <= 1) return;

  const prev = el('button', { className: 'page-arrow', type: 'button', ariaLabel: 'Previous page', text: '◀' });
  (prev as HTMLButtonElement).disabled = currentPage === 0;
  prev.addEventListener('click', () => renderPage(currentPage - 1));
  bar.appendChild(prev);

  for (let p = 0; p < pageCount; p++) {
    const dot = el('span', { className: `page-dot${p === currentPage ? ' active' : ''}` });
    bar.appendChild(dot);
  }

  const next = el('button', { className: 'page-arrow', type: 'button', ariaLabel: 'Next page', text: '▶' });
  (next as HTMLButtonElement).disabled = currentPage === pageCount - 1;
  next.addEventListener('click', () => renderPage(currentPage + 1));
  bar.appendChild(next);
}

function markActive(id: string): void {
  tiles.forEach((t) => {
    const active = t.id === id;
    t.el.classList.toggle('is-active', active);
    t.el.setAttribute('aria-pressed', String(active));
  });
}

function applyEffect(id: string): void {
  app.effect = id;
  app.renderer.setEffect(id);
  markActive(id);
  byId('btnEffects').classList.toggle('is-on', id !== 'normal');
  byId('shutterHint').textContent =
    id === 'normal' ? 'Tap to capture' : `Effect · ${effectLabel(id)}`;
}

/** Pick an effect from a tile: apply it and exit the effects view. */
function pick(id: string): void {
  applyEffect(id);
  sound.play('button');
  closeEffects();
}

// ---- open / close ----

export function isEffectsOpen(): boolean {
  return running;
}

export function openEffects(): void {
  if (!menuRenderer || !menuRenderer.available || running) return;
  running = true;
  byId('effectsPanel').classList.add('is-open');
  byId('toolbar').classList.add('is-effects');
  renderPageDots();
  sound.play('button');
  loop();
}

export function closeEffects(): void {
  running = false;
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = 0;
  byId('effectsPanel').classList.remove('is-open');
  byId('toolbar').classList.remove('is-effects');
}

export function toggleEffects(): void {
  if (running) closeEffects();
  else openEffects();
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
