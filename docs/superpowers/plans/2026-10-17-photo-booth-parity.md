# Photo Booth Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Photoshoot's window match the current macOS Photo Booth in anatomy, sizing, Liquid Glass depth and behaviour, and add the Photo Booth functions it lacks.

**Architecture:** The app shell becomes a four-row grid (titlebar, viewfinder, tray band, toolbar) with every measurement in tokens; a new default theme `booth` carries the dark glass palette; behaviours (centre countdown, window flash, backdrop pages, review actions, full screen) are small changes to the existing renderer modules. Looks are pinned by Playwright tests that read computed styles and geometry.

**Tech Stack:** TypeScript, plain CSS tokens, Playwright (chromium project), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-photo-booth-parity-design.md`

## Global Constraints

- No new dependencies; no inline styles (CSP); no Apple assets.
- Theme `booth` is the default; other themes keep working through tokens.
- `npm run verify` and `npx playwright test` stay green after every task.
- Reduced-motion rules (`base.css`) keep applying to new animations.

## Review Focus

1. Window narrower than 600px: the toolbar's three zones must not overlap (test in Task 2 sets viewport 600×520).
2. Zero captures: the tray row collapses and the viewfinder gets the space (Task 3 test).
3. Effects browser open while the tray is visible: grid covers viewfinder and tray, not the toolbar (Task 5 test).
4. Review mode then delete: toolbar returns to Effects and the shutter un-greys (Task 7 test).
5. Screen flash off: no white overlay but a photo still saves (Task 6 test).

---

### Task 1: Theme `booth` and the chrome tokens

**Files:**
- Modify: `src/shared/ipc-contract.ts:32,59` (theme id, default)
- Modify: `src/renderer/themes.ts:17-23,99,131` (BUILTIN_THEMES, deviceTheme, fallbacks)
- Modify: `src/renderer/styles/base.css` (new size tokens), `src/renderer/styles/themes.css` (booth palette)
- Modify: `src/web/shim.ts` coerceSettings fallback stays `DEFAULT_SETTINGS.theme`
- Test: `test/browser/chrome.spec.ts` (new)

**Interfaces:**
- Produces: tokens `--titlebar-h: 28px`, `--toolbar-h: 58px`, `--tray-h: 60px`, `--shutter-size: 50px`, `--pill-h: 28px`, `--pill-radius: 9px`, `--glass-fill`, `--glass-fill-hover`, `--glass-edge`, `--glass-specular`; theme id `'booth'` in `BuiltInThemeId`; `applyTheme` falls back to `'booth'`.

- [ ] **Step 1: Write the failing test**

```ts
// test/browser/chrome.spec.ts
import { expect, test } from '@playwright/test';
test('Photo Booth is the default theme and sets the chrome tokens', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'booth');
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return ['--titlebar-h', '--toolbar-h', '--tray-h', '--shutter-size', '--toolbar-bg'].map((t) => s.getPropertyValue(t).trim());
  });
  expect(tokens).toEqual(['28px', '58px', '60px', '50px', '#1d1d1f']);
});
```

- [ ] **Step 2: Run it: `npx playwright test test/browser/chrome.spec.ts --project chromium`** → FAIL (data-theme is `modern`).
- [ ] **Step 3: Add `'booth'` to `BuiltInThemeId`, set `DEFAULT_SETTINGS.theme = 'booth'`; add the theme to `BUILTIN_THEMES` first (`{ id: 'booth', name: 'Photo Booth', sub: 'Dark glass', swatches: ['#1d1d1f', '#2b2b2d', '#d61f16', '#1b7bf3'] }`); `deviceTheme()` returns `'booth'` for dark and `'modern'` for light; every `'modern'` fallback in `themes.ts` and `settings.ts:207` becomes `'booth'`.**
- [ ] **Step 4: Add the size tokens to `:root` in `base.css` and the `html[data-theme="booth"]` palette block to `themes.css` with the spec values (`--app-bg-2: #2b2b2d`, `--toolbar-bg: #1d1d1f`, `--tray-bg` gradient, `--accent: #1b7bf3`, shutter stops, glass tokens, `--text: rgba(255,255,255,.92)`).**
- [ ] **Step 5: Run the test → PASS; run `npm run typecheck && npm run lint && npm test`.**
- [ ] **Step 6: Commit `feat: Photo Booth dark glass theme and chrome tokens`.**

