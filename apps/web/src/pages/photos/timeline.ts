/**
 * 照片时间线的纯逻辑：月份归属、按天分组、分段加载的覆盖与合并、加载计划、行布局与偏移查找。
 * 不依赖 React 与 DOM，便于单元测试。
 *
 * 数据模型：buckets（倒序，新→旧）给出全部月份与数量；已加载的媒体以“段”（Segment）组织，
 * 每段从某个月的起点开始按所选时间（修改时间或拍摄时间）倒序连续向更早翻页。跳转到未加载的月份时以 `to=该月 end`
 * 新建一段，两段相接后合并，保证同一段内的游标与查询始终对应。
 */
import type { MediaItem, MediaListQuery, TimelineBucket } from '@luvia/contracts';
import { aspectOf, justifyRows, squareRows, type JustifiedCell } from '@/components/media/justify';

export const toSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** 时间线的排序与分组依据：modified 文件修改时间，taken 拍摄时间。 */
export type TimeBasis = 'modified' | 'taken';
/** 媒体在给定依据下的时间（Unix 秒）。 */
export const timeOf = (it: Pick<MediaItem, 'takenAt' | 'modifiedAt'>, basis: TimeBasis = 'taken') => (basis === 'modified' ? it.modifiedAt : toSec(it.takenAt));

/** buckets 为倒序（索引 0 最新）。返回 sec 所在桶的索引，不在任何桶内返回 -1。 */
export function bucketIndexAt(buckets: readonly TimelineBucket[], sec: number): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = buckets[mid]!;
    if (sec >= b.end) hi = mid - 1;
    else if (sec < b.start) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** 由桶的 key（YYYY-MM）与 start 推算服务器时区相对 UTC 的偏移（秒）。 */
export function bucketOffsetSec(b: TimelineBucket): number {
  const [y, m] = b.key.split('-').map(Number) as [number, number];
  return Date.UTC(y, m - 1, 1) / 1000 - b.start;
}

export function parseKey(key: string): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return { year: y, month: m };
}

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface DayGroup {
  key: string;
  year: number;
  month: number;
  day: number;
  weekday: number;
  items: MediaItem[];
}

export const dayLabel = (d: Pick<DayGroup, 'month' | 'day' | 'weekday'>) => `${d.month} 月 ${d.day} 日 ${WD[d.weekday]}`;

/** 把同一个月（已按时间倒序）的媒体按服务器时区的自然日分组；日期与星期和桶的月份归属保持一致。 */
export function groupByDay(items: readonly MediaItem[], bucket: TimelineBucket, basis: TimeBasis = 'taken'): DayGroup[] {
  const off = bucketOffsetSec(bucket);
  const out: DayGroup[] = [];
  let cur: DayGroup | null = null;
  for (const it of items) {
    const d = new Date((timeOf(it, basis) + off) * 1000);
    const day = d.getUTCDate();
    if (!cur || cur.day !== day) {
      const { year, month } = parseKey(bucket.key);
      cur = { key: `${bucket.key}-${String(day).padStart(2, '0')}`, year, month, day, weekday: d.getUTCDay(), items: [] };
      out.push(cur);
    }
    cur.items.push(it);
  }
  return out;
}

/** 文件夹路径的最后一级名称；媒体库根目录返回 null。 */
export function folderLabel(folder: string): string | null {
  const i = folder.lastIndexOf('/');
  return i < 0 ? null : folder.slice(i + 1);
}

/** 月份标题里的地点摘要：出现最多的前三个文件夹名。 */
export function topFolders(items: readonly MediaItem[], n = 3): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const f = folderLabel(it.folder);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/* ---------------- 分段 ---------------- */

export interface Segment {
  id: number;
  /** 段起点所在的桶索引（该月从头开始完整）。 */
  startIdx: number;
  items: MediaItem[];
  /** 与 items 平行：每项所属桶索引，单调不减。 */
  months: number[];
  ids: Set<string>;
  /** 下一页游标；与 cursorQuery 配套使用。 */
  cursor: string | null;
  /** 产生 cursor 的查询（不含 cursor），交给查看器续页时原样使用。 */
  cursorQuery: MediaListQuery;
  loadedOnce: boolean;
  done: boolean;
  loading: boolean;
  error: string | null;
}

export function frontierOf(s: Segment): number {
  return s.months.length ? s.months[s.months.length - 1]! : s.startIdx;
}

