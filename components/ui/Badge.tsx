import React, { HTMLAttributes } from 'react';
import { motion } from 'framer-motion';

// 徽章变体类型
export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

// 徽章组件Props
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
}

// 徽章样式配置
const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-text-secondary border border-white/5',
  primary: 'bg-accent-500/15 text-accent-400 border border-accent-500/20',
  secondary: 'bg-surface-tertiary text-text-secondary border border-border-default',
  success: 'bg-green-500/15 text-green-400 border border-green-500/20',
  warning: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  error: 'bg-red-500/15 text-red-400 border border-red-500/20',
  info: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  outline: 'bg-transparent text-text-secondary border border-border-default',
};

const badgeSizes: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'md',
  dot = false,
  icon,
  removable = false,
  onRemove,
  children,
  className = '',
  ...props
}) => {
  return (
    <motion.span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        'transition-colors duration-200',
        badgeVariants[variant],
        badgeSizes[size],
        className
      )}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            variant === 'success' && 'bg-green-400',
            variant === 'warning' && 'bg-yellow-400',
            variant === 'error' && 'bg-red-400',
            variant === 'info' && 'bg-blue-400',
            variant === 'primary' && 'bg-accent-400',
            (!variant || variant === 'default' || variant === 'secondary' || variant === 'outline') && 'bg-text-muted'
          )}
        />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-0.5 -mr-0.5 p-0.5 rounded-full hover:bg-white/10 transition-colors"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </motion.span>
  );
};

// 计数徽章
export interface CountBadgeProps {
  count: number;
  max?: number;
  showZero?: boolean;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

export const CountBadge: React.FC<CountBadgeProps> = ({
  count,
  max = 99,
  showZero = false,
  variant = 'error',
  size = 'sm',
  className = '',
}) => {
  if (count === 0 && !showZero) return null;

  const displayCount = count > max ? `${max}+` : count;

  return (
    <Badge variant={variant} size={size} className={cn('min-w-[18px] justify-center', className)}>
      {displayCount}
    </Badge>
  );
};

// 状态徽章
export type StatusType = 'online' | 'offline' | 'away' | 'busy';

export interface StatusBadgeProps {
  status: StatusType;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, { color: string; label: string }> = {
  online: { color: 'bg-green-500', label: '在线' },
  offline: { color: 'bg-gray-400', label: '离线' },
  away: { color: 'bg-yellow-500', label: '离开' },
  busy: { color: 'bg-red-500', label: '忙碌' },
};

const statusSizes = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showLabel = false,
  className = '',
}) => {
  const config = statusConfig[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full ring-2 ring-surface-primary',
          config.color,
          statusSizes[size]
        )}
      />
      {showLabel && (
        <span className="text-xs text-text-secondary">{config.label}</span>
      )}
    </span>
  );
};
