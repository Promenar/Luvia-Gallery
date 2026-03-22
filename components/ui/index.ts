/**
 * UI组件统一导出
 * 所有基础UI组件的统一入口
 */

// 按钮组件
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

// 输入框组件
export { Input, Textarea } from './Input';
export type { InputProps, TextareaProps, InputVariant, InputSize } from './Input';

// 卡片组件
export { Card, CardHeader, CardContent, CardFooter } from './Card';
export type { CardProps, CardHeaderProps, CardContentProps, CardFooterProps, CardVariant, CardPadding } from './Card';

// 模态框组件
export { Modal, ConfirmModal } from './Modal';
export type { ModalProps, ConfirmModalProps, ModalSize } from './Modal';

// 骨架屏组件
export { 
  Skeleton, 
  SkeletonText, 
  SkeletonAvatar, 
  SkeletonCard, 
  SkeletonImage, 
  SkeletonListItem,
  SkeletonGallery 
} from './Skeleton';
export type { SkeletonProps, SkeletonVariant } from './Skeleton';

// 徽章组件
export { Badge, CountBadge, StatusBadge } from './Badge';
export type { BadgeProps, CountBadgeProps, StatusBadgeProps, BadgeVariant, BadgeSize, StatusType } from './Badge';

// 图标按钮组件
export { IconButton, ButtonGroup, FloatingActionButton } from './IconButton';
export type { IconButtonProps, ButtonGroupProps, FloatingActionButtonProps, IconButtonVariant, IconButtonSize } from './IconButton';

// 图标组件
export { Icons } from './Icon';
