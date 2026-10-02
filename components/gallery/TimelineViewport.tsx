// 时间线视口：依据服务端按月分桶的计数推导整条时间线布局，按“月 + 页”懒加载媒体。
// 百万级媒体下无需加载全部条目即可滚动与跳转；章节标题使用暖色衬线日期（暗房影院契约 1.2）。
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { MediaItem } from '../../types';
import { MediaCard } from '../PhotoCard';
import { TimelineScrubber } from '../TimelineScrubber';
import { useLanguage } from '../../contexts/LanguageContext';
import { createViewportSnapshot, type ViewportCaptureHandle, type ViewportRestoreCommand, type ViewportSnapshot } from './viewport-types';
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_PAGE_SIZE,
  buildTimelineRows,
  buildYearMarks,
  collectNeededPages,
  computeRowOffsets,
  findHeaderRows,
  findRowAtOffset,
  formatBucketLabel,
  resolveTimelineGrid,
  type TimelineBucket,
  type TimelineRow,
} from './timeline-layout';

const VariableSizeList = (ReactWindow as any).VariableSizeList;

// 顶部安全区：md 及以上第一行避开统一工具栏浮岛，与网格/瀑布流的 64px 安全区一致。
export const TIMELINE_TOP_SAFE_AREA_CLASSES = 'md:pt-16';

/** 同时进行的分页请求上限，快速拖动时只加载最终停留区域 */
const MAX_CONCURRENT_PAGE_LOADS = 2;
/** 右侧为时间拖动条预留的宽度 */
const SCRUBBER_GUTTER = 40;
const PAGE_LOAD_DEBOUNCE_MS = 120;

export interface TimelineViewportProps {
  /** 位置标识：变化时重置滚动与数据 */
  viewKey: string;
  /** 范围查询串（以 & 开头），例如 &favorites=true&mediaType=image&search=x */
  scopeQuery: string;
  /** 带鉴权的 JSON 请求 */
  fetchJson: (url: string, signal?: AbortSignal) => Promise<any>;
  /** 打开媒体：第二个参数为当前已加载、按时间线顺序排列的媒体 */
  onOpenItem: (item: MediaItem, loadedItems: MediaItem[]) => void;
  mediaHoverZoomEnabled: boolean;
  restoreSnapshot?: ViewportSnapshot;
  restoreCommand?: ViewportRestoreCommand;
  onSnapshotChange?: (snapshot: ViewportSnapshot) => void;
  onRestoreComplete?: (token: number) => void;
}

type PageKey = string;
const pageKey = (bucketKey: string, page: number): PageKey => `${bucketKey}:${page}`;

interface InnerProps extends TimelineViewportProps {
  width: number;
  height: number;
  buckets: TimelineBucket[];
}

