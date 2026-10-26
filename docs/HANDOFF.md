# Photoshoot continuation record

Updated 18 October 2026 (Asia/Kuala_Lumpur).

## Current direction

The latest user instructions supersede the original landing-page plan: remove the replica booth hero, improve what the page showcases, keep mobile usable, and finish all outstanding work. During the continuation, the user said the abstract images felt out of place. The landing now uses a neutral candid portrait, rendered through the app's actual effects; procedural backdrops have their own compact preview row. System type, restrained product colors, original assets and local camera processing remain requirements.

This is a website-only update. The desktop application remains version 1.2.0; there is no new desktop release to manufacture for landing-page changes.

## Work already shipped before this continuation

Commit `1ee243b` shipped Windows v1.2.0 and the browser app, including:

- Photo Booth theme and measured chrome, Liquid Glass controls, tray, effects/backdrop pages, full-screen actions and six themes.
- Toolbar countdown; one countdown followed by four rapid photos and a 2×2 sheet; Option-click skips countdown and Shift-click skips flash.
- Effect-selection zoom, Share icon, Delete-key handling and drawn pager chevrons.
- Phone dynamic viewport and safe-area support.
- All six deferred parity review fixes, including camera/backdrop reset and dead background-panel removal.
- The Windows Direct3D 11 black-viewfinder fix and regression coverage.

