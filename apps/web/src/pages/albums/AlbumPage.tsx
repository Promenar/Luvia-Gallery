import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, ListChecks, Pencil, Play, Trash2, X } from 'lucide-react';
import type { MediaListQuery } from '@luvia/contracts';
import { toast } from 'sonner';
import { ApiError, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { q, queryClient } from '@/lib/query';
import { PagedMediaGrid } from '@/pages/folders/PagedMediaGrid';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/kit/alert-dialog';
import { openViewer } from '@/stores/viewer';
import { noRetryOnMissing } from '@/pages/folders/favorite';
import { useMediaPages } from '@/pages/folders/media';
import { EmptyNote, PageHead, PageTitle, chip, metaText } from '@/pages/folders/ui';
import { AlbumDialog, invalidateAlbum } from './AlbumDialog';
import { SmartBadge } from './SmartBadge';
import { filterSummary, formatAlbumRange } from './format';
import { idParams } from './params';

function AlbumMissing({ error }: { error: Error }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="px-4 pt-10 md:px-11 md:pt-16">
      <h1 className="m-0 text-2xl font-semibold">{notFound ? '找不到这个相册' : '无法打开这个相册'}</h1>
      <p className="mt-2 text-[13.5px] text-muted">{notFound ? '它可能已被删除，或者链接有误。' : error.message}</p>
      <Link to="/albums" className={cn(chip(), 'mt-5')}><ChevronLeft />返回相册</Link>
    </div>
  );
}

