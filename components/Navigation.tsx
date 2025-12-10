
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
  totalPhotos: number;
  theme: 'light' | 'dark' | 'system';
  toggleTheme: () => void;
  isServerMode: boolean;
  onOpenSettings: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ 
  appTitle,
  viewMode, 
  setViewMode, 
  onUpload, 
  isSidebarOpen, 
  toggleSidebar,
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

  // Force Dark Mode styling for sidebar when on Home to match the dark aesthetic
  const sidebarBaseClass = isHome 
      ? "bg-gray-900 border-r border-gray-800 text-gray-100" 
      : "bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-100";

  const navItemClass = (active: boolean) => {
      // When on Home, use standard Dark Mode active/inactive styles
      if (isHome) {
          return active 
              ? 'bg-primary-900/30 text-primary-400 font-medium shadow-sm'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200';
      }
      return active 
          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium shadow-sm'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800';
  };
  
  const iconColorClass = (active: boolean) => {
      if (isHome) return active ? 'text-primary-400' : 'text-gray-500';
      return active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500';
  };
  
  const sectionTitleClass = isHome ? "text-gray-500" : "text-gray-400 dark:text-gray-500";
  
  // Mobile header remains transparent on Home to overlay the image
  const mobileHeaderClass = isHome 
      ? "bg-transparent border-none text-white absolute top-0 left-0 right-0 z-50 pointer-events-none" 
      : "bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 shadow-sm transition-colors relative z-30";

  return (
    <>
      {/* Mobile Header */}
      <div className={`md:hidden h-16 flex items-center px-4 justify-between transition-colors ${mobileHeaderClass}`}>
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={toggleSidebar} className={`p-2 rounded-full transition-colors ${isHome ? 'text-white hover:bg-white/10' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            <Icons.Menu size={24} />
          </button>
          <span className={`font-bold text-xl tracking-tight truncate max-w-[200px] ${isHome ? 'text-white' : 'text-primary-600 dark:text-primary-400'}`}>{appTitle}</span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
            <button onClick={toggleTheme} className={`p-2 rounded-full transition-colors ${isHome ? 'text-white hover:bg-white/10' : 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-gray-800'}`}>
                {theme === 'system' ? <Icons.Monitor size={24} /> : (theme === 'dark' ? <Icons.Moon size={24} /> : <Icons.Sun size={24} />)}
            </button>
            {!isServerMode && (
              <label className={`p-2 rounded-full cursor-pointer transition-colors ${isHome ? 'text-white hover:bg-white/10' : 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-gray-800'}`}>
                  <Icons.Upload size={24} />
                  <input
                      type="file"
                      multiple
                      webkitdirectory="true"
                      directory=""
                      onChange={onUpload}
                      className="hidden"
                  />
              </label>
            )}
        </div>
      </div>

      {/* Sidebar (Desktop & Mobile Drawer) */}
      <motion.aside
        initial={false}
        animate={{ 
          x: isSidebarOpen ? 0 : '-100%',
          opacity: isSidebarOpen ? 1 : 0 
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`fixed inset-y-0 left-0 w-64 z-40 flex flex-col md:!translate-x-0 md:!opacity-100 md:relative shadow-xl md:shadow-none transition-colors ${!isSidebarOpen && 'hidden md:flex'} ${sidebarBaseClass}`}
      >
        <div className={`h-16 flex items-center px-6 shrink-0 ${isHome ? 'border-gray-800 border-b' : 'border-b border-gray-50 dark:border-gray-800'}`}>
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-primary-200 dark:shadow-none shrink-0">
             <div className="w-4 h-4 bg-white/30 rounded-full" />
          </div>
          <span className={`font-bold text-xl truncate ${isHome ? 'text-gray-100' : 'text-gray-800 dark:text-gray-100'}`} title={appTitle}>{appTitle}</span>
          <button onClick={toggleSidebar} className={`md:hidden ml-auto p-1 ${isHome ? 'text-gray-400' : 'text-gray-400'}`}>
            <Icons.Close size={20} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <div className="space-y-6">
            
            {/* Main Nav */}
             <div>
                <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('menu')}</p>
                <button
                    onClick={() => handleNavClick('home')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all mb-1 ${navItemClass(viewMode === 'home')}`}
                >
                    <Icons.Home size={20} className={iconColorClass(viewMode === 'home')} />
                    <span>{t('home')}</span>
                </button>
            </div>

            {/* Library Section */}
            <div>
                <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('library')}</p>
                <button
                onClick={() => handleNavClick('all')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all mb-1 ${navItemClass(viewMode === 'all')}`}
                >
                <Icons.Image size={20} className={iconColorClass(viewMode === 'all')} />
                <span>{t('all_photos')}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full transition-colors ${
                    isHome 
                        ? 'bg-gray-800 text-gray-400'
                        : (viewMode === 'all' ? 'bg-white/50 dark:bg-black/20 text-primary-700 dark:text-primary-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400')
                }`}>{totalPhotos}</span>
                </button>

                <button
                onClick={() => handleNavClick('folders')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${navItemClass(viewMode === 'folders')}`}
                >
                <Icons.Folder size={20} className={iconColorClass(viewMode === 'folders')} />
                <span>{t('folders')}</span>
                </button>
            </div>

            {/* System Section */}
            <div>
                <p className={`px-4 text-xs font-semibold uppercase tracking-wider mb-2 ${sectionTitleClass}`}>{t('system')}</p>
                <button 
                  onClick={toggleTheme}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors mb-1 ${navItemClass(false)}`}
                >
                    {theme === 'system' ? <Icons.Monitor size={20} /> : (theme === 'dark' ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />)}
                    <span>{theme === 'system' ? t('follow_system') : (theme === 'dark' ? t('dark_mode') : t('light_mode'))}</span>
                </button>
                <button 
                  onClick={handleSettingsClick}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${navItemClass(false)}`}
                >
                    <Icons.Settings size={20} />
                    <span>{t('settings')}</span>
                </button>
            </div>

          </div>

          {!isServerMode && (
            <div className="mt-8 px-4">
              <div className={`border-t pt-6 ${isHome ? 'border-gray-800' : 'border-gray-100 dark:border-gray-800'}`}>
                  <label className={`flex flex-col items-center justify-center gap-2 w-full px-4 py-6 rounded-xl border-2 border-dashed transition-all cursor-pointer active:scale-95 group ${
                      isHome 
                        ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:border-gray-600 hover:text-gray-200' 
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary-300 dark:hover:border-primary-600 hover:text-primary-600 dark:hover:text-primary-400'
                  }`}>
                      <div className={`p-3 rounded-full shadow-sm group-hover:shadow-md transition-all ${isHome ? 'bg-gray-700' : 'bg-white dark:bg-gray-700'}`}>
                          <Icons.Upload size={20} />
                      </div>
                      <span className="text-sm font-medium">{t('load_folder')}</span>
                      <input
                          type="file"
                          multiple
                          webkitdirectory="true"
                          directory=""
                          onChange={onUpload}
                          className="hidden"
                      />
                  </label>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 dark:bg-black/50 z-30 md:hidden backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
};
