// The landing page is built from the product: a working replica of the app
// window as the hero, the app's own type and palette, nothing fetched from a
// third party. These tests pin that contract.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const version = (JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string })
  .version;

test('the landing is first-party: bundle loads, version injected, no webfont', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-landing', 'ready');
  await expect(page.locator('body')).not.toContainText('{{version}}');
  await expect(page.locator('#getWin')).toContainText(version);
  expect(await page.locator('link[rel="stylesheet"][href^="https://"]').count()).toBe(0);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).not.toContain('Archivo');
});

test('the hero window turns the camera on and shows live video', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pbMessageAction').click();
  await page.waitForFunction(() => {
    const v = document.getElementById('pbVideo') as HTMLVideoElement;
    return v.readyState >= 2 && v.videoWidth > 0;
  }, undefined, { timeout: 30000 });
  await expect(page.locator('#pbMessage')).toBeHidden();
  await expect(page.locator('#pbShutter')).toBeEnabled();
  await expect(page.locator('#pbEffects')).toBeEnabled();
});

test("a denied camera shows the app's wording with a retry", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.locator('#pbMessageAction').click();
  await expect(page.locator('#pbMessageTitle')).toHaveText('Camera access blocked');
  await expect(page.locator('#pbMessageAction')).toHaveText('Try Again');
});

test('phone layout keeps the toolbar apart', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const shutter = await box('#pbShutter');
  const mode = await box('#pbMode');
  const fx = await box('#pbEffects');
  expect(mode.x + mode.width).toBeLessThan(shutter.x);
  expect(fx.x).toBeGreaterThan(shutter.x + shutter.width);
});
