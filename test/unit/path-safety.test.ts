// Adversarial tests for the main-process path-containment guards
// (src/main/pathSafety.ts): `isInside`, used before every capture read, write,
// export, delete and theme/filter asset read, and `resolveAppRequestPath`, the
// core of the custom app:// protocol handler that serves the renderer.
// Both POSIX and Windows rules are exercised on every host by passing the
// explicit path module.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, resolveAppRequestPath } from '../../src/main/pathSafety';

const { posix, win32 } = path;

describe('isInside (POSIX rules)', () => {
  const base = '/home/u/Pictures/Photoshoot';

  it.each([
    'Photoshoot_single_2026-06-13_22-04-31.png',
    'sub/dir/file.webm',
    './file.png',
    'a/../file.png',
    'file..png',
  ])('accepts %j inside the base', (rel) => {
    expect(isInside(base, posix.join(base, rel), posix)).toBe(true);
  });

  it('accepts a target written with redundant segments', () => {
    expect(isInside('/srv', '/srv/./etc//x', posix)).toBe(true);
  });

  it.each([
    ['the base itself', base],
    ['the base with a trailing slash', base + '/'],
    ['the parent', '/home/u/Pictures'],
    ['a parent traversal', base + '/../secret.png'],
    ['a deep traversal', base + '/a/b/../../../../../../etc/passwd'],
    ['a sibling sharing the prefix', '/home/u/Pictures/Photoshoot-evil/x.png'],
    ['a sibling sharing the prefix without separator', '/home/u/Pictures/Photoshootx'],
    ['an unrelated absolute path', '/etc/passwd'],
    ['the filesystem root', '/'],
  ])('rejects %s', (_label, target) => {
    expect(isInside(base, target, posix)).toBe(false);
  });

  it('does not decode percent escapes (they are literal file name characters)', () => {
    // %2e%2e is not "..": on disk it is a directory literally named "%2e%2e".
    expect(isInside(base, base + '/%2e%2e/secret', posix)).toBe(true);
    expect(isInside(base, base + '/%2e%2e', posix)).toBe(true);
  });

  it('treats a backslash as an ordinary character on POSIX', () => {
    // "..\\x" is a single leaf whose name starts with "..". It is inside the base
    // on disk, but isInside is conservative and rejects any relative path that
    // begins with "..". Documented here so a change to that rule is deliberate.
    expect(isInside(base, base + '/..\\x', posix)).toBe(false);
    expect(isInside(base, base + '/a\\..\\..\\x', posix)).toBe(true);
  });

  it('is conservative about leaf names that merely start with ".."', () => {
    // Fails closed: a file called "..foo" is refused rather than allowed.
    expect(isInside(base, base + '/..foo', posix)).toBe(false);
    expect(isInside(base, base + '/...png', posix)).toBe(false);
  });

  it('is lexical only: it cannot see through symlinks', () => {
    // A symlink inside the base that points elsewhere still passes. Callers that
    // read untrusted packages must lstat and refuse symlinks (filterImport does).
    expect(isInside(base, base + '/link-to-etc/passwd', posix)).toBe(true);
  });
});

describe('isInside (Windows rules)', () => {
  const base = 'C:\\Users\\u\\Pictures\\Photoshoot';

  it.each([
    'C:\\Users\\u\\Pictures\\Photoshoot\\shot.png',
    'C:/Users/u/Pictures/Photoshoot/shot.png',
    'c:\\users\\U\\pictures\\photoshoot\\shot.png',
    'C:\\Users\\u\\Pictures\\Photoshoot\\a\\..\\shot.png',
  ])('accepts %j', (target) => {
    expect(isInside(base, target, win32)).toBe(true);
  });

  it.each([
    ['the base itself', base],
    ['a backslash traversal', base + '\\..\\..\\secret.png'],
    ['a forward-slash traversal', base + '/../../secret.png'],
    ['a mixed-separator traversal', base + '\\sub/..\\..\\x'],
    ['a prefix sibling', 'C:\\Users\\u\\Pictures\\Photoshoot-evil\\x.png'],
    ['another drive', 'D:\\Users\\u\\Pictures\\Photoshoot\\x.png'],
    ['a UNC path', '\\\\server\\share\\x.png'],
    ['a device path', '\\\\?\\C:\\Windows\\win.ini'],
    ['a root-relative path on the same drive', '\\Windows\\win.ini'],
  ])('rejects %s', (_label, target) => {
    expect(isInside(base, target, win32)).toBe(false);
  });
});

