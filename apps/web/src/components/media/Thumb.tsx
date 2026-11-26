import { memo, useMemo, useState } from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import { Play } from 'lucide-react';
import { mediaUrls, type MediaItem, type ThumbSize } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { useWantDimensions } from '@/lib/dimensions';
import { thumbMemory } from './thumb-memory';

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const hashCache = new Map<string, string>();
export function thumbhashUrl(m: Pick<MediaItem, 'id' | 'thumbhash'>): string | undefined {
  if (!m.thumbhash) return undefined;
  const key = `${m.id}:${m.thumbhash}`;
  let u = hashCache.get(key);
  if (!u) {
    try {
      u = thumbHashToDataURL(Uint8Array.from(atob(m.thumbhash), (c) => c.charCodeAt(0)));
      hashCache.set(key, u);
    } catch { return undefined; }
  }
  return u;
}

/**
 * 是否请求缩略图。缩略图缺失时请求会触发生成；版本号用于缓存失效，不能代表是否已经生成。
 * 音频没有画面，不请求。
 */
export const canThumb = (m: Pick<MediaItem, 'mediaType'>) => m.mediaType !== 'audio';

/** 按显示尺寸选择缩略图档位（考虑设备像素比）。 */
export function pickThumbSize(displayPx: number): ThumbSize {
  const px = displayPx * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  return px <= 300 ? 's' : px <= 900 ? 'm' : 'l';
}

export interface ThumbProps {
  item: MediaItem;
  width: number;
  height: number;
  className?: string;
  /** 显示视频时长、收藏标记等角标。 */
  badges?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  selected?: boolean;
  /**
   * 使用浏览器原生懒加载。虚拟化网格本身只渲染视口附近的行，应传 false：
   * 原生懒加载在嵌套滚动容器与模拟视口下可能不触发，导致缩略图一直停在占位图。
   */
  lazy?: boolean;
}

/**
 * 单个媒体缩略图：ThumbHash 占位落在内层画幅容器上，确保画册装裱（mat）模式的无酸纸留白干净无溢色；
 * 支持渐进柔焦显影、悬停轻放大与完整键盘可访问性。
 */
export const Thumb = memo(function Thumb({ item, width, height, className, badges = true, onClick, onMouseEnter, selected, lazy = true }: ThumbProps) {
  const [loaded, setLoaded] = useState(false);
  useWantDimensions(item);
  const placeholder = useMemo(() => thumbhashUrl(item), [item]);
  const size = pickThumbSize(Math.max(width, height));
  const src = mediaUrls.thumb(item.id, size, item.thumbVersion);
  const generation = useMemo(() => thumbMemory.generation, [src]);
  const shortDate = item.takenAt ? item.takenAt.slice(0, 10) : '';
  return (
    <button
      type="button"
      data-no-press
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      aria-label={item.name}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        'group/thumb lv-thumb-shell relative block overflow-hidden rounded-[var(--r1)] bg-sunken text-left transition-shadow duration-300',
        selected && "outline-2 -outline-offset-2 outline-accent after:pointer-events-none after:absolute after:inset-0 after:bg-accent/22 after:content-['']",
        className,
      )}
      style={{ width, height }}
    >
      <div
        className={cn(
          'relative size-full overflow-hidden rounded-[inherit] bg-sunken bg-cover bg-center transition-transform duration-200',
          selected && 'scale-[.93] rounded-[calc(var(--r1)-2px)]',
        )}
        style={{ backgroundImage: placeholder ? `url(${placeholder})` : undefined }}
      >
        {canThumb(item) && (
          <img
            key={src}
            src={src}
            alt=""
            loading={lazy ? 'lazy' : 'eager'}
            decoding="async"
            draggable={false}
            onLoad={(event) => { thumbMemory.remember(event.currentTarget, generation); setLoaded(true); }}
            onError={(event) => { thumbMemory.forget(event.currentTarget); setLoaded(false); }}
            className={cn(
              'lv-photo-img size-full object-cover group-hover/thumb:scale-[1.03]',
              loaded && 'is-loaded',
            )}
          />
        )}
        {badges && item.mediaType === 'video' && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/58 px-2 py-0.5 font-mono text-[10.5px] font-medium text-white backdrop-blur-sm">
            <Play className="size-2.5 fill-current" strokeWidth={0} />{formatDuration(item.durationSec)}
          </span>
        )}
      </div>
      <div aria-hidden className="lv-thumb-mat-caption pointer-events-none absolute right-2 bottom-1.5 left-2 items-baseline justify-between gap-2 text-[10.5px] text-muted">
        <span className="truncate font-medium text-fg-2">{item.name}</span>
        {shortDate && <span className="shrink-0 font-mono text-[9.5px]">{shortDate}</span>}
      </div>
    </button>
  );
});
