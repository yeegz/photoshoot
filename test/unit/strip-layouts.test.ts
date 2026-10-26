import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, footerLines, sheetGeometry, type PrintOptions, type Rect } from '../../src/renderer/stripLayouts';
import { STRIP_LAYOUTS } from '../../src/shared/ipc-contract';

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const ALL: PrintOptions = { ...DEFAULT_PRINT, name: true, date: true, caption: 'Sara turns 30' };
const NONE: PrintOptions = { ...DEFAULT_PRINT, name: false, date: false, caption: '' };

describe('four-photo sheet layouts', () => {
  for (const layout of STRIP_LAYOUTS) {
    for (const [label, print] of [['with a footer', ALL], ['without a footer', NONE]] as const) {
      it(`${layout} ${label}: four photos on the sheet, none overlapping, never stretched`, () => {
        const g = sheetGeometry(layout, 1280, 720, print);
        expect(g.photos).toHaveLength(4);
        for (const p of g.photos) {
          expect(inside(p, g.width, g.height)).toBe(true);
          expect(p.x).toBeGreaterThan(0);
          expect(p.y).toBeGreaterThan(0);
          expect(Math.abs(p.w / p.h - 1280 / 720)).toBeLessThan(0.02);
        }
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlaps(g.photos[i], g.photos[j])).toBe(false);
        if (g.footer) {
          expect(inside(g.footer, g.width, g.height)).toBe(true);
          for (const p of g.photos) expect(overlaps(p, g.footer)).toBe(false);
          for (const l of g.lines) {
            expect(l.y - l.size).toBeGreaterThanOrEqual(g.footer.y);
            expect(l.y).toBeLessThan(g.height);
          }
        }
      });
    }
  }

  it('footer lines follow the options, in print order', () => {
    expect(footerLines(ALL)).toEqual(['caption', 'date', 'name']);
    expect(footerLines({ ...ALL, caption: '   ' })).toEqual(['date', 'name']);
    expect(footerLines({ ...ALL, name: false })).toEqual(['caption', 'date']);
    expect(footerLines(NONE)).toEqual([]);
    expect(sheetGeometry('strip', 1280, 720, NONE).footer).toBeNull();
  });

  it('the Photoshoot mark is small and sits in the corner opposite the text', () => {
    const centre = sheetGeometry('strip', 1280, 720, ALL).lines;
    const mark = centre.find((l) => l.kind === 'name')!;
    const caption = centre.find((l) => l.kind === 'caption')!;
    expect(mark.size).toBeLessThan(caption.size / 2);
    expect(mark.align).toBe('right');
    const right = sheetGeometry('strip', 1280, 720, { ...ALL, align: 'right' }).lines;
    expect(right.find((l) => l.kind === 'name')!.align).toBe('left');
    expect(right.find((l) => l.kind === 'caption')!.align).toBe('right');
    const alone = sheetGeometry('strip', 1280, 720, { ...NONE, name: true }).lines;
    expect(alone).toHaveLength(1);
    expect(alone[0].align).toBe('center');
  });

  it('larger text makes a taller footer', () => {
    const h = (size: PrintOptions['size']) => sheetGeometry('strip', 1280, 720, { ...ALL, size }).height;
    expect(h('s')).toBeLessThan(h('m'));
    expect(h('m')).toBeLessThan(h('l'));
  });

  it('a footer adds height; each extra line adds more', () => {
    const h = (p: PrintOptions) => sheetGeometry('strip', 1280, 720, p).height;
    expect(h({ ...NONE, name: true })).toBeGreaterThan(h(NONE));
    expect(h(ALL)).toBeGreaterThan(h({ ...NONE, name: true }));
    const lines = sheetGeometry('strip', 1280, 720, ALL).lines;
    expect(lines[0].y).toBeLessThan(lines[1].y);
    expect(lines[1].y).toBeLessThan(lines[2].y);
  });

  it('the strip is tall, the row is wide, the grid is a near-square sheet', () => {
    const strip = sheetGeometry('strip', 1280, 720, ALL);
    expect(strip.height).toBeGreaterThan(strip.width * 2);
    const row = sheetGeometry('row', 1280, 720, NONE);
    expect(row.width).toBeGreaterThan(row.height * 4);
    const grid = sheetGeometry('grid', 1280, 720, NONE);
    expect(grid.width / grid.height).toBeGreaterThan(1);
    expect(grid.photos[1].x).toBeGreaterThan(grid.photos[0].x);
    expect(grid.photos[2].y).toBeGreaterThan(grid.photos[0].y);
  });

  it('feature puts the first photo big over three equal small ones spanning its width', () => {
    const g = sheetGeometry('feature', 1280, 720, NONE);
    const [big, ...small] = g.photos;
    expect(big.w).toBe(1280);
    for (const s of small) {
      expect(s.y).toBeGreaterThan(big.y + big.h);
      expect(s.w).toBe(small[0].w);
    }
    expect(small[2].x + small[2].w).toBeLessThanOrEqual(big.x + big.w + 1);
    expect(small[2].x + small[2].w).toBeGreaterThan(big.x + big.w - 3);
  });
});
