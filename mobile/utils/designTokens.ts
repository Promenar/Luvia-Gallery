/**
 * Luvia Gallery Design Tokens
 * 统一的设计系统变量，确保视觉一致性
 */

// ============================================
// 品牌色彩系统
// ============================================

export const colors = {
  // 品牌主色 - 优雅紫蓝色系
  brand: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',  // 主品牌色
    600: '#9333ea',
    700: '#7c3aed',
    800: '#6b21a8',
    900: '#581c87',
    950: '#3b0764',
  },

  // 中性色 - 统一使用 zinc 系列
  neutral: {
    50: '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#3f3f46',
    800: '#27272a',
    900: '#18181b',
    950: '#09090b',
  },

  // 语义色
  semantic: {
    success: '#10b981',
    successLight: '#d1fae5',
    warning: '#f59e0b',
    warningLight: '#fef3c7',
    error: '#ef4444',
    errorLight: '#fee2e2',
    info: '#3b82f6',
    infoLight: '#dbeafe',
  },

  // 功能色 - 用于特定元素
  functional: {
    favorite: '#ec4899',
    favoriteLight: '#fce7f3',
    video: '#8b5cf6',
    videoLight: '#ede9fe',
    audio: '#06b6d4',
    audioLight: '#cffafe',
    folder: '#f59e0b',
    folderLight: '#fef3c7',
  },

  // 背景色
  background: {
    light: '#ffffff',
    lightSecondary: '#fafafa',
    lightTertiary: '#f4f4f5',
    dark: '#000000',
    darkSecondary: '#09090b',
    darkTertiary: '#18181b',
  },

  // 文字色
  text: {
    primary: '#18181b',
    secondary: '#52525b',
    tertiary: '#a1a1aa',
    inverse: '#ffffff',
    inverseSecondary: '#d4d4d8',
  },

  // 边框色
  border: {
    light: '#e4e4e7',
    lightSubtle: '#f4f4f5',
    dark: '#27272a',
    darkSubtle: '#3f3f46',
  },
} as const;

// ============================================
// 圆角系统
// ============================================

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  full: 9999,
} as const;

// 常用圆角别名
export const borderRadius = {
  card: radius.lg,      // 16px - 卡片
  modal: radius['2xl'], // 24px - 模态框
  button: radius.xl,    // 20px - 按钮
  input: radius.lg,     // 16px - 输入框
  badge: radius.md,     // 10px - 徽章
  avatar: radius.full,  // 圆形
  thumbnail: radius.xl, // 20px - 缩略图
} as const;

// ============================================
// 间距系统
// ============================================

export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;

// ============================================
// 阴影系统
// ============================================

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  // 品牌色阴影
  brand: {
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// ============================================
// 字体系统
// ============================================

export const fontSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
} as const;

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
};

export const lineHeight = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const;

export const letterSpacing = {
  tighter: -0.05,
  tight: -0.025,
  normal: 0,
  wide: 0.025,
  wider: 0.05,
  widest: 0.1,
} as const;

// ============================================
// 动画时长
// ============================================

export const duration = {
  instant: 0,
  fast: 100,
  normal: 200,
  slow: 300,
  slower: 500,
  slowest: 700,
} as const;

// ============================================
// Z-Index 层级
// ============================================

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modal: 40,
  popover: 50,
  toast: 60,
  tooltip: 70,
  overlay: 100,
} as const;

// ============================================
// 毛玻璃效果
// ============================================

export const glassEffect = {
  light: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(12px)',
  },
  dark: {
    backgroundColor: 'rgba(9, 9, 11, 0.8)',
    backdropFilter: 'blur(12px)',
  },
  lightSubtle: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(8px)',
  },
  darkSubtle: {
    backgroundColor: 'rgba(9, 9, 11, 0.6)',
    backdropFilter: 'blur(8px)',
  },
} as const;

// ============================================
// 渐变配置
// ============================================

export const gradients = {
  // 品牌渐变
  brand: ['#a855f7', '#7c3aed'],
  brandLight: ['#c084fc', '#a855f7'],
  
  // 遮罩渐变
  overlayLight: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)'],
  overlayDark: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)'],
  
  // 卡片渐变
  cardShine: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0)'],
  
  // 功能渐变
  favorite: ['#ec4899', '#f472b6'],
  video: ['#8b5cf6', '#a78bfa'],
  audio: ['#06b6d4', '#22d3ee'],
} as const;

// ============================================
// 交互状态
// ============================================

export const interaction = {
  // 按压缩放比例
  scalePressed: 0.97,
  scalePressedLight: 0.99,
  
  // 透明度
  opacityPressed: 0.8,
  opacityDisabled: 0.5,
  opacityHover: 0.9,
  
  // 触觉反馈类型
  haptic: {
    light: 'light',
    medium: 'medium',
    heavy: 'heavy',
    success: 'success',
    warning: 'warning',
    error: 'error',
  },
} as const;

// ============================================
// 类型导出
// ============================================

export type ColorToken = typeof colors;
export type RadiusToken = typeof radius;
export type ShadowToken = typeof shadows;
export type FontSizeToken = typeof fontSize;
export type SpacingToken = typeof spacing;

// ============================================
// 工具函数
// ============================================

/**
 * 获取带透明度的颜色
 */
export function withOpacity(color: string, opacity: number): string {
  // 处理 hex 颜色
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  // 处理 rgb 颜色
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  return color;
}

/**
 * 获取阴影样式
 */
export function getShadowStyle(shadowKey: keyof typeof shadows, isDark = false) {
  const shadow = shadows[shadowKey];
  return {
    ...shadow,
    shadowOpacity: isDark ? shadow.shadowOpacity * 1.5 : shadow.shadowOpacity,
  };
}
