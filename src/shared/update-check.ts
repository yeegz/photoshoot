// Update check against GitHub Releases. Pure logic only (no Node/DOM), shared
// by the main process (which fetches) and the tests. The only link ever shown
// to the user is the project's own release page.

export const RELEASES_API = 'https://api.github.com/repos/yeegz/photoshoot/releases/latest';
export const RELEASES_PAGE = 'https://github.com/yeegz/photoshoot/releases/latest';
const RELEASE_URL_PREFIX = 'https://github.com/yeegz/photoshoot/releases/';

export type UpdateInfo =
  | { status: 'available'; version: string; url: string }
  | { status: 'current' }
  | { status: 'unavailable' };

interface Parsed {
  nums: [number, number, number];
  pre: boolean;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

function parse(v: string): Parsed | null {
  const m = v.trim().match(VERSION_RE);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: Boolean(m[4]) };
}

/** >0 when a is newer than b, <0 when older, 0 when equal or unparseable. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre !== pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

/** Turn a GitHub "latest release" response into what the app shows. */
export function parseLatestRelease(json: unknown, installed: string): UpdateInfo {
  if (!json || typeof json !== 'object') return { status: 'unavailable' };
  const r = json as Record<string, unknown>;
  if (typeof r.tag_name !== 'string' || !parse(r.tag_name)) return { status: 'unavailable' };
  if (r.draft === true || r.prerelease === true) return { status: 'current' };
  if (compareVersions(r.tag_name, installed) <= 0) return { status: 'current' };
  const url =
    typeof r.html_url === 'string' && r.html_url.startsWith(RELEASE_URL_PREFIX) ? r.html_url : RELEASES_PAGE;
  return { status: 'available', version: r.tag_name.replace(/^v/, ''), url };
}
