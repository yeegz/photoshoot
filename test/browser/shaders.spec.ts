// Every effect's GLSL compiles and links on a real WebGL2 context, and every
// registered effect has a shader (a typo would otherwise surface only when
// someone picks that effect).
import { expect, test } from '@playwright/test';
import { FRAGMENTS, VERTEX_SRC } from '../../src/renderer/gl/shaders';
import { ALL_EFFECTS, EFFECTS } from '../../src/renderer/gl/effects';

test('all effect shaders compile and link', async ({ page }) => {
  await page.setContent('<canvas></canvas>');
  const failures = await page.evaluate(({ vertex, fragments }) => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const out: string[] = [];
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : (out.push(gl.getShaderInfoLog(sh) ?? 'compile failed'), null);
    };
    const vs = compile(gl.VERTEX_SHADER, vertex)!;
    for (const [id, src] of Object.entries(fragments)) {
      const fs = compile(gl.FRAGMENT_SHADER, src);
      if (!fs) { out[out.length - 1] = `${id}: ${out[out.length - 1]}`; continue; }
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) out.push(`${id}: ${gl.getProgramInfoLog(prog)}`);
    }
    return out;
  }, { vertex: VERTEX_SRC, fragments: FRAGMENTS });
  expect(failures).toEqual([]);
});

test('every effect in the library has a shader, ids are unique, and the Photo Booth set is intact', () => {
  for (const e of ALL_EFFECTS) expect(FRAGMENTS[e.id], e.id).toBeTruthy();
  expect(new Set(ALL_EFFECTS.map((e) => e.id)).size).toBe(ALL_EFFECTS.length);
  const originals = ['sepia', 'bw', 'plasticcamera', 'comic', 'normal', 'colorpencil', 'glow', 'thermal', 'xray', 'popart',
    'bulge', 'pinch', 'twirl', 'squeeze', 'mirror', 'kaleidoscope', 'fisheye', 'stretch',
    'bugeyes', 'chipmunk', 'frog', 'dizzy', 'bighead', 'nosetwist', 'sweetheart', 'alien', 'kaleido', 'edgework'];
  for (const id of originals) expect(ALL_EFFECTS.some((e) => e.id === id), id).toBe(true);
  expect(EFFECTS.filter((e) => !e.face && e.id !== 'normal')).toHaveLength(17); // the landing page's wall
});
