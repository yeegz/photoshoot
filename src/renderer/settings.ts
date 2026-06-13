// Settings panel. Built entirely with createElement (no innerHTML) and bound
// directly to the persisted settings. Every control writes through
// app.updateSettings() so changes save immediately and apply live.

import { app } from './app';
import { byId, el, clear } from './dom';
import { toast } from './toast';
import { sound } from './sound';
import { setPerfOverlay } from './perf';
import { openOverlay } from './overlays';
import { openSaveFolder } from './gallery';
import {
  BUILTIN_THEMES,
  getImportedThemes,
  setTheme,
  importThemeFlow,
  removeImportedTheme,
} from './themes';
import { DEFAULT_SETTINGS } from '../shared/ipc-contract';
import type { CameraDevice } from './camera';

interface SettingsDeps {
  listCameras(): Promise<CameraDevice[]>;
  selectCamera(id: string): Promise<void>;
}

let deps: SettingsDeps;
let cameras: CameraDevice[] = [];

export function initSettings(d: SettingsDeps): void {
  deps = d;
}

export async function openSettings(): Promise<void> {
  cameras = await deps.listCameras();
  render();
  openOverlay('settingsPanel');
}

// ---- small builders -------------------------------------------------------

function group(title: string, rows: Node[]): HTMLElement {
  const g = el('div', { className: 'settings-group' }, [
    el('h3', { className: 'settings-group-title', text: title }),
  ]);
  const card = el('div', { className: 'settings-card' });
  rows.forEach((r) => card.appendChild(r));
  g.appendChild(card);
  return g;
}

// A padded block for non-row content (theme grid, action buttons, notes) so it
// sits cleanly inside a grouped card.
function block(children: Node[]): HTMLElement {
  return el('div', { className: 'settings-block' }, children);
}

function row(label: string, desc: string | null, control: Node): HTMLElement {
  const left = el('div', {}, [el('div', { className: 'setting-label', text: label })]);
  if (desc) left.appendChild(el('div', { className: 'setting-desc', text: desc }));
  return el('div', { className: 'setting-row' }, [left, el('div', { className: 'setting-control' }, [control])]);
}

function toggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = el('label', { className: 'switch' });
  wrap.append(input, el('span', { className: 'track' }), el('span', { className: 'knob' }));
  return wrap;
}

function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  const sel = document.createElement('select');
  for (const [val, text] of options) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (val === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function range(
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onInput(parseFloat(input.value)));
  return input;
}

// ---- theme cards ----------------------------------------------------------

function themeCard(
  id: string,
  name: string,
  sub: string,
  swatches: string[],
  active: boolean,
  removable: boolean
): HTMLElement {
  const card = el('button', { className: `theme-card${active ? ' is-active' : ''}`, type: 'button' });
  const sw = el('div', { className: 'theme-swatches' });
  swatches.slice(0, 4).forEach((c) => {
    const s = el('span', { className: 'theme-swatch' });
    s.style.background = c;
    sw.appendChild(s);
  });
  card.append(
    sw,
    el('div', { className: 'theme-card-name', text: name }),
    el('div', { className: 'theme-card-sub', text: sub })
  );
  card.addEventListener('click', async () => {
    await setTheme(id);
    sound.play('themeSwitch');
    render();
  });
  if (removable) {
    const rm = el('div', { className: 'theme-card-remove', text: 'Remove' });
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rawId = id.replace('imported:', '');
      await removeImportedTheme(rawId);
      toast('Theme removed.', 'info');
      render();
    });
    card.appendChild(rm);
  }
  return card;
}

function buildThemeSection(): HTMLElement {
  const list = el('div', { className: 'theme-list' });
  for (const t of BUILTIN_THEMES) {
    list.appendChild(themeCard(t.id, t.name, t.sub, t.swatches, app.settings.theme === t.id, false));
  }
  for (const t of getImportedThemes()) {
    const sw = [
      t.tokens['--app-bg'] ?? '#222',
      t.tokens['--accent'] ?? '#888',
      t.tokens['--accent-2'] ?? '#aaa',
      t.tokens['--text'] ?? '#fff',
    ];
    list.appendChild(
      themeCard(`imported:${t.id}`, t.name, `By ${t.author}`, sw, app.settings.theme === `imported:${t.id}`, true)
    );
  }

  const actions = el('div', { className: 'settings-actions' });
  const importBtn = el('button', { className: 'btn btn-primary', type: 'button', text: 'Import Theme…' });
  importBtn.addEventListener('click', async () => {
    const result = await importThemeFlow();
    if (result.canceled) return;
    if (result.ok) {
      toast(`Imported “${result.theme?.name}”.`, 'success');
      if (result.warnings?.length) toast(`${result.warnings.length} item(s) skipped during validation.`, 'info', 4500);
    } else {
      toast(result.error ?? 'Theme could not be imported.', 'error', 5000);
      sound.play('error');
    }
    render();
  });
  const resetBtn = el('button', { className: 'btn', type: 'button', text: 'Reset to Studio' });
  resetBtn.addEventListener('click', async () => {
    await setTheme('modern');
    render();
  });
  actions.append(importBtn, resetBtn);

  const note = el('p', {
    className: 'setting-desc',
    text:
      'Imported themes are untrusted: only validated color, spacing, shadow, font, and image tokens are applied. No scripts, no remote resources, no file access.',
  });
  note.style.maxWidth = 'none';

  return group('Appearance', [block([list, actions, note])]);
}

