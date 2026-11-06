import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import type { MediaListQuery } from '@luvia/contracts';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { PagedMediaGrid } from '@/pages/folders/PagedMediaGrid';
import { openViewer } from '@/stores/viewer';
import { playQuery, useMediaPages } from '@/pages/folders/media';
import { EmptyNote, FolderCard, FolderGrid, PageHead, PageTitle, chip, metaText } from '@/pages/folders/ui';
import { SortMenu, useMediaSort } from '@/components/media/SortMenu';

type Tab = 'media' | 'folders';
const LABEL = '收藏';

function Tabs({ tab, folderCount, onChange }: { tab: Tab; folderCount: number | undefined; onChange: (t: Tab) => void }) {
  const items: [Tab, string][] = [['media', '照片和视频'], ['folders', folderCount != null ? `文件夹 ${folderCount}` : '文件夹']];
  return (
    <div
      role="tablist"
      aria-label="收藏类型"
      className="inline-flex flex-none gap-0.5 rounded-[var(--r3)] bg-sunken p-[3px]"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          onChange(tab === 'media' ? 'folders' : 'media');
        }
      }}
    >
      {items.map(([t, name]) => (
        <button
          key={t}
          id={`fav-tab-${t}`}
          type="button"
          role="tab"
          aria-selected={tab === t}
          aria-controls="fav-panel"
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onChange(t)}
          className={cn(
            'h-[30px] rounded-[calc(var(--r3)-3px)] px-[9px] text-[13px] whitespace-nowrap text-muted md:px-3',
            tab === t && 'bg-raised text-fg shadow-[0_0_0_1px_var(--line)]',
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function MediaTab({ scroller }: { scroller: HTMLElement | null }) {
  const sort = useMediaSort();
  const query = useMemo<MediaListQuery>(() => ({ scope: 'favorites', sort }), [sort]);
  const media = useMediaPages(query);
  const scope = () => ({ label: LABEL, items: media.items, query, nextCursor: media.nextCursor, total: media.total });
  return (
    <>
      <PageHead className="pt-3 md:pt-4">
        <div className="min-w-0">
          <PageTitle>收藏的照片和视频</PageTitle>
          {media.total != null && <div className={metaText}>{media.total.toLocaleString('zh-CN')} 项，包括收藏的文件夹中的内容</div>}
        </div>
        {media.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <SortMenu small={false} />
            <button
              type="button"
              className={chip()}
              onClick={() => (media.items.length ? openViewer(scope(), 0, { play: true }) : toast('还没有可播放的收藏'))}
            >
              <Play className="size-3.5! fill-current" strokeWidth={0} />播放幻灯片
            </button>
          </div>
        )}
      </PageHead>
      {media.isError ? (
        <EmptyNote>无法加载收藏：{media.error.message}</EmptyNote>
      ) : media.isPending ? (
        <EmptyNote>正在加载…</EmptyNote>
      ) : !media.items.length ? (
        <EmptyNote>还没有收藏的照片或视频。打开一张照片，点心形即可收藏；收藏文件夹后，其中的内容也会出现在这里。</EmptyNote>
      ) : (
        <div className="px-0.5 pt-4 pb-[120px] md:px-11">
          <PagedMediaGrid
            items={media.items}
            scrollElement={scroller}
            hasMore={media.hasNextPage}
            onEndReached={media.loadMore}
            onOpen={(index, el) => openViewer(scope(), index, { originEl: el })}
          />
        </div>
      )}
    </>
  );
}

function FoldersTab() {
  const sort = useMediaSort();
  const { data, isPending, isError, error } = useQuery(q('favoriteFolders'));
  const folders = data?.folders ?? [];
  return (
    <>
      <PageHead className="pt-3 md:pt-4">
        <PageTitle>收藏的文件夹</PageTitle>
        <div className={cn(metaText, 'w-full')}>收藏的文件夹会出现在这里，也可以作为首页轮播的内容来源。</div>
      </PageHead>
      {isPending && <EmptyNote>正在加载…</EmptyNote>}
      {isError && <EmptyNote>无法加载收藏的文件夹：{error.message}</EmptyNote>}
      {data && !folders.length && (
        <EmptyNote>还没有收藏文件夹。在文件夹页点文件夹卡片右上角的心形，或进入文件夹后点“收藏文件夹”。</EmptyNote>
      )}
      {folders.length > 0 && (
        <FolderGrid className="pb-[120px] md:pb-[120px]">
          {folders.map((f) => (
            <FolderCard
              key={f.path}
              folder={f}
              showHostPath
              onPlay={() => void playQuery(`文件夹「${f.name}」`, { scope: 'folder', folder: f.path, recursive: true, sort })}
            />
          ))}
        </FolderGrid>
      )}
    </>
  );
}

export default function FavoritesPage() {
  const { tab = 'media' } = useSearch({ from: '/app/favorites' });
  const navigate = useNavigate();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const favFolders = useQuery(q('favoriteFolders'));
  const setTab = (t: Tab) => {
    void navigate({ to: '/favorites', search: { tab: t }, replace: true });
    requestAnimationFrame(() => document.getElementById(`fav-tab-${t}`)?.focus());
  };
  return (
    <div ref={setScroller} className="h-full overflow-x-hidden overflow-y-auto [scrollbar-width:thin]">
      <div className="px-4 pt-6 md:px-11 md:pt-12">
        <Tabs tab={tab} folderCount={favFolders.data?.folders.length} onChange={setTab} />
      </div>
      <div id="fav-panel" role="tabpanel" aria-labelledby={`fav-tab-${tab}`}>
        {tab === 'media' ? <MediaTab scroller={scroller} /> : <FoldersTab />}
      </div>
    </div>
  );
}
