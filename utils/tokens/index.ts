/**
 * 设计令牌 - 统一导出
 * 所有设计令牌的统一入口
 */

// 颜色系统
export * from './colors';

// 间距系统
export * from './spacing';

// 字体系统
export * from './typography';

// 阴影系统
export * from './shadows';

// 动画系统
export * from './animation';

// 断点系统
export * from './breakpoints';

// 交互状态系统
export * from './interactions';

// 导入所有令牌
import { colors, cssVariables as colorVariables } from './colors';
import { spacing, semanticSpacing, borderRadius, semanticRadius } from './spacing';
import { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, typography } from './typography';
import { shadows, glows, semanticShadows, shadowCSSVariables } from './shadows';
import { duration, easing, springConfigs, stagger, motionPresets, hoverEffects, transitionCSSVariables } from './animation';
import { breakpoints, mediaQueries, deviceBreakpoints } from './breakpoints';

// 完整的设计令牌对象
export const designTokens = {
  colors,
  spacing,
  semanticSpacing,
  borderRadius,
  semanticRadius,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  typography,
  shadows,
  glows,
  semanticShadows,
  duration,
  easing,
  springConfigs,
  stagger,
  motionPresets,
  hoverEffects,
  breakpoints,
  mediaQueries,
  deviceBreakpoints,
} as const;

// 完整的CSS变量字符串
export const generateCSSVariables = (): string => {
  return `
${colorVariables}

    /* Shadows */
${shadowCSSVariables}

    /* Transitions */
${transitionCSSVariables}
  `;
};

// 玻璃态样式预设
export const glassPresets = {
  // Glass 1 - 用于卡片、列表项
  glass1: {
    light: {
      background: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(12px) saturate(130%)',
      boxShadow: shadows.md,
      border: '1px solid rgba(255, 255, 255, 0.05)',
    },
    dark: {
      background: 'rgba(15, 23, 42, 0.25)',
      backdropFilter: 'blur(12px) saturate(130%)',
      boxShadow: shadows.lg,
      border: '1px solid rgba(255, 255, 255, 0.02)',
    },
  },

  // Glass 2 - 用于导航栏、工具栏
  glass2: {
    light: {
      background: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(20px) saturate(180%)',
      boxShadow: shadows.lg,
      border: '1px solid rgba(255, 255, 255, 0.03)',
    },
    dark: {
      background: 'rgba(8, 10, 20, 0.65)',
      backdropFilter: 'blur(20px) saturate(180%)',
      boxShadow: shadows.lg,
      border: '1px solid rgba(255, 255, 255, 0.015)',
    },
  },

  // Glass 3 - 用于模态框、弹出层
  glass3: {
    light: {
      background: 'rgba(15, 23, 42, 0.7)',
      backdropFilter: 'blur(40px) saturate(150%)',
      boxShadow: shadows['2xl'],
      border: '1px solid rgba(255, 255, 255, 0.05)',
    },
    dark: {
      background: 'rgba(4, 6, 10, 0.82)',
      backdropFilter: 'blur(40px) saturate(150%)',
      boxShadow: shadows['2xl'],
      border: '1px solid rgba(255, 255, 255, 0.02)',
    },
  },
} as const;

// 注意: interactionPresets 已在 interactions.ts 中定义并导出
// 此处不再重复定义，请使用 from './interactions' 导入

export type DesignTokens = typeof designTokens;
export type GlassPresets = typeof glassPresets;
export type InteractionPresets = typeof interactionPresets;
