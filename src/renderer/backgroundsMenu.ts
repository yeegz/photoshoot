// Backdrop selection state. Backdrops are browsed as the last pages of the
// effects browser (effectsMenu.ts); picking one starts the classic
// background-replacement flow here.

import { BACKGROUND_BY_ID } from './backgrounds';
import type { BackgroundReplacer } from './backgroundReplace';
import { byId } from './dom';
import { toast } from './toast';

let replacer: BackgroundReplacer | null = null;
let activeId = 'none';

/** The backdrop currently selected ('none' when background replacement is off). */
export function currentBackground(): string {
  return activeId;
}

export function initBackgroundsMenu(bgReplacer: BackgroundReplacer): void {
  replacer = bgReplacer;
}

function markActive(id: string): void {
  activeId = id;
  byId('btnBackgrounds').classList.toggle('is-on', id !== 'none');
}

/** Select a backdrop by id ('none' turns background replacement off). */
export async function pickBackground(id: string): Promise<void> {
  if (!replacer) return;
  markActive(id);
  if (id === 'none') {
    replacer.stop();
    return;
  }
  if (!BACKGROUND_BY_ID.has(id)) return;
  const ok = await replacer.start(id);
  if (!ok) {
    toast('Background replacement needs the camera running.', 'error');
    markActive('none');
  }
}
