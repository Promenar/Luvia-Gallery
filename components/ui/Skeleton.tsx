import React, { HTMLAttributes } from 'react';
import { motion } from 'framer-motion';

// 骨架屏变体
export type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'rounded';

// 骨架屏组件Props
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

// 骨架屏动画
const skeletonAnimations = {
  pulse: 'animate-pulse',
  wave: 'skeleton-wave',
  none: '',
};

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'text',
  width,
  height,
  animation = 'pulse',
  className = '',
  style,
  ...props
}) => {
  const variantClasses = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: '',
    rounded: 'rounded-xl',
  };

  return (
    <div
      className={cn(
        'bg-white/10',
        variantClasses[variant],
        skeletonAnimations[animation],
        className
      )}
      style={{
        width: width,
        height: height || (variant === 'text' ? undefined : height),
        ...style,
      }}
      {...props}
    />
  );
};

// 预设骨架屏组件

// 文本骨架屏
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={i === lines - 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  );
};

// 头像骨架屏
export const SkeletonAvatar: React.FC<{ size?: number; className?: string }> = ({
  size = 40,
  className = '',
}) => {
  return (
    <Skeleton
      variant="circular"
      width={size}
      height={size}
      className={className}
    />
  );
};

// 卡片骨架屏
export const SkeletonCard: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  return (
    <div
      className={cn(
        'glass-1 rounded-xl p-4 space-y-3',
        className
      )}
    >
      <Skeleton variant="rounded" height={120} />
      <div className="space-y-2">
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="40%" />
      </div>
    </div>
  );
};

// 图片骨架屏
export const SkeletonImage: React.FC<{
  aspectRatio?: 'square' | 'video' | 'wide';
  className?: string;
}> = ({
  aspectRatio = 'square',
  className = '',
}) => {
  const aspectClasses = {
    square: 'aspect-square',
    video: 'aspect-video',
    wide: 'aspect-[2/1]',
  };

  return (
    <Skeleton
      variant="rounded"
      className={cn(aspectClasses[aspectRatio], 'w-full', className)}
    />
  );
};

// 列表项骨架屏
export const SkeletonListItem: React.FC<{
  showAvatar?: boolean;
  lines?: number;
  className?: string;
}> = ({
  showAvatar = true,
  lines = 2,
  className = '',
}) => {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {showAvatar && <SkeletonAvatar size={40} />}
      <div className="flex-1 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            variant="text"
            width={i === lines - 1 ? '50%' : '100%'}
          />
        ))}
      </div>
    </div>
  );
};

// 画廊骨架屏
export const SkeletonGallery: React.FC<{
  count?: number;
  columns?: number;
  className?: string;
}> = ({
  count = 12,
  columns = 4,
  className = '',
}) => {
  return (
    <div
      className={cn('grid gap-4', className)}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <Skeleton variant="rounded" aspect-ratio="1" className="aspect-square" />
        </motion.div>
      ))}
    </div>
  );
};
