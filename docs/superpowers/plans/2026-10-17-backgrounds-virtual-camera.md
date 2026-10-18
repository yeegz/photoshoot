# Backgrounds and virtual camera implementation plan

Spec: ../specs/2026-10-17-backgrounds-virtual-camera-design.md

User authorized finishing all work and explicitly added person segmentation, background blur/replacement and OBS-based Windows 10/11 virtual camera, with clear setup and real verification. Continue the existing feat/landing-showcase branch, preserving uncommitted work. No new worktree is needed: all existing changes are part of this task.

1. Complete the landing-review initialization fix and save a verified checkpoint.
2. Implement local person segmentation and automatic blur/replacement. Own backgroundReplace, new segmentation worker/client, background definitions and picker, background settings subsection, focused tests/model assets.
3. Implement OBS WebSocket client and protected loopback output service. Own new shared virtual-camera types and new main-process service/test files. Parent integrates shared IPC/preload/main cleanup.
4. Integrate user-facing virtual-camera setup/output, model/build packaging, better background art, browser fallback and docs. Parent owns shared bridge, app settings defaults/storage, main/renderer integration, build and release files.
5. Run meaningful model/compositor/transport/browser tests, independent review, full verify, real OBS integration where feasible, Windows CI/package/live probe.
6. Bump release, publish/deploy, verify production, update docs/HANDOFF with completed status, evidence, resources and any actual limitations.

Interfaces: preserve BackgroundReplacer.start(id):Promise<boolean>, stop():void, isActive():boolean. Add Settings.backgroundBlur:number (pixels, default 18, clamp 4..40); retain old bgTolerance only for stored-setting compatibility. Shared virtual camera contract is src/shared/virtual-camera.ts; parent wires PhotoshootBridge methods to it. Worker bundle/model paths will be supplied by segmentation implementer and added to both build pipelines by parent. No collaborator changes another's owned files without coordination.
