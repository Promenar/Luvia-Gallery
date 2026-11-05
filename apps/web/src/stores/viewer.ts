import { create } from 'zustand';
import type { MediaItem, MediaListQuery } from '@luvia/contracts';

/**
 * 查看器的播放范围。由打开查看器的位置决定：时间线为全部媒体，文件夹为当前文件夹，相册为当前相册……
 * query 存在时查看器在接近末尾时用 listMedia + nextCursor 继续加载；random 为 true 时按随机接口抽样（首页轮播、随机播放）。
 */
export interface ViewerScope {
  /** 中文显示名，例如“文件夹「2025-09 上海」”“全部照片”。 */
  label: string;
  items: MediaItem[];
  query?: MediaListQuery;
  nextCursor?: string | null;
  /** 随机抽样的筛选条件（RandomQuery），存在时幻灯片以随机方式无限续播。 */
  random?: Record<string, unknown>;
  /** 精确总数，未知为 null。 */
  total?: number | null;
}

export interface OpenViewerOptions {
  /** 打开后立即开始幻灯片。 */
  play?: boolean;
  shuffle?: boolean;
  /** 打开动画的起点元素（缩略图），用于放大过渡。 */
  originEl?: HTMLElement | null;
}

interface ViewerState {
  open: boolean;
  scope: ViewerScope | null;
  index: number;
  options: OpenViewerOptions;
  openViewer: (scope: ViewerScope, index: number, options?: OpenViewerOptions) => void;
  setIndex: (i: number) => void;
  appendItems: (items: MediaItem[], nextCursor: string | null) => void;
  updateItem: (id: string, patch: Partial<MediaItem>) => void;
  close: () => void;
}

export const useViewer = create<ViewerState>((set) => ({
  open: false,
  scope: null,
  index: 0,
  options: {},
  openViewer: (scope, index, options = {}) => set({ open: true, scope, index, options }),
  setIndex: (index) => set({ index }),
  appendItems: (items, nextCursor) =>
    set((s) => (s.scope ? { scope: { ...s.scope, items: [...s.scope.items, ...items], nextCursor } } : s)),
  updateItem: (id, patch) =>
    set((s) => (s.scope ? { scope: { ...s.scope, items: s.scope.items.map((m) => (m.id === id ? { ...m, ...patch } : m)) } } : s)),
  close: () => set({ open: false, options: {} }),
}));

/** 页面调用的唯一入口。 */
export const openViewer = (scope: ViewerScope, index: number, options?: OpenViewerOptions) =>
  useViewer.getState().openViewer(scope, index, options);
