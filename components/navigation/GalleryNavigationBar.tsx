import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../ui/Icon';
import { IconButton, ButtonGroup } from '../ui/IconButton';
import { useLanguage } from '../../contexts/LanguageContext';
import { Breadcrumbs } from './Breadcrumbs';
import { GalleryLocation, GalleryViewMode, GallerySortOption, GalleryLayout, GalleryFilterOption } from '../../navigation/types';

const VISIBLE_LAYOUTS: readonly Extract<GalleryLayout, 'grid' | 'masonry'>[] = ['grid', 'masonry'];

export interface NavigationLabels {
  home?: string;
  all?: string;
  favorites?: string;
  folders?: string;
}

export interface GalleryNavigationBarProps {
  // Existing props (fully compatible)
  currentPath?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigatePath?: (path: string) => void;
  onScrollToTop: () => void;
  compact?: boolean;
  className?: string;

  // Phase 2 props
  location?: GalleryLocation;
  view?: GalleryViewMode;
  folderPath?: string;
  onNavigateView?: (view: GalleryViewMode) => void;
  onOpenMenu?: () => void;
  enableSearchShortcut?: boolean;

  // Search props
  search?: string;
  onSearch?: (query: string) => void;

  // Sort & Layout props
  sort?: GallerySortOption;
  sortOption?: GallerySortOption;
  onSortChange?: (sort: GallerySortOption) => void;

  layout?: GalleryLayout;
  layoutMode?: GalleryLayout;
  onLayoutChange?: (layout: GalleryLayout) => void;

  filter?: GalleryFilterOption;
  onFilterChange?: (filter: GalleryFilterOption) => void;