/** 为新到的一页计算月份归属；落在任何桶外的项（例如分桶之后新增）归入前一项所在月份。 */
export function assignMonths(buckets: readonly TimelineBucket[], items: readonly MediaItem[], prev: number, basis: TimeBasis = 'taken'): number[] {
  let last = prev;
  return items.map((it) => {
    const m = bucketIndexAt(buckets, timeOf(it, basis));
    last = m < 0 ? last : Math.max(m, last);
    return last;
  });
}

export type MonthStatus = 'unloaded' | 'partial' | 'complete';
export interface MonthState { status: MonthStatus; items: MediaItem[]; segId: number | null }

/** 汇总各段，得到每个月的加载状态与已加载媒体。 */
export function monthStates(segs: readonly Segment[], buckets: readonly TimelineBucket[]): MonthState[] {
  const out: MonthState[] = buckets.map(() => ({ status: 'unloaded', items: [], segId: null }));
  for (const s of segs) {
    if (!s.loadedOnce) continue;
    const groups = new Map<number, MediaItem[]>();
    s.items.forEach((it, i) => {
      const m = s.months[i]!;
      let g = groups.get(m);
      if (!g) groups.set(m, (g = []));
      g.push(it);
    });
    const frontier = frontierOf(s);
    const last = s.done ? buckets.length - 1 : Math.min(frontier, buckets.length - 1);
    for (let i = Math.max(0, s.startIdx); i <= last; i++) {
      const items = groups.get(i) ?? [];
      const complete = i < frontier || s.done || items.length >= buckets[i]!.count;
      const cur = out[i]!;
      if (cur.status !== 'unloaded' && cur.items.length >= items.length) continue;
      out[i] = { status: complete ? 'complete' : 'partial', items, segId: s.id };
    }
  }
  return out;
}

function loadedInFrontier(s: Segment): number {
  const f = frontierOf(s);
  let n = 0;
  for (let i = s.months.length - 1; i >= 0 && s.months[i] === f; i--) n++;
  return n;
}

export type LoadPlan = { kind: 'continue'; segId: number } | { kind: 'create'; startIdx: number } | null;

/**
 * 某个未加载（或部分加载）的月份进入视口时该怎么加载：
 * - 已有段的下一页预计就能覆盖它 → 续页（该段正在加载或出错时等待）；
 * - 否则以该月为起点新建一段（已有同起点的段时等待）。
 */
export function planLoad(target: number, segs: readonly Segment[], buckets: readonly TimelineBucket[], pageLimit: number): LoadPlan {
  if (target < 0 || target >= buckets.length) return null;
  for (const s of segs) {
    if (target < s.startIdx) continue;
    if (!s.loadedOnce) {
      // 首页尚未返回：预计首页能覆盖到目标就等待
      let gap = 0;
      for (let i = s.startIdx; i < target; i++) gap += buckets[i]!.count;
      if (gap < pageLimit) return null;
      continue;
    }
    if (s.done) return null;
    const f = frontierOf(s);
    if (target < f) return null;
    let gap = buckets[f]!.count - loadedInFrontier(s);
    for (let i = f + 1; i < target; i++) gap += buckets[i]!.count;
    if (target === f || gap < pageLimit) return s.loading || s.error ? null : { kind: 'continue', segId: s.id };
  }
  if (segs.some((s) => s.startIdx === target)) return null;
  return { kind: 'create', startIdx: target };
}

/**
 * 合并相接的段：较新的段 A 已翻到较旧段 B 的起始月时，A 中属于 B 起始月及更早的项与 B 重复，
 * 保留 A 更新的部分并接上 B（游标、查询沿用 B）。B 的首页尚未返回时直接丢弃 B。
 * 返回合并后的段与被丢弃（需要中止请求）的段 ID。
 */
