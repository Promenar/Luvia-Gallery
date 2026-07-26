import React from 'react';
import { Icons } from '../ui/Icon';
import { IconButton, ButtonGroup } from '../ui/IconButton';
import { useLanguage } from '../../contexts/LanguageContext';
import { Breadcrumbs } from './Breadcrumbs';

export interface GalleryNavigationBarProps {
  currentPath: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigatePath: (path: string) => void;
  onScrollToTop: () => void;
  compact?: boolean;
  className?: string;
}

export const GalleryNavigationBar: React.FC<GalleryNavigationBarProps> = ({
  currentPath,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onUp,
  onNavigatePath,
  onScrollToTop,
  compact = false,
  className = '',
}) => {
  const { t, language } = useLanguage();
  const isZh = language === 'zh';

  // 国际化兜底
  const backText = isZh ? '后退' : 'Go back';
  const forwardText = isZh ? '前进' : 'Go forward';
  const upText = t('go_up') || (isZh ? '返回上级' : 'Go up');
  const toTopText = isZh ? '回到顶部' : 'Scroll to top';

  // 提取当前目录标题
  const getCurrentDirectoryName = () => {
    if (!currentPath) return t('home');
    const parts = currentPath.split(/[/\\]/).filter((p) => p !== '');
    return parts.length > 0 ? parts[parts.length - 1] : t('home');
  };

  const currentDirName = getCurrentDirectoryName();

  // 统一的禁用点击拦截器
  const handleBackClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (canGoBack) {
      onBack();
    }
  };

  const handleForwardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (canGoForward) {
      onForward();
    }
  };

  const handleUpClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (currentPath) {
      onUp();
    }
  };

  if (compact) {
    // 移动 Web compact 模式
    return (
      <div
        className={`flex flex-col gap-3 p-3 rounded-2xl glass-1 border border-white/5 shadow-lg transition-all duration-300 ${className}`}
        data-testid="gallery-nav-bar-compact"
      >
        {/* 第一行：返回、当前目录、回到顶部 */}
        <div className="flex items-center justify-between w-full gap-2">
          <IconButton
            icon={<Icons.Back size={20} />}
            onClick={handleBackClick}
            disabled={!canGoBack}
            aria-disabled={!canGoBack}
            tooltip={backText}
            aria-label={backText}
            variant="ghost"
            size="sm"
            className="shrink-0"
          />

          <h2
            className="text-base font-bold text-text-primary truncate text-center flex-1 px-2"
            title={currentDirName}
          >
            {currentDirName}
          </h2>

          <IconButton
            icon={<Icons.ChevronUp size={20} />}
            onClick={onScrollToTop}
            tooltip={toTopText}
            aria-label={toTopText}
            variant="ghost"
            size="sm"
            className="shrink-0"
          />
        </div>

        {/* 第二行：横向可滚动面包屑 */}
        <div className="w-full overflow-x-auto scrollbar-none flex items-center py-0.5">
          <Breadcrumbs
            currentPath={currentPath}
            onNavigatePath={onNavigatePath}
            className="whitespace-nowrap flex-nowrap"
          />
        </div>
      </div>
    );
  }

  // 桌面模式
  return (
    <div
      className={`flex items-center justify-between gap-4 p-3 rounded-2xl glass-1 border border-white/5 shadow-md transition-all duration-300 ${className}`}
      data-testid="gallery-nav-bar-desktop"
    >
      {/* 左侧：后退、前进、上一级 按钮组 */}
      <div className="flex items-center gap-2 shrink-0">
        <ButtonGroup spacing="sm">
          <IconButton
            icon={<Icons.Back size={18} />}
            onClick={handleBackClick}
            disabled={!canGoBack}
            aria-disabled={!canGoBack}
            tooltip={backText}
            aria-label={backText}
            variant="ghost"
            size="sm"
          />
          <IconButton
            // 引入原生的 ArrowRight，由于 Icons 里没有 ArrowRight，故直接用 ChevronRight 替代或我们用 Lucide-React 的 ChevronRight
            // 也可以使用 Icons.ChevronRight 作为 Forward 按钮，但为了最专业的表现，我们可以使用 Icons.ChevronRight
            icon={<Icons.ChevronRight size={18} />}
            onClick={handleForwardClick}
            disabled={!canGoForward}
            aria-disabled={!canGoForward}
            tooltip={forwardText}
            aria-label={forwardText}
            variant="ghost"
            size="sm"
          />
          <IconButton
            icon={<Icons.Up size={18} />}
            onClick={handleUpClick}
            disabled={!currentPath}
            aria-disabled={!currentPath}
            tooltip={upText}
            aria-label={upText}
            variant="ghost"
            size="sm"
          />
        </ButtonGroup>
      </div>

      {/* 中间：面包屑导航 */}
      <div className="flex-1 min-w-0 overflow-hidden flex items-center">
        <Breadcrumbs currentPath={currentPath} onNavigatePath={onNavigatePath} />
      </div>

      {/* 右侧：回到顶部 */}
      <div className="flex items-center shrink-0">
        <IconButton
          icon={<Icons.ChevronUp size={18} />}
          onClick={onScrollToTop}
          tooltip={toTopText}
          aria-label={toTopText}
          variant="ghost"
          size="sm"
        />
      </div>
    </div>
  );
};
