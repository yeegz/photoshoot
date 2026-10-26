// The four-photo flow on phones, tablets, small windows and laptops: nothing
// overflows sideways, and the sheet's Save button is always on screen.
import { expect, test } from '@playwright/test';
import { expectLive } from './live';

test.describe.configure({ timeout: 180000 });

const sizes = [
  ['phone', 390, 844, true],
  ['phone on its side', 844, 390, true],
  ['tablet', 768, 1024, true],
  ['small window', 640, 520, false],
  ['laptop', 1280, 800, false],
] as const;

for (const [name, width, height, touch] of sizes) {
  test(`${name}: the sheet fits and Save stays visible`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
    const page = await context.newPage();
    await page.addInitScript(() =>
      localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0, tipsSeen: true, stripTourSeen: true }))
    );
    await page.goto('/app/');
    await expectLive(page);
    await page.locator('[data-mode="strip"]').click();
    await expect(page.locator('#stripPlan')).toBeVisible();
    await page.locator('#shutter').click();
    await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
    await page.waitForTimeout(700);
    for (const tab of ['#tabLayout', '#tabText']) {
      await page.locator(tab).click();
      const m = await page.evaluate(() => {
        const card = document.querySelector('.sheet-card')!.getBoundingClientRect();
        const save = document.getElementById('sheetSave')!.getBoundingClientRect();
        return { docW: document.documentElement.scrollWidth, winW: innerWidth, winH: innerHeight, card, save };
      });
      expect(m.docW).toBeLessThanOrEqual(m.winW);
      expect(m.save.bottom).toBeLessThanOrEqual(m.card.bottom);
      expect(m.save.bottom).toBeLessThanOrEqual(m.winH);
      expect(m.card.right).toBeLessThanOrEqual(m.winW);
    }
    await page.locator('#sheetSave').click();
    await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
    await context.close();
  });
}
