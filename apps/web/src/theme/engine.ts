import type { ThemePreference } from '@luvia/contracts';
import { hexToRgb, oklchCss, relativeLuminance, rgbToOklch, type Oklch } from './color';

/** 一级视觉皮肤：cinema 液态光场（默认）、monograph 美术馆画册。 */
export type ThemeStyle = ThemePreference['style'];

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

const RADII_CINEMA = { sharp: [4, 7, 12], default: [8, 14, 22], round: [10, 16, 24] } as const;
const RADII_MONOGRAPH = { sharp: [2, 4, 7], default: [3, 6, 10], round: [8, 14, 20] } as const;

/** 默认动态色：没有照片可取色时的暖色 / 光学蓝。 */
export const FALLBACK_DYNAMIC: Oklch = [0.7, 0.12, 40];
const FALLBACK_MONOGRAPH_DYNAMIC: Oklch = [0.72, 0.085, 68];
const FALLBACK_CINEMA_DYNAMIC: Oklch = [0.7, 0.13, 240];

export interface ThemeInput {
  theme: ThemePreference;
  dark: boolean;
  /** 当前照片主色；accent=dynamic 时使用。 */
  dynamic: Oklch | null;
  /** 当前照片副氛围色；cinema 皮肤用于双色漫反射环境光场。 */
  dynamicSecondary?: Oklch | null;
}

