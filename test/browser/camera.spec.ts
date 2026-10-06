import { expect, test } from '@playwright/test';

async function expectLive(page: import('@playwright/test').Page) {
  await expect(page.locator('#vfMessage')).toBeHidden();
  await expect(page.locator('#shutter')).toBeEnabled();
  await expect.poll(() => page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = 16; copy.height = 16;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 16, 16);
    const bytes = ctx.getImageData(0, 0, 16, 16).data;
    return bytes.some((value, i) => i % 4 !== 3 && value > 30);
  })).toBe(true);
}

test('camera produces real pixels and saves a photo to the gallery', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 15000 });
});

test('camera and photo capture still work without WebGL2', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      return kind === 'webgl2' ? null : original.call(this, kind as '2d', ...args);
    } as typeof original;
  });
  await page.goto('/app/');
  await expectLive(page);
  await expect(page.locator('#btnEffects')).toBeDisabled();
  await page.locator('#shutter').click();
  await expect(page.locator('#trayScroll img').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#btnEffects')).toBeDisabled();
  await expect(page.locator('#btnBackgrounds')).toBeDisabled();
});

test('blocked playback shows a recovery action instead of a black live preview', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  });
  await page.goto('/app/');
  await expect(page.locator('#vfMessageTitle')).toHaveText('Camera preview could not start');
  await expect(page.locator('#vfMessageAction')).toHaveText('Try Again');
  await expect(page.locator('#shutter')).toBeDisabled();
});

test('unavailable preferred settings fall back to basic camera capture', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.video !== true) return Promise.reject(new DOMException('Unsupported settings', 'OverconstrainedError'));
      return original(constraints);
    };
  });
  await page.goto('/app/');
  await expectLive(page);
});

test('a graphics context reset recovers the preview and dismisses the reset message', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 500);
  });
  await expect(page.locator('#vfMessageTitle')).toHaveText('Graphics reset');
  await expectLive(page);
});

test('a graphics reset stops an active recording and saves it', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('[data-mode="video"]').click();
  await page.locator('#shutter').click();
  await expect(page.locator('#recBadge')).toBeVisible();
  await expect(page.locator('#recTime')).toHaveText('0:01');
  await page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 500);
  });
  await expect(page.locator('#recBadge')).toBeHidden();
  await expect(page.locator('#shutter')).not.toHaveClass(/is-recording/);
  await expect(page.locator('#trayScroll .thumb').first()).toBeVisible();
  await expectLive(page);
});

test('a graphics reset during countdown cancels the photo and keeps capture disabled', async ({ page }) => {
  await page.goto('/app/');
  await expectLive(page);
  await page.locator('#shutter').click();
  await expect(page.locator('#toolbar')).toHaveClass(/is-counting/);
  await page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('#toolbar')).not.toHaveClass(/is-counting/);
  await expect(page.locator('#shutter')).toBeDisabled();
  await expect(page.locator('#trayScroll .thumb')).toHaveCount(0);
});

test('camera acquisition cannot clear a graphics reset that happened while it was pending', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      return new Promise((resolve) => {
        Object.assign(window, { releaseCamera: () => resolve(stream) });
      });
    };
  });
  await page.goto('/app/');
  await page.waitForFunction(() => 'releaseCamera' in window);
  await page.locator('#glCanvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('#vfMessageTitle')).toHaveText('Graphics reset');
  await page.evaluate(() => (window as unknown as { releaseCamera: () => void }).releaseCamera());
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#vfMessageTitle')).toHaveText('Graphics reset');
  await expect(page.locator('#shutter')).toBeDisabled();
});
