// Classic worker bundle: MediaPipe's WASM loader uses importScripts. Both the
// loader and model are resolved against the app's URL, including file:// builds.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { SegmenterRequest, SegmenterResponse } from './personSegmentationProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let segmenter: ImageSegmenter | null = null;
const sample = new OffscreenCanvas(1, 1);
const sampleContext = sample.getContext('2d')!;

function reply(message: SegmenterResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

scope.onmessage = async ({ data }: MessageEvent<SegmenterRequest>) => {
  try {
    if (data.type === 'init') {
      const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', data.baseUrl).href);
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: new URL('mediapipe/selfie_segmenter.tflite', data.baseUrl).href,
          delegate: 'CPU',
        },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      reply({ type: 'ready' });
    } else {
      if (!segmenter) throw new Error('Person model is not ready.');
      // The network itself uses 256px input. Bound preprocessing, output mask
      // transfer and the UI's alpha conversion while preserving the full frame.
      const scale = Math.min(1, 384 / Math.max(data.frame.width, data.frame.height));
      const width = Math.max(1, Math.round(data.frame.width * scale));
      const height = Math.max(1, Math.round(data.frame.height * scale));
      if (sample.width !== width || sample.height !== height) {
        sample.width = width;
        sample.height = height;
      }
      sampleContext.drawImage(data.frame, 0, 0, width, height);
      segmenter.segmentForVideo(sample, data.timestamp, (result) => {
        // The bundled binary sigmoid model produces one person confidence mask.
        // Also accept the two-category representation used by other task builds.
        const masks = result.confidenceMasks;
        const person = masks?.[masks.length > 1 ? 1 : 0];
        if (!person) throw new Error('Person model returned no mask.');
        const confidence = person.getAsFloat32Array().slice();
        reply({
          type: 'result',
          frame: data.frame,
          mask: { width: person.width, height: person.height, confidence },
        }, [data.frame, confidence.buffer]);
      });
    }
  } catch (error) {
    if (data.type === 'frame') data.frame.close();
    console.warn('[photoshoot] person detection failed:', error);
    reply({ type: 'error', message: data.type === 'init'
      ? 'Person detection could not load. Please try again or choose Normal.'
      : 'Person detection stopped. Please try selecting your background again.' });
  }
};
