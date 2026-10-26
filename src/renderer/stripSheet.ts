// The sheet that slides down after a four-photo run: a live preview of the
// print beside two tabs — Layout (arrangement, paper, corners) and Text
// (caption, date, the small Photoshoot mark, font, size, alignment, colour) —
// and Retake / Share… / Save. Like a Mac sheet, Return picks the default
// button (Save). Escape also saves — the photos are never thrown away without
// a deliberate Retake.

import { app } from './app';
import { byId, el, clear } from './dom';
import { icon, type IconName } from './icons';
import { sound } from './sound';
import {
  composeSheet,
  FONT_LABELS,
  FONT_STACKS,
  FRAME_LABELS,
  INK_LABELS,
  INKS,
  LAYOUT_LABELS,
  PAPER,
  type PrintOptions,
} from './stripLayouts';
import {
  STRIP_ALIGNS,
  STRIP_CAPTION_MAX,
  STRIP_FONTS,
  STRIP_FRAMES,
  STRIP_INKS,
  STRIP_LAYOUTS,
  STRIP_TEXT_SIZES,
  type StripAlign,
  type StripFrame,
  type StripLayout,
} from '../shared/ipc-contract';

export type SheetAction = 'save' | 'share' | 'retake';

export interface SheetChoice {
  action: SheetAction;
  layout: StripLayout;
  frame: StripFrame;
  print: PrintOptions;
  from: DOMRect; // where the preview sat, so the print can fly from there
}

const LAYOUT_ICONS: Record<StripLayout, IconName> = {
  grid: 'layoutGrid',
  strip: 'layoutStrip',
  row: 'layoutRow',
  feature: 'layoutFeature',
};
const ALIGN_ICONS: Record<StripAlign, IconName> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' };
const ALIGN_LABELS: Record<StripAlign, string> = { left: 'Left', center: 'Centre', right: 'Right' };
const SIZE_LABELS = { s: 'S', m: 'M', l: 'L' } as const;
const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large' } as const;

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

