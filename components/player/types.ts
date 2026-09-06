// components/player/types.ts
import type { MediaItem } from '../../types';

export interface PlayerMediaSource {
  items: MediaItem[];
  startIndex: number;
  sourceLabel?: string;
}

/** 播放器窗口形态：window 浮窗 / mini 小窗 / fab 圆钮 / fullscreen 独占全屏 / maximized 浏览器视口内最大化 */
export const PLAYER_DISPLAY_MODES = ['window', 'mini', 'fab', 'fullscreen', 'maximized'] as const;
export type PlayerDisplayMode = (typeof PLAYER_DISPLAY_MODES)[number];

/** 运行时守卫：校验任意值是否为合法形态枚举（prefs 字段校验与 reducer 拒绝非法值共用） */
export const isDisplayMode = (value: unknown): value is PlayerDisplayMode =>
  typeof value === 'string' && (PLAYER_DISPLAY_MODES as readonly string[]).includes(value);

export interface PlayerState {
  isOpen: boolean;
  items: MediaItem[];
  index: number;
  sourceLabel?: string;
  /** 浮窗形态：open 默认 'window'；fullscreen 由宿主全屏 effect（requestFullscreen）驱动进入/退出；
   *  maximized 为浏览器视口内最大化（不涉及系统全屏 API，非持久形态） */
  displayMode: PlayerDisplayMode;
}

export type PlayerAction =
  | { type: 'open'; source: PlayerMediaSource }
  | { type: 'close' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'select'; index: number }
  /** 形态切换：window/mini/fab 互转自由；fullscreen（宿主 effect 负责真实全屏 API）与 maximized
   *  （PlayerWindow 按形态分支容器样式）同样接受，非法值由 reducer 拒绝 */
  | { type: 'setMode'; mode: PlayerDisplayMode }
  /** 队列项浅合并回写：外部数据（如收藏状态）变化时同步队列快照，id 未命中则为 no-op */
  | { type: 'patch'; id: string; patch: Partial<MediaItem> };
