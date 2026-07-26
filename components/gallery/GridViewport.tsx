import React, { useRef, useEffect } from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { CommonViewportProps, ViewportCaptureHandle, resolveAnchorIndex, createViewportSnapshot } from './viewport-types';
import { MediaCard } from '../PhotoCard';
import { FolderCard } from '../FolderCard';
import { Icons } from '../ui/Icon';

const FixedSizeGrid = (ReactWindow as any).FixedSizeGrid;

interface InnerProps extends CommonViewportProps {
  width: number;
  height: number;
}

const GridViewportInner = React.forwardRef<ViewportCaptureHandle, InnerProps>(({
  width,
  height,
  items,
  onItemClick,
  hasNextPage,
  isNextPageLoading,
  loadNextPage,
  itemCount,
  onToggleFavorite,
  onRename,
  onDelete,
  onRegenerate,
  viewKey,
  restoreSnapshot,
  restoreCommand,
  onSnapshotChange,
  onRestoreComplete
}, ref) => {
  const gridRef = useRef<any>(null);
  const loadLockRef = useRef(false);

  // 滚动状态与快照锁
  const isRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const currentScrollTopRef = useRef(0);
  const lastAnchorItemRef = useRef<{ id: string; index: number } | null>(null);
  const activeRowIndexRef = useRef<number>(-1);
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

  // 基础布局常量与动态计算
  const GUTTER_SIZE = 16;
  const COLUMN_WIDTH = 200;

  const columnCount = Math.floor((width + GUTTER_SIZE) / (COLUMN_WIDTH + GUTTER_SIZE));
  const safeColumnCount = Math.max(1, columnCount);
  const rowCount = Math.ceil(itemCount / safeColumnCount);
  const cellWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
  const cellHeight = cellWidth;

  const isItemLoaded = (index: number) => !hasNextPage || index < items.length;

  const captureCurrentSnapshot = () => {
    cancelPendingSnapshot();
    const anchor = lastAnchorItemRef.current;
    if (!anchor) return createViewportSnapshot(viewKey, undefined, undefined, 0, currentScrollTopRef.current, items.length);
    const rowIndex = activeRowIndexRef.current >= 0
      ? activeRowIndexRef.current
      : Math.floor(anchor.index / safeColumnCount);
    const rowTop = rowIndex * (cellHeight + GUTTER_SIZE);
    return createViewportSnapshot(
      viewKey,
      anchor.id,
      anchor.index,
      currentScrollTopRef.current - rowTop,
      currentScrollTopRef.current,
      items.length,
    );
  };

  React.useImperativeHandle(ref, () => ({ captureSnapshot: captureCurrentSnapshot }), [viewKey, items.length, safeColumnCount, cellHeight]);

  useEffect(() => {
    if (positionIdentityViewKeyRef.current !== viewKey) {
      cancelPendingSnapshot();
      currentScrollTopRef.current = 0;
      lastAnchorItemRef.current = null;
      activeRowIndexRef.current = -1;
      isRestoringRef.current = false;
      positionIdentityViewKeyRef.current = viewKey;
    }
    return cancelPendingSnapshot;
  }, [viewKey]);

  // 完成事务只由命令身份或视图身份终止，items 更新不能中断已经执行的恢复。
  useEffect(() => {
    cancelRestoreTransaction();
  }, [viewKey, snapshotKey]);

  // 执行恢复
  useEffect(() => {
    if (isRestoredRef.current) return;
    if (!gridRef.current) return;
    if (!restoreSnapshot && !restoreCommand) return;
    if (items.length === 0 && !restoreCommand) return;
    if (width <= 0 || height <= 0) return;

    isRestoredRef.current = true;
    isRestoringRef.current = true;

    if (restoreSnapshot) {
      const targetIndex = resolveAnchorIndex(items, restoreSnapshot);
      const rowIndex = Math.floor(targetIndex / safeColumnCount);
      const rowTop = rowIndex * (cellHeight + GUTTER_SIZE);
      const targetScrollTop = rowTop + (restoreSnapshot.offsetWithinItem || 0);

      gridRef.current.scrollTo({ scrollTop: targetScrollTop });
    } else {
      cancelPendingSnapshot();
      cancelRestoreTransaction();
      currentScrollTopRef.current = 0;
      lastAnchorItemRef.current = null;
      activeRowIndexRef.current = -1;
      gridRef.current.scrollTo({ scrollTop: 0 });
    }

    activeRestoreTokenRef.current = restoreToken;
    isRestoringRef.current = true;
    restoreCompletionTimerRef.current = setTimeout(() => {
      if (activeRestoreTokenRef.current !== restoreToken) return;
      restoreCompletionTimerRef.current = null;
      activeRestoreTokenRef.current = null;
      isRestoringRef.current = false;
      onRestoreComplete?.(restoreToken);
    }, 150);
  }, [items, restoreSnapshot, restoreCommand?.token, viewKey, width, height, safeColumnCount]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      cancelPendingSnapshot();
      cancelRestoreTransaction();
    };
  }, []);

  return (
    <FixedSizeGrid
      ref={gridRef}
      className="no-scrollbar"
      columnCount={safeColumnCount}
      columnWidth={cellWidth + GUTTER_SIZE}
      height={height}
      rowCount={rowCount}
      rowHeight={cellHeight + GUTTER_SIZE}
      width={width}
      overscanRowCount={5}
      onScroll={({ scrollTop }: { scrollTop: number }) => {
        currentScrollTopRef.current = scrollTop;
        if (lastAnchorItemRef.current && activeRowIndexRef.current !== -1) {
          const rowTop = activeRowIndexRef.current * (cellHeight + GUTTER_SIZE);
          const offsetWithinItem = scrollTop - rowTop;
          const snapshot = createViewportSnapshot(
            viewKey,
            lastAnchorItemRef.current.id,
            lastAnchorItemRef.current.index,
            offsetWithinItem,
            scrollTop,
            items.length
          );
          triggerSnapshotUpdate(snapshot);
        }
      }}
      onItemsRendered={({ visibleRowStartIndex, visibleRowStopIndex }: { visibleRowStartIndex: number, visibleRowStopIndex: number }) => {
        // 触发无尽滚动加载
        const visibleEndIndex = (visibleRowStopIndex + 1) * safeColumnCount;
        const nearEnd = visibleEndIndex >= items.length - safeColumnCount;

        if (nearEnd && hasNextPage && !isNextPageLoading && !loadLockRef.current) {
          loadLockRef.current = true;
          const loadPromise = loadNextPage(items.length, items.length + 50);
          if (loadPromise && typeof loadPromise.then === 'function') {
            loadPromise.then(() => {
              loadLockRef.current = false;
            }).catch(() => {
              loadLockRef.current = false;
            });
          } else {
            // 同步或无返回值兜底，延时解锁
            setTimeout(() => {
              loadLockRef.current = false;
            }, 1000);
          }
        }

        if (!nearEnd) {
          loadLockRef.current = false;
        }

        // 捕获首个可见项目
        const firstVisibleIndex = visibleRowStartIndex * safeColumnCount;
        if (items.length > 0) {
          const actualIndex = Math.min(firstVisibleIndex, items.length - 1);
          const item = items[actualIndex];
          if (item) {
            lastAnchorItemRef.current = { id: item.id, index: actualIndex };
            activeRowIndexRef.current = visibleRowStartIndex;
            const rowTop = visibleRowStartIndex * (cellHeight + GUTTER_SIZE);
            const offsetWithinItem = currentScrollTopRef.current - rowTop;
            const snapshot = createViewportSnapshot(
              viewKey,
              item.id,
              actualIndex,
              offsetWithinItem,
              currentScrollTopRef.current,
              items.length
            );
            triggerSnapshotUpdate(snapshot);
          }
        }
      }}
    >
      {({ columnIndex, rowIndex, style }: { columnIndex: number, rowIndex: number, style: React.CSSProperties }) => {
        const index = rowIndex * safeColumnCount + columnIndex;
        const itemStyle = { ...style, width: cellWidth, height: cellHeight, left: Number(style.left), top: Number(style.top) };

        if (index >= itemCount) return null;
        if (!isItemLoaded(index)) {
          return (
            <div style={itemStyle} className="bg-white/3 rounded-xl animate-pulse flex items-center justify-center border border-white/5">
              <Icons.Image className="text-white/10" />
            </div>
          );
        }
        const item = items[index];
        if (!item || !item.id) return null;

        return (
          <div style={itemStyle}>
            {item.mediaType === 'folder' ? (
              <div className="w-full h-full p-1">
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
                />
              </div>
            ) : (
              <MediaCard item={item} onClick={onItemClick} layout="grid" isVirtual={true} />
            )}
          </div>
        );
      }}
    </FixedSizeGrid>
  );
});

export const GridViewport = React.forwardRef<ViewportCaptureHandle, CommonViewportProps>((props, ref) => {
  return (
    <div className="flex-1 w-full h-full">
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => {
          if (!height || !width || height <= 0 || width <= 0) {
            return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>;
          }
          return <GridViewportInner ref={ref} {...props} width={width} height={height} />;
        }}
      </AutoSizer>
    </div>
  );
});
