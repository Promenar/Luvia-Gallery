/**
 * 动画工具和组件
 * 统一管理动画预设、交错效果、动画容器
 */

import React, { ReactNode } from 'react';
import { motion, Variants, Transition } from 'framer-motion';
import { springConfigs, stagger, motionPresets, hoverEffects } from './tokens/animation';

// 重新导出设计令牌
export { springConfigs, stagger, motionPresets, hoverEffects };

// 常用动画变体
export const variants: Record<string, Variants> = {
  // 淡入淡出
  fadeIn: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  },

  // 从下方滑入
  slideUp: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 20 },
  },

  // 从上方滑入
  slideDown: {
    hidden: { opacity: 0, y: -20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  },

  // 从左侧滑入
  slideRight: {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  },

  // 从右侧滑入
  slideLeft: {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
  },

  // 缩放
  scale: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },

  // 缩放(小)
  scaleSm: {
    hidden: { opacity: 0, scale: 0.98 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
  },

  // 弹出
  pop: {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: springConfigs.bouncy,
    },
    exit: { opacity: 0, scale: 0.8 },
  },

  // 展开收缩
  expand: {
    hidden: { opacity: 0, height: 0, overflow: 'hidden' },
    visible: { 
      opacity: 1, 
      height: 'auto',
      transition: { duration: 0.3, ease: 'easeOut' },
    },
    exit: { 
      opacity: 0, 
      height: 0,
      transition: { duration: 0.2, ease: 'easeIn' },
    },
  },

  // 无动画
  none: {
    hidden: {},
    visible: {},
    exit: {},
  },
};

// 默认过渡配置
export const defaultTransition: Transition = {
  type: 'spring',
  ...springConfigs.default,
};

// 交错动画容器Props
export interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
  variant?: keyof typeof variants;
  as?: 'div' | 'ul' | 'ol';
}

// 交错动画容器组件
export const StaggerContainer: React.FC<StaggerContainerProps> = ({
  children,
  className = '',
  staggerDelay = stagger.normal,
  variant = 'fadeIn',
  as = 'div',
}) => {
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
      },
    },
    exit: {
      transition: {
        staggerChildren: staggerDelay / 2,
        staggerDirection: -1,
      },
    },
  };

  const MotionComponent = motion[as];

  return (
    <MotionComponent
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={className}
    >
      {children}
    </MotionComponent>
  );
};

// 交错动画子项Props
export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof variants;
}

// 交错动画子项组件
export const StaggerItem: React.FC<StaggerItemProps> = ({
  children,
  className = '',
  variant = 'fadeIn',
}) => {
  return (
    <motion.div
      variants={variants[variant]}
      transition={defaultTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
};

// 动画容器Props
export interface AnimatedContainerProps {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof variants;
  delay?: number;
  duration?: number;
  as?: keyof typeof motion;
}

// 动画容器组件
export const AnimatedContainer: React.FC<AnimatedContainerProps> = ({
  children,
  className = '',
  variant = 'fadeIn',
  delay = 0,
  duration,
  as = 'div',
}) => {
  const MotionComponent = motion[as] as React.ComponentType<any>;

  const transition: Transition = {
    ...defaultTransition,
    delay,
    ...(duration && { duration }),
  };

  return (
    <MotionComponent
      variants={variants[variant]}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={transition}
      className={className}
    >
      {children}
    </MotionComponent>
  );
};

// 页面过渡组件
export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

export const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  className = '',
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

// 列表交错动画Hook
export const useStaggerAnimation = (itemCount: number, baseDelay = stagger.normal) => {
  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: baseDelay,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { type: 'spring', stiffness: 300, damping: 30 },
    },
  };

  return {
    containerVariants,
    itemVariants,
    totalDuration: itemCount * baseDelay + 300,
  };
};

// 悬浮动画Props
export interface HoverAnimationProps {
  children: ReactNode;
  className?: string;
  effect?: 'lift' | 'scale' | 'liftAndScale' | 'none';
  disabled?: boolean;
}

// 悬浮动画组件
export const HoverAnimation: React.FC<HoverAnimationProps> = ({
  children,
  className = '',
  effect = 'lift',
  disabled = false,
}) => {
  if (disabled || effect === 'none') {
    return <div className={className}>{children}</div>;
  }

  const effectConfig = hoverEffects[effect] || hoverEffects.lift;

  return (
    <motion.div
      whileHover={effectConfig}
      whileTap={hoverEffects.tap}
      className={className}
    >
      {children}
    </motion.div>
  );
};

// 工具函数：生成交错延迟样式
export const getStaggerDelay = (index: number, baseDelay = stagger.normal): number => {
  return index * baseDelay;
};

// 工具函数：生成动画CSS变量
export const getAnimationCSSVariables = (): string => {
  return `
    --animation-duration-fast: 200ms;
    --animation-duration-normal: 300ms;
    --animation-duration-slow: 400ms;
    --animation-easing: cubic-bezier(0.4, 0, 0.2, 1);
    --animation-spring-stiffness: 300;
    --animation-spring-damping: 30;
    --stagger-delay: ${stagger.normal}ms;
  `;
};
