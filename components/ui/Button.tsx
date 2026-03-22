import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'framer-motion';

// 按钮变体类型
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// 按钮组件Props
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

// 按钮样式配置
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-500 hover:bg-accent-400 text-white border border-transparent shadow-lg shadow-accent-500/25 hover:shadow-accent-500/40',
  secondary: 'glass-1 hover:bg-white/10 text-text-primary border border-border-default',
  ghost: 'bg-transparent hover:bg-white/10 text-text-secondary hover:text-text-primary border border-transparent',
  outline: 'bg-transparent border border-border-default text-text-primary hover:bg-white/5 hover:border-border-glow',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30',
  success: 'bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/30',
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs gap-1 min-h-[28px]',
  sm: 'px-3 py-1.5 text-sm gap-1.5 min-h-[32px]',
  md: 'px-4 py-2 text-sm gap-2 min-h-[40px]',
  lg: 'px-5 py-2.5 text-base gap-2 min-h-[44px]',
  xl: 'px-6 py-3 text-lg gap-2.5 min-h-[48px]',
};

// 按钮动画配置
const buttonAnimation = {
  whileHover: { scale: 1.02, y: -1 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring', stiffness: 400, damping: 25 },
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      fullWidth = false,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const baseClasses = cn(
      'inline-flex items-center justify-center rounded-xl font-medium',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500/40',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      'backdrop-blur-sm',
      buttonVariants[variant],
      buttonSizes[size],
      fullWidth && 'w-full',
      className
    );

    const iconSize = size === 'xs' ? 12 : size === 'sm' ? 14 : 16;

    return (
      <motion.button
        ref={ref}
        className={baseClasses}
        disabled={isDisabled}
        whileHover={!isDisabled ? buttonAnimation.whileHover : {}}
        whileTap={!isDisabled ? buttonAnimation.whileTap : {}}
        transition={buttonAnimation.transition}
        {...props}
      >
        {loading ? (
          <svg
            className="animate-spin"
            width={iconSize}
            height={iconSize}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 8H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <>
            {icon && <span className="shrink-0">{icon}</span>}
            {children}
          </>
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
