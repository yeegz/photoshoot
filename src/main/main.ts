// Photoshoot — Electron main process.
// Security posture: context isolation on, node integration off, sandboxed
// renderer, a tiny audited preload bridge, strict CSP, camera-only permissions,
// and hard navigation/window-open guards. All media processing happens locally
// in the renderer; nothing is ever uploaded.

import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpc } from './ipc';
import { isInside } from './paths';

const isDev = process.env.NODE_ENV !== 'production';

// The renderer is served from a custom app:// origin (not file://) so that
// MediaPipe's FaceLandmarker can fetch() its local WASM + model — Chromium
// blocks fetch() of file:// resources, but allows it for a standard scheme.
const APP_ORIGIN = 'app://photoshoot';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

let mainWindow: BrowserWindow | null = null;

// Must run before app `ready`. Marks app:// as a standard, secure origin that
// supports fetch — so 'self' in the CSP resolves to it and WASM can load.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// Serve the bundled renderer (and its MediaPipe assets) from disk over app://.
// Path traversal is impossible: every request is resolved against the dist dir
// and rejected unless it stays inside it.
function registerAppProtocol(): void {
  const distDir = __dirname; // main.js lives in dist/ alongside index.html etc.
  protocol.handle('app', async (request) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (rel === '') rel = 'index.html';
    const filePath = path.join(distDir, rel);
    if (!isInside(distDir, filePath)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 600,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: '#ececec',
    title: 'Photoshoot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Deny all attempts to open new windows; route external links to the OS
  // browser instead of loading them in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block any navigation away from our local document.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (url !== current) event.preventDefault();
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function hardenSession(): void {
  const ses = session.defaultSession;

  // Inject CSP on every response (defense in depth alongside the HTML meta tag).
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // Camera only. Everything else (geolocation, notifications, MIDI, etc.) denied.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  // Block loading any remote resource type we don't expect. Local files and
  // devtools are allowed; nothing should reach the network.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith('app:') ||
      url.startsWith('file:') ||
      url.startsWith('devtools:') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      url.startsWith('chrome-extension:');
    callback({ cancel: !allowed });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    hardenSession();
    registerIpc(() => mainWindow);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Extra guard: refuse to create any additional webContents we didn't intend.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
