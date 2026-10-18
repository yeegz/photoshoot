# Photoshoot continuation record

Updated 17 October 2026 (Asia/Kuala_Lumpur).

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

## Verification and release status

Final verification and publishing are in progress. Replace this paragraph with final results before closing the task.

## Source map and instructions for future work

- `web/landing/index.html`, `landing.css`, `landing.ts`: current landing page. Treat this implementation and the latest direction above as authoritative.
- `web/landing/assets/`: sample photo and creation provenance.
- `web/build-web.mjs`: hashed JS/CSS/image assets and package-version injection.
- `test/browser/landing.spec.ts`: real pixels, deterministic grayscale, camera lifecycle, shader failures, sample loading, reduced motion and responsive bounds.
- `test/browser/chrome.spec.ts`: app anatomy and Photo Booth interaction regressions.
- `test/browser/camera.spec.ts`, `viewfinder.spec.ts`, `electron.spec.ts`: camera recovery, rendered-pixel and desktop coverage.
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
