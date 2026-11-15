import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MediaItem } from '@luvia/contracts';
import { Images, LoaderCircle, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { q } from '@/lib/query';
import { cn } from '@/lib/cn';
import { aspectOf, justifyRows, type JustifiedRow } from '@/components/media/justify';
import { useDimensionsVersion } from '@/lib/dimensions';
import { GRID_GAP, useElementWidth, useRowHeight } from '@/components/media/MediaGrid';
import { Thumb } from '@/components/media/Thumb';
import { openViewer } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';

/** 随机池上限：接口 count 的最大值，够覆盖超大屏。 */
export const SHUFFLE_COUNT = 100;
/** 随便看看只放可展示的图片与视频，不含音频。 */
export const SHUFFLE_TYPES: Array<'image' | 'video'> = ['image', 'video'];
/** 低于这个缩放比例说明池子或视口异常，宁可溢出也不把图压得太扁。 */
const MIN_FILL_SCALE = 0.55;

export interface ShuffleFill {
  rows: JustifiedRow<MediaItem>[];
  scale: number;
  shown: MediaItem[];
}

/**
 * 按真实行高累计到视口高度，再把整组行轻微压缩到恰好铺满。
 * 这样末行不会切在底部导航上，底部也不会留下大片空白；行宽保持满幅，
 * 纵向裁切由 Thumb 的 object-fit: cover 吸收。
 */
export function fillShuffleRows(
  rows: JustifiedRow<MediaItem>[],
  headerHeight: number,
  viewportHeight: number,
  gap: number,
): ShuffleFill {
  if (viewportHeight <= 0 || rows.length === 0) return { rows: [], scale: 1, shown: [] };

  const visible: JustifiedRow<MediaItem>[] = [];
  let sumHeight = 0;
  let height = headerHeight;
  for (const row of rows) {
    const rowHeight = Math.max(40, Math.round(row.height));
    visible.push(row);
    sumHeight += rowHeight;
    height += rowHeight + gap;
    if (height >= viewportHeight) break;
    // 极端情况下防止把整池都塞进一屏；正常的 100 张远小于这个上限。
    if (visible.length >= 40) break;
  }

  const available = Math.max(1, viewportHeight - headerHeight);
  const gaps = gap * Math.max(0, visible.length - 1);
  const scale = Math.min(1, Math.max(MIN_FILL_SCALE, (available - gaps) / sumHeight));
  return {
    rows: visible,
    scale,
    shown: visible.flatMap((row) => row.cells.map((cell) => cell.item)),
  };
}

/** 滚动容器高度：移动端 AppShell 已用 padding 预留底部导航，这里拿到的是真实可见高度。 */
function useElementHeight(element: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!element) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

function ShuffleSkeleton() {
  return (
    <div aria-hidden className="grid w-full grid-cols-3 gap-1 md:grid-cols-4">
      {Array.from({ length: 16 }, (_, index) => (
        <div key={index} className="aspect-[3/2] animate-pulse rounded-[var(--r1)] bg-sunken" />
      ))}
    </div>
  );
}

function ShuffleEmpty() {
  return (
    <div className="w-full rounded-[var(--r3)] border border-dashed border-line-2 px-5 py-10 text-center">
      <Images className="mx-auto mb-3 size-8 text-muted" strokeWidth={1.6} />
      <p className="m-0 text-[15px] font-semibold text-fg-2">媒体库里还没有照片或视频</p>
      <p className="mx-auto mt-1.5 mb-0 max-w-md text-[13px] text-muted">
        添加媒体库并完成扫描后，这里会按视口随机铺满整屏照片和视频。
      </p>
    </div>
  );
}

function ShuffleError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="w-full rounded-[var(--r3)] border border-dashed border-line-2 px-5 py-10 text-center">
      <p className="m-0 text-sm text-muted">随便看看没有加载出来：{message}。</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg"
      >
        重新加载
      </button>
    </div>
  );
}

/**
 * 首页「随便看看」整屏随机墙：独立于 memories 查询，只替换本区域。
 * 随机池取全库图片与视频，按视口补满；换一批保留上一批直到新数据返回。
 */
