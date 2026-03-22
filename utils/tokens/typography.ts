/**
 * 设计令牌 - 字体系统
 * 统一管理字体、字号、字重、行高
 */

// 字体家族
export const fontFamily = {
  sans: ['"Space Grotesk"', 'Manrope', 'Inter', 'system-ui', 'sans-serif'].join(', '),
  display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'].join(', '),
  mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'].join(', '),
} as const;

// 字号系统
export const fontSize = {
  xs: '10px',
  sm: '12px',
  base: '14px',
  md: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
  '4xl': '36px',
  '5xl': '48px',
  '6xl': '60px',
  '7xl': '72px',
} as const;

// 字重系统
export const fontWeight = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

// 行高系统
export const lineHeight = {
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
} as const;

// 字间距
export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;

// 语义化字体样式
export const typography = {
  // 标题样式
  heading: {
    h1: {
      fontFamily: fontFamily.display,
      fontSize: fontSize['5xl'],
      fontWeight: fontWeight.bold,
      lineHeight: lineHeight.tight,
      letterSpacing: letterSpacing.tight,
    },
    h2: {
      fontFamily: fontFamily.display,
      fontSize: fontSize['4xl'],
      fontWeight: fontWeight.bold,
      lineHeight: lineHeight.tight,
      letterSpacing: letterSpacing.tight,
    },
    h3: {
      fontFamily: fontFamily.display,
      fontSize: fontSize['3xl'],
      fontWeight: fontWeight.semibold,
      lineHeight: lineHeight.snug,
      letterSpacing: letterSpacing.tight,
    },
    h4: {
      fontFamily: fontFamily.display,
      fontSize: fontSize['2xl'],
      fontWeight: fontWeight.semibold,
      lineHeight: lineHeight.snug,
    },
    h5: {
      fontFamily: fontFamily.display,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.normal,
    },
    h6: {
      fontFamily: fontFamily.display,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.normal,
    },
  },

  // 副标题样式
  subheading: {
    lg: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      lineHeight: lineHeight.snug,
    },
    base: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      lineHeight: lineHeight.normal,
    },
    sm: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.normal,
    },
  },

  // 正文样式
  body: {
    lg: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.normal,
      lineHeight: lineHeight.relaxed,
    },
    base: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.base,
      fontWeight: fontWeight.normal,
      lineHeight: lineHeight.relaxed,
    },
    sm: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.normal,
      lineHeight: lineHeight.normal,
    },
    xs: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.normal,
      lineHeight: lineHeight.normal,
    },
  },

  // 标签样式
  label: {
    lg: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.normal,
    },
    base: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.normal,
    },
    sm: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.tight,
    },
  },

  // 代码样式
  code: {
    base: {
      fontFamily: fontFamily.mono,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.normal,
      lineHeight: lineHeight.normal,
    },
  },

  // 按钮样式
  button: {
    lg: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      lineHeight: lineHeight.tight,
    },
    base: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.tight,
    },
    sm: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      lineHeight: lineHeight.tight,
    },
  },

  // 标题大写样式
  uppercase: {
    base: {
      fontFamily: fontFamily.sans,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.bold,
      lineHeight: lineHeight.tight,
      letterSpacing: letterSpacing.widest,
      textTransform: 'uppercase',
    },
  },
} as const;

export type FontFamily = typeof fontFamily;
export type FontSize = typeof fontSize;
export type FontWeight = typeof fontWeight;
export type Typography = typeof typography;
