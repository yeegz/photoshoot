// Central app state shared across feature modules. A single mutable singleton
// avoids threading a context object through every function. Modules read/write
// `app` and subscribe to settings changes; main.ts populates the references
// during bootstrap.

import type { GLRenderer } from './gl/renderer';
import type { Settings, AppInfo, CaptureKind } from '../shared/ipc-contract';
import { DEFAULT_SETTINGS } from '../shared/ipc-contract';
import { api } from './bridge';
import { sound } from './sound';

class AppCore {
  info!: AppInfo;
  settings: Settings = { ...DEFAULT_SETTINGS };
  renderer!: GLRenderer;
  video!: HTMLVideoElement;
  mode: CaptureKind = 'single';
  effect = 'normal';
  busy = false; // true during a capture sequence; disables controls

  private settingsListeners: ((s: Settings) => void)[] = [];

  onSettingsChange(fn: (s: Settings) => void): void {
    this.settingsListeners.push(fn);
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = await api.setSettings(patch);
    this.applySideEffects();
    this.settingsListeners.forEach((fn) => fn(this.settings));
    return this.settings;
  }

  /** Re-apply settings that have live, cross-cutting effects. */
  applySideEffects(): void {
    sound.setVolume(this.settings.volume);
    sound.setMuted(this.settings.muted);
    if (this.renderer) this.renderer.setMirror(this.settings.mirror);
    document.documentElement.dataset.reducedMotion = String(this.settings.reducedMotion);
  }
}

export const app = new AppCore();
