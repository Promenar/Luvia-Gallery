// components/player/types.ts
import type { MediaItem } from '../../types';

export interface PlayerMediaSource {
  items: MediaItem[];
  startIndex: number;
  sourceLabel?: string;
}

export interface PlayerState {
  isOpen: boolean;
  items: MediaItem[];
  index: number;
  sourceLabel?: string;
}

export type PlayerAction =
  | { type: 'open'; source: PlayerMediaSource }
  | { type: 'close' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'select'; index: number };
