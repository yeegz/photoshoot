// The sheet that slides down after a four-photo run: a live preview of the
// print, layout and paper choices, and Retake / Share… / Save. Like a Mac
// sheet, Return picks the default button (Save). Escape also saves — the
// photos are never thrown away without a deliberate Retake.

import { app } from './app';
import { byId, el, clear } from './dom';
import { icon, type IconName } from './icons';
import { sound } from './sound';
import { composeSheet, FRAME_LABELS, LAYOUT_LABELS } from './stripLayouts';
import { STRIP_FRAMES, STRIP_LAYOUTS, type StripFrame, type StripLayout } from '../shared/ipc-contract';

export type SheetAction = 'save' | 'share' | 'retake';

export interface SheetChoice {
  action: SheetAction;
  layout: StripLayout;
  frame: StripFrame;
  from: DOMRect; // where the preview sat, so the print can fly from there
}

const LAYOUT_ICONS: Record<StripLayout, IconName> = {
  grid: 'layoutGrid',
  strip: 'layoutStrip',
  row: 'layoutRow',
  feature: 'layoutFeature',
};

const SWATCH: Record<StripFrame, string> = { white: '#ffffff', black: '#141414', cream: '#f2e9d8' };
const PREVIEW_EDGE = 480; // preview frames are drawn small; Save composes full size

let open = false;

export function isSheetOpen(): boolean {
  return open;
}

function scaled(frames: HTMLCanvasElement[]): { list: HTMLCanvasElement[]; w: number; h: number } {
  const f = frames[0];
  const s = Math.min(1, PREVIEW_EDGE / Math.max(f.width, f.height));
  const w = Math.max(1, Math.round(f.width * s));
  const h = Math.max(1, Math.round(f.height * s));
  const list = frames.map((src) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return c;
  });
  return { list, w, h };
}

/** Show the sheet for four captured frames; resolves with the person's choice. */
export function chooseSheet(frames: HTMLCanvasElement[]): Promise<SheetChoice> {
  const sheet = byId('stripSheet');
  const small = scaled(frames);
  let layout: StripLayout = app.settings.stripLayout;
  let frame: StripFrame = app.settings.stripFrame;
  open = true;

  return new Promise((resolve) => {
    const preview = byId<HTMLImageElement>('sheetPreview');
    const layouts = byId('sheetLayouts');
    const papers = byId('sheetFrames');

    let painted = false;
    const reduce = app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = () => {
      // Changing layout or paper settles the print into place.
      if (painted && !reduce) {
        preview.animate(
          [{ opacity: 0.4, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 220, easing: 'cubic-bezier(0.34, 1.3, 0.5, 1)' }
        );
      }
      painted = true;
      preview.src = composeSheet(small.list, small.w, small.h, layout, frame).toDataURL('image/jpeg', 0.85);
      preview.dataset.layout = layout;
      layouts.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((b) => {
        const on = b.dataset.layout === layout;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
      papers.querySelectorAll<HTMLButtonElement>('[data-frame]').forEach((b) => {
        const on = b.dataset.frame === frame;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
    };

    clear(layouts);
    for (const id of STRIP_LAYOUTS) {
      const b = el('button', { className: 'sheet-layout', type: 'button', role: 'radio', dataset: { layout: id } }, [
        icon(LAYOUT_ICONS[id]),
        el('span', { text: LAYOUT_LABELS[id] }),
      ]);
      b.addEventListener('click', () => {
        layout = id;
        sound.play('button');
        paint();
      });
      layouts.appendChild(b);
    }
    clear(papers);
    for (const id of STRIP_FRAMES) {
      const b = el('button', { className: 'sheet-swatch', type: 'button', role: 'radio', ariaLabel: FRAME_LABELS[id], title: FRAME_LABELS[id], dataset: { frame: id } });
      b.style.setProperty('--swatch', SWATCH[id]);
      b.addEventListener('click', () => {
        frame = id;
        sound.play('button');
        paint();
      });
      papers.appendChild(b);
    }

    const finish = (action: SheetAction) => {
      if (!open) return;
      open = false;
      const from = preview.getBoundingClientRect();
      document.removeEventListener('keydown', onKey, true);
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      void app.updateSettings({ stripLayout: layout, stripFrame: frame });
      resolve({ action, layout, frame, from });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        // Return presses the default button; buttons with focus act as themselves.
        if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest('#stripSheet button')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        finish('save');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = STRIP_LAYOUTS.indexOf(layout) + (e.key === 'ArrowRight' ? 1 : -1);
        layout = STRIP_LAYOUTS[(i + STRIP_LAYOUTS.length) % STRIP_LAYOUTS.length];
        e.preventDefault();
        e.stopImmediatePropagation();
        paint();
      } else if (e.code === 'Space') {
        e.stopImmediatePropagation(); // never start another run behind the sheet
      }
    };

    byId('sheetSave').onclick = () => finish('save');
    byId('sheetShare').onclick = () => finish('share');
    byId('sheetRetake').onclick = () => finish('retake');
    byId('sheetShareLabel').textContent = app.info?.platform === 'web' ? 'Share…' : 'Export…';

    paint();
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', onKey, true);
    byId<HTMLButtonElement>('sheetSave').focus({ preventScroll: true });
  });
}
