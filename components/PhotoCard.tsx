import React, { useRef, useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MediaItem } from '../types';
import { getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';
import { AudioCard } from './AudioCard';

interface MediaCardProps {
  item: MediaItem;
  onClick: (item: MediaItem) => void;
  layout?: 'grid' | 'masonry';
  isVirtual?: boolean;
}

export const MediaCard: React.FC<MediaCardProps> = React.memo(({ item, onClick, layout, isVirtual }) => {
  const { t } = useLanguage();

  // If it's an audio file, use AudioCard component
  if (item.mediaType === 'audio') {
    return <AudioCard item={item} onClick={onClick} layout={layout || 'grid'} isVirtual={isVirtual} />;
  }

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [retryQuery, setRetryQuery] = useState(''); // Cache busting

  // Reset error when item changes
  useEffect(() => {
    setImgError(false);
    setHasError(false);
    setRetryQuery(''); // Reset retry query on item change
  }, [item.id, item.url]);

  const handleRepair = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRepairing) return;
    setIsRepairing(true);
    try {
      const res = await fetch('/api/thumb/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id })
      });
      if (res.ok) {
        // Reset error state to force reload of thumbnail
        setHasError(false);
        setImgError(false);
        setRetryQuery(`?t=${Date.now()}`); // Force image reload
      } else {
        alert('Repair failed');
      }
    } catch (e) {
      console.error("Repair failed", e);
      alert('Repair failed');
    } finally {
      setIsRepairing(false);
    }
  };

  // Determine thumbnail URL
  // Determine thumbnail URL
  const thumbnailSrc = useMemo(() => {
    if (item.mediaType === 'audio') return '';
    if (!item.url) return '';

    let src = '';

    // Prefer explicit thumbnail URL if available
    if (item.thumbnailUrl) {
      src = item.thumbnailUrl;
    }
    // For images from media-stream
    // For images from media-stream
    else if (item.url.startsWith('/media-stream/')) {
      // Use standard thumbnail endpoint which expects base64 ID (which item.id should be)
      src = `/api/thumb/${item.id}`;
    }
    // For regular images, use the URL directly as last resort
    else if (item.mediaType === 'image') {
      src = item.url;
    }

    // Append retry query if exists and src is valid
    if (src && retryQuery) {
      return getAuthUrl(src + (src.includes('?') ? '&' : '?') + retryQuery.replace('?', ''));
    }

    return getAuthUrl(src);
  }, [item.url, item.mediaType, item.thumbnailUrl, retryQuery]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (item.mediaType === 'video') {
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => { });
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
          {isHovered && !imgError && (
            <video
              ref={videoRef}
              src={getAuthUrl(item.url)}
              poster={thumbnailSrc}
              className={`w-full h-full object-cover absolute inset-0 z-10 transition-opacity duration-500 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
              muted
              preload="metadata"
              playsInline
              loop
              onCanPlay={() => setIsVideoLoaded(true)}
              onError={() => { setIsVideoLoaded(false); }}
            />
          )}

          {!imgError && thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={item.name}
              loading="lazy"
              className="w-full h-full object-cover block"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full bg-gray-800 relative overflow-hidden flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
              {imgError ? (
                <>
                  <Icons.Video size={32} />
                  <span className="text-[10px] mt-2 font-mono uppercase font-bold bg-black/20 px-1 rounded">{item.type.split('/')[1] || 'VIDEO'}</span>
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-tr from-gray-900 to-gray-700 opacity-100" />
              )}
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
      ) : (
        !imgError && !hasError ? (
          <img
            src={thumbnailSrc}
            alt={item.name}
            loading="lazy"
            className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${isGrid ? 'absolute inset-0' : 'block'}`}
            onError={() => {
              // Smart Fallback Logic
              if (item.thumbnailUrl && thumbnailSrc === item.thumbnailUrl) {
                // Start of fallback sequence: Switch to original URL via state
                setHasError(true);
              } else if (thumbnailSrc.startsWith('/api/thumbnail')) { // Corrected from /api/thumb/
                setHasError(true);
              } else {
                // Only error out completely if we were already using the original URL
                setImgError(true);
              }
            }}
          />
        ) : (
          // Fallback Rendering
          !imgError ? (
            <div className="relative w-full h-full">
              <img
                src={getAuthUrl(item.url)} // Use original URL
                alt={item.name}
                loading="lazy"
                className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${isGrid ? 'absolute inset-0' : 'block'}`}
                onError={() => setImgError(true)}
              />
              {/* Repair Button / Warning Indicator */}
              <button
                onClick={(e) => {
                  handleRepair(e);
                }}
                className={`absolute top-2 right-2 bg-yellow-500/90 hover:bg-yellow-400 text-white p-1 rounded-full shadow-lg z-30 transition-transform hover:scale-110 ${isRepairing ? 'animate-spin' : ''}`}
                title="Repair Thumbnail"
              >
                {isRepairing ? <Icons.Loader size={14} /> : <Icons.AlertTriangle size={14} />}
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-200 dark:bg-gray-800 text-gray-400">
              <Icons.Image size={32} />
              <span className="text-[10px] mt-2 font-mono uppercase font-bold bg-black/10 dark:bg-white/10 px-1 rounded">{item.type.split('/')[1] || 'IMG'}</span>
            </div>
          )
        )
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
