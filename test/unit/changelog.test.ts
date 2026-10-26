import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHANGELOG, changesSince } from '../../src/shared/changelog';
import { compareVersions } from '../../src/shared/update-check';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

describe("What's New", () => {
  it('the newest entry is the version being shipped', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version);
  });

  it('is newest first, with dated entries that each say something', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items.length).toBeGreaterThan(0);
      for (const item of e.items) {
        expect(item.lead.trim()).not.toBe('');
        expect(item.text.trim()).not.toBe('');
      }
    }
  });

  it('after an update shows only the releases since the version last seen', () => {
    expect(changesSince('1.3.0', compareVersions).map((e) => e.version)).toEqual(['1.5.1', '1.4.0']);
    expect(changesSince(pkg.version, compareVersions)).toEqual([]);
    expect(changesSince('', compareVersions)).toBe(CHANGELOG);
  });
});
