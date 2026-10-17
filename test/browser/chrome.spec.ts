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
    localStorage.setItem('photoshoot.settings', JSON.stringify({ theme: 'retro', autoTheme: false }))
  );
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
  await page.locator('#btnSettings').click();
  await page.getByRole('button', { name: 'Reset to Photo Booth' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'booth');
});

test('light themes paint the tray band in their own chrome colour', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('photoshoot.settings', JSON.stringify({ theme: 'modern', autoTheme: false, countdownSeconds: 0 }))
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
