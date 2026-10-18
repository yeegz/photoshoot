export interface PersonMask {
  width: number;
  height: number;
  confidence: Float32Array;
}

export interface SegmentedFrame {
  frame: ImageBitmap;
  mask: PersonMask;
}

export type SegmenterRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'frame'; frame: ImageBitmap; timestamp: number };

export type SegmenterResponse =
  | { type: 'ready' }
  | ({ type: 'result' } & SegmentedFrame)
  | { type: 'error'; message: string };
