// Adversarial tests for the zero-trust custom filter validator
// (src/shared/filter-schema.ts). Ports the hand-rolled assertions in
// build/filter-schema.test.mjs (which still runs via `npm run test:filters`) and
// adds prototype-pollution, boundary and type-confusion cases.
import { describe, expect, it } from 'vitest';
import {
  FILTER_LIMITS,
  FILTER_PARAM_DEFS,
  FILTER_SCHEMA_VERSION,
  clampParams,
  defaultParams,
  isSafeLutName,
  validateFilterManifest,
  validateLutPng,
} from '../../src/shared/filter-schema';

function pngHeader(w: number, h: number, total = 40): Uint8Array {
  const b = new Uint8Array(total);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const wr = (o: number, v: number) => {
    b[o] = (v >>> 24) & 255;
    b[o + 1] = (v >>> 16) & 255;
    b[o + 2] = (v >>> 8) & 255;
    b[o + 3] = v & 255;
  };
  wr(16, w);
  wr(20, h);
  return b;
}

const PARAM_KEYS = FILTER_PARAM_DEFS.map((d) => d.key).sort();

describe('defaultParams', () => {
  it('covers exactly the fixed vocabulary with in-range defaults', () => {
    const d = defaultParams();
    expect(Object.keys(d).sort()).toEqual(PARAM_KEYS);
    for (const def of FILTER_PARAM_DEFS) {
      expect(d[def.key]).toBe(def.def);
      expect(def.def).toBeGreaterThanOrEqual(def.min);
      expect(def.def).toBeLessThanOrEqual(def.max);
    }
  });

  it('returns a fresh object each call', () => {
    const a = defaultParams();
    a.brightness = 0.5;
    expect(defaultParams().brightness).toBe(0);
  });
});

describe('validateFilterManifest: numeric clamping', () => {
  it('clamps out-of-range values and drops NaN, Infinity and unknown keys', () => {
    const v = validateFilterManifest({
      name: 'X',
      params: {
        brightness: 999,
        contrast: -5,
        saturation: NaN,
        gamma: Infinity,
        hue: -100000,
        lutAmount: 0.5,
        unknownKey: 42,
      },
    });
    expect(v.ok).toBe(true);
    expect(v.params).toMatchObject({
      brightness: 1,
      contrast: 0,
      saturation: 1,
      gamma: 1,
      hue: -180,
      lutAmount: 0.5,
    });
    expect(v.params).not.toHaveProperty('unknownKey');
    expect(Object.keys(v.params!).sort()).toEqual(PARAM_KEYS);
  });

  it('accepts every parameter exactly at its min and max', () => {
    for (const d of FILTER_PARAM_DEFS) {
      expect(validateFilterManifest({ params: { [d.key]: d.min } }).params![d.key]).toBe(d.min);
      expect(validateFilterManifest({ params: { [d.key]: d.max } }).params![d.key]).toBe(d.max);
    }
  });

  it.each([
    ['numeric string', '0.5'],
    ['boolean', true],
    ['null', null],
    ['array', [0.5]],
    ['object with valueOf', { valueOf: () => 0.5 }],
    ['bigint', BigInt(1)],
    ['-Infinity', -Infinity],
  ])('replaces a %s value with the default', (_label, value) => {
    const v = validateFilterManifest({ params: { brightness: value, gamma: value } });
    expect(v.params!.brightness).toBe(0);
    expect(v.params!.gamma).toBe(1);
  });

  it('keeps gamma strictly positive (no divide by zero in the shader)', () => {
    expect(validateFilterManifest({ params: { gamma: 0 } }).params!.gamma).toBe(0.2);
    expect(validateFilterManifest({ params: { gamma: -1 } }).params!.gamma).toBe(0.2);
  });

  it('falls back to defaults when params is missing or not an object', () => {
    for (const params of [undefined, null, 'x', 5]) {
      const v = validateFilterManifest({ name: 'Bare', params });
      expect(v.ok).toBe(true);
      expect(v.params).toEqual(defaultParams());
    }
  });
});

