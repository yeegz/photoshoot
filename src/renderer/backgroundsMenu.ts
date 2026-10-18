import { BACKGROUND_BY_ID, loadCustomBackground } from './backgrounds';
import type { BackgroundReplacer } from './backgroundReplace';
import { byId } from './dom';
import { toast } from './toast';

let replacer: BackgroundReplacer | null = null;
let activeId = 'none';
let selection = 0;

export function currentBackground(): string { return activeId; }

export function initBackgroundsMenu(bgReplacer: BackgroundReplacer): void {
  replacer = bgReplacer;
  replacer.onStop = () => markActive('none');
  replacer.onError = (message) => toast(message, 'error', 5000);
}

function markActive(id: string): void {
  activeId = id;
  byId('btnBackgrounds').classList.toggle('is-on', id !== 'none');
  byId('effectsGrid').querySelectorAll<HTMLElement>('[data-backdrop]').forEach((tile) => {
    const active = tile.dataset.backdrop === id;
    tile.classList.toggle('is-active', active);
    tile.setAttribute('aria-pressed', String(active));
  });
}

function choosePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.hidden = true;
    const finish = (file: File | null) => { input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Selection generations keep slow model loads and file dialogs from winning later. */
export async function pickBackground(id: string): Promise<void> {
  if (!replacer || (id !== 'none' && !BACKGROUND_BY_ID.has(id))) return;
  const request = ++selection;
  if (id === 'none') {
    replacer.stop();
    markActive('none');
    return;
  }
  if (id === 'custom') {
    const file = await choosePhoto();
    if (!file || request !== selection) return;
    try { await loadCustomBackground(file); }
    catch (error) {
      if (request === selection) toast(error instanceof Error ? error.message : 'Could not open that image.', 'error');
      return;
    }
    if (request !== selection) return;
  }
  const activation = replacer.start(id);
  markActive(id);
  const ok = await activation;
  if (request !== selection) return;
  if (ok) markActive(id);
  else {
    markActive('none');
    if (replacer.lastError) toast(replacer.lastError, 'error', 5000);
  }
}
