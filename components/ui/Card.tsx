import React, { HTMLAttributes, forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

// 卡片变体类型
export type CardVariant = 'default' | 'glass' | 'elevated' | 'outline' | 'flat';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

// 卡片组件Props
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  variant?: CardVariant;
  padding?: CardPadding;
  hover?: boolean;
  interactive?: boolean;
  active?: boolean;
  children?: React.ReactNode;
}

// 卡片样式配置
const cardVariants: Record<CardVariant, string> = {
  default: 'glass-1 bg-surface-secondary/50 border border-border-default',
  glass: 'glass-1 border border-white/5',
  elevated: 'bg-surface-secondary shadow-xl border border-transparent',
  outline: 'bg-transparent border border-border-default',
  flat: 'bg-surface-tertiary border border-transparent',
};

const cardPaddings: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
  xl: 'p-8',
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      padding = 'md',
      hover = false,
      interactive = false,
      active = false,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseClasses = cn(
      'rounded-xl overflow-hidden',
      'transition-all duration-300 ease-out',
      cardVariants[variant],
      cardPaddings[padding],
      hover && 'hover:-translate-y-0.5 hover:shadow-xl hover:border-border-glow',
      interactive && 'cursor-pointer active:scale-[0.99]',
      active && 'ring-2 ring-accent-500/50 border-border-glow',
      className
    );

    if (interactive) {
      return (
        <motion.div
          ref={ref}
          className={baseClasses}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          {...(props as HTMLMotionProps<'div'>)}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <div ref={ref} className={baseClasses} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// 卡片头部
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  icon,
  children,
  className = '',
  ...props
}) => {
  return (
    <div
      className={cn('flex items-start justify-between gap-4', className)}
      {...props}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div className="flex-1 min-w-0">
          {title && (
            <h3 className="text-lg font-semibold text-text-primary truncate">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
          )}
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

// 卡片内容
export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {}

export const CardContent: React.FC<CardContentProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <div className={cn('mt-4', className)} {...props}>
      {children}
    </div>
  );
};

// 卡片底部
export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'left' | 'center' | 'right' | 'between';
}

export const CardFooter: React.FC<CardFooterProps> = ({
  align = 'right',
  children,
  className = '',
  ...props
}) => {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  };

  return (
    <div
      className={cn('mt-4 pt-4 border-t border-border-default flex items-center gap-3', alignClasses[align], className)}
      {...props}
    >
      {children}
    </div>
  );
};
