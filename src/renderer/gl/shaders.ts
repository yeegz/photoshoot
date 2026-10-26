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

// Faces: up to MAX_FACES people, as arrays (normalized texture space). Face
// effects run their face part once per person with EACH_FACE { ... }, which
// loads that person into the u_* globals below (so one-face code reads the same).
#define MAX_FACES 4
uniform int u_faceCount;
uniform vec2 f_eyeL[MAX_FACES];
uniform vec2 f_eyeR[MAX_FACES];
uniform vec2 f_nose[MAX_FACES];
uniform vec2 f_mouth[MAX_FACES];
uniform vec2 f_chin[MAX_FACES];
uniform vec2 f_brow[MAX_FACES];
uniform vec2 f_cheekL[MAX_FACES];
uniform vec2 f_cheekR[MAX_FACES];
uniform vec2 f_faceC[MAX_FACES];
uniform float f_faceR[MAX_FACES];
uniform vec4 f_expr[MAX_FACES]; // mouth open, brows raised, smile, blink (0..1, smoothed)

float u_faceFound = 0.0;
vec2 u_eyeL = vec2(0.42, 0.55);
vec2 u_eyeR = vec2(0.58, 0.55);
vec2 u_nose = vec2(0.5, 0.45);
vec2 u_mouth = vec2(0.5, 0.32);
vec2 u_chin = vec2(0.5, 0.15);
vec2 u_brow = vec2(0.5, 0.72);
vec2 u_cheekL = vec2(0.36, 0.4);
vec2 u_cheekR = vec2(0.64, 0.4);
vec2 u_faceC = vec2(0.5, 0.45);
float u_faceR = 0.16;
vec4 u_expr = vec4(0.0);

bool useFace(int i){
  u_faceFound = 1.0;
  u_eyeL = f_eyeL[i]; u_eyeR = f_eyeR[i]; u_nose = f_nose[i]; u_mouth = f_mouth[i];
  u_chin = f_chin[i]; u_brow = f_brow[i]; u_cheekL = f_cheekL[i]; u_cheekR = f_cheekR[i];
  u_faceC = f_faceC[i]; u_faceR = f_faceR[i]; u_expr = f_expr[i];
  return true;
}
#define EACH_FACE for (int fi_ = 0; fi_ < MAX_FACES; fi_++) if (fi_ < u_faceCount && useFace(fi_))

vec3 lumv = vec3(0.299, 0.587, 0.114);

