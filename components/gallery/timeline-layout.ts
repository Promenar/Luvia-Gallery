// 时间线几何：只依据服务端分桶计数推导整条时间线的行布局，无需预先加载全部媒体。

export interface TimelineBucket {
  /** 年月键，YYYY-MM */
  key: string;
  count: number;
  /** 该月起止 Unix 秒（左闭右开，服务器本地时区） */
  start: number;
  end: number;
}

export type TimelineRow =
  | { kind: 'header'; bucketIndex: number }
  | { kind: 'media'; bucketIndex: number; startIndex: number; length: number };

/** 时间线按月读取的分页大小（与画廊分页一致） */
export const TIMELINE_PAGE_SIZE = 120;
export const TIMELINE_HEADER_HEIGHT = 64;

/** 网格列数与间距：手机至少 3 列、4px 间距；更宽时按 180px 目标列宽、8px 间距 */
export const resolveTimelineGrid = (width: number): { columns: number; gap: number; cell: number } => {
  const gap = width < 640 ? 4 : 8;
  const target = width < 640 ? 110 : 180;
  const columns = Math.max(3, Math.floor((width + gap) / (target + gap)));
  const cell = Math.max(1, (width - gap * (columns - 1)) / columns);
  return { columns, gap, cell };
};

export const buildTimelineRows = (buckets: TimelineBucket[], columns: number): TimelineRow[] => {
  const safeColumns = Math.max(1, columns);
  const rows: TimelineRow[] = [];
  buckets.forEach((bucket, bucketIndex) => {
    if (bucket.count <= 0) return;
    rows.push({ kind: 'header', bucketIndex });
    for (let startIndex = 0; startIndex < bucket.count; startIndex += safeColumns) {
      rows.push({ kind: 'media', bucketIndex, startIndex, length: Math.min(safeColumns, bucket.count - startIndex) });
    }
  });
  return rows;
};

/** 行的起始纵向偏移（前缀和），末尾额外一项为总高度。 */
export const computeRowOffsets = (rows: TimelineRow[], mediaRowHeight: number, headerHeight = TIMELINE_HEADER_HEIGHT): number[] => {
  const offsets = new Array<number>(rows.length + 1);
  offsets[0] = 0;
  rows.forEach((row, index) => {
    offsets[index + 1] = offsets[index] + (row.kind === 'header' ? headerHeight : mediaRowHeight);
  });
  return offsets;
};

/** 二分查找给定纵向偏移所在的行。 */
export const findRowAtOffset = (offsets: number[], offset: number): number => {
  let low = 0;
  let high = offsets.length - 2;
  if (high < 0) return 0;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
};

/** 可见行区间需要的“月 + 页”，按出现顺序去重（键为 `${bucketIndex}:${page}`）。 */
export const collectNeededPages = (rows: TimelineRow[], startRow: number, endRow: number): Array<{ bucketIndex: number; page: number }> => {
  const seen = new Set<string>();
  const result: Array<{ bucketIndex: number; page: number }> = [];
  for (let index = Math.max(0, startRow); index <= Math.min(rows.length - 1, endRow); index += 1) {
    const row = rows[index];
    if (row.kind !== 'media') continue;
    const firstPage = Math.floor(row.startIndex / TIMELINE_PAGE_SIZE);
    const lastPage = Math.floor((row.startIndex + row.length - 1) / TIMELINE_PAGE_SIZE);
    for (let page = firstPage; page <= lastPage; page += 1) {
      const key = `${row.bucketIndex}:${page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ bucketIndex: row.bucketIndex, page });
    }
  }
  return result;
};

/** 每个分桶章节标题行的索引，供跳转与拖动条使用。 */
export const findHeaderRows = (rows: TimelineRow[]): Map<number, number> => {
  const headers = new Map<number, number>();
  rows.forEach((row, index) => {
    if (row.kind === 'header') headers.set(row.bucketIndex, index);
  });
  return headers;
};

/** 拖动条年份标记：每年第一个月的章节在整条时间线中的相对位置（0~1）。 */
export const buildYearMarks = (
  buckets: TimelineBucket[],
  rows: TimelineRow[],
  offsets: number[],
): Array<{ year: string; ratio: number; bucketIndex: number }> => {
  const total = offsets[offsets.length - 1] || 1;
  const headers = findHeaderRows(rows);
  const marks: Array<{ year: string; ratio: number; bucketIndex: number }> = [];
  let lastYear = '';
  buckets.forEach((bucket, bucketIndex) => {
    const year = bucket.key.slice(0, 4);
    const rowIndex = headers.get(bucketIndex);
    if (year === lastYear || rowIndex === undefined) return;
    lastYear = year;
    marks.push({ year, ratio: offsets[rowIndex] / total, bucketIndex });
  });
  return marks;
};

/** 章节标题文案：中文“2026 年 9 月”，英文“September 2026”。 */
export const formatBucketLabel = (key: string, language: 'zh' | 'en'): string => {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  if (language === 'zh') return `${year} 年 ${month} 月`;
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
