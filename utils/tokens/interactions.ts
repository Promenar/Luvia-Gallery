/**
 * 设计令牌 - 交互状态系统
 * 统一管理所有可交互元素的hover/active/focus/disabled状态
 */

// 交互状态颜色
export const interactionColors = {
  // Hover状态
  hover: {
    bg: 'rgba(255, 255, 255, 0.08)',
    border: 'rgba(255, 255, 255, 0.1)',
    text: 'var(--text-primary)',
    accent: 'var(--accent-500)',
  },
  
  // Active状态
  active: {
    bg: 'rgba(255, 255, 255, 0.12)',
    border: 'var(--accent-500)',
    text: 'var(--accent-400)',
  },
  
  // Focus状态
  focus: {
    ring: 'rgba(var(--accent-rgb), 0.3)',
    ringWidth: '2px',
    ringOffset: '2px',
  },
  
  // Disabled状态
  disabled: {
    bg: 'transparent',
    border: 'rgba(255, 255, 255, 0.05)',
    text: 'var(--text-muted)',
    opacity: 0.5,
    cursor: 'not-allowed',
  },
} as const;

// Framer Motion交互预设
export const interactionPresets = {
  // 按钮交互
  button: {
    whileHover: { scale: 1.02, y: -1 },
    whileTap: { scale: 0.98 },
    whileFocus: { boxShadow: '0 0 0 2px rgba(var(--accent-rgb), 0.3)' },
  },
  
  // 卡片交互
  card: {
    whileHover: { y: -4, scale: 1.01 },
    whileTap: { scale: 0.99 },
  },
  
  // 图标按钮交互
  iconButton: {
    whileHover: { scale: 1.1 },
    whileTap: { scale: 0.9 },
  },
  
  // 列表项交互
  listItem: {
    whileHover: { x: 4, backgroundColor: 'rgba(255, 255, 255, 0.05)' },
    whileTap: { scale: 0.99 },
  },
  
  // 链接交互
  link: {
    whileHover: { color: 'var(--accent-400)' },
  },
  
  // 输入框交互
  input: {
    whileFocus: { 
      borderColor: 'rgba(var(--accent-rgb), 0.5)',
      boxShadow: '0 0 0 3px rgba(var(--accent-rgb), 0.1)',
    },
  },
} as const;

// CSS类名映射
export const interactionClasses = {
  // 交互基础类
  interactive: `
    cursor-pointer
    transition-all
    duration-200
    ease-out
    focus:outline-none
    disabled:cursor-not-allowed
    disabled:opacity-50
  `,
  
  // 悬浮效果
  hover: {
    lift: 'hover:-translate-y-1 hover:shadow-lg',
    scale: 'hover:scale-[1.02]',
    glow: 'hover:shadow-[0_0_20px_rgba(var(--accent-rgb),0.2)]',
    highlight: 'hover:bg-white/5 hover:border-white/10',
  },
  
  // 激活效果
  active: {
    scale: 'active:scale-[0.98]',
    press: 'active:translate-y-0',
  },
  
  // 焦点效果
  focus: {
    ring: 'focus:ring-2 focus:ring-accent-500/30 focus:ring-offset-2 focus:ring-offset-transparent',
    glow: 'focus:shadow-[0_0_0_3px_rgba(var(--accent-rgb),0.15)]',
    border: 'focus:border-accent-500/50',
  },
  
  // 禁用效果
  disabled: {
    base: 'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
    muted: 'disabled:text-text-muted disabled:bg-transparent',
  },
} as const;

// Tailwind类组合预设
export const tailwindPresets = {
  // 主要按钮
  buttonPrimary: `
    bg-accent-500 text-white
    hover:bg-accent-600
    active:bg-accent-700
    focus:ring-2 focus:ring-accent-500/50
    disabled:bg-accent-500/50 disabled:text-white/50
    transition-all duration-200
  `,
  
  // 次要按钮
  buttonSecondary: `
    bg-white/5 text-text-primary
    hover:bg-white/10 hover:border-white/10
    active:bg-white/15
    focus:ring-2 focus:ring-white/20
    disabled:bg-white/5 disabled:text-text-muted
    border border-white/5
    transition-all duration-200
  `,
  
  // 幽灵按钮
  buttonGhost: `
    bg-transparent text-text-secondary
    hover:bg-white/5 hover:text-text-primary
    active:bg-white/10
    focus:ring-2 focus:ring-white/10
    disabled:text-text-muted
    transition-all duration-200
  `,
  
  // 玻璃卡片
  cardGlass: `
    glass-1
    hover:bg-white/5
    hover:border-white/10
    hover:shadow-lg
    hover:-translate-y-1
    active:scale-[0.99]
    transition-all duration-300
  `,
  
  // 输入框
  inputDefault: `
    bg-surface-secondary/50
    border border-white/5
    text-text-primary
    placeholder:text-text-muted
    hover:border-white/10
    focus:border-accent-500/50
    focus:ring-2 focus:ring-accent-500/20
    focus:bg-surface-secondary/80
    transition-all duration-200
  `,
  
  // 可点击列表项
  listItem: `
    hover:bg-white/5
    hover:pl-5
    active:bg-white/10
    focus:ring-2 focus:ring-inset focus:ring-accent-500/20
    transition-all duration-200
  `,
};

// 交互状态检查工具
export const getInteractionState = (
  isDisabled?: boolean,
  isLoading?: boolean,
  isActive?: boolean
) => {
  return {
    isInteractive: !isDisabled && !isLoading,
    className: `
      ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${isLoading ? 'cursor-wait' : ''}
      ${isActive ? 'bg-accent-500/10 border-accent-500/30' : ''}
    `.trim(),
  };
};

export type InteractionColors = typeof interactionColors;
export type InteractionPresets = typeof interactionPresets;
export type InteractionClasses = typeof interactionClasses;