  // Labels for translation injection
  labels?: NavigationLabels;
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
  location,
  view,
  folderPath,
  onNavigateView,
  onOpenMenu,
  enableSearchShortcut = true,
  search,
  onSearch,
  sort,
  sortOption,
  onSortChange,
  layout,
  layoutMode,
  onLayoutChange,
  filter,
  onFilterChange,
  labels,
}) => {
  const { t, language } = useLanguage();
  const isZh = language === 'zh';

  // State extraction with backward compatibility
  const activeView = location?.view || view || 'folders';

  const activeFolderPath = activeView === 'folders'
    ? (location !== undefined ? location.folderPath : (folderPath !== undefined ? folderPath : (currentPath || '')))
    : '';

  const activeSearch = location !== undefined
    ? location.search
    : (search !== undefined ? search : '');

  const currentSort = location?.sort || sortOption || sort || 'dateDesc';
  const currentLayout = (location?.layout || layoutMode || layout) === 'masonry' ? 'masonry' : 'grid';
  const currentFilter = location?.filter || filter || 'all';

  // Dropdown & Search state
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchDraft, setSearchDraft] = useState(activeSearch);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const navRootRef = useRef<HTMLDivElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContextKey = location?.key ?? `${activeView}:${activeFolderPath}`;
  const closeSearchMode = useCallback(() => {
    setSearchDraft(activeSearch);
    setIsSearchMode(false);
  }, [activeSearch]);

  const closeTransientPanels = useCallback(() => {
    closeSearchMode();
    setIsFilterMenuOpen(false);
    setIsSortMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMobileMoreOpen(false);
  }, [closeSearchMode]);

  const openSearchMode = useCallback(() => {
    setIsFilterMenuOpen(false);
    setIsSortMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMobileMoreOpen(false);
    setIsSearchMode(true);
  }, []);

  const openFilterMenu = useCallback(() => {
    closeSearchMode();
    setIsSortMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMobileMoreOpen(false);
    setIsFilterMenuOpen((prev) => !prev);
  }, [closeSearchMode]);

  const openSortMenu = useCallback(() => {
    closeSearchMode();
    setIsFilterMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMobileMoreOpen(false);
    setIsSortMenuOpen((prev) => !prev);
  }, [closeSearchMode]);

  const openLayoutMenu = useCallback(() => {
    closeSearchMode();
    setIsFilterMenuOpen(false);
    setIsSortMenuOpen(false);
    setIsMobileMoreOpen(false);
    setIsLayoutMenuOpen((prev) => !prev);
  }, [closeSearchMode]);

  const openMobileMoreMenu = useCallback(() => {
    closeSearchMode();
    setIsFilterMenuOpen(false);
    setIsSortMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMobileMoreOpen((prev) => !prev);
  }, [closeSearchMode]);

  // A location transition owns a fresh draft even when the submitted query is unchanged.
  useEffect(() => {
    setSearchDraft(activeSearch);
  }, [activeSearch, searchContextKey, activeView, activeFolderPath]);

  useEffect(() => {
    if (isSearchMode) searchInputRef.current?.focus();
  }, [isSearchMode]);

  // Both responsive instances stay mounted; only the instance visible at the current breakpoint owns the shortcut.
  useEffect(() => {
    if (!enableSearchShortcut) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const desktopMatches = window.matchMedia?.('(min-width: 1024px)').matches ?? !compact;
        const isVisibleShortcutOwner = compact ? !desktopMatches : desktopMatches;
        if (!isVisibleShortcutOwner) return;
        e.preventDefault();
        openSearchMode();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [compact, enableSearchShortcut, openSearchMode]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const root = navRootRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (!target || root.contains(target)) return;
      const activeElement = document.activeElement;
      if (activeElement && root.contains(activeElement) && activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      closeTransientPanels();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeTransientPanels]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeTransientPanels();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeTransientPanels]);

  // Text localizations
  const backText = isZh ? '后退' : 'Go back';
  const forwardText = isZh ? '前进' : 'Go forward';
  const upText = t('go_up') || (isZh ? '返回上级' : 'Go up');
  const toTopText = isZh ? '回到顶部' : 'Scroll to top';

  const getLabel = (key: 'home' | 'all' | 'favorites' | 'folders') => {
    if (labels && labels[key]) return labels[key];
    if (key === 'all') return t('all_photos') || '媒体库';
    return t(key) || key;
  };

  const getSortLabel = (option: GallerySortOption) => {
    switch (option) {
      case 'dateDesc': return t('newest_first') || '最新优先';
      case 'dateAsc': return t('oldest_first') || '最早优先';
      case 'nameAsc': return t('sort_by_name_asc') || '名称 A-Z';
      case 'nameDesc': return t('sort_by_name_desc') || '名称 Z-A';
      case 'random': return t('shuffle_random') || '随机打乱';
      default: return option;
    }
  };

  const getLayoutLabel = (l: GalleryLayout) => {
    switch (l) {
      case 'grid': return isZh ? '网格' : 'Grid';
      case 'masonry': return isZh ? '瀑布流' : 'Masonry';
      case 'timeline': return isZh ? '时间线' : 'Timeline';
      default: return l;
    }
  };

  const getLayoutIcon = (l: GalleryLayout) => {
    switch (l) {
      case 'grid': return <Icons.Grid size={18} />;
      case 'masonry': return <Icons.Masonry size={18} />;
      case 'timeline': return <Icons.List size={18} />;
      default: return <Icons.Grid size={18} />;
    }
  };

  const getFilterIcon = (value: GalleryFilterOption) => {
    if (value === 'image') return <Icons.Image size={16} />;
    if (value === 'video') return <Icons.Video size={16} />;
    if (value === 'audio') return <Icons.Music size={16} />;
    return <Icons.Grid size={16} />;
  };

  const getFilterLabel = (value: GalleryFilterOption) => {
    if (value === 'image') return isZh ? '图片' : 'Images';
    if (value === 'video') return isZh ? '视频' : 'Videos';
    if (value === 'audio') return isZh ? '音频' : 'Audio';
    return isZh ? '全部类型' : 'All types';
  };

  const getSearchScopeLabel = () => {
    if (activeView === 'all') return getLabel('all');
    if (activeView === 'favorites') return getLabel('favorites');
    if (activeView === 'folders') {
      if (activeFolderPath) {
        const parts = activeFolderPath.split(/[/\\]/).filter(Boolean);
        const folderName = parts.length > 0 ? parts[parts.length - 1] : '';
        return folderName ? `${getLabel('folders')}: ${folderName}` : getLabel('folders');
      }
      return getLabel('folders');
    }
    return isZh ? '全局' : 'Global';
  };

  const getAddressSummary = () => {
    if (activeView === 'all') return getLabel('all');
    if (activeView === 'favorites') return getLabel('favorites');
    if (activeView === 'folders') {
      if (activeFolderPath) {
        const parts = activeFolderPath.split(/[/\\]/).filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : getLabel('home');
      }
      return getLabel('folders');
    }
    if (activeView === 'home') return getLabel('home');
    return getLabel('home');
  };

  // Keyboard handlers for search input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearch?.(searchDraft);
      setIsSearchMode(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchMode();
    }
  };

  const handleClearSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchDraft('');
    onSearch?.('');
  };

  const handleClearCommittedSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchDraft('');
    onSearch?.('');
  };

  // Click interceptors
  const handleBackClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (canGoBack) onBack();
  };

  const handleForwardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (canGoForward) onForward();
  };

  const handleUpClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (activeView === 'folders' && activeFolderPath) {
      onUp();
    }
  };

  // --- MOBILE COMPACT MODE ---
  if (compact) {
    return (
    <div
      ref={navRootRef}
      className={`flex items-center justify-between gap-2 p-2 rounded-2xl glass-1 gallery-toolbar-glass border border-white/5 shadow-lg transition-all duration-300 relative isolate ${className}`}
      data-testid="gallery-nav-bar-compact"
    >
        {isSearchMode ? (
          <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
            <span
              className="bg-accent-500/10 text-accent-400 text-xs px-2 py-1 rounded-lg shrink min-w-0 max-w-[34%] truncate font-medium select-none"
              title={getSearchScopeLabel()}
            >
              {getSearchScopeLabel()}
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('search') || '搜索...'}
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted focus:ring-0 min-w-0"
              aria-label={isZh ? '搜索输入框' : 'Search input'}
            />
            {searchDraft && (
              <button
                onClick={handleClearSearch}
                className="w-11 h-11 flex items-center justify-center text-text-tertiary hover:text-text-primary rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 shrink-0"
                aria-label={isZh ? '清空搜索' : 'Clear search'}
              >
                <Icons.Close size={16} />
              </button>
            )}
            <button
              onClick={closeSearchMode}
              className="text-sm text-accent-500 hover:text-accent-400 px-2 min-h-[44px] flex items-center justify-center shrink-0 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-lg"
              aria-label={isZh ? '取消搜索' : 'Cancel search'}
            >
              {isZh ? '取消' : 'Cancel'}
            </button>
          </div>
        ) : (
          <>
            {onOpenMenu && (
              <button
                onClick={onOpenMenu}
                className="w-11 h-11 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 shrink-0"
                aria-label={isZh ? '打开菜单' : 'Open menu'}
              >
                <Icons.Menu size={20} />
              </button>
            )}
            {/* Left: Back button (44px target) */}
            <button
              onClick={handleBackClick}
              disabled={!canGoBack}
              className="w-11 h-11 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 shrink-0"
              aria-label={backText}
              aria-disabled={!canGoBack}
            >
              <Icons.Back size={20} />
            </button>

            {/* Center: Address summary */}
            <div className="flex-1 min-w-0 flex items-center justify-center gap-1">
              <h2
                className="text-base font-bold text-text-primary truncate text-center min-w-0 px-1 select-none"
                title={getAddressSummary()}
              >
                {getAddressSummary()}
              </h2>
              {activeSearch && (
                <button
                  onClick={handleClearCommittedSearch}
                  className="min-h-[44px] min-w-0 max-w-[48%] px-2 flex items-center gap-1 rounded-lg text-xs text-accent-400 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
                  aria-label={isZh ? '清除当前搜索' : 'Clear current search'}
                  title={`${isZh ? '搜索' : 'Search'}：“${activeSearch}”`}
                >
                  <span className="truncate">{isZh ? '搜索' : 'Search'}：“{activeSearch}”</span>
                  <Icons.Close size={14} className="shrink-0" />
                </button>
              )}
            </div>

            {/* Right: Search & More buttons (44px target) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={openSearchMode}
                className="w-11 h-11 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
                aria-label={isZh ? '进入搜索' : 'Enter search'}
              >
                <Icons.Search size={20} />
              </button>

                <div className="relative">
                  <button
                    onClick={openMobileMoreMenu}
                    className="w-11 h-11 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
                    aria-label={isZh ? '更多选项' : 'More options'}
                    aria-haspopup="true"
                  aria-expanded={isMobileMoreOpen}
                >
                  <Icons.More size={20} />
                </button>

                {isMobileMoreOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={closeTransientPanels} data-testid="mobile-more-dismiss-overlay" />
                    <div
                      className="absolute right-0 top-full mt-2 w-56 bg-surface-secondary backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 p-2 z-20 flex flex-col gap-1 max-h-[80vh] overflow-y-auto"
                      role="menu"
                    >
                      {/* Go Up Action */}
                      {activeView === 'folders' && activeFolderPath && (
                        <button
                          onClick={() => {
                            onUp();
                            closeTransientPanels();
                          }}
                          className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40"
                          role="menuitem"
                        >
                          <Icons.Up size={18} />
                          <span>{upText}</span>
                        </button>
                      )}

                      {/* Scroll to Top */}
                        <button
                          onClick={() => {
                            onScrollToTop();
                            closeTransientPanels();
                          }}
                        className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40"
                        role="menuitem"
                      >
                        <Icons.ChevronUp size={18} />
                        <span>{toTopText}</span>
                      </button>

                      <hr className="border-white/5 my-1" />

                      {onFilterChange && (
                        <>
                          <div className="px-3 py-1 text-xs font-semibold text-text-muted select-none">
                            {isZh ? '类型' : 'Type'}
                          </div>
                          {(['all', 'image', 'video', 'audio'] as GalleryFilterOption[]).map((value) => (
                            <button
                              key={value}
                              onClick={() => {
                                onFilterChange(value);
                                closeTransientPanels();
                              }}
                              className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                                currentFilter === value ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                              }`}
                              role="menuitemradio"
                              aria-checked={currentFilter === value}
                            >
                              {getFilterIcon(value)}
                              <span>{getFilterLabel(value)}</span>
                            </button>
                          ))}
                          <hr className="border-white/5 my-1" />
                        </>
                      )}

                      {/* Sort Section */}
                      <div className="px-3 py-1 text-xs font-semibold text-text-muted select-none">
                        {isZh ? '排序' : 'Sort'}
                      </div>
                      {(['dateDesc', 'dateAsc', 'nameAsc', 'nameDesc', 'random'] as GallerySortOption[]).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => {
                                onSortChange?.(opt);
                                closeTransientPanels();
                              }}
                          className={`flex items-center justify-between w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                            currentSort === opt ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                          }`}
                          role="menuitemradio"
                          aria-checked={currentSort === opt}
                        >
                          <span>{getSortLabel(opt)}</span>
                          {currentSort === opt && <Icons.Check size={16} className="text-accent-400" />}
                        </button>
                      ))}

                      <hr className="border-white/5 my-1" />

                      {/* Layout Section */}
                      <div className="px-3 py-1 text-xs font-semibold text-text-muted select-none">
                        {isZh ? '布局' : 'Layout'}
                      </div>
                      {VISIBLE_LAYOUTS.map((mode) => (
                            <button
                              key={mode}
                              onClick={() => {
                                onLayoutChange?.(mode);
                                closeTransientPanels();
                              }}
                          className={`flex items-center justify-between w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                            currentLayout === mode ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                          }`}
                          role="menuitemradio"
                          aria-checked={currentLayout === mode}
                        >
                          <div className="flex items-center gap-2">
                            {getLayoutIcon(mode)}
                            <span>{getLayoutLabel(mode)}</span>
                          </div>
                          {currentLayout === mode && <Icons.Check size={16} className="text-accent-400" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // --- DESKTOP BROWSER-STYLE MODE ---
  const isUpDisabled = activeView !== 'folders' || !activeFolderPath;

  return (
    <div
      ref={navRootRef}
      className={`flex flex-nowrap items-center gap-2 xl:gap-4 w-full min-w-0 p-3 rounded-2xl glass-1 gallery-toolbar-glass border border-white/5 shadow-md transition-all duration-300 relative isolate ${className}`}
      data-testid="gallery-nav-bar-desktop"
    >
      {/* 1. Left Nav buttons: back, forward, go-up */}
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
            disabled={isUpDisabled}
            aria-disabled={isUpDisabled}
            tooltip={upText}
            aria-label={upText}
            variant="ghost"
            size="sm"
          />
        </ButtonGroup>
      </div>

      {/* 2. Center: Dual-mode Address / Search container */}
      {isSearchMode && (
        <div className="fixed inset-0 z-10 bg-transparent" onClick={closeSearchMode} data-testid="search-dismiss-overlay" />
      )}

      <div
        className={`flex-1 min-w-[12rem] bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all duration-200 h-10 px-2 xl:px-3 py-1 flex flex-nowrap items-center justify-between cursor-text focus-within:bg-white/10 focus-within:border-accent-500/50 ${
          isSearchMode ? 'shadow-lg' : ''
        }`}
        data-testid="gallery-omnibox"
        onClick={() => {
          if (!isSearchMode) {
            openSearchMode();
          }
        }}
      >
        {isSearchMode ? (
          <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
            <span className="bg-accent-500/10 text-accent-400 text-xs px-2 py-0.5 rounded-lg shrink-0 font-medium select-none">
              {getSearchScopeLabel()}
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('search') || '搜索 (Ctrl+K)...'}
              className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted focus:ring-0 min-w-0"
              aria-label={isZh ? '搜索输入框' : 'Search input'}
            />
            {searchDraft && (
              <IconButton
                icon={<Icons.Close size={16} />}
                onClick={handleClearSearch}
                aria-label={isZh ? '清空搜索' : 'Clear search'}
                variant="ghost"
                size="sm"
                className="shrink-0"
              />
            )}
            <IconButton
              icon={<Icons.Close size={16} />}
              onClick={(e) => {
                e.stopPropagation();
                closeSearchMode();
              }}
              aria-label={isZh ? '退出搜索' : 'Exit search'}
              variant="ghost"
              size="sm"
              className="shrink-0 text-text-muted hover:text-text-primary"
            />
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-[4rem] overflow-hidden flex items-center">
              <Breadcrumbs
                view={activeView}
                folderPath={activeFolderPath}
                onNavigatePath={onNavigatePath || (() => {})}
                onNavigateView={onNavigateView}
                labels={labels}
              />
            </div>
            {activeSearch && (
              <button
                onClick={handleClearCommittedSearch}
                className="shrink min-w-0 max-w-[7rem] xl:max-w-[12rem] h-8 px-2 flex items-center gap-1 rounded-lg bg-accent-500/10 text-xs text-accent-400 hover:bg-accent-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
                aria-label={isZh ? '清除当前搜索' : 'Clear current search'}
                title={`${isZh ? '搜索' : 'Search'}：“${activeSearch}”`}
              >
                <span className="truncate">{isZh ? '搜索' : 'Search'}：“{activeSearch}”</span>
                <Icons.Close size={14} className="shrink-0" />
              </button>
            )}
            <IconButton
              icon={<Icons.Search size={18} />}
                onClick={(e) => {
                e.stopPropagation();
                openSearchMode();
              }}
              tooltip={isZh ? '搜索 (Ctrl+K)' : 'Search (Ctrl+K)'}
              aria-label={isZh ? '进入搜索' : 'Enter search'}
              variant="ghost"
              size="sm"
              className="shrink-0 ml-2"
            />
          </>
        )}
      </div>

      {/* 3. Right: Sort & Layout controls */}
      <div className="flex items-center gap-2 shrink-0 relative">
        {onFilterChange && (
          <div className="relative">
          <button
              onClick={openFilterMenu}
              className="flex items-center justify-center h-10 w-10 hover:bg-white/10 rounded-xl text-text-secondary hover:text-text-primary transition-all duration-200 border border-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
              aria-label={isZh ? `当前筛选：${getFilterLabel(currentFilter)}` : `Current filter: ${getFilterLabel(currentFilter)}`}
              aria-haspopup="listbox"
              aria-expanded={isFilterMenuOpen}
            >
              {getFilterIcon(currentFilter)}
            </button>
            {isFilterMenuOpen && (
              <>
              <div className="fixed inset-0 z-10" onClick={closeTransientPanels} />
              <div className="absolute right-0 top-full mt-2 w-40 bg-surface-secondary backdrop-blur-2xl rounded-xl shadow-2xl border border-white/10 p-1 z-20" role="listbox">
                  {(['all', 'image', 'video', 'audio'] as GalleryFilterOption[]).map((value) => (
                    <button
                      key={value}
                    onClick={() => {
                      onFilterChange(value);
                      closeTransientPanels();
                    }}
                      className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                        currentFilter === value ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                      }`}
                      role="option"
                      aria-selected={currentFilter === value}
                    >
                      {getFilterIcon(value)}
                      <span>{getFilterLabel(value)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {/* Sort Menu */}
        <div className="relative">
          <button
            onClick={openSortMenu}
            className="flex items-center justify-center gap-1.5 h-10 w-10 xl:w-auto xl:px-3 hover:bg-white/10 rounded-xl text-text-secondary hover:text-text-primary transition-all duration-200 border border-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
            aria-label={isZh ? `当前排序：${getSortLabel(currentSort)}` : `Sort by: ${getSortLabel(currentSort)}`}
            aria-haspopup="listbox"
            aria-expanded={isSortMenuOpen}
          >
            <Icons.Sort size={18} className="shrink-0" />
            <span className="hidden xl:inline text-sm font-medium">{getSortLabel(currentSort)}</span>
          </button>

          {isSortMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeTransientPanels} />
              <div
                className="absolute right-0 top-full mt-2 w-48 bg-surface-secondary backdrop-blur-2xl rounded-xl shadow-2xl border border-white/10 p-1 z-20 animate-in fade-in slide-in-from-top-2 duration-200"
                role="listbox"
              >
                {(['dateDesc', 'dateAsc', 'nameAsc', 'nameDesc', 'random'] as GallerySortOption[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      onSortChange?.(opt);
                      closeTransientPanels();
                    }}
                    className={`flex items-center justify-between w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                      currentSort === opt ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                    }`}
                    role="option"
                    aria-selected={currentSort === opt}
                  >
                    <span>{getSortLabel(opt)}</span>
                    {currentSort === opt && <Icons.Check size={16} className="text-accent-400" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Layout Menu */}
        <div className="relative">
          <button
            onClick={openLayoutMenu}
            className="flex items-center justify-center h-10 w-10 hover:bg-white/10 rounded-xl text-text-secondary hover:text-text-primary transition-all duration-200 border border-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
            aria-label={isZh ? `切换布局（当前：${getLayoutLabel(currentLayout)}）` : `Change layout (current: ${getLayoutLabel(currentLayout)})`}
            aria-haspopup="listbox"
            aria-expanded={isLayoutMenuOpen}
          >
            {getLayoutIcon(currentLayout)}
          </button>

          {isLayoutMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeTransientPanels} />
              <div
                className="absolute right-0 top-full mt-2 w-40 bg-surface-secondary backdrop-blur-2xl rounded-xl shadow-2xl border border-white/10 p-1 z-20 animate-in fade-in slide-in-from-top-2 duration-200"
                role="listbox"
              >
                {VISIBLE_LAYOUTS.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      onLayoutChange?.(mode);
                      closeTransientPanels();
                    }}
                    className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40 ${
                      currentLayout === mode ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20 font-medium' : 'text-text-secondary hover:bg-white/5'
                    }`}
                    role="option"
                    aria-selected={currentLayout === mode}
                  >
                    {getLayoutIcon(mode)}
                    <span>{getLayoutLabel(mode)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
