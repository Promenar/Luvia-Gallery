import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface NavSectionProps {
  title: string;
  isExpanded: boolean;
  children: React.ReactNode;
  className?: string;
}

export const NavSection: React.FC<NavSectionProps> = React.memo(({
  title,
  isExpanded,
  children,
  className = '',
}) => {
  return (
    <div className={`mb-4 ${className}`}>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 text-xs font-semibold uppercase tracking-wider mb-2 text-text-tertiary/80"
          >
            {title}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
});

NavSection.displayName = 'NavSection';