/** 由皮肤、深浅模式、底色家族与动态照片色板计算全部 CSS 变量。纯函数，便于测试。 */
export function computeTheme({ theme, dark, dynamic, dynamicSecondary = null }: ThemeInput): Record<string, string> {
  const style: ThemeStyle = theme.style ?? 'cinema';
  const isMono = style === 'monograph';
  const base = BASES[theme.base];

  let acc: Oklch | null;
  if (theme.accent === 'dynamic') {
    acc = dynamic ?? (isMono ? FALLBACK_MONOGRAPH_DYNAMIC : FALLBACK_CINEMA_DYNAMIC);
  } else if (theme.accent.startsWith('#')) {
    acc = rgbToOklch(...hexToRgb(theme.accent));
  } else {
    acc = ACCENTS[theme.accent] ?? null;
  }

  const oled = theme.base === 'oled' && dark;

  // 强调色计算：monograph 更克制如印章/黄铜，cinema 更通透明亮如光学折射；保证深浅模式文字对比度达标
  let aL: number, aC: number, aH: number;
  if (!acc) {
    aL = dark ? 0.92 : 0.22;
    aC = 0;
    aH = 0;
  } else {
    aH = acc[2];
    const explicitHex = theme.accent.startsWith('#');
    if (isMono && !explicitHex) {
      aC = Math.max(0.052, Math.min(acc[1] * 0.85, dark ? 0.105 : 0.115));
      aL = dark ? Math.max(0.68, Math.min(0.80, acc[0])) : Math.max(0.41, Math.min(0.52, acc[0]));
    } else {
      aC = Math.min(acc[1], 0.2);
      aL = dark ? Math.max(0.68, Math.min(0.84, acc[0])) : Math.max(0.42, Math.min(0.56, acc[0]));
    }
  }

  const accentCss = oklchCss(aL, aC, aH);
  const accentSoft = oklchCss(aL, aC, aH, dark ? (isMono ? 0.14 : 0.19) : 0.12);
  const accentFg = relativeLuminance(aL, aC, aH) > 0.36 ? '#111' : '#fff';

  // 圆角：按皮肤气质分别校准（monograph 利落画框 / cinema 光学圆润）
  const r = (isMono ? RADII_MONOGRAPH : RADII_CINEMA)[theme.radius];

  // 双色环境光场：仅 cinema 呈现鲜活照片漫反射；monograph 保持中性微光不污染展墙
  const ambHue1 = aH || (isMono ? 65 : 232);
  const ambSecondary = dynamicSecondary ?? [0.58, 0.08, (ambHue1 + 38) % 360];
  const amb1 = isMono
    ? oklchCss(dark ? 0.44 : 0.84, 0.035, 65)
    : oklchCss(dark ? 0.58 : 0.78, Math.min(0.18, Math.max(0.085, aC * 1.15)), ambHue1);
  const amb2 = isMono
    ? oklchCss(dark ? 0.38 : 0.88, 0.025, 45)
    : oklchCss(dark ? 0.50 : 0.82, Math.min(0.15, Math.max(0.065, ambSecondary[1] * 1.25)), (ambSecondary[2] + 24) % 360);

  // 皮肤基底色板
  let bg: string, surface: string, raised: string, sunken: string, paperMat: string;
  let fg: string, fg2: string, muted: string, glass: string, line: string, line2: string;
  let scrim: string, glassHighlight: string, shadowCard: string, shadowFloat: string;

  if (isMono) {
    // 美术馆画册：默认暖炭 / 无酸棉纸；无色偏污染，仍尊重用户底色家族选择（尤其 OLED 纯黑与冷灰）
    const baseHue = theme.base === 'graphite' ? 68 : base.h;
    const baseChroma = theme.base === 'graphite' ? 0.008 : base.c;
    const L = dark
      ? { bg: oled ? 0 : 0.168, su: oled ? 0.12 : 0.20, ra: oled ? 0.17 : 0.24, sk: oled ? 0 : 0.132, mat: oled ? 0.14 : 0.212, fg: 0.955, f2: 0.81, mu: 0.62 }
      : { bg: 0.954, su: 0.98, ra: 1, sk: 0.916, mat: 0.988, fg: 0.20, f2: 0.37, mu: 0.53 };
    bg = oklchCss(L.bg, oled ? 0 : baseChroma, baseHue);
    surface = oklchCss(L.su, dark ? baseChroma : baseChroma * 0.8, baseHue);
    raised = oklchCss(L.ra, dark ? baseChroma : baseChroma * 0.4, baseHue);
    sunken = oklchCss(L.sk, baseChroma * 1.05, baseHue);
    paperMat = oklchCss(L.mat, dark ? baseChroma * 0.9 : baseChroma * 0.7, baseHue);
    fg = oklchCss(L.fg, baseChroma * 0.5, baseHue);
    fg2 = oklchCss(L.f2, baseChroma * 0.7, baseHue);
    muted = oklchCss(L.mu, baseChroma * 0.85, baseHue);
    glass = dark ? oklchCss(0.2, baseChroma, baseHue, 0.9) : oklchCss(0.985, baseChroma * 0.5, baseHue, 0.92);
    line = dark ? 'rgb(242 239 233 / 0.085)' : 'rgb(27 24 21 / 0.095)';
    line2 = dark ? 'rgb(242 239 233 / 0.16)' : 'rgb(27 24 21 / 0.18)';
    scrim = dark ? 'rgb(8 7 6 / 0.64)' : 'rgb(27 24 21 / 0.38)';
    glassHighlight = 'none';
    shadowCard = dark
      ? '0 1px 2px rgb(0 0 0 / 0.35), 0 10px 26px -12px rgb(0 0 0 / 0.55)'
      : '0 1px 2px rgb(38 30 20 / 0.05), 0 8px 22px -10px rgb(38 30 20 / 0.12), 0 20px 44px -24px rgb(38 30 20 / 0.1)';
    shadowFloat = dark
      ? '0 4px 12px rgb(0 0 0 / 0.36), 0 28px 64px -20px rgb(0 0 0 / 0.72)'
      : '0 2px 6px rgb(38 30 20 / 0.06), 0 24px 56px -18px rgb(38 30 20 / 0.18)';
  } else {
    // 液态光场：深色光学暗房 / 浅色冷白柔光，中性色极轻承接照片色相，面板采用三层光学镜片质感
    let th: number = theme.base === 'graphite' ? 255 : base.h;
    let tc: number = theme.base === 'graphite' ? 0.008 : base.c;
    if (acc && theme.base !== 'oled') {
      th = acc[2];
      tc = Math.min(0.018, Math.max(tc, acc[1] * 0.1));
    }
    const L = dark
      ? { bg: oled ? 0 : 0.132, su: oled ? 0.11 : 0.188, ra: oled ? 0.165 : 0.238, sk: oled ? 0 : 0.105, mat: 0.195, fg: 0.968, f2: 0.828, mu: 0.635 }
      : { bg: 0.962, su: 0.995, ra: 1, sk: 0.922, mat: 0.995, fg: 0.185, f2: 0.36, mu: 0.53 };
    bg = oklchCss(L.bg, oled ? 0 : tc, th);
    surface = dark ? oklchCss(L.su, tc, th, 0.76) : oklchCss(L.su, tc * 0.35, th, 0.80);
    raised = dark ? oklchCss(L.ra, tc, th, 0.84) : oklchCss(L.ra, tc * 0.25, th, 0.92);
    sunken = dark ? oklchCss(L.sk, tc, th, 0.86) : oklchCss(L.sk, tc * 0.5, th, 0.76);
    paperMat = dark ? oklchCss(L.mat, tc * 0.6, th) : oklchCss(L.mat, tc * 0.2, th);
    fg = oklchCss(L.fg, tc * 0.4, th);
    fg2 = oklchCss(L.f2, tc * 0.6, th);
    muted = oklchCss(L.mu, tc * 0.9, th);
    glass = dark ? oklchCss(0.185, tc, th, 0.66) : oklchCss(0.995, tc * 0.25, th, 0.74);
    line = dark ? 'rgb(255 255 255 / 0.085)' : 'rgb(16 19 26 / 0.08)';
    line2 = dark ? 'rgb(255 255 255 / 0.16)' : 'rgb(16 19 26 / 0.15)';
    scrim = dark ? 'rgb(3 4 7 / 0.64)' : 'rgb(16 20 32 / 0.34)';
    glassHighlight = dark
      ? 'inset 0 1px 0 rgb(255 255 255 / 0.16), inset 0 -1px 0 rgb(255 255 255 / 0.04)'
      : 'inset 0 1px 0 rgb(255 255 255 / 0.92), inset 0 -1px 0 rgb(16 19 26 / 0.04)';
    shadowCard = dark
      ? '0 12px 32px -14px rgb(0 0 0 / 0.65)'
      : '0 1px 2px rgb(18 28 48 / 0.04), 0 14px 32px -14px rgb(18 28 48 / 0.12)';
    shadowFloat = dark
      ? '0 24px 64px -18px rgb(0 0 0 / 0.82), 0 4px 16px -4px rgb(0 0 0 / 0.45)'
      : '0 24px 60px -18px rgb(18 28 48 / 0.18), 0 4px 14px -4px rgb(18 28 48 / 0.08)';
  }

  return {
    '--bg': bg,
    '--surface': surface,
    '--raised': raised,
    '--sunken': sunken,
    '--paper-mat': paperMat,
    '--fg': fg,
    '--fg-2': fg2,
    '--muted': muted,
    '--glass': glass,
    '--line': line,
    '--line-2': line2,
    '--accent': accentCss,
    '--accent-soft': accentSoft,
    '--accent-fg': accentFg,
    '--ambient-1': amb1,
    '--ambient-2': amb2,
    '--amb-opacity-1': dark ? '0.22' : '0.26',
    '--amb-opacity-2': dark ? '0.16' : '0.20',
    '--paper-grain-opacity': isMono ? (dark ? '0.032' : '0.024') : '0',
    '--glass-highlight': glassHighlight,
    '--shadow-card': shadowCard,
    '--shadow-float': shadowFloat,
    '--ok': dark ? '#5bc28c' : '#1f7d4b',
    '--warn': dark ? '#e0aa4e' : '#9b640e',
    '--bad': dark ? '#e8685c' : '#bf3628',
    '--scrim': scrim,
    '--r1': `${r[0]}px`,
    '--r2': `${r[1]}px`,
    '--r3': `${r[2]}px`,
    'color-scheme': dark ? 'dark' : 'light',
    'data-style': style,
  };
}

export function applyTheme(vars: Record<string, string>, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'data-style') {
      el.dataset.style = v;
      continue;
    }
    el.style.setProperty(k, v);
  }
  el.dataset.scheme = vars['color-scheme'] ?? 'dark';
  if (!el.dataset.style) el.dataset.style = 'cinema';
}
