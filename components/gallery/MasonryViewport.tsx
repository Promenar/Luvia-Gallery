import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { CommonViewportProps, ViewportCaptureHandle, resolveAnchorIndex, createViewportSnapshot } from './viewport-types';
import { MediaCard } from '../PhotoCard';
import { FolderCard } from '../FolderCard';

const SKELETON_ASPECT_RATIOS = [0.72, 1, 1.28, 0.8, 1.5, 0.92] as const;
const LOAD_MORE_SKELETONS_PER_COLUMN = 3;
export const MASONRY_TOP_SAFE_AREA_CLASSES = 'px-1 pb-1 pt-1 md:pt-16';

export const getMasonryInitialSkeletonCount = (
  columnCount: number,
  viewportHeight: number,
  viewportWidth: number,
): number => {
  const safeColumns = Math.max(1, columnCount);
  const columnWidth = Math.max(120, (viewportWidth - ((safeColumns - 1) * 16)) / safeColumns);
  const averageCardHeight = columnWidth / 1.02 + 16;
  const rowsForTwoViewports = Math.ceil((Math.max(480, viewportHeight) * 2) / averageCardHeight);
  return safeColumns * Math.max(4, rowsForTwoViewports);
};

export const isWithinMasonryPrefetchRange = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): boolean => scrollHeight - scrollTop - clientHeight <= clientHeight * 1.5;

export const getMasonryPrefetchRootMargin = (viewportHeight: number): string =>
  `0px 0px ${Math.round(Math.max(1, viewportHeight) * 1.5)}px 0px`;

const MasonrySkeleton = ({ index, phase }: { index: number; phase: 'initial' | 'next' }) => (
  <div
    data-testid={`masonry-${phase}-skeleton`}
    className="relative w-full overflow-hidden rounded-2xl bg-white/[0.045] dark:bg-white/[0.035] animate-pulse"
    style={{ aspectRatio: SKELETON_ASPECT_RATIOS[index % SKELETON_ASPECT_RATIOS.length] }}
    aria-hidden="true"
  >
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.035] via-transparent to-black/[0.025]" />
  </div>
);

