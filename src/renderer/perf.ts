// Optional performance/debug overlay. Toggled from Settings. Polls the live
// renderer's stats twice a second and shows FPS, resolution, active effect,
// processing backend, and a dropped-frame warning.

import { app } from './app';
import { byId, clear } from './dom';
import { effectLabel } from './gl/effects';

let timer = 0;

export function setPerfOverlay(enabled: boolean): void {
  const overlay = byId('perfOverlay');
  if (enabled) {
    overlay.classList.remove('hidden');
    if (!timer) {
      update();
      timer = window.setInterval(update, 500);
    }
  } else {
    overlay.classList.add('hidden');
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  }
}

function line(text: string, warn = false): HTMLElement {
  const span = document.createElement('div');
  if (warn) span.className = 'warn';
  span.textContent = text;
  return span;
}

function update(): void {
  if (!app.renderer) return;
  const s = app.renderer.getStats();
  const overlay = byId('perfOverlay');
  clear(overlay);
  overlay.append(
    line(`FPS      ${s.fps}`),
    line(`Res      ${s.width}×${s.height}`),
    line(`Effect   ${effectLabel(app.effect)}`),
    line(`Backend  ${s.backend}`)
  );
  if (s.dropped) overlay.append(line('⚠ dropping frames', true));
}
