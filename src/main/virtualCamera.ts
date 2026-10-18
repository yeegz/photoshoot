import { randomBytes } from 'node:crypto';
import { VIRTUAL_CAMERA_MAX_HEIGHT, VIRTUAL_CAMERA_MAX_WIDTH, type VirtualCameraConfig, type VirtualCameraStatus } from '../shared/virtual-camera';
import { ObsClient, ObsRequestError } from './obsClient';
import { VirtualCameraFeed } from './virtualCameraFeed';

interface Session {
  client: ObsClient;
  feed: VirtualCameraFeed;
  abort: AbortController;
  scene: string;
  input: string;
  previousScene?: string;
  createdScene: boolean;
  createdInput: boolean;
  switched: boolean;
  ownsVirtualCam: boolean;
  startUncertain: boolean;
  preserveScene: boolean;
  initialFrameTimer?: ReturnType<typeof setTimeout>;
  setup?: Promise<VirtualCameraStatus>;
  ending?: Promise<void>;
  cleanup?: Promise<void>;
}

const REQUIRED_REQUESTS = ['GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus', 'GetCurrentProgramScene', 'GetVideoSettings', 'GetStudioModeEnabled', 'GetInputKindList', 'GetSceneTransitionList', 'SetSceneSceneTransitionOverride', 'CreateScene', 'CreateInput', 'SetSceneItemTransform', 'SetCurrentProgramScene', 'StartVirtualCam', 'StopVirtualCam', 'RemoveInput', 'RemoveScene'];

/** Owns only an ephemeral Photoshoot scene, source and virtual-camera session. */
export class VirtualCameraService {
  private status: VirtualCameraStatus;
  private session?: Session;
  private disposed = false;
  private readonly requestTimeoutMs: number;
  private readonly frameTimeoutMs: number;

  constructor(private readonly options: {
    platform?: string;
    requestTimeoutMs?: number;
    frameTimeoutMs?: number;
    feedConnectTimeoutMs?: number;
    onStatus?: (status: VirtualCameraStatus) => void;
  } = {}) {
    const supported = (options.platform ?? process.platform) === 'win32';
    this.status = { supported, state: supported ? 'stopped' : 'unsupported', message: supported
      ? 'Requires OBS Studio 28 or newer. Set OBS Virtual Camera output to Program (Default).'
      : 'Virtual camera requires the Windows desktop app and OBS Studio on Windows 10 or 11.' };
    this.requestTimeoutMs = options.requestTimeoutMs ?? 4000;
    this.frameTimeoutMs = options.frameTimeoutMs ?? 2500;
  }

  getStatus(): VirtualCameraStatus { return { ...this.status }; }

  private publish(state: VirtualCameraStatus['state'], message: string, sceneName?: string): void {
    this.status = { supported: this.status.supported, state, message, ...(sceneName ? { sceneName } : {}) };
    this.options.onStatus?.(this.getStatus());
  }

  async start(config: VirtualCameraConfig): Promise<VirtualCameraStatus> {
    if (!this.status.supported || this.disposed) return this.getStatus();
    if (this.session?.ending) await this.session.ending;
    if (this.disposed) return this.getStatus();
    if (this.session) return this.session.setup ?? this.getStatus();
    if (!config || typeof config.password !== 'string' || config.password.length > 1024 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      this.publish('error', 'Enter a valid OBS WebSocket port (1–65535) and password.'); return this.getStatus();
    }
    const id = randomBytes(6).toString('hex');
    const session: Session = {
      client: new ObsClient({ timeoutMs: this.requestTimeoutMs,
        onDisconnect: (error) => this.fault(session, error.message),
        onEvent: (name, data) => this.handleEvent(session, name, data) }),
      feed: new VirtualCameraFeed({ staleMs: this.frameTimeoutMs, onStale: () => this.fault(session, 'Camera frames stopped. Start your camera, then start virtual camera again.') }),
      abort: new AbortController(), scene: `Photoshoot ${id}`, input: `Photoshoot Video ${id}`,
      createdScene: false, createdInput: false, switched: false, ownsVirtualCam: false, startUncertain: false, preserveScene: false,
    };
    this.session = session;
    this.publish('connecting', 'Connecting to OBS and preparing the Photoshoot scene…');
    session.setup = this.configure(session, config).catch(async (error: unknown) => {
      if (!session.abort.signal.aborted) this.publish('error', error instanceof Error ? error.message : 'OBS setup failed. Check OBS and try again.');
      session.abort.abort();
      await this.cleanup(session);
      if (this.session === session) this.session = undefined;
      return this.getStatus();
    });
    return session.setup;
  }

  private check(session: Session): void {
    if (session.abort.signal.aborted || this.session !== session) throw new Error('Virtual camera setup cancelled.');
  }

