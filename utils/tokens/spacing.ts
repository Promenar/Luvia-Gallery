/**
 * 设计令牌 - 间距系统
 * 基于4px的间距系统
 */

// 基础间距单位
export const BASE_UNIT = 4;

// 间距比例
export const spacing = {
  0: '0',
  0.5: `${BASE_UNIT * 0.5}px`,   // 2px
  1: `${BASE_UNIT * 1}px`,       // 4px
  1.5: `${BASE_UNIT * 1.5}px`,   // 6px
  2: `${BASE_UNIT * 2}px`,       // 8px
  2.5: `${BASE_UNIT * 2.5}px`,   // 10px
  3: `${BASE_UNIT * 3}px`,       // 12px
  4: `${BASE_UNIT * 4}px`,       // 16px
  5: `${BASE_UNIT * 5}px`,       // 20px
  6: `${BASE_UNIT * 6}px`,       // 24px
  8: `${BASE_UNIT * 8}px`,       // 32px
  10: `${BASE_UNIT * 10}px`,     // 40px
  12: `${BASE_UNIT * 12}px`,     // 48px
  16: `${BASE_UNIT * 16}px`,     // 64px
  20: `${BASE_UNIT * 20}px`,     // 80px
  24: `${BASE_UNIT * 24}px`,     // 96px
  32: `${BASE_UNIT * 32}px`,     // 128px
} as const;

// 语义化间距别名
export const semanticSpacing = {
  // 组件内部间距
  component: {
    xs: spacing[1],    // 4px - 紧凑元素间距
    sm: spacing[2],    // 8px - 小元素间距
    md: spacing[3],    // 12px - 中等元素间距
    lg: spacing[4],    // 16px - 大元素间距
    xl: spacing[6],    // 24px - 特大元素间距
  },

  // 布局间距
  layout: {
    mobile: spacing[4],    // 16px - 移动端页面边距
    tablet: spacing[6],    // 24px - 平板页面边距
    desktop: spacing[8],   // 32px - 桌面页面边距
    wide: spacing[12],     // 48px - 宽屏页面边距
  },

  // 卡片间距
  card: {
    mobile: spacing[4],    // 16px - 移动端卡片间距
    desktop: spacing[6],   // 24px - 桌面卡片间距
    padding: spacing[4],   // 16px - 卡片内边距
  },

  // 列表间距
  list: {
    item: spacing[3],      // 12px - 列表项间距
    section: spacing[6],   // 24px - 列表区块间距
  },

  // 表单间距
  form: {
    field: spacing[4],     // 16px - 表单字段间距
    group: spacing[6],     // 24px - 表单组间距
  },
} as const;

// 圆角系统
export const borderRadius = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '24px',
  full: '9999px',
} as const;

// 语义化圆角
export const semanticRadius = {
  button: borderRadius.lg,      // 12px - 按钮圆角
  card: borderRadius.xl,        // 16px - 卡片圆角
  modal: borderRadius['2xl'],   // 20px - 模态框圆角
  input: borderRadius.lg,       // 12px - 输入框圆角
  badge: borderRadius.full,     // full - 徽章圆角
  avatar: borderRadius.full,    // full - 头像圆角
  tooltip: borderRadius.lg,     // 12px - 提示框圆角
  dropdown: borderRadius.xl,    // 16px - 下拉菜单圆角
} as const;

export type Spacing = typeof spacing;
export type SemanticSpacing = typeof semanticSpacing;
export type BorderRadius = typeof borderRadius;
