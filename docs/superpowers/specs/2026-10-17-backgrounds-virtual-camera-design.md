# Useful backgrounds and Windows virtual camera

## User requirements

Replace the current decorative backdrops and empty-scene capture workflow with actual human/body segmentation, background blur and useful replacements. Make the designs cohesive with the restrained app. Provide Photoshoot's processed output as a virtual webcam on Windows. The user explicitly selected Windows 10 and 11 support even if OBS is required, and asked that OBS's requirement, setup steps and use in Discord/other apps be clear and verified.

## Implementation choices

These are builder choices within the user's requested scope:

- Use the existing MediaPipe Tasks Vision dependency with its locally bundled selfie/person segmentation model. Infer the person mask in a worker when practical, with bounded frame submission and soft edges. No identity recognition; this is pixel-level person segmentation. No camera or mask data leaves the machine.
- Replace the reference-photo countdown entirely. Modes: none, adjustable blur, restrained neutral studio backgrounds, a useful photographic interior and a local custom image. Reuse the existing background picker and effects pipeline. Saved photos, video and virtual camera all consume the final processed canvas.
- Keep person processing local, lazy-load the model, expose loading/failure, cancel pending activation on stop/reset/camera change. Never leave stale frame hooks, masks or streams. The blur composite keeps foreground sharp and blurs only the background.
- Use OBS Studio 28+ on Windows 10/11 for the virtual camera device. Photoshoot is not a kernel driver and does not pretend to be a standalone virtual camera. Browser builds explain that the desktop Windows app plus OBS is required.
- Electron main process serves a token-protected loopback-only MJPEG feed and controls local OBS WebSocket v5. Renderer sends capped JPEG frames of the final canvas through a typed preload/IPC API. Limit resolution/frame rate, queue depth and clients. Stop output on disconnect, application exit or source loss; show a neutral frame instead of a stale private image.
- Setup UI states plainly: install OBS; enable Tools > WebSocket Server Settings; keep authentication on; enter port/password in Photoshoot; click Start. Password stays in memory only. Configure a dedicated Photoshoot OBS scene and browser source, then start OBS Virtual Camera. Do not disrupt an existing stream/recording or take over an already-active virtual camera. Restore the prior scene on stop when safe.
- App instructions cover Discord Settings > Voice & Video > Camera > OBS Virtual Camera, plus Zoom/Teams camera selection, and that microphone selection remains separate. OBS must remain running. No claim of universal client compatibility.

## Acceptance

- A real bundled model separates person pixels from background on a portrait fixture, with measurable foreground/background confidence.
- Blur and replacement compose from that mask; stop/reselect/camera reset and model failure recover correctly. Custom image type/size limits and failure handling are covered.
- OBS connection/authentication/request failures, protected loopback feed, frame output and cleanup have meaningful tests using real local transport.
- A real OBS smoke test should verify configured source pixels and virtual-camera start/stop where the environment supports it. A platform limitation must be reported, never silently counted as a pass.
- UI clearly names OBS as required and shows actionable setup/errors. No unsupported Start button on web builds.
- Full existing verification remains green; Windows CI/package/live probe run; deploy the web app and publish the updated Windows version when ready.

## Sources

- MediaPipe Image Segmenter web guide: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js
- Model guide: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- OBS Virtual Camera guide: https://obsproject.com/kb/virtual-camera-guide
- OBS WebSocket v5 protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
