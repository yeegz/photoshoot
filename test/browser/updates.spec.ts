// What's New after an update, never on a fresh install; Settings shows the
// update status and opens What's New on request.
import { expect, test } from '@playwright/test';
import { expectLive } from './live';

test('a fresh install does not announce anything', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ tipsSeen: true })));
  await page.goto('/app/');
  await expectLive(page);
  await page.waitForTimeout(800);
  await expect(page.locator('#whatsNew')).toBeHidden();
});

test("after an update, What's New lists the releases since the version last seen, once", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('photoshoot.settings', JSON.stringify({ tipsSeen: true, lastSeenVersion: '1.3.0' }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/app/');
  await expectLive(page);
  const sheet = page.locator('#whatsNew');
  await expect(sheet).toBeVisible();
  await expect(page.locator('.wn-release h3').first()).toContainText('1.5.1');
  await expect(page.locator('.wn-release')).toHaveCount(2); // 1.5.1 and 1.4.0
  await page.locator('#whatsNewDone').click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expectLive(page);
  await page.waitForTimeout(800);
  await expect(sheet).toBeHidden();
});

test("Settings shows the update status and opens What's New", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ tipsSeen: true })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#btnSettings').click();
  await expect(page.locator('.update-status')).toContainText('always up to date');
  await page.getByRole('button', { name: "What's New" }).click();
  await expect(page.locator('#whatsNew')).toBeVisible();
  await expect(page.locator('.wn-release').first()).toContainText('Automatic updates');
});

test("upgrading from 1.4.0 (settings saved before What's New existed) shows What's New", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('photoshoot.settings', JSON.stringify({ theme: 'booth', tipsSeen: true, countdownSeconds: 3 })); // as 1.4.0 saved it
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/app/');
  await expectLive(page);
  await expect(page.locator('#whatsNew')).toBeVisible();
  await expect(page.locator('.wn-release')).toHaveCount(1); // just 1.5.1
});
