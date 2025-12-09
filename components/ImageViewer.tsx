import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';

interface ImageViewerProps {
  item: MediaItem | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ item, onClose, onNext, onPrev }) => {
  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!item) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose, onNext, onPrev]);

  if (!item) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center"
        onClick={onClose}
      >
        {/* Controls */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center text-white/80 z-50">
          <div className="flex flex-col max-w-[70%]">
            <span className="font-medium text-lg truncate">{item.name}</span>
            <span className="text-xs opacity-60 truncate">{item.folderPath || 'Root'}</span>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Icons.Close size={24} />
          </button>
        </div>

        {/* Content */}
        <motion.div 
          className="relative w-full h-full flex items-center justify-center p-4 md:p-10"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.mediaType === 'video' ? (
            <video 
              src={item.url}
              controls
              autoPlay
              className="max-w-full max-h-full shadow-2xl rounded-sm focus:outline-none"
            />
          ) : (
            <img
              src={item.url}
              alt={item.name}
              className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
            />
          )}
        </motion.div>

        {/* Navigation Overlays */}
        {onPrev && (
           <button
             className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100"
             onClick={(e) => { e.stopPropagation(); onPrev(); }}
           >
             <Icons.Back size={24} />
           </button>
        )}
        
        {onNext && (
           <button
             className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 rotate-180"
             onClick={(e) => { e.stopPropagation(); onNext(); }}
           >
             <Icons.Back size={24} />
           </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
