import React from 'react';
import { motion } from 'framer-motion';
import { FolderNode } from '../types';
import { Icons } from './ui/Icon';

interface FolderCardProps {
  folder: FolderNode;
  onClick: (path: string) => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ folder, onClick }) => {
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
      <div className="absolute top-1 left-1 w-full h-full bg-gray-200 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-1" />
      <div className="absolute top-2 left-2 w-full h-full bg-gray-100 rounded-xl opacity-0 group-hover:opacity-60 transition-opacity duration-300 transform translate-y-2" />

      {/* Main Card */}
      <div className="relative bg-white rounded-xl shadow-sm hover:shadow-lg border border-gray-100 overflow-hidden flex flex-col h-full z-10 transition-shadow duration-300">
        <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden flex items-center justify-center">
          {folder.coverMedia ? (
              folder.coverMedia.mediaType === 'video' ? (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center group-hover:scale-105 transition-transform duration-700">
                      <Icons.Video className="text-white/50 absolute z-10" size={32} />
                       <video 
                           src={folder.coverMedia.url} 
                           className="w-full h-full object-cover opacity-60" 
                           muted 
                       />
                  </div>
              ) : (
                  <img 
                      src={folder.coverMedia.url} 
                      alt={folder.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                  />
              )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 bg-gray-50">
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
        
        <div className="p-3 flex items-start gap-3 bg-white">
          <div className="bg-primary-50 p-1.5 rounded-lg text-primary-600 mt-0.5">
            <Icons.Folder size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 truncate leading-tight" title={folder.name}>{folder.name}</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">{folder.mediaCount} items</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};