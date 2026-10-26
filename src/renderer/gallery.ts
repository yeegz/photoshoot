// Gallery filmstrip + photo review. Captures sit in a light bar at the bottom of
// the viewfinder. Clicking one shows it full-size where the camera preview was
// (pausing the camera, Photo Booth style); each photo has an × to delete and a
// right-click menu to export it out of the app's folder. No "saved" toast, no
// chrome — the photo dropping in is the confirmation.

import { virtualCameraActive } from './virtualCamera';
import { api } from './bridge';
import { app } from './app';
import { byId, el, clear } from './dom';
import { toast } from './toast';
import { sound } from './sound';
import { effectDisplayLabel } from './customFilters';
import { icon } from './icons';
import type { GalleryItem } from '../shared/ipc-contract';

let items: GalleryItem[] = [];
let reviewId: string | null = null;
let reviewRequest = 0; // the latest thumbnail click wins if reads finish out of order
let ctxMenu: HTMLElement | null = null;


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
      className: `thumb${item.kind === 'strip' ? ' is-sheet' : ''}${item.id === reviewId ? ' is-selected' : ''}`,
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
      img.alt = `Capture with ${effectDisplayLabel(item.effect)} effect`;
      thumb.appendChild(img);
    }
    // Movies carry a play badge, as in Photo Booth; photos and sheets speak for themselves.
    if (item.kind === 'video') thumb.appendChild(el('span', { className: 'thumb-play' }, [icon('play')]));

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
  // Never pause the camera in the middle of a countdown or a four-photo run.
  if (app.busy) return;
  const request = ++reviewRequest;
  const review = byId('review');
  const img = byId<HTMLImageElement>('reviewImage');
  const res = await api.readItem(item.id);
  if (request !== reviewRequest || app.busy) return;
  const isVideo = item.kind === 'video' && res.ok && !!res.dataUrl;
  if (isVideo) {
    // A movie plays in place; an <img> would show a black frame.
    img.removeAttribute('src');
    const video = reviewVideo(true)!;
    video.src = res.dataUrl!;
    void video.play().catch(() => undefined);
  } else if (res.ok && res.dataUrl) {
    img.src = res.dataUrl;
  } else if (item.thumbnail) {
    img.src = item.thumbnail;
  } else {
    toast('This capture could not be opened.', 'error');
    return;
  }
  img.classList.toggle('hidden', isVideo);
  if (!isVideo) stopReviewVideo();

  reviewId = item.id;
  if (!virtualCameraActive()) app.renderer?.stop(); // output remains live behind photo review
  review.classList.remove('hidden');
  document.body.classList.add('is-reviewing');
  // Grey the shutter, but keep it clickable — clicking it returns to the camera.
  byId('shutter').classList.add('greyed');
  markSelected();
}

export function isReviewing(): boolean {
  return reviewId !== null;
}

/** The movie player exists only while a movie is reviewed (the camera owns the page's other <video>). */
function reviewVideo(create: boolean): HTMLVideoElement | null {
  let video = document.getElementById('reviewVideo') as HTMLVideoElement | null;
  if (!video && create) {
    video = el('video', { attrs: { id: 'reviewVideo', playsinline: '', controls: '' } });
    // Movie controls stay usable: only clicks outside the player leave review.
    video.addEventListener('click', (e) => e.stopPropagation());
    byId('review').appendChild(video);
  }
  return video;
}

function stopReviewVideo(): void {
  const video = reviewVideo(false);
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

export function exitReview(): void {
  reviewRequest++; // a read still in flight must not reopen review
  if (reviewId === null) return;
  reviewId = null;
  byId('review').classList.add('hidden');
  document.body.classList.remove('is-reviewing');
  byId<HTMLImageElement>('reviewImage').removeAttribute('src');
  stopReviewVideo();
  byId('shutter').classList.remove('greyed');
  if (app.renderer?.available) app.renderer.start();
  markSelected();
}

/** Wire the toolbar's Share / Delete pills to the photo under review. */
export function initReviewActions(): void {
  const current = () => items.find((i) => i.id === reviewId);
  byId('btnShare').addEventListener('click', () => {
    const item = current();
    if (item) void exportItem(item);
  });
  // Delete / Backspace removes the photo under review, as in Photo Booth.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, select, textarea')) return;
    const item = current();
    if (!item) return;
    e.preventDefault();
    void deleteItem(item);
  });
}

// ---- delete / export ----

async function deleteItem(item: GalleryItem): Promise<void> {
  closeContextMenu();
  if (reviewId === item.id) exitReview();
  await api.deleteGalleryItem(item.id, true);
  sound.play('button');
  await collapseThumb(item.id);
  await refreshGallery();
}

/** The removed photo shrinks away and its neighbours close the gap. */
async function collapseThumb(id: string): Promise<void> {
  const thumb = byId('trayScroll').querySelector<HTMLElement>(`.thumb[data-id="${CSS.escape(id)}"]`);
  const reduce = app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!thumb || reduce) return;
  const width = thumb.getBoundingClientRect().width;
  await thumb
    .animate(
      [
        { width: `${width}px`, opacity: 1, transform: 'scale(1)' },
        { width: '0px', opacity: 0, transform: 'scale(0.6)' },
      ],
      { duration: 220, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    )
    .finished.catch(() => undefined);
}

async function exportItem(item: GalleryItem): Promise<void> {
  await shareCapture(item.id, item.kind === 'video' ? 'Movie' : 'Photo');
}

/** Share a saved capture: the system share sheet on the web when it can take
 *  files, otherwise a Save dialog (desktop) or a download (web). */
export async function shareCapture(id: string, noun = 'Photo'): Promise<void> {
  const res = await api.exportItem(id);
  if (res.ok) toast(app.info?.platform === 'web' ? `${noun} ready to share.` : `${noun} exported.`, 'success');
  else if (!res.canceled) toast(`Could not share this ${noun.toLowerCase()}.`, 'error');
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

  const web = app.info?.platform === 'web';
  add(web ? 'Share…' : 'Export…', false, () => void exportItem(item));
  // The browser has no folder to show; "Open" covers it there.
  if (!web) add('Show in Folder', false, () => void api.revealItem(item.id));
  if (item.kind !== 'video') add(web ? 'Open in New Tab' : 'Open File', false, () => void api.openItem(item.id));
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
