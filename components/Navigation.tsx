
import React from 'react';
import { motion } from 'framer-motion';
import { ViewMode } from '../types';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface NavigationProps {
  appTitle: string;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isDesktopSidebarOpen?: boolean;
  toggleDesktopSidebar?: () => void;
  totalPhotos: number;
  theme: 'light' | 'dark' | 'system';
  toggleTheme: () => void;
  isServerMode: boolean;
  onOpenSettings: () => void;
}

export const Navigation: React.FC<NavigationProps> = React.memo(({
  appTitle,
  viewMode,
  setViewMode,
  onUpload,
  isSidebarOpen,
  toggleSidebar,
  isDesktopSidebarOpen = true,
  toggleDesktopSidebar,
  totalPhotos,
  theme,
  toggleTheme,
  isServerMode,
  onOpenSettings
}) => {
  const { t } = useLanguage();
  const isHome = viewMode === 'home';

  const handleNavClick = (mode: ViewMode) => {
    setViewMode(mode);
    if (window.innerWidth < 768) toggleSidebar();
  };

  const handleSettingsClick = () => {
    onOpenSettings();
    if (window.innerWidth < 768) toggleSidebar();
  };

  // Modern Glass Audit: Side Dock
  const sidebarBaseClass = "glass-2 z-40";

  const navItemClass = (active: boolean) => {
    const base = isDesktopSidebarOpen ? 'px-4' : 'justify-center px-0';
    if (active) {
      return `${base} glass-1 border border-white/20 text-accent-500 shadow-glow bg-white/10 dark:bg-white/5 font-semibold`;
    }
    return `${base} text-text-secondary hover:text-text-primary hover:bg-white/20 dark:hover:bg-white/10 hover:backdrop-blur-sm border border-transparent transition-all duration-300 transform hover:scale-105`;
  };

  const iconColorClass = (active: boolean) => {
    if (active) return 'text-accent-500 drop-shadow-sm';
    return 'text-text-tertiary group-hover:text-text-primary transition-colors';
  };

  const sectionTitleClass = "text-xs font-bold tracking-widest uppercase text-text-tertiary/80 px-3 my-2 shadow-black/5 drop-shadow-sm";

  const mobileHeaderClass = isHome
    ? "glass-3 border-b border-white/10 text-white fixed top-0 left-0 right-0 z-50 backdrop-blur-xl"
    : "glass-3 border-b border-border-default text-text-primary fixed top-0 left-0 right-0 z-30 backdrop-blur-xl";

  return (
    <>
      <div className={`md:hidden h-16 flex items-center px-4 justify-between transition-colors ${mobileHeaderClass} ${isSidebarOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {isHome && <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent z-[-1]" />}

        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={toggleSidebar} className={`p-2 rounded-full glass-1 border border-border-default transition-colors hover:ring-1 hover:ring-accent-500/40 ${isHome ? 'text-white' : 'text-text-primary'}`}>
            <Icons.Menu size={24} />
          </button>
          <span className={`font-bold text-xl tracking-tight truncate max-w-[200px] ${isHome ? 'text-white drop-shadow-md' : 'text-text-primary'}`}>{appTitle}</span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={toggleTheme} className={`p-2 rounded-full glass-1 border border-border-default transition-colors hover:ring-1 hover:ring-accent-500/40 ${isHome ? 'text-white' : 'text-text-primary'}`}>
            {theme === 'system' ? <Icons.Monitor size={24} /> : (theme === 'dark' ? <Icons.Moon size={24} /> : <Icons.Sun size={24} />)}
          </button>
          {!isServerMode && (
            <label className={`p-2 rounded-full glass-1 border border-border-default cursor-pointer transition-colors hover:ring-1 hover:ring-accent-500/40 ${isHome ? 'text-white' : 'text-text-primary'}`}>
              <Icons.Upload size={24} />
              <input
                type="file"
                multiple
                {...({ webkitdirectory: "true", directory: "" } as any)}
                onChange={onUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {/* Backdrop overlay for mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      <motion.aside
        initial={false}
        animate={{
          x: isSidebarOpen ? 0 : '-100%',
          opacity: isSidebarOpen ? 1 : 0
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col md:!translate-x-0 md:!opacity-100 md:relative shadow-xl md:shadow-none transition-all duration-300 ${!isSidebarOpen && 'hidden md:flex'} ${sidebarBaseClass} ${isDesktopSidebarOpen ? 'w-64' : 'w-20'}`}
      >
        <div className={`h-16 flex items-center ${isDesktopSidebarOpen ? 'px-6' : 'justify-center px-2'} shrink-0 border-b border-white/5 shadow-[0_1px_0_0_rgba(255,255,255,0.02)]`}>
          <div className="w-9 h-9 glass-3 rounded-xl flex items-center justify-center shadow-glow shrink-0">
            <div className="w-4 h-4 bg-accent-500 rounded-full shadow-[0_0_12px_rgba(104,197,255,0.8)]" />
          </div>
          
          {isDesktopSidebarOpen && (
             <span className="font-display font-semibold text-lg tracking-tight truncate text-text-primary drop-shadow-sm ml-3 flex-1" title={appTitle}>{appTitle}</span>
          )}

          <button onClick={toggleSidebar} className="md:hidden ml-auto p-1 text-text-tertiary hover:text-text-primary transition-colors">
            <Icons.Close size={20} />
          </button>

          {toggleDesktopSidebar && (
             <button 
                onClick={toggleDesktopSidebar} 
                className={`hidden md:flex p-1 text-text-tertiary hover:text-text-primary transition-colors ml-auto ${!isDesktopSidebarOpen ? 'absolute right-[-12px] top-6 bg-gray-200 dark:bg-gray-700 rounded-full border border-white/10 shadow-md p-1 z-50 hover:bg-gray-300 dark:hover:bg-gray-600' : ''}`}
                title={isDesktopSidebarOpen ? 'Collapse' : 'Expand'}
             >
                {isDesktopSidebarOpen ? <Icons.Menu size={18} /> : <Icons.ChevronRight size={14} />}
             </button>
          )}
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <div className="space-y-6">

            <div>
              {isDesktopSidebarOpen && (
                 <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('menu')}</p>
              )}
              <button
                onClick={() => handleNavClick('home')}
                title={!isDesktopSidebarOpen ? t('home') : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all mb-2 ${navItemClass(viewMode === 'home')}`}
              >
                <Icons.Home size={20} className={iconColorClass(viewMode === 'home')} />
                {isDesktopSidebarOpen && <span>{t('home')}</span>}
              </button>
              <button
                onClick={() => handleNavClick('favorites')}
                 title={!isDesktopSidebarOpen ? t('favorites') : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all mb-2 ${navItemClass(viewMode === 'favorites')}`}
              >
                <Icons.Heart size={20} className={viewMode === 'favorites' ? 'text-red-500' : (isHome ? 'text-gray-500' : 'text-text-tertiary')} fill={viewMode === 'favorites' ? "currentColor" : "none"} />
                {isDesktopSidebarOpen && <span>{t('favorites')}</span>}
              </button>
            </div>

            <div>
               {isDesktopSidebarOpen && (
                 <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('library')}</p>
               )}
              <button
                onClick={() => handleNavClick('all')}
                 title={!isDesktopSidebarOpen ? t('all_photos') : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all mb-2 ${navItemClass(viewMode === 'all')}`}
              >
                <Icons.Image size={20} className={iconColorClass(viewMode === 'all')} />
                {isDesktopSidebarOpen && (
                    <>
                    <span>{t('all_photos')}</span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border transition-colors ${viewMode === 'all'
                    ? 'bg-accent-500/15 text-text-primary border-border-glow'
                    : 'bg-surface-tertiary/60 text-text-secondary border-border-subtle'
                    }`}>{totalPhotos}</span>
                    </>
                )}
              </button>

              <button
                onClick={() => handleNavClick('folders')}
                 title={!isDesktopSidebarOpen ? t('folders') : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all ${navItemClass(viewMode === 'folders')}`}
              >
                <Icons.Folder size={20} className={iconColorClass(viewMode === 'folders')} />
                {isDesktopSidebarOpen && <span>{t('folders')}</span>}
              </button>
            </div>

            <div>
              {isDesktopSidebarOpen && (
                  <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('system')}</p>
              )}
              <button
                onClick={toggleTheme}
                 title={!isDesktopSidebarOpen ? (theme === 'system' ? t('follow_system') : (theme === 'dark' ? t('dark_mode') : t('light_mode'))) : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-colors mb-2 ${navItemClass(false)}`}
              >
                {theme === 'system' ? <Icons.Monitor size={20} /> : (theme === 'dark' ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />)}
                {isDesktopSidebarOpen && <span>{theme === 'system' ? t('follow_system') : (theme === 'dark' ? t('dark_mode') : t('light_mode'))}</span>}
              </button>
              <button
                onClick={handleSettingsClick}
                 title={!isDesktopSidebarOpen ? t('settings') : undefined}
                className={`w-full flex items-center gap-3 py-3 rounded-xl transition-colors ${navItemClass(false)}`}
              >
                <Icons.Settings size={20} />
                {isDesktopSidebarOpen && <span>{t('settings')}</span>}
              </button>
            </div>

          </div>

          {!isServerMode && (
            <div className={`mt-8 ${isDesktopSidebarOpen ? 'px-4' : 'px-0'}`}>
              <div className="border-t border-white/5 pt-6 shadow-[0_-1px_0_0_rgba(255,255,255,0.02)]">
                <label className={`flex flex-col items-center justify-center gap-2 w-full py-6 rounded-xl border border-white/5 transition-all cursor-pointer active:scale-95 group glass-1 hover:ring-1 hover:ring-accent-500/30 text-text-primary ${!isDesktopSidebarOpen && 'border-0 hover:ring-0 p-0'}`}>
                  <div className={`p-3 rounded-full glass-1 border border-border-default shadow-inner transition-all group-hover:ring-1 group-hover:ring-accent-500/30`}>
                    <Icons.Upload size={20} />
                  </div>
                  {isDesktopSidebarOpen && <span className="text-sm font-medium">{t('load_folder')}</span>}
                  <input
                    type="file"
                    multiple
                    {...({ webkitdirectory: "true", directory: "" } as any)}
                    onChange={onUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </motion.aside >

      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden backdrop-blur-sm bg-overlay-strong"
          onClick={toggleSidebar}
        />
      )
      }
    </>
  );
}, (prev, next) => {
  return (
    prev.viewMode === next.viewMode &&
    prev.isSidebarOpen === next.isSidebarOpen &&
    prev.isDesktopSidebarOpen === next.isDesktopSidebarOpen &&
    prev.theme === next.theme &&
    prev.totalPhotos === next.totalPhotos &&
    prev.appTitle === next.appTitle
  );
});
