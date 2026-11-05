import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { Album } from '@luvia/contracts';
import { q } from '@/lib/query';
import { cn } from '@/lib/cn';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { CoverImage, EmptyNote, PageHead, PageTitle, chip, metaText } from '@/pages/folders/ui';
import { AlbumDialog } from './AlbumDialog';
import { filterSummary, formatAlbumRange } from './format';
import { SmartBadge } from './SmartBadge';

/** 卡片副标题：时间范围；智能相册没有内容时显示条件摘要。 */
const subtitle = (a: Album) =>
  formatAlbumRange(a.startAt, a.endAt) ?? (a.kind === 'smart' ? `智能相册：${filterSummary(a.filter).join(' · ') || '全部'}` : '还没有内容');

/** 相册卡片（原型 .ac）：封面铺满，底部渐变上显示名称、时间与数量。 */
function AlbumCard({ album }: { album: Album }) {
  return (
    <Link
      to="/albums/$albumId"
      params={{ albumId: album.id }}
      onMouseEnter={() => setDynamicFrom(album.cover)}
      aria-label={`${album.name}，${album.count} 项${album.kind === 'smart' ? '，智能相册' : ''}`}
      className="group/ac relative block aspect-[4/3] overflow-hidden rounded-[var(--r3)] bg-sunken after:absolute after:inset-0 after:bg-[linear-gradient(transparent_35%,rgba(0,0,0,.72))] after:content-['']"
    >
      {album.cover && (
        <div className="absolute inset-0 transition-transform duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)] group-hover/ac:scale-[1.04]">
          <CoverImage item={album.cover} displayPx={520} />
        </div>
      )}
      {album.kind === 'smart' && <SmartBadge className="absolute top-3.5 left-3.5 z-[1]" />}
      <div className="absolute right-[18px] bottom-4 left-[18px] z-[1] flex items-end gap-3 text-white">
        <h3 className="m-0 min-w-0 flex-1 text-[19px] font-semibold">
          <span className="block truncate">{album.name}</span>
          <small className="mt-0.5 block truncate text-[12.5px] font-normal text-white/78">{subtitle(album)}</small>
        </h3>
        <span className="font-display text-[44px] leading-[.8] font-extrabold tabular-nums">{album.count.toLocaleString('zh-CN')}</span>
      </div>
    </Link>
  );
}

export default function AlbumsPage() {
  const [creating, setCreating] = useState(false);
  const { data, isPending, isError, error } = useQuery(q('listAlbums'));
  const albums = data?.albums ?? [];
  return (
    <div className="h-full overflow-x-hidden overflow-y-auto [scrollbar-width:thin]">
      <PageHead>
        <div className="min-w-0">
          <PageTitle>相册</PageTitle>
          {data && albums.length > 0 && <div className={metaText}>{albums.length} 个相册，按最近更新排列</div>}
        </div>
        <button type="button" className={cn(chip(true), 'ml-auto')} onClick={() => setCreating(true)}>
          <Plus />新建相册
        </button>
      </PageHead>
      {isPending && <EmptyNote>正在加载相册…</EmptyNote>}
      {isError && <EmptyNote>无法加载相册：{error.message}</EmptyNote>}
      {data && albums.length === 0 && (
        <EmptyNote>
          还没有相册。点“新建相册”：手动相册可以在照片里选中后加入；智能相册保存一组条件（类型、时间、收藏、文件夹、相机），符合条件的照片会自动出现。
        </EmptyNote>
      )}
      {albums.length > 0 && (
        <div className="grid grid-cols-1 gap-[18px] px-4 pt-6 pb-[120px] sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] md:px-11">
          {albums.map((a) => <AlbumCard key={a.id} album={a} />)}
        </div>
      )}
      <AlbumDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
