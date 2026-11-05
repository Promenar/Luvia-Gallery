/**
 * 右侧时间尺的纯计算：按年分配高度、指针位置与“指针坐标 → 月份”的映射。
 * 每年按数量的平方根分配高度（至少 minHeight），年内自上而下为 12 月 → 1 月。
 */
import type { TimelineBucket } from '@luvia/contracts';
import { parseKey } from './timeline';

export interface RulerYear {
  year: number;
  top: number;
  height: number;
  total: number;
  /** 下标 0 = 12 月 … 11 = 1 月；值为该月桶索引，没有该月为 -1。 */
  slots: number[];
  /** 与 slots 平行的数量。 */
  counts: number[];
}

export const yearWeight = (total: number) => Math.max(1, Math.sqrt(total) / 3);

/** 按权重分配高度，低于下限的年份固定为下限，其余继续按权重分配剩余高度。 */
export function distribute(weights: readonly number[], height: number, min: number): number[] {
  const out = weights.map(() => 0);
  const fixed = new Set<number>();
  for (;;) {
    const free = weights.map((_, i) => i).filter((i) => !fixed.has(i));
    const remain = height - fixed.size * min;
    const wsum = free.reduce((a, i) => a + weights[i]!, 0);
    let changed = false;
    for (const i of free) {
      const h = wsum > 0 ? (remain * weights[i]!) / wsum : 0;
      if (h < min) {
        fixed.add(i);
        changed = true;
      }
      out[i] = h;
    }
    if (!changed) break;
  }
  for (const i of fixed) out[i] = min;
  return out;
}

export function layoutRuler(buckets: readonly TimelineBucket[], height: number, minHeight = 18): RulerYear[] {
  const years: RulerYear[] = [];
  buckets.forEach((b, idx) => {
    const { year, month } = parseKey(b.key);
    let y = years[years.length - 1];
    if (!y || y.year !== year) {
      y = { year, top: 0, height: 0, total: 0, slots: Array(12).fill(-1), counts: Array(12).fill(0) };
      years.push(y);
    }
    y.total += b.count;
    y.slots[12 - month] = idx;
    y.counts[12 - month] = b.count;
  });
  const hs = distribute(years.map((y) => yearWeight(y.total)), Math.max(height, 0), minHeight);
  let top = 0;
  years.forEach((y, i) => {
    y.top = top;
    y.height = hs[i]!;
    top += y.height;
  });
  return years;
}

/** 指针纵坐标（相对时间尺）对应的桶索引：先定年份，再按年内位置取最近的有数据月份。 */
export function bucketAtY(years: readonly RulerYear[], y: number): number {
  if (!years.length) return -1;
  let yr = years[years.length - 1]!;
  for (const c of years) {
    if (y < c.top + c.height) {
      yr = c;
      break;
    }
  }
  const slot = Math.min(11, Math.max(0, Math.floor(((y - yr.top) / (yr.height || 1)) * 12)));
  let best = -1;
  let dist = Infinity;
  yr.slots.forEach((idx, s) => {
    if (idx < 0) return;
    const d = Math.abs(s - slot);
    if (d < dist) {
      dist = d;
      best = idx;
    }
  });
  return best;
}

/** 桶索引与月内进度对应的指针纵坐标。 */
export function yForBucket(years: readonly RulerYear[], idx: number, progress = 0): number | null {
  for (const y of years) {
    const s = y.slots.indexOf(idx);
    if (s >= 0) return y.top + ((s + Math.min(1, Math.max(0, progress))) / 12) * y.height;
  }
  return null;
}

export const monthLabel = (key: string) => {
  const { year, month } = parseKey(key);
  return `${year} 年 ${month} 月`;
};
