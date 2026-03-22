import React from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

interface MobileHeaderProps {
  appTitle: string;
  isHome: boolean;
  isSidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  isServerMode: boolean;
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = React.memo(({
  appTitle,
  isHome,
  isSidebarOpen,
  theme,
  isServerMode,
  onToggleSidebar,
  onToggleTheme,
  onUpload,
}) => {
  const headerClass = isHome
    ? "glass-3 border-b border-white/10 text-white"
    : "glass-3 border-b border-border-default text-text-primary";

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: isSidebarOpen ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`md:hidden h-16 flex items-center px-4 justify-between transition-colors fixed top-0 left-0 right-0 z-40 ${headerClass}`}
    >
      {isHome && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent z-[-1]" />
      )}

      <div className="flex items-center gap-3">
        <IconButton
          icon={<Icons.Menu size={24} />}
          onClick={onToggleSidebar}
          variant="glass"
          size="md"
          className={isHome ? 'text-white' : 'text-text-primary'}
        />
        <span className={`font-bold text-lg tracking-tight truncate max-w-[200px] ${
          isHome ? 'text-white drop-shadow-md' : 'text-text-primary'
        }`}>
          {appTitle}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <IconButton
          icon={
            theme === 'system' ? <Icons.Monitor size={24} /> :
            theme === 'dark' ? <Icons.Moon size={24} /> : <Icons.Sun size={24} />
          }
          onClick={onToggleTheme}
          variant="glass"
          size="md"
          className={isHome ? 'text-white' : 'text-text-primary'}
        />
        
        {!isServerMode && (
          <label className={`p-2 rounded-full glass-1 border border-border-default cursor-pointer transition-all hover:ring-1 hover:ring-accent-500/40 hover:scale-105 ${isHome ? 'text-white' : 'text-text-primary'}`}>
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
    </motion.div>
  );
});

MobileHeader.displayName = 'MobileHeader';
