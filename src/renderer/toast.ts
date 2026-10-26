// Lightweight toast notifications used for save confirmations and error states.

import { byId, el } from './dom';
import { icon, type IconName } from './icons';

type ToastKind = 'info' | 'success' | 'error';

const ICONS: Record<ToastKind, IconName> = {
  info: 'info',
  success: 'check',
  error: 'warning',
};

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3200): void {
  const stack = byId('toastStack');
  const node = el('div', { className: `toast toast-${kind}` }, [
    el('span', { className: 'toast-ico' }, [icon(ICONS[kind])]),
    el('span', { text: message }),
  ]);
  stack.append(node);
  // Trigger slide-in on next frame.
  requestAnimationFrame(() => node.classList.add('show'));

  const remove = () => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 360);
  };
  setTimeout(remove, durationMs);
  node.addEventListener('click', remove);
}
