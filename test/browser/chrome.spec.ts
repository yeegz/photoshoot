// Photo Booth parity: the window's anatomy, sizing and chrome, pinned to the
// measurements in docs/superpowers/specs/2026-10-17-photo-booth-parity-design.md.
import { expect, test } from '@playwright/test';

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
