import { memo, useEffect, useRef, useState } from 'react';
import { Check, Heart } from 'lucide-react';
import { mediaUrls, type MediaItem } from '@luvia/contracts';
import { Thumb } from '@/components/media/Thumb';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { folderLabel } from './timeline';

/** 由页面提供的稳定回调（内部经 ref 转发，避免每次渲染都让图块重绘）。 */
export interface TileApi {
  /** 点击缩略图：选择模式下切换选中，否则打开查看器。 */
  activate: (item: MediaItem, el: HTMLElement, e: React.MouseEvent) => void;
  /** 点击勾选圈。shift 为真时做范围选择。 */
  toggle: (item: MediaItem, shift: boolean) => void;
  /** 触屏长按。 */
  longPress: (item: MediaItem) => void;
}

const LONG_PRESS_MS = 450;
const reduceMotion = () => document.documentElement.dataset.reduceMotion === 'on';

export interface TimelineTileProps {
  item: MediaItem;
  width: number;
  height: number;
  selected: boolean;
  /** 偏好 hoverPreview：悬停时播放视频预览短片。 */
  hoverPreview: boolean;
  api: TileApi;
}

/** 时间线里的单个图块：缩略图 + 悬停渐变与说明 + 勾选圈 + 收藏标记 + 视频悬停预览。 */
export const TimelineTile = memo(function TimelineTile({ item, width, height, selected, hoverPreview, api }: TimelineTileProps) {
  const [previewing, setPreviewing] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | undefined; fired: boolean } | null>(null);
  const canPreview = hoverPreview && item.mediaType === 'video' && item.hasPreview;
  const place = folderLabel(item.folder);

  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(press.current?.timer);
  }, []);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  return (
    <div
      className="group/tile relative flex-none select-none [-webkit-touch-callout:none]"
      style={{ width, height }}
      onMouseEnter={() => {
        setDynamicFrom(item);
        if (canPreview && !reduceMotion()) hoverTimer.current = setTimeout(() => setPreviewing(true), 250);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer.current);
        setPreviewing(false);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        cancelPress();
        const p = { x: e.clientX, y: e.clientY, fired: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
        p.timer = setTimeout(() => {
          p.fired = true;
          navigator.vibrate?.(8);
          api.longPress(item);
        }, LONG_PRESS_MS);
        press.current = p;
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        if (press.current?.fired) e.preventDefault();
      }}
    >
      <Thumb
        item={item}
        width={width}
        height={height}
        selected={selected}
        lazy={false}
        className="max-md:rounded-none"
        onClick={(e) => {
          if (press.current?.fired) {
            press.current = null;
            return;
          }
          api.activate(item, e.currentTarget, e);
        }}
      />
      {previewing && (
        <video
          src={mediaUrls.preview(item.id)}
          muted
          loop
          autoPlay
          playsInline
          aria-hidden
          onError={() => setPreviewing(false)}
          className="pointer-events-none absolute inset-0 size-full rounded-[var(--r1)] object-cover max-md:rounded-none"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[var(--r1)] bg-[linear-gradient(transparent_55%,rgba(0,0,0,.55))] opacity-0 transition-opacity duration-[180ms] group-hover/tile:opacity-100 max-md:rounded-none" />
      {height >= 90 && (
        <div aria-hidden className="pointer-events-none absolute right-[9px] bottom-[7px] left-[9px] truncate text-[12px] leading-[1.3] text-white opacity-0 [text-shadow:0_1px_2px_rgba(0,0,0,.4)] transition-opacity duration-[180ms] group-hover/tile:opacity-100">
          {place && <span className="block truncate">{place}</span>}
          <span className="block truncate">{item.name}</span>
        </div>
      )}
      {item.favorite && (
        <Heart aria-label="已收藏" className="pointer-events-none absolute top-2 left-2 size-[15px] fill-white text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.5)]" strokeWidth={0} />
      )}
      <button
        type="button"
        aria-label={selected ? `取消选择 ${item.name}` : `选择 ${item.name}`}
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          api.toggle(item, e.shiftKey);
        }}
        className={
          'absolute top-2 left-2 grid size-5 place-items-center rounded-full border-2 transition-opacity duration-150 focus-visible:opacity-100 ' +
          (selected
            ? 'border-accent bg-accent text-accent-fg opacity-100'
            : 'border-white/85 bg-black/20 text-transparent opacity-0 group-hover/tile:opacity-100 group-data-[selecting=true]/page:opacity-100')
        }
      >
        <Check className="size-3" strokeWidth={3} />
      </button>
      {selected && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[var(--r1)] shadow-[inset_0_0_0_3px_var(--accent)] max-md:rounded-none" />}
    </div>
  );
});
