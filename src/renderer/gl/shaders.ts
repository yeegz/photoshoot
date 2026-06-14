// Raw GLSL (WebGL2 / GLSL ES 3.00) for the effect library. Each effect supplies
// a `vec4 run(vec2 uv)` body; the shared header + main wrap it, apply mirroring,
// and write the final pixel. Distortion effects warp uv around `u_center` (which
// the renderer sets, already mirror-corrected, so a dragged center lines up with
// the pointer). Color effects ignore it.

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
uniform vec2 u_center;

// Face landmarks (normalized, mirror-corrected by the renderer).
uniform float u_faceFound;
uniform vec2 u_eyeL;
uniform vec2 u_eyeR;
uniform vec2 u_nose;
uniform vec2 u_mouth;
uniform vec2 u_chin;
uniform vec2 u_brow;
uniform vec2 u_cheekL;
uniform vec2 u_cheekR;
uniform vec2 u_faceC;
uniform float u_faceR;

vec3 lumv = vec3(0.299, 0.587, 0.114);

// Local magnify/shrink around a point: amt>0 enlarges, amt<0 shrinks.
vec2 magnify(vec2 uv, vec2 p, float rad, float amt){
  vec2 d = uv - p;
  float fall = smoothstep(rad, 0.0, length(d));
  return p + d * (1.0 - amt * fall);
}
// Local swirl around a point.
vec2 twirlAt(vec2 uv, vec2 p, float rad, float ang){
  vec2 d = uv - p;
  float fall = smoothstep(rad, 0.0, length(d));
  float a = ang * fall;
  float s = sin(a), c = cos(a);
  return p + mat2(c, -s, s, c) * d;
}
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

  plasticcamera: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = (c - 0.5) * 1.22 + 0.5;                       // contrast
  float l = dot(c, lumv);
  c = clamp(mix(vec3(l), c, 1.55), 0.0, 1.0);       // boost saturation
  c.r = clamp(c.r * 1.06 + 0.02, 0.0, 1.0);         // warm cross-process
  c.b = clamp(c.b * 0.92, 0.0, 1.0);
  float d = distance(uv, vec2(0.5));
  c *= smoothstep(0.92, 0.3, d);                    // heavy vignette
  return vec4(c, 1.0);
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

  colorpencil: frag(`
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
  float edge = clamp(sqrt(gx*gx + gy*gy) * 1.5, 0.0, 1.0);
  vec3 base = texture(u_tex, uv).rgb;
  vec3 pale = mix(vec3(1.0), base, 0.42);           // pale colored-pencil tint
  vec3 col = pale * (1.0 - edge * 0.85);            // sketchy dark strokes
  return vec4(clamp(col, 0.0, 1.0), 1.0);
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

  bulge: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - u_center;
  float r = length(c);
  float maxr = 0.7071;
  float a = atan(c.y, c.x);
  float rn = clamp(r / maxr, 0.0, 1.0);
  float warped = pow(rn, 1.0 - 0.55*u_amount) * maxr;
  vec2 nuv = u_center + vec2(cos(a), sin(a)) * warped;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  pinch: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - u_center;
  float r = length(c);
  float maxr = 0.7071;
  float a = atan(c.y, c.x);
  float rn = clamp(r / maxr, 0.0, 1.0);
  float warped = pow(rn, 1.0 + 0.9*u_amount) * maxr;
  vec2 nuv = u_center + vec2(cos(a), sin(a)) * warped;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  twirl: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - u_center;
  float r = length(c);
  float a = atan(c.y, c.x);
  float falloff = 1.0 - clamp(r / 0.7071, 0.0, 1.0);
  a += falloff * falloff * 3.2 * u_amount;
  vec2 nuv = u_center + r * vec2(cos(a), sin(a));
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  squeeze: frag(`
vec4 run(vec2 uv){
  vec2 d = uv - u_center;
  float squeeze = 1.0 + 0.95 * u_amount * exp(-pow(d.y / 0.32, 2.0));
  d.x *= squeeze;
  return texture(u_tex, clamp(d + u_center, 0.0, 1.0));
}`),

  mirror: frag(`
vec4 run(vec2 uv){
  vec2 nuv = uv;
  nuv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  return texture(u_tex, nuv);
}`),

  kaleidoscope: frag(`
vec4 run(vec2 uv){
  vec2 c = uv - u_center;
  float a = atan(c.y, c.x) + u_time * 0.25;
  float r = length(c);
  float sides = 6.0;
  float seg = 6.28318 / sides;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 nuv = vec2(cos(a), sin(a)) * r + u_center;
  return texture(u_tex, fract(nuv));
}`),

  fisheye: frag(`
vec4 run(vec2 uv){
  vec2 p = (uv - u_center) * 2.0;
  float r = length(p);
  if (r < 0.0001) return texture(u_tex, uv);
  float k = mix(1.0, 0.5, u_amount);
  float rn = pow(min(r, 1.0), k);
  vec2 nuv = (p / r) * rn * 0.5 + u_center;
  return texture(u_tex, clamp(nuv, 0.0, 1.0));
}`),

  stretch: frag(`
vec4 run(vec2 uv){
  vec2 d = uv - u_center;
  float widen = 1.0 + 0.85 * u_amount * (0.25 - d.y * d.y) * 4.0;
  d.x /= max(widen, 0.2);
  return texture(u_tex, clamp(d + u_center, 0.0, 1.0));
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

  // ---- Face-tracked "fun face" effects (fall back to normal with no face) ----

  bugeyes: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  float rad = u_faceR * 0.95;
  vec2 p = magnify(uv, u_eyeL, rad, 0.62*u_amount);
  p = magnify(p, u_eyeR, rad, 0.62*u_amount);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  chipmunk: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  float rad = u_faceR * 1.15;
  vec2 p = magnify(uv, u_cheekL, rad, 0.5*u_amount);
  p = magnify(p, u_cheekR, rad, 0.5*u_amount);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  frog: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  float rad = u_faceR * 0.85;
  vec2 p = magnify(uv, u_eyeL, rad, 0.5*u_amount);
  p = magnify(p, u_eyeR, rad, 0.5*u_amount);
  p = magnify(p, u_mouth, u_faceR * 1.05, 0.34*u_amount);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  dizzy: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  float ang = sin(u_time * 1.6) * 1.4 * u_amount;
  vec2 p = twirlAt(uv, u_faceC, u_faceR * 2.3, ang);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  bighead: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  vec2 p = magnify(uv, u_faceC, u_faceR * 2.7, 0.42*u_amount);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  nosetwist: frag(`
vec4 run(vec2 uv){
  if (u_faceFound < 0.5) return texture(u_tex, uv);
  vec2 p = twirlAt(uv, u_nose, u_faceR * 0.85, 2.7*u_amount);
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  sweetheart: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  if (u_faceFound > 0.5) {
    float rad = u_faceR * 0.9;
    p = magnify(p, u_eyeL, rad, 0.5*u_amount);
    p = magnify(p, u_eyeR, rad, 0.5*u_amount);
  }
  vec3 c = texture(u_tex, clamp(p, 0.0, 1.0)).rgb;
  c = mix(c, c * vec3(1.08, 0.9, 0.98) + vec3(0.07, 0.0, 0.03), 0.5);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  alien: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  if (u_faceFound > 0.5) {
    p = magnify(p, u_brow, u_faceR * 2.0, 0.46*u_amount);
    p = magnify(p, u_chin, u_faceR * 1.0, -0.46*u_amount);
  }
  vec3 c = texture(u_tex, clamp(p, 0.0, 1.0)).rgb;
  float l = dot(c, lumv);
  c = mix(c, vec3(l) * vec3(0.6, 1.06, 0.7), 0.45);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  // The ONE shader that applies untrusted community filters. It reads only
  // clamped numbers (u_cfA/B/C) and optionally samples a validated 512×512 LUT
  // (u_lut). No part of a filter manifest ever reaches this as source — it just
  // sets these uniforms. See shared/filter-schema.ts.
  customfilter: frag(`
uniform sampler2D u_lut;     // 512x512, 64-level square LUT (bound when u_cfC.w>0.5)
uniform vec4 u_cfA;          // brightness, contrast, saturation, gamma
uniform vec4 u_cfB;          // temperature, tint, fade, hue(deg)
uniform vec4 u_cfC;          // vignette, grain, lutAmount, hasLut

// Canonical 512x512 LUT lookup (8x8 tiles of 64x64), with blue interpolation.
vec3 sampleLUT(vec3 col){
  float blue = clamp(col.b, 0.0, 1.0) * 63.0;
  vec2 q1; q1.y = floor(floor(blue) / 8.0); q1.x = floor(blue) - q1.y * 8.0;
  vec2 q2; q2.y = floor(ceil(blue)  / 8.0); q2.x = ceil(blue)  - q2.y * 8.0;
  float r = clamp(col.r, 0.0, 1.0), g = clamp(col.g, 0.0, 1.0);
  vec2 t1 = vec2(q1.x * 0.125 + 0.5/512.0 + (0.125 - 1.0/512.0) * r,
                 q1.y * 0.125 + 0.5/512.0 + (0.125 - 1.0/512.0) * g);
  vec2 t2 = vec2(q2.x * 0.125 + 0.5/512.0 + (0.125 - 1.0/512.0) * r,
                 q2.y * 0.125 + 0.5/512.0 + (0.125 - 1.0/512.0) * g);
  return mix(texture(u_lut, t1).rgb, texture(u_lut, t2).rgb, fract(blue));
}

// Hue rotation about the (1,1,1) luminance axis (Rodrigues).
vec3 hueRotate(vec3 col, float deg){
  float a = radians(deg);
  vec3 k = vec3(0.57735);
  float ca = cos(a);
  return col * ca + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - ca);
}

vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c += u_cfA.x;                                   // brightness
  c = (c - 0.5) * u_cfA.y + 0.5;                  // contrast
  float l = dot(clamp(c,0.0,1.0), lumv);
  c = mix(vec3(l), c, u_cfA.z);                   // saturation
  c.r += u_cfB.x * 0.12; c.b -= u_cfB.x * 0.12;   // temperature (warm/cool)
  c.g += u_cfB.y * 0.10;                          // tint (green/magenta)
  c = clamp(c, 0.0, 1.0);
  c = pow(c, vec3(1.0 / u_cfA.w));                // gamma
  c = mix(c, c * 0.82 + 0.12, u_cfB.z);           // fade (lift blacks)
  if (abs(u_cfB.w) > 0.5) c = clamp(hueRotate(c, u_cfB.w), 0.0, 1.0);
  if (u_cfC.w > 0.5) c = mix(c, clamp(sampleLUT(c), 0.0, 1.0), u_cfC.z); // LUT grade
  float d = distance(uv, vec2(0.5));
  c *= 1.0 - u_cfC.x * smoothstep(0.32, 0.85, d); // vignette
  float n = fract(sin(dot(uv * u_res + u_time, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * u_cfC.y * 0.16;                // grain
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),
};
