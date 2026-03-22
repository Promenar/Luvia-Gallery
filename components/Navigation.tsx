import React from 'react';
import { ViewMode } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { MobileHeader } from './navigation/MobileHeader';
import { Sidebar } from './navigation/Sidebar';

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
  onOpenSettings,
}) => {
  const { t } = useLanguage();
  const isHome = viewMode === 'home';

  const handleNavClick = (mode: ViewMode) => {
    setViewMode(mode);
    // 移动端点击后关闭侧边栏
    if (window.innerWidth < 768) {
      toggleSidebar();
    }
  };

  const handleSettingsClick = () => {
    onOpenSettings();
    // 移动端点击后关闭侧边栏
    if (window.innerWidth < 768) {
      toggleSidebar();
    }
  };

  return (
    <>
      {/* Mobile Header */}
      <MobileHeader
        appTitle={appTitle}
        isHome={isHome}
        isSidebarOpen={isSidebarOpen}
        theme={theme}
        isServerMode={isServerMode}
        onToggleSidebar={toggleSidebar}
        onToggleTheme={toggleTheme}
        onUpload={onUpload}
      />

      {/* Sidebar */}
      <Sidebar
        appTitle={appTitle}
        viewMode={viewMode}
        totalPhotos={totalPhotos}
        theme={theme}
        isServerMode={isServerMode}
        isSidebarOpen={isSidebarOpen}
        isDesktopSidebarOpen={isDesktopSidebarOpen}
        onNavClick={handleNavClick}
        onToggleTheme={toggleTheme}
        onOpenSettings={handleSettingsClick}
        onToggleSidebar={toggleSidebar}
        onToggleDesktopSidebar={toggleDesktopSidebar || (() => {})}
        onUpload={onUpload}
      />
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
