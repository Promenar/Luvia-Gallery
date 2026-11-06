import { describe, expect, it } from 'vitest';
import { aspectOf, justifyRows, squareRows } from './justify';

describe('对齐行布局', () => {
  const items = [1.5, 0.75, 1, 1.78, 1.33, 0.66, 1.5, 1].map((ratio) => ({ ratio }));

  it('除最后一行外每行宽度恰好填满容器', () => {
    const rows = justifyRows(items, (i) => i.ratio, 1000, 180, 4);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows.slice(0, -1)) {
      const w = r.cells.reduce((a, c) => a + c.width, 0) + 4 * (r.cells.length - 1);
      expect(w).toBeCloseTo(1000, 6);
      expect(r.height).toBeLessThanOrEqual(180);
    }
  });

  it('最后一行不被拉得过高，索引连续，行顶部累加', () => {
    const rows = justifyRows(items, (i) => i.ratio, 1000, 180, 4, 10);
    expect(rows.at(-1)!.height).toBeLessThanOrEqual(180 * 1.25);
    expect(rows.flatMap((r) => r.cells.map((c) => c.index))).toEqual(items.map((_, i) => i + 10));
    expect(rows[1]!.top).toBeCloseTo(rows[0]!.height + 4, 6);
  });

  it('未知尺寸按 1:1，极端比例被限制', () => {
    expect(aspectOf({ width: null, height: 100 })).toBe(1);
    expect(aspectOf({ width: 10000, height: 100 })).toBe(3.2);
    expect(aspectOf({ width: 100, height: 10000 })).toBe(0.4);
  });

  it('方形网格列数与边长', () => {
    const rows = squareRows(items, 1000, 180, 4);
    const cols = rows[0]!.cells.length;
    expect(cols).toBe(5);
    expect(rows[0]!.cells[0]!.width * cols + 4 * (cols - 1)).toBeCloseTo(1000, 6);
  });
});

describe('aspectOf 使用列表加载后补到的宽高', () => {
  it('列表项缺宽高时按补到的宽高计算，已有宽高时不被覆盖', async () => {
    const { addDimensions } = await import('@/lib/dimension-cache');
    expect(aspectOf({ id: 'late', width: null, height: null })).toBe(1);
    addDimensions([{ id: 'late', width: 1600, height: 800 }, { id: 'own', width: 100, height: 100 }]);
    expect(aspectOf({ id: 'late', width: null, height: null })).toBe(2);
    expect(aspectOf({ id: 'own', width: 300, height: 200 })).toBe(1.5);
  });
});
