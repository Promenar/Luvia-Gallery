import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { thumbHashToRGBA } from 'thumbhash';
import type { MediaItem } from '@luvia/contracts';
import { usePreferences } from '@/stores/session';
import { applyTheme, computeTheme } from './engine';
import { dominantOklch, type Oklch } from './color';

/** 当前“动态强调色”的来源颜色。页面在主图切换、悬停或查看器换图时调用 setDynamicFrom。 */
export const useDynamicColor = create<{ color: Oklch | null; set: (c: Oklch | null) => void }>((set) => ({
  color: null,
  set: (color) => set({ color }),
}));

const cache = new Map<string, Oklch | null>();

/** 由媒体的 ThumbHash 计算主色（无需下载图片）；没有 ThumbHash 时保持当前颜色。 */
export function colorFromMedia(m: Pick<MediaItem, 'id' | 'thumbhash'>): Oklch | null | undefined {
  if (!m.thumbhash) return undefined;
  if (cache.has(m.id)) return cache.get(m.id);
  try {
    const bin = Uint8Array.from(atob(m.thumbhash), (c) => c.charCodeAt(0));
    const { rgba } = thumbHashToRGBA(bin);
    const c = dominantOklch(rgba);
    cache.set(m.id, c);
    return c;
  } catch {
    return undefined;
  }
}

export function setDynamicFrom(m: Pick<MediaItem, 'id' | 'thumbhash'> | null | undefined) {
  if (!m) return;
  const c = colorFromMedia(m);
  if (c !== undefined) useDynamicColor.getState().set(c);
}

const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (cb: () => void) => {
  mql?.addEventListener('change', cb);
  return () => mql?.removeEventListener('change', cb);
};
const systemDark = () => mql?.matches ?? true;

export function useIsDark() {
  const mode = usePreferences().theme.mode;
  const sys = useSyncExternalStore(subscribe, systemDark, () => true);
  return mode === 'dark' ? true : mode === 'light' ? false : sys;
}

/** 把用户偏好与动态色写入 :root 的 CSS 变量。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const prefs = usePreferences();
  const dark = useIsDark();
  const dynamic = useDynamicColor((s) => s.color);
  useEffect(() => {
    applyTheme(computeTheme({ theme: prefs.theme, dark, dynamic }));
  }, [prefs.theme, dark, dynamic]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = String(prefs.density);
    root.dataset.grid = prefs.gridStyle;
    const reduce = prefs.reduceMotion === 'on' || (prefs.reduceMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.dataset.reduceMotion = reduce ? 'on' : 'off';
  }, [prefs.density, prefs.gridStyle, prefs.reduceMotion]);
  return <>{children}</>;
}
