// Four photos: every photo gets its own countdown and can have its own effect,
// then a layout sheet decides how the print looks before it is saved.
import { expect, test, type Page } from '@playwright/test';
import { expectLive } from './live';

test.describe.configure({ timeout: 180000 });

async function open(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => localStorage.setItem('photoshoot.settings', JSON.stringify(s)), { tipsSeen: true, stripTourSeen: true, ...settings });
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('[data-mode="strip"]').click();
  await expect(page.locator('#stripPlan')).toBeVisible();
}

async function countCountdowns(page: Page): Promise<() => number> {
  let n = 0;
  await page.exposeFunction('countedDown', () => n++);
  await page.evaluate(() => {
    new MutationObserver((m) => {
      for (const r of m)
        if ((r.target as HTMLElement).classList.contains('is-counting') && !(r.oldValue ?? '').includes('is-counting'))
          (window as unknown as { countedDown: () => void }).countedDown();
    }).observe(document.getElementById('toolbar')!, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  return () => n;
}

test('each of the four photos has its own countdown, then the layout sheet opens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message)); // countdown, shutter and finish sounds all play here
  await open(page, { countdownSeconds: 1 });
  const countdowns = await countCountdowns(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  expect(countdowns()).toBe(4);
  await expect(page.locator('#sheetSave')).toBeFocused();
  await expect(page.locator('.sheet-layout')).toHaveCount(4);
  await expect(page.locator('#shutter')).toBeDisabled(); // nothing starts behind the sheet
  expect(errors).toEqual([]);
});

test('the chosen layout is what gets saved, and is remembered', async ({ page }) => {
  await open(page, { countdownSeconds: 0 });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.locator('[data-layout="row"]').click();
  await page.locator('[data-frame="cream"]').click();
  await page.locator('#sheetSave').click();
  const img = page.locator('#trayScroll img').first();
  await expect(img).toBeVisible({ timeout: 60000 });
  const ratio = await img.evaluate((i: HTMLImageElement) => i.naturalWidth / i.naturalHeight);
  expect(ratio).toBeGreaterThan(4); // a wide row of four
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('photoshoot.settings') ?? '{}'));
  expect(saved.stripLayout).toBe('row');
  expect(saved.stripFrame).toBe('cream');
});

test('the classic strip is tall; Return saves it', async ({ page }) => {
  await open(page, { countdownSeconds: 0, stripLayout: 'strip' });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.keyboard.press('Enter');
  const img = page.locator('#trayScroll img').first();
  await expect(img).toBeVisible({ timeout: 60000 });
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalHeight / i.naturalWidth)).toBeGreaterThan(2);
  await expect(page.locator('.thumb').first()).toHaveClass(/is-sheet/);
});

test('Retake throws the four away and starts again', async ({ page }) => {
  await open(page, { countdownSeconds: 0 });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.locator('#sheetRetake').click();
  await expect(page.locator('#stripSheet')).not.toHaveClass(/is-open/);
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.locator('#sheetSave').click();
  await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
});

test('each photo can have its own effect, and the live effect comes back afterwards', async ({ page }) => {
  await open(page, { countdownSeconds: 1 });
  await page.locator('.plan-slot').nth(2).click();
  await expect(page.locator('#effectsPanel')).toHaveClass(/is-slot-picker/);
  await expect(page.locator('#slotPickerTitle')).toHaveText('Choose the effect for photo 3');
  await page.locator('.effect-tile[data-id="thermal"]').click();
  await expect(page.locator('.plan-name').nth(2)).toHaveText('Thermal');
  await expect(page.locator('.plan-name').nth(0)).toHaveText('Normal');
  await expect(page.locator('#stripPlan')).toHaveClass(/is-mixed/);
  // Choosing a photo's effect never changes the live effect.
  await expect(page.locator('#btnEffects')).not.toHaveClass(/is-on/);

  const seen: string[] = [];
  await page.exposeFunction('sawEffect', (id: string) => seen.push(id));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const cur = document.querySelector('.plan-slot.is-current .plan-name');
      if (cur) (window as unknown as { sawEffect: (s: string) => void }).sawEffect(cur.textContent ?? '');
    }).observe(document.getElementById('stripPlan')!, { childList: true, subtree: true });
  });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  expect(seen).toContain('Thermal');
  expect(await page.locator('#shutterHint').textContent()).toBe('Tap for four photos'); // back to Normal
  await page.keyboard.press('Escape'); // Escape saves; photos are never lost by accident
  await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
});