export function ShuffleWall({ scrollElement }: { scrollElement: HTMLElement | null }) {
  const shuffleQ = useQuery(q('randomMedia', {
    query: { count: SHUFFLE_COUNT, types: SHUFFLE_TYPES },
  }));

  const [gridRef, width] = useElementWidth<HTMLDivElement>();
  const rowHeight = useRowHeight(width || 1000);
  const dimensionsVersion = useDimensionsVersion();
  const viewportHeight = useElementHeight(scrollElement);

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const measure = () => setHeaderHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [refreshError, setRefreshError] = useState(false);

  const items = shuffleQ.data?.items ?? [];
  const rows = useMemo(
    () => justifyRows(items, aspectOf, width, rowHeight, GRID_GAP),
    // dimensionsVersion：补到新宽高后重新排布
    [items, width, rowHeight, dimensionsVersion],
  );
  const fill = useMemo(
    () => fillShuffleRows(rows, headerHeight, viewportHeight, GRID_GAP),
    [rows, headerHeight, viewportHeight],
  );

  const initialLoading = shuffleQ.isPending;
  const initialError = shuffleQ.isError && !shuffleQ.data;
  const empty = !initialLoading && !initialError && items.length === 0;
  const refreshing = shuffleQ.isFetching;
  const errorMessage = shuffleQ.error instanceof Error ? shuffleQ.error.message : '网络或服务器暂时不可用';

  useEffect(() => {
    if (!refreshError) return;
    const timer = setTimeout(() => setRefreshError(false), 4200);
    return () => clearTimeout(timer);
  }, [refreshError]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshError(false);
    try {
      const result = await shuffleQ.refetch();
      if (result.isError) throw result.error;
    } catch {
      setRefreshError(true);
      toast.error('没有换成功，请稍后再试');
    }
  };

  const countText = initialLoading ? '正在挑选…' : initialError ? '加载失败' : `本批 ${fill.shown.length} 项`;
  const contentMinHeight = viewportHeight > 0 ? Math.max(0, viewportHeight - headerHeight) : undefined;
  const centered = initialError || empty;

  // 行高取整后可能差几像素：把差额收进最后一行，避免末行被视口切掉。
  const scaledHeights = fill.rows.map((row) => Math.max(40, Math.round(row.height * fill.scale)));
  if (fill.scale < 1 && scaledHeights.length > 0 && contentMinHeight !== undefined) {
    const gaps = GRID_GAP * (scaledHeights.length - 1);
    const total = scaledHeights.reduce((sum, height) => sum + height, 0) + gaps;
    const diff = contentMinHeight - total;
    if (diff !== 0) {
      const last = scaledHeights.length - 1;
      scaledHeights[last] = Math.max(40, scaledHeights[last]! + diff);
    }
  }

  return (
    <section aria-labelledby="shuffle-wall-title" className="relative mt-[34px]" style={{ minHeight: viewportHeight || undefined }}>
      <div
        ref={headerRef}
        className="sticky top-0 z-20 border-b border-line bg-bg/85 px-11 py-2.5 backdrop-blur-md max-md:px-4 max-md:py-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 max-md:gap-x-2 max-md:gap-y-1">
          <h2 id="shuffle-wall-title" className="m-0 text-lg font-semibold max-md:text-[17px]">随便看看</h2>
          <span className="text-[13px] text-muted max-md:text-[11.5px]">全库随机 · 图片 + 视频</span>
          <span className="text-[12.5px] text-muted tabular-nums max-md:text-[11px]" aria-live="polite">{countText}</span>
          {refreshError && <span className="text-[11px] text-bad max-md:text-[10.5px]">换一批失败，已保留上一批</span>}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || items.length === 0}
            aria-label="换一批随机照片和视频"
            aria-busy={refreshing}
            className={cn(
              'ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-surface px-3 text-[12.5px] font-medium text-fg-2 transition-colors max-md:h-9 max-md:px-2.5 max-md:text-[11.5px]',
              'hover:bg-accent-soft hover:text-fg disabled:cursor-default disabled:opacity-55',
            )}
          >
            {refreshing
              ? <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} />
              : <Shuffle className="size-4" strokeWidth={1.8} />}
            换一批
          </button>
        </div>
      </div>

      <div className="flex flex-col px-11 max-md:px-4" style={{ minHeight: contentMinHeight }}>
        <div
          ref={gridRef}
          className={cn('flex w-full flex-col', centered && 'flex-1 items-center justify-center')}
          style={centered ? undefined : { gap: GRID_GAP }}
        >
          {initialLoading ? <ShuffleSkeleton /> : initialError ? (
            <ShuffleError message={errorMessage} onRetry={() => void shuffleQ.refetch()} />
          ) : empty ? <ShuffleEmpty /> : (
            fill.rows.map((row, rowIndex) => {
              const scaledHeight = scaledHeights[rowIndex] ?? Math.max(40, Math.round(row.height * fill.scale));
              let used = 0;
              return (
                <div
                  key={`${row.top}:${row.cells[0]?.item.id ?? ''}`}
                  className="flex"
                  style={{ gap: GRID_GAP, height: scaledHeight }}
                >
                  {row.cells.map((cell, index) => {
                    const isLast = index === row.cells.length - 1;
                    const cellWidth = isLast ? Math.max(1, width - used) : Math.floor(cell.width);
                    used += cellWidth + GRID_GAP;
                    return (
                      <Thumb
                        key={cell.item.id}
                        item={cell.item}
                        width={cellWidth}
                        height={scaledHeight}
                        onMouseEnter={() => setDynamicFrom(cell.item)}
                        onClick={(event) => openViewer(
                          { label: '随便看看', items: fill.shown },
                          Math.max(0, fill.shown.indexOf(cell.item)),
                          { originEl: event.currentTarget },
                        )}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
