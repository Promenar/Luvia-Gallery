/** 外观面板的纯逻辑：取值范围、色块计算与选项定义。 */
import type { Preferences } from '@luvia/contracts';
import { ACCENT_NAMES, ACCENTS, BASES } from '@/theme/engine';
import { oklchCss } from '@/theme/color';

type Theme = Preferences['theme'];

export const MODE_OPTIONS = [
  { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
] as const satisfies readonly { value: Theme['mode']; label: string }[];

export const RADIUS_OPTIONS = [
  { value: 'sharp', label: '利落' }, { value: 'default', label: '标准' }, { value: 'round', label: '圆润' },
] as const satisfies readonly { value: Theme['radius']; label: string }[];

export const BACKDROP_OPTIONS = [
  { value: 'ambient', label: '氛围光' }, { value: 'black', label: '纯黑' }, { value: 'theme', label: '跟随底色' },
] as const satisfies readonly { value: Theme['viewerBackdrop']; label: string }[];

export const GRID_OPTIONS = [
  { value: 'justified', label: '保留原比例' }, { value: 'square', label: '方格' },
] as const satisfies readonly { value: Preferences['gridStyle']; label: string }[];

export const REDUCE_OPTIONS = [
  { value: 'system', label: '跟随系统' }, { value: 'on', label: '开启' }, { value: 'off', label: '关闭' },
] as const satisfies readonly { value: Preferences['reduceMotion']; label: string }[];

export const ORDER_OPTIONS = [
  { value: 'sequential', label: '依次' }, { value: 'shuffle', label: '随机' },
] as const satisfies readonly { value: Preferences['slideshow']['order']; label: string }[];

export const START_OPTIONS = [
  { value: 'photos', label: '照片' }, { value: 'memories', label: '回忆' }, { value: 'folders', label: '文件夹' }, { value: 'albums', label: '相册' },
] as const satisfies readonly { value: Preferences['startPage']; label: string }[];

/** 幻灯片间隔的常用档位（秒）。 */
export const INTERVAL_PRESETS = [3, 5, 8, 15, 30] as const;
export const INTERVAL_MIN = 2;
export const INTERVAL_MAX = 120;

/** 把输入的间隔整理为契约允许的整数秒；无法解析时返回 null。 */
export function clampInterval(raw: string | number): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || String(raw).trim() === '') return null;
  return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(n)));
}

export const DENSITY_LABELS: Record<number, string> = { 1: '最密', 2: '较密', 3: '适中', 4: '较疏', 5: '最疏' };

/** 底色色块：左半深色、右半浅色，展示该家族在两种模式下的样子。 */
export function baseSwatch(key: keyof typeof BASES): string {
  if (key === 'oled') return 'linear-gradient(90deg,#000 50%,#121212 50%)';
  const b = BASES[key];
  return `linear-gradient(90deg,${oklchCss(0.16, b.c * 2, b.h)} 50%,${oklchCss(0.96, b.c * 1.5, b.h)} 50%)`;
}

export type AccentKey = 'dynamic' | 'mono' | keyof typeof ACCENTS | 'custom';
/** 强调色选项顺序：随照片、无彩、7 个预设、自定义。 */
export const ACCENT_KEYS: AccentKey[] = ['dynamic', 'mono', ...Object.keys(ACCENTS).filter((k) => k !== 'mono'), 'custom'];
export const accentName = (k: AccentKey) => ACCENT_NAMES[k] ?? k;

/** 偏好中的 accent 对应哪个选项（#RRGGBB 为自定义）。 */
export const accentKeyOf = (accent: Theme['accent']): AccentKey => (accent.startsWith('#') ? 'custom' : (accent as AccentKey));

/** 色块背景。 */
export function accentSwatch(k: AccentKey, custom: string): string {
  if (k === 'dynamic') return 'conic-gradient(#e8734a,#e8c34a,#6bc28b,#4aa3e8,#9a6be8,#e86bb0,#e8734a)';
  if (k === 'mono') return 'linear-gradient(135deg,#f4f4f2 50%,#1a1a1c 50%)';
  if (k === 'custom') return custom;
  const c = ACCENTS[k];
  return c ? oklchCss(c[0], c[1], c[2]) : '#888';
}

/** 自定义取色的默认值。 */
export const DEFAULT_CUSTOM = '#4f7cff';
