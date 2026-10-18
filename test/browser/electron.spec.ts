import { _electron as electron, expect, test } from '@playwright/test';

// PHOTOSHOOT_EXE points at a packaged build (e.g. release/win-unpacked/Photoshoot.exe)
// so CI exercises the real app.asar, not just the unpacked dist folder.
const fakeCamera = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const launchOptions = () =>
  process.env.PHOTOSHOOT_EXE
    ? { executablePath: process.env.PHOTOSHOOT_EXE, args: fakeCamera }
    : { args: [...fakeCamera, '.'], env: { ...process.env, NODE_ENV: 'production' } };

test('desktop app acquires a camera and renders pixels through its secure app origin', async () => {
  const desktop = await electron.launch(launchOptions());
  try {
    const page = await desktop.firstWindow();
    await expect(page).toHaveURL('app://photoshoot/index.html');
    await expect(page.locator('#vfMessage')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#shutter')).toBeEnabled();
    await expect.poll(() => page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = 16; copy.height = 16;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0, 16, 16);
      return ctx.getImageData(0, 0, 16, 16).data.some((v, i) => i % 4 !== 3 && v > 30);
    })).toBe(true);
    // The update check runs in the main process over IPC. GitHub may rate-limit
    // CI, so any well-formed answer proves the wiring.
    const update = await page.evaluate(() =>
      (window as unknown as { photoshoot: { checkForUpdate(): Promise<{ status: string }> } }).photoshoot.checkForUpdate()
    );
    expect(['available', 'current', 'unavailable']).toContain(update.status);
  } finally {
    await desktop.close();
  }
});

test('desktop app runs person segmentation from its app:// origin', async () => {
  const desktop = await electron.launch(launchOptions());
  try {
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await expect(page.locator('#shutter')).toBeEnabled({ timeout: 15000 });
    await page.locator('#btnEffects').click();
    await page.keyboard.press('End');
    await page.locator('[data-backdrop="studio"]').click();
    // The worker loads MediaPipe and the model over app://; success = backdrop active.
    await expect(page.locator('#btnBackgrounds')).toHaveClass(/is-on/, { timeout: 20000 });
    await expect(page.locator('#bgGuide')).toBeHidden({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#btnBackgrounds')).toHaveClass(/is-on/);
    expect(errors.filter((e) => /person detection|worker|importScripts/i.test(e))).toEqual([]);
  } finally {
    await desktop.close();
  }
});
