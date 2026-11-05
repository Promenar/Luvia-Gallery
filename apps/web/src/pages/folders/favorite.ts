import { useMutation } from '@tanstack/react-query';
import type { FavoriteFolders as FavoriteFoldersSchema, FolderListing, FolderTree as FolderTreeSchema } from '@luvia/contracts';
import type { z } from 'zod';
import { toast } from 'sonner';
import { ApiError, call } from '@/lib/api';
import { invalidate, q, queryClient } from '@/lib/query';

/** 路径不存在或无权访问时不重试，直接显示说明；其它错误最多重试 2 次。 */
export const noRetryOnMissing = (n: number, e: Error) =>
  !(e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) && n < 2;

/** 文件夹列表查询（path 省略为各媒体库根）。各页统一用它，保证缓存键一致。 */
export const foldersQuery = (path?: string) => ({ ...q('folders', { query: { path } }), retry: noRetryOnMissing });
export const folderTreeQuery = (path?: string) => ({ ...q('folderTree', { query: { path } }), retry: noRetryOnMissing });

type FolderTree = z.infer<typeof FolderTreeSchema>;
type FavoriteFolders = z.infer<typeof FavoriteFoldersSchema>;
type FolderNodeLike = { path: string; favorite: boolean };
const mark = <T extends FolderNodeLike>(list: T[], path: string, favorite: boolean) =>
  list.map((f) => (f.path === path ? { ...f, favorite } : f));

/** 收藏文件夹会改变“收藏”范围内的媒体（收藏文件夹之下的媒体也算收藏）。 */
const invalidateFavoriteMedia = () =>
  queryClient.invalidateQueries({
    predicate: (qq) => qq.queryKey[0] === 'listMedia' && (qq.queryKey[2] as { scope?: string } | null)?.scope === 'favorites',
  });

/**
 * 收藏 / 取消收藏文件夹：先更新本地所有文件夹相关缓存，失败回滚并提示原因。
 * 取消收藏时给出“撤销”。
 */
export function useFolderFavorite() {
  const m = useMutation({
    mutationFn: (v: { path: string; favorite: boolean; name: string }) => call('setFolderFavorite', { body: { path: v.path, favorite: v.favorite } }),
    onMutate: async ({ path, favorite }) => {
      await queryClient.cancelQueries({ queryKey: ['folders'] });
      await queryClient.cancelQueries({ queryKey: ['folderTree'] });
      await queryClient.cancelQueries({ queryKey: ['favoriteFolders'] });
      const snapshot = [
        ...queryClient.getQueriesData({ queryKey: ['folders'] }),
        ...queryClient.getQueriesData({ queryKey: ['folderTree'] }),
        ...queryClient.getQueriesData({ queryKey: ['favoriteFolders'] }),
      ];
      queryClient.setQueriesData<FolderListing>({ queryKey: ['folders'] }, (d) =>
        d && { ...d, favorite: d.path === path ? favorite : d.favorite, folders: mark(d.folders, path, favorite) });
      queryClient.setQueriesData<FolderTree>({ queryKey: ['folderTree'] }, (d) => d && { ...d, nodes: mark(d.nodes, path, favorite) });
      queryClient.setQueriesData<FavoriteFolders>({ queryKey: ['favoriteFolders'] }, (d) =>
        d && { folders: favorite ? mark(d.folders, path, true) : d.folders.filter((f) => f.path !== path) });
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(e instanceof Error ? e.message : '没能更新收藏，请稍后重试');
    },
    onSuccess: (_r, v) => {
      if (!v.favorite) {
        toast(`已取消收藏「${v.name}」`, { action: { label: '撤销', onClick: (): void => { m.mutate({ ...v, favorite: true }); } } });
      }
    },
    onSettled: () => {
      void invalidate('folders', 'folderTree', 'favoriteFolders');
      void invalidateFavoriteMedia();
    },
  });
  return m;
}
