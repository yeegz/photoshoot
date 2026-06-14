// The ONLY bridge between the sandboxed renderer and the main process.
// Exposes a small, explicit, promise-based API on window.photoshoot via
// contextBridge. No ipcRenderer, no Node, no file system, no `require` ever
// reaches the page. Each method is a thin typed wrapper over a single channel.

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  PhotoshootBridge,
  Settings,
  SaveRequest,
} from '../shared/ipc-contract';

const bridge: PhotoshootBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsSet, patch),
  saveCapture: (req: SaveRequest) => ipcRenderer.invoke(IPC.captureSave, req),
  listGallery: () => ipcRenderer.invoke(IPC.galleryList),
  readItem: (id: string) => ipcRenderer.invoke(IPC.galleryRead, id),
  exportItem: (id: string) => ipcRenderer.invoke(IPC.galleryExport, id),
  deleteGalleryItem: (id: string, deleteFile: boolean) =>
    ipcRenderer.invoke(IPC.galleryDelete, id, deleteFile),
  revealItem: (id: string) => ipcRenderer.invoke(IPC.galleryReveal, id),
  openItem: (id: string) => ipcRenderer.invoke(IPC.galleryOpen, id),
  openSaveFolder: () => ipcRenderer.invoke(IPC.openSaveFolder),
  importTheme: () => ipcRenderer.invoke(IPC.themeImport),
  listImportedThemes: () => ipcRenderer.invoke(IPC.themeListImported),
  removeImportedTheme: (id: string) => ipcRenderer.invoke(IPC.themeRemove, id),
  importFilter: () => ipcRenderer.invoke(IPC.filterImport),
  listCustomFilters: () => ipcRenderer.invoke(IPC.filterList),
  removeCustomFilter: (id: string) => ipcRenderer.invoke(IPC.filterRemove, id),
  minimizeWindow: () => ipcRenderer.send(IPC.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IPC.windowMaximize),
  closeWindow: () => ipcRenderer.send(IPC.windowClose),
};

contextBridge.exposeInMainWorld('photoshoot', bridge);