Evidence: [1.2.0 release](https://github.com/yeegz/photoshoot/releases/tag/v1.2.0), [release workflow](https://github.com/yeegz/photoshoot/actions/runs/39020459013), [prior live Windows probe](https://github.com/yeegz/photoshoot/actions/runs/39020500065).

## Showcase continuation

- Replaced the old replica window with rendered photo prints, all 17 real GLSL effects, an opt-in live camera wall, compact backdrop previews, theme previews and download rows.
- Finished responsive styling, keyboard focus, 44px buttons and reduced-motion support. Inspected desktop and 390px phone screenshots; geometry tests cover 320, 390, 768 and 1280px.
- Created an original sample photograph of fictional adults. See `web/landing/assets/README.md` for provenance and the exact generation prompt. The image is served locally with a content-hashed URL, never from a third-party service.
- Added camera cancellation for late permission responses, page hiding/leaving, disconnect/retry and graphics reset. Camera frames are center-cropped rather than stretched.
- Added honest fallback for absent WebGL, failed shaders, missing sample images and interrupted initialization.
- Extended Windows CI and the live Windows probe to include the landing suite as well as viewfinder pixels.
- An independent review found shader-failure and delayed-initialization edge cases; both received dedicated regression tests and fixes.

## Backgrounds, virtual camera and updates (continuation, 18 October)

- **Person segmentation backgrounds** replace the old "step out of frame" technique: blur, three studio tones, a room photo and a custom photo. Model: `build/mediapipe/selfie_segmenter.tflite` (licence beside it), run in `src/renderer/personSegmentation.worker.ts`; compositing in `backgroundCompositor.ts`; lifecycle in `backgroundReplace.ts`; definitions in `backgrounds.ts`. Spec and plan: `docs/superpowers/specs/2026-10-17-backgrounds-virtual-camera-design.md`, `docs/superpowers/plans/2026-10-17-backgrounds-virtual-camera.md`.
- **Windows virtual camera through OBS Studio 28+**: `src/main/obsClient.ts` (WebSocket v5), `virtualCamera.ts` (service), `virtualCameraFeed.ts` (token-protected loopback MJPEG), renderer UI `src/renderer/virtualCamera.ts`, shared types `src/shared/virtual-camera.ts`. Web builds explain that the desktop app is required.
- **Update check**: `src/shared/update-check.ts` (pure version logic, unit-tested), `src/main/updates.ts` (Node fetch of the GitHub Releases API from the main process, 8 s timeout, silent on failure), launch notice in `src/renderer/main.ts` (`#updateNotice`), toggle under Settings → Advanced → Check for updates (`Settings.checkForUpdates`, default on). The web shim always reports "current".

## Verification and release status

See the bottom of this file for the final status; it is updated when each release ships.

### Status log

- **26 Oct, 1.5.1 released** (shipped as 1.5.1: a mistaken v1.5.0 tag points at the 1.4.0 commit and has no release — safe to delete with `git push origin :refs/tags/v1.5.0`): on top of the print/tutorial/sound work below — FIXED a long-standing bug: face landmarks were uploaded with y top-down (and x mirrored twice), so every face effect warped below the face / the wrong side when mirrored (`renderer.ts`, regression `face.spec.ts` with the landing portrait as a fake camera). Faces: up to 4 people (`faceTracker.ts` MAX_FACES, uniform arrays `f_*[4]`, `EACH_FACE {}` macro in `shaders.ts`), smoothed landmarks, blendshape expressions (`expr` = jaw open, brows up, smile, blink) driving Puppy/Kitty/Rainbow Mouth/Heart Eyes/Flower Crown/Seeing Stars/Blush/Glam/Doe Eyes, hint pill on pick (`EffectDef.hint`). 27 new effects in `MORE_EFFECTS` (EFFECTS = the Photo Booth set the landing wall shows, still 17 non-face); `shaders.spec.ts` compiles every shader. Auto-update: `electron-updater` (`src/main/updates.ts` Updater; Windows installer only, portable/dev fall back to the release-page notice), `publish:` in electron-builder.yml, release.yml uploads latest.yml + blockmap; Settings → Advanced (Install updates automatically, Software Update row); What's New (`src/shared/changelog.ts`, shown once after an update, Settings → Help). Tracking: detection every camera frame, adaptive smoothing, velocity prediction between detections (`getFaces()` leads up to 110 ms), duplicate-face merge, pixel-correct size with a face-height floor. Puppy = floppy lop ears hanging from the head sides (`dogEar()`), tongue on open mouth. Effects pager shows 5 dots at a time and slides (`renderPageDots`). NOTE: 1.4.0 installs can't self-update (no updater) — they see the notice; self-update first happens 1.5.1 → next release.

- **26 Oct, after 1.4.0 (uncommitted until the owner says ship)**: owner feedback on a real strip → tall strips now fit in review (the review image was a grid item whose row grew to the image height; now absolutely positioned); print redesign (`stripLayouts.ts`: footer with caption + date as the main text, Photoshoot mark small in the corner opposite the text, five system fonts, S/M/L, alignment, six inks, five papers, rounded corners; geometry unit-tested); sheet split into Layout / Text tabs with buttons that never scroll away on short windows (`sizes.spec.ts` covers phone, landscape phone, tablet, small window, laptop); print slides out of the preview like a printer; four-photo tutorial (`tips.ts` tours, first switch to four photos, ? on the slot row); sound pass (`sound.ts`: layered mechanical shutter, clean countdown beep, silent flash, print whir + bell, quiet UI, limiter + small synthetic room).

- **26 Oct, 1.4.0** (release + web deploy: see the v1.4.0 GitHub release and Actions runs): owner reported "use an effect, take a photo, view it, go back → camera goes black until reopen". Root cause: `.effects-view` toggled `visibility` and the grid inherited it; the grid's zoom animation starts in the same frame the panel opens and Chromium restyled it from its cached pre-animation style, so the panel opened black with an invisible grid. Fix: the grid declares its own visibility per panel state (components.css). Regression: `electron.spec.ts` "grid is visible every time" (proved red without the fix) + `review.spec.ts`. Other fixes: video review used an `<img>` (black) → `<video>`; thumbnails no longer pause the camera mid-countdown; out-of-order review reads; Effects/Backdrops leave review first; the effects-browser renderer no longer starts its own loop after a GPU reset; web "Open" uses blob URLs (browsers refuse data: tabs) and web Share uses the system share sheet; Escape stops a countdown; real first-frame thumbnails for videos. New: four-photo mode = countdown before every photo, per-photo effects (`stripPlan.ts`, slot picker in `effectsMenu.ts`), layout sheet (`stripSheet.ts`, pure geometry in `stripLayouts.ts` + unit test) with Grid / Strip / Row / Feature and white/black/cream paper, Retake / Share / Save; Mac-style first-run tips (`tips.ts`, Settings → Help → Show Tips, shortcut list); every emoji/text glyph replaced by drawn icons (`icons.ts`); motion pass (slot pulse/pop/flip, sheet drop, layout settle, print flies from the sheet into the tray). The owner dropped the QR / 24-hour link idea; nothing is uploaded. Tests: `test/browser/strip.spec.ts`, `review.spec.ts`, `test/unit/strip-layouts.test.ts`.

- **19 Oct, 1.3.0 PUBLISHED** (https://github.com/yeegz/photoshoot/releases/tag/v1.3.0, installer + portable + checksums; release, main CI on Linux and Windows, and the live Windows probe all green; web deployed). Added before publishing: Photo Booth motion in the effects browser (zoom out from the active tile on open, pages slide, zoom back in on close, picked tile zooms in; tiles painted before the zoom and live updates start after it so slow GPUs stay smooth), deleted photos collapse out of the tray, page changes requested mid-slide are queued, quit only waits for a running OBS session (6 s watchdog), Electron tests close with a bounded wait (Playwright's attached Node debugger makes Electron wait on quit; users have no debugger).
- **18 Oct, release 1.3.0 prepared** (`ab5ff10` + CI fix `ac3203f`, tag `v1.3.0`): segmentation backgrounds, OBS virtual camera, update notices, landing showcase. Web deployed. Full `npm run verify` green before release: 339 unit, 44 node camera/filter/lifecycle, 6 real-model background (`npm run test:backgrounds`), 58 browser incl. Electron. Release workflow, main CI and live Windows probe results: see the GitHub Actions runs for `v1.3.0` / `main` on 18 Oct.
- Rework of the continuation work (owner asked to polish anything weak): background blur no longer halos (person cut out, hole filled from the room, half-res), feathered and temporally smoothed mask, tighter confidence band, every camera frame composited with the latest mask (preview at camera rate, not model rate), stall toast, custom-photo tile glyph clear of its label, content-hashed web worker, virtual camera degrades JPEG quality instead of ending the session, OBS browser-source wait 20 s with an honest message, OBS Config events subscribed.
- Independent review (fresh agent) found 0 critical, 4 important — all fixed with tests (Electron app:// + packaged app.asar segmentation test, hashed worker test, encoder unit tests, longer OBS wait).

### Known limitations (real, not unfinished work)

- **Not verified with real OBS.** The OBS path (WebSocket v5 control, loopback MJPEG feed, browser source, virtual camera start/stop) is unit-tested against a real local WebSocket server but has never run against a real OBS on Windows. First thing to check on a Windows PC: Settings → Virtual camera → Start with OBS 28+ open and its WebSocket server enabled, then pick "OBS Virtual Camera" in Discord.
- Close people: the selfie model reads the shadow between two heads as person, so a thin strip of the real background can show in replacement mode.
- Deferred minors from the review: `createImageBitmap` decodes a custom photo before the 32 MP check (a decompression-bomb image could exhaust renderer memory); stop/quit can take up to ~8.5 s if OBS hangs; `update:check` and older IPC handlers lack the `requireMainFrame` sender gate the virtual-camera handlers use; iOS Safari versions without `CanvasRenderingContext2D.filter` show an unblurred background in blur mode; whether a minimised window keeps the camera `<video>` advancing during a virtual-camera session is untested.
- Windows builds are unsigned; video is WebM without audio, capped at 60 s.

### Next steps for whoever continues

1. Run the real OBS check above on Windows and fix whatever it finds.
2. Decide on the deferred minors (the custom-photo decode limit is the most worth doing: read dimensions from the file header first).
3. Optional: a better segmentation model (MediaPipe multiclass selfie) for hair and close pairs, if size allows.

## Source map and instructions for future work

- `web/landing/index.html`, `landing.css`, `landing.ts`: current landing page. Treat this implementation and the latest direction above as authoritative.
- `web/landing/assets/`: sample photo and creation provenance.
- `web/build-web.mjs`: hashed JS/CSS/image assets and package-version injection.
- `build/backgrounds.test.mjs` (`npm run test:backgrounds`): real model, compositor halo/mask/live-frame, replacer lifecycle.
- `test/unit/update-check.test.ts`, `virtual-camera-encode.test.ts`, `obs-client.test.ts`, `virtual-camera*.test.ts`: update logic, frame encoding, OBS protocol and feed.
- `test/browser/landing.spec.ts`: real pixels, deterministic grayscale, camera lifecycle, shader failures, sample loading, reduced motion and responsive bounds.
- `test/browser/chrome.spec.ts`: app anatomy and Photo Booth interaction regressions.
- `test/browser/camera.spec.ts`, `viewfinder.spec.ts`, `electron.spec.ts`: camera recovery, rendered-pixel and desktop coverage. `PHOTOSHOOT_EXE=<packaged exe>` runs the Electron tests against a packaged build (CI does this with `release/win-unpacked/Photoshoot.exe`).
- `src/renderer/gl/effects.ts`, `shaders.ts`, `glcore.ts`: effect registry, production GLSL and GPU helpers shared with the landing.
- `src/renderer/backgrounds.ts`: six original procedural backdrops. The landing's art changes do not change the app's backdrops.
- `docs/superpowers/specs/2026-10-17-photo-booth-parity-design.md`: reference-window measurements. Its original center-countdown proposal was corrected to toolbar countdown in 1.2.0.
- `docs/superpowers/plans/2026-10-17-photo-booth-parity.md`: completed historical implementation plan; unchecked boxes are not a current backlog.
- `docs/superpowers/plans/2026-10-17-landing-page-alive.md`: historical replica-window plan, shipped in 1.2.0 and superseded by the showcase. Do not restore it.
- `README.md`: run/build instructions, privacy model, features and known product limitations.
- `.github/workflows/ci.yml`: Linux verification and native Windows packaging/D3D11 tests.
- `.github/workflows/probe-live-windows.yml`: deployed-site Windows GPU probe.
- `firebase.json`, `.firebaserc`: Firebase Hosting configuration.

The prior Claude context was recovered from session `fc046b66-aad8-444d-82a2-0b8143718221` and its `project-photoshoot*.md` memories. Those are machine-local context; this tracked record and the source files are the portable handoff. Old `.superpowers/` ledgers are ignored scratch, not authoritative task status.

## Commands

```sh
npm run verify
npm run deploy
gh workflow run 'Probe live site on Windows'
gh run list --limit 6
```

Do not run a separate dev server on port 4178 during `npm run verify`; Playwright owns that port. To test an already deployed site:

```sh
PHOTOSHOOT_BASE_URL=https://photoshoot-yeegz.web.app npx playwright test test/browser/landing.spec.ts test/browser/viewfinder.spec.ts --project chromium
```

The `win-d3d11` project exists only on Windows. Its fake camera and WARP adapter verify rendering without a physical webcam. They do not claim to test every physical device. Windows executables remain unsigned; video is WebM without audio, capped at 60 seconds. These are existing documented product limitations, not unfinished work from this continuation.

## Release recipe

1. `npm run verify` green.
2. `npm version X.Y.Z --no-git-tag-version`; edit `.github/RELEASE_NOTES.md`; commit; `git push origin main`.
3. `git tag -a vX.Y.Z -m "Photoshoot X.Y.Z" && git push origin vX.Y.Z` → `release.yml` builds, tests the packaged app on Windows and publishes the installer, portable exe and checksums.
4. `npm run deploy` (web), then `gh workflow run 'Probe live site on Windows'`.
5. Validate workflow YAML before pushing (`npx yaml@2.6.1 valid < file`): an unquoted `: ` inside a step name breaks the whole workflow.
