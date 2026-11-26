import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Folder as FolderIcon, Heart, Play } from 'lucide-react';
import { mediaUrls, type Folder, type MediaItem } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { canThumb, pickThumbSize, thumbhashUrl } from '@/components/media/Thumb';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { useFolderFavorite } from './favorite';

/** 统一圆角胶囊操作按钮；on 为强调色填充。 */
export const chip = (on?: boolean, sm?: boolean) =>
  cn(
    'inline-flex shrink-0 items-center gap-[7px] rounded-full border border-line-2 whitespace-nowrap text-fg-2 transition-colors hover:bg-accent-soft hover:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
    sm ? 'h-[30px] px-[11px] text-[12.5px]' : 'h-[34px] px-[13px] text-[13px]',
    on && 'border-transparent bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg [&_svg.fill-on]:fill-current',
  );

/** 页面标题区（自适应双皮肤左右安全留白）。 */
export function PageHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('lv-page-inset mx-auto flex max-w-[1640px] flex-wrap items-end gap-x-[18px] gap-y-3 pt-6 pb-2 md:pt-10', className)}>{children}</div>;
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="lv-page-title">{children}</h1>;
}

export const metaText = 'mt-1.5 text-[13px] text-muted';
export const subhClass = 'lv-page-inset mx-auto mt-5 mb-1 flex max-w-[1640px] items-center gap-2.5 text-[15px] font-semibold';

/** 卡片封面里的一张图：ThumbHash 占位 + 懒加载渐进显影缩略图。 */
export function CoverImage({ item, displayPx, className, blur }: { item: MediaItem; displayPx: number; className?: string; blur?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const ph = thumbhashUrl(item);
  return (
    <div className={cn('size-full bg-sunken bg-cover bg-center', className)} style={{ backgroundImage: ph ? `url(${ph})` : undefined }}>
      {!blur && canThumb(item) && (
        <img
          src={mediaUrls.thumb(item.id, pickThumbSize(displayPx), item.thumbVersion)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn('lv-photo-img size-full object-cover', loaded && 'is-loaded')}
        />
      )}
    </div>
  );
}

/**
 * 双皮肤文件夹封面叠片：
 * - monograph（画册）：精装档案封套（顶部标签耳 + 无酸白边抽拉印相 + 底部封套口袋）；
 * - cinema（液态光场）：景深三层叠片 + 悬停柔和扇形展开。
 */
export function FolderStack({ cover, className }: { cover: MediaItem | null; className?: string; hoverGroup?: 'fc' | 'libc' }) {
  return (
    <div className={cn('lv-folio-stack', className)} aria-hidden>
      <div className="lv-folio-back" />
      <div className="lv-folio-layer-3 bg-sunken">
        {cover && <CoverImage item={cover} displayPx={0} blur />}
      </div>
      <div className="lv-folio-layer-2 bg-sunken">
        {cover && <CoverImage item={cover} displayPx={0} blur />}
      </div>
      <div className="lv-folio-layer-1 bg-sunken">
        {cover ? (
          <CoverImage item={cover} displayPx={320} />
        ) : (
          <div className="grid size-full place-items-center text-muted"><FolderIcon className="size-8" strokeWidth={1.4} /></div>
        )}
      </div>
      <div className="lv-folio-pocket" />
    </div>
  );
}

export const countText = (mediaCount: number, childCount: number) =>
  `${mediaCount.toLocaleString('zh-CN')} 项${childCount ? ` · ${childCount} 个子文件夹` : ''}`;

const roundBtn = 'pointer-events-auto absolute grid size-8 place-items-center rounded-full transition-[opacity,scale] duration-150 active:scale-90 [&_svg]:size-4';

/**
 * 文件夹卡片：整卡为进入文件夹的链接；右上角心形收藏，悬停/聚焦/已收藏/触屏下显示。
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
        <FolderStack cover={folder.cover} className="mx-2 mt-2 mb-4" />
        <h3 className="m-0 truncate text-[15px] font-semibold text-fg">{folder.name}</h3>
        <p className="m-0 mt-0.5 text-[12.5px] text-muted">{countText(folder.mediaCount, folder.childCount)}</p>
        {showHostPath && folder.hostPath && (
          <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-muted" title={folder.hostPath}>{folder.hostPath}</p>
        )}
      </Link>
      <div className="pointer-events-none absolute inset-x-2 top-2 aspect-[4/3]">
        <button
          type="button"
          aria-label={on ? `取消收藏文件夹 ${folder.name}` : `收藏文件夹 ${folder.name}`}
          aria-pressed={on}
          onClick={() => fav.mutate({ path: folder.path, favorite: !on, name: folder.name })}
          className={cn(
            roundBtn,
            'top-2 right-2 z-[5]',
            on
              ? 'bg-accent text-accent-fg opacity-100'
              : 'bg-black/48 text-white opacity-0 backdrop-blur-sm group-focus-within/fc:opacity-100 group-hover/fc:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Heart className={cn(on && 'fill-current')} strokeWidth={1.8} />
        </button>
        {onPlay && (
          <button
            type="button"
            aria-label={`播放文件夹 ${folder.name}`}
            onClick={onPlay}
            className={cn(roundBtn, 'right-2 bottom-2 z-[5] bg-black/48 text-white opacity-0 backdrop-blur-sm group-focus-within/fc:opacity-100 group-hover/fc:opacity-100 [@media(hover:none)]:opacity-100')}
          >
            <Play className="fill-current" strokeWidth={0} />
          </button>
        )}
      </div>
    </div>
  );
}

/** 文件夹卡片网格。 */
export function FolderGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('lv-page-inset mx-auto grid max-w-[1640px] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 pt-5 pb-7 sm:grid-cols-[repeat(auto-fill,minmax(226px,1fr))] md:gap-x-[26px] md:gap-y-[32px] md:pt-6', className)}>
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="lv-page-inset mx-auto max-w-[1640px] pt-5 pb-[120px] text-[13.5px] text-muted">{children}</div>;
}
