// The viewfinder is the product. Every check here reads real pixels back from
// the WebGL canvas and from the saved capture — exactly what a photo does — so
// a graphics path that opens, compiles and uploads fine but presents black
// fails loudly instead of reporting "Camera live". Windows CI runs this under
// the `win-d3d11` project (ANGLE Direct3D 11 + GPU compositing, the path every
// Windows PC with a working GPU takes), where Chromium's low-latency canvas
// hint used to turn the preview and every capture black.
import { expect, test } from '@playwright/test';
import { expectLive, hasRealPixels, PIXEL_TIMEOUT } from './live';

// Software Direct3D (WARP) on the CI runner is slow; keep timing loose.
test.describe.configure({ timeout: 240000 });

test('live preview, a GPU effect and a saved photo all contain real pixels', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);

  // Switch to an effect: a second shader program, plus the effects grid's
  // thumbnail renderer, which is another WebGL context.
  await page.locator('#btnEffects').click();
  await page.locator('.effect-tile', { hasText: 'Thermal' }).click();
  await expectLive(page);

  await page.locator('#shutter').click();
  const thumb = page.locator('#trayScroll img').first();
  await expect(thumb).toBeVisible({ timeout: PIXEL_TIMEOUT });
  await expect.poll(() => thumb.evaluate(hasRealPixels), { timeout: PIXEL_TIMEOUT }).toBe(true);
});
