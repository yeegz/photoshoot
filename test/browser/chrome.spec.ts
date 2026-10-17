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
