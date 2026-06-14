// The Photoshoot rendering engine. Drives a single WebGL2 canvas from a live
// video element (or a 2D canvas, for background replacement), applies the
// active GLSL effect, and exposes capture + stats. Designed to be reused: the
// live preview and the effects-menu thumbnails each own one instance.
//
// Performance: one reusable texture and one program per effect (compiled
// lazily, cached). Frames are driven by requestVideoFrameCallback when the
// source is a <video> (no wasted frames), falling back to requestAnimationFrame.

import { VERTEX_SRC, FRAGMENTS } from './shaders';
import { EFFECT_BY_ID } from './effects';
import { CompiledProgram, linkProgram, createQuad, createVideoTexture } from './glcore';
import { getFace } from '../faceTracker';
import type { CustomFilter } from '../../shared/ipc-contract';
import { clampParams } from '../../shared/filter-schema';

const CUSTOM_PREFIX = 'custom:';

type Source = HTMLVideoElement | HTMLCanvasElement;

export interface RenderStats {
  fps: number;
  width: number;
  height: number;
  backend: string;
  dropped: boolean;
}

export class GLRenderer {
  readonly canvas: HTMLCanvasElement;
  available = false;
  lastError: string | null = null;
  onShaderError: ((effectId: string, message: string) => void) | null = null;
  onContextLost: (() => void) | null = null;

  private gl: WebGL2RenderingContext | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private programs = new Map<string, CompiledProgram>();
  private failed = new Set<string>();
  private customFilters = new Map<string, CustomFilter>();
  private lutTextures = new Map<string, WebGLTexture>();

  private source: Source | null = null;
  private effect = 'normal';
  private amount = 0;
  private mirror = false;
  private center = { x: 0.5, y: 0.5 };
  private maxSize: number | null = null;
  private frameHook: (() => void) | null = null;

  private running = false;
  private usingRVFC = false;
  private rafHandle = 0;
  private startTime = 0;

