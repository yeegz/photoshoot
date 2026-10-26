// Face effects land on the face. Regression: landmarks were passed with y
// top-down while shaders sample bottom-up (and x was mirrored twice), so Bug
// Out warped the chin or the other side of the frame. A real portrait stands
// in for the camera; the changed pixels must sit around her eyes.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expectLive } from './live';

test.describe.configure({ timeout: 180000 });

for (const mirror of [false, true]) {
  test(`Bug Out warps the eyes${mirror ? ' (mirrored preview)' : ''}`, async ({ page }) => {
    await page.route('**/__face.jpg', (r) => r.fulfill({ body: readFileSync('web/landing/assets/photobooth-sample.jpg'), contentType: 'image/jpeg' }));
    await page.addInitScript((m) => {
      localStorage.setItem('photoshoot.settings', JSON.stringify({ countdownSeconds: 0, tipsSeen: true, mirror: m }));
      navigator.mediaDevices.getUserMedia = async () => {
        const img = new Image();
        img.src = '/__face.jpg';
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        const ctx = c.getContext('2d')!;
        const draw = () => {
          const s = Math.max(1280 / img.width, 720 / img.height);
          ctx.drawImage(img, (1280 - img.width * s) / 2, (720 - img.height * s) / 2, img.width * s, img.height * s);
          requestAnimationFrame(draw);
        };
        draw();
        return c.captureStream(30);
      };
    }, mirror);
    await page.goto('/app/');
    await expectLive(page);
    const snap = () => page.evaluate(() => {
      const src = document.getElementById('glCanvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      c.getContext('2d')!.drawImage(src, 0, 0, 320, 180);
      return Array.from(c.getContext('2d')!.getImageData(0, 0, 320, 180).data);
    });
    const before = await snap();
    await page.locator('#btnEffects').click();
    for (let i = 0; i < 2; i++) {
      await page.waitForTimeout(450);
      await page.keyboard.press('ArrowRight');
    }
    await page.locator('.effect-tile[data-id="bugeyes"]').click();
    let box = { minX: 1, maxX: 0, minY: 1, maxY: 0, n: 0 };
    await expect.poll(async () => {
      const after = await snap();
      box = { minX: 1, maxX: 0, minY: 1, maxY: 0, n: 0 };
      for (let i = 0; i < after.length; i += 4) {
        const d = Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]);
        if (d < 75) continue;
        const x = ((i / 4) % 320) / 320;
        const y = Math.floor(i / 4 / 320) / 180;
        box = { minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minY: Math.min(box.minY, y), maxY: Math.max(box.maxY, y), n: box.n + 1 };
      }
      return box.n;
    }, { timeout: 60000 }).toBeGreaterThan(20);
    const cy = (box.minY + box.maxY) / 2;
    const cx = (box.minX + box.maxX) / 2;
    // Her eyes sit about a third of the way down, in the left half of the photo.
    expect(cy).toBeGreaterThan(0.15);
    expect(cy).toBeLessThan(0.5);
    if (mirror) expect(cx).toBeGreaterThan(0.5);
    else expect(cx).toBeLessThan(0.5);
  });
}
