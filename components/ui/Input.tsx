import React, { InputHTMLAttributes, forwardRef } from 'react';
import { motion } from 'framer-motion';

// 输入框变体类型
export type InputVariant = 'default' | 'filled' | 'glass';
export type InputSize = 'sm' | 'md' | 'lg';

// 输入框组件Props
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: InputVariant;
  size?: InputSize;
  error?: boolean;
  errorMessage?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

// 输入框样式配置
const inputVariants: Record<InputVariant, string> = {
  default: 'bg-surface-secondary border border-border-default focus:border-accent-500/50',
  filled: 'bg-surface-tertiary border border-transparent focus:border-accent-500/30',
  glass: 'bg-white/5 backdrop-blur-md border border-white/10 focus:border-accent-500/30',
};

const inputSizes: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-sm min-h-[32px]',
  md: 'px-4 py-2 text-sm min-h-[40px]',
  lg: 'px-4 py-3 text-base min-h-[48px]',
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = 'default',
      size = 'md',
      error = false,
      errorMessage,
      leftIcon,
      rightIcon,
      fullWidth = true,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseClasses = cn(
      'rounded-xl text-text-primary placeholder:text-text-muted',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-accent-500/20',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      inputVariants[variant],
      inputSizes[size],
      error && 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20',
      fullWidth && 'w-full',
      leftIcon && 'pl-10',
      rightIcon && 'pr-10',
      className
    );

    return (
      <div className={cn('relative', fullWidth && 'w-full')}>
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            {leftIcon}
          </div>
        )}
        <motion.input
          ref={ref}
          className={baseClasses}
          whileFocus={{ scale: 1.005 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
            {rightIcon}
          </div>
        )}
        {error && errorMessage && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 text-xs text-red-500"
          >
            {errorMessage}
          </motion.p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// 文本域组件
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: InputVariant;
  error?: boolean;
  errorMessage?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      variant = 'default',
      error = false,
      errorMessage,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseClasses = cn(
      'px-4 py-2 rounded-xl text-text-primary placeholder:text-text-muted',
      'bg-surface-secondary border border-border-default',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500/50',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      'resize-none',
      error && 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20',
      'w-full',
      className
    );

    return (
      <div className="relative w-full">
        <motion.textarea
          ref={ref}
          className={baseClasses}
          whileFocus={{ scale: 1.002 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          {...props}
        />
        {error && errorMessage && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 text-xs text-red-500"
          >
            {errorMessage}
          </motion.p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