  private frameTimes: number[] = [];
  private fps = 0;
  private dropped = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.available = false;
      this.stop();
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.programs.clear();
      this.failed.clear();
      this.lutTextures.clear(); // textures died with the context; re-upload below
      this.init();
      for (const f of this.customFilters.values()) {
        if (f.lut) this.uploadLut(f.id, f.lut);
      }
      if (this.source) this.start();
    });
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: true,
      desynchronized: true,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.available = false;
      this.lastError = 'WebGL2 is not available on this system.';
      return;
    }
    this.gl = gl;
    this.vao = createQuad(gl);
    this.texture = createVideoTexture(gl);
    gl.clearColor(0, 0, 0, 1);
    this.available = true;
    // Pre-compile the Normal program so a fallback always exists.
    this.getProgram('normal');
    this.startTime = performance.now();
  }

  private getProgram(id: string): CompiledProgram | null {
    if (!this.gl) return null;
    // All custom filters share the single fixed `customfilter` program; their
    // differences are uniforms, never shader source.
    const key = id.startsWith(CUSTOM_PREFIX) ? 'customfilter' : id;
    const cached = this.programs.get(key);
    if (cached) return cached;
    const src = FRAGMENTS[key] ?? FRAGMENTS.normal;
    try {
      const prog = linkProgram(this.gl, VERTEX_SRC, src);
      this.programs.set(key, prog);
      return prog;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'shader error';
      if (!this.failed.has(key)) {
        this.failed.add(key);
        this.onShaderError?.(key, message);
      }
      return this.getProgram('normal');
    }
  }

  /** Register the validated community filters this renderer can apply, and
   *  (re)upload any LUT textures. Safe to call repeatedly. */
  setCustomFilters(list: CustomFilter[]): void {
    const next = new Map<string, CustomFilter>();
    // Re-clamp every params object here (defense in depth): whatever the store
    // held, only finite, in-range numbers ever reach gl.uniform4f.
    for (const f of list) next.set(f.id, { ...f, params: clampParams(f.params) });
    // Drop textures for filters that vanished or no longer carry a LUT.
    for (const [id, tex] of this.lutTextures) {
      const f = next.get(id);
      if (!f || !f.lut) {
        this.gl?.deleteTexture(tex);
        this.lutTextures.delete(id);
      }
    }
    for (const f of list) {
      if (f.lut && !this.lutTextures.has(f.id)) this.uploadLut(f.id, f.lut);
    }
    this.customFilters = next;
  }

  private uploadLut(id: string, dataUri: string): void {
    const img = new Image();
    img.onload = () => {
      const gl = this.gl;
      if (!gl) return;
      const tex = gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // a LUT is sampled un-flipped
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      } catch {
        gl.deleteTexture(tex);
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      // The filter may have been removed while this image decoded — don't
      // orphan a texture for an id that's no longer tracked.
      if (!this.customFilters.has(id)) {
        gl.deleteTexture(tex);
        return;
      }
      const prev = this.lutTextures.get(id);
      if (prev) gl.deleteTexture(prev);
      this.lutTextures.set(id, tex);
    };
    img.src = dataUri;
  }

  setSource(source: Source): void {
    this.source = source;
    this.usingRVFC =
      source instanceof HTMLVideoElement &&
      typeof (source as HTMLVideoElement).requestVideoFrameCallback === 'function';
  }

  setFrameHook(hook: (() => void) | null): void {
    this.frameHook = hook;
  }

  setEffect(id: string, amount?: number): void {
    this.effect = id;
    this.amount = amount ?? EFFECT_BY_ID.get(id)?.amount ?? 1;
  }

  setMirror(mirror: boolean): void {
    this.mirror = mirror;
  }

  /** Distortion center in normalized preview coords (0..1). */
  setCenter(x: number, y: number): void {
    this.center.x = Math.min(1, Math.max(0, x));
    this.center.y = Math.min(1, Math.max(0, y));
  }

  private sourceDims(): { w: number; h: number } {
    const s = this.source;
    if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
    if (s instanceof HTMLCanvasElement) return { w: s.width, h: s.height };
    return { w: 0, h: 0 };
  }

  private ensureSize(w: number, h: number): void {
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Cap the render resolution (used by the small effects-menu previews). */
  setMaxSize(px: number | null): void {
    this.maxSize = px;
  }

  /** Upload the current source frame into the texture. Returns false if the
   *  source isn't ready this frame. Split from drawing so the effects menu can
   *  upload once and then draw many effects from the same texture. */
  prepareFrame(): boolean {
    const gl = this.gl;
    if (!gl || !this.source) return false;
    const { w, h } = this.sourceDims();
    if (w === 0 || h === 0) return false;
    if (this.source instanceof HTMLVideoElement && this.source.readyState < 2) return false;
    gl.activeTexture(gl.TEXTURE0); // the video always lives on unit 0
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
    } catch {
      return false; // source not yet decodable this frame
    }
    return true;
  }

  /** Draw an effect from the already-uploaded texture into the canvas. */
  drawEffect(effectId: string, amount: number, mirror: boolean): void {
    const gl = this.gl;
    if (!gl) return;
    const { w, h } = this.sourceDims();
    if (w === 0 || h === 0) return;
    let tw = w;
    let th = h;
    if (this.maxSize && Math.max(w, h) > this.maxSize) {
      const s = this.maxSize / Math.max(w, h);
      tw = Math.max(1, Math.round(w * s));
      th = Math.max(1, Math.round(h * s));
    }
    this.ensureSize(tw, th);
    gl.viewport(0, 0, tw, th);

    const prog = this.getProgram(effectId);
    if (!prog) return;
    gl.useProgram(prog.program);
    gl.uniform1i(prog.uniforms.u_tex, 0);
    gl.uniform2f(prog.uniforms.u_res, tw, th);
    gl.uniform1f(prog.uniforms.u_time, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(prog.uniforms.u_amount, amount);
    gl.uniform1f(prog.uniforms.u_mirror, mirror ? 1 : 0);
    // Mirror-correct the center so a dragged point lines up with the pointer.
    gl.uniform2f(prog.uniforms.u_center, mirror ? 1 - this.center.x : this.center.x, this.center.y);

    // Face landmarks (mirror-corrected x), used by the fun-face effects.
    const f = getFace();
    const fx = (p: readonly [number, number]) => (mirror ? 1 - p[0] : p[0]);
    const u = prog.uniforms;
    gl.uniform1f(u.u_faceFound, f.found ? 1 : 0);
    gl.uniform2f(u.u_eyeL, fx(f.eyeL), f.eyeL[1]);
    gl.uniform2f(u.u_eyeR, fx(f.eyeR), f.eyeR[1]);
    gl.uniform2f(u.u_nose, fx(f.nose), f.nose[1]);
    gl.uniform2f(u.u_mouth, fx(f.mouth), f.mouth[1]);
    gl.uniform2f(u.u_chin, fx(f.chin), f.chin[1]);
    gl.uniform2f(u.u_brow, fx(f.brow), f.brow[1]);
    gl.uniform2f(u.u_cheekL, fx(f.cheekL), f.cheekL[1]);
    gl.uniform2f(u.u_cheekR, fx(f.cheekR), f.cheekR[1]);
    gl.uniform2f(u.u_faceC, fx(f.faceC), f.faceC[1]);
    gl.uniform1f(u.u_faceR, f.faceR);

    // Custom community filter: feed the clamped grades + bind its LUT (always
    // bind *something* to unit 1 so the sampler is valid; u_cfC.w gates use).
    if (effectId.startsWith(CUSTOM_PREFIX)) {
      const filt = this.customFilters.get(effectId.slice(CUSTOM_PREFIX.length));
      const p = filt?.params;
      if (p) {
        const lutTex = filt?.lut ? this.lutTextures.get(filt.id) : undefined;
        gl.uniform4f(u.u_cfA, p.brightness, p.contrast, p.saturation, p.gamma);
        gl.uniform4f(u.u_cfB, p.temperature, p.tint, p.fade, p.hue);
        gl.uniform4f(u.u_cfC, p.vignette, p.grain, p.lutAmount, lutTex ? 1 : 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex ?? this.texture);
        gl.uniform1i(u.u_lut, 1);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        // Filter was removed underneath us → render as Normal.
        gl.uniform4f(u.u_cfA, 0, 1, 1, 1);
        gl.uniform4f(u.u_cfB, 0, 0, 0, 0);
        gl.uniform4f(u.u_cfC, 0, 0, 1, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(u.u_lut, 1);
        gl.activeTexture(gl.TEXTURE0);
      }
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /** Render one frame with explicit params (upload + draw). */
  renderWith(effectId: string, amount: number, mirror: boolean): void {
    if (this.prepareFrame()) this.drawEffect(effectId, amount, mirror);
  }

  /** Render the current persistent effect once. */
  renderFrame(): void {
    this.renderWith(this.effect, this.amount, this.mirror);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.frameHook?.();
    this.renderFrame();
    this.trackFps(now);
    this.schedule();
  };

  private schedule(): void {
    if (!this.running) return;
    if (this.usingRVFC && this.source instanceof HTMLVideoElement) {
      this.source.requestVideoFrameCallback(this.tick);
    } else {
      this.rafHandle = requestAnimationFrame(this.tick);
    }
  }

  private trackFps(now: number): void {
    this.frameTimes.push(now);
    const cutoff = now - 1000;
    while (this.frameTimes.length && this.frameTimes[0] < cutoff) this.frameTimes.shift();
    this.fps = this.frameTimes.length;
    this.dropped = this.fps > 0 && this.fps < 24;
  }

  start(): void {
    if (!this.available || this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  toDataURL(type: 'image/png' | 'image/jpeg', quality?: number): string {
    this.renderFrame(); // guarantee freshest pixels
    return this.canvas.toDataURL(type, quality);
  }

  getStats(): RenderStats {
    const { w, h } = this.sourceDims();
    return {
      fps: this.fps,
      width: w,
      height: h,
      backend: this.usingRVFC ? 'WebGL2 · rVFC' : 'WebGL2 · rAF',
      dropped: this.dropped,
    };
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;
    if (!gl) return;
    this.programs.forEach((p) => gl.deleteProgram(p.program));
    this.programs.clear();
    this.lutTextures.forEach((t) => gl.deleteTexture(t));
    this.lutTextures.clear();
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
