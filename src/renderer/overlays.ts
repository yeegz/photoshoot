// Shared open/close logic for panels (effects, backgrounds, settings) and the
// preview modal, with a single scrim and an "Escape closes the top one" stack.
// Also provides dialog focus management: move focus into the dialog on open,
// trap Tab within the top-most dialog, and restore focus to the opener on close.

import { byId } from './dom';
import { sound } from './sound';

const stack: string[] = [];
const openers = new Map<string, HTMLElement | null>();

function focusables(container: HTMLElement): HTMLElement[] {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  );
}

export function openOverlay(id: string, withSound = true): void {
  const panel = byId(id);
  openers.set(id, document.activeElement as HTMLElement | null);
  panel.classList.remove('hidden');
  byId('scrim').classList.remove('hidden');
  if (!stack.includes(id)) stack.push(id);
  if (withSound) sound.play('button');
  // Move focus into the dialog once it is visible.
  panel.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => panel.focus());
}

export function closeOverlay(id: string): void {
  byId(id).classList.add('hidden');
  const idx = stack.indexOf(id);
  if (idx >= 0) stack.splice(idx, 1);
  if (stack.length === 0) byId('scrim').classList.add('hidden');
  const opener = openers.get(id);
  openers.delete(id);
  if (opener && typeof opener.focus === 'function') opener.focus();
}

export function closeTop(): void {
  const id = stack[stack.length - 1];
  if (id) closeOverlay(id);
}

export function isAnyOpen(): boolean {
  return stack.length > 0;
}

export function isOpen(id: string): boolean {
  return stack.includes(id);
}

// Trap Tab within the top-most open dialog.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || stack.length === 0) return;
  const top = byId(stack[stack.length - 1]);
  const items = focusables(top);
  if (items.length === 0) {
    e.preventDefault();
    top.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (!active || !top.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});