test('Shuffle gives four different effects; the link button makes them the same again', async ({ page }) => {
  await open(page, { countdownSeconds: 1 });
  await page.getByRole('button', { name: 'Shuffle effects' }).click();
  const names = await page.locator('.plan-name').allInnerTexts();
  expect(new Set(names).size).toBe(4);
  expect(names).not.toContain('Normal');
  await page.getByRole('button', { name: 'Same effect for all four' }).click();
  expect(new Set(await page.locator('.plan-name').allInnerTexts())).toEqual(new Set(['Normal']));
});

test('Escape stops a countdown and no photo is taken', async ({ page }) => {
  await open(page, { countdownSeconds: 3 });
  await page.locator('#shutter').click();
  await expect(page.locator('#toolbar')).toHaveClass(/is-counting/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#toolbar')).not.toHaveClass(/is-counting/);
  await expect(page.locator('#shutter')).toBeEnabled();
  await page.waitForTimeout(3500);
  await expect(page.locator('.thumb')).toHaveCount(0);
  await expect(page.locator('#stripSheet')).not.toHaveClass(/is-open/);
});

test('first launch shows Mac-style tips; Skip puts them away for good', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  const tip = page.locator('#tipPopover');
  await expect(tip).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#tipTitle')).toHaveText('Take a Picture');
  await page.locator('#tipNext').click();
  await expect(page.locator('#tipStep')).toHaveText('2 of 4');
  await page.locator('#tipSkip').click();
  await expect(tip).toBeHidden();
  await page.reload();
  await expectLive(page);
  await page.waitForTimeout(1500);
  await expect(tip).toBeHidden();
});

test('messages and controls use drawn icons, never emoji', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ tipsSeen: true })));
  await page.goto('/app/');
  await expectLive(page);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25B6}\u{2715}]/u);
  await page.locator('#btnSettings').click();
  await expect(page.locator('#settingsPanel [data-close] svg')).toHaveCount(1);
  await expect(page.locator('.shortcut-list kbd').first()).toHaveText('Space');
});

test('a tall strip fits whole when you view it', async ({ page }) => {
  await open(page, { countdownSeconds: 0, stripLayout: 'strip' });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.locator('#sheetSave').click();
  await expect(page.locator('.thumb img')).toHaveCount(1, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.locator('.thumb').first().click();
  await expect(page.locator('#review')).toBeVisible();
  const fit = await page.evaluate(() => {
    const box = document.getElementById('review')!.getBoundingClientRect();
    const img = document.getElementById('reviewImage') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    return { inside: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, loaded: img.naturalHeight > img.naturalWidth * 2 };
  });
  expect(fit).toEqual({ inside: true, loaded: true });
});

test('the print can carry a caption, the date and the Photoshoot mark — or none of them', async ({ page }) => {
  await open(page, { countdownSeconds: 0, stripLayout: 'strip' });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  const ratio = () => page.locator('#sheetPreview').evaluate(async (img: HTMLImageElement) => {
    await img.decode().catch(() => undefined);
    return img.naturalHeight / img.naturalWidth;
  });
  await page.locator('#tabText').click();
  await expect(page.locator('#paneText')).toBeVisible();
  await expect(page.locator('#paneLayout')).toBeHidden();
  await expect(page.locator('#sheetName')).toHaveAttribute('aria-pressed', 'true');
  const withFooter = await ratio();
  await page.locator('#sheetName').click();
  await page.locator('#sheetDate').click();
  await expect(page.locator('#sheetDate')).toHaveAttribute('aria-pressed', 'false');
  const bare = await ratio();
  expect(bare).toBeLessThan(withFooter);
  await page.locator('#sheetCaption').fill('Sara turns 30');
  await page.keyboard.press('ArrowLeft'); // moves the cursor; must not change the layout
  await page.waitForTimeout(300);
  expect(await ratio()).toBeGreaterThan(bare);
  await page.locator('#tabLayout').click();
  await expect(page.locator('[data-layout="strip"]')).toHaveClass(/is-active/);
  await page.locator('#sheetRounded').click();
  await page.locator('[data-frame="blush"]').click();
  await page.locator('#tabText').click();
  await page.locator('#sheetCaption').press('Enter'); // Return saves, even from the caption
  await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('photoshoot.settings') ?? '{}'));
  expect(saved).toMatchObject({ stripShowName: false, stripShowDate: false, stripCaption: 'Sara turns 30', stripRounded: true, stripFrame: 'blush' });
});

