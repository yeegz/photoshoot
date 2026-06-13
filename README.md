# Photoshoot

A modern Windows photobooth desktop app. Open your webcam, strike a pose, and
capture single photos, 4‑shot vertical strips, or short videos — with real‑time
WebGL effects, classic background replacement, four hand‑built themes, and
original tactile sounds.

Photoshoot is a **clean‑room homage** to the joyful feeling of classic webcam
photobooth software. It deliberately evokes that look and feel using
conventional desktop UI patterns, system‑standard colors (the familiar red
shutter, system blue, neutral grays), and the OS system font — but every asset
is original: **no Apple branding, logos, icon artwork, graphics, or sound files,
and no Apple code is copied.** Every line of code, every pixel of art, and every
sound is made from scratch.

### ▶ Try it now

- **Use it online:** **https://photoshoot-yeegz.web.app/app/** — the full app runs in your browser, camera and all. Nothing is uploaded.
- **Landing page:** https://photoshoot-yeegz.web.app
- **Download for Windows:** see [Releases](https://github.com/yeegz/photoshoot/releases) (build it yourself with `npm run build:win`).

---

## Highlights

- 🎥 **Live viewfinder** rendered through a real WebGL2 pipeline (not a raw video tag)
- ✨ **15 real‑time GLSL effects** — Sepia, B&W, Thermal, X‑Ray, Comic Book, Pop Art, Glow, Bulge, Dent/Pinch, Twirl, Mirror, Fish Eye, Stretch, Light Tunnel
- 📸 **Single photo**, **4‑shot vertical strip** (composited with borders, paper texture & footer), and **video** capture
- 🪄 **Classic background replacement** with six original procedural backdrops
- 🎨 **Four polished built‑in themes** — Studio (Photo Booth‑style light), Studio Dark, Classic Metal, Retro Film
- 🔌 **Secure community theme import** — zero‑trust, declarative tokens only
- 🔊 **Original sound design** synthesized at runtime (no audio files at all)
- 🖼 **Local gallery** with preview, open file, show in folder, delete
- 🛡 **Secure Electron architecture** — context isolation, sandbox, strict CSP, camera‑only permissions, local‑only processing
- ⚡ **Performance‑minded** — `requestVideoFrameCallback`, reused GPU textures/programs, optional FPS/debug overlay

---

## Requirements

- **Windows 10/11** (the target platform). Development also runs on macOS/Linux.
- **Node.js 18+** and npm.
- A webcam, and a GPU/driver with **WebGL2** support (virtually all modern machines).

---

## Getting started

```bash
npm install      # install dev dependencies (the app itself has zero runtime deps)
npm run dev      # build once, then launch the app
```

Other scripts:

```bash
npm start            # launch the already‑built app (electron .)
npm run build:app    # bundle main/preload/renderer into dist/ (no packaging)
npm run watch        # rebuild on change (then run npm start in another terminal)
npm run typecheck    # strict TypeScript type checking (no emit)
```

---

## Building a Windows app

```bash
npm run build        # production bundle + electron-builder (installer + portable)
npm run build:win    # explicitly target Windows
npm run build:dir    # unpacked build (fast, for smoke‑testing packaging)
```

Output is written to `release/`:

- `Photoshoot-<version>-x64.exe` — NSIS installer
- `Photoshoot-<version>-portable.exe` — portable single‑file build

> Build the Windows installer **on Windows** for a native, signed‑ready result.
> Cross‑building Windows targets from macOS/Linux requires extra tooling (Wine)
> and is not recommended.

The app icon (`build/icon.png`) is generated, original art. You can regenerate it
with `node build/make-icon.mjs`.

> The download link on the website points at GitHub Releases. To publish a
> Windows build, run `npm run build:win` **on Windows**, then attach the
> `release/*.exe` files to a GitHub Release.

---

## Web app & website

Photoshoot also runs **entirely in the browser** — the same renderer, with a
small browser shim (`src/web/shim.ts`) replacing the Electron bridge: captures
live in IndexedDB, settings/themes in `localStorage`, and "export" becomes a
download. Camera processing stays on‑device; nothing is uploaded.

```bash
npm run build:web     # builds the landing page + web app into web-dist/
npm run deploy        # builds web-dist/ and deploys to Firebase Hosting
```

`web-dist/` is a plain static site:

- `web-dist/index.html` — the marketing landing page (`web/landing/`)
- `web-dist/app/` — the web app (shim + renderer + styles)

**Live:** the site is hosted on Firebase Hosting at
**https://photoshoot-yeegz.web.app** (app at `/app/`). Hosting config is in
`firebase.json` / `.firebaserc`; deploy with `firebase login && npm run deploy`.
Because the web app uses `getUserMedia`, it must be served over HTTPS (Firebase
Hosting, GitHub Pages, or `localhost` all qualify).

---

## Where photos are saved

All captures are written to:

```
%USERPROFILE%\Pictures\Photoshoot
```

(`Pictures/Photoshoot`). Files are named like
`Photoshoot_single_2026-06-13_22-04-31.png`. Photos are PNG or JPG (your choice
in Settings); strips are a single composited image; videos are `.webm`.

The in‑app gallery stores small thumbnails and metadata in the app's user‑data
folder. The full‑resolution files live only in `Pictures/Photoshoot`.

---

## How the sounds were made

There are **no audio files in this project**. Every sound — the shutter click,
countdown ticks, capture flash shimmer, the 4‑shot completion chime, the
photo‑drop "plip", button taps, theme switch, and error tone — is **synthesized
at runtime with the Web Audio API** from oscillators and filtered noise (see
[`src/renderer/sound.ts`](src/renderer/sound.ts)).

This recreates the *feeling and timing* of a tactile photobooth while
guaranteeing the audio is 100% original and contains nothing extracted or copied
from Apple or anyone else. Volume and a global mute live in Settings and persist
locally. If audio can't initialize, the app continues silently.

---

## Effects & the rendering pipeline

The live preview is a full WebGL2 pipeline (see [`src/renderer/gl`](src/renderer/gl)):

1. The webcam stream feeds a hidden `<video>` element.
2. Frames drive the loop via `requestVideoFrameCallback` (falling back to
   `requestAnimationFrame`), uploading each frame to a **reused** GPU texture.
3. A per‑effect GLSL fragment shader renders the processed image to the canvas.
4. Captures read the canvas directly, so the saved image exactly matches the
   live preview (effect + mirror + background included).

Resources (programs, textures, the quad VAO) are created once and reused; nothing
is allocated per frame. The Effects menu shows **live** preview tiles via a second
small renderer that uploads the frame once and draws every effect from it.

Enable **Settings → Advanced → Performance overlay** to see FPS, resolution,
active effect, and the processing backend.

---

## Background replacement

Choose **Backgrounds**, pick an original backdrop, then follow the prompts: step
out of frame so Photoshoot can capture a reference, then step back in. Each frame
is compared against the reference at low resolution (the one intentional CPU
pixel loop) to build a soft matte; the GPU composites you over the chosen
backdrop, and effects still apply on top. Tune **edge tolerance** in Settings.

Backdrops (Dreamy Clouds, Retro Dots, Space Horizon, Mountain Sunset, Underwater,
Stage Lights) are all drawn procedurally with Canvas2D — no copyrighted images.

---

## Themes

Four built‑in themes ship with the app and are switchable in Settings:

- **Studio** — bright, neutral, Photo Booth‑style light (the default on first launch)
- **Studio Dark** — clean macOS‑style dark mode
- **Classic Metal** — brushed‑aluminium hardware nostalgia
- **Retro Film** — warm vintage photo‑print palette

Your selected theme persists locally and is restored on restart. Themes are built
on a shared vocabulary of design tokens (colors, spacing, radius, shadow, font,
textures), so they restyle the entire UI — not just a color swap.

### Importing community themes (and the security model)

Photoshoot can import community‑made themes, and treats them as **fully
untrusted** using a zero‑trust model.

A theme "package" is a folder containing a `theme.json` manifest and optional
image files beside it. In Settings → Appearance → **Import Theme…**, choose the
`theme.json`. Example manifest:

```json
{
  "schemaVersion": 1,
  "name": "Sunset Booth",
  "author": "Jane Doe",
  "base": "modern",
  "tokens": {
    "--app-bg": "#1a1030",
    "--accent": "#ff8a5b",
    "--accent-2": "#ffd23f",
    "--radius": "20px",
    "--shadow": "0 18px 50px rgba(0,0,0,0.5)"
  },
  "textures": {
    "--app-bg-texture": "backdrop.png"
  }
}
```

**Imported themes can only ever set validated design tokens.** They are parsed as
data — never executed. The validator (shared by the main process and the
renderer, run twice) enforces:

- A strict **whitelist** of allowed token names and per‑token value types
  (color / length / shadow / font / texture).
- **Forbidden** anywhere: `javascript:`, `expression()`, `url()` to remote/file
  resources, `@import`, HTML/`<script>`, `http(s)://`, `file:`, CSS escapes,
  `;{}` injection, event handlers — rejected.
- Image assets must be **plain leaf filenames** beside the manifest (no `..`, no
  absolute paths, no traversal), within strict **size limits**, and are verified
  by **magic bytes** (PNG/JPEG/WebP) — not by extension. Valid images are inlined
  as `data:` URIs; the renderer never touches the file system.
- Tokens are applied via the CSSOM (`element.style.setProperty`), so a strict
  CSP with **no `unsafe-inline`** is preserved. Invalid tokens are skipped with a
  warning; the rest still apply.

Imported themes live in a controlled app‑data folder. Settings provides
**Remove imported theme** and **Reset to Studio**.

No software can honestly promise zero exploits, but this design eliminates the
obvious paths: no code execution, no remote/network resources, no file access,
no HTML injection, no CSP escape.

---

## Privacy

Photoshoot is built to keep everything on your device:

- **Camera frames never leave your computer.** There is no upload, no cloud, no
  network calls of any kind. The Electron session even cancels unexpected network
  requests.
- **No analytics, tracking, or telemetry.**
- Captures are saved only to `Pictures/Photoshoot`.
- Settings, gallery metadata, and imported themes are stored locally in the app's
  user‑data folder.

Security architecture: `contextIsolation` on, `nodeIntegration` off, sandboxed
renderer, a tiny audited preload bridge (the only IPC surface), strict
Content‑Security‑Policy, camera‑only permission handler, window‑open and
navigation guards, and all file system access funneled through the main process
with path‑traversal and save‑folder containment checks.

---

## Troubleshooting

**Camera permission (Windows).** If you see "Camera access blocked", open
**Settings → Privacy & security → Camera**, ensure camera access is on and that
desktop apps are allowed, then click **Try Again** in Photoshoot.

**"No camera found" / "Camera in use".** Connect a webcam, or close other apps
(Teams, Zoom, etc.) that may be holding the camera, then retry.

**macOS during development.** The first launch triggers the system camera prompt;
allow it. If denied, re‑enable under System Settings → Privacy & Security →
Camera.

**WebGL unavailable.** Photoshoot needs WebGL2. Update your GPU drivers. If
running in a VM or over remote desktop, hardware acceleration may be disabled.

**No sound.** Check the Volume slider and Mute toggle in Settings. Audio unlocks
on your first interaction with the window (per browser autoplay policy).

---

## Project structure

```
src/
  main/        Electron main process (window, IPC, storage, theme import, paths)
  preload/     The single context-bridge API surface
  shared/      IPC contract + the theme validation schema (no Node/DOM)
  renderer/    UI, camera, sound, capture, gallery, settings, themes
    gl/        WebGL core, shaders, effect registry, renderer
    styles/    base / layout / components / themes CSS
build/         App icon + generator
esbuild.mjs    Build pipeline (bundles all three targets)
```

---

## Limitations & future ideas

- Background replacement is the classic reference‑frame technique; it works best
  with a still background and even lighting. A future ML/segmentation backend
  could remove that requirement.
- Video is saved as WebM (capped at 60s) without audio.
- Strip layout is a single vertical 4‑frame design; configurable layouts could
  follow.
- Effect "amount" is fixed per effect today; per‑effect sliders would be a nice
  addition.

---

## License

MIT. All bundled assets, art, and sounds are original to Photoshoot.

**No Apple branding, logos, icons, graphics, layouts, code, or sounds are used.**
