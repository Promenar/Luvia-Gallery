// components/player/player-state.ts
import type { MediaItem } from '../../types';
import { isDisplayMode } from './types';
import type { PlayerAction, PlayerMediaSource, PlayerState } from './types';

export const createInitialPlayerState = (): PlayerState =>
  ({ isOpen: false, items: [], index: 0, displayMode: 'window' });

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
        // 每次打开都回到浮窗形态；上次关闭前的形态属于会话内临时状态，不跨会话保留。
        displayMode: 'window',
      };
    case 'close':
      // 保留 items/index 供关闭动画期间渲染，下次 open 会整体覆盖；
      // displayMode 重置为 window（hotfix-2：close 语义 = 完全关闭。若保留 fullscreen，
      // 调度层会继续渲染全屏空壳 + 系统全屏未退出，用户被锁在黑底；重开形态从偏好恢复）。
      return { ...state, isOpen: false, displayMode: 'window' };
    case 'setMode':
      // 只校验枚举合法性（非法值 no-op）；fullscreen 同样接受，真实全屏 API 由宿主 effect 驱动。
      return isDisplayMode(action.mode) ? { ...state, displayMode: action.mode } : state;
    case 'next':
      return state.index < state.items.length - 1 ? { ...state, index: state.index + 1 } : state;
    case 'prev':
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case 'select':
      return action.index >= 0 && action.index < state.items.length ? { ...state, index: action.index } : state;
    case 'patch':
      // 队列快照回写（hotfix-1）：id 命中才浅合并（openPlayer 传入的是 MediaItem 快照，
      // 外部收藏等状态变化需实时同步进队列）；未命中任何项时返回原状态引用（播放器未打开或项不在队列均为无害 no-op）。
      if (!state.items.some((f) => f.id === action.id)) return state;
      return {
        ...state,
        items: state.items.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      };
    default:
      return state;
  }
};

export const selectCurrentItem = (state: PlayerState): MediaItem | null =>
  state.isOpen ? state.items[state.index] ?? null : null;
