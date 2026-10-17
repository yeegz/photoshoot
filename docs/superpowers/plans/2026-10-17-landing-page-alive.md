# Landing Page Redesign ("the page is the booth") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic "designed landing page" with a page built from the product itself: a working replica of the Photo Booth-style window as the hero (real camera, effects, strip printing), sections made of the product's own parts, the app's typography and palette, no stock patterns.

**Architecture:** Static HTML + CSS + one bundled TypeScript entry (`web/landing/landing.ts`, built by `web/build-web.mjs` with a content hash) that drives the hero window and the filmstrip. The window reuses the app's measurements and glass styling (copied into `.pb-*` rules, no shared CSS). Effects in the demo are CSS filters on the live video; backdrops are drawn by the app's own `backgrounds.ts`. Version comes from `package.json` at build time.

**Tech Stack:** HTML/CSS, TypeScript + esbuild, Web Audio, Playwright (chromium, fake camera).

**Spec:** the "Design decisions" section below (the owner asked for the AI tells removed and everything custom and product-related; questions were skipped at their direction).

## Design decisions

- **Type:** the app's system stack (`-apple-system, "SF Pro Text", "Segoe UI", system-ui`) at UI sizes; headline 44–60 px semibold, letter-spacing −0.02em; body 17 px; no webfont, no Google Fonts request.
- **Palette:** the product's. Page background `#0f0f11` (a dark studio), text `rgba(255,255,255,.92)`, dim `.6`, accent blue `#1b7bf3`, shutter red `#d61f16`; window chrome `#1d1d1f` / `#2b2b2d`. No gradients as decoration, no glow, no vignette, no glass outside the window.
- **Removed:** Archivo, eyebrow labels, the 118 px headline, marquee, price board, paint chips, "Nothing leaves the booth" statement block, doors with arrow circles, rise/fade load choreography, hover-lift on cards.
- **Hero = the window.** Centered replica (max 760 px, same anatomy: titlebar 28 / viewfinder / tray 60 / toolbar 58, pills 28, shutter 50). Viewfinder starts with the app's own message card ("Camera is off" · "Turn on camera" button). Turning it on uses the existing acquisition ladder (IR sensors skipped, every camera tried). **Effects** zooms out to a 3×3 grid of live tiles (Normal centre + Sepia, Black & White, Noir, X‑Ray, Thermal, Pop Art, Glow, Cool) where each tile is the live video under a CSS filter; picking one applies it. **Mode pill:** single / 4‑shot (video disabled with a title "Video is in the app"). **Shutter:** 3‑2‑1 numerals in the viewfinder, window flash, thumbnail (3:2) into the tray; in 4‑shot mode a strip prints out of a slot under the window with a Save button. Keyboard: Space = shutter, Escape closes effects.
- **Under the window:** one sentence ("A photobooth for your webcam. Everything stays on your device.") and two buttons in the app's pill style: "Open the full app" (blue) and "Download for Windows · v{{version}}" (glass).
- **Filmstrip section ("What's in the booth"):** a horizontally scrolling strip with sprocket holes (scroll-snap, drag/wheel), 12 frames: six backdrops drawn live by `backgrounds.ts`, each frame captioned by what it is ("Backdrop · Space Horizon"), plus frames for "17 live effects" (a backdrop under a CSS filter with the effect name), "8 face effects", "4‑shot strips", "Six themes" (mini window in the theme's colours), "Community filters", "No uploads". Frames are 3:2, 300 px wide; captions in the UI font.
- **Themes row:** six mini windows (titlebar strip, viewfinder block, toolbar with red dot) in each theme's real colours, Photo Booth first with "Default".
- **Get section:** two plain rows, like a settings list: "Web app — opens in Chrome, Edge, Firefox, Safari" and "Windows — v{{version}} · installer or portable · unsigned, open source", each with its button. GitHub link under it.
- **Footer:** wordmark, "Clean-room homage. Not affiliated with Apple.", links.
- **Phone:** the window fills the width; tray and toolbar keep their heights; filmstrip scrolls by touch.

## Global Constraints

- No new dependencies, no external requests (fonts, scripts). Landing has no CSP meta; the bundle is first-party.
- `npm run verify` stays green; hashed asset names in `web-dist/`.
- `prefers-reduced-motion` disables the grid zoom, countdown scale and strip drop animations.

## Review Focus

1. Effects grid open, then shutter: grid closes before the countdown. (Task 3 test)
2. Camera denied: the message card shows the app's wording and a retry; nothing else breaks. (Task 2 test)
3. No Web Audio: window still works. (Task 3 test)
4. `{{version}}` never ships literally; the bundle tag is hashed. (Task 1 test)
5. Phone width 390: shutter never intersects the mode pill or Effects pill. (Task 2 test)

---

### Task 1: Rebuild the page skeleton, type and build wiring

**Files:**
- Rewrite: `web/landing/index.html` (new structure: top bar, hero window markup, caption + buttons, filmstrip section, themes row, get section, footer; no Google Fonts link), `web/landing/landing.css` (tokens + layout only in this task)
- Create: `web/landing/landing.ts` (entry; sets `document.documentElement.dataset.landing = 'ready'`)
- Modify: `web/build-web.mjs` (bundle landing.ts hashed; inject script tag; replace `{{version}}`)
- Test: `test/browser/landing.spec.ts` (new)

- [ ] **Step 1: Failing tests** — `test('the landing is first-party: bundle loads, version injected, no webfont')`: goto `/`; expect `html[data-landing="ready"]`; expect body text not to contain `{{version}}`; expect `#getWin` to contain the version from `package.json`; expect no `<link rel="stylesheet" href^="https://">`; expect computed `font-family` of `body` not to contain `Archivo`.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS. Commit `feat(landing): product-first skeleton, system type, build wiring`.**

### Task 2: The hero window with the real camera

**Files:**
- Modify: `web/landing/index.html` (window markup under `#pb`), `landing.css` (`.pb-*`), `landing.ts` (camera ladder moved from the old inline script, message card states, mode pill)
- Test: `test/browser/landing.spec.ts`

**Interfaces:** `#pb` (window), `#pbVideo`, `#pbMessage` (card) with `#pbMessageTitle`, `#pbMessageText`, `#pbMessageAction`; `#pbMode [data-mode]` (strip/single/video); `#pbShutter`; `#pbEffects`; `#pbTray`.

- [ ] **Step 1: Failing tests** — `test('the hero window turns the camera on and shows live video')`: goto `/`; click `#pbMessageAction`; expect `#pbVideo` readyState ≥ 2 and videoWidth > 0 within 30 s; `#pbMessage` hidden. `test('a denied camera shows the app's wording with a retry')`: init script makes `getUserMedia` reject `NotAllowedError`; click; expect `#pbMessageTitle` "Camera access blocked" and `#pbMessageAction` "Try Again". `test('phone layout keeps the toolbar apart')` at 390×844: shutter box does not intersect `#pbMode` or `#pbEffects`.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS. Commit `feat(landing): hero window with the real camera`.**

### Task 3: Effects grid, shutter, tray, strip, sounds

**Files:**
- Modify: `landing.ts` (looks table, grid with 9 live tiles, countdown/flash/capture, strip compose + print, Web Audio tick/shutter), `landing.css`, `index.html` (`#pbGrid`, `#pbCount`, `#pbFlash`, `#pbStrip` slot)
- Test: `test/browser/landing.spec.ts`

- [ ] **Step 1: Failing tests** — `test('effects, a photo and a strip all work in the hero window')`: turn camera on; click `#pbEffects` → 9 `.pb-tile`, centre is Normal; click the Sepia tile → `#pbVideo` computed `filter` contains `sepia`; grid hidden; click `#pbShutter` → `#pbCount` visible → `.pb-thumb` count 1 (≤ 15 s); click `[data-mode="strip"]`, click shutter → `#pbStrip img` visible with a `src` (≤ 30 s). `test('shutter while browsing closes the grid first')`: open grid, click shutter, expect grid hidden and `#pbCount` visible. `test('works without Web Audio')`: delete `AudioContext`; camera on; shutter → thumb.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS. Commit `feat(landing): effects grid, shutter, strip printing, sounds`.**

### Task 4: Filmstrip, themes row, get section

**Files:**
- Modify: `index.html`, `landing.css`, `landing.ts` (draw backdrops into `.frame canvas[data-backdrop]`; apply filters to effect frames)
- Test: `test/browser/landing.spec.ts`

- [ ] **Step 1: Failing tests** — `test('the filmstrip is built from the product')`: `.frame` count ≥ 12; every `.frame canvas[data-backdrop]` has real pixels; `#themes .chip` count 6, first contains "Photo Booth" and "Default"; `#getWin` text contains "installer".
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS. Commit `feat(landing): filmstrip, theme windows, plain get section`.**

### Task 5: Visual pass, verify, ship

- [ ] Screenshots at 1280 and 390 (`.superpowers/landing-shot.mjs`); fix overlaps; check reduced motion.
- [ ] `npm run verify` → PASS; commit; push `main`; `npm run deploy`; re-run "Probe live site on Windows".
