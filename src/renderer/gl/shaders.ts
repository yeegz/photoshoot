// Raw GLSL (WebGL2 / GLSL ES 3.00) for the effect library. Each effect supplies
// a `vec4 run(vec2 uv)` body; the shared header + main wrap it, apply mirroring,
// and write the final pixel. Distortion effects modify uv before sampling;
// color effects sample then transform. Keeping every effect as one small,
// readable shader makes the switching system trivial.

export const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_amount;
uniform float u_mirror;

vec3 lumv = vec3(0.299, 0.587, 0.114);
`;

const MAIN = `
void main() {
  vec2 uv = v_uv;
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  fragColor = run(uv);
}`;

function frag(body: string): string {
  return HEADER + body + MAIN;
}

export const FRAGMENTS: Record<string, string> = {
  normal: frag(`
vec4 run(vec2 uv){ return texture(u_tex, uv); }`),

  sepia: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  vec3 s = vec3(
    dot(c, vec3(0.393,0.769,0.189)),
    dot(c, vec3(0.349,0.686,0.168)),
    dot(c, vec3(0.272,0.534,0.131)));
  return vec4(clamp(s, 0.0, 1.0), 1.0);
}`),

  bw: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  float l = dot(c, lumv);
  l = clamp((l - 0.5) * 1.15 + 0.5, 0.0, 1.0);
  return vec4(vec3(l), 1.0);
}`),

  thermal: frag(`
vec3 ramp(float t){
  vec3 c0=vec3(0.0,0.0,0.18);
  vec3 c1=vec3(0.18,0.0,0.55);
  vec3 c2=vec3(0.86,0.0,0.55);
  vec3 c3=vec3(1.0,0.45,0.0);
  vec3 c4=vec3(1.0,0.95,0.2);
  vec3 c5=vec3(1.0,1.0,1.0);
  if(t<0.2) return mix(c0,c1,t/0.2);
  if(t<0.4) return mix(c1,c2,(t-0.2)/0.2);
  if(t<0.6) return mix(c2,c3,(t-0.4)/0.2);
  if(t<0.8) return mix(c3,c4,(t-0.6)/0.2);
  return mix(c4,c5,(t-0.8)/0.2);
}
vec4 run(vec2 uv){
  float l = dot(texture(u_tex, uv).rgb, lumv);
  return vec4(ramp(clamp(l,0.0,1.0)), 1.0);
}`),

  xray: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  float l = dot(c, lumv);
  l = pow(1.0 - l, 1.25);
  vec3 col = vec3(l*0.55, l*0.8, l*1.0) + 0.02;
  return vec4(clamp(col,0.0,1.0), 1.0);
}`),

  comic: frag(`
vec4 run(vec2 uv){
  vec2 px = 1.0 / u_res;
  float tl = dot(texture(u_tex, uv+px*vec2(-1.0,-1.0)).rgb, lumv);
  float  l = dot(texture(u_tex, uv+px*vec2(-1.0, 0.0)).rgb, lumv);
  float bl = dot(texture(u_tex, uv+px*vec2(-1.0, 1.0)).rgb, lumv);
  float tr = dot(texture(u_tex, uv+px*vec2( 1.0,-1.0)).rgb, lumv);
  float  r = dot(texture(u_tex, uv+px*vec2( 1.0, 0.0)).rgb, lumv);
  float br = dot(texture(u_tex, uv+px*vec2( 1.0, 1.0)).rgb, lumv);
  float tt = dot(texture(u_tex, uv+px*vec2( 0.0,-1.0)).rgb, lumv);
  float bb = dot(texture(u_tex, uv+px*vec2( 0.0, 1.0)).rgb, lumv);
  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*tt - tr + bl + 2.0*bb + br;
  float edge = step(0.55, sqrt(gx*gx + gy*gy));
  vec3 c = texture(u_tex, uv).rgb;
  vec3 q = floor(c * 5.0 + 0.5) / 5.0;
  return vec4(mix(q, vec3(0.04,0.03,0.05), edge), 1.0);
}`),

  bulge: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - 0.5;
  float r = length(c);
  float maxr = 0.7071;
  float a = atan(c.y, c.x);
  float rn = clamp(r / maxr, 0.0, 1.0);
  float warped = pow(rn, 1.0 - 0.55*u_amount) * maxr;
  vec2 nuv = 0.5 + vec2(cos(a), sin(a)) * warped;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  pinch: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - 0.5;
  float r = length(c);
  float maxr = 0.7071;
  float a = atan(c.y, c.x);
  float rn = clamp(r / maxr, 0.0, 1.0);
  float warped = pow(rn, 1.0 + 0.9*u_amount) * maxr;
  vec2 nuv = 0.5 + vec2(cos(a), sin(a)) * warped;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  twirl: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x);
  float falloff = 1.0 - clamp(r / 0.7071, 0.0, 1.0);
  a += falloff * falloff * 3.2 * u_amount;
  vec2 nuv = 0.5 + r * vec2(cos(a), sin(a));
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  mirror: frag(`
vec4 run(vec2 uv){
  vec2 nuv = uv;
  nuv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  return texture(u_tex, nuv);
}`),

  fisheye: frag(`
vec4 run(vec2 uv){
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  if (r < 0.0001) return texture(u_tex, uv);
  float k = mix(1.0, 0.5, u_amount);
  float rn = pow(min(r, 1.0), k);
  vec2 nuv = (p / r) * rn * 0.5 + 0.5;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  stretch: frag(`
vec4 run(vec2 uv){
  vec2 d = uv - 0.5;
  float widen = 1.0 + 0.85 * u_amount * (0.25 - d.y * d.y) * 4.0;
  d.x /= max(widen, 0.2);
  return texture(u_tex, clamp(d + 0.5, 0.0, 1.0));
}`),

  kaleidoscope: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - 0.5;
  float a = atan(c.y, c.x) + u_time * 0.25;
  float r = length(c);
  float sides = 6.0;
  float seg = 6.28318 / sides;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 nuv = vec2(cos(a), sin(a)) * r + 0.5;
  return texture(u_tex, fract(nuv));
}`),

  glow: frag(`
vec4 run(vec2 uv){
  vec3 base = texture(u_tex, uv).rgb;
  vec2 px = 2.5 / u_res;
  vec3 bloom = vec3(0.0);
  float total = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 o = vec2(float(x), float(y)) * px;
      vec3 s = texture(u_tex, uv + o).rgb;
      float b = max(0.0, dot(s, lumv) - 0.6);
      float w = 1.0 - length(vec2(float(x), float(y))) * 0.25;
      bloom += s * b * w;
      total += 1.0;
    }
  }
  bloom /= total;
  return vec4(clamp(base + bloom * (5.0 * u_amount), 0.0, 1.0), 1.0);
}`),

  popart: frag(`
vec4 run(vec2 uv){
  float l = dot(texture(u_tex, uv).rgb, lumv);
  vec3 pink=vec3(0.97,0.16,0.47);
  vec3 yellow=vec3(1.0,0.85,0.12);
  vec3 cyan=vec3(0.13,0.72,0.86);
  vec3 indigo=vec3(0.16,0.11,0.42);
  vec3 col = l < 0.25 ? indigo : (l < 0.5 ? cyan : (l < 0.75 ? pink : yellow));
  return vec4(col, 1.0);
}`),
};
