import { describe, expect, it } from 'vitest';
import { sheetGeometry, type Rect } from '../../src/renderer/stripLayouts';
import { STRIP_LAYOUTS } from '../../src/shared/ipc-contract';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

describe('four-photo sheet layouts', () => {
  for (const layout of STRIP_LAYOUTS) {
    it(`${layout}: four photos on the sheet, none overlapping, with a paper border`, () => {
      const g = sheetGeometry(layout, 1280, 720);
      expect(g.photos).toHaveLength(4);
      for (const p of g.photos) {
        expect(inside(p, g.width, g.height)).toBe(true);
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(Math.abs(p.w / p.h - 1280 / 720)).toBeLessThan(0.02); // never stretched
      }
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlaps(g.photos[i], g.photos[j])).toBe(false);
      if (g.caption) {
        expect(inside(g.caption, g.width, g.height)).toBe(true);
        for (const p of g.photos) expect(overlaps(p, g.caption)).toBe(false);
      }
    });
  }

  it('the classic strip is tall with a date line, the row is wide, the grid matches Photo Booth', () => {
    const strip = sheetGeometry('strip', 1280, 720);
    expect(strip.height).toBeGreaterThan(strip.width * 2);
    expect(strip.caption).not.toBeNull();
    const row = sheetGeometry('row', 1280, 720);
    expect(row.width).toBeGreaterThan(row.height * 4);
    const grid = sheetGeometry('grid', 1280, 720);
    expect(grid.width / grid.height).toBeGreaterThan(1);
    expect(grid.photos[1].x).toBeGreaterThan(grid.photos[0].x);
    expect(grid.photos[2].y).toBeGreaterThan(grid.photos[0].y);
  });

  it('feature puts the first photo big over three equal small ones', () => {
    const g = sheetGeometry('feature', 1280, 720);
    const [big, ...small] = g.photos;
    expect(big.w).toBe(1280);
    for (const s of small) {
      expect(s.y).toBeGreaterThan(big.y + big.h);
      expect(s.w).toBe(small[0].w);
    }
    // The small row spans the big photo's width.
    expect(small[2].x + small[2].w).toBeLessThanOrEqual(big.x + big.w + 1);
    expect(small[2].x + small[2].w).toBeGreaterThan(big.x + big.w - 3);
  });
});
