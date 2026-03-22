import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../contexts/LanguageContext';

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  isExpanded: boolean;
  badge?: number | string;
  className?: string;
}

export const NavItem: React.FC<NavItemProps> = React.memo(({
  icon,
  label,
  active = false,
  onClick,
  isExpanded,
  badge,
  className = '',
}) => {
  const { t } = useLanguage();

  const baseClasses = `
    w-full flex items-center gap-3 py-3 rounded-xl 
    transition-all duration-300 ease-out
    focus:outline-none focus:ring-2 focus:ring-accent-500/30
    ${isExpanded ? 'px-4' : 'justify-center px-0'}
    ${active
      ? 'glass-1 border border-accent-500/30 text-accent-500 shadow-glow bg-accent-500/10 font-semibold'
      : 'text-text-secondary hover:text-text-primary hover:bg-white/10 dark:hover:bg-white/5 border border-transparent'
    }
    ${className}
  `;

  return (
    <motion.button
      onClick={onClick}
      className={baseClasses}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      title={!isExpanded ? label : undefined}
    >
      <span className={`flex-shrink-0 transition-colors ${active ? 'text-accent-500' : 'text-text-tertiary group-hover:text-text-primary'}`}>
        {icon}
      </span>
      
      {isExpanded && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {badge !== undefined && (
            <span className={`
              ml-auto text-xs px-2 py-0.5 rounded-full border transition-colors
              ${active
                ? 'bg-accent-500/15 text-text-primary border-border-glow'
                : 'bg-white/5 text-text-muted border-white/5'
              }
            `}>
              {badge}
            </span>
          )}
        </>
      )}
    </motion.button>
  );
});

NavItem.displayName = 'NavItem';
