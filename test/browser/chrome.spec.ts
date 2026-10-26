// Photo Booth parity: the window's anatomy, sizing and chrome, pinned to the
// measurements in docs/superpowers/specs/2026-10-17-photo-booth-parity-design.md.
import { expect, test } from '@playwright/test';
import { expectLive } from './live';

test('Photo Booth is the default theme and sets the chrome tokens', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'booth');
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return ['--titlebar-h', '--toolbar-h', '--tray-h', '--shutter-size', '--toolbar-bg'].map((t) =>
      s.getPropertyValue(t).trim()
    );
  });
  expect(tokens).toEqual(['28px', '58px', '60px', '50px', '#1d1d1f']);
});

test('toolbar and titlebar match the reference geometry', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 520 });
  await page.goto('/app/');
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const title = await box('.titlebar');
  const tb = await box('#toolbar');
  expect(Math.round(title.height)).toBe(28);
  expect(Math.round(tb.height)).toBe(58);
  const shutter = await box('#shutter');
  const mode = await box('#modeSwitch');
  const fx = await box('#btnEffects');
  expect(Math.round(shutter.width)).toBe(50);
  expect(Math.round(mode.height)).toBe(28);
  expect(Math.round(mode.x)).toBe(15);
  expect(Math.round(600 - (fx.x + fx.width))).toBe(17);
  expect(Math.abs(shutter.x + shutter.width / 2 - 300)).toBeLessThan(1);
  expect(mode.x + mode.width).toBeLessThan(shutter.x);
  expect(fx.x).toBeGreaterThan(shutter.x + shutter.width);
  await expect(page.locator('.titlebar-title')).toHaveCSS('font-size', '15px');
});

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

test('the countdown runs 3-2-1 in the toolbar, like Photo Booth, and the flash covers the window', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#toolbar')).toHaveClass(/is-counting/);
  await expect(page.locator('#cdNums .cd-num')).toHaveCount(3);
  await expect(page.locator('#cdNums .cd-num.active')).toHaveText('3');
  await expect(page.locator('#countdown')).toBeHidden();
  const flash = (await page.locator('#flash').boundingBox())!;
  const vp = page.viewportSize()!;
  expect([Math.round(flash.width), Math.round(flash.height)]).toEqual([vp.width, vp.height]);
});

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

test('screen flash can be turned off and photos still save', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('photoshoot.settings', JSON.stringify({ screenFlash: false, countdownSeconds: 0 }))
  );
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#flash')).not.toHaveClass(/fire/);
});

test('selecting a photo shows the Share icon; the Delete key removes it and restores the toolbar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  const thumb = page.locator('.thumb').first();
  await expect(thumb).toBeVisible({ timeout: 60000 });
  await thumb.click();
  const share = page.locator('#btnShare');
  await expect(share).toBeVisible();
  await expect(share).toHaveAttribute('aria-label', 'Share');
  await expect(share.locator('svg')).toHaveCount(1);
  expect((await share.innerText()).trim()).toBe(''); // an icon, not a word
  await expect(page.locator('#btnDelete')).toHaveCount(0);
  await expect(page.locator('#btnEffects')).toBeHidden();
  await expect(page.locator('#shutter')).toHaveClass(/greyed/);
  await page.keyboard.press('Delete');
  await expect(page.locator('#btnEffects')).toBeVisible();
  await expect(page.locator('#shutter')).not.toHaveClass(/greyed/);
  await expect(page.locator('.thumb')).toHaveCount(0);
});

test('the bridge exposes a full-screen toggle', async ({ page }) => {
  await page.goto('/app/');
  const kind = await page.evaluate(
    () => typeof (window as unknown as { photoshoot: { toggleFullscreen?: unknown } }).photoshoot.toggleFullscreen
  );
  expect(kind).toBe('function');
});

test('with no captures the toolbar sits on the bottom edge and the effects browser spans titlebar to toolbar', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  const vp = page.viewportSize()!;
  const tb = (await page.locator('#toolbar').boundingBox())!;
  expect(Math.round(tb.y + tb.height)).toBe(vp.height);
  await page.locator('#btnEffects').click();
  const fx = (await page.locator('#effectsPanel').boundingBox())!;
  expect(Math.round(fx.y)).toBe(28);
  expect(Math.round(fx.y + fx.height)).toBe(vp.height - 58);
});

// ---- fixes from the whole-branch review ----

test('the Settings reset button returns to Photo Booth and says so', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('photoshoot.settings', JSON.stringify({ theme: 'retro', autoTheme: false, lastSeenVersion: '1.5.1' }))
  );
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
  await page.locator('#btnSettings').click();
  await page.getByRole('button', { name: 'Reset to Photo Booth' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'booth');
});

test('light themes paint the tray band in their own chrome colour', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('photoshoot.settings', JSON.stringify({ theme: 'modern', autoTheme: false, countdownSeconds: 0, lastSeenVersion: '1.5.1' }))
  );
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 60000 });
  const band = await page.evaluate(() => getComputedStyle(document.getElementById('tray')!).backgroundColor);
  expect(band).toBe('rgb(232, 232, 232)'); // Studio's --app-bg-2
});