const TimelineViewportInner = React.forwardRef<ViewportCaptureHandle, InnerProps>(({
  width,
  height,
  buckets,
  viewKey,
  scopeQuery,
  fetchJson,
  onOpenItem,
  mediaHoverZoomEnabled,
  restoreSnapshot,
  restoreCommand,
  onSnapshotChange,
  onRestoreComplete,
}, ref) => {
  const { language } = useLanguage();
  const listRef = useRef<any>(null);
  const pagesRef = useRef(new Map<PageKey, MediaItem[]>());
  const inflightRef = useRef(new Set<PageKey>());
  const queueRef = useRef<Array<{ bucketIndex: number; page: number }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTopRef = useRef(0);
  const restoredRef = useRef<string | null>(null);
  const [, setDataVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const contentWidth = Math.max(0, width - SCRUBBER_GUTTER);
  const { columns, gap, cell } = resolveTimelineGrid(contentWidth);
  const mediaRowHeight = cell + gap;
  const rows = useMemo(() => buildTimelineRows(buckets, columns), [buckets, columns]);
  const offsets = useMemo(() => computeRowOffsets(rows, mediaRowHeight), [rows, mediaRowHeight]);
  const totalHeight = offsets[offsets.length - 1] || 0;
  const headerRows = useMemo(() => findHeaderRows(rows), [rows]);
  const yearMarks = useMemo(() => buildYearMarks(buckets, rows, offsets), [buckets, rows, offsets]);

  // 列数或分桶变化时行高缓存失效
  useEffect(() => {
    listRef.current?.resetAfterIndex?.(0, true);
  }, [rows, mediaRowHeight]);

  // 范围变化：清空已加载数据
  useEffect(() => {
    pagesRef.current.clear();
    inflightRef.current.clear();
    queueRef.current = [];
    setDataVersion(version => version + 1);
  }, [scopeQuery, viewKey]);

  const pumpQueue = useCallback(() => {
    while (inflightRef.current.size < MAX_CONCURRENT_PAGE_LOADS && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      const bucket = buckets[next.bucketIndex];
      if (!bucket) continue;
      const key = pageKey(bucket.key, next.page);
      if (pagesRef.current.has(key) || inflightRef.current.has(key)) continue;
      inflightRef.current.add(key);
      const url = `/api/scan/results?offset=${next.page * TIMELINE_PAGE_SIZE}&limit=${TIMELINE_PAGE_SIZE}&sort=dateDesc&from=${bucket.start}&to=${bucket.end}${scopeQuery}`;
      fetchJson(url)
        .then((data) => {
          if (Array.isArray(data?.files)) {
            pagesRef.current.set(key, data.files);
            setDataVersion(version => version + 1);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inflightRef.current.delete(key);
          pumpQueue();
        });
    }
  }, [buckets, fetchJson, scopeQuery]);

  const requestRows = useCallback((startRow: number, endRow: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // 只保留最新可见区域的请求，过时的排队请求直接丢弃
      queueRef.current = collectNeededPages(rows, startRow, endRow).filter(({ bucketIndex, page }) => {
        const bucket = buckets[bucketIndex];
        return bucket && !pagesRef.current.has(pageKey(bucket.key, page));
      });
      pumpQueue();
    }, PAGE_LOAD_DEBOUNCE_MS);
  }, [buckets, pumpQueue, rows]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const itemAt = (bucketIndex: number, index: number): MediaItem | undefined => {
    const bucket = buckets[bucketIndex];
    if (!bucket) return undefined;
    const page = pagesRef.current.get(pageKey(bucket.key, Math.floor(index / TIMELINE_PAGE_SIZE)));
    return page?.[index % TIMELINE_PAGE_SIZE];
  };

  const loadedItemsInOrder = useCallback((): MediaItem[] => {
    const result: MediaItem[] = [];
    buckets.forEach((bucket) => {
      const pages = Math.ceil(bucket.count / TIMELINE_PAGE_SIZE);
      for (let page = 0; page < pages; page += 1) {
        const items = pagesRef.current.get(pageKey(bucket.key, page));
        if (items) result.push(...items);
      }
    });
    return result;
  }, [buckets]);

  // 视口快照：时间线按滚动偏移恢复（布局完全由分桶决定，偏移即可精确定位）
  useImperativeHandle(ref, () => ({
    captureSnapshot: () => createViewportSnapshot(viewKey, undefined, undefined, 0, scrollTopRef.current, 0),
  }), [viewKey]);

  useEffect(() => {
    const snapshot = restoreCommand?.snapshot ?? restoreSnapshot;
    const marker = `${viewKey}:${restoreCommand?.token ?? ''}:${snapshot?.capturedAt ?? ''}`;
    if (restoredRef.current === marker || rows.length === 0) return;
    restoredRef.current = marker;
    const top = snapshot && snapshot.locationKey === viewKey ? snapshot.fallbackScrollTop : 0;
    listRef.current?.scrollTo(Math.max(0, Math.min(top, totalHeight)));
    if (restoreCommand) onRestoreComplete?.(restoreCommand.token);
  }, [onRestoreComplete, restoreCommand, restoreSnapshot, rows.length, totalHeight, viewKey]);

  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = ({ scrollOffset }: { scrollOffset: number }) => {
    scrollTopRef.current = scrollOffset;
    setScrollTop(scrollOffset);
    if (!onSnapshotChange) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      onSnapshotChange(createViewportSnapshot(viewKey, undefined, undefined, 0, scrollTopRef.current, 0));
    }, 250);
  };
  useEffect(() => () => { if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current); }, []);

  const scrollToRatio = useCallback((ratio: number) => {
    const target = ratio * Math.max(0, totalHeight - height);
    // 对齐到目标位置所在月份的章节标题，跳转后第一眼看到的是月份
    const row = findRowAtOffset(offsets, ratio * totalHeight);
    const header = headerRows.get(rows[row]?.bucketIndex ?? -1);
    listRef.current?.scrollTo(header !== undefined ? Math.min(offsets[header], Math.max(0, totalHeight - height)) : target);
  }, [headerRows, height, offsets, rows, totalHeight]);

  const currentRow = rows.length > 0 ? findRowAtOffset(offsets, scrollTop) : -1;
  const currentBucketIndex = currentRow >= 0 ? rows[currentRow].bucketIndex : -1;
  const currentBucket = currentBucketIndex >= 0 ? buckets[currentBucketIndex] : undefined;
  // 当前月份的章节标题已滚出视口时才显示浮签，避免与标题重叠
  const currentHeaderRow = headerRows.get(currentBucketIndex);
  const showMonthPill = currentHeaderRow !== undefined && scrollTop >= offsets[currentHeaderRow] + TIMELINE_HEADER_HEIGHT - 8;
  const scrollable = Math.max(1, totalHeight - height);
  const progress = Math.min(1, scrollTop / scrollable);

  const labelAtRatio = (ratio: number) => {
    const row = findRowAtOffset(offsets, ratio * totalHeight);
    const bucket = buckets[rows[row]?.bucketIndex ?? -1];
    return bucket ? formatBucketLabel(bucket.key, language) : '';
  };

  const renderRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const row: TimelineRow = rows[index];
    const bucket = buckets[row.bucketIndex];
    if (row.kind === 'header') {
      return (
        <div style={{ ...style, paddingRight: SCRUBBER_GUTTER }} className="flex items-end justify-between gap-3 pb-3">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {formatBucketLabel(bucket.key, language)}
          </h2>
          <span className="pb-1 text-xs tabular-nums text-muted-foreground">{bucket.count.toLocaleString()}</span>
        </div>
      );
    }
    return (
      <div style={{ ...style, display: 'flex', gap, paddingRight: SCRUBBER_GUTTER }}>
        {Array.from({ length: row.length }, (_, offset) => {
          const index = row.startIndex + offset;
          const item = itemAt(row.bucketIndex, index);
          return (
            <div key={item?.id ?? `${bucket.key}:${index}`} style={{ width: cell, height: cell, flexShrink: 0 }}>
              {item ? (
                <MediaCard
                  item={item}
                  onClick={(clicked) => onOpenItem(clicked, loadedItemsInOrder())}
                  layout="grid"
                  isVirtual
                  mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                />
              ) : (
                <div className="h-full w-full rounded-md bg-muted" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="relative" style={{ width, height }}>
      <VariableSizeList
        ref={listRef}
        width={width}
        height={height}
        itemCount={rows.length}
        itemSize={(index: number) => offsets[index + 1] - offsets[index]}
        estimatedItemSize={mediaRowHeight}
        overscanCount={4}
        onScroll={handleScroll}
        onItemsRendered={({ overscanStartIndex, overscanStopIndex }: { overscanStartIndex: number; overscanStopIndex: number }) =>
          requestRows(overscanStartIndex, overscanStopIndex)}
        className="no-scrollbar"
      >
        {renderRow}
      </VariableSizeList>

      {/* 当前月份浮签：滚过章节标题后仍能看到所处月份 */}
      {currentBucket && showMonthPill && (
        <div
          aria-hidden="true"
          data-testid="timeline-current-month"
          className="pointer-events-none absolute top-2 left-2 rounded-full border border-border bg-popover/90 px-3 py-1 font-serif text-sm text-popover-foreground shadow-sm backdrop-blur-sm"
        >
          {formatBucketLabel(currentBucket.key, language)}
        </div>
      )}

      {totalHeight > height && (
        <TimelineScrubber
          marks={yearMarks}
          progress={progress}
          onScrub={scrollToRatio}
          labelAt={labelAtRatio}
          ariaLabel={language === 'zh' ? '时间线拖动条' : 'Timeline scrubber'}
        />
      )}
    </div>
  );
});

/** 时间线视口：负责请求分桶、空状态与尺寸测量，几何与懒加载由内层组件完成。 */
export const TimelineViewport = React.forwardRef<ViewportCaptureHandle, TimelineViewportProps>((props, ref) => {
  const { language } = useLanguage();
  const [buckets, setBuckets] = useState<TimelineBucket[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setBuckets(null);
    setFailed(false);
    props.fetchJson(`/api/timeline/buckets?v=1${props.scopeQuery}`, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setBuckets(Array.isArray(data?.buckets) ? data.buckets : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [props.fetchJson, props.scopeQuery, props.viewKey, reloadToken]);

  return (
    <div className={`h-full w-full ${TIMELINE_TOP_SAFE_AREA_CLASSES}`} data-testid="timeline-viewport">
      {failed ? (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>{language === 'zh' ? '时间线加载失败' : "Couldn't load the timeline"}</span>
          <button type="button" className="rounded-full border border-border px-4 py-1.5 text-foreground hover:bg-accent" onClick={() => setReloadToken(token => token + 1)}>
            {language === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      ) : buckets === null ? (
        <div className="flex h-full items-center justify-center" aria-busy="true">
          <div className="h-8 w-40 rounded-md bg-muted" aria-hidden="true" />
        </div>
      ) : buckets.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {language === 'zh' ? '没有可显示的媒体' : 'Nothing to show'}
        </div>
      ) : (
        <AutoSizer>
          {({ width, height }: { width: number; height: number }) => (
            <TimelineViewportInner ref={ref} {...props} width={width} height={height} buckets={buckets} />
          )}
        </AutoSizer>
      )}
    </div>
  );
});
