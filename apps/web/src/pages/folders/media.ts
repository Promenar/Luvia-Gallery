import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { MediaListQuery, MediaPage } from '@luvia/contracts';
import { toast } from 'sonner';
import { call } from '@/lib/api';
import { openViewer } from '@/stores/viewer';

/**
 * listMedia 游标分页。键以 'listMedia' 开头，SSE 与 invalidate('listMedia') 能一并失效；
 * 末尾的 'pages' 与普通 q('listMedia') 查询区分，避免两种数据结构共用同一缓存。
 */
export function useMediaPages(query: MediaListQuery, enabled = true) {
  const r = useInfiniteQuery<MediaPage, Error, InfiniteData<MediaPage>, readonly unknown[], string | undefined>({
    queryKey: ['listMedia', null, query, 'pages'],
    queryFn: ({ pageParam, signal }) => call('listMedia', { query: { ...query, cursor: pageParam }, signal }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled,
  });
  const items = useMemo(() => r.data?.pages.flatMap((p) => p.items) ?? [], [r.data]);
  const last = r.data?.pages.at(-1);
  const total = r.data?.pages[0]?.total ?? null;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = r;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { ...r, items, total, nextCursor: last?.nextCursor ?? null, loadMore };
}

/**
 * 取一页媒体后直接开始幻灯片（用于没有在页面上加载媒体的入口，例如收藏的文件夹卡片）。
 * 播放范围由 label 与 query 决定，查看器接近末尾时用 nextCursor 继续加载。
 */
export async function playQuery(label: string, query: MediaListQuery) {
  try {
    const page = await call('listMedia', { query });
    if (!page.items.length) {
      toast('这里没有可播放的照片或视频');
      return;
    }
    openViewer({ label, items: page.items, query, nextCursor: page.nextCursor, total: page.total }, 0, { play: true });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '无法加载要播放的内容，请稍后重试');
  }
}
