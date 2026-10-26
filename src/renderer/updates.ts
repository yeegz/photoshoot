// Updates and What's New in the window. The desktop installer downloads updates
// quietly; when one is ready, a notice under the titlebar offers Restart (it
// also installs on quit). Builds that can't update themselves show a Download
// link instead. After an update, What's New opens once with the changes since
// the version last seen.

import { app } from './app';
import { api } from './bridge';
import { byId, el, clear } from './dom';
import { sound } from './sound';
import { CHANGELOG, changesSince } from '../shared/changelog';
import { compareVersions, type UpdateInfo } from '../shared/update-check';

let state: UpdateInfo = { status: 'current' };
const listeners: ((info: UpdateInfo) => void)[] = [];

export function updateState(): UpdateInfo {
  return state;
}

/** Settings listens so its Software Update row stays current. */
export function onUpdateState(fn: (info: UpdateInfo) => void): () => void {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn) >>> 0, 1);
}

function setState(info: UpdateInfo): void {
  state = info;
  listeners.forEach((fn) => fn(info));
  showNotice(info);
}

function showNotice(info: UpdateInfo): void {
  const notice = byId('updateNotice');
  const link = byId<HTMLAnchorElement>('updateLink');
  const restart = byId<HTMLButtonElement>('updateRestart');
  const hide = () => (notice.hidden = true);
  byId('updateLater').onclick = hide;
  if (info.status === 'available') {
    byId('updateText').textContent = `Photoshoot ${info.version} is available.`;
    link.href = info.url;
    link.hidden = false;
    restart.hidden = true;
    link.onclick = hide;
    notice.hidden = false;
  } else if (info.status === 'ready') {
    byId('updateText').textContent = `Photoshoot ${info.version} is ready to install.`;
    link.hidden = true;
    restart.hidden = false;
    restart.onclick = () => api.installUpdate();
    notice.hidden = false;
  } else {
    hide();
  }
}

/** Ask for updates now (launch, or Settings → Check Now). */
export async function checkForUpdatesNow(): Promise<UpdateInfo> {
  setState({ status: 'checking' });
  let info: UpdateInfo;
  try {
    info = await api.checkForUpdate();
  } catch {
    info = { status: 'unavailable' }; // never let an update check disturb the camera
  }
  // A download may already have moved on (pushed status); keep the newer news.
  if (state.status === 'checking') setState(info);
  return state;
}

export function initUpdates(): void {
  api.onUpdateStatus((info) => setState(info));
  if (app.settings.checkForUpdates) void checkForUpdatesNow();
  else setState({ status: 'current' });
}

// ---- What's New ----

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Open What's New with the given releases (all of them when omitted). */
export function showWhatsNew(entries = CHANGELOG): void {
  const sheet = byId('whatsNew');
  const list = byId('whatsNewList');
  clear(list);
  for (const entry of entries) {
    const section = el('section', { className: 'wn-release' }, [
      el('h3', {}, [el('span', { text: `Photoshoot ${entry.version}` }), el('span', { className: 'wn-date', text: formatDate(entry.date) })]),
    ]);
    const items = el('ul');
    for (const item of entry.items) items.append(el('li', {}, [el('strong', { text: item.lead }), ` ${item.text}`]));
    section.append(items);
    list.append(section);
  }
  byId('whatsNewTitle').textContent = entries.length === 1 ? `What's New in Photoshoot ${entries[0].version}` : "What's New in Photoshoot";
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  const close = () => {
    sheet.classList.remove('is-open');
    window.setTimeout(() => (sheet.hidden = true), 260);
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  byId('whatsNewDone').onclick = () => {
    sound.play('button');
    close();
  };
  byId<HTMLElement>('whatsNew').onclick = (e) => {
    if (e.target === sheet) close();
  };
  document.addEventListener('keydown', onKey, true);
  byId<HTMLButtonElement>('whatsNewDone').focus({ preventScroll: true });
}

/** Once per update: show what changed since the version last opened. */
export function maybeShowWhatsNew(): void {
  const current = app.info?.version ?? '';
  const seen = app.settings.lastSeenVersion;
  if (!current || seen === current) return;
  void app.updateSettings({ lastSeenVersion: current });
  if (!seen) return; // a fresh install has nothing "new" to announce
  const entries = changesSince(seen, compareVersions).filter((e) => compareVersions(e.version, current) <= 0);
  if (entries.length) showWhatsNew(entries);
}