export default function AlbumPage() {
  const { albumId } = useParams({ from: '/app/albums/$albumId' });
  const navigate = useNavigate();
  const albumQ = useQuery({ ...q('getAlbum', { ...idParams(albumId) }), retry: noRetryOnMissing });
  const query = useMemo<MediaListQuery>(() => ({ scope: 'album', albumId }), [albumId]);
  const media = useMediaPages(query, albumQ.isSuccess);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  const remove = useMutation({
    mutationFn: (ids: string[]) => call('removeAlbumItems', { ...idParams(albumId), body: { ids } }),
    onSuccess: (r, ids) => {
      invalidateAlbum();
      exitSelect();
      toast(`已从相册移除 ${r.updated} 项`, {
        description: '照片仍保留在原文件夹中。',
        action: {
          label: '撤销',
          onClick: (): void => {
            void call('addAlbumItems', { ...idParams(albumId), body: { ids } }).then(invalidateAlbum, (e: Error) => toast.error(e.message));
          },
        },
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '没能移除，请稍后重试'),
  });

  const del = useMutation({
    mutationFn: () => call('deleteAlbum', { ...idParams(albumId) }),
    onSuccess: () => {
      const name = albumQ.data?.name;
      queryClient.removeQueries({ queryKey: ['getAlbum', { id: albumId }] });
      invalidateAlbum();
      setDeleting(false);
      toast.success(`已删除相册「${name}」`);
      void navigate({ to: '/albums' });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '没能删除相册，请稍后重试'),
  });

  if (albumQ.isError) return <AlbumMissing error={albumQ.error} />;
  const album = albumQ.data;
  const label = album ? `相册「${album.name}」` : '相册';
  const manual = album?.kind === 'manual';
  const range = album ? formatAlbumRange(album.startAt, album.endAt) : null;
  const summary = album?.kind === 'smart' ? filterSummary(album.filter) : [];
  const count = media.total ?? album?.count ?? 0;

  const play = () => {
    if (!media.items.length) { toast('这个相册里还没有可播放的照片或视频'); return; }
    openViewer({ label, items: media.items, query, nextCursor: media.nextCursor, total: media.total }, 0, { play: true });
  };

  return (
    <div ref={setScroller} className="h-full overflow-x-hidden overflow-y-auto [scrollbar-width:thin]">
      <PageHead>
        <Link to="/albums" className="-mb-1 flex w-full items-center gap-0.5 text-[13px] text-muted hover:text-fg">
          <ChevronLeft className="size-4" />相册
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <PageTitle>{album?.name ?? '正在加载…'}</PageTitle>
            {album?.kind === 'smart' && <SmartBadge className="bg-accent-soft text-fg backdrop-blur-none" />}
          </div>
          {album && (
            <div className={metaText}>
              {[range, `${count.toLocaleString('zh-CN')} 项`].filter(Boolean).join(' · ')}
            </div>
          )}
          {album?.description && <p className="mt-1.5 mb-0 max-w-[640px] text-[13.5px] text-fg-2">{album.description}</p>}
          {summary.length > 0 && (
            <ul aria-label="筛选条件" className="mt-2.5 mb-0 flex list-none flex-wrap gap-1.5 p-0">
              {summary.map((s) => <li key={s} className="rounded-full border border-line-2 px-2.5 py-0.5 text-[12px] text-fg-2">{s}</li>)}
            </ul>
          )}
        </div>
        {album && (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <button type="button" className={chip()} onClick={play}>
              <Play className="size-3.5! fill-current" strokeWidth={0} />播放幻灯片
            </button>
            {manual && media.items.length > 0 && (
              <button type="button" aria-pressed={selecting} className={chip(selecting)} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
                <ListChecks />{selecting ? '完成选择' : '选择'}
              </button>
            )}
            <button type="button" className={chip()} onClick={() => setEditing(true)}>
              <Pencil />{manual ? '重命名' : '编辑条件'}
            </button>
            <button type="button" className={chip()} onClick={() => setDeleting(true)}>
              <Trash2 />删除相册
            </button>
          </div>
        )}
      </PageHead>

      {selecting && (
        <p className="mx-4 mt-2 mb-0 text-[12.5px] text-muted md:mx-11">点击照片选中或取消，然后从下方移出相册。</p>
      )}

      {media.isError ? (
        <EmptyNote>无法加载相册内容：{media.error.message}</EmptyNote>
      ) : !album || media.isPending ? (
        <EmptyNote>正在加载…</EmptyNote>
      ) : !media.items.length ? (
        <EmptyNote>
          {manual ? '这个相册还没有内容。到“照片”或文件夹里选中照片，再选择“加入相册”。' : '目前没有符合条件的照片或视频。新照片符合条件后会自动出现在这里，也可以点“编辑条件”放宽条件。'}
        </EmptyNote>
      ) : (
        <div className="px-0.5 pt-4 pb-[140px] md:px-11">
          <PagedMediaGrid
            items={media.items}
            scrollElement={scroller}
            hasMore={media.hasNextPage}
            onEndReached={media.loadMore}
            selectedIds={selecting ? selected : undefined}
            onOpen={(index, el) => {
              const item = media.items[index]!;
              if (selecting) {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                  return next;
                });
                return;
              }
              openViewer({ label, items: media.items, query, nextCursor: media.nextCursor, total: media.total }, index, { originEl: el });
            }}
          />
        </div>
      )}

      {selecting && (
        <div
          role="toolbar"
          aria-label="选择操作"
          className="glass fixed bottom-[calc(68px+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-[calc(var(--r3)+4px)] p-1.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)] md:bottom-6"
        >
          <span className="px-3 text-[13px] whitespace-nowrap" aria-live="polite">已选 {selected.size} 项</span>
          <button
            type="button"
            disabled={!selected.size || remove.isPending}
            onClick={() => remove.mutate([...selected])}
            className="flex h-9 items-center gap-[7px] rounded-[var(--r3)] bg-accent px-3 text-[13px] whitespace-nowrap text-accent-fg disabled:opacity-50"
          >
            <Trash2 className="size-4" />{remove.isPending ? '正在移除…' : '从相册移除'}
          </button>
          <button type="button" aria-label="取消选择" onClick={exitSelect} className="grid size-9 place-items-center rounded-[var(--r3)] text-fg-2 hover:bg-accent-soft hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      )}

      {album && <AlbumDialog open={editing} onOpenChange={setEditing} album={album} />}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除相册「{album?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>只删除相册本身，里面的照片和视频仍保留在原文件夹中。删除后无法恢复这个相册。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留相册</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? '正在删除…' : '删除相册'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
