import { expect, type Page } from '@playwright/test';

// Reads pixels back from a canvas or image the same way a capture does, so a
// renderer that "works" but presents black fails here.
export function hasRealPixels(el: HTMLCanvasElement | HTMLImageElement): boolean {
  const copy = document.createElement('canvas');
  copy.width = 16;
  copy.height = 16;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(el, 0, 0, 16, 16);
  const bytes = ctx.getImageData(0, 0, 16, 16).data;
  return bytes.some((value, i) => i % 4 !== 3 && value > 30);
}

/** The camera is live: no message, shutter enabled, real pixels in the viewfinder. */
export async function expectLive(page: Page): Promise<void> {
  await expect(page.locator('#vfMessage')).toBeHidden();
  await expect(page.locator('#shutter')).toBeEnabled();
  await expect.poll(() => page.locator('#glCanvas').evaluate(hasRealPixels)).toBe(true);
}