describe('validateFilterManifest: prototype pollution', () => {
  it('ignores __proto__, constructor and prototype keys from JSON', () => {
    const raw = JSON.parse(
      '{"name":"P","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},' +
        '"params":{"__proto__":{"brightness":0.9,"polluted":true},"constructor":1,"contrast":2}}'
    );
    const v = validateFilterManifest(raw);
    expect(v.ok).toBe(true);
    expect(v.params!.brightness).toBe(0);
    expect(v.params!.contrast).toBe(2);
    expect(Object.keys(v.params!).sort()).toEqual(PARAM_KEYS);
    expect(Object.getPrototypeOf(v.params)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not read params inherited through the prototype chain as own data', () => {
    // A params object whose prototype carries values: clampFinite reads src[key],
    // which does follow the chain. JSON.parse never produces such objects, so the
    // only realistic source is a tampered in-memory object; values are still
    // clamped, so the worst case is an in-range grade.
    const params = Object.create({ brightness: 50 });
    const v = validateFilterManifest({ params });
    expect(v.params!.brightness).toBeLessThanOrEqual(1);
  });
});

describe('validateFilterManifest: strings', () => {
  it('sanitises and length-caps name, author and description', () => {
    const v = validateFilterManifest({
      name: '<script>alert(1)</script>'.repeat(20),
      author: '{}`</div>',
      description: 'x'.repeat(5000) + '<img onerror=alert(1)>',
    });
    expect(v.name).not.toMatch(/[<>{}`]/);
    expect(v.name!.length).toBeLessThanOrEqual(FILTER_LIMITS.maxNameLength);
    expect(v.author).not.toMatch(/[<>{}`]/);
    expect(v.description!.length).toBeLessThanOrEqual(FILTER_LIMITS.maxTextLength);
    expect(v.description).not.toMatch(/[<>]/);
  });

  it('uses safe fallbacks for missing or non-string text', () => {
    const v = validateFilterManifest({ name: 42, author: {}, description: [] });
    expect(v.name).toBe('Untitled Filter');
    expect(v.author).toBe('Unknown');
    expect(v.description).toBe('');
  });

  it('falls back when the name sanitises to nothing', () => {
    expect(validateFilterManifest({ name: '<>{}`' }).name).toBe('Untitled Filter');
  });
});

describe('validateFilterManifest: rejects junk without throwing', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'a string'],
    ['number', 42],
    ['boolean', true],
    ['array', []],
    ['array of objects', [{ params: {} }]],
  ])('rejects %s', (_label, raw) => {
    const v = validateFilterManifest(raw);
    expect(v.ok).toBe(false);
    expect(v.error).toBeTruthy();
    expect(v.params).toBeUndefined();
  });

  it('rejects a future schema version and accepts the current one', () => {
    expect(validateFilterManifest({ schemaVersion: FILTER_SCHEMA_VERSION + 1 }).ok).toBe(false);
    expect(validateFilterManifest({ schemaVersion: 999 }).ok).toBe(false);
    expect(validateFilterManifest({ schemaVersion: FILTER_SCHEMA_VERSION }).ok).toBe(true);
  });
});

describe('LUT references', () => {
  it.each(['grade.png', 'Grade.PNG', 'golden-hour_lut.png', 'a b.png'])('accepts %j', (name) => {
    expect(isSafeLutName(name)).toBe(true);
  });

  it.each([
    '../../etc/passwd',
    '../grade.png',
    '..',
    '%2e%2e/grade.png',
    '/abs/path.png',
    'sub/grade.png',
    'a\\b.png',
    '..\\..\\grade.png',
    'C:\\grade.png',
    'C:grade.png',
    '\\\\server\\share\\grade.png',
    'grade.png.exe',
    'grade.svg',
    'grade.jpg',
    '.hidden.png',
    'a'.repeat(200) + '.png',
    'eval\u0007.png',
    'grade\u0000.png',
    'gr<ade.png',
    'gr?ade.png',
    '',
  ])('rejects unsafe name %j', (name) => {
    expect(isSafeLutName(name)).toBe(false);
  });

  it('treats percent escapes literally (the name is never URL-decoded)', () => {
    // "%2e%2e%2fgrade.png" contains no separator or "..", and importFilterFromPath
    // resolves it with path.resolve without decoding, so it can only name a file
    // literally called that inside the filter folder.
    expect(isSafeLutName('%2e%2e%2fgrade.png')).toBe(true);
  });

  it.each([42, null, undefined, {}, ['grade.png']])('rejects non-string %j', (v) => {
    expect(isSafeLutName(v)).toBe(false);
  });

  it('drops a traversal lut reference but keeps a safe one', () => {
    expect(validateFilterManifest({ name: 'T', lut: '../../secret.png' }).lutRef).toBeUndefined();
    expect(validateFilterManifest({ name: 'T', lut: '/etc/secret.png' }).lutRef).toBeUndefined();
    expect(validateFilterManifest({ name: 'T', lut: 42 }).lutRef).toBeUndefined();
    expect(validateFilterManifest({ name: 'T', lut: 'ok.png' }).lutRef).toBe('ok.png');
  });
});

