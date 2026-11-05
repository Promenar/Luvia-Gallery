import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Folder as FolderIcon, Heart, Play } from 'lucide-react';
import { mediaUrls, type Folder, type MediaItem } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { pickThumbSize, thumbhashUrl } from '@/components/media/Thumb';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { useFolderFavorite } from './favorite';

/** 原型 .chip：圆角胶囊按钮；on 为强调色填充。 */
export const chip = (on?: boolean, sm?: boolean) =>
  cn(
    'inline-flex shrink-0 items-center gap-[7px] rounded-full border border-line-2 whitespace-nowrap text-fg-2 transition-colors hover:bg-accent-soft hover:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
    sm ? 'h-[30px] px-[11px] text-[12.5px]' : 'h-[34px] px-[13px] text-[13px]',
    on && 'border-transparent bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg [&_svg.fill-on]:fill-current',
  );

/** 页面标题区（原型 .pagehead）。 */
export function PageHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-x-[18px] gap-y-3 px-4 pt-6 pb-2 md:px-11 md:pt-12', className)}>{children}</div>;
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.02em] break-words md:text-[34px]">{children}</h1>;
}

export const metaText = 'mt-1 text-[13px] text-muted';
export const subhClass = 'mx-0 mt-3.5 mb-1 flex items-center gap-2.5 px-4 text-[15px] font-semibold md:px-11';

/** 卡片封面里的一张图：ThumbHash 占位 + 懒加载缩略图。 */
export function CoverImage({ item, displayPx, className, blur }: { item: MediaItem; displayPx: number; className?: string; blur?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const ph = thumbhashUrl(item);
  return (
    <div className={cn('size-full bg-sunken bg-cover', className)} style={{ backgroundImage: ph ? `url(${ph})` : undefined }}>
      {!blur && item.thumbVersion > 0 && (
        <img
          src={mediaUrls.thumb(item.id, pickThumbSize(displayPx), item.thumbVersion)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn('size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}

const sheet = 'absolute inset-0 overflow-hidden rounded-[var(--r2)] bg-sunken shadow-[0_10px_24px_-12px_rgba(0,0,0,.6)] transition-transform duration-[350ms] ease-[cubic-bezier(.2,.8,.2,1)]';

/**
 * 叠放封面（原型 .stack）：前面是封面缩略图，后面两张是同一封面的模糊色块。
 * 契约的 Folder 只提供一张封面，因此后两张用 ThumbHash 色块代替不同照片。
 */
export function FolderStack({ cover, className, hoverGroup = 'fc' }: { cover: MediaItem | null; className?: string; hoverGroup?: 'fc' | 'libc' }) {
  const h1 = hoverGroup === 'fc'
    ? 'group-hover/fc:[transform:rotate(-12deg)_translate(-22px,2px)_scale(.92)]'
    : 'group-hover/libc:[transform:rotate(-12deg)_translate(-16px,2px)_scale(.92)]';
  const h2 = hoverGroup === 'fc'
    ? 'group-hover/fc:[transform:rotate(11deg)_translate(24px,-2px)_scale(.94)]'
    : 'group-hover/libc:[transform:rotate(11deg)_translate(18px,-2px)_scale(.94)]';
  return (
    <div className={cn('relative aspect-[4/3]', className)} aria-hidden>
      <div className={cn(sheet, '[transform:rotate(-7deg)_translate(-6px,4px)_scale(.92)] brightness-[.72]', h1)}>
        {cover && <CoverImage item={cover} displayPx={0} blur />}
      </div>
      <div className={cn(sheet, '[transform:rotate(6deg)_translate(8px,2px)_scale(.94)] brightness-[.86]', h2)}>
        {cover && <CoverImage item={cover} displayPx={0} blur />}
      </div>
      <div className={cn(sheet, hoverGroup === 'fc' ? 'group-hover/fc:-translate-y-1.5' : 'group-hover/libc:-translate-y-1.5')}>
        {cover ? (
          <CoverImage item={cover} displayPx={300} />
        ) : (
          <div className="grid size-full place-items-center text-muted"><FolderIcon className="size-8" strokeWidth={1.4} /></div>
        )}
      </div>
    </div>
  );
}

export const countText = (mediaCount: number, childCount: number) =>
  `${mediaCount.toLocaleString('zh-CN')} 项${childCount ? `，${childCount} 个子文件夹` : ''}`;

const roundBtn = 'pointer-events-auto absolute grid size-8 place-items-center rounded-full transition-[opacity,transform] duration-150 active:scale-90 [&_svg]:size-4';

/**
 * 文件夹卡片（原型 .fc）：整卡是进入文件夹的链接；右上角心形收藏，
 * 鼠标悬停或键盘聚焦时出现，已收藏时常显；触屏设备上始终显示。
 */
export function FolderCard({ folder, showHostPath, onPlay }: { folder: Folder; showHostPath?: boolean; onPlay?: () => void }) {
  const fav = useFolderFavorite();
  const on = folder.favorite;
  return (
    <div className="group/fc relative min-w-0" onMouseEnter={() => setDynamicFrom(folder.cover)}>
      <Link
        to="/folders"
        search={{ path: folder.path }}
        aria-label={`打开文件夹 ${folder.name}`}
        className="block rounded-[var(--r2)] focus-visible:outline-offset-4"
      >
        <FolderStack cover={folder.cover} className="mx-3 mt-2.5 mb-[18px]" />
        <h3 className="m-0 truncate text-[15px] font-semibold">{folder.name}</h3>
        <p className="m-0 mt-0.5 text-[12.5px] text-muted">{countText(folder.mediaCount, folder.childCount)}</p>
        {showHostPath && folder.hostPath && (
          <p className="m-0 mt-0.5 truncate text-[11.5px] text-muted" title={folder.hostPath}>{folder.hostPath}</p>
        )}
      </Link>
      <div className="pointer-events-none absolute inset-x-3 top-2.5 aspect-[4/3]">
        <button
          type="button"
          aria-label={on ? `取消收藏文件夹 ${folder.name}` : `收藏文件夹 ${folder.name}`}
          aria-pressed={on}
          onClick={() => fav.mutate({ path: folder.path, favorite: !on, name: folder.name })}
          className={cn(
            roundBtn,
            'top-2 right-2 z-[3]',
            on
              ? 'bg-accent text-accent-fg opacity-100'
              : 'bg-black/45 text-white opacity-0 group-focus-within/fc:opacity-100 group-hover/fc:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Heart className={cn(on && 'fill-current')} strokeWidth={1.8} />
        </button>
        {onPlay && (
          <button
            type="button"
            aria-label={`播放文件夹 ${folder.name}`}
            onClick={onPlay}
            className={cn(roundBtn, 'right-2 bottom-2 z-[3] bg-black/45 text-white opacity-0 group-focus-within/fc:opacity-100 group-hover/fc:opacity-100 [@media(hover:none)]:opacity-100')}
          >
            <Play className="fill-current" strokeWidth={0} />
          </button>
        )}
      </div>
    </div>
  );
}

/** 卡片网格（原型 .fgrid）。 */
export function FolderGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 px-4 pt-5 pb-7 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] md:gap-x-[26px] md:gap-y-[34px] md:px-11 md:pt-7', className)}>
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pt-5 pb-[120px] text-[13.5px] text-muted md:px-11">{children}</div>;
}
