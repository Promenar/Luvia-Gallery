import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { activateGalleryLocation, appendGalleryFolderQuery, appendGalleryMediaTypeQuery, appendGalleryScanScopeQuery, canLoadNextGalleryPage, createGalleryHomeCachePayload, createTopLevelViewLocationUpdate, GalleryLoadErrorBanner, GALLERY_PAGE_SIZE, getAdjacentMediaId, getGalleryCacheEvictionKeys, getGalleryDatasetIdentity, getGalleryUserScopeFingerprint, hasVisibleGallerySearchResults, isActiveGalleryRequest, isDefaultGalleryCacheScope, isGalleryRequestGuardActive, readGalleryHomeCache, resolveGalleryRenderItems, resolveGalleryRequestGuard, resolveLibraryTotalCountForScope, resolveReadyGalleryDatasetIdentity, resolveScopedGalleryLayout, resolveVisibleGalleryFolders, runWithGalleryPaginationLock, SearchEmptyState, shouldAdvanceGalleryNavigationEpoch, shouldCacheCurrentGallery, shouldCoverGalleryWithInitialSkeleton, shouldPreserveGalleryHydratedFiles, shouldRenderUnifiedGalleryToolbar, shouldShowFavoritesEmptyState, shouldShowGallerySearchEmptyState, shouldShowServerEmptyLibrary, shouldSyncSearchDraft, shouldUpdateGalleryFetchingState, sortGalleryCombinedItems, UnifiedGalleryToolbar, waitForGalleryLocationResults } from '../App';
import { FolderCard } from '../components/FolderCard';
import { LanguageProvider } from '../contexts/LanguageContext';
import { useGalleryNavigation, type GalleryNavigationApi } from '../hooks/useGalleryNavigation';
import { GalleryNavigationController, type NavigationEnvironment } from '../navigation/navigation-controller';
import { createGalleryQueryKey } from '../navigation/query-key';
import { writeGalleryLayoutPreference } from '../navigation/layout-preference';

const createEnvironment = (hash = '#folder=parent') => {
  const entries: Array<{ state: unknown; url: string }> = [{ state: null, url: hash }];
  let index = 0;
  let replaceCalls = 0;
  const environment: NavigationEnvironment = {
    history: {
      get state() { return entries[index].state; },
      pushState(state, _title, url) {
        entries.splice(index + 1);
        entries.push({ state, url: String(url) });
        index += 1;
      },
      replaceState(state, _title, url) {
        entries[index] = { state, url: String(url) };
        replaceCalls += 1;
      },
      back() { if (index > 0) index -= 1; },
      forward() { if (index < entries.length - 1) index += 1; },
    },
    location: {
      get hash() { return entries[index].url; },
    } as Location,
  };
  return { environment, get replaceCalls() { return replaceCalls; } };
};

