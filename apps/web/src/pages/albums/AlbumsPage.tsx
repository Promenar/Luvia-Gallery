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

/**
 * 双皮肤相册卡片：
 * - monograph（画册）：博物馆展品画卡（顶部无酸纸白边画幅 + 底部策展铭牌）；
 * - cinema（液态光场）：全出血圆角大画幅 + 聚光灯微交互。
 */
function AlbumCard({ album, index }: { album: Album; index: number }) {
  const code = album.kind === 'smart' ? 'SMART · AUTO' : `EXH · ${String(index + 1).padStart(2, '0')}`;
  return (
    <Link
      to="/albums/$albumId"
      params={{ albumId: album.id }}
      onMouseEnter={() => setDynamicFrom(album.cover)}
      aria-label={`${album.name}，${album.count} 项${album.kind === 'smart' ? '，智能相册' : ''}`}
      className="group/ac lv-album-card lv-spotlight-item"
    >
      <div className="lv-album-media">
        {album.cover && (
          <div className="size-full transition-transform duration-[600ms] ease-[var(--ease-cinema)] group-hover/ac:scale-[1.04]">
            <CoverImage item={album.cover} displayPx={520} />
          </div>
        )}
        {album.kind === 'smart' && <SmartBadge className="absolute top-3 left-3 z-[2]" />}
      </div>
      <div className="lv-album-body">
        <div className="min-w-0 flex-1">
          <span className="lv-album-code">{code}</span>
          <h3 className="lv-album-name m-0 truncate">{album.name}</h3>
          <small className="lv-album-sub mt-0.5 block truncate text-[12.5px] font-normal">{subtitle(album)}</small>
        </div>
        <span className="lv-album-count shrink-0 tabular-nums">{album.count.toLocaleString('zh-CN')}</span>
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
        <div className="lv-page-inset lv-spotlight-group mx-auto grid max-w-[1640px] grid-cols-1 gap-[20px] pt-6 pb-[120px] sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {albums.map((a, i) => <AlbumCard key={a.id} album={a} index={i} />)}
        </div>
      )}
      <AlbumDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
