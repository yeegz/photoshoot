// Updates from GitHub Releases. The Windows installer updates itself through
// electron-updater: it reads the release's latest.yml, downloads the new
// installer in the background (if Settings → Install updates automatically is
// on), and installs it silently on the next restart or quit. The portable app,
// development runs and other platforms can't replace themselves, so they fall
// back to a plain version check that links to the release page.
//
// Only release metadata and the installer are fetched from GitHub; nothing is
// sent beyond ordinary GET requests.

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { RELEASES_API, RELEASES_PAGE, parseLatestRelease, type UpdateInfo } from '../shared/update-check';

/** Plain check: is there a newer release? (No download.) */
export async function checkForUpdate(installed: string): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Photoshoot/${installed}` },
      signal: controller.signal,
    });
    if (!res.ok) return { status: 'unavailable' };
    return parseLatestRelease(await res.json(), installed);
  } catch {
    return { status: 'unavailable' }; // offline, blocked or timed out: stay quiet
  } finally {
    clearTimeout(timer);
  }
}

/** Only the installed Windows app can replace itself. */
export function canSelfUpdate(): boolean {
  return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
}

export class Updater {
  private wired = false;
  private download = true;
  private status: UpdateInfo = { status: 'current' };
  private lastProgress = -1;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (info: UpdateInfo) => void) {}

  private publish(info: UpdateInfo): void {
    this.status = info;
    this.send(info);
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.logger = null;
    autoUpdater.autoDownload = false; // decided per check from the person's setting
    autoUpdater.autoInstallOnAppQuit = true; // a downloaded update installs on quit
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('download-progress', (p) => {
      this.watchStall();
      const percent = Math.round(p.percent);
      if (percent === this.lastProgress || this.status.status !== 'downloading') return;
      this.lastProgress = percent;
      this.publish({ status: 'downloading', version: this.status.version, percent });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.clearStall();
      this.publish({ status: 'ready', version: info.version });
    });
    autoUpdater.on('error', () => {
      // A failed download or install never bothers anyone: reset so Check Now
      // (or the next launch) starts over.
      if (this.status.status === 'downloading' || this.status.status === 'ready') this.reset();
    });
  }

  private reset(): void {
    this.clearStall();
    this.publish({ status: 'unavailable' });
    this.status = { status: 'current' };
  }

  /** A download that goes quiet for a minute (sleep, captive portal) is given up. */
  private watchStall(): void {
    this.clearStall();
    this.stallTimer = setTimeout(() => {
      if (this.status.status === 'downloading') this.reset();
    }, 60000);
  }

  private clearStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  /** Check now. With `download`, a newer version starts downloading in the background. */
  async check(download: boolean): Promise<UpdateInfo> {
    if (!canSelfUpdate()) return checkForUpdate(app.getVersion());
    if (this.status.status === 'ready' || this.status.status === 'downloading') return this.status;
    this.wire();
    this.download = download;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) return (this.status = { status: 'current' });
      const version = result.updateInfo.version;
      if (!this.download) return (this.status = { status: 'available', version, url: RELEASES_PAGE });
      this.lastProgress = -1;
      this.publish({ status: 'downloading', version, percent: 0 });
      this.watchStall();
      void autoUpdater.downloadUpdate().catch(() => undefined); // errors arrive via the 'error' event
      return this.status;
    } catch {
      // The update feed is unreachable: fall back to the plain check so the
      // person still hears about a new version.
      return checkForUpdate(app.getVersion());
    }
  }

  /** Quit and install the downloaded update, then reopen Photoshoot. */
  install(): void {
    if (this.status.status !== 'ready') return;
    autoUpdater.quitAndInstall(true, true);
  }
}
