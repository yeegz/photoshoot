import { describe, expect, it } from 'vitest';
import { encodeFrame, FRAME_QUALITIES } from '../../src/renderer/virtualCameraEncode';

// A canvas stand-in whose JPEG size shrinks with quality, like real busy frames.
function fakeCanvas(bytesAt: (q: number) => number | null) {
  const asked: number[] = [];
  return {
    asked,
    toBlob(cb: (b: Blob | null) => void, _type: string, q: number) {
      asked.push(q);
      const n = bytesAt(q);
      cb(n === null ? null : new Blob([new Uint8Array(n)]));
    },
  };
}

describe('encodeFrame', () => {
  it('uses the best quality that fits', async () => {
    const c = fakeCanvas(() => 100);
    expect((await encodeFrame(c, 512))?.size).toBe(100);
    expect(c.asked).toEqual([FRAME_QUALITIES[0]]);
  });

  it('steps quality down for a busy frame instead of failing', async () => {
    const c = fakeCanvas((q) => Math.round(q * 1000)); // 850, 700, 550, 400 …
    const blob = await encodeFrame(c, 600);
    expect(blob?.size).toBeLessThanOrEqual(600);
    expect(c.asked.length).toBeGreaterThan(1);
  });

  it('returns null (drop this frame) when nothing fits or encoding fails', async () => {
    expect(await encodeFrame(fakeCanvas(() => 10_000), 512)).toBeNull();
    expect(await encodeFrame(fakeCanvas(() => null), 512)).toBeNull();
  });
});
