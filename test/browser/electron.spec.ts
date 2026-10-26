import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

// PHOTOSHOOT_EXE points at a packaged build (e.g. release/win-unpacked/Photoshoot.exe)
// so CI exercises the real app.asar, not just the unpacked dist folder.
const fakeCamera = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const launchOptions = () =>
  process.env.PHOTOSHOOT_EXE
    ? { executablePath: process.env.PHOTOSHOOT_EXE, args: fakeCamera }
    : { args: [...fakeCamera, '.'], env: { ...process.env, NODE_ENV: 'production' } };

// Playwright attaches a Node debugger to Electron, and Node waits for that
// debugger to disconnect before exiting, so close() can stall in tests (never
// for users, who have no debugger attached). Bound it, then kill.
async function closeApp(desktop: ElectronApplication): Promise<void> {
  const proc = desktop.process();
  await Promise.race([desktop.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10000))]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
}

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
    expect(['available', 'current', 'unavailable', 'downloading', 'ready']).toContain(update.status);
  } finally {
    await closeApp(desktop);
  }
});

test('desktop app runs person segmentation from its app:// origin', async () => {
  test.setTimeout(60000);
  const desktop = await electron.launch(launchOptions());
  try {
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await expect(page.locator('#shutter')).toBeEnabled({ timeout: 15000 });
    // Without WebGL2 (e.g. Electron under xvfb on Linux CI) the app runs in
    // basic camera mode, where effects and backdrops are intentionally off.
    // Windows CI runs this test for real against the packaged app.
    // Settle first: the app decides basic mode during start-up.
    await page.waitForTimeout(1500);
    const basicMode = await page.evaluate(() => {
      const fx = document.getElementById('btnEffects') as HTMLButtonElement;
      return fx.disabled || /WebGL2/.test(fx.title);
    });
    test.skip(basicMode, 'No WebGL2 here: basic camera mode has no backdrops.');
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
    await closeApp(desktop);
  }
});

// Regression: after a photo was reviewed, reopening Effects showed an open but
// invisible grid — a black window over the camera until the app was restarted.
test('desktop app: effect, photo, review, back, Effects — the grid is visible every time', async () => {
  test.setTimeout(180000);
  const desktop = await electron.launch(launchOptions());
  try {
    await desktop.firstWindow();
    await expect.poll(() => desktop.windows().some((w) => w.url().startsWith('app://'))).toBe(true);
    const page = desktop.windows().find((w) => w.url().startsWith('app://'))!;
    await expect(page.locator('#shutter')).toBeEnabled({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const basicMode = await page.evaluate(() => (document.getElementById('btnEffects') as HTMLButtonElement).disabled);
    test.skip(basicMode, 'No WebGL2 here: basic camera mode has no effects.');
    await page.evaluate(() => (window as unknown as { photoshoot: { setSettings(p: object): Promise<unknown> } }).photoshoot.setSettings({ tipsSeen: true }));
    // First-page effects: the failure never depended on which effect was used.
    for (const id of ['comic', 'thermal', 'sepia', 'xray']) {
      await page.locator('#btnEffects').click();
      const tile = page.locator(`.effect-tile[data-id="${id}"]`);
      await expect(page.locator('#effectsGrid')).toHaveCSS('visibility', 'visible');
      await tile.click({ timeout: 10000 });
      await page.waitForTimeout(500);
      await page.locator('#shutter').click({ modifiers: ['Alt'] });
      await expect(page.locator('#shutter')).toBeEnabled({ timeout: 20000 });
      await page.waitForTimeout(400);
      await page.locator('.thumb').last().click();
      await expect(page.locator('#review')).toBeVisible();
      await page.locator('#review').click();
      await expect(page.locator('#review')).toBeHidden();
    }
  } finally {
    await closeApp(desktop);
  }
});
