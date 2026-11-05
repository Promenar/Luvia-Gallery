import type { ThemePreference } from '@luvia/contracts';
import { hexToRgb, oklchCss, relativeLuminance, rgbToOklch, type Oklch } from './color';

/** 预设强调色（OKLCH）。mono 为无彩，dynamic 随当前照片。 */
export const ACCENTS: Record<string, Oklch | null> = {
  mono: null,
  azure: [0.66, 0.15, 250],
  teal: [0.7, 0.11, 195],
  sage: [0.72, 0.09, 150],
  amber: [0.76, 0.14, 72],
  coral: [0.69, 0.16, 35],
  rose: [0.67, 0.16, 5],
  violet: [0.65, 0.16, 295],
};
export const ACCENT_NAMES: Record<string, string> = {
  dynamic: '随照片', mono: '无彩', azure: '湖蓝', teal: '青碧', sage: '苔绿',
  amber: '琥珀', coral: '珊瑚', rose: '绯红', violet: '暮紫', custom: '自定义',
};
export const BASES = {
  graphite: { h: 270, c: 0.002, name: '石墨' },
  warm: { h: 65, c: 0.01, name: '暖灰' },
  cool: { h: 245, c: 0.014, name: '冷灰' },
  oled: { h: 0, c: 0, name: '纯黑' },
} as const;
const RADII = { sharp: [3, 5, 8], default: [6, 10, 16], round: [10, 16, 24] } as const;

/** 默认动态色：没有照片可取色时的暖色。 */
export const FALLBACK_DYNAMIC: Oklch = [0.7, 0.12, 40];

export interface ThemeInput {
  theme: ThemePreference;
  dark: boolean;
  /** 当前照片主色；accent=dynamic 时使用。 */
  dynamic: Oklch | null;
}

/** 由偏好计算全部 CSS 变量。纯函数，便于测试与服务端渲染。 */
export function computeTheme({ theme, dark, dynamic }: ThemeInput): Record<string, string> {
  const base = BASES[theme.base];
  let acc: Oklch | null;
  if (theme.accent === 'dynamic') acc = dynamic ?? FALLBACK_DYNAMIC;
  else if (theme.accent.startsWith('#')) acc = rgbToOklch(...hexToRgb(theme.accent));
  else acc = ACCENTS[theme.accent] ?? null;

  // 中性色轻微带上强调色的色相，使整页与照片气质一致
  let th: number = base.h, tc: number = base.c;
  if (acc) { th = acc[2]; tc = Math.min(0.022, Math.max(base.c, acc[1] * 0.12)); }
  const oled = theme.base === 'oled' && dark;
  const L = dark
    ? { bg: oled ? 0 : 0.16, su: oled ? 0.12 : 0.195, ra: oled ? 0.17 : 0.235, sk: oled ? 0 : 0.13, fg: 0.96, f2: 0.82, mu: 0.66 }
    : { bg: 0.97, su: 1, ra: 0.985, sk: 0.93, fg: 0.2, f2: 0.36, mu: 0.5 };

  let aL: number, aC: number, aH: number;
  if (!acc) { aL = dark ? 0.92 : 0.24; aC = 0; aH = 0; }
  else {
    aH = acc[2];
    aC = Math.min(acc[1], 0.2);
    aL = dark ? Math.max(0.68, Math.min(0.84, acc[0])) : Math.max(0.42, Math.min(0.56, acc[0]));
  }
  const r = RADII[theme.radius];
  return {
    '--bg': oklchCss(L.bg, oled ? 0 : tc, th),
    '--surface': oklchCss(L.su, dark ? tc : tc * 0.4, th),
    '--raised': oklchCss(L.ra, dark ? tc : tc * 0.3, th),
    '--sunken': oklchCss(L.sk, tc, th),
    '--fg': oklchCss(L.fg, tc * 0.4, th),
    '--fg-2': oklchCss(L.f2, tc * 0.6, th),
    '--muted': oklchCss(L.mu, tc, th),
    '--glass': dark ? oklchCss(0.2, tc, th, 0.62) : oklchCss(0.99, tc * 0.3, th, 0.72),
    '--line': dark ? 'rgb(255 255 255 / 0.08)' : 'rgb(0 0 0 / 0.08)',
    '--line-2': dark ? 'rgb(255 255 255 / 0.15)' : 'rgb(0 0 0 / 0.14)',
    '--accent': oklchCss(aL, aC, aH),
    '--accent-soft': oklchCss(aL, aC, aH, dark ? 0.16 : 0.12),
    '--accent-fg': relativeLuminance(aL, aC, aH) > 0.36 ? '#111' : '#fff',
    '--ok': dark ? '#62c08f' : '#23824f',
    '--warn': dark ? '#e0a948' : '#9a6710',
    '--bad': dark ? '#ec6a5e' : '#c23a2c',
    '--scrim': dark ? 'rgb(0 0 0 / 0.5)' : 'rgb(0 0 0 / 0.35)',
    '--r1': `${r[0]}px`,
    '--r2': `${r[1]}px`,
    '--r3': `${r[2]}px`,
    'color-scheme': dark ? 'dark' : 'light',
  };
}

export function applyTheme(vars: Record<string, string>, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset.scheme = vars['color-scheme'] ?? 'dark';
}
