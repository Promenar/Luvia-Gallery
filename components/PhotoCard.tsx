
import React, { useRef, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface MediaCardProps {
  item: MediaItem;
  onClick: (item: MediaItem) => void;
  layout?: 'grid' | 'masonry';
  isVirtual?: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = React.memo(({ item, onClick, layout, isVirtual }) => {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);

  // Determine thumbnail URL
  const thumbnailSrc = useMemo(() => {
    if (item.mediaType === 'audio') return '';
    if (item.url.startsWith('/media-stream/')) {
        const pathPart = item.url.split('/media-stream/')[1];
        return `/api/thumbnail?path=${pathPart}`;
    }
    if (item.mediaType === 'image') {
        return item.url;
    }
    return '';
  }, [item.url, item.mediaType]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (item.mediaType === 'video') {
      setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
          }
      }, 50);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsVideoLoaded(false); 
    if (item.mediaType === 'video' && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  const isGrid = layout === 'grid' || isVirtual;
  
  const containerClasses = isGrid
    ? "relative group cursor-pointer overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 shadow-sm hover:shadow-lg transition-all duration-300 w-full h-full aspect-square"
    : "relative group cursor-pointer overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 shadow-sm hover:shadow-lg transition-all duration-300 mb-4 break-inside-avoid w-full";

  return (
    <motion.div
      layoutId={!isVirtual && layout !== 'masonry' ? `media-${item.id}` : undefined}
      initial={!isVirtual ? { opacity: 0, scale: 0.95 } : { opacity: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={!isVirtual ? { scale: 1.02 } : {}}
      transition={{ duration: 0.2 }}
      className={containerClasses}
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item.mediaType === 'video' ? (
        <div className={`relative w-full ${isGrid ? 'h-full absolute inset-0' : 'aspect-video'} flex items-center justify-center bg-gray-900`}>
           {isHovered && (
               <video 
                 ref={videoRef}
                 src={item.url} 
                 poster={thumbnailSrc}
                 className={`w-full h-full object-cover absolute inset-0 z-10 transition-opacity duration-500 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
                 muted
                 preload="metadata"
                 playsInline
                 loop
                 onCanPlay={() => setIsVideoLoaded(true)}
               />
           )}
           
           {thumbnailSrc ? (
               <img
                 src={thumbnailSrc}
                 alt={item.name}
                 loading="lazy"
                 className="w-full h-full object-cover block"
               />
           ) : (
               <div className="w-full h-full bg-gray-900 relative overflow-hidden flex items-center justify-center">
                   <div className="absolute inset-0 bg-gradient-to-tr from-gray-900 to-gray-700 opacity-100" />
               </div>
           )}

           <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'} z-20`}>
             <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white group-hover:bg-white/40 transition-colors shadow-lg">
               <Icons.Play size={24} fill="currentColor" className="ml-1" />
             </div>
           </div>
           
           <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center gap-1 z-20">
             <Icons.Video size={10} />
             <span>{t('video_badge')}</span>
           </div>
        </div>
      ) : item.mediaType === 'audio' ? (
        <div className={`relative w-full ${isGrid ? 'h-full absolute inset-0' : 'aspect-square min-h-[150px]'} flex items-center justify-center bg-gradient-to-br from-pink-500 to-orange-400`}>
            <Icons.Music size={48} className="text-white opacity-80" />
            <div className={`absolute top-2 right-2 bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center gap-1 z-10`}>
             <Icons.Music size={10} />
             <span>{t('audio_badge')}</span>
           </div>
        </div>
      ) : (
        <img
          src={thumbnailSrc}
          alt={item.name}
          loading="lazy"
          className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${isGrid ? 'absolute inset-0' : 'block'}`}
        />
      )}
      
      {/* Heart Icon Overlay */}
      {item.isFavorite && (
          <div className="absolute top-2 left-2 z-30 text-red-500 drop-shadow-md">
              <Icons.Heart size={20} fill="currentColor" />
          </div>
      )}

      {/* Hover Info Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4 z-30 pointer-events-none">
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
    return prev.item.id === next.item.id && 
           prev.item.isFavorite === next.item.isFavorite && // Re-render on favorite change
           prev.layout === next.layout && 
           prev.isVirtual === next.isVirtual;
});
