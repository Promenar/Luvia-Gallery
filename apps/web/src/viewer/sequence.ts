/**
 * 查看器的浏览顺序、幻灯片推进与续页判断（纯函数）。
 *
 * order 是 scope.items 下标的排列：顺序播放时为 0..n-1，随机时当前项保持在原位、其后打乱。
 * pos 是当前项在 order 中的位置。
 */

export type Rand = () => number;

/** Fisher–Yates 洗牌，返回新数组。 */
export function shuffled<T>(arr: readonly T[], rand: Rand = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/** 初始顺序。随机时打开的那一项排在第一位，其余打乱。 */
export function buildOrder(n: number, start: number, shuffle: boolean, rand: Rand = Math.random): { order: number[]; pos: number } {
  const s = Math.min(Math.max(0, start), Math.max(0, n - 1));
  if (!shuffle || n <= 1) return { order: range(0, n), pos: s };
  return { order: [s, ...shuffled(range(0, n).filter((i) => i !== s), rand)], pos: 0 };
}

/** 新加载的项追加到顺序末尾（随机时追加部分自身打乱）。 */
export function extendOrder(order: readonly number[], n: number, shuffle: boolean, rand: Rand = Math.random): number[] {
  if (n <= order.length) return order.slice();
  const added = range(order.length, n);
  return [...order, ...(shuffle ? shuffled(added, rand) : added)];
}

/** 播放中切换顺序：随机时保留已看过的部分，打乱其后；改回顺序时回到按时间顺序并定位当前项。 */
export function reorder(order: readonly number[], pos: number, shuffle: boolean, rand: Rand = Math.random): { order: number[]; pos: number } {
  const cur = order[pos] ?? 0;
  if (shuffle) return { order: [...order.slice(0, pos + 1), ...shuffled(order.slice(pos + 1), rand)], pos };
  const seq = range(0, order.length);
  return { order: seq, pos: cur };
}

export type Step = { kind: 'go'; pos: number } | { kind: 'wait' } | { kind: 'end' } | { kind: 'stay' };

/**
 * 计算下一步。
 * - 手动翻页（auto=false）：到头时若还能续页则等待加载，否则首尾相接。
 * - 幻灯片自动推进（auto=true）：到末尾时能续页则等待，否则 loop 决定从头或结束。
 */
export function step(pos: number, len: number, dir: 1 | -1, opts: { auto: boolean; loop: boolean; canLoadMore: boolean }): Step {
  if (len <= 0) return { kind: 'stay' };
  const next = pos + dir;
  if (next >= 0 && next < len) return { kind: 'go', pos: next };
  if (dir === 1) {
    if (opts.canLoadMore) return { kind: 'wait' };
    if (opts.auto && !opts.loop) return { kind: 'end' };
    return len > 1 ? { kind: 'go', pos: 0 } : opts.auto ? { kind: 'end' } : { kind: 'stay' };
  }
  if (opts.canLoadMore) return { kind: 'stay' };
  return len > 1 ? { kind: 'go', pos: len - 1 } : { kind: 'stay' };
}

/** 距离已加载末尾不超过 threshold 项时预取下一页。 */
export function shouldLoadMore(pos: number, len: number, threshold = 5): boolean {
  return len - 1 - pos <= threshold;
}

/** 随机续播时排除的 ID：最近加载的（含已播与待播）最多 max 个。 */
export function excludeIds(items: readonly { id: string }[], max = 500): string[] {
  return items.slice(-max).map((m) => m.id);
}

/** 去掉与已有项重复的新项。 */
export function dedupe<T extends { id: string }>(existing: readonly { id: string }[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((m) => m.id));
  return incoming.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/** “第 N 项，共 M 项”；总数未知（还有更多未加载且无 total）时只显示序号。 */
export function counterText(pos: number, len: number, total: number | null | undefined, hasMore: boolean): string {
  const n = pos + 1;
  if (total != null) return `第 ${n} 项，共 ${total} 项`;
  if (!hasMore) return `第 ${n} 项，共 ${len} 项`;
  return `第 ${n} 项`;
}

/** 胶片条显示窗口 [start, end)：以当前项为中心，最多 count 项。 */
export function filmWindow(pos: number, len: number, count: number): [number, number] {
  const c = Math.max(1, Math.min(count, len));
  const start = Math.min(Math.max(0, pos - Math.floor(c / 2)), Math.max(0, len - c));
  return [start, start + c];
}

/** 胶片条可容纳的缩略图数量（奇数，3–13）：每格约 51px，左右各留 16px。 */
export function filmCount(viewportW: number): number {
  const n = Math.max(3, Math.min(13, Math.floor((viewportW - 32) / 51)));
  return n % 2 ? n : n - 1;
}

/**
 * 删除当前媒体后重映射浏览顺序。order 存的是原数组索引；删除 removedArray 后，
 * 大于它的索引整体减一。removedPos 为删除项在原顺序中的位置，找不到时为 -1。
 */
export function removeFromOrder(order: readonly number[], removedArray: number): { order: number[]; removedPos: number } {
  const removedPos = order.indexOf(removedArray);
  const remaining = removedPos < 0 ? order.filter((i) => i !== removedArray) : order.filter((_, position) => position !== removedPos);
  return { order: remaining.map((i) => (i > removedArray ? i - 1 : i)), removedPos };
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 拍摄时间按拍摄地的墙上时间显示（保留 ISO 字符串自带的偏移，不换算到浏览器时区）。 */
export function formatTakenAt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  const wd = WEEK[new Date(Date.UTC(+y!, +mo! - 1, +d!)).getUTCDay()];
  const date = `${+y!} 年 ${+mo!} 月 ${+d!} 日 ${wd}`;
  return h ? `${date} ${h}:${mi}` : date;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 曝光时间：小于 0.3 秒写成 1/x，其余写成秒。 */
export function formatExposure(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 0.3) return `1/${Math.round(1 / sec)}`;
  return `${Number(sec.toFixed(1))}″`;
}

/** 媒体库内相对路径：媒体库名 / 各级文件夹 / 文件名。 */
export function filePath(breadcrumbs: readonly { name: string }[], name: string): string {
  return [...breadcrumbs.map((b) => b.name), name].join('/');
}