### Task 2: Titlebar and toolbar anatomy

**Files:**
- Modify: `src/renderer/index.html:18-50` (titlebar markup), `:118-160` (toolbar)
- Modify: `src/renderer/styles/layout.css` (titlebar, toolbar), `components.css:102-236` (mode switch, shutter, effects pill)
- Test: `test/browser/chrome.spec.ts`

**Interfaces:**
- Produces: `.glass-pill` class (shared by `.mode-switch`, `.effects-btn`, review pills); `.titlebar-title` left-aligned; mode glyph markup.

- [ ] **Step 1: Write the failing test**

```ts
test('toolbar and titlebar match the reference geometry', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 520 });
  await page.goto('/app/');
  const box = async (sel: string) => page.locator(sel).boundingBox();
  const tb = (await box('#toolbar'))!, title = (await box('.titlebar'))!;
  expect(Math.round(title.height)).toBe(28);
  expect(Math.round(tb.height)).toBe(58);
  const shutter = (await box('#shutter'))!, mode = (await box('#modeSwitch'))!, fx = (await box('#btnEffects'))!;
  expect(Math.round(shutter.width)).toBe(50);
  expect(Math.round(mode.height)).toBe(28);
  expect(Math.round(mode.x)).toBe(15);
  expect(Math.round(600 - (fx.x + fx.width))).toBe(17);
  expect(Math.abs(shutter.x + shutter.width / 2 - 300)).toBeLessThan(1);
  expect(mode.x + mode.width).toBeLessThan(shutter.x);
  expect(fx.x).toBeGreaterThan(shutter.x + shutter.width);
  await expect(page.locator('.titlebar-title')).toHaveCSS('font-size', '15px');
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Rewrite the titlebar markup: traffic lights, then `.titlebar-title` (text only, no mark), status label and actions on the right. Layout: `display:flex; height: var(--titlebar-h); padding: 0 16px 0 13px; gap: 17px`.**
- [ ] **Step 4: Toolbar: `height: var(--toolbar-h); padding: 0 17px 0 15px`. `.glass-pill` = fill/edge/specular/backdrop tokens, `height: var(--pill-h)`, `border-radius: var(--pill-radius)`. `.mode-switch` gets `.glass-pill`, cells 30×24 radius 7, selected `--accent` with `inset 0 1px 0 rgba(255,255,255,.3)`. `.effects-btn` gets `.glass-pill`, `min-width: 96px`, 15px/500. Shutter: 50px, gradient + rim + highlight + shadow from the spec, glyph 22px, `:active` scale(.94). Redraw the three mode glyphs and the shutter glyph as original SVG per the spec.**
- [ ] **Step 5: Run → PASS; full `npx playwright test` → PASS.**
- [ ] **Step 6: Commit `feat: Liquid Glass toolbar and unified titlebar`.**

### Task 3: Photo tray band

**Files:**
- Modify: `src/renderer/index.html` (move `<section id="tray">` out of `.viewfinder`, between `main.stage` and `footer.toolbar`)
- Modify: `src/renderer/styles/layout.css` (`.app` grid rows `var(--titlebar-h) minmax(0,1fr) auto var(--toolbar-h)`), `components.css:237-360` (tray/thumb sizes)
- Modify: `src/renderer/capture.ts:95-140` (fly target = tray row)
- Test: `test/browser/chrome.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('the tray is a 60px band of 90x60 thumbnails flush right, hidden when empty', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await expect(page.locator('#tray')).toBeHidden();
  const stageBefore = (await page.locator('.stage').boundingBox())!;
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 60000 });
  const tray = (await page.locator('#tray').boundingBox())!;
  const thumb = (await page.locator('.thumb').first().boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(Math.round(tray.height)).toBe(60);
  expect([Math.round(thumb.width), Math.round(thumb.height)]).toEqual([90, 60]);
  expect(Math.round(vw - (thumb.x + thumb.width))).toBe(19);
  expect((await page.locator('.stage').boundingBox())!.height).toBeLessThan(stageBefore.height);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Move the tray markup; `.tray { height: var(--tray-h); background: var(--tray-bg); padding: 1px 19px 1px 0 }`, `.tray.hidden` collapses the row; `.thumb { width: 90px; height: 60px }`, `img { border-radius: 0; border: none }`, selected = `inset 0 0 0 2px var(--accent)` via `box-shadow`, 1px gap; delete ✕ top-left on hover. Update `flyToTray` size to 90×60 and the landing x to `trayRect.right - 90 - 19`... keep `trayRect` as the source of truth.**
- [ ] **Step 4: Run → PASS; `npx playwright test` → PASS.**
- [ ] **Step 5: Commit `feat: Photo Booth photo tray band`.**

### Task 4: Countdown in the viewfinder, flash over the window

**Files:**
- Modify: `src/renderer/capture.ts:33-61` (`runCountdown`, `fireFlash`)
- Modify: `src/renderer/index.html` (remove `#barCountdown`; move `#flash` to `body` end), `layout.css` (remove `.bar-countdown`, `.is-counting` rules), `components.css:955-1010`
- Modify: `test/browser/camera.spec.ts:79-90` (countdown test now checks `#countdown` visible instead of `.is-counting`)
- Test: `test/browser/chrome.spec.ts`

**Interfaces:**
- Consumes: `sound.play('tick')`; `#countdown`, `#countdownNumber` (existing markup).

- [ ] **Step 1: Write the failing test**

```ts
test('countdown numerals sit in the viewfinder and the flash covers the window', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#countdown')).toBeVisible();
  await expect(page.locator('#countdownNumber')).toHaveText('3');
  await expect(page.locator('#toolbar')).not.toHaveClass(/is-counting/);
  const flash = (await page.locator('#flash').boundingBox())!;
  const vp = page.viewportSize()!;
  expect([Math.round(flash.width), Math.round(flash.height)]).toEqual([vp.width, vp.height]);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: `runCountdown` shows `#countdown`, sets `#countdownNumber` text and re-triggers the `tick` class each second, hides at the end; delete the bar countdown code and markup. `#flash` becomes `position: fixed; inset: 0; z-index: 90; pointer-events: none`.**
- [ ] **Step 4: Update `camera.spec.ts` "graphics reset during countdown": replace the `is-counting` assertions with `#countdown` visible/hidden.**
- [ ] **Step 5: Run both specs → PASS. Commit `feat: Photo Booth countdown and screen flash`.**

### Task 5: Effects browser gutters, keys and backdrop pages

**Files:**
- Modify: `src/renderer/effectsMenu.ts` (page model: effect pages then backdrop pages; ←/→ keys; `openEffects(page?)`)
- Modify: `src/renderer/backgroundsMenu.ts` (export `pickBackground(id)` from the existing tile handler; titlebar button opens `openEffects(firstBackdropPage)`)
- Modify: `src/renderer/backgrounds.ts` (export `BACKGROUNDS` list with `draw(ctx,w,h)` — already present per `backgroundsMenu.ts:42`)
- Modify: `components.css:512-560` (gap 2px, background #000)
- Test: `test/browser/chrome.spec.ts`

**Interfaces:**
- Produces: `openEffects(page = 0)`, `BACKDROP_PAGE_START` (number) exported from `effectsMenu.ts`; tiles with `data-backdrop="<id>"`.

- [ ] **Step 1: Write the failing test**

```ts
test('effects browser has black 2px gutters, arrow-key paging and backdrop pages', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await expect(page.locator('#effectsGrid')).toHaveCSS('gap', '2px');
  await expect(page.locator('#effectsGrid')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  const dots = page.locator('.page-dot');
  await expect(dots.first()).toHaveClass(/active/);
  await page.keyboard.press('ArrowRight');
  await expect(dots.nth(1)).toHaveClass(/active/);
  await page.keyboard.press('End');
  await expect(page.locator('[data-backdrop]').first()).toBeVisible();
  await expect(page.locator('.effect-tile', { hasText: 'Normal' })).toBeVisible();
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Page model: `pages = chunk(allEffects(), 9)` followed by `chunk(BACKGROUNDS, 8)` with "Normal" inserted at index 4 of each backdrop page; backdrop tiles draw their art into the tile canvas once (`def.draw(ctx, 320, 240)`), carry `data-backdrop`, and on click call `pickBackground(id)` then `closeEffects()`. Keys: `ArrowLeft/ArrowRight/Home/End` while open. `openEffects(page)` renders that page.**
- [ ] **Step 4: Run → PASS; full suite → PASS. Commit `feat: backdrops inside the effects browser`.**

### Task 6: Screen-flash setting

**Files:**
- Modify: `src/shared/ipc-contract.ts` (`screenFlash: boolean`, default `true`), `src/main/storage.ts` (coerce), `src/web/shim.ts` (`coerceSettings`), `src/renderer/settings.ts` (switch row "Screen flash — light up the window when a photo is taken"), `src/renderer/capture.ts` (`fireFlash` honours it)
- Test: `test/unit/settings-coerce.test.ts`? No: the shim/main coercers are not unit-tested today; test through the browser.

- [ ] **Step 1: Write the failing test**

```ts
test('screen flash can be turned off and photos still save', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ screenFlash: false, countdownSeconds: 0 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#flash')).not.toHaveClass(/fire/);
});
```

- [ ] **Step 2: Run → FAIL (flash fires).** 
- [ ] **Step 3: Add the setting everywhere settings are typed/coerced; `fireFlash()` skips the white overlay when `app.settings.screenFlash === false` but still plays the sounds; add the switch row under Capture in settings.**
- [ ] **Step 4: Run → PASS; `npm run typecheck`; commit `feat: screen flash setting`.**

### Task 7: Review actions and full screen

**Files:**
- Modify: `src/renderer/index.html` (right zone: `#btnEffects`, plus `#reviewActions` with `#btnShare` "Share" and `#btnDelete` "Delete", hidden)
- Modify: `src/renderer/gallery.ts` (`enterReview`/`exitReview` toggle `body.is-reviewing`; Share → `exportItem`, Delete → `deleteItem`)
- Modify: `src/renderer/main.ts` (F11 / ⌃⌘F → `api.toggleFullscreen()`; zoom button too), `src/shared/ipc-contract.ts` + `src/preload/preload.ts` + `src/main/ipc.ts` (`toggleFullscreen`), `src/web/shim.ts` (Fullscreen API)
- Modify: `components.css` (review pills use `.glass-pill`)
- Test: `test/browser/chrome.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('selecting a photo shows Share and Delete; deleting it restores the toolbar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  const thumb = page.locator('.thumb').first();
  await expect(thumb).toBeVisible({ timeout: 60000 });
  await thumb.click();
  await expect(page.locator('#btnShare')).toBeVisible();
  await expect(page.locator('#btnEffects')).toBeHidden();
  await expect(page.locator('#shutter')).toHaveClass(/greyed/);
  await page.locator('#btnDelete').click();
  await expect(page.locator('#btnEffects')).toBeVisible();
  await expect(page.locator('#shutter')).not.toHaveClass(/greyed/);
  await expect(page.locator('.thumb')).toHaveCount(0);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement the review pills and the fullscreen bridge method (`toggleFullscreen(): void` on `PhotoshootBridge`; Electron `win.setFullScreen(!win.isFullScreen())`; web `document.fullscreenElement ? exitFullscreen() : documentElement.requestFullscreen()`).**
- [ ] **Step 4: Run → PASS; `npm run verify` → PASS. Commit `feat: review actions and full screen`.**

### Task 8: Glass panels, modal and polish pass

**Files:**
- Modify: `components.css:422-511, 1079-1137, 1138-1177` (panels, modal, toasts use `--glass-*` tokens in `booth`), `themes.css` (booth overrides for `.panel`, `.modal-card`, `.ctx-menu`, `.toast`)
- Test: visual check via `node scripts/shot.mjs` (new, throwaway: Playwright screenshot of `/app/` at 595×486 with the fake camera into `test-results/shots/`), compared by eye with the reference.

- [ ] **Step 1: Add the booth overrides: panels/modals `background: rgba(40,40,42,.78); backdrop-filter: blur(24px) saturate(1.5); border: 1px solid rgba(255,255,255,.12)`, context menu and toasts likewise.**
- [ ] **Step 2: Screenshot script; run; inspect `test-results/shots/app.png`, `effects.png`, `review.png` against the reference; fix sizes that differ by more than 1px.**
- [ ] **Step 3: `npm run verify` → PASS. Commit `style: Liquid Glass panels and polish`.**

### Task 9: Docs and ship

- [ ] Update README "Themes" (Photo Booth is the default; Studio stays) and the screenshot references; update `.github/RELEASE_NOTES.md` for 1.1.0 later (not this task).
- [ ] `npm run verify` → PASS; push `main`; `npm run deploy`.
