import React from 'react';
import { motion } from 'framer-motion';
import { ViewMode } from '../types';
import { Icons } from './ui/Icon';

interface NavigationProps {
  appTitle: string;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  totalPhotos: number;
}

export const Navigation: React.FC<NavigationProps> = ({ 
  appTitle,
  viewMode, 
  setViewMode, 
  onUpload, 
  isSidebarOpen, 
  toggleSidebar,
  totalPhotos
}) => {
  const handleNavClick = (mode: ViewMode) => {
      setViewMode(mode);
      if (window.innerWidth < 768) toggleSidebar();
  };

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-100 z-30 flex items-center px-4 justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={toggleSidebar} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
            <Icons.Menu size={24} />
          </button>
          <span className="font-bold text-xl text-primary-600 tracking-tight truncate max-w-[200px]">{appTitle}</span>
        </div>
        <div className="flex items-center gap-2">
            <label className="p-2 text-primary-600 hover:bg-primary-50 rounded-full cursor-pointer">
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
        className={`fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-100 z-40 flex flex-col md:!translate-x-0 md:!opacity-100 md:relative shadow-xl md:shadow-none ${!isSidebarOpen && 'hidden md:flex'}`}
      >
        <div className="h-16 flex items-center px-6 border-b border-gray-50">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-primary-200 shrink-0">
             <div className="w-4 h-4 bg-white/30 rounded-full" />
          </div>
          <span className="font-bold text-xl text-gray-800 truncate" title={appTitle}>{appTitle}</span>
          <button onClick={toggleSidebar} className="md:hidden ml-auto p-1 text-gray-400">
            <Icons.Close size={20} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <div className="space-y-6">
            
            {/* Library Section */}
            <div>
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Library</p>
                <button
                onClick={() => handleNavClick('all')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    viewMode === 'all' 
                    ? 'bg-primary-50 text-primary-700 font-medium shadow-sm' 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                >
                <Icons.Image size={20} className={viewMode === 'all' ? 'text-primary-600' : 'text-gray-400'} />
                <span>All Photos</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${viewMode === 'all' ? 'bg-white/50 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{totalPhotos}</span>
                </button>
            </div>

            {/* Folders Section */}
            <div>
                <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Organization</p>
                <button
                onClick={() => handleNavClick('folders')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    viewMode === 'folders' 
                    ? 'bg-primary-50 text-primary-700 font-medium shadow-sm' 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                >
                <Icons.Folder size={20} className={viewMode === 'folders' ? 'text-primary-600' : 'text-gray-400'} />
                <span>Folders</span>
                </button>
            </div>

          </div>

          <div className="mt-8 px-4">
            <div className="border-t border-gray-100 pt-6">
                <label className="flex flex-col items-center justify-center gap-2 w-full px-4 py-6 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 text-gray-500 hover:bg-gray-100 hover:border-primary-300 hover:text-primary-600 transition-all cursor-pointer active:scale-95 group">
                    <div className="p-3 bg-white rounded-full shadow-sm group-hover:shadow-md transition-shadow">
                        <Icons.Upload size={20} />
                    </div>
                    <span className="text-sm font-medium">Load Folder</span>
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
        </div>
      </motion.aside>

      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-30 md:hidden backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
};