// ---- main render ----------------------------------------------------------

export function render(): void {
  const body = byId('settingsBody');
  clear(body);
  const s = app.settings;

  // Camera
  const cameraOptions: [string, string][] = cameras.length
    ? cameras.map((c) => [c.id, c.label])
    : [['', 'Default camera']];
  const cameraControl = select(cameraOptions, s.cameraId ?? cameras[0]?.id ?? '', async (id) => {
    await deps.selectCamera(id);
  });
  body.appendChild(
    group('Camera', [
      row('Camera device', cameras.length > 1 ? 'Choose which webcam to use.' : 'Active webcam.', cameraControl),
      row('Mirror preview', 'Flip the image like a real mirror.', toggle(s.mirror, (v) => void app.updateSettings({ mirror: v }))),
    ])
  );

  // Appearance (themes)
  body.appendChild(buildThemeSection());

  // Capture
  body.appendChild(
    group('Capture', [
      row(
        'Countdown',
        'Seconds before each shot.',
        select(
          [
            ['0', 'Instant'],
            ['1', '1 second'],
            ['2', '2 seconds'],
            ['3', '3 seconds'],
            ['4', '4 seconds'],
            ['5', '5 seconds'],
          ],
          String(s.countdownSeconds),
          (v) => void app.updateSettings({ countdownSeconds: parseInt(v, 10) })
        )
      ),
      row(
        'Photo format',
        'PNG is lossless; JPG is smaller.',
        select(
          [
            ['png', 'PNG'],
            ['jpg', 'JPG'],
          ],
          s.format,
          (v) => void app.updateSettings({ format: v === 'jpg' ? 'jpg' : 'png' })
        )
      ),
    ])
  );

  // Sound
  const volLabel = el('span', { text: `${Math.round(s.volume * 100)}%` });
  volLabel.style.fontSize = '12px';
  volLabel.style.color = 'var(--text-dim)';
  volLabel.style.minWidth = '34px';
  volLabel.style.textAlign = 'right';
  const volControl = el('div', {}, [
    range(0, 1, 0.05, s.volume, (v) => {
      volLabel.textContent = `${Math.round(v * 100)}%`;
      void app.updateSettings({ volume: v });
      sound.play('button');
    }),
    volLabel,
  ]);
  volControl.style.display = 'flex';
  volControl.style.alignItems = 'center';
  volControl.style.gap = '10px';
  body.appendChild(
    group('Sound', [
      row('Volume', null, volControl),
      row('Mute all sounds', null, toggle(s.muted, (v) => void app.updateSettings({ muted: v }))),
    ])
  );

  // Background replacement
  body.appendChild(
    group('Background Replacement', [
      row(
        'Edge tolerance',
        'Higher keeps more of you; lower removes more background.',
        range(0.05, 0.8, 0.01, s.bgTolerance, (v) => void app.updateSettings({ bgTolerance: v }))
      ),
    ])
  );

  // Advanced
  body.appendChild(
    group('Advanced', [
      row(
        'Performance overlay',
        'Show FPS and rendering info.',
        toggle(s.perfOverlay, (v) => {
          void app.updateSettings({ perfOverlay: v });
          setPerfOverlay(v);
        })
      ),
      row('Reduce motion', 'Minimize animations.', toggle(s.reducedMotion, (v) => void app.updateSettings({ reducedMotion: v }))),
    ])
  );

  // Save folder
  const folder = el('div', { className: 'settings-folder', text: app.info?.saveFolder ?? 'Pictures/Photoshoot' });
  const openBtn = el('button', { className: 'btn btn-sm', type: 'button', text: 'Open Save Folder' });
  openBtn.addEventListener('click', () => openSaveFolder());
  body.appendChild(group('Files', [block([folder, el('div', { className: 'settings-actions' }, [openBtn])])]));

  // Privacy + reset
  const privacy = el('p', {
    className: 'setting-desc',
    text:
      'Photoshoot processes your camera entirely on this device. Nothing is uploaded, and there is no analytics or tracking. Captures are saved only to Pictures/Photoshoot. All sounds are original and generated in-app.',
  });
  privacy.style.maxWidth = 'none';
  const resetAll = el('button', { className: 'btn btn-danger btn-sm', type: 'button', text: 'Reset all settings' });
  resetAll.addEventListener('click', async () => {
    if (resetAll.dataset.confirm === '1') {
      await app.updateSettings({ ...DEFAULT_SETTINGS, cameraId: app.settings.cameraId });
      await setTheme('modern');
      setPerfOverlay(false);
      toast('Settings reset.', 'info');
      render();
    } else {
      resetAll.dataset.confirm = '1';
      resetAll.textContent = 'Confirm reset?';
      setTimeout(() => {
        resetAll.dataset.confirm = '';
        resetAll.textContent = 'Reset all settings';
      }, 2600);
    }
  });
  body.appendChild(group('Privacy & Reset', [block([privacy, el('div', { className: 'settings-actions' }, [resetAll])])]));

  const about = el('p', { className: 'setting-desc', text: `Photoshoot ${app.info?.version ?? ''}` });
  about.style.opacity = '0.6';
  body.appendChild(about);
}