export function mergeSegments(segs: readonly Segment[]): { segments: Segment[]; dropped: number[] } {
  const sorted = [...segs].sort((a, b) => a.startIdx - b.startIdx);
  const out: Segment[] = [];
  const dropped: number[] = [];
  for (const s of sorted) {
    const a = out[out.length - 1];
    if (!a || !a.loadedOnce || !(a.done || frontierOf(a) >= s.startIdx)) {
      out.push(s);
      continue;
    }
    if (!s.loadedOnce) {
      dropped.push(s.id);
      continue;
    }
    dropped.push(a.id);
    const items: MediaItem[] = [];
    const months: number[] = [];
    const ids = new Set<string>();
    a.items.forEach((it, i) => {
      if (a.months[i]! < s.startIdx && !s.ids.has(it.id)) {
        items.push(it);
        months.push(a.months[i]!);
        ids.add(it.id);
      }
    });
    s.items.forEach((it, i) => {
      if (!ids.has(it.id)) {
        items.push(it);
        months.push(s.months[i]!);
        ids.add(it.id);
      }
    });
    out[out.length - 1] = { ...s, startIdx: a.startIdx, items, months, ids };
  }
  return { segments: out, dropped };
}

/* ---------------- 行布局 ---------------- */

export interface LayoutMetrics {
  width: number;
  rowHeight: number;
  gap: number;
  square: boolean;
  monthHeight: number;
  dayHeight: number;
  /** 按天分组所用的时间，缺省为拍摄时间。 */
  basis?: TimeBasis;
}

export type TimelineRow =
  | { kind: 'month'; key: string; monthIdx: number; height: number }
  | { kind: 'day'; key: string; monthIdx: number; height: number; day: DayGroup }
  | { kind: 'tiles'; key: string; monthIdx: number; height: number; cellHeight: number; cells: JustifiedCell<MediaItem>[] }
  | { kind: 'gap'; key: string; monthIdx: number; height: number; remaining: number };

export interface TimelineLayout {
  rows: TimelineRow[];
  /** 每行相对内容起点的顶部偏移（不含外层留白）。 */
  offsets: number[];
  total: number;
  /** 每个月标题行的偏移与该月结束偏移；不显示的月份为 -1。 */
  monthTop: number[];
  monthBottom: number[];
  /** 媒体 ID → 所在行索引（用于滚动锚定）。 */
  rowOfItem: Map<string, number>;
}

/** 未加载部分的估计高度：按平均宽高比估算行数，并为天标题留出空间。 */
export function estimateHeight(count: number, m: LayoutMetrics): number {
  if (count <= 0) return 0;
  const cellW = m.square ? m.rowHeight : m.rowHeight * 1.3;
  const perRow = Math.max(1, Math.floor((m.width + m.gap) / (cellW + m.gap)));
  const rows = Math.ceil(count / perRow);
  const days = Math.min(28, Math.ceil(count / 10));
  return rows * (m.rowHeight + m.gap) + days * m.dayHeight;
}

// 为实际照片行留出滚动空间；未加载月份按原始估算等比缩短，保持相对疏密。
const GAP_HEIGHT_BUDGET = 4_000_000;

type DayRows = { day: DayGroup; rows: { cells: JustifiedCell<MediaItem>[]; height: number }[] };
export type LayoutCache = Map<string, DayRows[]>;

function layoutMonth(items: MediaItem[], bucket: TimelineBucket, m: LayoutMetrics, cache?: LayoutCache): DayRows[] {
  const sig = `${bucket.key}|${items.length}|${items[0]?.id}|${items.at(-1)?.id}|${m.width}|${m.rowHeight}|${m.gap}|${m.square ? 1 : 0}|${m.basis ?? 'taken'}`;
  const hit = cache?.get(sig);
  if (hit) return hit;
  const res = groupByDay(items, bucket, m.basis).map((day) => ({
    day,
    rows: (m.square ? squareRows(day.items, m.width, m.rowHeight, m.gap) : justifyRows(day.items, aspectOf, m.width, m.rowHeight, m.gap)).map((r) => ({
      cells: r.cells,
      height: r.height,
    })),
  }));
  cache?.set(sig, res);
  return res;
}

