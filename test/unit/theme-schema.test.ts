// Adversarial tests for the zero-trust theme validator (src/shared/theme-schema.ts).
// Imported themes are untrusted data; every value must be squeezed through the
// token whitelist and the per-kind regexes before it can reach the CSSOM.
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COLOR_TOKENS,
  ALLOWED_FONT_TOKENS,
  ALLOWED_LENGTH_TOKENS,
  ALLOWED_SHADOW_TOKENS,
  ALLOWED_TEXTURE_TOKENS,
  THEME_LIMITS,
  detectImageMime,
  isSafeAssetName,
  sanitizeText,
  tokenKind,
  validateTokenValue,
} from '../../src/shared/theme-schema';

describe('tokenKind (whitelist of CSS custom properties)', () => {
  it('classifies every whitelisted token', () => {
    for (const t of ALLOWED_COLOR_TOKENS) expect(tokenKind(t)).toBe('color');
    for (const t of ALLOWED_LENGTH_TOKENS) expect(tokenKind(t)).toBe('length');
    for (const t of ALLOWED_SHADOW_TOKENS) expect(tokenKind(t)).toBe('shadow');
    for (const t of ALLOWED_FONT_TOKENS) expect(tokenKind(t)).toBe('font');
    for (const t of ALLOWED_TEXTURE_TOKENS) expect(tokenKind(t)).toBe('texture');
  });

  it('keeps the token groups disjoint', () => {
    const all = [
      ...ALLOWED_COLOR_TOKENS,
      ...ALLOWED_LENGTH_TOKENS,
      ...ALLOWED_SHADOW_TOKENS,
      ...ALLOWED_FONT_TOKENS,
      ...ALLOWED_TEXTURE_TOKENS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([
    '--unknown',
    'accent',
    '--ACCENT',
    ' --accent',
    '--accent ',
    'color',
    'background-image',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    '',
  ])('rejects non-whitelisted name %j', (name) => {
    expect(tokenKind(name)).toBeNull();
    expect(validateTokenValue(name, 'red').ok).toBe(false);
  });
});

describe('validateTokenValue: happy paths', () => {
  it.each([
    ['--accent', '#fff'],
    ['--accent', '#ffff'],
    ['--accent', '#a1b2c3'],
    ['--accent', '#A1B2C3D4'],
    ['--accent', 'rgb(10, 20, 30)'],
    ['--accent', 'rgba(10, 20, 30, 0.5)'],
    ['--accent', 'rgb(10 20 30 / 50%)'],
    ['--accent', 'hsl(210deg, 40%, 50%)'],
    ['--accent', 'hsla(210, 40%, 50%, .3)'],
    ['--accent', 'rebeccapurple'],
    ['--accent', 'transparent'],
    ['--app-bg', 'linear-gradient(180deg, #fff 0%, #eee 100%)'],
    ['--app-bg', 'radial-gradient(circle, rgba(0,0,0,.2), transparent)'],
    ['--app-bg', 'conic-gradient(red, blue)'],
    ['--radius', '12px'],
    ['--radius', '0'],
    ['--radius', '1.5rem'],
    ['--space', '-4px'],
    ['--radius-pill', '50%'],
    ['--space-lg', '2vh'],
    ['--shadow', '0 12px 34px rgba(0, 0, 0, 0.18)'],
    ['--shutter-shadow', '0 1px 2px rgba(0, 0, 0, 0.22)'],
    ['--shadow-inset', 'inset 0 1px 0 #ffffff'],
    ['--shadow-soft', '0 1px 2px #000, 0 4px 8px rgba(0,0,0,.2)'],
    ['--panel-shadow', '1px 2px black'],
    ['--panel-shadow', '1px 2px 3px 4px'],
    ['--font', '"Inter", system-ui, sans-serif'],
    ['--font-display', "'Playfair Display', serif"],
  ])('accepts %s: %s', (name, value) => {
    const r = validateTokenValue(name, value);
    expect(r).toEqual({ ok: true, value });
  });

  it('trims surrounding whitespace and returns the trimmed value', () => {
    expect(validateTokenValue('--accent', '  #fff \n')).toEqual({ ok: true, value: '#fff' });
  });
});

describe('validateTokenValue: hostile values', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'expression(alert(1))',
    'EXPRESSION(alert(1))',
    'behavior:url(x.htc)',
    '-moz-binding',
    '@import',
    '</style><script>alert(1)</script>',
    '<svg onload=alert(1)>',
    '<script>',
    'http://evil.example/x.png',
    'https://evil.example/x.png',
    'file:///etc/passwd',
    'blob:abc',
    'ftp:x',
    'data:text/html,<b>',
    'data:application/javascript,alert(1)',
    'url(x.png)',
    'URL(x.png)',
    'linear-gradient(red, url(x.png))',
    'red\\3b',
    '\\75 rl(x)',
    'red /* comment */',
    'red */',
    'red; background: url(x)',
    'red}body{background:red',
    'red {',
    '`red`',
    'import(x)',
  ])('rejects forbidden substring in %j for every token kind', (value) => {
    for (const name of ['--accent', '--radius', '--shadow', '--font']) {
      const r = validateTokenValue(name, value);
      expect(r.ok, `${name}: ${value}`).toBe(false);
      expect(r.value).toBeUndefined();
    }
  });

  it.each([undefined, null, 42, true, {}, [], ['red'], { toString: () => 'red' }])(
    'rejects non-string value %j',
    (value) => {
      expect(validateTokenValue('--accent', value).ok).toBe(false);
    }
  );

  it.each(['', '   ', '\n\t'])('rejects empty value %j', (value) => {
    expect(validateTokenValue('--accent', value).ok).toBe(false);
  });

  it('rejects values over the length cap, and accepts one exactly at the cap', () => {
    const atCap = 'a'.repeat(THEME_LIMITS.maxValueLength);
    expect(validateTokenValue('--accent', atCap).ok).toBe(true);
    const over = 'a'.repeat(THEME_LIMITS.maxValueLength + 1);
    const r = validateTokenValue('--accent', over);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too long/);
  });

  it('never accepts a texture value straight from a manifest', () => {
    for (const t of ALLOWED_TEXTURE_TOKENS) {
      expect(validateTokenValue(t, 'data:image/png;base64,AAAA').ok).toBe(false);
      expect(validateTokenValue(t, 'red').ok).toBe(false);
    }
  });

  it.each([
    ['--accent', '12px'],
    ['--accent', 'red blue'],
    ['--accent', 'rgb(1,2,3) extra'],
    ['--accent', 'var(--secret)'],
    ['--accent', 'attr(data-x)'],
    ['--accent', 'image-set("x.png" 1x)'],
    ['--accent', '#ggg'],
    ['--accent', '#12345'],
    ['--radius', '12px 4px'],
    ['--radius', 'calc(1px + 2px)'],
    ['--radius', '10pt'],
    ['--radius', 'red'],
    ['--shadow', 'red'],
    ['--shadow', '1px'],
    ['--shadow', '1px 2px 3px 4px 5px'],
    ['--shadow', 'inset'],
    ['--font', 'Inter (bold)'],
    ['--font', 'Inter:hover'],
    ['--font', 'Inter\u0000'],
  ])('rejects %s value %j that fails its kind regex', (name, value) => {
    const r = validateTokenValue(name, value);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  // Regression: the shadow regex used to have nested, overlapping quantifiers,
  // so a crafted value backtracked exponentially (about 1.8 s at 41 characters
  // and effectively forever at the 600-character cap), freezing the main
  // process at theme import and the renderer when re-validating.
  it.each([
    ['digits then a bad character', '1 '.repeat(299) + '!'],
    ['pairs then a bad character', '1 1 '.repeat(149) + '#'],
    ['comma list then a bad character', '1 1px,'.repeat(99) + '!'],
    ['unit-or-colour ambiguity', '1 2px'.repeat(110) + '!'],
    ['inset chain', 'inset 1 1 '.repeat(59) + '!'],
  ])('validates a hostile shadow (%s) in linear time', (_label, value) => {
    const v = value.slice(0, THEME_LIMITS.maxValueLength);
    const start = performance.now();
    const r = validateTokenValue('--shadow', v);
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(false);
    expect(elapsed).toBeLessThan(250);
  });

  it('still accepts a long, valid, comma-separated shadow list quickly', () => {
    const one = '0 1px 2px rgba(0,0,0,.2)';
    const value = Array.from({ length: 20 }, () => one).join(', ');
    expect(value.length).toBeLessThanOrEqual(THEME_LIMITS.maxValueLength);
    const start = performance.now();
    expect(validateTokenValue('--shadow', value).ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('sanitizeText', () => {
  it('strips markup characters and control characters', () => {
    expect(sanitizeText('<b>{hi}</b>`')).toBe('bhi/b');
    expect(sanitizeText('a\u0000b\u001fc')).toBe('a b c');
  });

  it('caps length and trims', () => {
    // The cap applies before trimming, so leading spaces count towards it.
    expect(sanitizeText('  ' + 'x'.repeat(1000), 10)).toBe('x'.repeat(8));
    expect(sanitizeText('x'.repeat(1000), 10)).toBe('x'.repeat(10));
    expect(sanitizeText('x'.repeat(1000)).length).toBe(THEME_LIMITS.maxTextLength);
  });

  it.each([undefined, null, 1, {}, []])('returns an empty string for non-string %j', (v) => {
    expect(sanitizeText(v)).toBe('');
  });
});

describe('isSafeAssetName', () => {
  it.each(['paper.png', 'Paper.JPG', 'grain.jpeg', 'tex-01_a.webp', 'a b.png'])(
    'accepts plain leaf image name %j',
    (name) => {
      expect(isSafeAssetName(name)).toBe(true);
    }
  );

  it.each([
    '../paper.png',
    '../../etc/passwd.png',
    '..',
    'a..b.png',
    '%2e%2e/paper.png',
    '/etc/paper.png',
    'sub/paper.png',
    '..\\paper.png',
    'C:\\Windows\\paper.png',
    'C:paper.png',
    '\\\\server\\share\\paper.png',
    '.hidden.png',
    'paper.png\u0000.exe',
    'paper\n.png',
    'paper.svg',
    'paper.png.exe',
    'paper.html',
    'pa<per.png',
    'pa|per.png',
    'pa?per.png',
    'pa*per.png',
    'pa"per.png',
    '',
    'a'.repeat(77) + '.png',
  ])('rejects unsafe asset name %j', (name) => {
    expect(isSafeAssetName(name)).toBe(false);
  });

  it('accepts a name exactly at the 80-character cap', () => {
    expect(isSafeAssetName('a'.repeat(76) + '.png')).toBe(true);
  });

  it.each([undefined, null, 1, {}, ['a.png']])('rejects non-string %j', (v) => {
    expect(isSafeAssetName(v)).toBe(false);
  });
});

describe('detectImageMime', () => {
  const pad = (head: number[]) => {
    const b = new Uint8Array(16);
    b.set(head);
    return b;
  };

  it('detects PNG, JPEG and WebP by magic bytes', () => {
    expect(detectImageMime(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(detectImageMime(pad([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(
      detectImageMime(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))
    ).toBe('image/webp');
  });

  it('rejects SVG, HTML, GIF, RIFF-but-not-WebP and truncated input', () => {
    const enc = (s: string) => pad([...new TextEncoder().encode(s)].slice(0, 16));
    expect(detectImageMime(enc('<svg xmlns="x">'))).toBeNull();
    expect(detectImageMime(enc('<html><script>'))).toBeNull();
    expect(detectImageMime(enc('GIF89a.........'))).toBeNull();
    expect(detectImageMime(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectImageMime(new Uint8Array(0))).toBeNull();
  });
});
