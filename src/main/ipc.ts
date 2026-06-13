// Registers every IPC handler. This is the entire surface the renderer can
// reach. Each handler validates its own input and returns plain serializable
// data — no Node objects, handles, or paths-as-capabilities leak out.

import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { IPC, AppInfo, SaveRequest, Settings } from '../shared/ipc-contract';
import { saveDir, themesDir, isInside } from './paths';
import {
  readSettings,
  writeSettings,
  saveCapture,
  listGalleryWithExistenceCheck,
  getGalleryItem,
  deleteGalleryItem,
  readItemDataUrl,
  exportItemTo,
} from './storage';
import { importThemeFromPath, listImportedThemes, removeImportedTheme } from './themeImport';

function asString(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: 'Photoshoot',
    version: app.getVersion(),
    saveFolder: saveDir(),
    themesFolder: themesDir(),
    platform: process.platform,
  }));

  ipcMain.handle(IPC.settingsGet, () => readSettings());

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const safe = patch && typeof patch === 'object' ? patch : {};
    return writeSettings(safe);
  });

  ipcMain.handle(IPC.captureSave, (_e, req: SaveRequest) => saveCapture(req));

  ipcMain.handle(IPC.galleryList, () => listGalleryWithExistenceCheck());

  ipcMain.handle(IPC.galleryRead, (_e, id: unknown) => readItemDataUrl(asString(id)));

  ipcMain.handle(IPC.galleryExport, async (_e, id: unknown) => {
    const item = await getGalleryItem(asString(id));
    if (!item || !isInside(saveDir(), item.path)) return { ok: false };
    const win = getWindow();
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export Photo',
      defaultPath: item.filename,
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    return exportItemTo(item.path, result.filePath);
  });

  ipcMain.handle(IPC.galleryDelete, (_e, id: unknown, deleteFile: unknown) =>
    deleteGalleryItem(asString(id), deleteFile === true)
  );

  ipcMain.handle(IPC.galleryReveal, async (_e, id: unknown) => {
    const item = await getGalleryItem(asString(id));
    if (item && isInside(saveDir(), item.path)) {
      shell.showItemInFolder(item.path);
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle(IPC.galleryOpen, async (_e, id: unknown) => {
    const item = await getGalleryItem(asString(id));
    if (item && isInside(saveDir(), item.path)) {
      const err = await shell.openPath(item.path);
      return { ok: err === '' };
    }
    return { ok: false };
  });

  ipcMain.handle(IPC.openSaveFolder, async () => {
    const err = await shell.openPath(saveDir());
    return { ok: err === '' };
  });

  ipcMain.handle(IPC.themeImport, async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Import Photoshoot Theme',
      message: 'Choose a theme.json manifest file',
      filters: [{ name: 'Photoshoot Theme', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    return importThemeFromPath(result.filePaths[0]);
  });

  ipcMain.handle(IPC.themeListImported, () => listImportedThemes());

  ipcMain.handle(IPC.themeRemove, (_e, id: unknown) => removeImportedTheme(asString(id)));

  // Frameless-window controls (driven by the in-app traffic lights).
  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize());
  ipcMain.on(IPC.windowMaximize, () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IPC.windowClose, () => getWindow()?.close());
}
