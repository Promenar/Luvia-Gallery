import React, { useMemo, useRef, useEffect, useState } from 'react';
import { CommonViewportProps, resolveAnchorIndex, createViewportSnapshot } from './viewport-types';
import { MediaCard } from '../PhotoCard';
import { FolderCard } from '../FolderCard';
import { Button } from '../ui/Button';

export const MasonryViewport: React.FC<CommonViewportProps> = ({
  items,
  onItemClick,
  hasNextPage,
  isNextPageLoading,
  loadNextPage,
  onToggleFavorite,
  onRename,
  onDelete,
  onRegenerate,
  viewKey,
  restoreSnapshot,
  onSnapshotChange,
  onRestoreComplete
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadLockRef = useRef(false);

  // 滚动位置捕获与恢复锁
  const isRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const currentScrollTopRef = useRef(0);

  // 快照节流上报
  const pendingSnapshotRef = useRef<any>(null);
  const throttleTimerRef = useRef<any>(null);

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

  // 视图或快照发生变化时，重置恢复标记
  // 统一去重比较 locationKey + capturedAt 字符串
  const snapshotKey = restoreSnapshot ? `${restoreSnapshot.locationKey}_${restoreSnapshot.capturedAt}` : null;
  const lastRestoredSnapshotKeyRef = useRef<string | null>(null);
  const lastViewKeyRef = useRef(viewKey);

  if (lastViewKeyRef.current !== viewKey || lastRestoredSnapshotKeyRef.current !== snapshotKey) {
    isRestoredRef.current = false;
    lastViewKeyRef.current = viewKey;
    lastRestoredSnapshotKeyRef.current = snapshotKey;
  }

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

  // 执行恢复
  useEffect(() => {
    if (isRestoredRef.current) return;
    if (!containerRef.current) return;
    if (items.length === 0) return;

    let retryCount = 0;
    let timerId: any = null;

    const tryRestore = () => {
      const container = containerRef.current;
      if (!container) return;

      if (!restoreSnapshot) {
        // 无快照需要恢复，直接标记完成
        isRestoredRef.current = true;
        onRestoreComplete?.();
        return;
      }

      const { anchorItemId, scrollTop, offsetWithinItem = 0 } = restoreSnapshot;

      if (anchorItemId) {
        const el = container.querySelector(`[data-item-id="${anchorItemId}"]`) as HTMLElement;
        if (el) {
          isRestoredRef.current = true;
          isRestoringRef.current = true;

          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const currentRelativeTop = elRect.top - containerRect.top;

          // 统一正号语义，修复符号相反
          container.scrollTop = container.scrollTop + currentRelativeTop + offsetWithinItem;

          timerId = setTimeout(() => {
            isRestoringRef.current = false;
            onRestoreComplete?.();
          }, 150);
        } else {
          // 如果没找到，并且重试次数小于 5 次，则隔 50ms 再试
          if (retryCount < 5) {
            retryCount++;
            timerId = setTimeout(tryRestore, 50);
          } else {
            // 实在找不到，以 scrollTop 兜底
            isRestoredRef.current = true;
            isRestoringRef.current = true;
            if (scrollTop !== undefined) {
              container.scrollTop = scrollTop;
            } else if (restoreSnapshot.fallbackScrollTop !== undefined) {
              container.scrollTop = restoreSnapshot.fallbackScrollTop;
            }
            timerId = setTimeout(() => {
              isRestoringRef.current = false;
              onRestoreComplete?.();
            }, 150);
          }
        }
      } else if (scrollTop !== undefined && scrollTop > 0) {
        isRestoredRef.current = true;
        isRestoringRef.current = true;
        container.scrollTop = scrollTop;
        timerId = setTimeout(() => {
          isRestoringRef.current = false;
          onRestoreComplete?.();
        }, 150);
      } else if (restoreSnapshot.fallbackScrollTop !== undefined && restoreSnapshot.fallbackScrollTop > 0) {
        isRestoredRef.current = true;
        isRestoringRef.current = true;
        container.scrollTop = restoreSnapshot.fallbackScrollTop;
        timerId = setTimeout(() => {
          isRestoringRef.current = false;
          onRestoreComplete?.();
        }, 150);
      } else {
        isRestoredRef.current = true;
        onRestoreComplete?.();
      }
    };

    tryRestore();

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [items, restoreSnapshot, viewKey]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
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

    // 2. 捕获首个可见带 data-item-id 元素
    const containerRect = container.getBoundingClientRect();
    let firstVisibleEl: HTMLElement | null = null;

    // 优先使用 elementFromPoint/closest 在容器顶部有限采样找到锚点 (O(1))
    const samplePointsX = [
      containerRect.left + containerRect.width * 0.1,
      containerRect.left + containerRect.width * 0.3,
      containerRect.left + containerRect.width * 0.5,
      containerRect.left + containerRect.width * 0.7,
      containerRect.left + containerRect.width * 0.9,
    ];
    const samplePointsY = [
      containerRect.top + 15,
      containerRect.top + 45
    ];

    if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
      outerLoop: for (const y of samplePointsY) {
        for (const x of samplePointsX) {
          if (x >= 0 && y >= 0) {
            const el = document.elementFromPoint(x, y);
            if (el) {
              const itemEl = el.closest('[data-item-id]') as HTMLElement;
              if (itemEl && container.contains(itemEl)) {
                firstVisibleEl = itemEl;
                break outerLoop;
              }
            }
          }
        }
      }
    }

    // JSDOM / elementFromPoint 失败时的有限 fallback，绝对不 O(N) 遍历所有节点
    if (!firstVisibleEl) {
      const allElements = container.querySelectorAll('[data-item-id]');
      const maxCheck = Math.min(allElements.length, 30);
      for (let i = 0; i < maxCheck; i++) {
        const el = allElements[i] as HTMLElement;
        const elRect = el.getBoundingClientRect();
        const relativeBottom = elRect.bottom - containerRect.top;
        if (relativeBottom > 0) {
          firstVisibleEl = el;
          break;
        }
      }
    }

    if (firstVisibleEl) {
      const elRect = firstVisibleEl.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top;
      // 捕获与恢复统一正号语义，相对顶部 relativeTop 为负数时，偏移量 offset 应为正数（即 scrollTop - itemTop）
      const offset = -relativeTop;
      const id = firstVisibleEl.getAttribute('data-item-id') || undefined;
      const index = id ? itemIndices[id] : undefined;

      const snapshot = createViewportSnapshot(
        viewKey,
        id,
        index,
        offset,
        scrollTop,
        items.length
      );
      triggerSnapshotUpdate(snapshot);
    }
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
};
