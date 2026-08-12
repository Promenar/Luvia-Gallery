import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MediaItem } from '../types';
import { getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';
import { AudioCard } from './AudioCard';

export interface MediaCardProps {
  item: MediaItem;
  onClick: (item: MediaItem) => void;
  layout?: 'grid' | 'masonry';
  isVirtual?: boolean;
  mediaHoverZoomEnabled?: boolean;
  imagePriority?: boolean;
}

const areCardMediaItemsEqual = (prev: MediaItem, next: MediaItem): boolean =>
  prev.id === next.id
  && prev.file === next.file
  && prev.url === next.url
  && prev.thumbnailUrl === next.thumbnailUrl
  && prev.name === next.name
  && prev.path === next.path
  && prev.folderPath === next.folderPath
  && prev.size === next.size
  && prev.type === next.type
  && prev.lastModified === next.lastModified
  && prev.mediaType === next.mediaType
  && prev.sourceId === next.sourceId
  && prev.isFavorite === next.isFavorite
  && prev.width === next.width
  && prev.height === next.height
  && prev.aspectRatio === next.aspectRatio
  && prev.mediaCount === next.mediaCount
  && prev.coverMedia === next.coverMedia
  && prev.children === next.children;

const MIN_MEDIA_ASPECT_RATIO = 0.5;
const MAX_MEDIA_ASPECT_RATIO = 2.4;
const FALLBACK_MEDIA_ASPECT_RATIOS = [0.625, 0.75, 1, 1.25, 1.5, 16 / 9] as const;

const clampMediaAspectRatio = (ratio: number): number =>
  Math.min(MAX_MEDIA_ASPECT_RATIO, Math.max(MIN_MEDIA_ASPECT_RATIO, ratio));

/** 在缩略图尺寸缺失时，使用媒体 ID 生成跨渲染稳定的几何比例。 */
export const resolveMediaAspectRatio = (item: MediaItem): number => {
  if (Number.isFinite(item.aspectRatio) && Number(item.aspectRatio) > 0) {
    return clampMediaAspectRatio(Number(item.aspectRatio));
  }
  if (
    Number.isFinite(item.width)
    && Number.isFinite(item.height)
    && Number(item.width) > 0
    && Number(item.height) > 0
  ) {
    return clampMediaAspectRatio(Number(item.width) / Number(item.height));
  }

  let hash = 0;
  const identity = item.id || item.path || item.name;
  for (let index = 0; index < identity.length; index += 1) {
    hash = ((hash * 31) + identity.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_MEDIA_ASPECT_RATIOS[hash % FALLBACK_MEDIA_ASPECT_RATIOS.length];
};

export const getMediaImageLoadingProps = (imagePriority: boolean) => ({
  loading: imagePriority ? 'eager' as const : 'lazy' as const,
  fetchPriority: imagePriority ? 'high' as const : 'auto' as const,
  decoding: 'async' as const,
});

export const getMediaCardContainerClasses = (isGrid: boolean, isLoaded: boolean = true): string =>
  `relative group cursor-pointer overflow-hidden rounded-2xl ${isLoaded ? 'glass-1 glass-hover ring-1 ring-white/10 dark:ring-white/5' : 'bg-white/[0.045] dark:bg-white/[0.035]'} ${isGrid ? 'w-full h-full aspect-square' : 'w-full break-inside-avoid'}`;

export const getMediaCardHoverAnimation = (
  isVirtual: boolean,
  mediaHoverZoomEnabled: boolean,
): { scale?: number } => !isVirtual && mediaHoverZoomEnabled ? { scale: 1.02 } : {};

export const getMediaThumbnailClasses = (
  isGrid: boolean,
  mediaHoverZoomEnabled: boolean,
  isLoaded: boolean = true,
): string =>
  `absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${mediaHoverZoomEnabled ? 'group-hover:scale-105 ' : ''}${isGrid ? '' : 'block'}`;

export const areMediaCardPropsEqual = (prev: MediaCardProps, next: MediaCardProps): boolean =>
  areCardMediaItemsEqual(prev.item, next.item)
  && prev.onClick === next.onClick
  && prev.layout === next.layout
  && prev.isVirtual === next.isVirtual
  && prev.imagePriority === next.imagePriority
  && prev.mediaHoverZoomEnabled === next.mediaHoverZoomEnabled;

/** 保持传给大量媒体卡片的点击函数稳定，同时始终执行调用方最新的点击语义。 */
export const useStableMediaItemClick = (
  onClick: (item: MediaItem) => void,
): ((item: MediaItem) => void) => {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  return useCallback((item: MediaItem) => onClickRef.current(item), []);
};

const VisualMediaCard: React.FC<MediaCardProps> = ({
  item,
  onClick,
  layout,
  isVirtual = false,
  mediaHoverZoomEnabled = true,
  imagePriority = false,
}) => {
  const { t } = useLanguage();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isThumbnailLoaded, setIsThumbnailLoaded] = useState(false);
  const [retryQuery, setRetryQuery] = useState(''); // Cache busting

  // Reset error when item changes
  useEffect(() => {
    setImgError(false);
    setHasError(false);
    setIsThumbnailLoaded(false);
    setRetryQuery(''); // Reset retry query on item change
  }, [item.id, item.url, item.thumbnailUrl]);

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
      hoverTimeoutRef.current = setTimeout(() => {
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
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (item.mediaType === 'video' && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const isGrid = layout === 'grid' || isVirtual;
  const aspectRatio = resolveMediaAspectRatio(item);
  const imageLoadingProps = getMediaImageLoadingProps(imagePriority);

  const containerClasses = getMediaCardContainerClasses(isGrid, isThumbnailLoaded);

  return (
    <motion.div
      layoutId={!isVirtual && layout !== 'masonry' ? `media-${item.id}` : undefined}
      initial={!isVirtual && layout !== 'masonry' ? { opacity: 0, scale: 0.95 } : { opacity: 1, scale: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={getMediaCardHoverAnimation(isVirtual, mediaHoverZoomEnabled)}
      transition={{ duration: 0.2 }}
      className={containerClasses}
      style={isGrid ? undefined : { aspectRatio }}
      data-media-aspect-ratio={aspectRatio}
      data-thumbnail-state={isThumbnailLoaded ? 'loaded' : 'loading'}
      onClick={() => onClick(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item.mediaType === 'video' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-deep">
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
            <>
              {!isThumbnailLoaded && (
                <div className="absolute inset-0 bg-white/[0.045] dark:bg-white/[0.035] animate-pulse" aria-hidden="true" />
              )}
              <img
              src={thumbnailSrc}
              alt={item.name}
              {...imageLoadingProps}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${isThumbnailLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setIsThumbnailLoaded(true)}
              onError={() => setImgError(true)}
              />
            </>
          ) : (
            <div className="w-full h-full bg-surface-tertiary relative overflow-hidden flex flex-col items-center justify-center text-text-tertiary">
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

          <div className="absolute top-2 right-2 glass-1 bg-overlay-veil px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center gap-1 z-20 border border-border-glow">
            <Icons.Video size={10} />
            <span>{t('video_badge')}</span>
          </div>
        </div>
      ) : (
        !imgError && !hasError ? (
          <>
            {!isThumbnailLoaded && (
              <div className="absolute inset-0 bg-white/[0.045] dark:bg-white/[0.035] animate-pulse" aria-hidden="true" />
            )}
            <img
              src={thumbnailSrc}
              alt={item.name}
              {...imageLoadingProps}
              className={getMediaThumbnailClasses(isGrid, mediaHoverZoomEnabled, isThumbnailLoaded)}
              onLoad={() => setIsThumbnailLoaded(true)}
              onError={() => {
                setIsThumbnailLoaded(false);
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
          </>
        ) : (
          // Fallback Rendering
          !imgError ? (
            <div className="relative w-full h-full">
              <img
                src={getAuthUrl(item.url)} // Use original URL
                alt={item.name}
                {...imageLoadingProps}
                className={getMediaThumbnailClasses(isGrid, mediaHoverZoomEnabled, isThumbnailLoaded)}
                onLoad={() => setIsThumbnailLoaded(true)}
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
            <div className="w-full h-full flex flex-col items-center justify-center bg-surface-tertiary text-text-tertiary">
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4 z-30 pointer-events-none">
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
};

const MediaCardByType: React.FC<MediaCardProps> = (props) => {
  if (props.item.mediaType === 'audio') {
    return (
      <AudioCard
        item={props.item}
        onClick={props.onClick}
        layout={props.layout || 'grid'}
        isVirtual={props.isVirtual}
        mediaHoverZoomEnabled={props.mediaHoverZoomEnabled}
      />
    );
  }
  return <VisualMediaCard {...props} />;
};

export const MediaCard: React.FC<MediaCardProps> = React.memo(MediaCardByType, areMediaCardPropsEqual);
