import { describe, expect, it } from 'vitest';
import {
  buildOrder, counterText, dedupe, excludeIds, extendOrder, filePath, filmCount, filmWindow, formatBytes, formatExposure,
  formatTakenAt, reorder, shouldLoadMore, shuffled, step,
} from './sequence';

/** 可复现的伪随机数。 */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const isPermutation = (a: number[], n: number) => a.length === n && new Set(a).size === n && a.every((v) => v >= 0 && v < n);

describe('幻灯片顺序', () => {
  it('顺序播放为 0..n-1，pos 指向打开的那一项', () => {
    expect(buildOrder(5, 3, false)).toEqual({ order: [0, 1, 2, 3, 4], pos: 3 });
    expect(buildOrder(5, 99, false).pos).toBe(4);
  });

  it('随机：打开的那一项排第一，其余是排列', () => {
    const { order, pos } = buildOrder(50, 17, true, seeded());
    expect(pos).toBe(0);
    expect(order[0]).toBe(17);
    expect(isPermutation(order, 50)).toBe(true);
    expect(order).not.toEqual([17, ...Array.from({ length: 50 }, (_, i) => i).filter((i) => i !== 17)]);
  });

  it('shuffled 不改动原数组且保留元素', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = shuffled(src, seeded(3));
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
  });

  it('续页追加：顺序时按下标，随机时只打乱新增部分', () => {
    expect(extendOrder([2, 0, 1], 5, false)).toEqual([2, 0, 1, 3, 4]);
    const ext = extendOrder([2, 0, 1], 10, true, seeded());
    expect(ext.slice(0, 3)).toEqual([2, 0, 1]);
    expect(isPermutation(ext, 10)).toBe(true);
  });

  it('播放中切换随机：保留已看部分；切回顺序时定位当前项', () => {
    const r = reorder([0, 1, 2, 3, 4, 5, 6, 7], 2, true, seeded());
    expect(r.order.slice(0, 3)).toEqual([0, 1, 2]);
    expect(r.pos).toBe(2);
    expect(isPermutation(r.order, 8)).toBe(true);
    const back = reorder([5, 2, 7, 0, 1, 3, 4, 6], 2, false);
    expect(back.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(back.pos).toBe(7);
  });
});

describe('翻页与推进', () => {
  const o = (auto: boolean, loop: boolean, canLoadMore: boolean) => ({ auto, loop, canLoadMore });

  it('中间正常前后移动', () => {
    expect(step(3, 10, 1, o(false, true, false))).toEqual({ kind: 'go', pos: 4 });
    expect(step(3, 10, -1, o(false, true, false))).toEqual({ kind: 'go', pos: 2 });
  });

  it('到末尾还能续页时等待加载', () => {
    expect(step(9, 10, 1, o(true, true, true))).toEqual({ kind: 'wait' });
    expect(step(9, 10, 1, o(false, false, true))).toEqual({ kind: 'wait' });
  });

  it('幻灯片到末尾：loop 从头，否则结束', () => {
    expect(step(9, 10, 1, o(true, true, false))).toEqual({ kind: 'go', pos: 0 });
    expect(step(9, 10, 1, o(true, false, false))).toEqual({ kind: 'end' });
    expect(step(0, 1, 1, o(true, true, false))).toEqual({ kind: 'end' });
  });

  it('手动翻页首尾相接；单项不动', () => {
    expect(step(9, 10, 1, o(false, false, false))).toEqual({ kind: 'go', pos: 0 });
    expect(step(0, 10, -1, o(false, false, false))).toEqual({ kind: 'go', pos: 9 });
    expect(step(0, 1, 1, o(false, true, false))).toEqual({ kind: 'stay' });
    expect(step(0, 10, -1, o(false, true, true))).toEqual({ kind: 'stay' });
  });

  it('预取阈值', () => {
    expect(shouldLoadMore(0, 100)).toBe(false);
    expect(shouldLoadMore(94, 100)).toBe(true);
    expect(shouldLoadMore(93, 100)).toBe(false);
  });
});

describe('随机续播排除与去重', () => {
  const items = Array.from({ length: 800 }, (_, i) => ({ id: `m${i}` }));

  it('排除最近 500 个', () => {
    const ex = excludeIds(items);
    expect(ex).toHaveLength(500);
    expect(ex[0]).toBe('m300');
    expect(ex.at(-1)).toBe('m799');
    expect(excludeIds(items.slice(0, 3))).toEqual(['m0', 'm1', 'm2']);
  });

  it('dedupe 去掉已有项与本批内重复项', () => {
    expect(dedupe([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }]).map((m) => m.id)).toEqual(['b', 'c']);
  });
});

describe('文案与格式', () => {
  it('计数：总数已知、已全部加载、总数未知', () => {
    expect(counterText(4, 120, 1043, true)).toBe('第 5 项，共 1043 项');
    expect(counterText(0, 12, null, false)).toBe('第 1 项，共 12 项');
    expect(counterText(130, 240, null, true)).toBe('第 131 项');
  });

  it('胶片条窗口以当前项为中心并贴边', () => {
    expect(filmWindow(50, 100, 13)).toEqual([44, 57]);
    expect(filmWindow(1, 100, 13)).toEqual([0, 13]);
    expect(filmWindow(99, 100, 13)).toEqual([87, 100]);
    expect(filmWindow(2, 5, 13)).toEqual([0, 5]);
  });

  it('胶片条数量随宽度变化，且为奇数', () => {
    expect(filmCount(1440)).toBe(13);
    expect(filmCount(375)).toBe(5);
    expect(filmCount(200)).toBe(3);
    for (const w of [320, 375, 414, 600, 800]) expect(filmCount(w) % 2).toBe(1);
  });

  it('拍摄时间按拍摄地墙上时间显示', () => {
    expect(formatTakenAt('2025-09-14T18:32:05+08:00')).toBe('2025 年 9 月 14 日 周日 18:32');
    expect(formatTakenAt('2024-10-27T23:59:00-07:00')).toBe('2024 年 10 月 27 日 周日 23:59');
    expect(formatTakenAt('nonsense')).toBe('nonsense');
  });

  it('大小、曝光、文件路径', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatExposure(1 / 250)).toBe('1/250');
    expect(formatExposure(2)).toBe('2″');
    expect(filePath([{ name: '家庭照片' }, { name: '2025' }, { name: '09 上海' }], 'IMG_1.jpg')).toBe('家庭照片/2025/09 上海/IMG_1.jpg');
  });
});
