import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { FolderNode } from '../types';
import { Icons } from './ui/Icon';

interface FolderCardProps {
  folder: FolderNode;
  onClick: (path: string) => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ folder, onClick }) => {

  // Resolve thumbnail URL for cover
  const thumbUrl = useMemo(() => {
    if (!folder.coverMedia) return null;
    
    // Always use API thumbnail if available in server mode
    if (folder.coverMedia.url.startsWith('/media-stream/')) {
            const pathPart = folder.coverMedia.url.split('/media-stream/')[1];
            return `/api/thumbnail?path=${pathPart}`;
    }
    
    // Fallback for client mode or direct video/image
    if (folder.coverMedia.mediaType === 'image') {
        return folder.coverMedia.url;
    }
    return null;
  }, [folder.coverMedia]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="relative group cursor-pointer"
      onClick={() => onClick(folder.path)}
    >
      {/* Stack Effect (Pseudo-cards behind) */}
      <div className="absolute top-1 left-1 w-full h-full bg-gray-200 dark:bg-gray-700 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-1" />
      <div className="absolute top-2 left-2 w-full h-full bg-gray-100 dark:bg-gray-800 rounded-xl opacity-0 group-hover:opacity-60 transition-opacity duration-300 transform translate-y-2" />

      {/* Main Card */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col h-full z-10 transition-all duration-300">
        <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-900 relative overflow-hidden flex items-center justify-center">
          {folder.coverMedia ? (
              folder.coverMedia.mediaType === 'video' ? (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center group-hover:scale-105 transition-transform duration-700">
                      <Icons.Video className="text-white/50 absolute z-10" size={32} />
                       {/* Use thumbnail for video cover if possible */}
                       <img 
                           src={thumbUrl || folder.coverMedia.url} 
                           className="w-full h-full object-cover opacity-60" 
                           alt={folder.name}
                       />
                  </div>
              ) : folder.coverMedia.mediaType === 'audio' ? (
                 <div className="w-full h-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center">
                     <Icons.Music className="text-white" size={48} />
                 </div>
              ) : (
                  <img 
                      src={thumbUrl || folder.coverMedia.url} 
                      alt={folder.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                  />
              )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-800/50">
              <Icons.Folder size={48} strokeWidth={1.5} />
            </div>
          )}
          
          {/* Overlay Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60" />
          
          {/* Count Badge on Image */}
          <div className="absolute bottom-2 right-2 bg-black/40 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-white/10">
              <Icons.Image size={10} />
              {folder.mediaCount}
          </div>
        </div>
        
        <div className="p-3 flex items-start gap-3 bg-white dark:bg-gray-800 transition-colors">
          <div className="bg-primary-50 dark:bg-primary-900/30 p-1.5 rounded-lg text-primary-600 dark:text-primary-400 mt-0.5 transition-colors">
            <Icons.Folder size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate leading-tight" title={folder.name}>{folder.name}</h3>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{folder.mediaCount} items</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};