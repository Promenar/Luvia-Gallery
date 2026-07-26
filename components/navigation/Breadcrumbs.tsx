import React from 'react';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { GalleryViewMode } from '../../navigation/types';

export interface BreadcrumbsProps {
  currentPath?: string;
  onNavigatePath: (path: string) => void;
  className?: string;

  // Phase 2 props
  view?: GalleryViewMode;
  folderPath?: string;
  onNavigateView?: (view: GalleryViewMode) => void;
  labels?: {
    home?: string;
    all?: string;
    favorites?: string;
    folders?: string;
  };
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentPath,
  onNavigatePath,
  className = '',
  view,
  folderPath,
  onNavigateView,
  labels,
}) => {
  const { t } = useLanguage();

  const activeView = view || 'folders';
  // If view is all or favorites, folderPath is ignored/prohibited.
  // Otherwise, default to folderPath, falling back to currentPath.
  const activeFolderPath = (activeView === 'all' || activeView === 'favorites')
    ? ''
    : (folderPath !== undefined ? folderPath : (currentPath || ''));

  // 解析路径层级
  const getSegments = (path: string) => {
    const segments: { name: string; path: string }[] = [];
    if (!path) return segments;

    const parts = path.split(/[/\\]/).filter((part) => part !== '');
    let lastIndex = 0;

    for (const part of parts) {
      const index = path.indexOf(part, lastIndex);
      if (index !== -1) {
        const endPoint = index + part.length;
        segments.push({
          name: part,
          path: path.substring(0, endPoint),
        });
        lastIndex = endPoint;
      }
    }

    return segments;
  };

  const getLabel = (key: 'home' | 'all' | 'favorites' | 'folders') => {
    if (labels && labels[key]) return labels[key];
    if (key === 'all') return t('all_photos') || '媒体库';
    return t(key) || key;
  };

  // 构建展示节点
  type BreadcrumbNode = { label: string; isLast: boolean; isRoot?: boolean; isViewRoot?: boolean; isEllipsis?: boolean; onClick: () => void };
  const nodes: BreadcrumbNode[] = [];

  // 1. Root node (Home)
  nodes.push({
    label: getLabel('home'),
    isRoot: true,
    isLast: activeView === 'home',
    onClick: () => onNavigateView?.('home'),
  });

  // 2. View specific nodes
  if (activeView === 'all') {
    nodes.push({
      label: getLabel('all'),
      isViewRoot: true,
      isLast: true,
      onClick: () => onNavigateView?.('all'),
    });
  } else if (activeView === 'favorites') {
    nodes.push({
      label: getLabel('favorites'),
      isViewRoot: true,
      isLast: true,
      onClick: () => onNavigateView?.('favorites'),
    });
  } else if (activeView === 'folders') {
    const folderSegments = getSegments(activeFolderPath);
    nodes.push({
      label: getLabel('folders'),
      isViewRoot: true,
      isLast: folderSegments.length === 0,
      onClick: () => {
        onNavigateView?.('folders');
      },
    });

    folderSegments.forEach((seg, index) => {
      nodes.push({
        label: seg.name,
        isLast: index === folderSegments.length - 1,
        onClick: () => onNavigatePath(seg.path),
      });
    });
  }

  const visibleNodes: BreadcrumbNode[] = nodes.length > 4
    ? [
        nodes[0],
        nodes[1],
        { label: '…', isLast: false, isEllipsis: true, onClick: () => undefined },
        nodes[nodes.length - 1],
      ]
    : nodes;

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center flex-nowrap gap-1.5 text-sm text-text-secondary min-w-0 w-full overflow-hidden ${className}`}
    >
      {visibleNodes.map((node, index) => {
        const isLast = node.isLast;

        return (
          <React.Fragment key={`${node.label}-${index}`}>
            {index > 0 && (
              <Icons.ChevronRight
                size={14}
                className="text-text-muted shrink-0 select-none"
                aria-hidden="true"
              />
            )}
            {node.isEllipsis ? (
              <span className="shrink-0 px-1 text-text-muted" aria-hidden="true">…</span>
            ) : isLast ? (
              <span
                className="font-semibold text-text-primary truncate min-w-[4rem] max-w-[150px] sm:max-w-[240px] px-1 py-0.5 flex flex-1 items-center gap-1"
                aria-current="page"
                title={node.label}
              >
                {node.isRoot && <Icons.Home size={16} className="shrink-0" />}
                {node.label}
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  node.onClick();
                }}
                className="shrink-0 flex items-center gap-1 hover:text-accent-500 hover:bg-white/5 rounded px-1 py-0.5 transition-colors duration-200 focus:outline-none focus:text-accent-500 truncate max-w-[120px] sm:max-w-[180px]"
                title={node.label}
                aria-label={node.label}
              >
                {node.isRoot && <Icons.Home size={16} className="shrink-0" />}
                {node.isRoot ? (
                  <span className="hidden xl:inline font-medium">{node.label}</span>
                ) : node.isViewRoot ? (
                  <>
                    <span className="hidden xl:inline">{node.label}</span>
                    <span className="xl:hidden" aria-hidden="true">{node.label.slice(0, 2)}</span>
                  </>
                ) : (
                  <span>{node.label}</span>
                )}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
