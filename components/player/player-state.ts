// components/player/player-state.ts
import type { MediaItem } from '../../types';
import type { PlayerAction, PlayerMediaSource, PlayerState } from './types';

export const createInitialPlayerState = (): PlayerState => ({ isOpen: false, items: [], index: 0 });

/** 从媒体列表构建播放器队列并定位起点：先过滤为仅图片/视频，再在过滤后的队列内定位，起点缺失时回退到 0（保持 Math.max 语义）。 */
export const buildPlayerQueue = (items: MediaItem[], targetId: string): PlayerMediaSource => {
  const playable = items.filter((f) => f.mediaType === 'image' || f.mediaType === 'video');
  return { items: playable, startIndex: Math.max(0, playable.findIndex((f) => f.id === targetId)) };
};

const canOpen = (source: { items: MediaItem[]; startIndex: number }) =>
  source.items.length > 0 && source.startIndex >= 0 && source.startIndex < source.items.length;

export const playerReducer = (state: PlayerState, action: PlayerAction): PlayerState => {
  switch (action.type) {
    case 'open':
      if (!canOpen(action.source)) return state;
      return {
        isOpen: true,
        items: action.source.items,
        index: action.source.startIndex,
        sourceLabel: action.source.sourceLabel,
      };
    case 'close':
      // 保留 items/index 供关闭动画期间渲染，下次 open 会整体覆盖。
      return { ...state, isOpen: false };
    case 'next':
      return state.index < state.items.length - 1 ? { ...state, index: state.index + 1 } : state;
    case 'prev':
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case 'select':
      return action.index >= 0 && action.index < state.items.length ? { ...state, index: action.index } : state;
    default:
      return state;
  }
};

export const selectCurrentItem = (state: PlayerState): MediaItem | null =>
  state.isOpen ? state.items[state.index] ?? null : null;
