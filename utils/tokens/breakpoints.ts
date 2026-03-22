/**
 * 设计令牌 - 响应式断点
 * 统一管理响应式断点值
 */

// 断点值 (px)
export const breakpoints = {
  xs: 375,   // 小手机
  sm: 640,   // 大手机
  md: 768,   // 平板竖屏
  lg: 1024,  // 平板横屏/小型笔记本
  xl: 1280,  // 桌面
  '2xl': 1536, // 大桌面
  '3xl': 1920, // 全高清
} as const;

// 断点媒体查询
export const mediaQueries = {
  xs: `(min-width: ${breakpoints.xs}px)`,
  sm: `(min-width: ${breakpoints.sm}px)`,
  md: `(min-width: ${breakpoints.md}px)`,
  lg: `(min-width: ${breakpoints.lg}px)`,
  xl: `(min-width: ${breakpoints.xl}px)`,
  '2xl': `(min-width: ${breakpoints['2xl']}px)`,
  '3xl': `(min-width: ${breakpoints['3xl']}px)`,

  // 最大宽度
  xsMax: `(max-width: ${breakpoints.xs - 1}px)`,
  smMax: `(max-width: ${breakpoints.sm - 1}px)`,
  mdMax: `(max-width: ${breakpoints.md - 1}px)`,
  lgMax: `(max-width: ${breakpoints.lg - 1}px)`,
  xlMax: `(max-width: ${breakpoints.xl - 1}px)`,

  // 移动端
  mobile: `(max-width: ${breakpoints.md - 1}px)`,

  // 平板
  tablet: `(min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`,

  // 桌面
  desktop: `(min-width: ${breakpoints.lg}px)`,

  // 大桌面
  desktopLg: `(min-width: ${breakpoints.xl}px)`,

  // 触摸设备
  touch: '(hover: none) and (pointer: coarse)',

  // 精确指针(鼠标)
  pointer: '(hover: hover) and (pointer: fine)',

  // 暗色模式
  dark: '(prefers-color-scheme: dark)',

  // 亮色模式
  light: '(prefers-color-scheme: light)',

  // 减少动画
  reducedMotion: '(prefers-reduced-motion: reduce)',

  // 高对比度
  highContrast: '(prefers-contrast: high)',

  // 减少透明度
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
} as const;

// 设备类型检测
export const deviceBreakpoints = {
  // 手机 (0 - 767px)
  mobile: {
    min: 0,
    max: breakpoints.md - 1,
  },

  // 平板 (768px - 1023px)
  tablet: {
    min: breakpoints.md,
    max: breakpoints.lg - 1,
  },

  // 桌面 (1024px+)
  desktop: {
    min: breakpoints.lg,
    max: Infinity,
  },
} as const;

// Tailwind断点映射
export const tailwindBreakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// 响应式工具函数
export const isMobile = (width: number): boolean => {
  return width < breakpoints.md;
};

export const isTablet = (width: number): boolean => {
  return width >= breakpoints.md && width < breakpoints.lg;
};

export const isDesktop = (width: number): boolean => {
  return width >= breakpoints.lg;
};

export const isLargeDesktop = (width: number): boolean => {
  return width >= breakpoints.xl;
};

// 根据宽度获取当前断点
export const getBreakpoint = (width: number): string => {
  if (width < breakpoints.sm) return 'xs';
  if (width < breakpoints.md) return 'sm';
  if (width < breakpoints.lg) return 'md';
  if (width < breakpoints.xl) return 'lg';
  if (width < breakpoints['2xl']) return 'xl';
  if (width < breakpoints['3xl']) return '2xl';
  return '3xl';
};

// 根据宽度获取设备类型
export const getDeviceType = (width: number): 'mobile' | 'tablet' | 'desktop' => {
  if (isMobile(width)) return 'mobile';
  if (isTablet(width)) return 'tablet';
  return 'desktop';
};

// CSS变量
export const breakpointCSSVariables = `
  /* Breakpoints */
  --breakpoint-xs: ${breakpoints.xs}px;
  --breakpoint-sm: ${breakpoints.sm}px;
  --breakpoint-md: ${breakpoints.md}px;
  --breakpoint-lg: ${breakpoints.lg}px;
  --breakpoint-xl: ${breakpoints.xl}px;
  --breakpoint-2xl: ${breakpoints['2xl']}px;
  --breakpoint-3xl: ${breakpoints['3xl']}px;
`;

export type Breakpoints = typeof breakpoints;
export type MediaQueries = typeof mediaQueries;
export type DeviceBreakpoints = typeof deviceBreakpoints;
