import { describe, expect, it } from 'vitest';
import type { MediaItem, MediaListQuery, MediaPage, TimelineBucket } from '@luvia/contracts';
import {
  anchorAt, assignMonths, bucketIndexAt, buildLayout, dayLabel, estimateHeight, groupByDay, mergeSegments, monthAtOffset,
  monthStates, planLoad, resolveAnchor, rowAt, topFolders, type LayoutMetrics, type Segment,
} from './timeline';
import { bucketAtY, distribute, layoutRuler, yForBucket } from './ruler';
import { createTimelineStore } from './store';

/* ---------- 测试数据：按 UTC 分桶（与服务器时区为 UTC 时一致） ---------- */

function item(id: string, iso: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id, name: `${id}.jpg`, folder: 'photos/2025/上海', mediaType: 'image', mime: 'image/jpeg', size: 1, width: 4000, height: 3000,
    durationSec: null, takenAt: iso, takenAtSource: 'metadata', modifiedAt: 0, favorite: false, thumbhash: null, thumbVersion: 1,
    hasLocation: false, playability: null, hasPreview: false, ...extra,
  };
}

/** 生成 months 个月（从 2025-12 往前），每月 perMonth 项，返回倒序媒体与分桶。 */
function dataset(months: number, perMonth: (i: number) => number) {
  const items: MediaItem[] = [];
  const buckets: TimelineBucket[] = [];
  let n = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(2025, 11 - i, 1));
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const count = perMonth(i);
    for (let k = 0; k < count; k++) {
      const day = 28 - Math.floor((k * 27) / Math.max(1, count));
      items.push(item(`x${n++}`, new Date(Date.UTC(y, m, day, 12, 59 - (k % 60))).toISOString()));
    }
    if (count) buckets.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, count, start: Date.UTC(y, m, 1) / 1000, end: Date.UTC(y, m + 1, 1) / 1000 });
  }
  items.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return { items, buckets };
}