test('effects paging keys leave form controls alone', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.locator('#btnSettings').click();
  await page.locator('#settingsBody input[type="range"]').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.page-dot').first()).toHaveClass(/active/);
  await expect(page.locator('.page-dot').nth(1)).not.toHaveClass(/active/);
});

test('the Backgrounds button jumps to the backdrop page even while browsing effects', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.locator('#btnBackgrounds').click();
  await expect(page.locator('[data-backdrop]').first()).toBeVisible();
});

test('the page ships with the Photo Booth theme before any script runs', async ({ page }) => {
  const html = await (await page.request.get('/app/')).text();
  expect(html).toContain('data-theme="booth"');
  expect(html).toContain('data-platform="web"');
});

test('on a phone the window fits the visible screen, not the iOS layout viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/app/');
  const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(meta).toContain('viewport-fit=cover');
  // iOS Safari's 100vh is taller than the visible area, which hides the
  // toolbar under the browser bar; the shell must size to the dynamic viewport.
  const usesDvh = await page.evaluate(() =>
    Array.from(document.styleSheets).some((sheet) =>
      Array.from(sheet.cssRules).some(
        (r) => r instanceof CSSStyleRule && r.selectorText === '.app' && r.style.height.includes('dvh')
      )
    )
  );
  expect(usesDvh).toBe(true);
  const tb = (await page.locator('#toolbar').boundingBox())!;
  expect(Math.round(tb.y + tb.height)).toBe(664);
});

// ---- deferred review items ----

test('the mode pill is 94px wide, as measured', async ({ page }) => {
  await page.goto('/app/');
  const mode = (await page.locator('#modeSwitch').boundingBox())!;
  expect(Math.round(mode.width)).toBe(94);
});

test('the screen flash fires when it is on', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#flash')).toHaveClass(/fire/);
});

test('no flash when the graphics reset during the countdown', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#toolbar')).toHaveClass(/is-counting/);
  await page.locator('#glCanvas').evaluate((c: HTMLCanvasElement) =>
    c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext()
  );
  await page.waitForTimeout(3500);
  await expect(page.locator('#flash')).not.toHaveClass(/fire/);
});

test('restarting the camera clears the selected backdrop', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.keyboard.press('End');
  await page.locator('[data-backdrop="studio"]').click();
  await page.locator('#btnSettings').click();
  await page.locator('#settingsBody select').first().dispatchEvent('change');
  await page.keyboard.press('Escape');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.keyboard.press('End');
  await expect(page.locator('[data-backdrop="studio"]')).not.toHaveClass(/is-active/);
  await expect(page.locator('#btnBackgrounds')).not.toHaveClass(/is-on/);
});

// ---- Photo Booth interaction accuracy ----

test('option-click skips the countdown and shift-click skips the flash', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 3 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click({ modifiers: ['Alt'] });
  await expect(page.locator('#trayScroll img')).toHaveCount(1, { timeout: 2500 });
  await expect(page.locator('#toolbar')).not.toHaveClass(/is-counting/);
  await page.evaluate(() => document.getElementById('flash')!.classList.remove('fire'));
  await page.locator('#shutter').click({ modifiers: ['Alt', 'Shift'] });
  await expect(page.locator('#trayScroll img')).toHaveCount(2, { timeout: 5000 });
  await expect(page.locator('#flash')).not.toHaveClass(/fire/);
});

test('picking an effect zooms into its tile', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.locator('.effect-tile', { hasText: 'Thermal' }).click();
  const origin = await page.locator('#effectsGrid').evaluate((g) => g.style.transformOrigin);
  expect(origin).toMatch(/px/);
});

test('pressing past the first page does not rebuild the grid', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.locator('.effect-tile').first().evaluate((t) => t.setAttribute('data-probe', '1'));
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-probe="1"]')).toHaveCount(1);
});

test('the effects pager uses drawn chevrons, not text arrows', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  const arrows = page.locator('.page-arrow');
  await expect(arrows).toHaveCount(2);
  for (const a of await arrows.all()) {
    await expect(a.locator('svg')).toHaveCount(1);
    expect((await a.innerText()).trim()).toBe('');
  }
});

// ---- update check (GitHub Releases) ----

// Replace the bridge's update check before the app boots; the web shim itself
// always reports "current" because the web app is always the latest version.
function stubUpdate(page: import('@playwright/test').Page, result: object) {
  return page.addInitScript((r) => {
    let bridge: Record<string, unknown> | undefined;
    (window as unknown as { __updateChecks: number }).__updateChecks = 0;
    Object.defineProperty(window, 'photoshoot', {
      configurable: true,
      get: () => bridge,
      set: (v: Record<string, unknown>) => {
        bridge = v;
        v.checkForUpdate = async () => {
          (window as unknown as { __updateChecks: number }).__updateChecks++;
          return r;
        };
      },
    });
  }, result);
}

