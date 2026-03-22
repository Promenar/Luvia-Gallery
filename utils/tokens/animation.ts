/**
 * 设计令牌 - 动画系统
 * 统一管理动画时长、缓动函数、预设动画
 */

// 动画时长
export const duration = {
  instant: '0ms',
  fastest: '100ms',
  faster: '150ms',
  fast: '200ms',
  normal: '300ms',
  slow: '400ms',
  slower: '500ms',
  slowest: '700ms',
} as const;

// 缓动函数
export const easing = {
  // 线性
  linear: 'linear',

  // 标准缓动
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',

  // 贝塞尔曲线
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  smoothIn: 'cubic-bezier(0.4, 0, 1, 1)',
  smoothOut: 'cubic-bezier(0, 0, 0.2, 1)',

  // 弹性
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  bounceIn: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  bounceOut: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',

  // 精准控制
  sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
} as const;

// Framer Motion Spring配置
export const springConfigs = {
  // 快速弹性 - 用于小型元素
  snappy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30,
  },

  // 标准弹性 - 用于大多数过渡
  default: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
  },

  // 柔和弹性 - 用于大型元素
  gentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 25,
  },

  // 缓慢弹性 - 用于模态框
  slow: {
    type: 'spring' as const,
    stiffness: 150,
    damping: 20,
  },

  // 弹跳效果 - 用于特殊交互
  bouncy: {
    type: 'spring' as const,
    stiffness: 600,
    damping: 15,
  },

  // 刚性 - 用于即时反馈
  stiff: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 40,
  },
} as const;

// 交错动画延迟
export const stagger = {
  fast: 30,   // 30ms  - 快速交错
  normal: 50, // 50ms  - 标准交错
  slow: 80,   // 80ms  - 缓慢交错
  slowest: 100, // 100ms - 最慢交错
} as const;

// 预设动画配置 (用于Framer Motion)
export const motionPresets = {
  // 淡入
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2, ease: 'easeOut' },
  },

  // 从下方滑入
  slideUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 20 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 从上方滑入
  slideDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 从左侧滑入
  slideLeft: {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 从右侧滑入
  slideRight: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 缩放
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 缩放(小)
  scaleSm: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },

  // 模态框
  modal: {
    initial: { opacity: 0, scale: 0.95, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 20 },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 抽屉(从右)
  drawerRight: {
    initial: { x: '100%' },
    animate: { x: 0 },
    exit: { x: '100%' },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },

  // 抽屉(从左)
  drawerLeft: {
    initial: { x: '-100%' },
    animate: { x: 0 },
    exit: { x: '-100%' },
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },
} as const;

// 悬浮交互
export const hoverEffects = {
  // 轻微上浮
  lift: {
    y: -2,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },

  // 轻微缩放
  scale: {
    scale: 1.02,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },

  // 轻微缩放+上浮
  liftAndScale: {
    y: -2,
    scale: 1.02,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },

  // 按下效果
  tap: {
    scale: 0.98,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },
} as const;

// CSS过渡变量
export const transitionCSSVariables = `
  /* Duration */
  --duration-instant: ${duration.instant};
  --duration-fast: ${duration.fast};
  --duration-normal: ${duration.normal};
  --duration-slow: ${duration.slow};

  /* Easing */
  --ease-smooth: ${easing.smooth};
  --ease-bounce: ${easing.bounce};

  /* Stagger */
  --stagger-fast: ${stagger.fast}ms;
  --stagger-normal: ${stagger.normal}ms;
  --stagger-slow: ${stagger.slow}ms;
`;

export type Duration = typeof duration;
export type Easing = typeof easing;
export type SpringConfigs = typeof springConfigs;
export type MotionPresets = typeof motionPresets;
export type HoverEffects = typeof hoverEffects;
