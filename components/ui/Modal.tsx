import React, { HTMLAttributes, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './Icon';

// 模态框尺寸类型
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

// 模态框组件Props
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  showClose?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

// 模态框尺寸配置
const modalSizes: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[90vw] max-h-[90vh]',
};

// 合并类名
const cn = (...classes: (string | boolean | undefined)[]) => 
  classes.filter(Boolean).join(' ');

// 动画配置
const overlayAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

const modalAnimation = {
  initial: { opacity: 0, scale: 0.95, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 20 },
  transition: { type: 'spring', stiffness: 300, damping: 30 },
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  showClose = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  children,
  footer,
  className = '',
}) => {
  // ESC键关闭
  React.useEffect(() => {
    if (!closeOnEsc) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, closeOnEsc]);

  // 阻止body滚动
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 遮罩层 */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeOnOverlayClick ? onClose : undefined}
            {...overlayAnimation}
          />

          {/* 模态框 */}
          <motion.div
            className={cn(
              'relative w-full glass-3 rounded-2xl shadow-2xl overflow-hidden',
              'flex flex-col max-h-[85vh]',
              modalSizes[size],
              className
            )}
            onClick={(e) => e.stopPropagation()}
            {...modalAnimation}
          >
            {/* 头部 */}
            {(title || showClose) && (
              <div className="flex items-start justify-between gap-4 p-6 border-b border-white/5">
                <div className="flex-1 min-w-0">
                  {title && (
                    <h2 className="text-xl font-semibold text-text-primary">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="text-sm text-text-secondary mt-1">
                      {description}
                    </p>
                  )}
                </div>
                {showClose && (
                  <button
                    onClick={onClose}
                    className="p-2 -m-2 text-text-tertiary hover:text-text-primary hover:bg-white/10 rounded-full transition-colors"
                  >
                    <Icons.Close size={20} />
                  </button>
                )}
              </div>
            )}

            {/* 内容 */}
            <div className="flex-1 overflow-y-auto p-6">{children}</div>

            {/* 底部 */}
            {footer && (
              <div className="p-6 border-t border-white/5 bg-black/20">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// 确认对话框
export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  loading = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-text-secondary">{message}</p>
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50',
            variant === 'danger'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-accent-500 hover:bg-accent-400 text-white'
          )}
        >
          {loading ? '处理中...' : confirmText}
        </button>
      </div>
    </Modal>
  );
};