test('a newer release shows an update notice at launch with a download link', async ({ page }) => {
  await stubUpdate(page, { status: 'available', version: '9.9.9', url: 'https://github.com/yeegz/photoshoot/releases/tag/v9.9.9' });
  await page.goto('/app/');
  const notice = page.locator('#updateNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('9.9.9');
  await expect(notice.locator('a')).toHaveAttribute('href', 'https://github.com/yeegz/photoshoot/releases/tag/v9.9.9');
  await notice.getByRole('button', { name: 'Later' }).click();
  await expect(notice).toBeHidden();
});

test('no notice when up to date', async ({ page }) => {
  await stubUpdate(page, { status: 'current' });
  await page.goto('/app/');
  await expectLive(page);
  await expect(page.locator('#updateNotice')).toBeHidden();
});

test('update checks can be turned off in Settings', async ({ page }) => {
  await stubUpdate(page, { status: 'available', version: '9.9.9', url: 'https://github.com/yeegz/photoshoot/releases/latest' });
  await page.goto('/app/');
  await expect(page.locator('#updateNotice')).toBeVisible();
  await page.locator('#btnSettings').click();
  const row = page.locator('.setting-row', { hasText: 'Check for updates' });
  await row.locator('input[type="checkbox"]').uncheck({ force: true });
  await page.reload();
  await expectLive(page);
  await expect(page.locator('#updateNotice')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __updateChecks: number }).__updateChecks)).toBe(0);
});

test('the segmentation worker is content-hashed, so a cached old worker cannot be reused', async ({ page }) => {
  const workers: string[] = [];
  page.on('request', (r) => { if (/personSegmentation\.worker/.test(r.url())) workers.push(r.url()); });
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await page.keyboard.press('End');
  await page.locator('[data-backdrop="studio"]').click();
  await expect.poll(() => workers.length, { timeout: 20000 }).toBeGreaterThan(0);
  expect(workers[0]).toMatch(/personSegmentation\.worker-[A-Z0-9]{8}\.js$/);
});

// ---- Photo Booth motion: effects browser ----

// Record every animation started on the effects grid, with its first/last keyframes.
async function recordGridAnimations(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __gridAnims: { from: string; to: string; origin: string }[] };
    w.__gridAnims = [];
    const grid = document.getElementById('effectsGrid')!;
    const original = grid.animate.bind(grid);
    grid.animate = (frames: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) => {
      const list = (frames as Keyframe[]) ?? [];
      w.__gridAnims.push({ from: String(list[0]?.transform ?? ''), to: String(list.at(-1)?.transform ?? ''), origin: grid.style.transformOrigin });
      return original(frames, opts);
    };
  });
}
const gridAnims = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __gridAnims: { from: string; to: string; origin: string }[] }).__gridAnims);

test('opening Effects shrinks the live view into its tile (zoom out from scale 3)', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await recordGridAnimations(page);
  await page.locator('#btnEffects').click();
  await expect.poll(() => gridAnims(page)).toContainEqual(expect.objectContaining({ from: 'scale(3)', to: 'scale(1)' }));
  // "Normal" is the centre tile on the first page, so the zoom is centred.
  const anim = (await gridAnims(page)).find((a) => a.from === 'scale(3)')!;
  expect(anim.origin).toMatch(/px/);
});

test('effects pages slide sideways instead of swapping', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await recordGridAnimations(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => gridAnims(page)).toContainEqual(expect.objectContaining({ to: 'translateX(-100%)' }));
  await expect.poll(() => gridAnims(page)).toContainEqual(expect.objectContaining({ from: 'translateX(100%)', to: 'translateX(0px)' }));
  await expect(page.locator('.page-dot').nth(1)).toHaveClass(/active/);
});

test('closing Effects without picking zooms back into the active effect', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await expect(page.locator('#effectsPanel')).toHaveClass(/is-open/);
  await recordGridAnimations(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => gridAnims(page)).toContainEqual(expect.objectContaining({ from: 'scale(1)', to: 'scale(3)' }));
  await expect(page.locator('#effectsPanel')).not.toHaveClass(/is-open/);
});

test('a deleted photo collapses out of the tray', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0, checkForUpdates: false })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
  await page.locator('#shutter').click();
  await expect(page.locator('.thumb')).toHaveCount(2, { timeout: 60000 });
  await page.evaluate(() => {
    const w = window as unknown as { __collapse: string[] };
    w.__collapse = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, opts) {
      if (this.classList.contains('thumb')) w.__collapse.push(JSON.stringify(frames));
      return original.call(this, frames, opts);
    };
  });
  await page.locator('.thumb').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.thumb')).toHaveCount(1);
  const frames = await page.evaluate(() => (window as unknown as { __collapse: string[] }).__collapse);
  expect(frames.some((f) => f.includes('"width":"0px"'))).toBe(true);
});
