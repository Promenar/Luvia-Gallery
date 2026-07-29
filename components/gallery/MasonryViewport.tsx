import React, { useMemo, useRef, useEffect, useState } from 'react';
import { CommonViewportProps, ViewportCaptureHandle, resolveAnchorIndex, createViewportSnapshot } from './viewport-types';
import { MediaCard } from '../PhotoCard';
import { FolderCard } from '../FolderCard';
import { Button } from '../ui/Button';

export const MasonryViewport = React.forwardRef<ViewportCaptureHandle, CommonViewportProps>(({
  items,
  onItemClick,
  hasNextPage,
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
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

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
      cancelPendingSnapshot();
      cancelRestoreTransaction();
    };
  }, []);

  const onScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    currentScrollTopRef.current = scrollTop;

    // 1. 无尽加载检测
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 200;

    if (nearBottom && hasNextPage && !isNextPageLoading && !loadLockRef.current) {
      loadLockRef.current = true;
      const loadPromise = loadNextPage(items.length, items.length + 50);
      if (loadPromise && typeof loadPromise.then === 'function') {
        loadPromise.then(() => {
          loadLockRef.current = false;
        }).catch(() => {
          loadLockRef.current = false;
        });
      } else {
        setTimeout(() => {
          loadLockRef.current = false;
        }, 1000);
      }
    }

    if (!nearBottom) {
      loadLockRef.current = false;
    }

    // 2. 采样失败时只上报当前 scrollTop 兜底，绝不复用旧锚点或旧偏移。
    triggerSnapshotUpdate(createCurrentSnapshot(readLiveAnchor()));
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="w-full h-full overflow-y-auto pb-20 no-scrollbar"
    >
      <div className="flex gap-4 p-1 items-start">
        {columns.map((colItems, colIndex) => (
          <div key={colIndex} className="flex-1 flex flex-col gap-4">
            {colItems.filter(item => item && item.id).map((item) => {
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
                      mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {hasNextPage && (
        <div className="w-full py-8 flex justify-center items-center">
          <Button
            variant="secondary"
            onClick={() => loadNextPage(items.length, items.length + 50)}
            loading={isNextPageLoading}
            disabled={isNextPageLoading}
          >
            {isNextPageLoading ? 'Loading more...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
});
