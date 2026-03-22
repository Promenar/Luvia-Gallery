import React from 'react';
import { motion } from 'framer-motion';
import { ViewMode } from '../../types';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { NavItem } from './NavItem';
import { NavSection } from './NavSection';

interface SidebarProps {
  appTitle: string;
  viewMode: ViewMode;
  totalPhotos: number;
  theme: 'light' | 'dark' | 'system';
  isServerMode: boolean;
  isSidebarOpen: boolean;
  isDesktopSidebarOpen: boolean;
  onNavClick: (mode: ViewMode) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleDesktopSidebar: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  appTitle,
  viewMode,
  totalPhotos,
  theme,
  isServerMode,
  isSidebarOpen,
  isDesktopSidebarOpen,
  onNavClick,
  onToggleTheme,
  onOpenSettings,
  onToggleSidebar,
  onToggleDesktopSidebar,
  onUpload,
}) => {
  const { t } = useLanguage();

  const sidebarVariants = {
    expanded: { width: 256 },
    collapsed: { width: 80 }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 md:hidden"
          onClick={onToggleSidebar}
        />
      )}

      <motion.aside
        initial={false}
        animate={{
          x: isSidebarOpen ? 0 : '-100%',
          width: isDesktopSidebarOpen ? 256 : 80,
        }}
        variants={sidebarVariants}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col
          glass-2
          md:!translate-x-0 md:relative
          shadow-xl md:shadow-none
          ${!isSidebarOpen && 'hidden md:flex'}
        `}
      >
        {/* Header */}
        <div className={`
          h-16 flex items-center
          ${isDesktopSidebarOpen ? 'px-6' : 'justify-center px-2'}
          shrink-0 border-b border-white/5
        `}>
          <div className="w-9 h-9 glass-3 rounded-xl flex items-center justify-center shadow-glow shrink-0">
            <div className="w-4 h-4 bg-accent-500 rounded-full shadow-[0_0_12px_rgba(104,197,255,0.8)]" />
          </div>

          {isDesktopSidebarOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-display font-semibold text-lg tracking-tight truncate text-text-primary drop-shadow-sm ml-3 flex-1"
              title={appTitle}
            >
              {appTitle}
            </motion.span>
          )}

          <button
            onClick={onToggleSidebar}
            className="md:hidden ml-auto p-2 text-text-tertiary hover:text-text-primary transition-colors rounded-lg hover:bg-white/5"
          >
            <Icons.Close size={20} />
          </button>

          <motion.button
            onClick={onToggleDesktopSidebar}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={`hidden md:flex p-2 text-text-tertiary hover:text-text-primary transition-colors rounded-lg hover:bg-white/5 ml-auto ${
              !isDesktopSidebarOpen ? 'absolute right-[-12px] top-6 glass-2 rounded-full border border-white/10 shadow-md z-50' : ''
            }`}
            title={isDesktopSidebarOpen ? 'Collapse' : 'Expand'}
          >
            {isDesktopSidebarOpen ? <Icons.Menu size={18} /> : <Icons.ChevronRight size={14} />}
          </motion.button>
        </div>

        {/* Navigation Content */}
        <div className="p-4 flex-1 overflow-y-auto overflow-x-hidden">
          <NavSection title={t('menu')} isExpanded={isDesktopSidebarOpen}>
            <NavItem
              icon={<Icons.Home size={20} />}
              label={t('home')}
              active={viewMode === 'home'}
              onClick={() => onNavClick('home')}
              isExpanded={isDesktopSidebarOpen}
            />
            <NavItem
              icon={<Icons.Heart size={20} className={viewMode === 'favorites' ? 'text-red-500' : ''} />}
              label={t('favorites')}
              active={viewMode === 'favorites'}
              onClick={() => onNavClick('favorites')}
              isExpanded={isDesktopSidebarOpen}
            />
          </NavSection>

          <NavSection title={t('library')} isExpanded={isDesktopSidebarOpen}>
            <NavItem
              icon={<Icons.Image size={20} />}
              label={t('all_photos')}
              active={viewMode === 'all'}
              onClick={() => onNavClick('all')}
              isExpanded={isDesktopSidebarOpen}
              badge={totalPhotos}
            />
            <NavItem
              icon={<Icons.Folder size={20} />}
              label={t('folders')}
              active={viewMode === 'folders'}
              onClick={() => onNavClick('folders')}
              isExpanded={isDesktopSidebarOpen}
            />
          </NavSection>

          <NavSection title={t('system')} isExpanded={isDesktopSidebarOpen}>
            <NavItem
              icon={
                theme === 'system' ? <Icons.Monitor size={20} /> :
                theme === 'dark' ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />
              }
              label={theme === 'system' ? t('follow_system') : (theme === 'dark' ? t('dark_mode') : t('light_mode'))}
              onClick={onToggleTheme}
              isExpanded={isDesktopSidebarOpen}
            />
            <NavItem
              icon={<Icons.Settings size={20} />}
              label={t('settings')}
              onClick={onOpenSettings}
              isExpanded={isDesktopSidebarOpen}
            />
          </NavSection>

          {/* Upload Section (Client Mode) */}
          {!isServerMode && (
            <div className={`mt-8 ${isDesktopSidebarOpen ? 'px-2' : 'flex justify-center'}`}>
              <div className="border-t border-white/5 pt-6">
                <motion.label
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`
                    flex flex-col items-center justify-center gap-2 w-full py-6 rounded-xl
                    border border-white/5 cursor-pointer
                    glass-1 hover:ring-1 hover:ring-accent-500/30
                    text-text-primary
                    ${!isDesktopSidebarOpen && 'border-0 hover:ring-0 py-3'}
                  `}
                >
                  {isDesktopSidebarOpen ? (
                    <>
                      <div className="p-3 rounded-full glass-1 border border-border-default shadow-inner">
                        <Icons.Upload size={20} />
                      </div>
                      <span className="text-sm font-medium">{t('load_folder')}</span>
                    </>
                  ) : (
                    <div className="p-3 rounded-full glass-1 border border-border-default">
                      <Icons.Upload size={20} />
                    </div>
                  )}
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: "true", directory: "" } as any)}
                    onChange={onUpload}
                    className="hidden"
                  />
                </motion.label>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Secondary Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden backdrop-blur-sm bg-black/50"
          onClick={onToggleSidebar}
        />
      )}
    </>
  );
});

Sidebar.displayName = 'Sidebar';
