import { knownDimensions } from '@/lib/dimension-cache';

/** 对齐行布局（justified）：每行高度接近目标行高，宽度恰好填满容器；最后一行不拉伸。 */
export interface JustifyInput { ratio: number }
export interface JustifiedCell<T> { item: T; index: number; width: number; height: number }
export interface JustifiedRow<T> { cells: JustifiedCell<T>[]; height: number; top: number }

export function aspectOf(m: { id?: string; width: number | null; height: number | null }): number {
  // 列表加载后才读到的宽高（见 lib/dimension-cache.ts）
  const size = m.width && m.height ? m : m.id ? knownDimensions(m.id) : undefined;
  if (!size?.width || !size.height) return 1;
  // 极端全景与长截图限制在合理范围，避免一张图独占整行或细成一条
  return Math.max(0.4, Math.min(3.2, size.width / size.height));
}

export function justifyRows<T>(
  items: readonly T[],
  ratioOf: (item: T) => number,
  containerWidth: number,
  targetHeight: number,
  gap: number,
  startIndex = 0,
): JustifiedRow<T>[] {
  const rows: JustifiedRow<T>[] = [];
  if (containerWidth <= 0) return rows;
  let row: { item: T; index: number; ratio: number }[] = [];
  let ratioSum = 0;
  let top = 0;
  const flush = (last: boolean) => {
    if (!row.length) return;
    const gaps = gap * (row.length - 1);
    let h = (containerWidth - gaps) / ratioSum;
    if (last && h > targetHeight * 1.25) h = targetHeight;
    const cells = row.map((r) => ({ item: r.item, index: r.index, width: r.ratio * h, height: h }));
    // 消除舍入误差：最后一格吸收剩余宽度
    if (!last || h !== targetHeight) {
      const used = cells.reduce((a, c) => a + c.width, 0) + gaps;
      const lastCell = cells[cells.length - 1]!;
      lastCell.width += containerWidth - used;
    }
    rows.push({ cells, height: h, top });
    top += h + gap;
    row = [];
    ratioSum = 0;
  };
  items.forEach((item, i) => {
    const ratio = ratioOf(item);
    row.push({ item, index: startIndex + i, ratio });
    ratioSum += ratio;
    const h = (containerWidth - gap * (row.length - 1)) / ratioSum;
    if (h <= targetHeight) flush(false);
  });
  flush(true);
  return rows;
}

/** 方形网格：按目标边长计算列数。 */
export function squareRows<T>(items: readonly T[], containerWidth: number, target: number, gap: number, startIndex = 0): JustifiedRow<T>[] {
  const cols = Math.max(2, Math.round((containerWidth + gap) / (target + gap)));
  const size = (containerWidth - gap * (cols - 1)) / cols;
  const rows: JustifiedRow<T>[] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push({
      cells: items.slice(i, i + cols).map((item, k) => ({ item, index: startIndex + i + k, width: size, height: size })),
      height: size,
      top: rows.length * (size + gap),
    });
  }
  return rows;
}
