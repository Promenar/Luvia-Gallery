import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';

interface MediaCardProps {
  item: MediaItem;
  onClick: (item: MediaItem) => void;
  layout?: 'grid' | 'masonry';
  isVirtual?: boolean;
}

// Memoize the card to prevent re-renders when parent list updates
export const MediaCard: React.FC<MediaCardProps> = React.memo(({ item, onClick, layout, isVirtual }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleMouseEnter = () => {
    if (item.mediaType === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay might be blocked by browser policy
      });
      setIsPlaying(true);
    }
  };

  const handleMouseLeave = () => {
    if (item.mediaType === 'video' && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  // For native masonry, we need the image to dictate height, so no absolute positioning.
  const isGrid = layout === 'grid' || isVirtual;
  
  const containerClasses = isGrid
    ? "relative group cursor-pointer overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 shadow-sm hover:shadow-lg transition-all duration-300 w-full h-full aspect-square"
    : "relative group cursor-pointer overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 shadow-sm hover:shadow-lg transition-all duration-300 mb-4 break-inside-avoid w-full";

  return (
    <motion.div
      // Remove layoutId for performance in large lists if virtual
      layoutId={!isVirtual && layout !== 'masonry' ? `media-${item.id}` : undefined}
      initial={!isVirtual ? { opacity: 0, scale: 0.95 } : { opacity: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      // Disable hover scaling in virtual mode to prevent z-index clipping or performance hits
      whileHover={!isVirtual ? { scale: 1.02 } : {}}
      transition={{ duration: 0.2 }}
      className={containerClasses}
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item.mediaType === 'video' ? (
        <div className={`relative w-full ${isGrid ? 'h-full absolute inset-0' : 'aspect-video'} flex items-center justify-center bg-gray-900`}>
           <video 
             ref={videoRef}
             src={item.url} 
             className="w-full h-full object-cover"
             muted
             preload="metadata"
             playsInline
             loop
           />
           {/* Play Icon Overlay (Hidden when playing) */}
           <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
             <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white group-hover:bg-white/40 transition-colors shadow-lg">
               <Icons.Play size={24} fill="currentColor" className="ml-1" />
             </div>
           </div>
           
           {/* Badge */}
           <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center gap-1 z-10">
             <Icons.Video size={10} />
             <span>VIDEO</span>
           </div>
        </div>
      ) : (
        <img
          src={item.url}
          alt={item.name}
          loading="lazy"
          className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${isGrid ? 'absolute inset-0' : 'block'}`}
        />
      )}
      
      {/* Hover Info Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4 z-20 pointer-events-none">
        <div className="w-full overflow-hidden">
           <p className="text-white text-sm font-medium truncate w-full">{item.name}</p>
           <div className="flex justify-between items-center mt-1">
             <p className="text-white/70 text-[10px] truncate">{(item.size / 1024 / 1024).toFixed(1)} MB</p>
             <p className="text-white/70 text-[10px] uppercase tracking-wide bg-white/10 px-1.5 rounded">{item.type.split('/')[1]}</p>
           </div>
        </div>
      </div>
    </motion.div>
  );
}, (prev, next) => {
    // Custom comparison function for React.memo
    // Only re-render if ID matches (content assumption) or layout/virtual props change
    return prev.item.id === next.item.id && 
           prev.layout === next.layout && 
           prev.isVirtual === next.isVirtual;
});