import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'framer-motion';

// 图标按钮变体
export type IconButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'glass';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

// 图标按钮组件Props
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  tooltip?: string;
}

// 图标按钮样式配置
const iconButtonVariants: Record<IconButtonVariant, { base: string; active: string }> = {
  default: {
    base: 'text-text-secondary hover:text-text-primary hover:bg-white/10',
    active: 'text-accent-500 bg-accent-500/10 border-accent-500/30',
  },
  primary: {
    base: 'text-white bg-accent-500 hover:bg-accent-400',
    active: 'text-white bg-accent-600',
  },
  secondary: {
    base: 'glass-1 text-text-primary hover:bg-white/10',
    active: 'glass-1 text-accent-500 bg-accent-500/10',
  },
  ghost: {
    base: 'text-text-tertiary hover:text-text-primary hover:bg-white/5',
    active: 'text-accent-500 bg-accent-500/10',
  },
  outline: {
    base: 'border border-border-default text-text-primary hover:border-border-glow hover:bg-white/5',
    active: 'border-accent-500/50 text-accent-500 bg-accent-500/10',
  },
  danger: {
    base: 'text-text-tertiary hover:text-red-500 hover:bg-red-500/10',
    active: 'text-red-500 bg-red-500/10',
  },
  glass: {
    base: 'glass-1 text-text-primary hover:bg-white/10 border border-white/10',
    active: 'glass-1 text-accent-500 bg-accent-500/10 border-accent-500/30',
  },
};

const iconButtonSizes: Record<IconButtonSize, string> = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant = 'default',
      size = 'md',
      icon,
      active = false,
      badge,
      tooltip,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const variantStyle = iconButtonVariants[variant];
    
    const baseClasses = cn(
      'relative inline-flex items-center justify-center',
      'rounded-full',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-accent-500/30',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      variantStyle.base,
      active && variantStyle.active,
      iconButtonSizes[size],
      className
    );

    const badgeSize = size === 'xs' ? 'w-3 h-3 text-[8px]' : 'w-4 h-4 text-[10px]';

    return (
      <motion.button
        ref={ref}
        className={baseClasses}
        disabled={disabled}
        whileHover={disabled ? {} : { scale: 1.05 }}
        whileTap={disabled ? {} : { scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        title={tooltip}
        {...props}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 rounded-full bg-red-500 text-white font-bold flex items-center justify-center',
              badgeSize
            )}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </motion.button>
    );
  }
);

IconButton.displayName = 'IconButton';

// 按钮组
export interface ButtonGroupProps {
  children: React.ReactNode;
  spacing?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

const buttonGroupSpacings = {
  none: 'gap-0',
  sm: 'gap-1',
  md: 'gap-2',
  lg: 'gap-3',
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  spacing = 'sm',
  className = '',
}) => {
  return (
    <div className={cn('inline-flex items-center', buttonGroupSpacings[spacing], className)}>
      {children}
    </div>
  );
};

// 浮动操作按钮
export interface FloatingActionButtonProps extends IconButtonProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const fabPositions = {
  'bottom-right': 'bottom-6 right-6',
  'bottom-left': 'bottom-6 left-6',
  'top-right': 'top-6 right-6',
  'top-left': 'top-6 left-6',
};

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  position = 'bottom-right',
  className = '',
  ...props
}) => {
  return (
    <IconButton
      className={cn(
        'fixed z-40 shadow-lg',
        fabPositions[position],
        className
      )}
      {...props}
    />
  );
};
