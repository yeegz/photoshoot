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
      this.init();
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
    const cached = this.programs.get(id);
    if (cached) return cached;
    const src = FRAGMENTS[id] ?? FRAGMENTS.normal;
    try {
      const prog = linkProgram(this.gl, VERTEX_SRC, src);
      this.programs.set(id, prog);
      return prog;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'shader error';
      if (!this.failed.has(id)) {
        this.failed.add(id);
        this.onShaderError?.(id, message);
      }
      return this.getProgram('normal');
    }
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
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
