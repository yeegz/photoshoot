// Low-level WebGL2 helpers: shader compilation, program linking, and the
// full-screen quad. Errors are surfaced (not swallowed) so the renderer can
// fall back to the Normal effect and tell the user a shader failed to compile.

export interface CompiledProgram {
  program: WebGLProgram;
  uniforms: {
    u_tex: WebGLUniformLocation | null;
    u_res: WebGLUniformLocation | null;
    u_time: WebGLUniformLocation | null;
    u_amount: WebGLUniformLocation | null;
    u_mirror: WebGLUniformLocation | null;
    u_center: WebGLUniformLocation | null;
    u_faceFound: WebGLUniformLocation | null;
    u_eyeL: WebGLUniformLocation | null;
    u_eyeR: WebGLUniformLocation | null;
    u_nose: WebGLUniformLocation | null;
    u_mouth: WebGLUniformLocation | null;
    u_chin: WebGLUniformLocation | null;
    u_brow: WebGLUniformLocation | null;
    u_cheekL: WebGLUniformLocation | null;
    u_cheekR: WebGLUniformLocation | null;
    u_faceC: WebGLUniformLocation | null;
    u_faceR: WebGLUniformLocation | null;
    // Custom-filter uniforms (only present on the `customfilter` program).
    u_lut: WebGLUniformLocation | null;
    u_cfA: WebGLUniformLocation | null;
    u_cfB: WebGLUniformLocation | null;
    u_cfC: WebGLUniformLocation | null;
  };
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string
): CompiledProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return {
    program,
    uniforms: {
      u_tex: gl.getUniformLocation(program, 'u_tex'),
      u_res: gl.getUniformLocation(program, 'u_res'),
      u_time: gl.getUniformLocation(program, 'u_time'),
      u_amount: gl.getUniformLocation(program, 'u_amount'),
      u_mirror: gl.getUniformLocation(program, 'u_mirror'),
      u_center: gl.getUniformLocation(program, 'u_center'),
      u_faceFound: gl.getUniformLocation(program, 'u_faceFound'),
      u_eyeL: gl.getUniformLocation(program, 'u_eyeL'),
      u_eyeR: gl.getUniformLocation(program, 'u_eyeR'),
      u_nose: gl.getUniformLocation(program, 'u_nose'),
      u_mouth: gl.getUniformLocation(program, 'u_mouth'),
      u_chin: gl.getUniformLocation(program, 'u_chin'),
      u_brow: gl.getUniformLocation(program, 'u_brow'),
      u_cheekL: gl.getUniformLocation(program, 'u_cheekL'),
      u_cheekR: gl.getUniformLocation(program, 'u_cheekR'),
      u_faceC: gl.getUniformLocation(program, 'u_faceC'),
      u_faceR: gl.getUniformLocation(program, 'u_faceR'),
      u_lut: gl.getUniformLocation(program, 'u_lut'),
      u_cfA: gl.getUniformLocation(program, 'u_cfA'),
      u_cfB: gl.getUniformLocation(program, 'u_cfB'),
      u_cfC: gl.getUniformLocation(program, 'u_cfC'),
    },
  };
}

/** Creates a VAO holding a single full-screen triangle-pair quad. */
export function createQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Could not create VAO');
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Two triangles covering clip space.
  const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export function createVideoTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}
