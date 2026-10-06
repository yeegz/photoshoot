import { _electron as electron, expect, test } from '@playwright/test';

test('desktop app acquires a camera and renders pixels through its secure app origin', async () => {
  const desktop = await electron.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '.'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
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
  } finally {
    await desktop.close();
  }
});
