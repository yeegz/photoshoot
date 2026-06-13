// Backgrounds menu: a "None" tile plus one tile per original procedural backdrop.
// Selecting a backdrop kicks off the classic background-replacement flow.

import { BACKGROUNDS, BACKGROUND_BY_ID } from './backgrounds';
import type { BackgroundReplacer } from './backgroundReplace';
import { byId, el, clear } from './dom';
import { closeOverlay } from './overlays';
import { toast } from './toast';

let replacer: BackgroundReplacer | null = null;

export function initBackgroundsMenu(bgReplacer: BackgroundReplacer): void {
  replacer = bgReplacer;
  buildBackgroundsMenu();
}

function buildBackgroundsMenu(): void {
  const grid = byId('backgroundsGrid');
  clear(grid);

  const none = el('button', {
    className: 'bg-tile bg-none is-active',
    type: 'button',
    text: 'No Background',
    ariaLabel: 'Turn off background replacement',
    dataset: { id: 'none' },
    onClick: () => selectBackground('none'),
  });
  grid.appendChild(none);

  for (const def of BACKGROUNDS) {
    const tile = el('button', {
      className: 'bg-tile',
      type: 'button',
      ariaLabel: def.label,
      dataset: { id: def.id },
      onClick: () => selectBackground(def.id),
    });
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    def.draw(canvas.getContext('2d')!, canvas.width, canvas.height);
    tile.append(canvas, el('span', { className: 'bg-name', text: def.label }));
    grid.appendChild(tile);
  }
}

function markActive(id: string): void {
  byId('backgroundsGrid')
    .querySelectorAll('.bg-tile')
    .forEach((t) => {
      const active = (t as HTMLElement).dataset.id === id;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-pressed', String(active));
    });
  byId('btnBackgrounds').classList.toggle('is-on', id !== 'none');
}

async function selectBackground(id: string): Promise<void> {
  if (!replacer) return;
  markActive(id);

  if (id === 'none') {
    replacer.stop();
    return;
  }
  if (!BACKGROUND_BY_ID.has(id)) return;

  closeOverlay('backgroundsPanel');
  const ok = await replacer.start(id);
  if (!ok) {
    toast('Background replacement needs the camera running.', 'error');
    markActive('none');
  }
}