describe('应用导航最小闭环', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('目录加载失败时保留内容并提供明确重试入口', () => {
    const onRetry = vi.fn();
    render(<GalleryLoadErrorBanner onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain('已保留上一次内容');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('统一工具栏仅在媒体库、收藏夹和文件夹内容视图显示', () => {
    expect(shouldRenderUnifiedGalleryToolbar('home')).toBe(false);
    expect(shouldRenderUnifiedGalleryToolbar('all')).toBe(true);
    expect(shouldRenderUnifiedGalleryToolbar('favorites')).toBe(true);
    expect(shouldRenderUnifiedGalleryToolbar('folders')).toBe(true);
  });

  it('真实统一工具栏边界覆盖三视图、隔离陈旧路径并按契约提交位置更新', () => {
    const storedValues = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
      removeItem: (key: string) => storedValues.delete(key),
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const onLocationChange = vi.fn();
    const baseLocation = {
      key: 'all',
      view: 'all' as const,
      folderPath: 'stale/folder',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      layout: 'grid' as const,
    };
    const commonProps = {
      canGoBack: true,
      canGoForward: true,
      onBack: vi.fn(),
      onForward: vi.fn(),
      onUp: vi.fn(),
      onNavigatePath: vi.fn(),
      onNavigateView: vi.fn(),
      onScrollToTop: vi.fn(),
      onLocationChange,
      labels: { home: '首页', all: '媒体库', favorites: '收藏夹', folders: '文件夹' },
    };
    const { rerender } = render(
      <LanguageProvider>
        <UnifiedGalleryToolbar {...commonProps} viewMode="home" location={{ ...baseLocation, view: 'home', key: 'home' }} />
      </LanguageProvider>,
    );
    expect(screen.queryByTestId('unified-gallery-toolbar')).toBeNull();

    rerender(
      <LanguageProvider>
        <UnifiedGalleryToolbar {...commonProps} viewMode="all" location={baseLocation} />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('unified-gallery-toolbar').className).toContain('z-[35]');
    const compactSlot = screen.getByTestId('gallery-toolbar-compact-slot');
    const desktopSlot = screen.getByTestId('gallery-toolbar-desktop-slot');
    expect(compactSlot.className).toContain('lg:hidden');
    expect(compactSlot.className).not.toContain('md:hidden');
    expect(desktopSlot.className).toContain('hidden');
    expect(desktopSlot.className).toContain('lg:block');
    expect(desktopSlot.className).not.toContain('md:block');
    const desktop = within(screen.getByTestId('gallery-nav-bar-desktop'));
    expect(desktop.getByText('媒体库')).toBeDefined();
    expect(desktop.queryByText('stale')).toBeNull();

    fireEvent.click(desktop.getByLabelText(/进入搜索|Enter search/));
    const searchInput = desktop.getByLabelText(/搜索输入框|Search input/);
    fireEvent.change(searchInput, { target: { value: '人物' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(onLocationChange).toHaveBeenLastCalledWith({ search: '人物', mediaId: undefined }, 'push');
    expect(onLocationChange).toHaveBeenCalledTimes(1);

    onLocationChange.mockClear();
    fireEvent.click(desktop.getByLabelText(/当前排序：|Sort by:/));
    fireEvent.click(desktop.getByText(/最早优先|Oldest/));
    expect(onLocationChange).toHaveBeenCalledWith({ sort: 'dateAsc', mediaId: undefined }, 'replace');

    onLocationChange.mockClear();
    fireEvent.click(desktop.getByLabelText(/切换布局|Change layout/));
    fireEvent.click(desktop.getByText(/瀑布流|Masonry/));
    expect(onLocationChange).toHaveBeenCalledWith({ layout: 'masonry', mediaId: undefined }, 'replace');

    onLocationChange.mockClear();
    fireEvent.click(desktop.getByLabelText(/当前筛选：|Current filter:/));
    fireEvent.click(desktop.getByText(/视频|Video/));
    expect(onLocationChange).toHaveBeenCalledWith({ filter: 'video', mediaId: undefined }, 'replace');

    rerender(
      <LanguageProvider>
        <UnifiedGalleryToolbar {...commonProps} viewMode="favorites" location={{ ...baseLocation, key: 'favorites', view: 'favorites' }} />
      </LanguageProvider>,
    );
    expect(within(screen.getByTestId('gallery-nav-bar-desktop')).getByText('收藏夹')).toBeDefined();

    rerender(
      <LanguageProvider>
        <UnifiedGalleryToolbar {...commonProps} viewMode="folders" location={{ ...baseLocation, key: 'folders', view: 'folders', folderPath: '相册/一级/二级/当前目录' }} />
      </LanguageProvider>,
    );
    expect(within(screen.getByTestId('gallery-toolbar-desktop-slot')).getByText('当前目录')).toBeDefined();
    expect(screen.getByTestId('gallery-toolbar-desktop-slot').className).toContain('hidden lg:block');
    expect(screen.getByTestId('gallery-toolbar-compact-slot').className).toContain('lg:hidden');
  });

  it('真实首渲染不会在读取排序、筛选或搜索状态前触发 TDZ', () => {
    const client = new QueryClient();
    const host = document.createElement('div');
    const root = createRoot(host);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      expect(() => act(() => root.render(
        React.createElement(QueryClientProvider, { client },
          React.createElement(LanguageProvider, null, React.createElement(App)),
        ),
      ))).not.toThrow();
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('缓存父目录多页数据且与其它 locationKey 隔离', () => {
    const client = new QueryClient();
    const parentKey = createGalleryQueryKey({ username: 'u', view: 'folders', folderPath: 'parent', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    const childKey = createGalleryQueryKey({ username: 'u', view: 'folders', folderPath: 'parent/child', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    const parent = { files: [{ id: '1' }, { id: '2' }, { id: '3' }], serverFolders: [], serverOffset: 1500, serverTotal: 3000, hasMoreServer: true };

    client.setQueryData(parentKey, parent);

    expect(client.getQueryData(parentKey)).toEqual(parent);
    expect(client.getQueryData(childKey)).toBeUndefined();
  });

  it('LRU 在超过 12 个位置或 5000 个媒体项时淘汰最旧条目', () => {
    const entries = Array.from({ length: 13 }, (_, index) => ({
      queryKey: ['galleryFiles', index] as const,
      itemCount: 500,
      updatedAt: index,
    }));
    expect(getGalleryCacheEvictionKeys(entries)).toEqual([
      ['galleryFiles', 2],
      ['galleryFiles', 1],
      ['galleryFiles', 0],
    ]);
  });

  it('超过 5000 项的最新目录缓存保留自身并淘汰所有更旧条目', () => {
    const oldKey = ['galleryFiles', 'old'] as const;
    const latestKey = ['galleryFiles', 'latest'] as const;
    expect(getGalleryCacheEvictionKeys([
      { queryKey: oldKey, itemCount: 500, updatedAt: 1 },
      { queryKey: latestKey, itemCount: 5_001, updatedAt: 2 },
    ])).toEqual([oldKey]);
  });

  it('同一时间戳下仍无条件保留当前受保护的超大缓存条目', () => {
    const oldKey = ['galleryFiles', 'old'] as const;
    const protectedKey = ['galleryFiles', 'parent-large'] as const;
    expect(getGalleryCacheEvictionKeys([
      { queryKey: oldKey, itemCount: 500, updatedAt: 10 },
      { queryKey: protectedKey, itemCount: 5_001, updatedAt: 10 },
    ], 12, 5_000, protectedKey)).toEqual([oldKey]);
  });

  it('缓存命中也会推进位置纪元并拒绝旧目录响应', () => {
    const epochRef = { current: 4 };
    const locationKeyRef = { current: 'folder-a' };
    const activeEpoch = activateGalleryLocation(epochRef, locationKeyRef, 'folder-b');
    expect(activeEpoch).toBe(5);
    expect(isActiveGalleryRequest(epochRef.current, 4, locationKeyRef.current, 'folder-a')).toBe(false);
    expect(isActiveGalleryRequest(epochRef.current, 5, locationKeyRef.current, 'folder-b')).toBe(true);
  });

  it('未显式传入守卫的请求在开始时捕获位置世代，并在导航后失效', () => {
    const guard = resolveGalleryRequestGuard(undefined, undefined, undefined, 7, 'folders:a');
    expect(guard).toMatchObject({ epoch: 7, locationKey: 'folders:a' });
    expect(isGalleryRequestGuardActive(guard, 8, 'folders:b')).toBe(false);
  });

  it('目录 A 分页中切换到缓存目录 B 后，旧 finally 不会污染 B 的加载状态', () => {
    const requestA = 1;
    const cachedLocationBRequest = 2;
    let isFetchingMore = true;
    isFetchingMore = false;
    const requestB = 3;
    isFetchingMore = true;
    if (shouldUpdateGalleryFetchingState(requestB, requestA, false)) isFetchingMore = false;
    expect(isFetchingMore).toBe(true);
    if (shouldUpdateGalleryFetchingState(requestB, requestB, true)) isFetchingMore = false;
    expect(isFetchingMore).toBe(false);
    expect(cachedLocationBRequest).toBeGreaterThan(requestA);
  });

  it('真实导航切换到缓存目录后，旧 A 分页 finally 不会阻塞 B 继续分页', () => {
    const fake = createEnvironment('#folder=A');
    const controller = new GalleryNavigationController({ environment: fake.environment });
    const locationA = controller.initialize();
    const epochRef = { current: 0 };
    const locationKeyRef = { current: '' };
    const epochA = activateGalleryLocation(epochRef, locationKeyRef, locationA.key);
    const guardA = resolveGalleryRequestGuard(undefined, undefined, undefined, epochA, locationA.key);
    const client = new QueryClient();
    const locationBKey = createGalleryQueryKey({ username: 'u', view: 'folders', folderPath: 'B', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    client.setQueryData(locationBKey, { files: [{ id: 'b-1' }], serverFolders: [], serverOffset: 500, serverTotal: 1000, hasMoreServer: true });
    controller.navigatePath('B');
    const locationB = controller.getLocation();
    activateGalleryLocation(epochRef, locationKeyRef, locationB.key);
    let activeRequestId = 2;
    let isFetchingMore = false;
    expect(client.getQueryData(locationBKey)).toMatchObject({ hasMoreServer: true, serverOffset: 500 });
    activeRequestId += 1;
    isFetchingMore = true;
    if (shouldUpdateGalleryFetchingState(activeRequestId, 1, isGalleryRequestGuardActive(guardA, epochRef.current, locationKeyRef.current))) {
      isFetchingMore = false;
    }
    expect(isFetchingMore).toBe(true);
    if (shouldUpdateGalleryFetchingState(activeRequestId, activeRequestId, true)) isFetchingMore = false;
    expect(isFetchingMore).toBe(false);
  });

  it('真实 QueryClient 淘汰链会保留受保护的 5001 项当前目录缓存', () => {
    const client = new QueryClient();
    const currentKey = createGalleryQueryKey({ username: 'u', view: 'folders', folderPath: 'parent', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    const competingKey = createGalleryQueryKey({ username: 'u', view: 'folders', folderPath: 'older', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    const currentCache = { files: Array.from({ length: 5_001 }, (_, index) => ({ id: `current-${index}` })), serverFolders: [], serverOffset: 5_001, serverTotal: 5_001, hasMoreServer: false };
    client.setQueryData(competingKey, { files: [{ id: 'old-1' }], serverFolders: [], serverOffset: 1, serverTotal: 1, hasMoreServer: false });
    client.setQueryData(currentKey, currentCache);
    const entries = client.getQueryCache().findAll({ queryKey: ['galleryFiles'] }).map((query) => ({
      queryKey: query.queryKey,
      itemCount: ((query.state.data as { files?: unknown[] } | undefined)?.files || []).length,
      updatedAt: 10,
    }));
    getGalleryCacheEvictionKeys(entries, 12, 5_000, currentKey).forEach((queryKey) => {
      client.removeQueries({ queryKey, exact: true });
    });
    expect(client.getQueryData(currentKey)).toBe(currentCache);
    expect(client.getQueryData(competingKey)).toBeUndefined();
  });

  it('普通捕获只持久化，恢复命令由完成回调消费', () => {
    const fake = createEnvironment();
    const controller = new GalleryNavigationController({ environment: fake.environment });
    controller.initialize();
    let api: GalleryNavigationApi | undefined;
    const host = document.createElement('div');
    const root = createRoot(host);
    const Probe = () => {
      api = useGalleryNavigation({ controller });
      return null;
    };
    act(() => root.render(React.createElement(Probe)));
    const snapshot = { anchorIndex: 0, offsetWithinItem: 0, fallbackScrollTop: 0, loadedOffset: 0 };
    act(() => api!.captureSnapshot(snapshot));
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => api!.requestRestore(snapshot));
    expect(api!.restoreSnapshot).toMatchObject({ anchorIndex: 0, fallbackScrollTop: 0 });
    act(() => api!.consumeRestoreSnapshot(api!.restoreCommand!.token));
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => root.unmount());
  });

  it('搜索草稿只在位置键变化时同步，输入中的字符不会被同一位置覆盖', () => {
    expect(shouldSyncSearchDraft('folders:albums', 'folders:albums')).toBe(false);
    expect(shouldSyncSearchDraft('folders:albums', 'folders:albums?search=cat')).toBe(true);
  });

  it('切换顶级视图会清除 q 和 mediaId，同一文件夹视图内导航保留搜索', () => {
    const fake = createEnvironment();
    const controller = new GalleryNavigationController({ environment: fake.environment });
    controller.initialize();
    controller.updateLocation({ view: 'all', folderPath: '', search: '人物', mediaId: 'media-1' }, 'replace');
    controller.updateLocation(createTopLevelViewLocationUpdate('all', 'favorites', 'grid'), 'push');

    expect(controller.getLocation()).toMatchObject({
      view: 'favorites',
      search: '',
    });
    expect(controller.getLocation()).not.toHaveProperty('mediaId');
    expect(fake.environment.location.hash).not.toContain('q=');

    controller.updateLocation({ view: 'folders', folderPath: '相册', search: '人物' }, 'replace');
    controller.navigatePath('相册/旅行');
    expect(controller.getLocation()).toMatchObject({
      view: 'folders',
      folderPath: '相册/旅行',
      search: '人物',
    });
  });

  it('扫描请求仅为非空文件夹搜索启用递归，普通目录和收藏夹请求均不递归', () => {
    expect(GALLERY_PAGE_SIZE).toBe(120);
    const baseUrl = `/api/scan/results?offset=0&limit=${GALLERY_PAGE_SIZE}`;
    const folderSearch = new URLSearchParams(
      appendGalleryScanScopeQuery(baseUrl, '相册/旅行', false, ' 人物 ').split('?')[1],
    );
    const plainFolder = new URLSearchParams(
      appendGalleryScanScopeQuery(baseUrl, '相册/旅行', false, '   ').split('?')[1],
    );
    const favoritesSearch = new URLSearchParams(
      appendGalleryScanScopeQuery(baseUrl, null, true, '人物').split('?')[1],
    );

    expect(folderSearch.get('folder')).toBe('相册/旅行');
    expect(folderSearch.get('search')).toBe('人物');
    expect(folderSearch.get('recursive')).toBe('true');
    expect(plainFolder.get('recursive')).toBeNull();
    expect(plainFolder.get('search')).toBeNull();
    expect(favoritesSearch.get('favorites')).toBe('true');
    expect(favoritesSearch.get('search')).toBe('人物');
    expect(favoritesSearch.get('recursive')).toBeNull();
  });

  it('服务端媒体筛选仅下发受支持的 image、video 和 audio 枚举', () => {
    const baseUrl = `/api/scan/results?offset=0&limit=${GALLERY_PAGE_SIZE}`;
    expect(new URLSearchParams(appendGalleryMediaTypeQuery(baseUrl, 'image').split('?')[1]).get('mediaType')).toBe('image');
    expect(new URLSearchParams(appendGalleryMediaTypeQuery(baseUrl, 'video').split('?')[1]).get('mediaType')).toBe('video');
    expect(new URLSearchParams(appendGalleryMediaTypeQuery(baseUrl, 'audio').split('?')[1]).get('mediaType')).toBe('audio');
    expect(new URLSearchParams(appendGalleryMediaTypeQuery(baseUrl, 'all').split('?')[1]).get('mediaType')).toBeNull();
  });

  it('大文件优先排序通过服务端分页契约传递 sizeDesc', () => {
    const source = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    const mapSortBlock = source.match(/const mapSort = \(opt: SortOption\) => \{([\s\S]*?)\n\s*\};/)?.[1] || '';
    expect(mapSortBlock).toContain("case 'sizeDesc': return 'sizeDesc'");
  });

  it('图库数据加载依赖数据集身份，不受媒体查看器或布局位置键变化影响', () => {
    const source = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(source).toContain('const galleryDatasetIdentity = getGalleryDatasetIdentity(currentGalleryUserScope, galleryNavigation.location);');
    expect(source).toContain('[authStep, currentGalleryUserScope, galleryDatasetIdentity, galleryReloadNonce');
    expect(source).not.toContain('[authStep, currentUser?.username, galleryNavigation.location.key, galleryReloadNonce');
  });

  it('持久化首包缓存只服务默认全库视图', () => {
    expect(isDefaultGalleryCacheScope('all', '', '', 'dateDesc', 'all')).toBe(true);
    expect(isDefaultGalleryCacheScope('all', '', '人物', 'dateDesc', 'all')).toBe(false);
    expect(isDefaultGalleryCacheScope('all', '', '', 'dateAsc', 'all')).toBe(false);
    expect(isDefaultGalleryCacheScope('all', '', '', 'dateDesc', 'video')).toBe(false);
    expect(isDefaultGalleryCacheScope('folders', '', '', 'dateDesc', 'all')).toBe(false);
  });

  it('服务端空库遮罩只在默认全库且当前文件确实为空时出现', () => {
    const location = {
      view: 'all' as const,
      folderPath: '',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
    };
    expect(shouldShowServerEmptyLibrary({ isServerMode: true, location, fileCount: 0, libraryTotalCount: 0, isLoading: false })).toBe(true);
    expect(shouldShowServerEmptyLibrary({ isServerMode: true, location, fileCount: 120, libraryTotalCount: 0, isLoading: false })).toBe(false);
    expect(shouldShowServerEmptyLibrary({ isServerMode: true, location: { ...location, filter: 'video' }, fileCount: 0, libraryTotalCount: 0, isLoading: false })).toBe(false);
    expect(shouldShowServerEmptyLibrary({ isServerMode: true, location, fileCount: 0, libraryTotalCount: 0, isLoading: true })).toBe(false);
  });

  it('首页缓存严格匹配用户名、角色和允许路径，旧无作用域缓存视为 miss', () => {
    const baseUser = { username: 'alice', isAdmin: false, allowedPaths: ['/media/a', '/media/b'] };
    const files = [{ id: 'media-1', path: '/media/a/image.jpg' }] as any;
    const payload = createGalleryHomeCachePayload(baseUser, files, 900_000, 123);
    const raw = JSON.stringify(payload);
    expect(readGalleryHomeCache(raw, { ...baseUser, allowedPaths: ['/media/b', '/media/a'] })).toMatchObject({ files, total: 900_000 });
    expect(readGalleryHomeCache(raw, { ...baseUser, username: 'bob' })).toBeNull();
    expect(readGalleryHomeCache(raw, { ...baseUser, allowedPaths: ['/media/a'] })).toBeNull();
    expect(readGalleryHomeCache(raw, { ...baseUser, isAdmin: true })).toBeNull();
    expect(readGalleryHomeCache(JSON.stringify({ files, total: 900_000 }), baseUser)).toBeNull();
    expect(getGalleryUserScopeFingerprint(baseUser)).not.toContain('/media/a');
  });

  it('管理员精确总数在登出或切换受限权限作用域后立即清零', () => {
    const adminScope = getGalleryUserScopeFingerprint({ username: 'admin', isAdmin: true, allowedPaths: [] });
    const restrictedScope = getGalleryUserScopeFingerprint({ username: 'viewer', isAdmin: false, allowedPaths: ['/media/public'] });
    const sameRestrictedScope = getGalleryUserScopeFingerprint({ username: 'viewer', isAdmin: false, allowedPaths: ['/media/public'] });

    expect(resolveLibraryTotalCountForScope(adminScope, adminScope, 900_000)).toBe(900_000);
    expect(resolveLibraryTotalCountForScope(adminScope, '', 900_000)).toBe(0);
    expect(resolveLibraryTotalCountForScope(adminScope, restrictedScope, 900_000)).toBe(0);
    expect(resolveLibraryTotalCountForScope(restrictedScope, sameRestrictedScope, 120)).toBe(120);

    const source = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(source).toContain('const currentGalleryUserScope = currentUser ? getGalleryUserScopeFingerprint(currentUser) :');
    expect(source).toContain('setLibraryTotalCount(0);\n        setCurrentUser(null);');
  });

  it('同用户名角色或允许路径变化会隔离内存查询键且不暴露路径明文', () => {
    const location = {
      view: 'all' as const,
      folderPath: '',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      randomSeed: '0',
    };
    const adminScope = getGalleryUserScopeFingerprint({ username: 'alice', isAdmin: true, allowedPaths: ['/private/admin'] });
    const regularScope = getGalleryUserScopeFingerprint({ username: 'alice', isAdmin: false, allowedPaths: ['/media/public'] });
    const narrowedScope = getGalleryUserScopeFingerprint({ username: 'alice', isAdmin: false, allowedPaths: ['/media/public/photos'] });
    const adminIdentity = getGalleryDatasetIdentity(adminScope, location);
    const regularIdentity = getGalleryDatasetIdentity(regularScope, location);
    const narrowedIdentity = getGalleryDatasetIdentity(narrowedScope, location);

    expect(new Set([adminIdentity, regularIdentity, narrowedIdentity]).size).toBe(3);
    expect(adminIdentity).not.toContain('/private/admin');
    expect(regularIdentity).not.toContain('/media/public');
    expect(narrowedIdentity).not.toContain('/media/public/photos');

    const client = new QueryClient();
    const adminKey = JSON.parse(adminIdentity);
    const narrowedKey = JSON.parse(narrowedIdentity);
    client.setQueryData(adminKey, { files: [{ id: 'admin-only' }] });
    expect(client.getQueryData(narrowedKey)).toBeUndefined();
    expect(shouldPreserveGalleryHydratedFiles(true, adminScope, narrowedScope, 0, 120)).toBe(false);
    expect(shouldPreserveGalleryHydratedFiles(true, narrowedScope, narrowedScope, 0, 120)).toBe(true);
  });

  it('图库数据 effect 与 query cache 清理均依赖权限指纹', () => {
    const source = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(source).toContain('username: currentGalleryUserScope');
    expect(source).toContain('}, [currentGalleryUserScope]);');
    expect(source).toContain('}, [currentGalleryUserScope, queryClient]);');
    expect(source).toContain('[authStep, currentGalleryUserScope, galleryDatasetIdentity');
    expect(source).toContain('contentScopeIdentity === currentScopeIdentity');
    expect(source).toContain('galleryContentScopeRef.current,\n            currentGalleryUserScope');
  });

  it('文件夹混排 sizeDesc 按大小降序并以媒体身份稳定打破并列', () => {
    const createItem = (id: string, size: number) => ({
      id,
      name: `${id}.jpg`,
      path: `${id}.jpg`,
      folderPath: '',
      size,
      type: 'image/jpeg',
      lastModified: 1,
      mediaType: 'image' as const,
      sourceId: 'local',
      url: '',
    });
    const items = [createItem('z', 10), createItem('b', 50), createItem('a', 50)];
    expect(sortGalleryCombinedItems(items, 'sizeDesc').map(item => item.id)).toEqual(['a', 'b', 'z']);
    expect(sortGalleryCombinedItems([...items].reverse(), 'sizeDesc').map(item => item.id)).toEqual(['a', 'b', 'z']);
  });

  it('续页失败后释放互斥锁并允许立即重试', async () => {
    const lockRef = { current: false };
    const firstTask = vi.fn(async () => { throw new Error('network failed'); });
    await expect(runWithGalleryPaginationLock(lockRef, firstTask)).rejects.toThrow('network failed');
    expect(lockRef.current).toBe(false);

    const retryTask = vi.fn(async () => undefined);
    await expect(runWithGalleryPaginationLock(lockRef, retryTask)).resolves.toBe(true);
    expect(retryTask).toHaveBeenCalledTimes(1);
    expect(lockRef.current).toBe(false);
  });

  it('首次位置加载等待媒体和目录共同完成，目录较慢时不提前撤骨架', async () => {
    let resolveFolders: ((value: boolean) => void) | undefined;
    const fileRequest = Promise.resolve(true);
    const folderRequest = new Promise<boolean>((resolve) => { resolveFolders = resolve; });
    let settled = false;
    let shouldCover = shouldCoverGalleryWithInitialSkeleton(false, false);
    let loadedItems: Array<{ id: string }> = [];
    const combined = waitForGalleryLocationResults(fileRequest, folderRequest).then((results) => {
      settled = true;
      shouldCover = false;
      return results;
    });

    await fileRequest;
    loadedItems = [{ id: 'file-arrived-first' }];
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(resolveGalleryRenderItems(loadedItems, shouldCover)).toEqual([]);
    resolveFolders?.(true);
    await expect(combined).resolves.toEqual([true, true]);
    expect(settled).toBe(true);
    expect(resolveGalleryRenderItems(loadedItems, shouldCover)).toEqual(loadedItems);
    expect(shouldCoverGalleryWithInitialSkeleton(false, true)).toBe(false);
    expect(shouldCoverGalleryWithInitialSkeleton(true, false)).toBe(false);
  });

  it('cache miss 首载未完成时禁止写入半成品查询缓存，完整首包和续页阶段允许缓存', () => {
    expect(shouldCacheCurrentGallery(true, true, false)).toBe(false);
    expect(shouldCacheCurrentGallery(true, false, false)).toBe(false);
    expect(shouldCacheCurrentGallery(false, true, false)).toBe(false);
    expect(shouldCacheCurrentGallery(false, false, true)).toBe(false);
    expect(shouldCacheCurrentGallery(false, false, false)).toBe(true);

    const client = new QueryClient();
    const queryKey = createGalleryQueryKey({ username: 'alice', view: 'folders', folderPath: 'A', search: '', sort: 'dateDesc', filter: 'all', randomSeed: 0 });
    if (shouldCacheCurrentGallery(true, true, false)) client.setQueryData(queryKey, { files: [{ id: 'partial' }] });
    expect(client.getQueryData(queryKey)).toBeUndefined();
    if (shouldCacheCurrentGallery(false, false, true)) client.setQueryData(queryKey, { files: [{ id: 'failed-partial' }] });
    expect(client.getQueryData(queryKey)).toBeUndefined();
    if (shouldCacheCurrentGallery(false, false, false)) client.setQueryData(queryKey, { files: [{ id: 'complete' }], serverFolders: [] });
    expect(client.getQueryData(queryKey)).toMatchObject({ files: [{ id: 'complete' }] });
  });

  it('只有当前数据集完整首包就绪后才能请求续页', () => {
    const base = {
      isServerMode: true,
      hasCurrentUser: true,
      hasMore: true,
      isFetching: false,
      isInitialLoading: false,
      isInitialSkeletonCovering: false,
      serverOffset: 120,
      readyDatasetIdentity: 'dataset-a',
      currentDatasetIdentity: 'dataset-a',
    };
    expect(canLoadNextGalleryPage(base)).toBe(true);
    expect(canLoadNextGalleryPage({ ...base, isInitialLoading: true })).toBe(false);
    expect(canLoadNextGalleryPage({ ...base, isInitialSkeletonCovering: true })).toBe(false);
    expect(canLoadNextGalleryPage({ ...base, isFetching: true })).toBe(false);
    expect(canLoadNextGalleryPage({ ...base, serverOffset: 0 })).toBe(false);
    expect(canLoadNextGalleryPage({ ...base, readyDatasetIdentity: '' })).toBe(false);
    expect(canLoadNextGalleryPage({ ...base, currentDatasetIdentity: 'dataset-b' })).toBe(false);
    expect(resolveReadyGalleryDatasetIdentity([true, true], 'dataset-a')).toBe('dataset-a');
    expect(resolveReadyGalleryDatasetIdentity([true, false], 'dataset-a')).toBe('');
    expect(resolveReadyGalleryDatasetIdentity([], 'dataset-a')).toBe('');
  });

  it('收藏夹首载等待 favorites 期间保持 initial 门禁，不会发第二条 offset=0', () => {
    expect(canLoadNextGalleryPage({
      isServerMode: true,
      hasCurrentUser: true,
      hasMore: true,
      isFetching: false,
      isInitialLoading: true,
      isInitialSkeletonCovering: true,
      serverOffset: 0,
      readyDatasetIdentity: '',
      currentDatasetIdentity: 'favorites-dataset',
    })).toBe(false);
  });

  it('数据集切换 effect 前即使保留旧 offset 也不能沿用旧 ready 身份分页', () => {
    expect(canLoadNextGalleryPage({
      isServerMode: true,
      hasCurrentUser: true,
      hasMore: true,
      isFetching: false,
      isInitialLoading: false,
      isInitialSkeletonCovering: false,
      serverOffset: 360,
      readyDatasetIdentity: 'dataset-a',
      currentDatasetIdentity: 'dataset-b',
    })).toBe(false);
  });

  it('布局和媒体导航不推进数据请求纪元，数据集更新仍使旧请求失效', () => {
    const current = {
      view: 'all' as const,
      folderPath: '',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      randomSeed: '1',
      layout: 'grid' as const,
      mediaId: undefined,
    };
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, layout: 'masonry' })).toBe(false);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, mediaId: 'media-1' })).toBe(false);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current })).toBe(false);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, search: '人物' })).toBe(true);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, sort: 'sizeDesc' })).toBe(true);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, filter: 'video' })).toBe(true);
    expect(shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, randomSeed: '2' })).toBe(true);

    const epochRef = { current: 8 };
    const locationKeyRef = { current: 'all:grid' };
    const requestGuard = resolveGalleryRequestGuard(undefined, undefined, undefined, epochRef.current, locationKeyRef.current);
    if (shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, layout: 'masonry' })) epochRef.current += 1;
    const remainsActiveAfterLayout = isGalleryRequestGuardActive(requestGuard, epochRef.current, locationKeyRef.current);
    expect(remainsActiveAfterLayout).toBe(true);
    let isFetchingMore = true;
    if (shouldUpdateGalleryFetchingState(1, 1, remainsActiveAfterLayout)) isFetchingMore = false;
    expect(isFetchingMore).toBe(false);
    if (shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current, filter: 'video' })) epochRef.current += 1;
    expect(isGalleryRequestGuardActive(requestGuard, epochRef.current, locationKeyRef.current)).toBe(false);
  });

  it('首载中重复点击当前侧栏不推进纪元，旧请求仍能清理 loading', () => {
    const current = {
      view: 'all' as const,
      folderPath: '',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      randomSeed: '0',
    };
    const epochRef = { current: 3 };
    const locationKeyRef = { current: 'view=all' };
    const guard = resolveGalleryRequestGuard(undefined, undefined, undefined, epochRef.current, locationKeyRef.current);
    if (shouldAdvanceGalleryNavigationEpoch('alice', current, { ...current })) epochRef.current += 1;
    expect(epochRef.current).toBe(3);
    expect(isGalleryRequestGuardActive(guard, epochRef.current, locationKeyRef.current)).toBe(true);
    let isInitialLoading = true;
    if (shouldUpdateGalleryFetchingState(1, 1, true)) isInitialLoading = false;
    expect(isInitialLoading).toBe(false);
  });

  it('所有显式 Gallery 导航入口统一通过数据集身份推进纪元，登录无旁路首载', () => {
    const source = readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(source.match(/navigationRequestEpochRef\.current \+= 1/g)).toHaveLength(1);
    expect(source).toContain('advanceGalleryDatasetNavigation(resolveNextGalleryLocation(locationUpdate));');
    expect(source).toContain('advanceGalleryDatasetNavigation(resolveNextGalleryLocation(update));');
    expect(source).toContain('onBack={() => { cacheCurrentGallery(); galleryNavigation.back(); }}');
    expect(source).toContain('onForward={() => { cacheCurrentGallery(); galleryNavigation.forward(); }}');
    expect(source).not.toContain('setTimeout(() => {\n                                                    // Make sure fetchServerFiles uses the token now');
    expect(source).toContain('manageInitialLoading = false');
  });

  it('搜索和收藏空态必须等待整体首次加载完成', () => {
    expect(shouldShowGallerySearchEmptyState('人物', false, false, true)).toBe(false);
    expect(shouldShowGallerySearchEmptyState('人物', false, false, false)).toBe(true);
    expect(shouldShowGallerySearchEmptyState('人物', true, false, false)).toBe(false);
    expect(shouldShowFavoritesEmptyState('favorites', 0, 0, true)).toBe(false);
    expect(shouldShowFavoritesEmptyState('favorites', 0, 0, false)).toBe(true);
    expect(shouldShowFavoritesEmptyState('favorites', 1, 0, false)).toBe(false);
  });

  it('目录搜索请求同时发送裁剪后的搜索词和固定上限', () => {
    const params = new URLSearchParams(
      appendGalleryFolderQuery('/api/library/folders', '相册/旅行', false, ' 人物 ').split('?')[1],
    );

    expect(params.get('parent')).toBe('相册/旅行');
    expect(params.get('search')).toBe('人物');
    expect(params.get('limit')).toBe('100');
  });

  it('文件夹搜索合并后端目录与递归媒体结果，并让仅目录命中保持非空态', () => {
    const folders = resolveVisibleGalleryFolders(
      'folders',
      ' 人物 ',
      true,
      [{ path: '相册/人物摄影', name: '人物摄影' }],
      [{ path: '相册/直属目录', name: '直属目录' }],
    );
    const media = [{ id: 'media-1', name: '人物.jpg' }];

    expect([...folders, ...media].map(item => item.name)).toEqual(['人物摄影', '人物.jpg']);
    expect(hasVisibleGallerySearchResults('folders', folders.length, media.length, 0)).toBe(true);
    expect(hasVisibleGallerySearchResults('folders', folders.length, 0, 0)).toBe(true);
    expect(hasVisibleGallerySearchResults('folders', 0, 0, 0)).toBe(false);
  });

  it('搜索无结果空态区分当前目录并通过现有位置更新链路清除搜索', () => {
    const onLocationChange = vi.fn();
    expect(resolveVisibleGalleryFolders(
      'folders',
      ' 人物 ',
      true,
      [],
      [],
    )).toEqual([]);

    render(
      <LanguageProvider>
        <SearchEmptyState
          view="folders"
          folderPath="相册/旅行"
          onLocationChange={onLocationChange}
        />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('search-empty-state').textContent).toContain('旅行');
    fireEvent.click(screen.getByRole('button', { name: /清除搜索|Clear search/ }));
    expect(onLocationChange).toHaveBeenCalledWith({ search: '', mediaId: undefined }, 'push');
  });

  it('FolderCard 封面 URL 变化后复位图片错误并恢复新封面', async () => {
    const folder = {
      name: '人物相册',
      path: '相册/人物',
      children: {},
      mediaCount: 1,
      coverMedia: {
        id: '',
        name: '封面',
        path: '相册/人物/封面.jpg',
        folderPath: '相册/人物',
        url: '/old-cover.jpg',
        type: 'image/jpeg',
        mediaType: 'image' as const,
        size: 1,
        lastModified: 1,
        sourceId: 'test',
      },
    };
    const { rerender } = render(<FolderCard folder={folder} onClick={vi.fn()} animate={false} />);

    fireEvent.error(screen.getByRole('img', { name: '人物相册' }));
    expect(screen.queryByRole('img', { name: '人物相册' })).toBeNull();

    rerender(
      <FolderCard
        folder={{ ...folder, coverMedia: { ...folder.coverMedia, url: '/new-cover.jpg' } }}
        onClick={vi.fn()}
        animate={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('img', { name: '人物相册' }).getAttribute('src')).toContain('/new-cover.jpg');
    });
  });

  it('媒体条目回退后恢复无 mediaId 的目录位置', () => {
    const fake = createEnvironment();
    const controller = new GalleryNavigationController({ environment: fake.environment });
    const directory = controller.initialize();
    controller.updateLocation({ mediaId: 'media-1' }, 'push');
    fake.environment.history.back();

    expect(controller.applyPopState(fake.environment.history.state)).toEqual(directory);
    expect(controller.getLocation().mediaId).toBeUndefined();
  });

  it('查看器上一项使用 replace 保持返回目标仍是目录', () => {
    const fake = createEnvironment();
    const controller = new GalleryNavigationController({ environment: fake.environment });
    controller.initialize();
    controller.updateLocation({ mediaId: 'media-1' }, 'push');
    const nextId = getAdjacentMediaId([{ id: 'media-1' }, { id: 'media-2' }], 'media-1', 'next');
    controller.updateLocation({ mediaId: nextId }, 'replace');
    fake.environment.history.back();
    controller.applyPopState(fake.environment.history.state);
    expect(controller.getLocation().mediaId).toBeUndefined();
  });

  it('深链初始化只写入一次 History 状态', () => {
    const fake = createEnvironment('#folder=旅行%2F2025');
    const controller = new GalleryNavigationController({ environment: fake.environment });

    expect(controller.initialize().folderPath).toBe('旅行/2025');
    controller.initialize();

    expect(fake.replaceCalls).toBe(1);
  });

  it('异步用户恢复后按 all/favorites/folders 偏好创建新条目，回退只恢复 History 条目布局', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const serverId = 'https://gallery.example';
    writeGalleryLayoutPreference(storage, { serverId, userId: 'alice', view: 'all' }, 'grid');
    writeGalleryLayoutPreference(storage, { serverId, userId: 'alice', view: 'favorites' }, 'masonry');
    writeGalleryLayoutPreference(storage, { serverId, userId: 'alice', view: 'folders' }, 'grid');

    const fake = createEnvironment('#');
    const controller = new GalleryNavigationController({ environment: fake.environment });
    controller.initialize();
    // 模拟用户异步恢复后，在 Gallery 首次可见前由 useLayoutEffect 应用 all 偏好。
    controller.applyInitialLayoutPreference(resolveScopedGalleryLayout(storage, serverId, 'alice', 'all'));
    const allEntry = fake.environment.history.state;
    controller.updateLocation({ view: 'favorites', folderPath: '', mediaId: undefined, layout: resolveScopedGalleryLayout(storage, serverId, 'alice', 'favorites') }, 'push');
    const favoritesEntry = fake.environment.history.state;
    controller.updateLocation({ view: 'folders', folderPath: 'Trips/2026', mediaId: undefined, layout: resolveScopedGalleryLayout(storage, serverId, 'alice', 'folders') }, 'push');

    expect(controller.getLocation()).toMatchObject({ view: 'folders', layout: 'grid' });
    fake.environment.history.back();
    expect(controller.applyPopState(fake.environment.history.state)).toMatchObject({ view: 'favorites', layout: 'masonry' });
    fake.environment.history.back();
    expect(controller.applyPopState(fake.environment.history.state)).toMatchObject({ view: 'all', layout: 'grid' });
    expect(allEntry).toBeDefined();
    expect(favoritesEntry).toBeDefined();
  });
});
