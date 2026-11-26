import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { thumbHashToRGBA } from 'thumbhash';
import type { MediaItem } from '@luvia/contracts';
import { usePreferences } from '@/stores/session';
import { applyTheme, computeTheme } from './engine';
import { paletteFromRGBA, type DynamicPalette, type Oklch } from './color';

/** 当前“动态强调色与双色环境光场”的来源色板。页面在主图切换、悬停或查看器换图时调用 setDynamicFrom。 */
export const useDynamicColor = create<{
  color: Oklch | null;
  secondary: Oklch | null;
  set: (c: Oklch | null, secondary?: Oklch | null) => void;
}>((set) => ({
  color: null,
  secondary: null,
  set: (color, secondary = null) => set({ color, secondary }),
}));

const cache = new Map<string, DynamicPalette>();

/** 由媒体的 ThumbHash 计算主色与副氛围色（无需下载图片）；没有 ThumbHash 时保持当前色板。 */
export function paletteFromMedia(m: Pick<MediaItem, 'id' | 'thumbhash'>): DynamicPalette | undefined {
  if (!m.thumbhash) return undefined;
  const key = `${m.id}:${m.thumbhash}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const bin = Uint8Array.from(atob(m.thumbhash), (c) => c.charCodeAt(0));
    const { rgba } = thumbHashToRGBA(bin);
    const palette = paletteFromRGBA(rgba);
    if (cache.size > 4000) cache.clear();
    cache.set(key, palette);
    return palette;
  } catch {
    return undefined;
  }
}

export function colorFromMedia(m: Pick<MediaItem, 'id' | 'thumbhash'>): Oklch | null | undefined {
  return paletteFromMedia(m)?.primary;
}

export function setDynamicFrom(m: Pick<MediaItem, 'id' | 'thumbhash'> | null | undefined) {
  if (!m) return;
  const palette = paletteFromMedia(m);
  if (palette !== undefined) useDynamicColor.getState().set(palette.primary, palette.secondary);
}

const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (cb: () => void) => {
  mql?.addEventListener('change', cb);
  return () => mql?.removeEventListener('change', cb);
};
const systemDark = () => mql?.matches ?? true;

export function useIsDark() {
  const mode = usePreferences().theme?.mode ?? 'system';
  const sys = useSyncExternalStore(subscribe, systemDark, () => true);
  return mode === 'dark' ? true : mode === 'light' ? false : sys;
}

export function useThemeStyle() {
  return usePreferences().theme?.style ?? 'cinema';
}

/** 把用户偏好与双色动态光场写入 :root 的 CSS 变量与数据属性。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const prefs = usePreferences();
  const dark = useIsDark();
  const dynamic = useDynamicColor((s) => s.color);
  const dynamicSecondary = useDynamicColor((s) => s.secondary);
  useEffect(() => {
    applyTheme(computeTheme({ theme: prefs.theme, dark, dynamic, dynamicSecondary }));
  }, [prefs.theme, dark, dynamic, dynamicSecondary]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = String(prefs.density);
    root.dataset.grid = prefs.gridStyle;
    const reduce = prefs.reduceMotion === 'on' || (prefs.reduceMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.dataset.reduceMotion = reduce ? 'on' : 'off';
  }, [prefs.density, prefs.gridStyle, prefs.reduceMotion]);
  return <>{children}</>;
}
