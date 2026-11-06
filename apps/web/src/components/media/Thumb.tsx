import { memo, useMemo, useState } from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import { Play } from 'lucide-react';
import { mediaUrls, type MediaItem, type ThumbSize } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { useWantDimensions } from '@/lib/dimensions';

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const hashCache = new Map<string, string>();
export function thumbhashUrl(m: Pick<MediaItem, 'id' | 'thumbhash'>): string | undefined {
  if (!m.thumbhash) return undefined;
  let u = hashCache.get(m.id);
  if (!u) {
    try {
      u = thumbHashToDataURL(Uint8Array.from(atob(m.thumbhash), (c) => c.charCodeAt(0)));
      hashCache.set(m.id, u);
    } catch { return undefined; }
  }
  return u;
}

/**
 * 是否请求缩略图。契约规定缩略图未生成时请求会同步生成（thumbVersion=0 只表示“尚未生成”），
 * 所以不能以 thumbVersion>0 作为条件，否则新入库的媒体永远停在占位图；音频没有画面，不请求。
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

/** 单个媒体缩略图：ThumbHash 占位 → 懒加载 WebP 缩略图；按钮语义，可键盘打开。 */
export const Thumb = memo(function Thumb({ item, width, height, className, badges = true, onClick, onMouseEnter, selected, lazy = true }: ThumbProps) {
  const [loaded, setLoaded] = useState(false);
  useWantDimensions(item);
  const placeholder = useMemo(() => thumbhashUrl(item), [item]);
  const size = pickThumbSize(Math.max(width, height));
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      aria-label={item.name}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        'group/thumb relative block cursor-zoom-in overflow-hidden rounded-[var(--r1)] bg-sunken',
        // 选中态：强调色描边 + 浅色罩层，密集网格里也醒目
        selected && "outline-2 -outline-offset-2 outline-accent after:pointer-events-none after:absolute after:inset-0 after:bg-accent/25 after:content-['']",
        className,
      )}
      style={{ width, height, backgroundImage: placeholder ? `url(${placeholder})` : undefined, backgroundSize: 'cover' }}
    >
      {canThumb(item) && (
        <img
          src={mediaUrls.thumb(item.id, size, item.thumbVersion)}
          alt=""
          loading={lazy ? 'lazy' : 'eager'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn('size-full object-cover transition-[opacity,transform] duration-300', loaded ? 'opacity-100' : 'opacity-0', selected && 'scale-[.94] rounded-[calc(var(--r1)-2px)]')}
        />
      )}
      {badges && item.mediaType === 'video' && (
        <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-[5px] bg-black/50 px-1.5 py-px text-[11px] font-semibold text-white">
          <Play className="size-2.5 fill-current" strokeWidth={0} />{formatDuration(item.durationSec)}
        </span>
      )}
    </button>
  );
});
