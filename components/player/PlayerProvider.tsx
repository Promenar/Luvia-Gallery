// components/player/PlayerProvider.tsx
import React, { createContext, useContext, useMemo, useReducer } from 'react';
import { createInitialPlayerState, playerReducer, selectCurrentItem } from './player-state';
import type { MediaItem } from '../../types';
import type { PlayerDisplayMode, PlayerMediaSource, PlayerState } from './types';

interface PlayerContextValue {
  state: PlayerState;
  currentItem: ReturnType<typeof selectCurrentItem>;
  /** 浮窗形态快捷读取（等价 state.displayMode，供壳组件按名消费） */
  displayMode: PlayerDisplayMode;
  open: (source: PlayerMediaSource) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  /** 切换浮窗形态（window/mini/fab/fullscreen；非法值由 reducer 拒绝） */
  setMode: (mode: PlayerDisplayMode) => void;
  /** 队列项浅合并回写：外部数据（如收藏状态）变化时同步播放器内快照（hotfix-1） */
  patchItem: (id: string, patch: Partial<MediaItem>) => void;
}

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(playerReducer, undefined, createInitialPlayerState);
  const value = useMemo<PlayerContextValue>(() => ({
    state,
    currentItem: selectCurrentItem(state),
    displayMode: state.displayMode,
    open: (source) => dispatch({ type: 'open', source }),
    close: () => dispatch({ type: 'close' }),
    next: () => dispatch({ type: 'next' }),
    prev: () => dispatch({ type: 'prev' }),
    setMode: (mode) => dispatch({ type: 'setMode', mode }),
    patchItem: (id, patch) => dispatch({ type: 'patch', id, patch }),
  }), [state]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

export const useMediaPlayer = (): PlayerContextValue => {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('useMediaPlayer 必须在 PlayerProvider 内使用');
  return value;
};