  private async assertOutputsIdle(session: Session): Promise<void> {
    const [stream, record, virtualcam] = await Promise.all([
      session.client.request('GetStreamStatus'), session.client.request('GetRecordStatus'), session.client.request('GetVirtualCamStatus'),
    ]);
    this.check(session);
    if (stream.outputActive !== false || record.outputActive !== false) throw new Error('OBS is streaming or recording. Stop that output in OBS before starting Photoshoot virtual camera.');
    if (virtualcam.outputActive !== false) throw new Error('OBS Virtual Camera is already running. Stop it in OBS first so Photoshoot can start its own session.');
  }

  private async configure(session: Session, config: VirtualCameraConfig): Promise<VirtualCameraStatus> {
    const { client, abort } = session;
    await client.connect(config, abort.signal);
    this.check(session);
    const version = await client.request('GetVersion');
    this.check(session);
    const availableRequests = version.availableRequests;
    if (!Array.isArray(availableRequests) || REQUIRED_REQUESTS.some((request) => !availableRequests.includes(request))) throw new Error('This OBS version lacks required controls. Install OBS Studio 28 or newer with WebSocket v5.');
    await this.assertOutputsIdle(session);
    const [video, previous, studio, kinds, transitions] = await Promise.all([
      client.request('GetVideoSettings'), client.request('GetCurrentProgramScene'), client.request('GetStudioModeEnabled'), client.request('GetInputKindList'), client.request('GetSceneTransitionList'),
    ]);
    this.check(session);
    if (studio.studioModeEnabled !== false) throw new Error('Turn off Studio Mode in OBS before starting Photoshoot virtual camera, and use Program (Default) camera output.');
    if (!Array.isArray(kinds.inputKinds) || !kinds.inputKinds.includes('browser_source')) throw new Error('OBS Browser Source is unavailable. Install the standard OBS Studio build with Browser Source support.');
    const cut = Array.isArray(transitions.transitions) ? transitions.transitions.find((entry) => entry.transitionKind === 'cut_transition') : undefined;
    if (!cut || typeof cut.transitionName !== 'string') throw new Error('OBS Cut transition is unavailable. Restore the default Cut transition in OBS and retry.');
    if (typeof previous.currentProgramSceneName !== 'string') throw new Error('OBS did not report its current scene. Select a scene in OBS and retry.');
    const width = Number(video.baseWidth), height = Number(video.baseHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error('OBS canvas dimensions are invalid. Check OBS Settings > Video.');
    session.previousScene = previous.currentProgramSceneName;
    const url = await session.feed.start();
    this.check(session);
    // Unique names avoid overwriting any scene/source the user has already configured.
    await client.request('CreateScene', { sceneName: session.scene });
    session.createdScene = true;
    this.check(session);
    // A fade/stinger could reveal the previous scene before it completes. This override belongs only to our scene.
    await client.request('SetSceneSceneTransitionOverride', { sceneName: session.scene, transitionName: cut.transitionName });
    this.check(session);
    const input = await client.request('CreateInput', { sceneName: session.scene, inputName: session.input, inputKind: 'browser_source',
      inputSettings: { url, width: VIRTUAL_CAMERA_MAX_WIDTH, height: VIRTUAL_CAMERA_MAX_HEIGHT, fps: 15, fps_custom: true, shutdown: true, restart_when_active: true, reroute_audio: false }, sceneItemEnabled: true });
    session.createdInput = true;
    this.check(session);
    await client.request('SetSceneItemTransform', { sceneName: session.scene, sceneItemId: input.sceneItemId,
      sceneItemTransform: { positionX: 0, positionY: 0, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: width, boundsHeight: height } });
    this.check(session);
    await this.assertOutputsIdle(session);
    const current = await client.request('GetCurrentProgramScene');
    this.check(session);
    if (current.currentProgramSceneName !== session.previousScene) throw new Error('The OBS scene changed during setup. Try again when OBS is idle.');
    // Mark before the request so its event is recognized, and rollback covers a lost response.
    session.switched = true;
    await client.request('SetCurrentProgramScene', { sceneName: session.scene });
    this.check(session);
    await session.feed.waitForConsumer(this.options.feedConnectTimeoutMs ?? 8000, abort.signal);
    await this.assertOutputsIdle(session);
    session.startUncertain = true;
    try { await client.request('StartVirtualCam'); }
    catch (error) {
      if (error instanceof ObsRequestError) session.startUncertain = false;
      throw error;
    }
    session.ownsVirtualCam = true;
    session.startUncertain = false;
    this.check(session);
    const active = await client.request('GetVirtualCamStatus');
    this.check(session);
    if (active.outputActive !== true) throw new Error('OBS did not start its virtual camera. Check that OBS Virtual Camera is installed, then retry.');
    this.publish('live', 'OBS Virtual Camera is live. Select OBS Virtual Camera in Discord or your calling app. OBS camera output must be Program (Default).', session.scene);
    session.initialFrameTimer = setTimeout(() => this.fault(session, 'No camera frames arrived. Start your camera, then start virtual camera again.'), this.frameTimeoutMs);
    session.initialFrameTimer.unref();
    return this.getStatus();
  }

  pushFrame(frame: Uint8Array): boolean {
    const session = this.session;
    if (!session || session.abort.signal.aborted || (this.status.state !== 'live' && this.status.state !== 'connecting')) return false;
    const accepted = session.feed.pushFrame(frame);
    if (accepted) clearTimeout(session.initialFrameTimer);
    return accepted;
  }

  private handleEvent(session: Session, name: string, data: Record<string, unknown>): void {
    if (session.abort.signal.aborted || this.session !== session) return;
    if (name === 'CurrentProgramSceneChanged' && session.switched && data.sceneName !== session.scene) this.fault(session, 'The OBS scene changed. Virtual camera stopped to avoid sharing another scene.');
    if ((name === 'StreamStateChanged' || name === 'RecordStateChanged') && data.outputActive === true) {
      session.preserveScene = true;
      this.fault(session, 'OBS started streaming or recording. Photoshoot virtual camera stopped.');
    }
    if (name === 'VirtualcamStateChanged' && data.outputActive === false && session.ownsVirtualCam) {
      session.ownsVirtualCam = false;
      this.fault(session, 'OBS Virtual Camera stopped. Start it again from Photoshoot when ready.');
    }
    if (name === 'ExitStarted' || name === 'CurrentSceneCollectionChanging') this.fault(session, 'OBS closed or changed its scene collection. Reconnect when OBS is ready.');
  }

  private fault(session: Session, message: string): void {
    if (session.abort.signal.aborted || this.session !== session) return;
    this.publish('error', message);
    void this.end(session);
  }

  private end(session: Session): Promise<void> {
    if (session.ending) return session.ending;
    session.abort.abort();
    clearTimeout(session.initialFrameTimer);
    session.ending = (async () => {
      await session.feed.stop();
      await session.setup;
      await this.cleanup(session);
      if (this.session === session) this.session = undefined;
    })();
    return session.ending;
  }

  private cleanup(session: Session): Promise<void> {
    if (session.cleanup) return session.cleanup;
    clearTimeout(session.initialFrameTimer);
    session.cleanup = (async () => {
      await session.feed.stop();
      const client = session.client;
      const work = async () => {
        let stopped = !session.ownsVirtualCam && !session.startUncertain;
        if (session.ownsVirtualCam) {
          try { await client.request('StopVirtualCam'); stopped = true; session.ownsVirtualCam = false; }
          catch { this.publish('error', 'Photoshoot cleared its video feed, but OBS did not confirm stopping. Stop OBS Virtual Camera manually.'); }
        }
        let current: Record<string, unknown>;
        try { current = await client.request('GetCurrentProgramScene'); } catch { return; }
        if (session.startUncertain && current.currentProgramSceneName === session.scene) {
          try { await client.request('StopVirtualCam'); stopped = true; }
          catch { this.publish('error', 'Photoshoot cleared its video feed, but OBS did not confirm stopping. Stop OBS Virtual Camera manually.'); }
        }
        let outputsIdle = false;
        try {
          const [stream, record] = await Promise.all([client.request('GetStreamStatus'), client.request('GetRecordStatus')]);
          outputsIdle = stream.outputActive === false && record.outputActive === false;
        } catch { /* Do not change an uncertain program output. */ }
        // If stopping failed, leave the neutral scene selected rather than expose the user's old scene to a still-running device.
        const safeToRestore = outputsIdle && !session.preserveScene && stopped;
        if (safeToRestore && session.switched && session.previousScene && current.currentProgramSceneName === session.scene) {
          await client.request('SetCurrentProgramScene', { sceneName: session.previousScene }).catch(() => {});
        }
        if (session.createdInput) await client.request('RemoveInput', { inputName: session.input }).catch(() => {});
        // Removing the active scene would implicitly choose a different program during a stream.
        if (session.createdScene && (safeToRestore || current.currentProgramSceneName !== session.scene)) await client.request('RemoveScene', { sceneName: session.scene }).catch(() => {});
      };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([work(), new Promise<void>((resolve) => { timeout = setTimeout(resolve, this.requestTimeoutMs + 500); })]);
      clearTimeout(timeout);
      client.close();
    })();
    return session.cleanup;
  }

  async stop(): Promise<VirtualCameraStatus> {
    if (!this.status.supported) return this.getStatus();
    const session = this.session;
    // Stop accepting frames immediately; cleanup may need a bounded OBS request timeout.
    this.publish('stopped', 'Virtual camera stopped. OBS Studio can remain open.');
    if (session) await this.end(session);
    return this.getStatus();
  }

  async dispose(): Promise<void> { this.disposed = true; await this.stop(); }
}
