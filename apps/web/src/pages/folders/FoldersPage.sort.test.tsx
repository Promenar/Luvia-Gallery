import { createElement, useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import FoldersPage from './FoldersPage';

const state = vi.hoisted(() => ({
  preferences: { folderSort: 'modified_desc', mediaSort: 'modified_desc', folderIncludeSubfolders: false },
  listeners: new Set<() => void>(),
}));

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return { useSearch: () => ({ path: 'lib' }), Link: ({ children, to: _to, search: _search, ...rest }: any) => React.createElement('a', { ...rest, href: '#' }, children) };
});
vi.mock('@/stores/session', () => ({
  useIsAdmin: () => false,
  usePreferences: () => useSyncExternalStore((listener) => { state.listeners.add(listener); return () => state.listeners.delete(listener); }, () => state.preferences),
  useUpdatePreferences: () => ({ mutate: (patch: Partial<typeof state.preferences>) => { state.preferences = { ...state.preferences, ...patch }; state.listeners.forEach((listener) => listener()); } }),
}));
vi.mock('./favorite', () => ({
  foldersQuery: () => ({ queryKey: ['test-folders'], queryFn: async () => ({
    path: 'lib', breadcrumbs: [{ name: '照片', path: 'lib' }], hostPath: null, directMediaCount: 0, favorite: false,
    folders: [
      { path: 'lib/a', name: '较早', modifiedAt: '2025-01-01T00:00:00Z', mediaCount: 0, childCount: 0, cover: null, favorite: false },
      { path: 'lib/b', name: '最近', modifiedAt: '2026-01-01T00:00:00Z', mediaCount: 0, childCount: 0, cover: null, favorite: false },
    ],
  }) }),
  useFolderFavorite: () => ({ mutate: () => {} }),
}));
vi.mock('./media', () => ({ useMediaPages: () => ({ items: [], isPending: false, isError: false, total: 0, hasNextPage: false, loadMore: () => {} }) }));
vi.mock('./FolderTree', () => ({ FolderTree: () => null }));
vi.mock('@/theme/ThemeProvider', () => ({ setDynamicFrom: () => {} }));

afterEach(() => { cleanup(); state.listeners.clear(); state.preferences = { folderSort: 'modified_desc', mediaSort: 'modified_desc', folderIncludeSubfolders: false }; });

it('切换文件夹排序后卡片改变顺序，媒体排序保持原值', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} });
  try {
    render(createElement(QueryClientProvider, { client }, createElement(FoldersPage)));
    await screen.findByRole('link', { name: '打开文件夹 最近' });
    const order = () => screen.getAllByRole('link', { name: /^打开文件夹/ }).map((link) => link.getAttribute('aria-label'));
    expect(order()).toEqual(['打开文件夹 最近', '打开文件夹 较早']);
    fireEvent.click(screen.getByRole('button', { name: '文件夹排序：修改时间' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '文件夹名称，A 到 Z' }));
    await waitFor(() => expect(order()).toEqual(['打开文件夹 较早', '打开文件夹 最近']));
    expect(state.preferences.mediaSort).toBe('modified_desc');
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo'); client.clear(); }
});
