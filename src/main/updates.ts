// Asks GitHub Releases whether a newer Photoshoot exists. Runs in the main
// process with Node's fetch, so the renderer's network block stays intact.
// Only the version number and release page are read; nothing is sent beyond a
// plain GET with a User-Agent header (GitHub requires one).

import { RELEASES_API, parseLatestRelease, type UpdateInfo } from '../shared/update-check';

export async function checkForUpdate(installed: string): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Photoshoot/${installed}` },
      signal: controller.signal,
    });
    if (!res.ok) return { status: 'unavailable' };
    return parseLatestRelease(await res.json(), installed);
  } catch {
    return { status: 'unavailable' }; // offline, blocked or timed out: stay quiet
  } finally {
    clearTimeout(timer);
  }
}
