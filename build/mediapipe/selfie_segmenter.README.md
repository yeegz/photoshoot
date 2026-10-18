# Bundled person segmentation model

- File: `selfie_segmenter.tflite`
- Publisher: Google / MediaPipe
- Model: SelfieSegmenter (square), float16, version 1; input 256 × 256 RGB.
- Downloaded: 2026-10-17
- Pinned source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
- SHA-256: `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`
- Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- Model card and license declaration: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf
- License: Apache License 2.0; see `selfie_segmenter.LICENSE`.

The packaged app loads this file and the MediaPipe Tasks Vision WASM files from
its own installation/origin. Camera images and confidence masks remain local.
The model separates person pixels from background; it does not recognize identity.
Fine hair/fingers, fast motion, low light and distant people can reduce accuracy.
