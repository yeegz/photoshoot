// The landing page shows what Photoshoot makes: every image is rendered by
// the app's own GLSL effects onto its own backdrops (or, if the visitor opts
// in, their camera). No replica app window, nothing fetched from third parties.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hasRealPixels } from './live';

const version = (JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string })
  .version;

test('the landing is first-party: bundle loads, version injected, no webfont', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-landing', 'ready');
  await expect(page.locator('body')).not.toContainText('{{version}}');
  await expect(page.locator('#getWin')).toContainText(version);
  expect(await page.locator('link[rel="stylesheet"][href^="https://"]').count()).toBe(0);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).not.toContain('Archivo');
  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  expect(errors).toEqual([]);
});

test('no replica app window on the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pb, .pb')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Camera is off');
});

test('the hero print is a real 2x2 sheet rendered by the effect shaders', async ({ page }) => {
  await page.goto('/');
  const sheet = page.locator('#heroSheet');
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(hasRealPixels)).toBe(true);
  const ratio = await sheet.evaluate((c: HTMLCanvasElement) => c.width / c.height);
  expect(ratio).toBeGreaterThan(1);
});

test('the effects wall shows all 17 effects, each rendered and named', async ({ page }) => {
  await page.goto('/');
  const tiles = page.locator('#wall .wall-tile');
  await expect(tiles).toHaveCount(17);
  for (const t of await tiles.all()) {
    await expect.poll(() => t.locator('canvas').evaluate(hasRealPixels)).toBe(true);
    expect((await t.locator('figcaption').innerText()).trim().length).toBeGreaterThan(0);
  }
  await expect(tiles.filter({ hasText: 'Twirl' })).toHaveCount(1);
  const grayscale = await tiles.filter({ hasText: 'Black & White' }).locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - pixels[i + 1]) > 1 || Math.abs(pixels[i + 1] - pixels[i + 2]) > 1) return false;
    }
    return true;
  });
  expect(grayscale).toBe(true);
});

test('the wall can switch to the visitor camera and back', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#wall canvas').first();
  const original = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera', { timeout: 30000 });
  await expect(page.locator('#wallCamera')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(original);
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(original);
});

test('a denied camera leaves the sample and says why', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wallNote')).toContainText('Camera access');
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
});

for (const width of [320, 390, 768, 1280]) {
  test(`the showcase is readable without clipped content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const boxes = await page.locator('.hero-copy, .print-front, .wall-tile, .backdrop, .chip, .pill').evaluateAll(
      (elements) => elements.map((el) => {
        const { left, right, width, height } = el.getBoundingClientRect();
        return { left, right, width, height };
      })
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
    const [first, second] = await page.locator('.wall-tile').evaluateAll((tiles) =>
      tiles.slice(0, 2).map((tile) => ({ x: tile.getBoundingClientRect().x, y: tile.getBoundingClientRect().y }))
    );
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.x);
  });
}

test('without WebGL the pictures remain visible and the camera is not offered', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2') return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.locator('#wallCamera')).toBeDisabled();
  await expect(page.locator('#wallNote')).toContainText('effects');
  await expect.poll(() => page.locator('#heroSheet').evaluate(hasRealPixels)).toBe(true);
  await expect(page.locator('#backdropGrid figure')).toHaveCount(6);
});

test('a missing sample photo does not break the camera demo', async ({ page }) => {
  await page.route('**/photobooth-sample-*.jpg', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-landing', 'ready');
  await expect.poll(() => page.locator('#heroSheet').evaluate(hasRealPixels)).toBe(true);
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'backdrops');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
});

test('returning while the sample loads cannot start an uninitialized camera demo', async ({ page }) => {
  let releaseSample: (() => Promise<void>) | undefined;
  await page.route('**/photobooth-sample-*.jpg', (route) => {
    releaseSample = () => route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#wallCamera')).toBeDisabled();
  expect(releaseSample).toBeDefined();
  await releaseSample!();
  await expect(page.locator('html')).toHaveAttribute('data-landing', 'ready');
  await expect(page.locator('#wallCamera')).toBeEnabled();
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
});

test('failed shaders show the live camera with an unavailable label', async ({ page }) => {
  await page.addInitScript(() => {
    const getShaderParameter = WebGL2RenderingContext.prototype.getShaderParameter;
    WebGL2RenderingContext.prototype.getShaderParameter = function (shader, parameter) {
      if (parameter === this.COMPILE_STATUS) return false;
      return getShaderParameter.call(this, shader, parameter);
    };
  });
  await page.goto('/');
  const tile = page.locator('.wall-tile').first();
  const canvas = tile.locator('canvas');
  const original = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(original);
  await expect(tile.locator('figcaption')).toContainText('unavailable');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
});

test('leaving during camera permission releases the late stream', async ({ page }) => {
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const state = window as unknown as { testStream: MediaStream; releaseCamera: () => void };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.testStream = await acquire(constraints);
      await new Promise<void>((resolve) => { state.releaseCamera = resolve; });
      return state.testStream;
    };
  });
  await page.goto('/');
  await page.locator('#wallCamera').click();
  await page.waitForFunction(() => 'releaseCamera' in window);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    (window as unknown as { releaseCamera: () => void }).releaseCamera();
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { testStream: MediaStream }).testStream.getTracks().every((track) => track.readyState === 'ended')
  )).toBe(true);
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
  await expect(page.locator('#wallCamera')).toBeEnabled();
});

test('a disconnected camera returns to the sample and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await acquire(constraints);
      (window as unknown as { testStream: MediaStream }).testStream = stream;
      return stream;
    };
  });
  await page.goto('/');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
  await page.evaluate(() => {
    const track = (window as unknown as { testStream: MediaStream }).testStream.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
  await expect(page.locator('#wallCamera')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
});

test('a graphics reset releases the camera and restores the showcase', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      const context = Reflect.apply(getContext, this, [type, ...args]);
      if (type === 'webgl2') (window as unknown as { testGL: WebGL2RenderingContext }).testGL = context;
      return context;
    } as typeof getContext;
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await acquire(constraints);
      (window as unknown as { testStream: MediaStream }).testStream = stream;
      return stream;
    };
  });
  await page.goto('/');
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
  await page.evaluate(() => {
    const state = window as unknown as { testGL: WebGL2RenderingContext; testReset: WEBGL_lose_context };
    state.testReset = state.testGL.getExtension('WEBGL_lose_context')!;
    state.testReset.loseContext();
  });
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'sample');
  await expect(page.locator('#wallCamera')).toBeDisabled();
  expect(await page.evaluate(() =>
    (window as unknown as { testStream: MediaStream }).testStream.getTracks().every((track) => track.readyState === 'ended')
  )).toBe(true);
  await expect.poll(() => page.locator('#heroSheet').evaluate(hasRealPixels)).toBe(true);
  await page.evaluate(() => (window as unknown as { testReset: WEBGL_lose_context }).testReset.restoreContext());
  await expect(page.locator('#wallCamera')).toBeEnabled();
  await page.locator('#wallCamera').click();
  await expect(page.locator('#wall')).toHaveAttribute('data-source', 'camera');
});

test('reduced motion keeps navigation and buttons still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  expect(await page.locator('#wallCamera').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('themes and get sections are present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#themes .chip')).toHaveCount(6);
  await expect(page.locator('#themes .chip').first()).toContainText('Photo Booth');
  await expect(page.locator('#getWin')).toContainText('installer');
});
