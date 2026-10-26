// Viewing a photo and going back must always bring the live camera back —
// with any effect or backdrop on, and from every way out of review.
import { expect, test, type Page } from '@playwright/test';
import { expectLive, hasRealPixels, PIXEL_TIMEOUT } from './live';

test.describe.configure({ timeout: 180000 });

async function shootWith(page: Page, pick: () => Promise<void>): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0 })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnEffects').click();
  await pick();
  await expect(page.locator('#effectsPanel')).not.toHaveClass(/is-open/);
  await page.locator('#shutter').click();
  await expect(page.locator('.thumb img').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#shutter')).toBeEnabled();
}

/** Page through the effects browser until the named tile is on screen, then pick it. */
async function pickEffect(page: Page, label: string): Promise<void> {
  const tile = page.locator('.effect-tile', { hasText: label }).first();
  await page.keyboard.press('Home');
  await page.waitForTimeout(450);
  for (let i = 0; i < 4 && !(await tile.count()); i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
  }
  await tile.click();
}

async function expectCameraBack(page: Page): Promise<void> {
  await expect(page.locator('#review')).toBeHidden();
  // The canvas keeps its last frame when the loop stops, so prove frames advance.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
          const a = canvas.toDataURL();
          await new Promise((r) => setTimeout(r, 300));
          return canvas.toDataURL() !== a;
        }),
      { timeout: 10000 }
    )
    .toBe(true);
  await expect.poll(() => page.locator('#glCanvas').evaluate(hasRealPixels), { timeout: PIXEL_TIMEOUT }).toBe(true);
}

for (const [name, label] of [
  ['a colour effect', 'Thermal'],
  ['a distortion', 'Twirl'],
  ['a face effect', 'Bug Out'],
] as const) {
  test(`with ${name}, review then click the photo returns the live camera`, async ({ page }) => {
    await shootWith(page, () => pickEffect(page, label));
    await page.locator('.thumb').first().click();
    await expect(page.locator('#review')).toBeVisible();
    await page.locator('#review').click();
    await expectCameraBack(page);
  });
}

test('with a backdrop, review then go back keeps the camera and the backdrop', async ({ page }) => {
  await shootWith(page, async () => {
    await page.keyboard.press('End');
    // Blur keeps the (person-free) fake camera visible, so frames still change.
    await page.locator('[data-backdrop="blur"]').click();
    await expect(page.locator('#bgGuide')).toBeHidden({ timeout: 30000 });
  });
  await page.locator('.thumb').first().click();
  await expect(page.locator('#review')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.locator('#review').click();
  await expectCameraBack(page);
  await expect(page.locator('#btnBackgrounds')).toHaveClass(/is-on/);
});

for (const [name, leave] of [
  ['the shutter', (p: Page) => p.locator('#shutter').click()],
  ['Escape', (p: Page) => p.keyboard.press('Escape')],
  ['the same thumbnail', (p: Page) => p.locator('.thumb').first().click()],
] as const) {
  test(`leaving review with ${name} brings the camera back`, async ({ page }) => {
    await shootWith(page, () => pickEffect(page, 'Comic Book'));
    await page.locator('.thumb').first().click();
    await expect(page.locator('#review')).toBeVisible();
    await leave(page);
    await expectCameraBack(page);
  });
}

test('opening Effects while reviewing a photo returns to the live camera first', async ({ page }) => {
  await shootWith(page, () => pickEffect(page, 'Sepia'));
  await page.locator('.thumb').first().click();
  await expect(page.locator('#review')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#btnEffects').click();
  await pickEffect(page, 'Glow');
  await expectCameraBack(page);
});

test('switching between two photos in review and back keeps the camera', async ({ page }) => {
  await shootWith(page, () => pickEffect(page, 'X‑Ray'));
  await page.locator('#shutter').click();
  await expect(page.locator('.thumb img')).toHaveCount(2, { timeout: 60000 });
  await page.locator('.thumb').nth(0).click();
  await page.locator('.thumb').nth(1).click();
  await page.locator('#review').click();
  await expectCameraBack(page);
});
