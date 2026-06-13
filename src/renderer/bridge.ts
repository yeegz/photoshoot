// Typed access to the preload bridge. The renderer only ever talks to main
// through this object — there is no other privileged surface.

import type { PhotoshootBridge } from '../shared/ipc-contract';

declare global {
  interface Window {
    photoshoot: PhotoshootBridge;
  }
}

export const api: PhotoshootBridge = window.photoshoot;
