/**
 * 设计令牌 - 阴影系统
 * 统一管理组件阴影和光效
 */

// 基础阴影系统
export const shadows = {
  // 无阴影
  none: 'none',

  // 微小阴影 - 用于悬浮提示
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',

  // 小阴影 - 用于按钮、小卡片
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',

  // 中等阴影 - 用于卡片、下拉菜单
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',

  // 大阴影 - 用于模态框、弹出层
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',

  // 特大阴影 - 用于大模态框
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',

  // 巨大阴影 - 用于全屏模态
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',

  // 内阴影
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
} as const;

// 玻璃态阴影 (亮色模式)
export const glassShadowsLight = {
  // 轻度玻璃 - 用于卡片
  glass1: `
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.05),
    0 10px 20px -5px rgba(0, 0, 0, 0.2)
  `,

  // 中度玻璃 - 用于导航栏
  glass2: `
    0 10px 40px -10px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.05)
  `,

  // 深度玻璃 - 用于模态框
  glass3: `
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.05)
  `,
} as const;

// 玻璃态阴影 (暗色模式)
export const glassShadowsDark = {
  glass1: `
    inset 0 1px 0 0 rgba(255, 255, 255, 0.01),
    0 10px 30px -10px rgba(0, 0, 0, 0.6)
  `,

  glass2: `
    0 10px 40px -10px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.02)
  `,

  glass3: `
    0 40px 100px -20px rgba(0, 0, 0, 0.9),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.01)
  `,
} as const;

// 发光效果
export const glows = {
  // accent发光
  accent: {
    sm: '0 0 10px rgba(38, 131, 211, 0.3)',
    md: '0 0 20px rgba(38, 131, 211, 0.4)',
    lg: '0 0 30px rgba(38, 131, 211, 0.5)',
  },

  // 功能色发光
  success: '0 0 10px rgba(34, 197, 94, 0.3)',
  warning: '0 0 10px rgba(234, 179, 8, 0.3)',
  error: '0 0 10px rgba(239, 68, 68, 0.3)',
  info: '0 0 10px rgba(59, 130, 246, 0.3)',
} as const;

// 语义化阴影
export const semanticShadows = {
  // 卡片
  card: {
    default: shadows.md,
    hover: shadows.lg,
    active: shadows.sm,
  },

  // 按钮
  button: {
    default: shadows.sm,
    hover: shadows.md,
    active: shadows.xs,
    accent: glows.accent.md,
  },

  // 下拉菜单
  dropdown: shadows.lg,

  // 模态框
  modal: shadows['2xl'],

  // 工具提示
  tooltip: shadows.md,

  // 输入框聚焦
  inputFocus: '0 0 0 3px rgba(38, 131, 211, 0.2)',

  // 导航栏
  navbar: shadows.md,

  // 侧边栏
  sidebar: shadows.lg,
} as const;

// CSS变量映射
export const shadowCSSVariables = `
  /* Shadows */
  --shadow-xs: ${shadows.xs};
  --shadow-sm: ${shadows.sm};
  --shadow-md: ${shadows.md};
  --shadow-lg: ${shadows.lg};
  --shadow-xl: ${shadows.xl};
  --shadow-2xl: ${shadows['2xl']};

  /* Glows */
  --glow-accent-sm: ${glows.accent.sm};
  --glow-accent-md: ${glows.accent.md};
  --glow-accent-lg: ${glows.accent.lg};
`;

export type Shadows = typeof shadows;
export type Glows = typeof glows;
export type SemanticShadows = typeof semanticShadows;