// 先定义 forwardRef 内核，再包 memo：拦截 props 未变化的父级重渲染，
// 避免全量列分块与卡片链路重新执行；ref 透传与快照捕获协议不受影响。
const MasonryViewportImpl = React.forwardRef<ViewportCaptureHandle, CommonViewportProps>(({
  items,
  onItemClick,
  hasNextPage,
  isInitialLoading,
  isNextPageLoading,
  loadNextPage,
  onToggleFavorite,
  onRename,
  onDelete,
  onRegenerate,
  mediaHoverZoomEnabled,
  viewKey,
  restoreSnapshot,
  restoreCommand,
  onSnapshotChange,
  onRestoreComplete
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadLockRef = useRef(false);
  const loadStateRef = useRef({ hasNextPage, isInitialLoading, isNextPageLoading, itemsLength: items.length, loadNextPage });
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  loadStateRef.current = { hasNextPage, isInitialLoading, isNextPageLoading, itemsLength: items.length, loadNextPage };

  // 滚动位置捕获与恢复锁
  const isRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const currentScrollTopRef = useRef(0);
  const positionIdentityViewKeyRef = useRef(viewKey);
  const restoreCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRestoreTokenRef = useRef<number | null>(null);

  // 快照节流上报
  const pendingSnapshotRef = useRef<any>(null);
  const throttleTimerRef = useRef<any>(null);

  const cancelPendingSnapshot = () => {
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    throttleTimerRef.current = null;
    pendingSnapshotRef.current = null;
  };

  const cancelRestoreTransaction = () => {
    if (restoreCompletionTimerRef.current) clearTimeout(restoreCompletionTimerRef.current);
    restoreCompletionTimerRef.current = null;
    activeRestoreTokenRef.current = null;
    isRestoringRef.current = false;
  };

  const reportSnapshot = (snapshot: any) => {
    if (isRestoringRef.current) return;
    onSnapshotChange?.(snapshot);
  };

  const triggerSnapshotUpdate = (snapshot: any) => {
    if (isRestoringRef.current) return;
    pendingSnapshotRef.current = snapshot;
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        if (pendingSnapshotRef.current) {
          reportSnapshot(pendingSnapshotRef.current);
        }
      }, 250); // 滚动捕获节流改为至少250ms
    }
  };

  // 命令 token 优先于快照内容，避免同一路径同毫秒的不同 History 条目被去重。
  const snapshotKey = restoreCommand
    ? `command:${restoreCommand.token}`
    : restoreSnapshot
      ? `snapshot:${restoreSnapshot.locationKey}:${restoreSnapshot.capturedAt}:${restoreSnapshot.anchorItemId ?? ''}:${restoreSnapshot.anchorIndex ?? ''}:${restoreSnapshot.offsetWithinItem}:${restoreSnapshot.fallbackScrollTop}`
      : null;
  const lastRestoredSnapshotKeyRef = useRef<string | null>(null);
  const lastViewKeyRef = useRef(viewKey);

  if (lastViewKeyRef.current !== viewKey || lastRestoredSnapshotKeyRef.current !== snapshotKey) {
    isRestoredRef.current = false;
    lastViewKeyRef.current = viewKey;
    lastRestoredSnapshotKeyRef.current = snapshotKey;
  }
  const restoreToken = restoreCommand?.token ?? -1;

  // 动态分栏列数计算
  const [columnCount, setColumnCount] = useState(3);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateColumns = () => {
      const width = window.innerWidth;
      let cols = 2;
      if (width >= 640) cols = 3;
      if (width >= 1024) cols = 4;
      if (width >= 1280) cols = 5;
      setColumnCount(cols);
    };

    updateColumns();
    window.addEventListener('resize', updateColumns, { passive: true });
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateViewportSize = () => {
      setViewportSize({ width: container.clientWidth, height: container.clientHeight });
    };
    updateViewportSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [viewKey]);

  // 建立每一项 item 的索引和列分块
  const { columns, itemIndices } = useMemo(() => {
    const cols: any[][] = Array.from({ length: columnCount }, () => []);
    const indices: Record<string, number> = {};

    items.forEach((item, i) => {
      cols[i % columnCount].push(item);
      indices[item.id] = i;
    });

    return { columns: cols, itemIndices: indices };
  }, [items, columnCount]);

  const findVisibleAnchorElement = (container: HTMLDivElement) => {
    const containerRect = container.getBoundingClientRect();
    let element: HTMLElement | undefined;
    let rect: DOMRect | undefined;
    const samplePointsX = [0.1, 0.3, 0.5, 0.7, 0.9].map((ratio) => containerRect.left + containerRect.width * ratio);
    const samplePointsY = [15, 45].map((offset) => containerRect.top + offset);

    if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
      outerLoop: for (const y of samplePointsY) {
        for (const x of samplePointsX) {
          if (x < 0 || y < 0) continue;
          const sampled = document.elementFromPoint(x, y);
          const item = sampled?.closest('[data-item-id]') as HTMLElement | null;
          if (item && container.contains(item)) {
            element = item;
            rect = item.getBoundingClientRect();
            break outerLoop;
          }
        }
      }
    }

    if (!element) {
      const candidates = container.querySelectorAll<HTMLElement>('[data-item-id]');
      const maxCheck = Math.min(candidates.length, 30);
      for (let index = 0; index < maxCheck; index += 1) {
        const candidate = candidates[index];
        const candidateRect = candidate.getBoundingClientRect();
      if (
        candidateRect.bottom > containerRect.top &&
        candidateRect.top < containerRect.bottom
      ) {
          element = candidate;
          rect = candidateRect;
          break;
        }
      }
    }

    return element && rect ? { element, rect, containerRect } : undefined;
  };

  const readLiveAnchor = () => {
    const container = containerRef.current;
    if (!container) return undefined;
    const visible = findVisibleAnchorElement(container);
    if (!visible) return undefined;
    const id = visible.element.getAttribute('data-item-id') || undefined;
    const index = id ? itemIndices[id] : undefined;
    if (id === undefined || index === undefined) return undefined;
    const relativeTop = visible.rect.top - visible.containerRect.top;
    return { id, index, offsetWithinItem: -relativeTop };
  };

  const createCurrentSnapshot = (anchor?: { id: string; index: number; offsetWithinItem: number }) => {
    const scrollTop = containerRef.current?.scrollTop ?? currentScrollTopRef.current;
    currentScrollTopRef.current = scrollTop;
    if (!anchor) return createViewportSnapshot(viewKey, undefined, undefined, 0, scrollTop, items.length);
    return createViewportSnapshot(viewKey, anchor.id, anchor.index, anchor.offsetWithinItem, scrollTop, items.length);
  };

  const captureCurrentSnapshot = () => {
    cancelPendingSnapshot();
    return createCurrentSnapshot(readLiveAnchor());
  };

  React.useImperativeHandle(ref, () => ({ captureSnapshot: captureCurrentSnapshot }), [viewKey, items.length, itemIndices]);

  useEffect(() => {
    if (positionIdentityViewKeyRef.current !== viewKey) {
      loadLockRef.current = false;
      cancelPendingSnapshot();
      currentScrollTopRef.current = 0;
      isRestoringRef.current = false;
      positionIdentityViewKeyRef.current = viewKey;
    }
    return cancelPendingSnapshot;
  }, [viewKey]);

  // 完成或重试定时器只由命令身份或视图身份终止，items 更新不能打断当前事务。
  useEffect(() => {
    cancelRestoreTransaction();
  }, [viewKey, snapshotKey]);

  // 执行恢复
  useEffect(() => {
    if (isRestoredRef.current || isRestoringRef.current) return;
    if (!containerRef.current) return;
    if (!restoreSnapshot && !restoreCommand) return;
    if (items.length === 0 && !restoreCommand) return;

    let retryCount = 0;
    activeRestoreTokenRef.current = restoreToken;
    isRestoringRef.current = true;

    const scheduleCompletion = () => {
      restoreCompletionTimerRef.current = setTimeout(() => {
        if (activeRestoreTokenRef.current !== restoreToken) return;
        restoreCompletionTimerRef.current = null;
        activeRestoreTokenRef.current = null;
        isRestoringRef.current = false;
        onRestoreComplete?.(restoreToken);
      }, 150);
    };

    const tryRestore = () => {
      const container = containerRef.current;
      if (!container || activeRestoreTokenRef.current !== restoreToken) return;

      if (!restoreSnapshot) {
        // 受管 History 的空快照是明确 reset 命令，不能保留上一条目的滚动位置。
        cancelPendingSnapshot();
        cancelRestoreTransaction();
        activeRestoreTokenRef.current = restoreToken;
        isRestoringRef.current = true;
        container.scrollTop = 0;
        currentScrollTopRef.current = 0;
        isRestoredRef.current = true;
        scheduleCompletion();
        return;
      }

      const { anchorItemId, fallbackScrollTop, offsetWithinItem = 0 } = restoreSnapshot;

      if (anchorItemId) {
        const el = container.querySelector(`[data-item-id="${anchorItemId}"]`) as HTMLElement;
        if (el) {
          isRestoredRef.current = true;

          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const currentRelativeTop = elRect.top - containerRect.top;

          // 统一正号语义，修复符号相反
          container.scrollTop = container.scrollTop + currentRelativeTop + offsetWithinItem;

          scheduleCompletion();
        } else {
          // 如果没找到，并且重试次数小于 5 次，则隔 50ms 再试
          if (retryCount < 5) {
            retryCount++;
            restoreCompletionTimerRef.current = setTimeout(tryRestore, 50);
          } else {
            // 实在找不到，以 scrollTop 兜底
            isRestoredRef.current = true;
            container.scrollTop = fallbackScrollTop;
            currentScrollTopRef.current = fallbackScrollTop;
            scheduleCompletion();
          }
        }
      } else if (fallbackScrollTop > 0) {
        isRestoredRef.current = true;
        container.scrollTop = fallbackScrollTop;
        currentScrollTopRef.current = fallbackScrollTop;
        scheduleCompletion();
      } else {
        isRestoredRef.current = true;
        scheduleCompletion();
      }
    };

    tryRestore();
  }, [items, restoreSnapshot, restoreCommand?.token, viewKey]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      cancelPendingSnapshot();
      cancelRestoreTransaction();
    };
  }, []);

  const requestNextPage = useCallback(() => {
    const loadState = loadStateRef.current;
    if (!loadState.hasNextPage || loadState.isInitialLoading || loadState.isNextPageLoading || loadLockRef.current) return;
    loadLockRef.current = true;
    const loadPromise = loadState.loadNextPage(loadState.itemsLength, loadState.itemsLength + 120);
    if (loadPromise && typeof loadPromise.then === 'function') {
      loadPromise.then(
        () => { loadLockRef.current = false; },
        () => { loadLockRef.current = false; },
      );
    } else {
      setTimeout(() => {
        loadLockRef.current = false;
      }, 1000);
    }
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) requestNextPage();
    }, {
      root,
      rootMargin: getMasonryPrefetchRootMargin(viewportSize.height || root.clientHeight),
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isInitialLoading, requestNextPage, viewKey, viewportSize.height]);

  const processScrollFrame = () => {
    scrollFrameRef.current = null;
    const container = containerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    currentScrollTopRef.current = scrollTop;

    // 每次滚动都保留阈值预取；IO 请求失败后哨兵可能不会再次回调，滚动可触发重试。
    if (isWithinMasonryPrefetchRange(container.scrollHeight, scrollTop, container.clientHeight)) {
      requestNextPage();
    }

    // 采样失败时只上报当前 scrollTop 兜底，绝不复用旧锚点或旧偏移。
    triggerSnapshotUpdate(createCurrentSnapshot(readLiveAnchor()));
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      currentScrollTopRef.current = container.scrollTop;
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = requestAnimationFrame(processScrollFrame);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [hasNextPage, isNextPageLoading, items.length, requestNextPage, viewKey, itemIndices]);

  const initialSkeletonCount = getMasonryInitialSkeletonCount(
    columnCount,
    viewportSize.height || (typeof window === 'undefined' ? 800 : window.innerHeight),
    viewportSize.width || (typeof window === 'undefined' ? 1000 : window.innerWidth),
  );
  const initialSkeletonColumns = useMemo(() => {
    const result = Array.from({ length: columnCount }, () => [] as number[]);
    for (let index = 0; index < initialSkeletonCount; index += 1) {
      result[index % columnCount].push(index);
    }
    return result;
  }, [columnCount, initialSkeletonCount]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-auto pb-20 no-scrollbar"
    >
      <div
        className={`flex gap-4 items-start ${MASONRY_TOP_SAFE_AREA_CLASSES}`}
        data-testid="masonry-scroll-content"
      >
        {(isInitialLoading && items.length === 0 ? initialSkeletonColumns : columns).map((colItems, colIndex) => (
          <div key={colIndex} className="flex-1 flex flex-col gap-4">
            {isInitialLoading && items.length === 0 ? (
              (colItems as number[]).map(index => <MasonrySkeleton key={`initial-${index}`} index={index} phase="initial" />)
            ) : (colItems as typeof items).filter(item => item && item.id).map((item) => {
              const actualIndex = itemIndices[item.id];
              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  data-item-index={actualIndex}
                  className="w-full"
                >
                  {item.mediaType === 'folder' ? (
                    <div className="relative w-full pb-[100%]">
                      <div className="absolute inset-0">
                        <FolderCard
                          folder={{
                            name: item.name,
                            path: item.path,
                            children: item.children || {},
                            mediaCount: item.mediaCount || 0,
                            coverMedia: item.coverMedia
                          }}
                          onClick={() => onItemClick(item)}
                          isFavorite={item.isFavorite}
                          onToggleFavorite={onToggleFavorite ? (path) => onToggleFavorite(path, 'folder') : undefined}
                          onRename={onRename}
                          onDelete={onDelete}
                          onRegenerate={onRegenerate}
                          layout="masonry"
                        />
                      </div>
                    </div>
                  ) : (
                    <MediaCard
                      item={item}
                      onClick={onItemClick}
                      layout="masonry"
                      isVirtual={false}
                      imagePriority={actualIndex < columnCount * 2}
                      mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                    />
                  )}
                </div>
              );
            })}
            {!isInitialLoading && isNextPageLoading && Array.from({ length: LOAD_MORE_SKELETONS_PER_COLUMN }, (_, index) => (
              <MasonrySkeleton key={`next-${colIndex}-${index}`} index={(colIndex * LOAD_MORE_SKELETONS_PER_COLUMN) + index} phase="next" />
            ))}
          </div>
        ))}
      </div>
      <div ref={loadMoreSentinelRef} data-testid="masonry-load-more-sentinel" className="h-px w-full" aria-hidden="true" />
    </div>
  );
});

export const MasonryViewport = React.memo(MasonryViewportImpl);
