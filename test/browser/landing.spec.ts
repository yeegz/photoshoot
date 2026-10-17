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