// Local magnify/shrink around a point: amt>0 enlarges, amt<0 shrinks.
vec2 magnify(vec2 uv, vec2 p, float rad, float amt){
  vec2 d = uv - p;
  float fall = smoothstep(rad, 0.0, length(d));
  return p + d * (1.0 - amt * fall);
}
// ---- shared helpers for the extended library ----
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lumAt(vec2 uv){ return dot(texture(u_tex, uv).rgb, lumv); }
vec2 aspectv(){ return vec2(u_res.x / max(u_res.y, 1.0), 1.0); }
vec3 blur9(vec2 uv, float r){
  vec2 px = r / u_res;
  vec3 s = vec3(0.0);
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += texture(u_tex, uv + vec2(float(x), float(y)) * px).rgb;
  return s / 9.0;
}
float sobel(vec2 uv){
  vec2 px = 1.0 / u_res;
  float tl = lumAt(uv + px * vec2(-1.0, 1.0)), t = lumAt(uv + px * vec2(0.0, 1.0)), tr = lumAt(uv + px * vec2(1.0, 1.0));
  float l = lumAt(uv + px * vec2(-1.0, 0.0)), r = lumAt(uv + px * vec2(1.0, 0.0));
  float bl = lumAt(uv + px * vec2(-1.0, -1.0)), b = lumAt(uv + px * vec2(0.0, -1.0)), br = lumAt(uv + px * vec2(1.0, -1.0));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -bl - 2.0 * b - br + tl + 2.0 * t + tr;
  return length(vec2(gx, gy));
}
vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
float vignette(vec2 uv, float k){ return 1.0 - k * smoothstep(0.32, 0.9, distance(uv, vec2(0.5))); }
float grain(vec2 uv){ return hash21(uv * u_res + floor(u_time * 24.0)) - 0.5; }
// Signed distances (Inigo Quilez): heart with its tip at the origin, five-point star.
float sdHeart(vec2 p){
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdStar5(vec2 p, float r, float rf){
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// Face-local coordinates: origin o, units of eye distance, +y towards the forehead.
vec2 faceLocal(vec2 uv, vec2 o){
  vec2 A = aspectv();
  vec2 up = normalize((u_brow - u_chin) * A);
  vec2 rt = vec2(up.y, -up.x);
  vec2 d = (uv - o) * A;
  return vec2(dot(d, rt), dot(d, up)) / max(u_faceR * A.x, 1e-4);
}
float fill(float sd, float aa){ return 1.0 - smoothstep(-aa, aa, sd); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Soft contact shadow under a sticker: darken where the shape would be, offset down.
vec3 dropShadow(vec3 c, float shapeAlpha){ return mix(c, c * 0.55, shapeAlpha * 0.45); }
// Simple top-light shading across a shape of half-height r (q in the shape's frame).
vec3 litFrom(vec3 base, vec2 q, float r){ return base * (0.78 + 0.36 * clamp(0.5 + q.y / (2.0 * r) - q.x * 0.15, 0.0, 1.0)); }
mat2 rot2(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
// A dog's ear in its own frame: a rounded petal from y = -0.1 to y = len,
// widest a third of the way up, its centre line curving outward (+x) by bend.
// Not an exact distance, but smooth enough to shade and anti-alias.
float dogEar(vec2 q, float bend, float len){
  float t = clamp((q.y + 0.1) / (len + 0.1), 0.0, 1.0);
  float w = (0.16 + 0.3 * smoothstep(0.0, 0.7, t)) * pow(sin(3.14159 * pow(t, 0.42)), 0.45);
  float cx = bend * q.y * q.y;
  float side = abs(q.x - cx) - w;
  float ends = max(-q.y - 0.1, q.y - len);
  return max(side, ends);
}
float ellipse(vec2 p, vec2 r){ return (length(p / r) - 1.0) * min(r.x, r.y); }
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
  vec2 p = uv;
  EACH_FACE {
    float rad = u_faceR * 0.95;
    p = magnify(p, u_eyeL, rad, 0.62*u_amount);
    p = magnify(p, u_eyeR, rad, 0.62*u_amount);
  }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  chipmunk: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE {
    float rad = u_faceR * 1.15;
    p = magnify(p, u_cheekL, rad, 0.5*u_amount);
    p = magnify(p, u_cheekR, rad, 0.5*u_amount);
  }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  frog: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE {
    float rad = u_faceR * 0.85;
    p = magnify(p, u_eyeL, rad, 0.5*u_amount);
    p = magnify(p, u_eyeR, rad, 0.5*u_amount);
    p = magnify(p, u_mouth, u_faceR * 1.05, 0.34*u_amount);
  }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  dizzy: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  float ang = sin(u_time * 1.6) * 1.4 * u_amount;
  EACH_FACE { p = twirlAt(p, u_faceC, u_faceR * 2.3, ang); }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  bighead: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE { p = magnify(p, u_faceC, u_faceR * 2.7, 0.42*u_amount); }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  nosetwist: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE { p = twirlAt(p, u_nose, u_faceR * 0.85, 2.7*u_amount); }
  return texture(u_tex, clamp(p, 0.0, 1.0));
}`),

  sweetheart: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE {
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
  EACH_FACE {
    p = magnify(p, u_brow, u_faceR * 2.0, 0.46*u_amount);
    p = magnify(p, u_chin, u_faceR * 1.0, -0.46*u_amount);
  }
  vec3 c = texture(u_tex, clamp(p, 0.0, 1.0)).rgb;
  float l = dot(c, lumv);
  c = mix(c, vec3(l) * vec3(0.6, 1.06, 0.7), 0.45);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  // ---- More effects: the looks people reach for most ----

  film: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = c * vec3(1.05, 1.0, 0.9) + vec3(0.035, 0.02, 0.0);
  c = mix(c, c * 0.84 + 0.11, 0.4);
  float l = dot(c, lumv);
  c = mix(vec3(l), c, 0.82);
  c *= vignette(uv, 0.35);
  c += grain(uv) * 0.07;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  disposable: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = (c - 0.5) * 1.18 + 0.56;
  c *= vec3(1.04, 1.03, 0.88);
  vec3 halo = max(blur9(uv, 4.0) - 0.62, 0.0);
  c += halo * vec3(0.9, 0.35, 0.12);
  float leak = smoothstep(0.75, 0.0, distance(uv, vec2(0.02, 0.98)));
  c += vec3(0.32, 0.12, 0.0) * leak;
  c *= vignette(uv, 0.55);
  c += grain(uv) * 0.09;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  softglam: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  vec3 b = blur9(uv, 2.6);
  float edge = length(c - b);
  c = mix(c, b, 0.62 * (1.0 - smoothstep(0.03, 0.14, edge)));
  c += pow(b, vec3(3.0)) * 0.18;
  c = mix(c, c * vec3(1.03, 0.97, 1.0) + vec3(0.035, 0.0, 0.02), 0.7);
  c = c * 0.95 + 0.04;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  dreamy: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  vec3 b = blur9(uv, 7.0);
  c = mix(c, b, 0.38) + max(b - 0.55, 0.0) * 0.6;
  c = mix(c, vec3(1.0, 0.86, 0.95), 0.12);
  c = c * 0.86 + 0.12;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  goldenhour: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  float sun = smoothstep(1.15, 0.0, distance(uv * aspectv(), vec2(0.88, 0.92) * aspectv()));
  c = c * vec3(1.12, 1.0, 0.8);
  c = (c - 0.5) * 1.06 + 0.5;
  c += vec3(0.28, 0.13, 0.0) * sun * sun;
  c *= vignette(uv, 0.25);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  noir: frag(`
vec4 run(vec2 uv){
  float l = dot(texture(u_tex, uv).rgb, lumv);
  l = smoothstep(0.06, 0.94, l);
  l = pow(l, 1.2);
  vec3 c = vec3(l) * vignette(uv, 0.6);
  c += grain(uv) * 0.06;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  vhs: frag(`
vec4 run(vec2 uv){
  float line = floor(uv.y * u_res.y / 2.0);
  float wob = 0.0025 + 0.0015 * sin(uv.y * 380.0 + u_time * 9.0);
  float band = step(0.988, fract(uv.y * 2.5 - u_time * 0.35));
  vec2 p = uv + vec2(band * (hash21(vec2(line, floor(u_time * 20.0))) - 0.5) * 0.03, 0.0);
  vec3 c;
  c.r = texture(u_tex, p + vec2(wob, 0.0)).r;
  c.g = texture(u_tex, p).g;
  c.b = texture(u_tex, p - vec2(wob, 0.0)).b;
  c = mix(vec3(dot(c, lumv)), c, 0.85) * vec3(1.04, 1.0, 0.95);
  c *= 0.92 + 0.08 * sin(uv.y * u_res.y * 3.14159);
  c += grain(uv) * 0.08 + band * 0.12;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  glitch: frag(`
vec4 run(vec2 uv){
  float t = floor(u_time * 8.0);
  vec2 block = floor(uv * vec2(6.0, 22.0));
  float r = hash21(vec2(block.y, t));
  vec2 p = uv;
  if (r > 0.8) p.x += (hash21(vec2(t, block.y + 3.0)) - 0.5) * 0.12;
  float split = 0.004 + step(0.9, r) * 0.012;
  vec3 c = vec3(texture(u_tex, p + vec2(split, 0.0)).r, texture(u_tex, p).g, texture(u_tex, p - vec2(split, 0.0)).b);
  if (hash21(block + t) > 0.97) c = 1.0 - c;
  return vec4(c, 1.0);
}`),

  duotone: frag(`
vec4 run(vec2 uv){
  float l = smoothstep(0.08, 0.92, dot(texture(u_tex, uv).rgb, lumv));
  vec3 c = mix(vec3(0.18, 0.1, 0.46), vec3(1.0, 0.5, 0.64), l);
  return vec4(c, 1.0);
}`),

  lomo: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = vec3(smoothstep(0.05, 0.95, c.r), smoothstep(0.0, 1.0, c.g), c.b * 0.8 + 0.12);
  float l = dot(c, lumv);
  c = mix(vec3(l), c, 1.35);
  c *= vignette(uv, 0.8);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  sparkle: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c += max(blur9(uv, 3.0) - 0.7, 0.0) * 0.8;
  vec2 A = aspectv();
  vec2 g = uv * A * 9.0;
  vec2 cell = floor(g);
  float glow = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    vec2 id = cell + vec2(float(x), float(y));
    float h = hash21(id);
    if (h < 0.62) continue;
    vec2 pos = id + vec2(hash21(id + 7.1), hash21(id + 3.3));
    vec2 d = (g - pos);
    float tw = 0.5 + 0.5 * sin(u_time * (2.0 + h * 3.0) + h * 40.0);
    float size = (0.08 + 0.12 * fract(h * 13.0)) * tw;
    vec2 a = abs(d) / max(size, 1e-3);
    float star = max(0.0, 1.0 - (a.x * a.y * 9.0 + length(a) * 0.35));
    glow += star * star + 0.04 * size / (dot(d, d) + 0.002);
  }
  c += vec3(1.0, 0.95, 0.85) * min(glow, 1.4);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  hearts: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = mix(c, c * vec3(1.06, 0.94, 1.0) + vec3(0.05, 0.0, 0.03), 0.5);
  vec2 A = aspectv();
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float h = hash21(vec2(fi, 1.7));
    float speed = 0.05 + 0.07 * hash21(vec2(fi, 9.2));
    float size = 0.035 + 0.045 * hash21(vec2(fi, 4.4));
    vec2 pos = vec2(fract(h * 7.3) * A.x, fract(hash21(vec2(fi, 2.9)) + u_time * speed) * 1.25 - 0.12);
    pos.x += 0.025 * sin(u_time * 1.3 + fi);
    vec2 d = (uv * A - pos) / size;
    float sd = sdHeart(d + vec2(0.0, 0.55));
    float a = fill(sd, 0.06) * 0.92;
    vec3 col = mix(vec3(1.0, 0.25, 0.45), vec3(1.0, 0.62, 0.78), fract(h * 3.1));
    col += 0.25 * smoothstep(0.35, 0.0, length(d - vec2(-0.22, 0.25)));
    c = mix(c, col, a);
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  halftone: frag(`
vec4 run(vec2 uv){
  vec2 A = aspectv();
  float cells = 90.0;
  mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 g = rot * (uv * A) * cells;
  vec2 cell = floor(g) + 0.5;
  vec2 centre = (transpose(rot) * (cell / cells)) / A;
  vec3 col = texture(u_tex, clamp(centre, 0.0, 1.0)).rgb;
  float dark = 1.0 - dot(col, lumv);
  float r = sqrt(clamp(dark, 0.0, 1.0)) * 0.62;
  float dotMask = fill(length(g - cell) - r, 0.08);
  float l = dot(col, lumv);
  vec3 ink = mix(col, vec3(l), -0.6);
  vec3 paper = vec3(0.98, 0.96, 0.92);
  return vec4(mix(paper, clamp(ink * 0.85, 0.0, 1.0), dotMask), 1.0);
}`),

  neon: frag(`
vec4 run(vec2 uv){
  float e = smoothstep(0.08, 0.5, sobel(uv));
  vec3 col = hue(fract(uv.x * 0.6 + uv.y * 0.4 + u_time * 0.08));
  vec3 base = texture(u_tex, uv).rgb * 0.1;
  return vec4(clamp(base + col * e * 1.6, 0.0, 1.0), 1.0);
}`),

  pixel: frag(`
vec4 run(vec2 uv){
  vec2 n = vec2(72.0, 72.0 / aspectv().x);
  vec2 p = (floor(uv * n) + 0.5) / n;
  vec3 c = texture(u_tex, p).rgb;
  c = floor(c * 7.0 + 0.5) / 7.0;
  vec2 f = fract(uv * n);
  c *= 0.9 + 0.1 * step(0.08, min(f.x, f.y));
  return vec4(c, 1.0);
}`),

  rainbow: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  float k = uv.x * 0.9 + uv.y * 0.6 + sin(u_time * 0.5) * 0.15;
  float stripe = smoothstep(0.0, 0.25, k - 0.35) * smoothstep(0.75, 0.45, k - 0.35);
  vec3 prism = hue(fract(k * 1.6 - u_time * 0.05));
  c = 1.0 - (1.0 - c) * (1.0 - prism * stripe * 0.42);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  // Kaleidoscope and Edge Work were in earlier Photo Booth releases.
  kaleido: frag(`
vec4 run(vec2 uv){
  vec2 A = aspectv();
  vec2 c = (uv - u_center) * A;
  float a = atan(c.y, c.x);
  float r = length(c);
  float seg = 6.28318 / 8.0;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r / A + u_center;
  vec2 m = abs(mod(p, 2.0) - 1.0); // mirror at the edges instead of wrapping
  m = 1.0 - m;
  return texture(u_tex, clamp(m, 0.0, 1.0));
}`),

  edgework: frag(`
vec4 run(vec2 uv){
  float e = smoothstep(0.06, 0.42, sobel(uv));
  return vec4(vec3(e), 1.0);
}`),

  // ---- Cute face effects (fall back to a soft grade with no face) ----

  doeeyes: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE {
    float rad = u_faceR * 0.7;
    p = magnify(p, u_eyeL, rad, 0.3 * u_amount);
    p = magnify(p, u_eyeR, rad, 0.3 * u_amount);
  }
  vec3 c = texture(u_tex, clamp(p, 0.0, 1.0)).rgb;
  c = c * 0.96 + 0.04;
  EACH_FACE {
    // Catchlights brighten with a smile and twinkle as you blink.
    float glint = 0.75 + 0.25 * u_expr.z + 0.6 * u_expr.w;
    for (int i = 0; i < 2; i++) {
      vec2 l = faceLocal(uv, i == 0 ? u_eyeL : u_eyeR);
      c = mix(c, vec3(1.0), fill(length(l - vec2(0.07, 0.05)) - 0.035, 0.012) * 0.9);
      vec2 a = abs(l - vec2(0.16, 0.14)) / (0.09 * glint);
      c += vec3(1.0) * max(0.0, 1.0 - (a.x * a.y * 10.0 + length(a) * 0.7)) * u_expr.w;
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  blush: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = mix(c, c * vec3(1.04, 0.97, 0.99) + vec3(0.03, 0.0, 0.01), 0.6);
  EACH_FACE {
    float smile = u_expr.z;
    for (int i = 0; i < 2; i++) {
      vec2 cheek = mix(i == 0 ? u_cheekL : u_cheekR, u_nose, 0.4);
      vec2 l = (faceLocal(uv, cheek) + vec2(0.0, 0.14)) / vec2(1.25, 0.95);
      float a = exp(-dot(l, l) / 0.14) * (0.28 + 0.22 * smile); // smiling deepens the flush
      c = mix(c, c * vec3(1.0, 0.82, 0.86) + vec3(0.1, 0.01, 0.04), a);
    }
    vec2 n = faceLocal(uv, u_nose) - vec2(0.0, 0.18);
    if (abs(n.y) < 0.22 && abs(n.x) < 0.9) {
      vec2 g = n * 22.0;
      vec2 id = floor(g);
      float h = hash21(id + 11.0);
      vec2 pos = id + 0.5 + (vec2(hash21(id + 2.0), hash21(id + 5.0)) - 0.5) * 0.6;
      float dotA = fill(length(g - pos) - 0.13, 0.06) * step(0.72, h) * smoothstep(0.9, 0.5, abs(n.x)) * smoothstep(0.22, 0.12, abs(n.y));
      c = mix(c, c * vec3(0.62, 0.45, 0.36), dotA * 0.8);
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  puppy: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  EACH_FACE {
    float jaw = smoothstep(0.12, 0.6, u_expr.x);
    float perk = smoothstep(0.35, 0.85, u_expr.y);
    // Floppy puppy ears hanging from the sides of the head, with fur and darker
    // tips. Raised eyebrows lift them outward.
    float hang = mix(0.42, 1.3, perk);
    vec2 D = vec2(sin(hang), cos(hang));   // ear direction in (outward, down)
    vec2 P = vec2(cos(hang), -sin(hang));  // across the ear
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 v = faceLocal(uv, u_brow) - vec2(sx * 1.12, -0.2);
      vec2 w = vec2(v.x * sx, -v.y);       // +x away from the face, +y down
      float sway = 0.04 * sin(u_time * 2.2 + sx);
      vec2 q = vec2(dot(w, P), dot(w, D)) + vec2(sway * w.y, 0.0);
      float fuzz = (vnoise(q * vec2(28.0, 8.0)) - 0.5) * 0.045;
      float sdE = dogEar(q, 0.12, 1.25) + fuzz;
      c = dropShadow(c, fill(dogEar(q + vec2(0.06, -0.04), 0.12, 1.25), 0.14));
      float along = clamp(q.y / 1.25, 0.0, 1.0);
      float fur = 0.84 + 0.26 * vnoise(vec2(q.x - 0.12 * q.y * q.y, q.y) * vec2(12.0, 34.0));
      vec3 ear = mix(vec3(0.58, 0.36, 0.19), vec3(0.3, 0.17, 0.09), smoothstep(0.35, 1.0, along)) * fur;
      ear *= 0.82 + 0.3 * smoothstep(0.32, -0.2, q.x);               // rounded: lit on the face side
      ear *= 1.0 - 0.3 * smoothstep(-0.08, 0.0, sdE);                 // soft dark rim
      ear = mix(ear * 0.7, ear, smoothstep(0.0, 0.18, q.y));          // tucked under at the root
      c = mix(c, ear, fill(sdE, 0.015));
    }
    // Glossy nose.
    vec2 n = faceLocal(uv, u_nose) - vec2(0.0, 0.04);
    c = dropShadow(c, fill(ellipse(n + vec2(0.0, 0.05), vec2(0.28, 0.2)), 0.08));
    float nose = fill(ellipse(n, vec2(0.27, 0.19)), 0.015);
    vec3 noseCol = mix(vec3(0.03), vec3(0.18, 0.14, 0.14), smoothstep(-0.2, 0.2, n.y));
    noseCol += vec3(0.75) * fill(ellipse(n - vec2(-0.08, 0.08), vec2(0.08, 0.04)), 0.02);
    c = mix(c, noseCol, nose);
    // Open your mouth: out comes the tongue, with a little wobble.
    if (jaw > 0.01) {
      vec2 m = faceLocal(uv, u_mouth);
      float len = 0.55 * jaw;
      vec2 t = m - vec2(0.03 * sin(u_time * 7.0), -len * 0.5 - 0.02);
      float sdT = max(ellipse(t, vec2(0.2, len * 0.5 + 0.06)), m.y - 0.02);
      float tongue = fill(sdT, 0.015);
      vec3 tCol = litFrom(vec3(0.93, 0.38, 0.45), t, len * 0.5 + 0.06);
      tCol *= 1.0 - 0.3 * fill(abs(t.x) - 0.012, 0.01) * step(t.y, len * 0.3); // centre groove
      c = mix(c, tCol, tongue);
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  kitty: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  EACH_FACE {
    float perk = smoothstep(0.35, 0.85, u_expr.y);
    float jaw = smoothstep(0.1, 0.6, u_expr.x);
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 l = faceLocal(uv, u_brow) - vec2(sx * 0.72, 0.42 + 0.12 * perk);
      l.x *= sx;
      vec2 q = rot2(-0.3 + 0.22 * perk + 0.05 * sin(u_time * 4.0 + sx)) * l;
      float sdO = max(-q.y - 0.32, abs(q.x) * 1.55 + q.y * 0.9 - 0.42);
      float sdI = max(-q.y - 0.22, abs(q.x) * 1.55 + q.y * 0.9 - 0.24);
      vec2 qs = q + vec2(0.0, 0.06);
      c = dropShadow(c, fill(max(-qs.y - 0.32, abs(qs.x) * 1.55 + qs.y * 0.9 - 0.42), 0.1));
      float ear = fill(sdO, 0.02);
      vec3 earCol = litFrom(vec3(0.26, 0.24, 0.27) * (0.9 + 0.2 * vnoise(q * 20.0)), q, 0.42);
      earCol = mix(earCol, litFrom(vec3(0.98, 0.64, 0.72), q, 0.3), fill(sdI, 0.025));
      c = mix(c, earCol, ear);
    }
    vec2 n = faceLocal(uv, u_nose);
    c = mix(c, litFrom(vec3(0.97, 0.52, 0.62), n, 0.1), fill(ellipse(n - vec2(0.0, 0.02), vec2(0.13, 0.09)), 0.012));
    // Whiskers: open your mouth and they twitch.
    float twitch = jaw * 0.08 * sin(u_time * 18.0);
    for (int i = 0; i < 6; i++) {
      float sx = i < 3 ? -1.0 : 1.0;
      float k = float(i - (i < 3 ? 0 : 3)) - 1.0;
      vec2 w = n - vec2(sx * 0.32, -0.12);
      float x = w.x * sx;
      float y = w.y - (k * 0.1 + (k * 0.16 + twitch) * x);
      float on = step(0.0, x) * step(x, 0.75) * fill(abs(y) - 0.01 * (1.0 - x), 0.008);
      c = mix(c, vec3(0.08), on * 0.85);
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  flowercrown: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  c = mix(c, c * vec3(1.03, 0.99, 0.97) + vec3(0.02, 0.01, 0.0), 0.5);
  EACH_FACE {
    float bloom = 1.0 + 0.18 * smoothstep(0.2, 0.8, u_expr.z); // smiling opens the flowers
    float shake = smoothstep(0.35, 0.85, u_expr.y);             // raised brows shake petals loose
    vec2 l = faceLocal(uv, u_brow);
    for (int i = 0; i < 9; i++) {
      float t = float(i) / 8.0;
      float a = mix(-1.25, 1.25, t);
      vec2 centre = vec2(sin(a) * 1.35, 0.05 + cos(a) * 0.3 - 0.4 * (1.0 - cos(a)));
      centre += shake * 0.03 * vec2(sin(u_time * 23.0 + float(i)), cos(u_time * 19.0 + float(i)));
      vec2 leaf = l - (centre + vec2(sin(a + 0.5) * 0.28, -0.12));
      c = mix(c, litFrom(vec3(0.3, 0.56, 0.3), leaf, 0.08), fill(ellipse(leaf, vec2(0.17, 0.08)), 0.015) * 0.95);
      vec2 d = l - centre;
      c = dropShadow(c, fill(length(d + vec2(0.0, 0.06)) - 0.27 * bloom, 0.08));
      float th = atan(d.y, d.x) + float(i);
      float pr = 0.29 * bloom * (0.72 + 0.28 * cos(5.0 * th));
      float petals = fill(length(d) - pr, 0.015);
      vec3 col = i % 3 == 0 ? vec3(1.0, 0.62, 0.72) : (i % 3 == 1 ? vec3(1.0, 0.95, 0.92) : vec3(1.0, 0.76, 0.56));
      col *= 0.82 + 0.18 * smoothstep(0.0, pr, length(d));
      col = litFrom(col, d, pr);
      c = mix(c, col, petals);
      c = mix(c, vec3(1.0, 0.82, 0.25) * (0.9 + 0.2 * vnoise(d * 60.0)), fill(length(d) - 0.075 * bloom, 0.012));
    }
    // Falling petals while the brows are up.
    for (int j = 0; j < 8; j++) {
      float fj = float(j);
      float fall = fract(u_time * 0.5 + hash21(vec2(fj, 3.0)));
      vec2 pos = vec2((hash21(vec2(fj, 7.0)) - 0.5) * 2.6 + 0.15 * sin(u_time * 2.0 + fj), 0.2 - fall * 2.4);
      vec2 d = rot2(u_time * 2.0 + fj) * (l - pos);
      c = mix(c, vec3(1.0, 0.7, 0.8), fill(ellipse(d, vec2(0.09, 0.05)), 0.015) * shake * (1.0 - fall));
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  hearteyes: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  EACH_FACE {
    float smile = smoothstep(0.2, 0.8, u_expr.z);
    float pop = smoothstep(0.35, 0.85, u_expr.y);
    float rate = 3.2 + 3.0 * smile;
    float beat = 1.0 + (0.1 + 0.12 * smile) * pow(abs(sin(u_time * rate)), 6.0);
    float size = 0.56 * beat * (1.0 + 0.35 * pop);
    for (int i = 0; i < 2; i++) {
      vec2 e = faceLocal(uv, i == 0 ? u_eyeL : u_eyeR);
      vec2 l = e / size;
      c = dropShadow(c, fill(sdHeart((e + vec2(0.0, 0.08)) / size + vec2(0.0, 0.55)), 0.15));
      float sd = sdHeart(l + vec2(0.0, 0.55));
      vec3 col = mix(vec3(0.78, 0.04, 0.16), vec3(1.0, 0.25, 0.38), smoothstep(-0.5, 0.6, l.y));
      col += vec3(0.6) * fill(ellipse(l - vec2(-0.22, 0.28), vec2(0.13, 0.08)), 0.03); // gloss
      c = mix(c, col, fill(sd, 0.035));
    }
    // A smile sends little hearts floating up.
    for (int j = 0; j < 6; j++) {
      float fj = float(j);
      float rise = fract(u_time * 0.45 + fj / 6.0);
      vec2 base = faceLocal(uv, u_brow) - vec2((fj - 2.5) * 0.45 + 0.1 * sin(u_time * 2.0 + fj), 0.2 + rise * 1.6);
      float sdS = sdHeart(base / 0.16 + vec2(0.0, 0.55));
      c = mix(c, vec3(1.0, 0.35, 0.5), fill(sdS, 0.05) * smile * (1.0 - rise));
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  glam: frag(`
vec4 run(vec2 uv){
  vec2 p = uv;
  EACH_FACE {
    p = magnify(p, u_cheekL, u_faceR * 1.1, -0.12 * u_amount);
    p = magnify(p, u_cheekR, u_faceR * 1.1, -0.12 * u_amount);
    p = magnify(p, u_eyeL, u_faceR * 0.6, 0.12 * u_amount);
    p = magnify(p, u_eyeR, u_faceR * 0.6, 0.12 * u_amount);
  }
  p = clamp(p, 0.0, 1.0);
  vec3 c = texture(u_tex, p).rgb;
  vec3 b = blur9(p, 2.4);
  c = mix(c, b, 0.55 * (1.0 - smoothstep(0.03, 0.13, length(c - b))));
  c = mix(c, c * vec3(1.03, 0.97, 1.0) + vec3(0.03, 0.0, 0.02), 0.6);
  EACH_FACE {
    vec2 m = faceLocal(uv, u_mouth);
    float lips = exp(-dot(m / vec2(0.55, 0.22), m / vec2(0.55, 0.22)) * 2.0);
    c = mix(c, c * vec3(1.15, 0.7, 0.78), lips * 0.45);
    c += max(b - 0.6, 0.0) * 0.5 * u_expr.z; // a smile adds glow
  }
  return vec4(clamp(c * 0.97 + 0.03, 0.0, 1.0), 1.0);
}`),

  starry: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  EACH_FACE {
    float lift = smoothstep(0.35, 0.85, u_expr.y);
    vec2 l = faceLocal(uv, u_brow) - vec2(0.0, 0.25 + 0.1 * lift);
    int count = 5 + int(3.0 * smoothstep(0.2, 0.7, u_expr.x)); // open your mouth for more stars
    for (int i = 0; i < 8; i++) {
      if (i >= count) break;
      float a = u_time * (1.4 + 2.2 * lift) + float(i) * 6.28318 / float(count);
      vec2 pos = vec2(cos(a) * 1.15, sin(a) * 0.32);
      float depth = 0.75 + 0.25 * sin(a);
      vec2 d = (l - pos) / (0.2 * depth * (1.0 + 0.3 * lift));
      d = rot2(u_time * 2.0 + float(i)) * d;
      float sd = sdStar5(d, 1.0, 0.45);
      c = dropShadow(c, fill(sdStar5(d + vec2(0.0, 0.25), 1.0, 0.45), 0.4) * depth);
      vec3 col = mix(vec3(1.0, 0.72, 0.08), vec3(1.0, 0.96, 0.62), smoothstep(0.6, -0.4, sd));
      c = mix(c, col, fill(sd, 0.08) * (0.6 + 0.4 * depth));
    }
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`),

  rainbowmouth: frag(`
vec4 run(vec2 uv){
  vec3 c = texture(u_tex, uv).rgb;
  EACH_FACE {
    float jaw = smoothstep(0.15, 0.6, u_expr.x);
    if (jaw < 0.01) continue;
    vec2 m = faceLocal(uv, u_mouth);
    // A rainbow pours from an open mouth: bands widen as it falls.
    float y = -m.y;
    if (y > -0.05) {
      float width = 0.22 + y * 0.18;
      float wob = 0.06 * sin(y * 5.0 - u_time * 8.0) * y;
      float x = (m.x - wob) / width;
      float along = smoothstep(-0.05, 0.1, y) * (1.0 - smoothstep(4.0 * jaw, 4.0 * jaw + 0.4, y));
      if (abs(x) < 1.0) {
        vec3 band = hue(clamp((x + 1.0) * 0.5, 0.0, 1.0) * 0.83);
        band *= 0.85 + 0.15 * sin(y * 30.0 - u_time * 14.0);
        float edge = smoothstep(1.0, 0.85, abs(x));
        c = mix(c, band, edge * along * jaw * 0.92);
      }
      // Sparkles riding the stream.
      vec2 g = vec2(m.x * 6.0, (y - u_time * 1.5) * 6.0);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float s = step(0.8, hash21(id)) * max(0.0, 1.0 - length(f) * 6.0);
      c += vec3(s) * along * jaw * step(abs(m.x), width * 1.2);
    }
  }
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
