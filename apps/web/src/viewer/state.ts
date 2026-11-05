import { create } from 'zustand';
import { FIT_VIEW, type View } from './zoom';

export type SlideshowState = 'off' | 'playing' | 'paused';

export interface VideoState {
  playing: boolean;
  time: number;
  duration: number;
  /** 无法播放的原因（中文），null 表示正常。 */
  error: string | null;
}

/**
 * 查看器内部界面状态（与 stores/viewer.ts 的播放范围分开）。
 * 事件处理函数通过 getState() 读取，避免闭包拿到旧值。
 */
interface ViewerUi {
  order: number[];
  pos: number;
  /** 顺序是否为随机。 */
  shuffled: boolean;
  view: View;
  /** 下一次视图变化是否带过渡动画（按钮、键盘、双击）。 */
  animate: boolean;
  slideshow: SlideshowState;
  info: boolean;
  idle: boolean;
  menu: { x: number; y: number } | null;
  /** 未在列表中给出宽高时，加载后测得的尺寸。 */
  measured: { id: string; w: number; h: number } | null;
  video: VideoState;
  toast: { id: number; text: string } | null;
  closing: boolean;
  /** 正在拖动平移。 */
  dragging: boolean;
  set: (patch: Partial<Omit<ViewerUi, 'set' | 'setView' | 'reset' | 'say'>>) => void;
  setView: (view: View, animate?: boolean) => void;
  say: (text: string) => void;
  reset: () => void;
}

const initial = {
  order: [] as number[],
  pos: 0,
  shuffled: false,
  view: FIT_VIEW,
  animate: false,
  slideshow: 'off' as SlideshowState,
  info: false,
  idle: false,
  menu: null,
  measured: null,
  video: { playing: false, time: 0, duration: 0, error: null } as VideoState,
  toast: null,
  closing: false,
  dragging: false,
};

let toastSeq = 0;

export const useViewerUi = create<ViewerUi>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  setView: (view, animate = false) => set({ view, animate }),
  say: (text) => set({ toast: { id: ++toastSeq, text } }),
  reset: () => set({ ...initial }),
}));

/** 当前视频元素（同一时刻只有一个），供顶层控件与复制当前画面使用。 */
export const activeMedia: { video: HTMLVideoElement | null; image: HTMLImageElement | null } = { video: null, image: null };

export const isReduceMotion = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'on';
