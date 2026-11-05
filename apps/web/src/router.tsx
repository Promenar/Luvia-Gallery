import { lazy } from 'react';
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { queryClient } from '@/lib/query';
import { authStateQuery } from '@/stores/session';
import { AppShell } from '@/shell/AppShell';
import { RootLayout } from '@/shell/RootLayout';
import { LoginPage, SetupPage } from '@/pages/auth/AuthPages';

const MemoriesPage = lazy(() => import('@/pages/memories/MemoriesPage'));
const PhotosPage = lazy(() => import('@/pages/photos/PhotosPage'));
const FoldersPage = lazy(() => import('@/pages/folders/FoldersPage'));
const FavoritesPage = lazy(() => import('@/pages/favorites/FavoritesPage'));
const AlbumsPage = lazy(() => import('@/pages/albums/AlbumsPage'));
const AlbumPage = lazy(() => import('@/pages/albums/AlbumPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));

const rootRoute = createRootRoute({ component: RootLayout });

/** 需要登录的布局：未初始化跳 setup，未登录跳 login。 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: async ({ location }) => {
    const state = await queryClient.ensureQueryData(authStateQuery);
    if (!state.initialized) throw redirect({ to: '/setup' });
    if (!state.user) throw redirect({ to: '/login', search: { next: location.href } });
  },
});

const indexRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: MemoriesPage });
/** q 为搜索关键词；type 限定媒体类型（省略为全部），写进地址以便刷新、返回与分享时保留筛选。 */
export const photosSearch = z.object({ q: z.string().optional(), type: z.enum(['image', 'video']).optional() });
const photosRoute = createRoute({ getParentRoute: () => appRoute, path: '/photos', validateSearch: photosSearch, component: PhotosPage });
/** path 为虚拟文件夹路径（`<libraryId>/<相对目录>`）；省略时列出各媒体库根。 */
export const foldersSearch = z.object({ path: z.string().optional() });
const foldersRoute = createRoute({ getParentRoute: () => appRoute, path: '/folders', validateSearch: foldersSearch, component: FoldersPage });
export const favoritesSearch = z.object({ tab: z.enum(['media', 'folders']).optional() });
const favoritesRoute = createRoute({ getParentRoute: () => appRoute, path: '/favorites', validateSearch: favoritesSearch, component: FavoritesPage });
const albumsRoute = createRoute({ getParentRoute: () => appRoute, path: '/albums', component: AlbumsPage });
const albumRoute = createRoute({ getParentRoute: () => appRoute, path: '/albums/$albumId', component: AlbumPage });
export const adminSearch = z.object({ tab: z.enum(['overview', 'libraries', 'processing', 'users', 'clients']).optional() });
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  validateSearch: adminSearch,
  component: AdminPage,
  beforeLoad: async () => {
    const state = await queryClient.ensureQueryData(authStateQuery);
    if (state.user?.role !== 'admin') throw redirect({ to: '/' });
  },
});

export const loginSearch = z.object({ next: z.string().optional() });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', validateSearch: loginSearch, component: LoginPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: SetupPage });

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([indexRoute, photosRoute, foldersRoute, favoritesRoute, albumsRoute, albumRoute, adminRoute]),
  loginRoute,
  setupRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
