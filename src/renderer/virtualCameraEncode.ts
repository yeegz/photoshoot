// JPEG encoding for virtual-camera frames. A busy effect (halftone, grain,
// thermal) can produce a large JPEG; step the quality down rather than end the
// session, and drop a frame only if even the lowest quality is too big.

export const FRAME_QUALITIES = [0.85, 0.7, 0.55, 0.4] as const;

interface Encodable {
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

export async function encodeFrame(canvas: Encodable, maxBytes: number): Promise<Blob | null> {
  for (const quality of FRAME_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return null;
    if (blob.size <= maxBytes) return blob;
  }
  return null;
}