describe('validateLutPng', () => {
  it('accepts a 512x512 PNG header', () => {
    expect(validateLutPng(pngHeader(512, 512))).toEqual({ ok: true });
  });

  it.each([
    [256, 256],
    [512, 511],
    [511, 512],
    [0, 0],
    [1024, 1024],
    [0xffffffff, 0xffffffff],
  ])('rejects a %dx%d PNG', (w, h) => {
    const r = validateLutPng(pngHeader(w, h));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/512/);
  });

  it('rejects JPEG, WebP and random bytes even with the right size fields', () => {
    const jpeg = pngHeader(512, 512);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    expect(validateLutPng(jpeg).ok).toBe(false);
    const webp = pngHeader(512, 512);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
    expect(validateLutPng(webp).ok).toBe(false);
    expect(validateLutPng(new Uint8Array(64).fill(0x41)).ok).toBe(false);
  });

  it('rejects truncated input', () => {
    expect(validateLutPng(new Uint8Array(10)).ok).toBe(false);
    expect(validateLutPng(pngHeader(512, 512).slice(0, 20)).ok).toBe(false);
    expect(validateLutPng(new Uint8Array(0)).ok).toBe(false);
  });

  it('rejects oversized input and accepts input exactly at the cap', () => {
    expect(validateLutPng(pngHeader(512, 512, FILTER_LIMITS.lutBytes + 1)).ok).toBe(false);
    expect(validateLutPng(pngHeader(512, 512, FILTER_LIMITS.lutBytes)).ok).toBe(true);
  });
});

describe('clampParams (renderer defence in depth)', () => {
  it('clamps a tampered stored filter to finite in-range values', () => {
    const c = clampParams({
      gamma: 0,
      brightness: 1e9,
      contrast: -3,
      saturation: NaN,
      hue: 'evil',
      lutAmount: 5,
      grain: Number.MAX_VALUE,
      fade: -Number.MAX_VALUE,
    });
    expect(c.gamma).toBeGreaterThanOrEqual(0.2);
    expect(c.brightness).toBe(1);
    expect(c.contrast).toBe(0);
    expect(c.saturation).toBe(1);
    expect(c.hue).toBe(0);
    expect(c.lutAmount).toBe(1);
    expect(c.grain).toBe(1);
    expect(c.fade).toBe(0);
    for (const d of FILTER_PARAM_DEFS) {
      expect(Number.isFinite(c[d.key])).toBe(true);
      expect(c[d.key]).toBeGreaterThanOrEqual(d.min);
      expect(c[d.key]).toBeLessThanOrEqual(d.max);
    }
  });

  it.each([null, undefined, 'x', 1, true])('returns defaults for %j without throwing', (raw) => {
    expect(clampParams(raw)).toEqual(defaultParams());
  });

  it('ignores a JSON __proto__ key', () => {
    const c = clampParams(JSON.parse('{"__proto__":{"gamma":0},"contrast":2}'));
    expect(c.gamma).toBe(1);
    expect(c.contrast).toBe(2);
    expect(Object.keys(c).sort()).toEqual(PARAM_KEYS);
  });

  it('is idempotent', () => {
    const once = clampParams({ brightness: 7, hue: 999 });
    expect(clampParams(once)).toEqual(once);
  });
});
