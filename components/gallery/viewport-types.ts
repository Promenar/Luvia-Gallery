import { MediaItem } from '../../types';
import { ViewportRestoreCommand, ViewportSnapshot } from '../../navigation/types';

export type { ViewportRestoreCommand, ViewportSnapshot };

/** 当前挂载视口的同步取样能力，用于打开查看器前固化目录位置。 */
export interface ViewportCaptureHandle {
  captureSnapshot: () => ViewportSnapshot | undefined;
}

export interface CommonViewportProps {
  viewKey: string;
  restoreSnapshot?: ViewportSnapshot;
  restoreCommand?: ViewportRestoreCommand;
  onSnapshotChange?: (snapshot: ViewportSnapshot) => void;
  onRestoreComplete?: (token: number) => void;
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
  // Infinite scroll props
  hasNextPage: boolean;
  isNextPageLoading: boolean;
  loadNextPage: (startIndex: number, stopIndex: number) => Promise<void> | void;
  itemCount: number;
  mediaHoverZoomEnabled: boolean;
  // Folder Actions
  onToggleFavorite?: (path: string, type: 'file' | 'folder') => void;
  onRename?: (path: string, newName: string) => void;
  onDelete?: (path: string) => void;
  onRegenerate?: (path: string) => void;
}

/**
 * 纯函数：根据快照解析锚点项目的索引
 * 优先级：anchorItemId -> anchorIndex -> fallbackScrollTop 兜底
 */
export function resolveAnchorIndex(items: MediaItem[], snapshot?: ViewportSnapshot): number {
  if (!snapshot) return 0;

  // 1. 优先根据 ID 匹配
  if (snapshot.anchorItemId) {
    const idx = items.findIndex(item => item.id === snapshot.anchorItemId);
    if (idx !== -1) {
      return idx;
    }
  }

  // 2. 缺失 ID 或未找到时，使用索引匹配
  if (snapshot.anchorIndex !== undefined && snapshot.anchorIndex >= 0 && snapshot.anchorIndex < items.length) {
    return snapshot.anchorIndex;
  }

  // 3. 以 fallbackScrollTop 兜底（估算一个默认高度 200px）
  if (snapshot.fallbackScrollTop !== undefined && snapshot.fallbackScrollTop > 0) {
    const ESTIMATED_ROW_HEIGHT = 200;
    const estimatedIndex = Math.floor(snapshot.fallbackScrollTop / ESTIMATED_ROW_HEIGHT);
    return Math.min(items.length - 1, Math.max(0, estimatedIndex));
  }

  return 0;
}

/**
 * 纯函数：构造快照对象
 */
export function createViewportSnapshot(
  locationKey: string,
  anchorItemId: string | undefined,
  anchorIndex: number | undefined,
  offsetWithinItem: number,
  fallbackScrollTop: number,
  loadedOffset: number
): ViewportSnapshot {
  return {
    locationKey,
    anchorItemId,
    anchorIndex,
    offsetWithinItem,
    fallbackScrollTop,
    loadedOffset,
    capturedAt: Date.now()
  };
}
