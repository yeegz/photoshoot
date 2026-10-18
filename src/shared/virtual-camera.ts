/** The OBS password is passed directly to main and is never part of saved settings. */
export interface VirtualCameraConfig {
  port: number;
  password: string;
}

export type VirtualCameraState = 'unsupported' | 'stopped' | 'connecting' | 'live' | 'error';

export interface VirtualCameraStatus {
  supported: boolean;
  state: VirtualCameraState;
  message: string;
  sceneName?: string;
}

export const VIRTUAL_CAMERA_MAX_WIDTH = 1280;
export const VIRTUAL_CAMERA_MAX_HEIGHT = 720;
export const VIRTUAL_CAMERA_MAX_FPS = 15;
export const VIRTUAL_CAMERA_MAX_FRAME_BYTES = 512 * 1024;
