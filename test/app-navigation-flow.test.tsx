import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { activateGalleryLocation, getAdjacentMediaId, getGalleryCacheEvictionKeys, isActiveGalleryRequest, isGalleryRequestGuardActive, resolveGalleryRequestGuard, shouldRenderUnifiedGalleryToolbar, shouldSyncSearchDraft, shouldUpdateGalleryFetchingState, UnifiedGalleryToolbar } from '../App';
import { LanguageProvider } from '../contexts/LanguageContext';
import { useGalleryNavigation, type GalleryNavigationApi } from '../hooks/useGalleryNavigation';
import { GalleryNavigationController, type NavigationEnvironment } from '../navigation/navigation-controller';
import { createGalleryQueryKey } from '../navigation/query-key';

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
    act(() => api!.consumeRestoreSnapshot());
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => root.unmount());
  });

  it('搜索草稿只在位置键变化时同步，输入中的字符不会被同一位置覆盖', () => {
    expect(shouldSyncSearchDraft('folders:albums', 'folders:albums')).toBe(false);
    expect(shouldSyncSearchDraft('folders:albums', 'folders:albums?search=cat')).toBe(true);
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
});
