// Gallery filmstrip + photo review. Captures sit in a light bar at the bottom of
// the viewfinder. Clicking one shows it full-size where the camera preview was
// (pausing the camera, Photo Booth style); each photo has an × to delete and a
// right-click menu to export it out of the app's folder. No "saved" toast, no
// chrome — the photo dropping in is the confirmation.

import { api } from './bridge';
import { app } from './app';
import { byId, el, clear } from './dom';
import { toast } from './toast';
import { sound } from './sound';
import { effectLabel } from './gl/effects';
import type { GalleryItem } from '../shared/ipc-contract';

let items: GalleryItem[] = [];
let reviewId: string | null = null;
let ctxMenu: HTMLElement | null = null;

const KIND_BADGE: Record<string, string> = {
  strip: '4‑Shot',
  video: 'Video',
  single: '',
};

export async function refreshGallery(animateNewest = false): Promise<void> {
  items = await api.listGallery();
  if (reviewId && !items.some((i) => i.id === reviewId)) exitReview();
  renderTray(animateNewest);
  byId('tray').classList.toggle('hidden', items.length === 0);
}

function xIcon(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M2 2 8 8M8 2 2 8');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round');
  svg.appendChild(p);
  return svg;
}

function renderTray(animateNewest: boolean): void {
  const scroll = byId('trayScroll');
  clear(scroll);
  if (items.length === 0) return;

  const ordered = [...items].reverse(); // oldest → newest (left → right)
  const newestId = items[0].id;

  for (const item of ordered) {
    const thumb = el('button', {
      className: `thumb${item.id === reviewId ? ' is-selected' : ''}`,
      ariaLabel: `Photo ${item.filename}`,
      type: 'button',
      dataset: { id: item.id },
    });
    thumb.addEventListener('click', () => toggleReview(item));
    thumb.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(item, e.clientX, e.clientY);
    });

    if (item.thumbnail) {
      const img = el('img');
      img.src = item.thumbnail;
      img.alt = `Capture with ${effectLabel(item.effect)} effect`;
      thumb.appendChild(img);
    } else {
      thumb.appendChild(el('span', { className: 'thumb-badge', text: '▶' }));
    }

    const badge = KIND_BADGE[item.kind];
    if (badge) thumb.appendChild(el('span', { className: 'thumb-badge', text: badge }));

    const del = el('button', { className: 'thumb-delete', type: 'button', ariaLabel: 'Delete photo' });
    del.appendChild(xIcon());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteItem(item);
    });
    thumb.appendChild(del);

    if (animateNewest && item.id === newestId) thumb.classList.add('is-new');
    scroll.appendChild(thumb);
  }

  scroll.scrollLeft = scroll.scrollWidth;
}

function markSelected(): void {
  byId('trayScroll')
    .querySelectorAll('.thumb')
    .forEach((t) => t.classList.toggle('is-selected', (t as HTMLElement).dataset.id === reviewId));
}

// ---- review mode ----

function toggleReview(item: GalleryItem): void {
  if (reviewId === item.id) exitReview();
  else void enterReview(item);
}

async function enterReview(item: GalleryItem): Promise<void> {
  const review = byId('review');
  const img = byId<HTMLImageElement>('reviewImage');
  const res = await api.readItem(item.id);
  if (res.ok && res.dataUrl) img.src = res.dataUrl;
  else if (item.thumbnail) img.src = item.thumbnail;
  else return;

  reviewId = item.id;
  app.renderer?.stop(); // pause the live camera while viewing
  review.classList.remove('hidden');
  (byId('shutter') as HTMLButtonElement).disabled = true; // grayed out while viewing
  markSelected();
}

export function exitReview(): void {
  if (reviewId === null) return;
  reviewId = null;
  byId('review').classList.add('hidden');
  byId<HTMLImageElement>('reviewImage').removeAttribute('src');
  (byId('shutter') as HTMLButtonElement).disabled = false;
  if (app.renderer?.available) app.renderer.start();
  markSelected();
}

// ---- delete / export ----

async function deleteItem(item: GalleryItem): Promise<void> {
  closeContextMenu();
  if (reviewId === item.id) exitReview();
  await api.deleteGalleryItem(item.id, true);
  sound.play('button');
  await refreshGallery();
}

async function exportItem(item: GalleryItem): Promise<void> {
  const res = await api.exportItem(item.id);
  if (res.ok) toast('Photo exported.', 'success');
  else if (!res.canceled) toast('Could not export photo.', 'error');
}

// ---- right-click context menu ----

function openContextMenu(item: GalleryItem, x: number, y: number): void {
  closeContextMenu();
  const menu = el('div', { className: 'ctx-menu' });

  const add = (label: string, danger: boolean, onClick: () => void) => {
    const btn = el('button', { className: `ctx-item${danger ? ' danger' : ''}`, type: 'button', text: label });
    btn.addEventListener('click', () => {
      closeContextMenu();
      onClick();
    });
    menu.appendChild(btn);
  };

  add('Export…', false, () => void exportItem(item));
  add('Show in Folder', false, () => void api.revealItem(item.id));
  if (item.kind !== 'video') add('Open File', false, () => void api.openItem(item.id));
  menu.appendChild(el('div', { className: 'ctx-sep' }));
  add('Delete', true, () => void deleteItem(item));

  // Position within the viewport.
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 170)}px`;
  document.body.appendChild(menu);
  ctxMenu = menu;

  setTimeout(() => {
    window.addEventListener('pointerdown', onDocPointer, true);
    window.addEventListener('blur', closeContextMenu);
  }, 0);
}

function onDocPointer(e: Event): void {
  if (ctxMenu && !ctxMenu.contains(e.target as Node)) closeContextMenu();
}

function closeContextMenu(): void {
  if (!ctxMenu) return;
  ctxMenu.remove();
  ctxMenu = null;
  window.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('blur', closeContextMenu);
}

export function openSaveFolder(): void {
  void api.openSaveFolder();
}
