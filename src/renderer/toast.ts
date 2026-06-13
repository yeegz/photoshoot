// Lightweight toast notifications used for save confirmations and error states.

import { byId, el } from './dom';

type ToastKind = 'info' | 'success' | 'error';

const ICONS: Record<ToastKind, string> = {
  info: 'ⓘ',
  success: '✓',
  error: '⚠',
};

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3200): void {
  const stack = byId('toastStack');
  const node = el('div', { className: `toast toast-${kind}` }, [
    el('span', { className: 'toast-ico', text: ICONS[kind] }),
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