describe('resolveAppRequestPath (POSIX rules)', () => {
  const dist = '/opt/Photoshoot/resources/app/dist';
  const resolve = (url: string) => resolveAppRequestPath(dist, url, posix);

  it('serves index.html for the origin root', () => {
    expect(resolve('app://photoshoot/')).toBe(posix.join(dist, 'index.html'));
    expect(resolve('app://photoshoot')).toBe(posix.join(dist, 'index.html'));
  });

  it.each([
    ['app://photoshoot/index.html', 'index.html'],
    ['app://photoshoot/main.js', 'main.js'],
    ['app://photoshoot/mediapipe/vision_wasm_internal.wasm', 'mediapipe/vision_wasm_internal.wasm'],
    ['app://photoshoot/styles/app.css?v=1#x', 'styles/app.css'],
    ['app://photoshoot/a%20b.png', 'a b.png'],
    ['app://photoshoot/mediapipe/../index.html', 'index.html'],
    ['app://photoshoot///main.js', 'main.js'],
  ])('maps %s inside dist', (url, rel) => {
    expect(resolve(url)).toBe(posix.join(dist, rel));
  });

  it.each([
    'app://photoshoot/../../etc/passwd',
    'app://photoshoot/%2e%2e/%2e%2e/etc/passwd',
    'app://photoshoot/%2E%2E/%2E%2E/etc/passwd',
    'app://photoshoot/.%2e/.%2e/etc/passwd',
    'app://photoshoot//etc/passwd',
  ])('keeps URL-level dot segments inside dist: %s', (url) => {
    // The URL parser collapses these before decoding, so they can never climb
    // above the origin root; the result must still be inside dist.
    const out = resolve(url);
    expect(out).not.toBe('forbidden');
    expect(out).not.toBe('bad-request');
    expect(isInside(dist, out, posix)).toBe(true);
  });

  it.each([
    'app://photoshoot/a%2F..%2F..%2Fsecret',
    'app://photoshoot/%2F..%2F..%2Fetc%2Fpasswd',
    'app://photoshoot/x/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd',
    'app://photoshoot/..%2F..%2F..%2Fetc%2Fpasswd',
    'app://photoshoot/..%5C..%5Cetc',
  ])('forbids encoded-separator traversal %s', (url) => {
    expect(resolve(url)).toBe('forbidden');
  });

  it('forbids an absolute path smuggled in through encoded slashes', () => {
    // Leading slashes are stripped and the remainder joined under dist, so the
    // worst case stays inside; anything climbing out is refused.
    const out = resolve('app://photoshoot/%2Fetc%2Fpasswd');
    expect(out).toBe(posix.join(dist, 'etc/passwd'));
  });

  it('decodes only once (double encoding stays literal)', () => {
    expect(resolve('app://photoshoot/%252e%252e/%252e%252e/etc')).toBe(
      posix.join(dist, '%2e%2e/%2e%2e/etc')
    );
  });

  it.each(['app://photoshoot/%E0%A4%A', 'app://photoshoot/%', 'app://photoshoot/%zz', 'not a url', ''])(
    'returns bad-request for undecodable or unparseable %j',
    (url) => {
      expect(resolve(url)).toBe('bad-request');
    }
  );

  it('serves index.html when URL dot segments collapse to the root', () => {
    expect(resolve('app://photoshoot/.')).toBe(posix.join(dist, 'index.html'));
    expect(resolve('app://photoshoot/a/%2e%2e')).toBe(posix.join(dist, 'index.html'));
    expect(resolve('app://photoshoot/%2e%2e')).toBe(posix.join(dist, 'index.html'));
  });

  it('forbids a decoded path that resolves to dist itself', () => {
    expect(resolve('app://photoshoot/a%2F..')).toBe('forbidden');
  });

  it('keeps an oversized path inside dist', () => {
    const long = 'a/'.repeat(5000) + 'x.js';
    const out = resolve('app://photoshoot/' + long);
    expect(isInside(dist, out, posix)).toBe(true);
    const climb = 'app://photoshoot/' + '..%2F'.repeat(5000) + 'etc/passwd';
    expect(resolve(climb)).toBe('forbidden');
  });
});

describe('resolveAppRequestPath (Windows rules)', () => {
  const dist = 'C:\\Program Files\\Photoshoot\\resources\\app\\dist';
  const resolve = (url: string) => resolveAppRequestPath(dist, url, win32);

  it('maps a normal asset with Windows separators', () => {
    expect(resolve('app://photoshoot/mediapipe/model.task')).toBe(
      win32.join(dist, 'mediapipe', 'model.task')
    );
    expect(resolve('app://photoshoot/sub%5Cfile.js')).toBe(win32.join(dist, 'sub', 'file.js'));
  });

  it.each([
    'app://photoshoot/..%5C..%5Cwindows%5Cwin.ini',
    'app://photoshoot/..%5c..%5c..%5c..%5cWindows%5cwin.ini',
    'app://photoshoot/sub%5C..%5C..%5C..%5Csecret',
    'app://photoshoot/..%2F..%2FWindows/win.ini',
    'app://photoshoot/%2e%2e%5c%2e%2e%5cx',
  ])('forbids backslash or mixed traversal %s', (url) => {
    expect(resolve(url)).toBe('forbidden');
  });

  it.each([
    'app://photoshoot/C:%5CWindows%5Cwin.ini',
    'app://photoshoot/D:%5Csecret.txt',
    'app://photoshoot/%5C%5Cserver%5Cshare%5Cx',
    'app://photoshoot/%5C%5C%3F%5CC:%5CWindows',
  ])('never serves a drive, UNC or device path outside dist: %s', (url) => {
    const out = resolve(url);
    if (out !== 'forbidden') expect(isInside(dist, out, win32)).toBe(true);
  });
});
