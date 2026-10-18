import { describe, expect, it } from 'vitest';
import { compareVersions, parseLatestRelease, RELEASES_PAGE } from '../../src/shared/update-check';

describe('compareVersions', () => {
  it('orders semantic versions numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats a pre-release as older than its release', () => {
    expect(compareVersions('1.3.0-beta.1', '1.3.0')).toBeLessThan(0);
  });

  it('treats unparseable input as no update', () => {
    expect(compareVersions('nonsense', '1.0.0')).toBe(0);
  });
});

describe('parseLatestRelease', () => {
  const release = {
    tag_name: 'v1.3.0',
    html_url: 'https://github.com/yeegz/photoshoot/releases/tag/v1.3.0',
    draft: false,
    prerelease: false,
  };

  it('reports a newer published release', () => {
    expect(parseLatestRelease(release, '1.2.0')).toEqual({
      status: 'available',
      version: '1.3.0',
      url: 'https://github.com/yeegz/photoshoot/releases/tag/v1.3.0',
    });
  });

  it('reports current when the installed version is the latest or newer', () => {
    expect(parseLatestRelease(release, '1.3.0')).toEqual({ status: 'current' });
    expect(parseLatestRelease(release, '1.4.0')).toEqual({ status: 'current' });
  });

  it('ignores drafts and pre-releases', () => {
    expect(parseLatestRelease({ ...release, draft: true }, '1.2.0')).toEqual({ status: 'current' });
    expect(parseLatestRelease({ ...release, prerelease: true }, '1.2.0')).toEqual({ status: 'current' });
  });

  it('never trusts a download link outside the project releases page', () => {
    const evil = { ...release, html_url: 'https://evil.example/photoshoot.exe' };
    expect(parseLatestRelease(evil, '1.2.0')).toEqual({ status: 'available', version: '1.3.0', url: RELEASES_PAGE });
  });

  it('handles malformed responses as unavailable', () => {
    expect(parseLatestRelease(null, '1.2.0')).toEqual({ status: 'unavailable' });
    expect(parseLatestRelease({ tag_name: 42 }, '1.2.0')).toEqual({ status: 'unavailable' });
  });
});
