import React from 'react';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';

export interface BreadcrumbsProps {
  currentPath: string;
  onNavigatePath: (path: string) => void;
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentPath,
  onNavigatePath,
  className = '',
}) => {
  const { t } = useLanguage();

  // 解析路径层级
  const getSegments = () => {
    const segments: { name: string; path: string }[] = [];
    if (!currentPath) return segments;

    const parts = currentPath.split(/[/\\]/).filter((part) => part !== '');
    let lastIndex = 0;

    for (const part of parts) {
      const index = currentPath.indexOf(part, lastIndex);
      if (index !== -1) {
        const endPoint = index + part.length;
        segments.push({
          name: part,
          path: currentPath.substring(0, endPoint),
        });
        lastIndex = endPoint;
      }
    }

    return segments;
  };

  const segments = getSegments();

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center flex-wrap gap-1.5 text-sm text-text-secondary ${className}`}
    >
      {/* 根节点 */}
      <button
        onClick={() => onNavigatePath('')}
        className="flex items-center gap-1 hover:text-accent-500 transition-colors duration-200 focus:outline-none focus:text-accent-500 rounded px-1 py-0.5 hover:bg-white/5"
        title={t('home')}
        aria-label={t('home')}
      >
        <Icons.Home size={16} className="shrink-0" />
        <span className="font-medium">{t('home')}</span>
      </button>

      {/* 子节点 */}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        return (
          <React.Fragment key={`${segment.path}-${index}`}>
            <Icons.ChevronRight
              size={14}
              className="text-text-muted shrink-0 select-none"
              aria-hidden="true"
            />
            {isLast ? (
              <span
                className="font-semibold text-text-primary truncate max-w-[150px] sm:max-w-[240px] px-1 py-0.5"
                aria-current="page"
              >
                {segment.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigatePath(segment.path)}
                className="hover:text-accent-500 hover:bg-white/5 rounded px-1 py-0.5 transition-colors duration-200 focus:outline-none focus:text-accent-500 truncate max-w-[120px] sm:max-w-[180px]"
                title={segment.name}
              >
                {segment.name}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