/** 模拟 listMedia：支持 to 上界与偏移游标。 */
function fakeServer(items: MediaItem[]) {
  const calls: MediaListQuery[] = [];
  const fetchPage = async (q: MediaListQuery): Promise<MediaPage> => {
    calls.push(q);
    const list = q.to != null ? items.filter((it) => Date.parse(it.takenAt) / 1000 < Number(q.to)) : items;
    const off = Number(q.cursor ?? 0);
    const lim = Number(q.limit ?? 120);
    return { items: list.slice(off, off + lim), nextCursor: off + lim < list.length ? String(off + lim) : null, total: list.length };
  };
  return { fetchPage, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function seg(p: Partial<Segment> & Pick<Segment, 'id' | 'startIdx'>, buckets: TimelineBucket[]): Segment {
  const items = p.items ?? [];
  return {
    items, months: p.months ?? assignMonths(buckets, items, p.startIdx), ids: new Set(items.map((i) => i.id)), cursor: null,
    cursorQuery: {}, loadedOnce: true, done: false, loading: false, error: null, ...p,
  };
}

const M: LayoutMetrics = { width: 1000, rowHeight: 180, gap: 3, square: false, monthHeight: 110, dayHeight: 42 };

describe('月份归属与按天分组', () => {
  const { buckets } = dataset(3, () => 5);

  it('二分查找时间所在的桶，桶外返回 -1', () => {
    expect(bucketIndexAt(buckets, Date.UTC(2025, 11, 15) / 1000)).toBe(0);
    expect(bucketIndexAt(buckets, Date.UTC(2025, 10, 1) / 1000)).toBe(1);
    expect(bucketIndexAt(buckets, Date.UTC(2025, 9, 31, 23, 59) / 1000)).toBe(2);
    expect(bucketIndexAt(buckets, Date.UTC(2026, 0, 1) / 1000)).toBe(-1);
    expect(bucketIndexAt(buckets, Date.UTC(2025, 8, 30) / 1000)).toBe(-1);
  });

  it('服务器时区不是 UTC 时，日期按桶推算的偏移计算', () => {
    // 东八区的 2025-11：start 为 UTC 2025-10-31 16:00
    const b: TimelineBucket = { key: '2025-11', count: 2, start: Date.UTC(2025, 9, 31, 16) / 1000, end: Date.UTC(2025, 10, 30, 16) / 1000 };
    const days = groupByDay([item('a', '2025-11-05T17:30:00Z'), item('b', '2025-10-31T16:30:00Z')], b);
    expect(days.map((d) => [d.day, d.weekday])).toEqual([[6, 4], [1, 6]]);
    expect(dayLabel(days[0]!)).toBe('11 月 6 日 周四');
  });

  it('桶外的项归入前一项的月份，月份单调不减', () => {
    const months = assignMonths(buckets, [item('n', '2026-02-01T00:00:00Z'), item('a', '2025-11-03T00:00:00Z'), item('z', '2024-01-01T00:00:00Z')], 0);
    expect(months).toEqual([0, 1, 1]);
  });

  it('月份标题取出现最多的文件夹名，跳过媒体库根', () => {
    const its = [item('a', '', { folder: 'p/2025/大理' }), item('b', '', { folder: 'p/2025/大理' }), item('c', '', { folder: 'p' }), item('d', '', { folder: 'p/x/京都' })];
    expect(topFolders(its)).toEqual(['大理', '京都']);
  });
});

describe('分段覆盖、加载计划与合并', () => {
  const { items, buckets } = dataset(6, () => 100);

  it('部分加载的月份为 partial，之前的月份为 complete，之后为 unloaded', () => {
    const s = seg({ id: 1, startIdx: 0, items: items.slice(0, 250), cursor: '250' }, buckets);
    const st = monthStates([s], buckets);
    expect(st.map((x) => x.status)).toEqual(['complete', 'complete', 'partial', 'unloaded', 'unloaded', 'unloaded']);
    expect(st[2]!.items).toHaveLength(50);
  });

  it('下一页能覆盖时续页，否则新建一段；加载中或已有同起点时等待', () => {
    const s = seg({ id: 1, startIdx: 0, items: items.slice(0, 250), cursor: '250' }, buckets);
    expect(planLoad(2, [s], buckets, 200)).toEqual({ kind: 'continue', segId: 1 });
    expect(planLoad(4, [s], buckets, 200)).toEqual({ kind: 'continue', segId: 1 }); // 中间还差 50 + 100 < 200
    expect(planLoad(5, [s], buckets, 200)).toEqual({ kind: 'create', startIdx: 5 }); // 中间还差 250
    expect(planLoad(4, [{ ...s, loading: true }], buckets, 200)).toBeNull();
    expect(planLoad(5, [s, seg({ id: 2, startIdx: 5, loadedOnce: false, loading: true }, buckets)], buckets, 200)).toBeNull();
    expect(planLoad(1, [s], buckets, 200)).toBeNull();
    expect(planLoad(3, [{ ...s, done: true }], buckets, 200)).toBeNull();
  });

  it('较新的段翻到较旧段的起始月后合并，去重且沿用较旧段的游标', () => {
    const b = seg({ id: 2, startIdx: 3, items: items.slice(300, 450), cursor: 'B', cursorQuery: { to: buckets[3]!.end } }, buckets);
    const a = seg({ id: 1, startIdx: 0, items: items.slice(0, 330), cursor: 'A' }, buckets);
    const { segments, dropped } = mergeSegments([b, a]);
    expect(dropped).toEqual([1]);
    expect(segments).toHaveLength(1);
    const m = segments[0]!;
    expect(m.startIdx).toBe(0);
    expect(m.items.map((i) => i.id)).toEqual(items.slice(0, 450).map((i) => i.id));
    expect(m.cursor).toBe('B');
    expect(m.cursorQuery).toEqual({ to: buckets[3]!.end });
    expect(new Set(m.months).size).toBe(5);
  });

  it('较旧段首页未返回时直接丢弃', () => {
    const a = seg({ id: 1, startIdx: 0, items: items.slice(0, 330), cursor: 'A' }, buckets);
    const b = seg({ id: 2, startIdx: 3, loadedOnce: false, loading: true }, buckets);
    expect(mergeSegments([a, b])).toMatchObject({ dropped: [2], segments: [{ id: 1 }] });
  });

  it('未相接的段保持独立', () => {
    const a = seg({ id: 1, startIdx: 0, items: items.slice(0, 120), cursor: 'A' }, buckets);
    const b = seg({ id: 2, startIdx: 4, items: items.slice(400, 450), cursor: 'B' }, buckets);
    expect(mergeSegments([a, b]).segments).toHaveLength(2);
  });
});

describe('行布局、偏移查找与滚动锚定', () => {
  it('近百万媒体的远端月份仍有可达的滚动坐标，加载后保留月份锚点', () => {
    const { buckets } = dataset(84, () => 1);
    buckets.forEach((b, i) => { b.count = 11164 + (i === 0 ? 82 : 0); });
    const m = { ...M, rowHeight: 270 };
    const target = buckets.findIndex((b) => b.key === '2020-12');
    const before = buildLayout(buckets, monthStates([], buckets), m);
    expect(before.total).toBeLessThan(8_000_000);
    const y = before.monthTop[target]! + 90;
    expect(monthAtOffset(before, y)?.monthIdx).toBe(target);

    const loaded = seg({ id: 1, startIdx: target, items: [item('target', '2020-12-28T00:00:00Z')] }, buckets);
    const after = buildLayout(buckets, monthStates([loaded], buckets), m);
    const anchored = resolveAnchor(after, anchorAt(before, y)!);
    expect(monthAtOffset(after, anchored!)?.monthIdx).toBe(target);
    expect(after.rows[after.rowOfItem.get('target')!]?.kind).toBe('tiles');
  });
  const { items, buckets } = dataset(4, (i) => [30, 0, 12, 8][i]!);

  it('月份标题、天标题、图块行与未加载占位依次排列，偏移连续', () => {
    const s = seg({ id: 1, startIdx: 0, items: items.slice(0, 36), cursor: '36' }, buckets);
    const L = buildLayout(buckets, monthStates([s], buckets), M);
    expect(L.rows[0]).toMatchObject({ kind: 'month', key: `m:${buckets[0]!.key}` });
    expect(L.rows[1]!.kind).toBe('day');
    expect(L.rows.filter((r) => r.kind === 'gap')).toHaveLength(2); // 第二个月部分加载 + 第三个月未加载
    for (let i = 1; i < L.rows.length; i++) expect(L.offsets[i]).toBeCloseTo(L.offsets[i - 1]! + L.rows[i - 1]!.height, 6);
    expect(L.total).toBeCloseTo(L.offsets.at(-1)! + L.rows.at(-1)!.height, 6);
    const tileIds = L.rows.flatMap((r) => (r.kind === 'tiles' ? r.cells.map((c) => c.item.id) : []));
    expect(tileIds).toEqual(items.slice(0, 36).map((i) => i.id));
    expect(L.monthTop[1]).toBeGreaterThan(L.monthTop[0]!);
    expect(L.monthBottom[0]).toBe(L.monthTop[1]);
  });

  it('全部加载完的空月份不显示', () => {
    const s = seg({ id: 1, startIdx: 0, items, done: true }, buckets);
    // 分桶里有 11 月，但列表实际没有（例如期间被删除）
    const fake = [...buckets.slice(0, 1), { key: '2025-11', count: 3, start: Date.UTC(2025, 10, 1) / 1000, end: Date.UTC(2025, 11, 1) / 1000 }, ...buckets.slice(1)];
    const L = buildLayout(fake, monthStates([{ ...s, months: assignMonths(fake, items, 0) }], fake), M);
    expect(L.monthTop[1]).toBe(-1);
    expect(L.rows.some((r) => r.kind === 'gap')).toBe(false);
  });

  it('偏移二分查找与月份进度', () => {
    const s = seg({ id: 1, startIdx: 0, items, done: true }, buckets);
    const L = buildLayout(buckets, monthStates([s], buckets), M);
    expect(rowAt(L.offsets, -5)).toBe(0);
    expect(rowAt(L.offsets, L.offsets[3]! + 1)).toBe(3);
    expect(rowAt(L.offsets, 1e9)).toBe(L.rows.length - 1);
    const at = monthAtOffset(L, L.monthTop[1]! + 1)!;
    expect(at.monthIdx).toBe(1);
    expect(at.progress).toBeGreaterThan(0);
    expect(at.progress).toBeLessThan(0.1);
  });

  it('上方月份加载后，锚点仍指向同一张图', () => {
    const b = seg({ id: 2, startIdx: 1, items: items.slice(30), done: true }, buckets);
    const before = buildLayout(buckets, monthStates([b], buckets), M);
    const target = before.rowOfItem.get(items[40]!.id)!;
    const a = anchorAt(before, before.offsets[target]! + 10)!;
    expect(a).toMatchObject({ key: `i:${(before.rows[target] as { cells: { item: MediaItem }[] }).cells[0]!.item.id}`, delta: 10, monthKey: `m:${buckets[1]!.key}` });
    const top = seg({ id: 1, startIdx: 0, items: items.slice(0, 30), cursor: 'c' }, buckets);
    const after = buildLayout(buckets, monthStates(mergeSegments([top, b]).segments, buckets), M);
    const y = resolveAnchor(after, a)!;
    expect(y).toBeCloseTo(after.offsets[after.rowOfItem.get(items[40]!.id)!]! + 10, 6);
    expect(y).not.toBeCloseTo(before.offsets[target]! + 10, 0);
  });

  it('占位行锚定到所在月份标题', () => {
    const L = buildLayout(buckets, monthStates([], buckets), M);
    const a = anchorAt(L, L.monthTop[1]! + M.monthHeight + 50)!;
    expect(a).toEqual({ key: `m:${buckets[1]!.key}`, delta: M.monthHeight + 50, monthKey: `m:${buckets[1]!.key}`, monthDelta: M.monthHeight + 50 });
    expect(resolveAnchor(L, a)).toBe(L.monthTop[1]! + M.monthHeight + 50);
  });

  it('锚定的图不再存在时退回所在月份', () => {
    const s = seg({ id: 1, startIdx: 0, items, done: true }, buckets);
    const full = buildLayout(buckets, monthStates([s], buckets), M);
    const a = anchorAt(full, full.monthTop[1]! + M.monthHeight + M.dayHeight + 5)!;
    expect(a.key.startsWith('i:')).toBe(true);
    const empty = buildLayout(buckets, monthStates([], buckets), M);
    expect(resolveAnchor(empty, a)).toBe(empty.monthTop[1]! + a.monthDelta);
  });

  it('未加载部分按数量估计高度', () => {
    expect(estimateHeight(0, M)).toBe(0);
    expect(estimateHeight(100, M)).toBeGreaterThan(estimateHeight(10, M));
    expect(estimateHeight(40, { ...M, square: true })).toBe(Math.ceil(40 / 5) * 183 + 4 * 42);
  });

  it('十万项布局在可接受时间内完成', () => {
    const big = dataset(120, () => 850);
    const s = seg({ id: 1, startIdx: 0, items: big.items, done: true }, big.buckets);
    const t0 = performance.now();
    const L = buildLayout(big.buckets, monthStates([s], big.buckets), M);
    const ms = performance.now() - t0;
    expect(L.rowOfItem.size).toBe(102000);
    expect(ms).toBeLessThan(1500);
  });
});

describe('时间尺', () => {
  const buckets: TimelineBucket[] = [
    { key: '2025-12', count: 400, start: 0, end: 0 },
    { key: '2025-03', count: 500, start: 0, end: 0 },
    { key: '2024-07', count: 4, start: 0, end: 0 },
    { key: '2019-01', count: 900, start: 0, end: 0 },
  ];

  it('高度按权重分配，低于下限的固定为下限，总和等于时间尺高度', () => {
    const hs = distribute([10, 1, 10], 100, 18);
    expect(hs[1]).toBe(18);
    expect(hs[0]).toBeCloseTo(41, 6);
    expect(hs.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    const years = layoutRuler(buckets, 600);
    expect(years.map((y) => y.year)).toEqual([2025, 2024, 2019]);
    expect(years[1]!.height).toBeGreaterThanOrEqual(18);
    expect(years[2]!.top + years[2]!.height).toBeCloseTo(600, 6);
  });

  it('指针位置映射到年内最近的有数据月份', () => {
    const years = layoutRuler(buckets, 600);
    const y25 = years[0]!;
    expect(bucketAtY(years, y25.top + 1)).toBe(0); // 12 月
    expect(bucketAtY(years, y25.top + y25.height * 0.8)).toBe(1); // 靠近 3 月
    expect(bucketAtY(years, years[1]!.top + 2)).toBe(2);
    expect(bucketAtY(years, 9999)).toBe(3);
    expect(bucketAtY(years, -50)).toBe(0);
  });

  it('指针位置与映射互逆', () => {
    const years = layoutRuler(buckets, 600);
    for (let i = 0; i < buckets.length; i++) expect(bucketAtY(years, yForBucket(years, i, 0.5)!)).toBe(i);
    expect(yForBucket(years, 99)).toBeNull();
  });
});

describe('分段加载容器', () => {
  const { items, buckets } = dataset(12, () => 100);

  it('从顶部连续续页，跳转到远处月份时以 to 上界新建一段，相接后合并为一段', async () => {
    const srv = fakeServer(items);
    const store = createTimelineStore(buckets, {}, srv.fetchPage, { limit: 300 });
    store.ensure(0);
    await flush();
    expect(srv.calls[0]).toMatchObject({ scope: 'all', sort: 'taken_desc', limit: 300 });
    expect(srv.calls[0]!.to).toBeUndefined();
    store.ensure(9);
    await flush();
    expect(srv.calls[1]).toMatchObject({ to: buckets[9]!.end });
    expect(store.getSnapshot().segments).toHaveLength(2);
    // 顶部段连续续页直到与第二段相接
    for (let i = 0; i < 4; i++) {
      store.ensure(3 + i * 3);
      await flush();
    }
    const segs = store.getSnapshot().segments;
    expect(segs).toHaveLength(1);
    expect(segs[0]!.items.map((i) => i.id)).toEqual(items.slice(0, segs[0]!.items.length).map((i) => i.id));
    expect(segs[0]!.cursorQuery.to).toBe(buckets[9]!.end);
    store.destroy();
  });

  it('请求失败记录错误且不自动重试，重试后恢复', async () => {
    let fail = true;
    const srv = fakeServer(items);
    const store = createTimelineStore(buckets, { q: '上海', types: ['video'] }, async (q) => {
      if (fail) throw new Error('网络不可用');
      return srv.fetchPage(q);
    });
    store.ensure(0);
    await flush();
    const s = store.getSnapshot().segments[0]!;
    expect(s.error).toBe('网络不可用');
    store.ensure(0);
    await flush();
    expect(store.getSnapshot().segments).toHaveLength(1);
    fail = false;
    store.retry(s.id);
    await flush();
    expect(store.getSnapshot().segments[0]!.items.length).toBeGreaterThan(0);
    expect(srv.calls[0]).toMatchObject({ q: '上海', types: ['video'] });
    store.patch(new Set([items[0]!.id]), { favorite: true });
    expect(store.segmentOf(items[0]!.id)!.items[0]!.favorite).toBe(true);
    store.destroy();
  });
});