/** A radio group of buttons: build once, then `sync(value)` marks the chosen one. */
function radios<T extends string>(
  container: HTMLElement,
  values: readonly T[],
  make: (value: T) => HTMLButtonElement,
  onPick: (value: T) => void
): (current: T) => void {
  clear(container);
  const buttons = values.map((value) => {
    const b = make(value);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => onPick(value));
    container.appendChild(b);
    return [value, b] as const;
  });
  return (current) => {
    for (const [value, b] of buttons) {
      const on = value === current;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
}

function swatch(color: string, label: string, extraClass = ''): HTMLButtonElement {
  const b = el('button', { className: `sheet-swatch ${extraClass}`.trim(), type: 'button', ariaLabel: label, title: label });
  b.style.setProperty('--swatch', color);
  return b;
}

/** Show the sheet for four captured frames; resolves with the person's choice. */
export function chooseSheet(frames: HTMLCanvasElement[]): Promise<SheetChoice> {
  const sheet = byId('stripSheet');
  const small = scaled(frames);
  const s = app.settings;
  let layout: StripLayout = s.stripLayout;
  let frame: StripFrame = s.stripFrame;
  const print: PrintOptions = {
    name: s.stripShowName,
    date: s.stripShowDate,
    caption: s.stripCaption,
    rounded: s.stripRounded,
    font: s.stripFont,
    size: s.stripTextSize,
    ink: s.stripInk,
    align: s.stripAlign,
  };
  open = true;

  return new Promise((resolve) => {
    const preview = byId<HTMLImageElement>('sheetPreview');
    let painted = false;
    const reduce = s.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const syncs: (() => void)[] = [];

    const paint = () => {
      // Every change settles the print into place.
      if (painted && !reduce) {
        preview.animate(
          [{ opacity: 0.4, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 220, easing: 'cubic-bezier(0.34, 1.3, 0.5, 1)' }
        );
      }
      painted = true;
      preview.src = composeSheet(small.list, small.w, small.h, layout, frame, print).toDataURL('image/jpeg', 0.88);
      preview.dataset.printLayout = layout;
      syncs.forEach((sync) => sync());
    };
    const change = (apply: () => void) => {
      apply();
      sound.play('button');
      paint();
    };

    // ---- Layout tab ----
    const syncLayout = radios(byId('sheetLayouts'), STRIP_LAYOUTS, (id) =>
      el('button', { className: 'sheet-layout', type: 'button', dataset: { layout: id } }, [icon(LAYOUT_ICONS[id]), el('span', { text: LAYOUT_LABELS[id] })]),
      (id) => change(() => (layout = id))
    );
    const syncPaper = radios(byId('sheetFrames'), STRIP_FRAMES, (id) => {
      const b = swatch(PAPER[id].paper, FRAME_LABELS[id]);
      b.dataset.frame = id;
      return b;
    }, (id) => change(() => (frame = id)));
    syncs.push(() => syncLayout(layout), () => syncPaper(frame));

    // ---- Text tab ----
    const syncFont = radios(byId('sheetFonts'), STRIP_FONTS, (id) => {
      const face = FONT_STACKS[id];
      const sample = el('span', { className: 'sheet-font-sample', text: 'Aa' });
      sample.style.fontFamily = face.family;
      sample.style.fontStyle = face.style;
      sample.style.fontWeight = String(face.weight);
      return el('button', { className: 'sheet-font', type: 'button', dataset: { font: id } }, [sample, el('span', { text: FONT_LABELS[id] })]);
    }, (id) => change(() => (print.font = id)));
    const syncSize = radios(byId('sheetSizes'), STRIP_TEXT_SIZES, (id) =>
      el('button', { className: 'sheet-seg-btn', type: 'button', ariaLabel: SIZE_NAMES[id], title: SIZE_NAMES[id], text: SIZE_LABELS[id], dataset: { size: id } }),
      (id) => change(() => (print.size = id))
    );
    const syncAlign = radios(byId('sheetAligns'), STRIP_ALIGNS, (id) =>
      el('button', { className: 'sheet-seg-btn', type: 'button', ariaLabel: ALIGN_LABELS[id], title: ALIGN_LABELS[id], dataset: { align: id } }, [icon(ALIGN_ICONS[id])]),
      (id) => change(() => (print.align = id))
    );
    const syncInk = radios(byId('sheetInks'), STRIP_INKS, (id) => {
      const b = id === 'auto' ? swatch(PAPER[frame].ink, INK_LABELS[id], 'is-auto') : swatch(INKS[id], INK_LABELS[id]);
      if (id === 'auto') b.textContent = 'A'; // the paper's own ink
      b.dataset.ink = id;
      return b;
    }, (id) => change(() => (print.ink = id)));
    syncs.push(
      () => syncFont(print.font),
      () => syncSize(print.size),
      () => syncAlign(print.align),
      () => syncInk(print.ink),
      // "Match paper" shows the ink that the current paper would use.
      () => {
        const auto = byId('sheetInks').querySelector<HTMLElement>('[data-ink="auto"]');
        auto?.style.setProperty('--swatch', PAPER[frame].ink);
        auto?.style.setProperty('--paper', PAPER[frame].paper);
      }
    );

    const toggles: [HTMLButtonElement, 'name' | 'date' | 'rounded'][] = [
      [byId<HTMLButtonElement>('sheetName'), 'name'],
      [byId<HTMLButtonElement>('sheetDate'), 'date'],
      [byId<HTMLButtonElement>('sheetRounded'), 'rounded'],
    ];
    for (const [button, key] of toggles) button.onclick = () => change(() => (print[key] = !print[key]));
    syncs.push(() => toggles.forEach(([button, key]) => button.setAttribute('aria-pressed', String(print[key]))));

    const caption = byId<HTMLInputElement>('sheetCaption');
    caption.value = print.caption;
    let typing = 0;
    caption.oninput = () => {
      print.caption = caption.value.slice(0, STRIP_CAPTION_MAX);
      window.clearTimeout(typing);
      typing = window.setTimeout(paint, 140);
    };

    // A soft fade where the controls continue below the fold (short windows).
    const controls = sheet.querySelector<HTMLElement>('.sheet-controls')!;
    const edge = () => controls.classList.toggle('has-more', controls.scrollTop + controls.clientHeight < controls.scrollHeight - 2);
    controls.onscroll = edge;
    syncs.push(() => requestAnimationFrame(edge));

    // ---- Tabs ----
    const tabs: [HTMLButtonElement, HTMLElement][] = [
      [byId<HTMLButtonElement>('tabLayout'), byId('paneLayout')],
      [byId<HTMLButtonElement>('tabText'), byId('paneText')],
    ];
    const selectTab = (index: number) => {
      tabs.forEach(([tab, pane], i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        pane.hidden = i !== index;
      });
      controls.scrollTop = 0;
      requestAnimationFrame(edge);
    };
    tabs.forEach(([tab], i) => (tab.onclick = () => {
      selectTab(i);
      sound.play('button');
    }));
    selectTab(0);

    const finish = (action: SheetAction) => {
      if (!open) return;
      open = false;
      const from = preview.getBoundingClientRect();
      document.removeEventListener('keydown', onKey, true);
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      caption.blur();
      const final = { ...print, caption: print.caption.trim() };
      void app.updateSettings({
        stripLayout: layout,
        stripFrame: frame,
        stripShowName: final.name,
        stripShowDate: final.date,
        stripCaption: final.caption,
        stripRounded: final.rounded,
        stripFont: final.font,
        stripTextSize: final.size,
        stripInk: final.ink,
        stripAlign: final.align,
      });
      resolve({ action, layout, frame, print: final, from });
    };

    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement | null)?.closest('input') !== null;
      if (inField && e.key !== 'Enter' && e.key !== 'Escape') return; // typing a caption
      if (e.key === 'Enter' || e.key === 'Escape') {
        // Return presses the default button; buttons with focus act as themselves.
        if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest('#stripSheet button')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        finish('save');
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !byId('paneLayout').hidden) {
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
    // The print slides out of the top of the preview, like a booth printing it,
    // in time with the motor whir of the finish sound.
    if (!reduce) {
      preview.animate(
        [
          { clipPath: 'inset(0 0 100% 0)', transform: 'translateY(-6%)' },
          { clipPath: 'inset(0 0 0% 0)', transform: 'translateY(0)' },
        ],
        { duration: 820, delay: 260, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' }
      );
    }
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', onKey, true);
    byId<HTMLButtonElement>('sheetSave').focus({ preventScroll: true });
  });
}