export function buildLayout(buckets: readonly TimelineBucket[], states: readonly MonthState[], m: LayoutMetrics, cache?: LayoutCache): TimelineLayout {
  const rows: TimelineRow[] = [];
  const offsets: number[] = [];
  const monthTop = buckets.map(() => -1);
  const monthBottom = buckets.map(() => -1);
  const rowOfItem = new Map<string, number>();
  let y = 0;
  const push = (r: TimelineRow) => {
    offsets.push(y);
    rows.push(r);
    y += r.height;
  };
  if (m.width <= 0) return { rows, offsets, total: 0, monthTop, monthBottom, rowOfItem };
  const estimatedHeight = buckets.reduce((total, bucket) => total + estimateHeight(bucket.count, m), 0);
  const gapScale = Math.min(1, GAP_HEIGHT_BUDGET / estimatedHeight);
  buckets.forEach((b, mi) => {
    const st = states[mi]!;
    if (st.status === 'complete' && st.items.length === 0) return;
    monthTop[mi] = y;
    push({ kind: 'month', key: `m:${b.key}`, monthIdx: mi, height: m.monthHeight });
    if (st.items.length) {
      for (const { day, rows: drs } of layoutMonth(st.items, b, m, cache)) {
        push({ kind: 'day', key: `d:${day.key}`, monthIdx: mi, height: m.dayHeight, day });
        for (const r of drs) {
          const idx = rows.length;
          for (const c of r.cells) rowOfItem.set(c.item.id, idx);
          push({ kind: 'tiles', key: `t:${r.cells[0]!.item.id}`, monthIdx: mi, height: r.height + m.gap, cellHeight: r.height, cells: r.cells });
        }
      }
    }
    if (st.status !== 'complete') {
      const remaining = Math.max(1, b.count - st.items.length);
      const height = Math.max(m.rowHeight + m.dayHeight, Math.round(estimateHeight(remaining, m) * gapScale));
      push({ kind: 'gap', key: `g:${b.key}:${st.items.length}`, monthIdx: mi, height, remaining });
    }
    monthBottom[mi] = y;
  });
  return { rows, offsets, total: y, monthTop, monthBottom, rowOfItem };
}

/** 二分查找内容偏移 y 所在的行索引。 */
export function rowAt(offsets: readonly number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  if (hi < 0) return -1;
  if (y <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 内容偏移 y 处的月份与在该月内的进度（0–1）。 */
export function monthAtOffset(layout: TimelineLayout, y: number): { monthIdx: number; progress: number } | null {
  const r = rowAt(layout.offsets, y);
  const row = layout.rows[r];
  if (!row) return null;
  const top = layout.monthTop[row.monthIdx]!;
  const bottom = layout.monthBottom[row.monthIdx]!;
  const progress = bottom > top ? Math.min(1, Math.max(0, (y - top) / (bottom - top))) : 0;
  return { monthIdx: row.monthIdx, progress };
}

/* ---------------- 滚动锚定 ---------------- */

/** 滚动锚点：优先按行（图块行以首张图的 ID 标识），找不到时退回所在月份标题。 */
export interface ScrollAnchor { key: string; delta: number; monthKey: string; monthDelta: number }

/** 记录视口参照线所在行作为锚点；未加载占位行锚定到所在月份标题。 */
export function anchorAt(layout: TimelineLayout, y: number): ScrollAnchor | null {
  const r = rowAt(layout.offsets, y);
  const row = layout.rows[r];
  if (!row) return null;
  const mTop = layout.monthTop[row.monthIdx]!;
  const monthRow = layout.rows[rowAt(layout.offsets, mTop)]!;
  const base = { monthKey: monthRow.key, monthDelta: y - mTop };
  if (row.kind === 'tiles') return { key: `i:${row.cells[0]!.item.id}`, delta: y - layout.offsets[r]!, ...base };
  if (row.kind === 'gap') return { key: monthRow.key, delta: y - mTop, ...base };
  return { key: row.key, delta: y - layout.offsets[r]!, ...base };
}

function rowOffsetByKey(layout: TimelineLayout, key: string): number | null {
  const r = layout.rows.findIndex((row) => row.key === key);
  return r < 0 ? null : layout.offsets[r]!;
}

/** 在新布局中找到锚点，返回参照线应处的内容偏移；找不到返回 null。 */
export function resolveAnchor(layout: TimelineLayout, a: ScrollAnchor): number | null {
  if (a.key.startsWith('i:')) {
    const r = layout.rowOfItem.get(a.key.slice(2));
    if (r != null) return layout.offsets[r]! + Math.min(a.delta, layout.rows[r]!.height);
  } else {
    const o = rowOffsetByKey(layout, a.key);
    if (o != null) return o + a.delta;
  }
  const m = rowOffsetByKey(layout, a.monthKey);
  return m == null ? null : m + a.monthDelta;
}

/** 已加载项按显示顺序展开（用于 Shift 范围选择）。 */
export function displayOrder(states: readonly MonthState[]): MediaItem[] {
  return states.flatMap((s) => s.items);
}
