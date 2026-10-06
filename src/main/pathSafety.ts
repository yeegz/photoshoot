// Pure path-containment checks for the main process. Kept free of Electron
// imports so they can be unit tested in plain Node. The optional `p` argument
// defaults to the host platform's path module; tests pass `path.win32` or
// `path.posix` to exercise the other platform's rules.

import path from 'node:path';

type PathModule = typeof path.posix;

/**
 * Returns true only when `target` resolves to a location inside `base`.
 * Used to guarantee no operation ever escapes an allowed directory.
 */
export function isInside(base: string, target: string, p: PathModule = path): boolean {
  const rel = p.relative(p.resolve(base), p.resolve(target));
  return rel.length > 0 && !rel.startsWith('..') && !p.isAbsolute(rel);
}

/**
 * Maps an `app://` request URL onto a file inside `distDir`. Returns the file
 * path to serve, `'bad-request'` when the URL cannot be parsed or decoded, or
 * `'forbidden'` when the decoded path would escape `distDir`.
 */
export function resolveAppRequestPath(
  distDir: string,
  requestUrl: string,
  p: PathModule = path
): string | 'bad-request' | 'forbidden' {
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(requestUrl).pathname).replace(/^\/+/, '');
  } catch {
    return 'bad-request';
  }
  if (rel === '') rel = 'index.html';
  const filePath = p.join(distDir, rel);
  if (!isInside(distDir, filePath, p)) return 'forbidden';
  return filePath;
}
