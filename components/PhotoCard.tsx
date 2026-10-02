import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { MediaItem } from '../types';
import { getAuthHeaders, getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';
import { notify } from './feedback/feedback';
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

// 卡片即照片本身：小圆角、静态暖灰占位（不脉冲），不使用背景模糊与逐张入场动画（暗房影院契约 1.3/1.4）
export const getMediaCardContainerClasses = (isGrid: boolean, _isLoaded: boolean = true): string =>
  `relative group cursor-pointer overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isGrid ? 'w-full h-full aspect-square' : 'w-full break-inside-avoid'}`;

export const getMediaCardHoverAnimation = (
  isVirtual: boolean,
  mediaHoverZoomEnabled: boolean,
): { scale?: number } => !isVirtual && mediaHoverZoomEnabled ? { scale: 1.02 } : {};
// 保留以兼容既有导出；卡片本身已不再做整体缩放，悬停仅轻微放大缩略图（getMediaThumbnailClasses）

export const getMediaThumbnailClasses = (
  isGrid: boolean,
  mediaHoverZoomEnabled: boolean,
  isLoaded: boolean = true,
): string =>
  `absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-500 ease-darkroom motion-reduce:transition-opacity ${isLoaded ? 'opacity-100' : 'opacity-0'} ${mediaHoverZoomEnabled ? 'group-hover:scale-[1.03] motion-reduce:group-hover:scale-100 ' : ''}${isGrid ? '' : 'block'}`;

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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const clearThumbnailRetry = useCallback(() => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const handleThumbnailLoad = useCallback(() => {
    clearThumbnailRetry();
    setIsThumbnailLoaded(true);
  }, [clearThumbnailRetry]);

  // 缓存命中可能早于事件处理器就绪；读取实际解码状态，不能只等待 load 事件。
  const attachThumbnail = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) handleThumbnailLoad();
  }, [handleThumbnailLoad]);

  useEffect(() => clearThumbnailRetry, [clearThumbnailRetry]);

  const handleRepair = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRepairing) return;
    setIsRepairing(true);
    try {
      const res = await fetch('/api/thumb/regenerate', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: item.id })
      });
      if (res.ok) {
        clearThumbnailRetry();
        retryAttemptRef.current = 0;
        setHasError(false);
        setImgError(false);
        setIsThumbnailLoaded(false);
        setRetryQuery(`?t=${Date.now()}`); // Force image reload
      } else {
        notify.error(t('repair_failed'));
      }
    } catch (e) {
      console.error("Repair failed", e);
      notify.error(t('repair_failed'));
    } finally {
      setIsRepairing(false);
    }
  };

  // 保留未附加鉴权参数的来源身份，用于判断是否存在原图回退。
  const usesThumbnail = Boolean(item.thumbnailUrl && item.thumbnailUrl !== item.url)
    || (!item.thumbnailUrl && item.url.startsWith('/media-stream/'));

  const thumbnailSrc = useMemo(() => {
    if (item.mediaType === 'audio') return '';
    if (!item.url) return '';

    let src = '';

    // Prefer explicit thumbnail URL if available
    if (item.thumbnailUrl) {
      src = item.thumbnailUrl;
    }
    else if (item.url.startsWith('/media-stream/')) {
      // Use standard thumbnail endpoint which expects base64 ID (which item.id should be)
      src = `/api/thumb/${encodeURIComponent(item.id)}`;
    }
    // For regular images, use the URL directly as last resort
    else if (item.mediaType === 'image') {
      src = item.url;
    }

    // Append retry query if exists and src is valid
    if (src && retryQuery) {
      const [base, fragment] = src.split('#');
      const withQuery = base + (base.includes('?') ? '&' : '?') + retryQuery.replace('?', '');
      return getAuthUrl(withQuery) + (fragment === undefined ? '' : `#${fragment}`);
    }

    return getAuthUrl(src);
  }, [item.id, item.url, item.mediaType, item.thumbnailUrl, retryQuery]);

  const handleThumbnailError = () => {
    setIsThumbnailLoaded(false);
    if (retryTimerRef.current !== null) return;
    // 短暂失败先退避重试小图，避免滚动时立即并发下载大量原图。
    if (usesThumbnail && retryAttemptRef.current < 2) {
      const attempt = ++retryAttemptRef.current;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRetryQuery(`?retry=${Date.now()}-${attempt}`);
      }, 500 * (2 ** (attempt - 1)));
      return;
    }
    if (item.mediaType === 'image' && usesThumbnail) setHasError(true);
    else setImgError(true);
  };

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
    <div
      role="button"
      tabIndex={0}
      aria-label={item.name}
      className={containerClasses}
      style={isGrid ? undefined : { aspectRatio }}
      data-media-aspect-ratio={aspectRatio}
      data-thumbnail-state={imgError ? 'error' : isThumbnailLoaded ? 'loaded' : 'loading'}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item.mediaType === 'video' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
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
              <img
              key={thumbnailSrc}
              data-media-thumb={item.id}
              ref={attachThumbnail}
              src={thumbnailSrc}
              alt={item.name}
              {...imageLoadingProps}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${isThumbnailLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
              />
            </>
          ) : (
            <div className="w-full h-full bg-muted relative overflow-hidden flex flex-col items-center justify-center text-muted-foreground">
              {imgError ? (
                <>
                  <Icons.Video size={32} />
                  <span className="text-[10px] mt-2 font-mono uppercase font-semibold bg-foreground/10 px-1 rounded-sm">{item.type.split('/')[1] || 'VIDEO'}</span>
                </>
              ) : (
                <div className="absolute inset-0 bg-muted" />
              )}
            </div>
          )}

          <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'} z-20`}>
            <div className="w-11 h-11 bg-black/45 ring-1 ring-white/25 rounded-full flex items-center justify-center text-white group-hover:bg-black/60 transition-colors">
              <Icons.Play size={20} fill="currentColor" className="ml-0.5" />
            </div>
          </div>

          <div className="absolute top-2 right-2 bg-black/55 px-1.5 py-0.5 rounded-sm text-[10px] text-white font-medium flex items-center gap-1 z-20">
            <Icons.Video size={10} />
            <span>{t('video_badge')}</span>
          </div>
        </div>
      ) : (
        !imgError && !hasError ? (
          <>
            <img
              key={thumbnailSrc}
              data-media-thumb={item.id}
              ref={attachThumbnail}
              src={thumbnailSrc}
              alt={item.name}
              {...imageLoadingProps}
              className={getMediaThumbnailClasses(isGrid, mediaHoverZoomEnabled, isThumbnailLoaded)}
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          </>
        ) : (
          // Fallback Rendering
          !imgError ? (
            <div className="relative w-full h-full">
              <img
                ref={attachThumbnail}
                src={getAuthUrl(item.url)} // Use original URL
                alt={item.name}
                {...imageLoadingProps}
                className={getMediaThumbnailClasses(isGrid, mediaHoverZoomEnabled, isThumbnailLoaded)}
                onLoad={handleThumbnailLoad}
                onError={() => setImgError(true)}
              />
              {/* Repair Button / Warning Indicator */}
              <button
                onClick={(e) => {
                  handleRepair(e);
                }}
                aria-label={t('repair_thumbnail')}
                className={`absolute top-2 right-2 bg-primary text-primary-foreground p-1 rounded-full shadow-md z-30 transition-colors hover:bg-primary/85 ${isRepairing ? 'animate-spin' : ''}`}
                title={t('repair_thumbnail')}
              >
                {isRepairing ? <Icons.Loader size={14} /> : <Icons.AlertTriangle size={14} />}
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground">
              <Icons.Image size={32} />
              <span className="text-[10px] mt-2 font-mono uppercase font-semibold bg-foreground/10 px-1 rounded-sm">{item.type.split('/')[1] || 'IMG'}</span>
            </div>
          )
        )
      )}

      {/* Heart Icon Overlay */}
      {item.isFavorite && (
        <div className="absolute top-2 left-2 z-30 text-red-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" aria-hidden="true">
          <Icons.Heart size={20} fill="currentColor" />
        </div>
      )}

      {/* Hover Info Overlay */}
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300 flex items-end p-3 z-30 pointer-events-none">
        <div className="w-full overflow-hidden">
          <p className="text-white text-sm font-medium truncate w-full">{item.name}</p>
          <div className="flex justify-between items-center mt-1">
            <p className="text-white/70 text-[10px] truncate">{(item.size / 1024 / 1024).toFixed(1)} MB</p>
            <p className="text-white/70 text-[10px] uppercase tracking-wide">{item.type.split('/')[1]}</p>
          </div>
        </div>
      </div>
    </div>
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
  // 来源切换时同步重建状态，避免被动 effect 把已完成的 load 覆盖成 loading。
  return <VisualMediaCard key={JSON.stringify([props.item.id, props.item.url, props.item.thumbnailUrl, props.item.mediaType])} {...props} />;
};

export const MediaCard: React.FC<MediaCardProps> = React.memo(MediaCardByType, areMediaCardPropsEqual);
