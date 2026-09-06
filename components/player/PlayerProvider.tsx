// components/player/PlayerProvider.tsx
import React, { createContext, useContext, useMemo, useReducer } from 'react';
import { createInitialPlayerState, playerReducer, selectCurrentItem } from './player-state';
import type { PlayerMediaSource, PlayerState } from './types';

interface PlayerContextValue {
  state: PlayerState;
  currentItem: ReturnType<typeof selectCurrentItem>;
  open: (source: PlayerMediaSource) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
}

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(playerReducer, undefined, createInitialPlayerState);
  const value = useMemo<PlayerContextValue>(() => ({
    state,
    currentItem: selectCurrentItem(state),
    open: (source) => dispatch({ type: 'open', source }),
    close: () => dispatch({ type: 'close' }),
    next: () => dispatch({ type: 'next' }),
    prev: () => dispatch({ type: 'prev' }),
  }), [state]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

export const useMediaPlayer = (): PlayerContextValue => {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('useMediaPlayer 必须在 PlayerProvider 内使用');
  return value;
};
