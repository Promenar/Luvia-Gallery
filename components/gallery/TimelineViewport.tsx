import React, { useMemo, useRef, useEffect } from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { CommonViewportProps, ViewportCaptureHandle, resolveAnchorIndex, createViewportSnapshot } from './viewport-types';
import { MediaCard } from '../PhotoCard';
import { groupMediaByDate } from '../../utils/fileUtils';
import { TimelineScrubber } from '../TimelineScrubber';

const VariableSizeList = (ReactWindow as any).VariableSizeList;

interface VisualRow {
  type: 'header' | 'media';
  date?: string; // For header
  items?: any[]; // For media
}

interface InnerProps extends CommonViewportProps {
  width: number;
  height: number;
}

const TimelineViewportInner = React.forwardRef<ViewportCaptureHandle, InnerProps>(({
  width,
  height,
  items,
  onItemClick,
  hasNextPage,
  isNextPageLoading,
  loadNextPage,
  viewKey,
  restoreSnapshot,
  restoreCommand,
  onSnapshotChange,
  onRestoreComplete
}, ref) => {
  const listRef = useRef<any>(null);
  const loadLockRef = useRef(false);

  // 滚动状态与快照锁
  const isRestoredRef = useRef(false);
  const isRestoringRef = useRef(false);
  const currentScrollTopRef = useRef(0);
  const lastAnchorItemRef = useRef<{ id: string; index: number } | null>(null);
  const activeVisualRowIndexRef = useRef<number>(-1);
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

  // 基础布局常量与动态列数计算
  const GUTTER_SIZE = 2; // Mobile-friendly tighter gap
  const MIN_COL_WIDTH = width < 640 ? 90 : 150;
  const SCRUBBER_WIDTH = 0;
  const containerPadding = width < 640 ? 28 : 36; // padding (pl-1 + pr-6/pr-8)
  const availWidth = width - SCRUBBER_WIDTH - containerPadding;

  const columnCount = Math.floor((availWidth + GUTTER_SIZE) / (MIN_COL_WIDTH + GUTTER_SIZE)) || 1;
  const safeCols = Math.max(3, columnCount); // Ensure at least 3 columns for density

  const cellWidth = Math.floor((availWidth - (safeCols - 1) * GUTTER_SIZE) / safeCols);
  const cellHeight = cellWidth; // Square aspect ratio

  // 1. Group Data (Memoized on items only)
  const { groups, groupKeys } = useMemo(() => {
    const g = groupMediaByDate(items);
    return { groups: g, groupKeys: Object.keys(g) };
  }, [items]);

  // 2. Build Visual Rows (Memoized on items AND width/columns)
  const { visualRows, groupIndices } = useMemo(() => {
    const rows: VisualRow[] = [];
    const indices: Record<number, number> = {};

    groupKeys.forEach((key, gIdx) => {
      indices[gIdx] = rows.length;
      rows.push({ type: 'header', date: key });

      const groupItems = groups[key];
      for (let i = 0; i < groupItems.length; i += safeCols) {
        const chunk = groupItems.slice(i, i + safeCols);
        rows.push({ type: 'media', items: chunk });
      }
    });
    return { visualRows: rows, groupIndices: indices };
  }, [groups, groupKeys, safeCols]);

  const getItemSize = (index: number) => {
    const row = visualRows[index];
    return row?.type === 'header' ? 50 : cellHeight + GUTTER_SIZE;
  };

  const getRowTop = (rowIndex: number) => {
    let top = 0;
    for (let i = 0; i < rowIndex; i++) {
      top += getItemSize(i);
    }
    return top;
  };

  const captureCurrentSnapshot = () => {
    cancelPendingSnapshot();
    const anchor = lastAnchorItemRef.current;
    if (!anchor) return createViewportSnapshot(viewKey, undefined, undefined, 0, currentScrollTopRef.current, items.length);
    const rowIndex = activeVisualRowIndexRef.current;
    const rowTop = rowIndex >= 0 ? getRowTop(rowIndex) : 0;
    return createViewportSnapshot(
      viewKey,
      anchor.id,
      anchor.index,
      currentScrollTopRef.current - rowTop,
      currentScrollTopRef.current,
      items.length,
    );
  };

  React.useImperativeHandle(ref, () => ({ captureSnapshot: captureCurrentSnapshot }), [viewKey, items.length, visualRows, safeCols, cellHeight]);

  useEffect(() => {
    if (positionIdentityViewKeyRef.current !== viewKey) {
      cancelPendingSnapshot();
      currentScrollTopRef.current = 0;
      lastAnchorItemRef.current = null;
      activeVisualRowIndexRef.current = -1;
      isRestoringRef.current = false;
      positionIdentityViewKeyRef.current = viewKey;
    }
    return cancelPendingSnapshot;
  }, [viewKey]);

  // 完成事务只由命令身份或视图身份终止，items 更新不能中断已经执行的恢复。
  useEffect(() => {
    cancelRestoreTransaction();
  }, [viewKey, snapshotKey]);

  // Critical: Reset cached row measurements when width/layout changes.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [width, items.length, safeCols]);

  // 执行恢复
  useEffect(() => {
    if (isRestoredRef.current) return;
    if (!listRef.current) return;
    if (!restoreSnapshot && !restoreCommand) return;
    if ((items.length === 0 || visualRows.length === 0) && !restoreCommand) return;
    if (width <= 0 || height <= 0) return;

    isRestoredRef.current = true;
    isRestoringRef.current = true;

    if (restoreSnapshot) {
      const targetIndex = resolveAnchorIndex(items, restoreSnapshot);
      const targetItem = items[targetIndex];

      if (targetItem) {
        // 查找该 mediaItem 对应的 visualRowIndex
        let visualRowIndex = -1;
        for (let i = 0; i < visualRows.length; i++) {
          const row = visualRows[i];
          if (row.type === 'media' && row.items) {
            if (row.items.some(item => item.id === targetItem.id)) {
              visualRowIndex = i;
              break;
            }
          }
        }
        if (visualRowIndex !== -1) {
          const rowTop = getRowTop(visualRowIndex);
          const targetScrollTop = rowTop + (restoreSnapshot.offsetWithinItem || 0);
          listRef.current.scrollTo(targetScrollTop);
        }
      }
    } else {
      cancelPendingSnapshot();
      cancelRestoreTransaction();
      currentScrollTopRef.current = 0;
      lastAnchorItemRef.current = null;
      activeVisualRowIndexRef.current = -1;
      listRef.current.scrollTo(0);
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
  }, [items, visualRows, restoreSnapshot, restoreCommand?.token, viewKey, width, height, safeCols]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      cancelPendingSnapshot();
      cancelRestoreTransaction();
    };
  }, []);

  return (
    <>
      <VariableSizeList
        ref={listRef}
        className="no-scrollbar pl-1 pr-6 md:pr-8"
        height={height}
        width={width}
        itemCount={visualRows.length}
        itemSize={getItemSize}
        overscanCount={5}
        onScroll={({ scrollTop }: { scrollTop: number }) => {
          currentScrollTopRef.current = scrollTop;
          if (lastAnchorItemRef.current && activeVisualRowIndexRef.current !== -1) {
            const rowTop = getRowTop(activeVisualRowIndexRef.current);
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
        onItemsRendered={({ visibleStartIndex, visibleStopIndex }: { visibleStartIndex: number, visibleStopIndex: number }) => {
          // 触发无尽滚动加载
          const nearEnd = visibleStopIndex >= visualRows.length - 10;
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
              setTimeout(() => {
                loadLockRef.current = false;
              }, 1000);
            }
          }
          if (!nearEnd) {
            loadLockRef.current = false;
          }

          // 捕获首个可见的 media item
          if (items.length > 0) {
            let firstVisibleItem = null;
            let actualIndex = -1;
            let visualRowIndex = -1;

            for (let i = visibleStartIndex; i < visualRows.length; i++) {
              const row = visualRows[i];
              if (row.type === 'media' && row.items && row.items.length > 0) {
                firstVisibleItem = row.items[0];
                visualRowIndex = i;
                actualIndex = items.findIndex(item => item.id === firstVisibleItem.id);
                break;
              }
            }

            if (firstVisibleItem && actualIndex !== -1 && visualRowIndex !== -1) {
              lastAnchorItemRef.current = { id: firstVisibleItem.id, index: actualIndex };
              activeVisualRowIndexRef.current = visualRowIndex;
              const rowTop = getRowTop(visualRowIndex);
              const offsetWithinItem = currentScrollTopRef.current - rowTop;
              const snapshot = createViewportSnapshot(
                viewKey,
                firstVisibleItem.id,
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
        {({ index, style }: { index: number; style: React.CSSProperties }) => {
          const row = visualRows[index];
          if (!row) return null;

          const rowStyle = {
            ...style,
            width: availWidth
          };

          if (row.type === 'header') {
            const date = new Date(row.date + '-01');
            const monthName = date.toLocaleDateString('default', { month: 'long' });
            const year = date.getFullYear();

            return (
              <div style={rowStyle} className="flex items-end pb-2 pt-4 px-1 z-10 pointer-events-none">
                <div className="font-medium text-sm text-text-secondary bg-surface-primary/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-border-default">
                  <span className="text-text-primary font-bold mr-1">{monthName}</span>
                  <span>{year}</span>
                </div>
              </div>
            );
          } else {
            return (
              <div style={rowStyle} className="flex gap-[2px]">
                {row.items?.filter(item => item && item.id).map(item => (
                  <div key={item.id} style={{ width: cellWidth, height: cellHeight }}>
                    <MediaCard
                      item={item}
                      onClick={onItemClick}
                      layout="grid"
                      isVirtual={true}
                    />
                  </div>
                ))}
              </div>
            );
          }
        }}
      </VariableSizeList>

      {/* Scrubber Overlay */}
      <TimelineScrubber
        groups={groupKeys}
        height={height}
        onScrollTo={(gIndex) => {
          const rowIndex = groupIndices[gIndex];
          if (listRef.current && rowIndex !== undefined) {
            listRef.current.scrollToItem(rowIndex, 'start');
          }
        }}
      />
    </>
  );
});

export const TimelineViewport = React.forwardRef<ViewportCaptureHandle, CommonViewportProps>((props, ref) => {
  return (
    <div className="w-full h-full relative">
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => {
          if (!height || !width || height <= 0 || width <= 0) {
            return null;
          }
          return <TimelineViewportInner ref={ref} {...props} width={width} height={height} />;
        }}
      </AutoSizer>
    </div>
  );
});