test('caption text can be fully styled: font, size, alignment and colour', async ({ page }) => {
  await open(page, { countdownSeconds: 0, stripLayout: 'strip', stripCaption: 'Hi' });
  await page.locator('#shutter').click();
  await expect(page.locator('#stripSheet')).toHaveClass(/is-open/, { timeout: 60000 });
  await page.locator('#tabText').click();
  await expect(page.locator('.sheet-font')).toHaveCount(5);
  const before = await page.locator('#sheetPreview').getAttribute('src');
  await page.locator('[data-font="typewriter"]').click();
  await page.locator('[data-size="l"]').click();
  await page.locator('[data-align="left"]').click();
  await page.locator('[data-ink="red"]').click();
  for (const sel of ['[data-font="typewriter"]', '[data-size="l"]', '[data-align="left"]', '[data-ink="red"]']) {
    await expect(page.locator(sel)).toHaveAttribute('aria-checked', 'true');
  }
  expect(await page.locator('#sheetPreview').getAttribute('src')).not.toBe(before);
  await page.locator('#sheetSave').click();
  await expect(page.locator('.thumb')).toHaveCount(1, { timeout: 60000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('photoshoot.settings') ?? '{}'));
  expect(saved).toMatchObject({ stripFont: 'typewriter', stripTextSize: 'l', stripAlign: 'left', stripInk: 'red' });
});

test('switching to four photos the first time runs its tutorial; ? replays it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('photoshoot.settings', JSON.stringify({ tipsSeen: true })));
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('[data-mode="strip"]').click();
  const tip = page.locator('#tipPopover');
  await expect(tip).toBeVisible();
  await expect(page.locator('#tipTitle')).toHaveText('Four Photos in a Row');
  await expect(page.locator('.tip-art .tip-cd')).toHaveCount(4);
  await page.locator('#tipNext').click();
  await expect(page.locator('#tipTitle')).toHaveText('A Look for Every Photo');
  await expect(tip).toHaveAttribute('data-side', 'bottom');
  await page.locator('#tipNext').click();
  await page.locator('#tipNext').click();
  await expect(page.locator('#tipTitle')).toHaveText('Then Make Your Print');
  await expect(page.locator('.tip-art .tip-layout')).toHaveCount(4);
  await page.locator('#tipNext').click(); // Done
  await expect(tip).toBeHidden();
  await page.locator('[data-mode="single"]').click();
  await page.locator('[data-mode="strip"]').click();
  await page.waitForTimeout(400);
  await expect(tip).toBeHidden(); // only the first time
  await page.getByRole('button', { name: 'How four photos work' }).click();
  await expect(page.locator('#tipTitle')).toHaveText('Four Photos in a Row');
});
