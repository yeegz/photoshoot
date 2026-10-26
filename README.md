# Photoshoot

**A little photo booth. A lot of personality.**

Take photos, make a four-photo strip, record a short video, or give your webcam a new look. Photoshoot runs in your browser and on Windows, with live effects, person-aware backgrounds and a gallery that stays on your device.

[**Open Photoshoot**](https://photoshoot-yeegz.web.app/app/) · [**Download for Windows**](https://github.com/yeegz/photoshoot/releases/latest) · [Explore the effects](https://photoshoot-yeegz.web.app)

[![Build and camera tests](https://github.com/yeegz/photoshoot/actions/workflows/ci.yml/badge.svg)](https://github.com/yeegz/photoshoot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- Product screenshot is generated from the real app; see docs/images/README.md. -->

## What you can do

- **Find your look.** 17 live effects, from black & white and Plastic Camera to Comic Book and Fish Eye. Drag the center of distortion effects to move the warp.
- **Have some fun.** Eight face-tracked effects, including Bug Out, Chipmunk and Space Alien.
- **Keep the focus on you.** Blur the room behind you, pick a neutral studio or quiet interior, or use your own photo. Person segmentation follows your head and body without taking a reference photo.
- **Capture the moment.** Single photos, four photos with a countdown before each (and, if you like, a different effect for each), and videos up to 60 seconds. After four photos, pick the print: 2×2 grid, classic dated strip, wide row or one big photo over three, on white, black or cream paper — then save or share. The saved image includes your effects, mirror setting and background.
- **Make it yours.** Six themes, adjustable countdown and flash, synthesized shutter sounds, and importable community themes and color filters.
- **Bring your look into calls.** The Windows app can send its processed viewfinder to a virtual camera. See [setup and platform support](#use-photoshoot-in-discord-zoom-or-teams).

Designed and built by [Yousof Selim](https://yousofselim.com/work/photoshoot/). No account needed. No analytics. Camera processing runs locally.

## Get started

### In your browser

[Open the web app](https://photoshoot-yeegz.web.app/app/), allow camera access, then choose an effect or press the red shutter. Use a current browser with WebGL2 for the full effects experience. Basic capture and mirroring also work in the app's fallback mode when WebGL2 is unavailable.

Captures stay in this browser's local storage until you export or delete them. Export anything you want to keep before clearing site data.

### On Windows

Download the installer or portable app from [Releases](https://github.com/yeegz/photoshoot/releases/latest). Both target **64-bit Windows 10 and Windows 11**. Release notes list the exact files and SHA-256 checksums.

Windows packages are currently unsigned, so Windows may show an unknown-publisher warning. Download only from this repository's releases. macOS and Linux development builds are available from source; prebuilt releases target Windows.

Desktop captures are saved in `%USERPROFILE%\Pictures\Photoshoot`. Photos use PNG or JPG; videos use WebM and do not include microphone audio.

## Backgrounds that follow you

Open **Backgrounds** in the titlebar, or go to the background pages in **Effects**:

| Choice | What it does |
| --- | --- |
| Normal | Shows your camera without background processing. |
| Background blur | Keeps the person sharp and blurs the scene behind them. Adjust the strength in Settings. |
| Soft studio / Warm paper / Slate | Replaces the room with a restrained studio background. |
| Quiet room | Uses a natural, softly lit interior. |
| Your photo… | Uses a local JPG, PNG or WebP image, up to 10 MB and 32 megapixels. |

The bundled MediaPipe model detects person pixels on your device. It does not identify who you are. You can stay in frame while choosing a background. Good lighting and a clear outline help with hair, hands and fast movement; segmentation is not perfect. Your custom background is kept in memory for the current session.

## Use Photoshoot in Discord, Zoom or Teams

Virtual camera output is a **Windows desktop feature**. A browser tab cannot install or expose a system camera device. Your effects and background are included; Photoshoot's controls and gallery review are not. Keep Photoshoot open during your call and select your microphone separately in the calling app.

The OBS option works on Windows 10 and Windows 11 and **requires OBS Studio 28 or newer**. OBS supplies the virtual camera device. Photoshoot connects to OBS only on your own computer.

1. [Install OBS Studio](https://obsproject.com/download) and open it.
2. In OBS, open **Tools → WebSocket Server Settings**. Enable the server and authentication. Note the server port (usually `4455`) and password.
3. In OBS Controls, open the gear beside **Start Virtual Camera** and select **Program (Default)** as its output. Turn Studio Mode off. Stop any existing OBS stream, recording or virtual camera before connecting.
4. In Photoshoot, open **Settings → Virtual camera**. Enter the OBS port and password, then click **Start virtual camera**. Photoshoot creates a temporary scene with the processed camera feed and starts OBS Virtual Camera.
5. Select **OBS Virtual Camera** in your calling app:

| App | Camera setting |
| --- | --- |
| Discord | User Settings → Voice & Video → Camera |
| Zoom | Settings → Video & effects → Camera |
| Microsoft Teams | Settings → Devices → Camera |
| Browser calling apps | The call's camera picker; allow camera permission when prompted. |

Keep **both Photoshoot and OBS running**. Stop output in Photoshoot when finished. Output is up to **1280×720 at 15 fps**. OBS credentials are kept in memory, never saved in your settings. Photoshoot restores the previous OBS scene on stop when safe.

If the device is missing, restart the calling app after installing OBS. If the wrong picture appears, check the OBS virtual camera output is **Program (Default)**. More detail: [OBS Virtual Camera guide](https://obsproject.com/kb/virtual-camera-guide).

## Controls worth knowing

| Action | Control |
| --- | --- |
| Take a photo / start video | Red shutter, or Space when no panel is open |
| Skip the countdown | Alt-click on Windows; Option-click on macOS |
| Skip the screen flash | Shift-click the shutter |
| Stop a countdown | Escape |
| Give each of four photos its own effect | Click a numbered slot above the picture, or Shuffle |
| Pick a print layout | Click it, or ← → in the layout sheet; Return saves |
| Return from photo review | Click the photo, click the shutter, or press Escape |
| Delete the photo under review | Delete or Backspace |
| Full screen | F11; Control-Command-F on macOS |
| Move a distortion | Drag on the live preview |

## Updates

The desktop app checks [GitHub Releases](https://github.com/yeegz/photoshoot/releases) once when it opens. If a newer version exists, a notice under the titlebar links to its release page; nothing downloads or installs on its own. Turn it off in **Settings → Advanced → Check for updates**. The check is a single request for the latest release's version number, made from the main process; it sends no camera data or personal information. The web app is always the latest version, so it never shows the notice.

## Privacy and storage

Camera frames, face landmarks and person masks are processed locally. Photoshoot does not upload your captures or use analytics. The web app loads its code and models from its hosting origin; it does not fetch remote camera-processing services.

When you explicitly enable virtual camera output, Photoshoot shares processed frames with the selected local camera backend. **Your calling app controls what is transmitted to the people in your call.** This is separate from Photoshoot's local processing.

The Electron renderer is sandboxed, with context isolation, a restricted IPC bridge and a Content Security Policy. Imported themes and filters are validated data, not executable code. See [customization and import formats](docs/CUSTOMIZATION.md).

## Build and contribute

Use **Node.js 22+** and npm. A webcam is useful for manual checks; automated tests use controlled camera fixtures.

```sh
npm ci
npm run dev                 # build and open the desktop app
```

```sh
npm run web:dev             # browser app at http://localhost:4178/app/
npx playwright install chromium
npm run verify             # types, lint, unit/model tests, browser and Electron tests
npm run build:win           # Windows installer + portable app; run on Windows
npm run build:web           # static site and web app in web-dist/
```

Production builds are generated in `dist/`; Windows packages in `release/`. The release workflow verifies the application before publishing installer, portable app and checksums. The web app is served from Firebase Hosting; `npm run deploy` deploys it when authenticated to the configured project.

```text
src/main/             Desktop window, storage, IPC and virtual camera services
src/preload/          Restricted desktop bridge
src/shared/           Contracts and import validation
src/renderer/         Camera UI, person/face processing, capture and gallery
src/renderer/gl/      WebGL renderer and effect shaders
src/web/              Browser storage and bridge implementation
web/landing/          Product site and live effect showcase
test/                 Unit, browser and desktop regression tests
build/                Build helpers, model assets and integration tests
```

The tests check rendered pixels, failure recovery, local model inference and output transport. They do not establish compatibility with every webcam or calling application. For task history and release evidence, see [the handoff record](docs/HANDOFF.md).

## Troubleshooting

- **Camera access blocked:** allow access in the browser and Windows camera privacy settings. Desktop apps also need **Let desktop apps access your camera** enabled. Then retry.
- **Camera busy or missing:** close other apps using your physical webcam, check its privacy shutter, and select another camera in Settings.
- **Effects unavailable:** update GPU drivers and enable browser hardware acceleration. Basic capture may still work without WebGL2.
- **Background loading fails:** select Normal, then retry. On the web, reload so the locally served model can finish loading.
- **No sound:** check mute and volume in Settings. Sounds become available after your first interaction.

If a problem persists, [open an issue](https://github.com/yeegz/photoshoot/issues) with your OS, app/browser version, camera model and steps to reproduce. Avoid attaching private captures or OBS passwords.

## License and credits

Photoshoot's code is [MIT licensed](LICENSE). Sound effects are synthesized in the app. The sample photographs were generated for this project; their provenance is recorded beside the assets. MediaPipe and its bundled models retain their upstream licenses: see [`build/mediapipe/`](build/mediapipe/).
