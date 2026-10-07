import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig, FolderNode, SystemStatus, HomeScreenConfig, ExtendedSystemStatus, SettingsTab, ScanStatus } from './types';
import { buildFolderTree, generateId, isVideo, isAudio, sortMedia, getImmediateSubfolders, seededShuffle } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard, useStableMediaItemClick } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { MediaPlayer } from './components/player/MediaPlayer';
import { PlayerProvider, useMediaPlayer } from './components/player/PlayerProvider';
import { buildPlayerQueue } from './components/player/player-state';
import { runHeroTransition } from './components/player/hero-transition';
import { UnifiedProgressModal } from './components/UnifiedProgressModal';
import { VirtualGallery } from './components/VirtualGallery';
import { TimelineViewport } from './components/gallery/TimelineViewport';
import type { ViewportCaptureHandle } from './components/gallery/viewport-types';
import { DirectoryPicker } from './components/DirectoryPicker';
import { Home } from './components/Home';
import { useLanguage } from './contexts/LanguageContext';
import { AudioPlayer } from './components/AudioPlayer';
import { UserModal } from './components/UserModal';
import { SettingsModal } from './components/SettingsModal';
import { ScanReportModal } from './components/ScanReportModal';
import { useQueryClient } from '@tanstack/react-query';
import { useGalleryNavigation } from './hooks/useGalleryNavigation';
import { createGalleryQueryKey } from './navigation/query-key';
import { getParentFolderPath } from './navigation/location';
import { getLayoutPreferenceView, resolveGalleryLayoutPreference, type LayoutPreferenceStorage, writeGalleryLayoutPreference } from './navigation/layout-preference';
import { readMediaHoverZoomPreference, writeMediaHoverZoomPreference } from './navigation/media-hover-zoom-preference';
import { GalleryNavigationBar, type GalleryNavigationBarProps } from './components/navigation/GalleryNavigationBar';
import type { GalleryLocation, ViewportSnapshot } from './navigation/types';
import { SingleFlightPoller } from './utils/singleFlightPolling';
import { fetchWithTimeout } from './utils/fetchWithTimeout';
import { ConfirmProvider, notify, useFeedback } from './components/feedback/feedback';
import { Toaster } from './components/kit/sonner';
import { Button } from './components/kit/button';
import { Input } from './components/kit/input';
import { Label } from './components/kit/label';
import { isBackgroundTaskActive, shouldAutoOpenTaskProgress } from './utils/background-tasks';

type GalleryPageCache = {
    files: MediaItem[];
    serverFolders: any[];
    serverOffset: number;
    serverTotal: number;
    hasMoreServer: boolean;
};

export const GALLERY_PAGE_SIZE = 120;

export const appendGalleryMediaTypeQuery = (url: string, filter: FilterOption): string => {
    if (filter !== 'image' && filter !== 'video' && filter !== 'audio') return url;
    return `${url}&mediaType=${encodeURIComponent(filter)}`;
};

export const isDefaultGalleryCacheScope = (
    view: ViewMode,
    folderPath: string,
    search: string,
    sort: SortOption,
    filter: FilterOption,
) => view === 'all'
    && folderPath === ''
    && search.trim() === ''
    && sort === 'dateDesc'
    && filter === 'all';

type GalleryHomeCachePayload = {
    version: 2;
    userScope: string;
    files: MediaItem[];
    total: number;
    timestamp: number;
};

export const getGalleryUserScopeFingerprint = (
    user: Pick<User, 'username' | 'isAdmin' | 'allowedPaths'>,
): string => {
    const canonical = JSON.stringify({
        username: user.username,
        role: user.isAdmin ? 'admin' : 'user',
        allowedPaths: [...(user.allowedPaths || [])].map(path => path.trim()).filter(Boolean).sort(),
    });
    let hash = 2166136261;
    for (let index = 0; index < canonical.length; index += 1) {
        hash ^= canonical.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `v2-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const resolveLibraryTotalCountForScope = (
    previousScope: string,
    nextScope: string,
    currentTotal: number,
): number => previousScope === nextScope ? currentTotal : 0;

export const createGalleryHomeCachePayload = (
    user: Pick<User, 'username' | 'isAdmin' | 'allowedPaths'>,
    files: MediaItem[],
    total: number,
    timestamp = Date.now(),
): GalleryHomeCachePayload => ({
    version: 2,
    userScope: getGalleryUserScopeFingerprint(user),
    files,
    total,
    timestamp,
});

export const readGalleryHomeCache = (
    raw: string | null,
    user: Pick<User, 'username' | 'isAdmin' | 'allowedPaths'>,
): GalleryHomeCachePayload | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<GalleryHomeCachePayload>;
        if (
            parsed.version !== 2
            || parsed.userScope !== getGalleryUserScopeFingerprint(user)
            || !Array.isArray(parsed.files)
            || !Number.isFinite(parsed.total)
        ) return null;
        return parsed as GalleryHomeCachePayload;
    } catch {
        return null;
    }
};

export const shouldShowServerEmptyLibrary = ({
    isServerMode,
    location,
    fileCount,
    libraryTotalCount,
    isLoading,
}: {
    isServerMode: boolean;
    location: Pick<GalleryLocation, 'view' | 'folderPath' | 'search' | 'sort' | 'filter'>;
    fileCount: number;
    libraryTotalCount: number;
    isLoading: boolean;
}): boolean => isServerMode
    && fileCount === 0
    && libraryTotalCount === 0
    && !isLoading
    && isDefaultGalleryCacheScope(location.view, location.folderPath, location.search, location.sort, location.filter);

const stableMediaIdentity = (item: MediaItem): string => item.id || item.path || item.name || '';

export const sortGalleryCombinedItems = (items: MediaItem[], sort: SortOption): MediaItem[] => {
    if (sort === 'random') {
        const shuffled = [...items];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const target = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
        }
        return shuffled;
    }

    return [...items].sort((left, right) => {
        let order = 0;
        if (sort === 'nameAsc') order = (left.name || '').localeCompare(right.name || '');
        else if (sort === 'nameDesc') order = (right.name || '').localeCompare(left.name || '');
        else if (sort === 'sizeDesc') order = (right.size || 0) - (left.size || 0);
        else if (sort === 'dateAsc') order = (left.lastModified || 0) - (right.lastModified || 0);
        else order = (right.lastModified || 0) - (left.lastModified || 0);
        return order || stableMediaIdentity(left).localeCompare(stableMediaIdentity(right));
    });
};

/** 把位置中的随机种子规范为非负整数；缺失或非法时回退为 0（仍是确定性顺序）。 */
export const resolveGalleryRandomSeed = (seed: string | undefined): number => {
    const value = Number(seed);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

export const createGalleryRandomSeed = (): string => String(Math.floor(Math.random() * 2_147_483_647));

export const seededShuffleGalleryItems = seededShuffle;

/**
 * 目录视图的组合顺序：文件夹恒定置顶（按当前排序键排序，随机排序时按名称），
 * 媒体保持数据源顺序追加在后。分页追加媒体时文件夹位置不再跳动。
 */
export const composeGalleryFolderItems = (
    folders: MediaItem[],
    files: MediaItem[],
    sort: SortOption,
): MediaItem[] => [
    ...sortGalleryCombinedItems(folders, sort === 'random' ? 'nameAsc' : sort),
    ...files,
];

/** 首页轮播取样查询：只取图片与视频，按首页模式限定范围；单图模式按文件名检索后由首页精确匹配。 */
export const buildHomeFeaturedQuery = (config: HomeScreenConfig): string => {
    const base = '/api/scan/results?offset=0&limit=24&excludeMediaType=audio';
    const path = config.path?.trim();
    if (config.mode === 'favorites') return `${base}&favorites=true&random=true`;
    if (config.mode === 'folder' && path) return `${base}&folder=${encodeURIComponent(path)}&recursive=true&random=true`;
    if (config.mode === 'single' && path) {
        const fileName = path.split('/').filter(Boolean).pop() || path;
        return `${base}&search=${encodeURIComponent(fileName)}`;
    }
    return `${base}&random=true`;
};

/** 时间线范围查询串：与画廊相同的收藏、媒体类型与搜索范围（时间线固定按日期倒序）。 */
export const buildTimelineScopeQuery = (location: Pick<GalleryLocation, 'view' | 'filter' | 'search'>): string => {
    let query = '';
    if (location.view === 'favorites') query += '&favorites=true';
    if (location.filter === 'image' || location.filter === 'video' || location.filter === 'audio') {
        query += `&mediaType=${encodeURIComponent(location.filter)}`;
    }
    const search = (location.search || '').trim();
    if (search) query += `&search=${encodeURIComponent(search)}`;
    return query;
};

export const runWithGalleryPaginationLock = async (
    lockRef: { current: boolean },
    task: () => Promise<void>,
): Promise<boolean> => {
    if (lockRef.current) return false;
    lockRef.current = true;
    try {
        await task();
        return true;
    } finally {
        lockRef.current = false;
    }
};

export const waitForGalleryLocationResults = <FileResult, FolderResult>(
    fileRequest: Promise<FileResult>,
    folderRequest: Promise<FolderResult>,
): Promise<[FileResult, FolderResult]> => Promise.all([fileRequest, folderRequest]);

export const shouldShowGallerySearchEmptyState = (
    search: string,
    hasVisibleResults: boolean,
    isFetchingMore: boolean,
    isInitialLoading: boolean,
): boolean => search.trim().length > 0
    && !isFetchingMore
    && !isInitialLoading
    && !hasVisibleResults;

export const shouldShowFavoritesEmptyState = (
    view: ViewMode,
    fileCount: number,
    favoriteFolderCount: number,
    isInitialLoading: boolean,
): boolean => view === 'favorites'
    && fileCount === 0
    && favoriteFolderCount === 0
    && !isInitialLoading;

export const shouldCoverGalleryWithInitialSkeleton = (
    hasMatchingCache: boolean,
    shouldPreserveHydratedFiles: boolean,
): boolean => !hasMatchingCache && !shouldPreserveHydratedFiles;

export const shouldPreserveGalleryHydratedFiles = (
    isDefaultScope: boolean,
    contentScopeIdentity: string,
    currentScopeIdentity: string,
    serverOffset: number,
    fileCount: number,
): boolean => isDefaultScope
    && contentScopeIdentity === currentScopeIdentity
    && serverOffset === 0
    && fileCount > 0;

/**
 * 返回引用恒定的回调壳：内部用 ref 持有每一帧提交后的最新闭包，调用时始终转发到最新实现。
 * 仅消除 props 的 identity 抖动（让 VirtualGallery 的 memo 生效），调用语义与逐帧传递最新闭包完全一致。
 */
function useStableEventHandler<Args extends unknown[], Return>(
    handler: (...args: Args) => Return,
): (...args: Args) => Return {
    const handlerRef = useRef(handler);
    useLayoutEffect(() => {
        handlerRef.current = handler;
    });
    return useCallback((...args: Args) => handlerRef.current(...args), []);
}

export const resolveGalleryRenderItems = <Item,>(items: Item[], shouldCover: boolean): Item[] =>
    shouldCover ? [] : items;

export const shouldCacheCurrentGallery = (
    isInitialLoading: boolean,
    isInitialSkeletonCovering: boolean,
    hasLoadError: boolean,
): boolean => !isInitialLoading && !isInitialSkeletonCovering && !hasLoadError;

export const canLoadNextGalleryPage = ({
    isServerMode,
    hasCurrentUser,
    hasMore,
    isFetching,
    isInitialLoading,
    isInitialSkeletonCovering,
    serverOffset,
    readyDatasetIdentity,
    currentDatasetIdentity,
}: {
    isServerMode: boolean;
    hasCurrentUser: boolean;
    hasMore: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isInitialSkeletonCovering: boolean;
    serverOffset: number;
    readyDatasetIdentity: string;
    currentDatasetIdentity: string;
}): boolean => isServerMode
    && hasCurrentUser
    && hasMore
    && !isFetching
    && !isInitialLoading
    && !isInitialSkeletonCovering
    && serverOffset > 0
    && readyDatasetIdentity === currentDatasetIdentity;

export const resolveReadyGalleryDatasetIdentity = (
    results: readonly boolean[],
    currentDatasetIdentity: string,
): string => results.length > 0 && results.every(result => result === true)
    ? currentDatasetIdentity
    : '';

type GalleryDatasetLocation = Pick<GalleryLocation, 'view' | 'folderPath' | 'search' | 'sort' | 'filter' | 'randomSeed'>;

export const getGalleryDatasetIdentity = (
    scopeIdentity: string,
    location: GalleryDatasetLocation,
): string => JSON.stringify(createGalleryQueryKey({ username: scopeIdentity, ...location, randomSeed: Number(location.randomSeed) || 0 }));

export const shouldAdvanceGalleryNavigationEpoch = (
    scopeIdentity: string,
    current: GalleryDatasetLocation,
    next: GalleryDatasetLocation,
): boolean => getGalleryDatasetIdentity(scopeIdentity, current) !== getGalleryDatasetIdentity(scopeIdentity, next);

export const isNavigationRequestCurrent = (activeEpoch: number, requestEpoch: number) => activeEpoch === requestEpoch;

export const isActiveGalleryRequest = (
    activeEpoch: number,
    requestEpoch: number,
    activeLocationKey: string,
    requestLocationKey: string | undefined,
) => isNavigationRequestCurrent(activeEpoch, requestEpoch) && activeLocationKey === requestLocationKey;

export type GalleryRequestGuard = {
    epoch: number;
    locationKey: string;
    signal?: AbortSignal;
};

export const resolveGalleryRequestGuard = (
    navigationEpoch: number | undefined,
    locationKey: string | undefined,
    signal: AbortSignal | undefined,
    activeEpoch: number,
    activeLocationKey: string,
    activeSignal?: AbortSignal,
): GalleryRequestGuard => ({
    epoch: navigationEpoch ?? activeEpoch,
    locationKey: locationKey ?? activeLocationKey,
    signal: signal ?? activeSignal,
});

export const isGalleryRequestGuardActive = (
    guard: GalleryRequestGuard,
    activeEpoch: number,
    activeLocationKey: string,
) => !guard.signal?.aborted && isActiveGalleryRequest(activeEpoch, guard.epoch, activeLocationKey, guard.locationKey);

export const shouldUpdateGalleryFetchingState = (
    activeRequestId: number,
    requestId: number,
    guardIsActive: boolean,
) => activeRequestId === requestId && guardIsActive;

export const activateGalleryLocation = (
    epochRef: { current: number },
    locationKeyRef: { current: string },
    locationKey: string,
) => {
    epochRef.current += 1;
    locationKeyRef.current = locationKey;
    return epochRef.current;
};

export const shouldSyncSearchDraft = (lastLocationKey: string | null, locationKey: string) =>
    lastLocationKey !== locationKey;

export const shouldRenderUnifiedGalleryToolbar = (viewMode: ViewMode) => viewMode !== 'home';

export const createTopLevelViewLocationUpdate = (
    currentView: ViewMode,
    targetView: ViewMode,
    layout: GridLayout,
): Partial<Pick<GalleryLocation, 'view' | 'folderPath' | 'search' | 'layout'>> => ({
    view: targetView,
    folderPath: '',
    layout,
    ...(currentView !== targetView ? { search: '' } : {}),
});

export const appendGalleryScanScopeQuery = (
    url: string,
    folderFilter: string | null | undefined,
    favoritesOnly: boolean,
    searchQuery: string,
) => {
    const effectiveSearch = searchQuery.trim();
    let scopedUrl = url;

    if (favoritesOnly) {
        scopedUrl += '&favorites=true';
    } else if (folderFilter !== null && folderFilter !== undefined) {
        scopedUrl += `&folder=${encodeURIComponent(folderFilter)}`;
        if (effectiveSearch) scopedUrl += '&recursive=true';
    }

    if (effectiveSearch) scopedUrl += `&search=${encodeURIComponent(effectiveSearch)}`;
    return scopedUrl;
};

export const appendGalleryFolderQuery = (
    url: string,
    parentPath: string | null,
    favoritesOnly: boolean,
    searchQuery: string,
) => {
    const params: string[] = [];
    const effectiveSearch = searchQuery.trim();

    if (favoritesOnly) params.push('favorites=true');
    if (parentPath !== null && !favoritesOnly) params.push(`parent=${encodeURIComponent(parentPath)}`);
    if (effectiveSearch) {
        params.push(`search=${encodeURIComponent(effectiveSearch)}`);
        params.push('limit=100');
    }

    return params.length > 0 ? `${url}?${params.join('&')}` : url;
};

export const resolveVisibleGalleryFolders = (
    viewMode: ViewMode,
    activeSearch: string,
    isServerMode: boolean,
    serverFolders: any[],
    clientSubfolders: any[],
) => viewMode === 'folders' && activeSearch.trim()
    ? serverFolders
    : (isServerMode ? serverFolders : clientSubfolders);

export const hasVisibleGallerySearchResults = (
    viewMode: ViewMode,
    visibleFolderCount: number,
    mediaCount: number,
    favoriteFolderCount: number,
) => viewMode === 'folders'
    ? visibleFolderCount > 0 || mediaCount > 0
    : mediaCount > 0 || (viewMode === 'favorites' && favoriteFolderCount > 0);

export const resolveScopedGalleryLayout = (
    storage: LayoutPreferenceStorage | undefined,
    serverId: string,
    userId: string | undefined,
    view: GalleryLocation['view'],
): GridLayout => {
    if (!userId || !getLayoutPreferenceView(view)) return 'grid';
    return resolveGalleryLayoutPreference(storage, { serverId, userId, view }) ?? 'grid';
};

type UnifiedToolbarLocationUpdate = Partial<Pick<GalleryLocation, 'search' | 'sort' | 'filter' | 'layout' | 'randomSeed'>>;

/** 切到随机排序时生成新种子，离开随机排序时清除种子，保证 URL 与分页顺序一致。 */
export const withGalleryRandomSeed = (
    update: UnifiedToolbarLocationUpdate,
    createSeed: () => string = createGalleryRandomSeed,
): UnifiedToolbarLocationUpdate => {
    if (update.sort === undefined) return update;
    return { ...update, randomSeed: update.sort === 'random' ? createSeed() : undefined };
};
type UnifiedGalleryToolbarProps = Omit<
    GalleryNavigationBarProps,
    'compact' | 'className' | 'enableSearchShortcut' | 'location' | 'view' | 'folderPath' | 'currentPath'
    | 'search' | 'onSearch' | 'sort' | 'sortOption' | 'onSortChange'
    | 'layout' | 'layoutMode' | 'onLayoutChange' | 'filter' | 'onFilterChange'
> & {
    viewMode: ViewMode;
    location: GalleryLocation;
    onLocationChange: (update: UnifiedToolbarLocationUpdate, mode: 'push' | 'replace') => void;
};

export const UnifiedGalleryToolbar: React.FC<UnifiedGalleryToolbarProps> = ({
    viewMode,
    location,
    onLocationChange,
    ...navigationProps
}) => {
    if (!shouldRenderUnifiedGalleryToolbar(viewMode)) return null;

    const sharedProps: GalleryNavigationBarProps = {
        ...navigationProps,
        location,
        onSearch: (search) => {
            if (search !== location.search) onLocationChange({ search }, 'push');
        },
        sortOption: location.sort,
        onSortChange: (sort) => {
            if (sort !== location.sort) onLocationChange({ sort }, 'replace');
        },
        layoutMode: location.layout,
        onLayoutChange: (layout) => {
            if (layout !== location.layout) onLocationChange({ layout }, 'replace');
        },
        filter: location.filter,
        onFilterChange: (filter) => {
            if (filter !== location.filter) onLocationChange({ filter }, 'replace');
        },
    };

    return (
        <div className="px-3 pb-3 md:absolute md:inset-x-0 md:top-0 md:px-8 md:pt-4 md:pb-0 md:pointer-events-none md:z-35" data-testid="unified-gallery-toolbar">
            <div className="lg:hidden md:pointer-events-auto" data-testid="gallery-toolbar-compact-slot">
                <GalleryNavigationBar {...sharedProps} compact />
            </div>
            <div className="hidden lg:block md:pointer-events-auto" data-testid="gallery-toolbar-desktop-slot">
                <GalleryNavigationBar {...sharedProps} compact={false} />
            </div>
        </div>
    );
};

type SearchEmptyStateProps = {
    view: GalleryLocation['view'];
    folderPath: string;
    onLocationChange: (update: UnifiedToolbarLocationUpdate, mode: 'push' | 'replace') => void;
};

export const SearchEmptyState: React.FC<SearchEmptyStateProps> = ({
    view,
    folderPath,
    onLocationChange,
}) => {
    const { language } = useLanguage();
    const isChinese = language === 'zh';
    const folderName = folderPath.split('/').filter(Boolean).pop();
    const title = view === 'favorites'
        ? (isChinese ? '收藏夹中没有匹配的结果' : 'No matching results in Favorites')
        : view === 'folders'
            ? (isChinese
                ? `当前目录“${folderName || '根目录'}”中没有匹配的结果`
                : `No matching results in the current folder "${folderName || 'Root'}"`)
            : (isChinese ? '媒体库中没有匹配的结果' : 'No matching results in the media library');

    return (
        <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center text-text-tertiary"
            data-testid="search-empty-state"
        >
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                <Icons.Image size={40} className="opacity-30" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
            <p className="max-w-sm text-sm">
                {isChinese ? '请尝试其他关键词，或清除当前搜索。' : 'Try another keyword or clear the current search.'}
            </p>
            <button
                type="button"
                className="mt-6 px-5 py-2 rounded-full bg-primary hover:bg-primary/85 text-primary-foreground font-medium transition-colors"
                onClick={() => onLocationChange({ search: '' }, 'push')}
            >
                {isChinese ? '清除搜索' : 'Clear search'}
            </button>
        </div>
    );
};

export const GalleryLoadErrorBanner: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div
        role="alert"
        className="absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-red-400/30 bg-red-950/90 px-4 py-3 text-sm text-red-100 shadow-xl backdrop-blur-sm"
    >
        <span>当前目录加载失败，已保留上一次内容。</span>
        <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-red-400/15 px-3 py-1.5 font-medium text-red-50 hover:bg-red-400/25"
        >
            重试
        </button>
    </div>
);

type GalleryCacheBudgetEntry = {
    queryKey: readonly unknown[];
    itemCount: number;
    updatedAt: number;
};

export const getGalleryCacheEvictionKeys = (
    entries: GalleryCacheBudgetEntry[],
    maxEntries = 12,
    maxItems = 5_000,
    protectedQueryKey?: readonly unknown[],
) => {
    const newestFirst = [...entries].sort((left, right) => right.updatedAt - left.updatedAt);
    const sameQueryKey = (left: readonly unknown[], right: readonly unknown[]) => JSON.stringify(left) === JSON.stringify(right);
    const protectedEntry = protectedQueryKey
        ? newestFirst.find((entry) => sameQueryKey(entry.queryKey, protectedQueryKey))
        : newestFirst[0];
    let retainedItems = protectedEntry?.itemCount || 0;
    let retainedEntries = protectedEntry ? 1 : 0;
    return newestFirst.flatMap((entry, index) => {
        if (protectedEntry && sameQueryKey(entry.queryKey, protectedEntry.queryKey)) {
            return [];
        }
        const exceedsEntryLimit = retainedEntries >= maxEntries;
        const exceedsItemLimit = retainedItems + entry.itemCount > maxItems;
        if (exceedsEntryLimit || exceedsItemLimit) return [entry.queryKey];
        retainedItems += entry.itemCount;
        retainedEntries += 1;
        return [];
    });
};

const STORAGE_KEYS = {
    configFile: 'lumina-config.json', // keep filename stable for server compatibility
    users: 'luvia_users',
    viewMode: 'luvia_view_mode',
    appTitle: 'luvia_app_title',
    appSubtitle: 'luvia_app_subtitle',
    sources: 'luvia_sources',
    theme: 'luvia_theme',
    authUser: 'luvia_auth_user',
    currentPath: 'luvia_current_path',
    cacheHome: 'luvia_cache_home',
    token: 'luvia_token',
    isDesktopSidebarOpen: 'luvia_desktop_sidebar_open',
};

const LEGACY_KEYS = {
    users: 'lumina_users',
    viewMode: 'lumina_view_mode',
    appTitle: 'lumina_app_title',
    appSubtitle: 'lumina_app_subtitle',
    sources: 'lumina_sources',
    theme: 'lumina_theme',
    authUser: 'lumina_auth_user',
    currentPath: 'lumina_current_path',
    cacheHome: 'lumina_cache_home',
    token: 'lumina_token',
};

const CONFIG_FILE_NAME = STORAGE_KEYS.configFile;
const USERS_STORAGE_KEY = STORAGE_KEYS.users;
const VIEW_MODE_KEY = STORAGE_KEYS.viewMode;
const APP_TITLE_KEY = STORAGE_KEYS.appTitle;
const APP_SUBTITLE_KEY = STORAGE_KEYS.appSubtitle;
const SOURCES_STORAGE_KEY = STORAGE_KEYS.sources;
const THEME_STORAGE_KEY = STORAGE_KEYS.theme;
const AUTH_USER_KEY = STORAGE_KEYS.authUser;
const CURRENT_PATH_KEY = STORAGE_KEYS.currentPath;
const CACHE_HOME_KEY = STORAGE_KEYS.cacheHome;
const TOKEN_STORAGE_KEY = STORAGE_KEYS.token;
const IS_DESKTOP_SIDEBAR_OPEN_KEY = STORAGE_KEYS.isDesktopSidebarOpen;
const getStorageItem = (key: string, legacyKey?: string) => {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
    return legacyKey ? localStorage.getItem(legacyKey) : null;
};

const setStorageItem = (key: string, value: string, legacyKey?: string) => {
    localStorage.setItem(key, value);
    if (legacyKey) localStorage.removeItem(legacyKey);
};

const removeStorageItem = (key: string, legacyKey?: string) => {
    localStorage.removeItem(key);
    if (legacyKey) localStorage.removeItem(legacyKey);
};



function GalleryApp() {
    const { t, language, setLanguage } = useLanguage();
    const { confirm } = useFeedback();
    const queryClient = useQueryClient();
    const galleryNavigation = useGalleryNavigation();
    // patchItem：把收藏等外部状态变化实时回写播放器队列快照（播放器未打开时为无害 no-op）
    const { open: openPlayer, close: closePlayer, patchItem, state: playerState } = useMediaPlayer();
    const { canApplyLayoutPreference, applyInitialLayoutPreference } = galleryNavigation;
    const galleryViewportRef = useRef<ViewportCaptureHandle>(null);

    // --- Authentication State ---
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [authStep, setAuthStep] = useState<'loading' | 'setup' | 'login' | 'app'>('loading');
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [setupForm, setSetupForm] = useState({ username: '', password: '', confirmPassword: '' });
    const [authError, setAuthError] = useState('');
    const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

    // --- User Management State ---
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [userFormType, setUserFormType] = useState<'add' | 'reset' | 'rename'>('add');
    const [targetUser, setTargetUser] = useState<User | null>(null);
    // 用户编辑弹窗打开目录选择器时登记的回填函数：选中路径直接写回弹窗自身的表单
    const allowedPathPickRef = useRef<((path: string) => void) | null>(null);

    // --- Server Mode State ---
    const [isServerMode, setIsServerMode] = useState(false);
    const [libraryPaths, setLibraryPaths] = useState<string[]>([]);
    const [newPathInput, setNewPathInput] = useState('');

    // --- Server Pagination State ---
    const [serverTotal, setServerTotal] = useState(0); // Count for CURRENT view (folder or all)
    const [libraryTotalCount, setLibraryTotalCount] = useState(0); // Count for "All Photos" in sidebar
    const [serverOffset, setServerOffset] = useState(0);
    const [isInitialGalleryLoading, setIsInitialGalleryLoading] = useState(false);
    const [isInitialGallerySkeletonCovering, setIsInitialGallerySkeletonCovering] = useState(false);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [galleryReadyDatasetIdentity, setGalleryReadyDatasetIdentity] = useState('');
    const [hasMoreServer, setHasMoreServer] = useState(true);
    const [serverFolders, setServerFolders] = useState<any[]>([]); // Full list of folders from server
    const [serverFavoriteIds, setServerFavoriteIds] = useState<{ files: string[], folders: string[] }>({ files: [], folders: [] });
    const [systemStatus, setSystemStatus] = useState<ExtendedSystemStatus | null>(null);
    const [watcherLogs, setWatcherLogs] = useState<any[]>([]);
    const [showWatcherLogs, setShowWatcherLogs] = useState(false);

    // --- Scanning & Thumbnail Gen State ---
    const [isUnifiedModalOpen, setIsUnifiedModalOpen] = useState(false);

    // Scan State
    const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
    const [scanProgress, setScanProgress] = useState({ count: 0, currentPath: '', currentEngine: '' });

    // Thumb State
    const [thumbStatus, setThumbStatus] = useState<'idle' | 'scanning' | 'paused' | 'error'>('idle');
    const [thumbProgress, setThumbProgress] = useState({ count: 0, total: 0, currentPath: '' });
    const [smartScanResults, setSmartScanResults] = useState<{ missing: any[], error: any[], timestamp: number } | null>(null);


    // --- Refs ---
    const scanProgressRef = useRef({ count: 0 });
    const scanStatusRef = useRef<ScanStatus>('idle');
    const thumbStatusRef = useRef<'idle' | 'scanning' | 'paused' | 'error'>('idle');
    const unifiedPollerRef = useRef<SingleFlightPoller | null>(null);
    if (unifiedPollerRef.current === null) {
        unifiedPollerRef.current = new SingleFlightPoller({ delayMs: 1000 });
    }
    useEffect(() => () => unifiedPollerRef.current?.stop(), []);
    const navigationRequestEpochRef = useRef(0);
    const activeLocationKeyRef = useRef(galleryNavigation.location.key);
    const galleryAbortControllerRef = useRef<AbortController | null>(null);
    const activeGalleryFetchRequestIdRef = useRef(0);
    const endReachedLockRef = useRef(false);
    const resolvedLayoutPreferenceScopeRef = useRef<string | null>(null);
    const libraryTotalScopeRef = useRef('');
    const galleryContentScopeRef = useRef('');



    // --- App Data State ---
    const [allUserData, setAllUserData] = useState<Record<string, UserData>>({});
    const [appTitle, setAppTitle] = useState('Luvia Gallery');
    const [homeSubtitle, setHomeSubtitle] = useState('Your memories, beautifully organized. Rediscover your collection.');
    const [homeConfig, setHomeConfig] = useState<HomeScreenConfig>({ mode: 'random' });
    const [showDirPicker, setShowDirPicker] = useState(false);
    const [dirPickerContext, setDirPickerContext] = useState<'library' | 'userAllowedPaths' | 'wallpaper'>('library');

    // Derived state for current user
    const files = useMemo(() =>
        currentUser ? (allUserData[currentUser.username]?.files || []) : [],
        [currentUser, allUserData]
    );

    const favoriteFolderPaths = useMemo(() =>
        currentUser ? (allUserData[currentUser.username]?.favoriteFolderPaths || []) : [],
        [currentUser, allUserData]
    );

    const currentGalleryUserScope = currentUser ? getGalleryUserScopeFingerprint(currentUser) : '';
    useEffect(() => {
        setLibraryTotalCount((currentTotal) => resolveLibraryTotalCountForScope(
            libraryTotalScopeRef.current,
            currentGalleryUserScope,
            currentTotal,
        ));
        libraryTotalScopeRef.current = currentGalleryUserScope;
    }, [currentGalleryUserScope]);

    // --- View State ---
    const [viewMode, setViewMode] = useState<ViewMode>(() => galleryNavigation.location.view);
    const [layoutMode, setLayoutMode] = useState<GridLayout>(() => galleryNavigation.location.layout);
    const [currentPath, setCurrentPath] = useState<string>(() => galleryNavigation.location.folderPath);
    // 已提交搜索属于 URL；输入框草稿只在位置实际改变时才同步。
    const [sortOption, setSortOption] = useState<SortOption>(() => galleryNavigation.location.sort);
    const [filterOption, setFilterOption] = useState<FilterOption>(() => galleryNavigation.location.filter);
    const [activeSearch, setActiveSearch] = useState(() => galleryNavigation.location.search);
    const [galleryLoadError, setGalleryLoadError] = useState(false);
    const [galleryReloadNonce, setGalleryReloadNonce] = useState(0);
    // 丢弃位置缓存并触发数据集 effect 重新加载当前位置（扫描结束、批量删除等数据变更后使用）
    const reloadCurrentGallery = useCallback(() => {
        queryClient.removeQueries({ queryKey: ['galleryFiles'] });
        setGalleryReloadNonce(value => value + 1);
    }, [queryClient]);
    const lastSearchLocationKeyRef = useRef<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(() => {
        const stored = localStorage.getItem(IS_DESKTOP_SIDEBAR_OPEN_KEY);
        return stored !== 'false';
    });

    useEffect(() => {
        localStorage.setItem(IS_DESKTOP_SIDEBAR_OPEN_KEY, String(isDesktopSidebarOpen));
    }, [isDesktopSidebarOpen]);

    // --- REFS for Polling (Fixes Stale Closure) ---
    // These refs ensure the polling loop always accesses the latest state without closure issues
    const currentUserRef = useRef<User | null>(null);

    useEffect(() => {
        if (currentPath) setStorageItem(CURRENT_PATH_KEY, currentPath, LEGACY_KEYS.currentPath);
        else if (viewMode === 'home' || viewMode === 'all') removeStorageItem(CURRENT_PATH_KEY, LEGACY_KEYS.currentPath);
    }, [currentPath, viewMode]);

    // 导航位置 → 渲染镜像同步；播放器不再占用导航位置字段，打开/关闭与历史彻底解耦。
    useEffect(() => {
        const location = galleryNavigation.location;
        if (viewMode !== location.view) setViewMode(location.view);
        if (currentPath !== location.folderPath) setCurrentPath(location.folderPath);
        if (layoutMode !== location.layout) setLayoutMode(location.layout);
        if (sortOption !== location.sort) setSortOption(location.sort);
        if (filterOption !== location.filter) setFilterOption(location.filter);
        if (shouldSyncSearchDraft(lastSearchLocationKeyRef.current, location.key)) {
            lastSearchLocationKeyRef.current = location.key;
            setActiveSearch(location.search);
        }
    }, [currentPath, filterOption, galleryNavigation.location, layoutMode, sortOption, viewMode]);

    // 导航位置与播放器联动：位置 key 变化（后退/前进/任意视图切换）时收起播放器，
    // 保证"后退总能回到浏览流"；同位置内的关闭仍由 Esc/背景点击/关闭按钮完成。
    // 用上一次 key 的 ref 做比较：closePlayer 随 provider state 变化重建，
    // 若按 brief 以身份变化触发会在打开播放器后立即误关。
    const lastLocationKeyRef = useRef(galleryNavigation.location.key);
    useEffect(() => {
        const locationKey = galleryNavigation.location.key;
        if (lastLocationKeyRef.current === locationKey) return;
        lastLocationKeyRef.current = locationKey;
        closePlayer();
    }, [galleryNavigation.location.key, closePlayer]);

    useLayoutEffect(() => {
        const view = galleryNavigation.location.view;
        if (!currentUser || !getLayoutPreferenceView(view)) return;
        const scopeKey = `${window.location.origin}:${currentUser.username}:${view}`;
        if (resolvedLayoutPreferenceScopeRef.current === scopeKey) return;
        resolvedLayoutPreferenceScopeRef.current = scopeKey;
        const preferredLayout = resolveScopedGalleryLayout(localStorage, window.location.origin, currentUser.username, view);
        // 即使当前条目不能应用偏好，也必须在真实用户与有效 scope 到位时消费旧全局键。
        if (!canApplyLayoutPreference()) return;
        const nextLocation = applyInitialLayoutPreference(preferredLayout);
        if (layoutMode !== nextLocation.layout) setLayoutMode(nextLocation.layout);
    }, [applyInitialLayoutPreference, canApplyLayoutPreference, currentUser?.username, galleryNavigation.location.view, layoutMode]);


    // 导航控制器负责 URL 与历史初始化，应用只保留渲染镜像。
    useEffect(() => {
        initApp();
    }, []);
    useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

    // --- Audio Player State ---
    const [currentAudio, setCurrentAudio] = useState<MediaItem | null>(null);
    const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
    const [audioPlaylist, setAudioPlaylist] = useState<MediaItem[]>([]);
    const [currentAudioIndex, setCurrentAudioIndex] = useState(0);

    // --- Theme State ---
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
    const [mediaHoverZoomEnabled, setMediaHoverZoomEnabled] = useState(() =>
        readMediaHoverZoomPreference(typeof window === 'undefined' ? undefined : window.localStorage)
    );

    const handleMediaHoverZoomChange = (enabled: boolean) => {
        setMediaHoverZoomEnabled(enabled);
        writeMediaHoverZoomPreference(typeof window === 'undefined' ? undefined : window.localStorage, enabled);
    };

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
    const settingsTabRef = useRef<SettingsTab>('general');
    useEffect(() => { settingsTabRef.current = settingsTab; }, [settingsTab]);

    // Reset settings tab and fetch stats when closing
    useEffect(() => {
        if (!isSettingsOpen) {
            setSettingsTab('general');
        }
    }, [isSettingsOpen]);



    // --- Batch Operations State ---
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [thumbQueue, setThumbQueue] = useState<Array<{ id: string, name: string, total: number }>>([]);
    const concurrencyWarningShown = useRef(false);

    // --- Theme Logic ---
    useEffect(() => {
        const savedTheme = getStorageItem(THEME_STORAGE_KEY, LEGACY_KEYS.theme) as 'light' | 'dark' | 'system' | null;
        if (savedTheme) {
            setTheme(savedTheme);
        }
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applyTheme = () => {
            let effectiveTheme = theme;

            // Force Dark Mode on Home Page for immersive experience
            if (viewMode === 'home') {
                effectiveTheme = 'dark';
            } else if (theme === 'system') {
                effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
            }

            // Apply Theme Class
            if (effectiveTheme === 'dark') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }

            // Sync Status Bar (Meta Theme Color)
            // This ensures the status bar matches the FORCED theme or user theme
            let metaThemeColor = document.querySelector("meta[name=theme-color]");
            if (!metaThemeColor) {
                metaThemeColor = document.createElement('meta');
                metaThemeColor.setAttribute('name', 'theme-color');
                document.head.appendChild(metaThemeColor);
            }
            // 与设计令牌底色一致：暗房暖黑 / 画廊白墙
            metaThemeColor.setAttribute("content", effectiveTheme === 'dark' ? "#0e0c0b" : "#f4f1ec");
        };

        applyTheme();

        const handleChange = () => {
            // Re-eval only if we are NOT forced to dark (i.e. not on home) OR if we are on home it stays dark anyway
            applyTheme();
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme, viewMode]);

    const toggleTheme = () => {
        const next: Record<string, 'light' | 'dark' | 'system'> = {
            'system': 'light',
            'light': 'dark',
            'dark': 'system'
        };
        const newTheme = next[theme] || 'system';
        setTheme(newTheme);
        setStorageItem(THEME_STORAGE_KEY, newTheme, LEGACY_KEYS.theme);
    };

    const handleLogout = () => {
        queryClient.removeQueries({ queryKey: ['galleryFiles'] });
        removeStorageItem(TOKEN_STORAGE_KEY, LEGACY_KEYS.token);
        removeStorageItem(AUTH_USER_KEY, LEGACY_KEYS.authUser);
        removeStorageItem(CACHE_HOME_KEY, LEGACY_KEYS.cacheHome);
        setLibraryTotalCount(0);
        setCurrentUser(null);
        setAuthStep('login');
        // Optionally clear other user-specific state
        setAllUserData({});
        setServerFavoriteIds({ files: [], folders: [] });
    };

    // --- Secure Fetch Helper ---
    const apiFetch = async (url: string, options: RequestInit = {}) => {
        const token = getStorageItem(TOKEN_STORAGE_KEY, LEGACY_KEYS.token);
        const headers: any = { ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetchWithTimeout(url, { ...options, headers }, 15_000);

        if (res.status === 401) {
            removeStorageItem(TOKEN_STORAGE_KEY, LEGACY_KEYS.token);
            if (authStep === 'app') {
                handleLogout();
            }
        }
        return res;
    };

    const authFetch = apiFetch;




    const [threadCount, setThreadCount] = useState<number>(2);

    // --- Persistence Helper ---
    // --- Persistence Helper ---
    const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const persistData = async (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>, newLibraryPaths?: string[], newHomeSubtitle?: string, newHomeConfig?: HomeScreenConfig, newThreadCount?: number, debounce: boolean = false) => {
        const u = newUsers || users;
        const t = newTitle || appTitle;
        const s = newHomeSubtitle || homeSubtitle;
        const hc = newHomeConfig || homeConfig;
        const d = newAllUserData || allUserData;
        const l = newLibraryPaths || libraryPaths;
        const tc = newThreadCount !== undefined ? newThreadCount : threadCount;

        // Update React State immediately for local UI responsiveness
        if (newUsers) setUsers(newUsers);
        if (newTitle) setAppTitle(newTitle);
        if (newHomeSubtitle) setHomeSubtitle(newHomeSubtitle);
        if (newHomeConfig) setHomeConfig(newHomeConfig);
        if (newAllUserData) setAllUserData(newAllUserData);
        if (newLibraryPaths) setLibraryPaths(newLibraryPaths);
        if (newThreadCount !== undefined) setThreadCount(newThreadCount);

        const performPersist = async () => {
            // Construct Config Object
            const userSources: Record<string, any[]> = {};
            Object.keys(d).forEach(k => {
                userSources[k] = d[k]?.sources || [];
            });

            const config: AppConfig = {
                title: t,
                homeSubtitle: s,
                homeScreen: hc,
                users: u,
                userSources: userSources,
                libraryPaths: l,
                threadCount: tc,
                lastModified: Date.now()
            };

            if (isServerMode) {
                // Only Admins can sync global config
                if (currentUser && currentUser.isAdmin) {
                    try {
                        await apiFetch('/api/config', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(config)
                        });
                    } catch (e) {
                        console.error("Failed to sync to server", e);
                    }
                }
            } else {
                setStorageItem(USERS_STORAGE_KEY, JSON.stringify(u), LEGACY_KEYS.users);
                setStorageItem(APP_TITLE_KEY, t, LEGACY_KEYS.appTitle);
                setStorageItem(APP_SUBTITLE_KEY, s, LEGACY_KEYS.appSubtitle);
                setStorageItem(SOURCES_STORAGE_KEY, JSON.stringify(userSources), LEGACY_KEYS.sources);
            }
        };

        if (debounce) {
            if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
            persistTimeoutRef.current = setTimeout(performPersist, 1000); // 1 second debounce
        } else {
            performPersist();
        }
    };

    const initApp = async () => {
        // 深链免登录：macOS 悬浮窗等外部入口通过 ?token=<JWT> 打开时，
        // 先把 token 写入 localStorage（与登录成功后的存储键一致），
        // 再从地址栏移除，避免泄露到历史记录/截图
        const urlToken = new URLSearchParams(window.location.search).get('token');
        if (urlToken) {
            setStorageItem(TOKEN_STORAGE_KEY, urlToken, LEGACY_KEYS.token);
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        }

        let loadedUsers: User[] = [];
        let loadedData: Record<string, UserData> = {};
        let loadedTitle = 'Luvia Gallery';
        let loadedSubtitle = 'Your memories, beautifully organized. Rediscover your collection.';
        let loadedHomeConfig: HomeScreenConfig = { mode: 'random' };
        let serverMode = false;
        let loadedThreadCount = 2;

        try {
            // First try to check config (this endpoint is whitelist-protected but good to be safe)
            // Actually /api/config is protected for full data, public for basics.
            // If we have a token, use it to get full data (users with allowedPaths).
            // If we have a token, use it to get full data (users with allowedPaths).
            let res = await apiFetch('/api/config');

            // Fix: If token is invalid (401), apiFetch flushes it. Retry immediately to get public config.
            if (res.ok || res.status === 401) {
                serverMode = true; // Any response from /api means server mode
                setIsServerMode(true);

                if (res.status === 401) {
                    // If 401, we just set authStep to login if we can't get public info
                    // But actually we should try to get public config by retrying WITHOUT token
                    res = await fetch('/api/config'); // Raw fetch without token header
                }

                const text = await res.text();
                let config = null;
                try {
                    config = JSON.parse(text);
                } catch (e) { }

                if (config && config.configured !== false) {
                    if (config.users) {
                        loadedUsers = config.users;
                        config.users.forEach((u: User) => {
                            loadedData[u.username] = { sources: [], files: [], favoriteFolderPaths: [] };
                        });
                    } else if (config.username) {
                        // Scenario 2: Regular user login (sanitized info)
                        loadedUsers = [{
                            username: config.username,
                            isAdmin: config.role === 'admin',
                            allowedPaths: Array.isArray(config.allowedPaths) ? config.allowedPaths : [],
                        } as User];
                        loadedData[config.username] = { sources: [], files: [], favoriteFolderPaths: [] };
                    }
                    if (config.title) loadedTitle = config.title;
                    if (config.homeSubtitle) loadedSubtitle = config.homeSubtitle;
                    if (config.homeScreen) loadedHomeConfig = config.homeScreen;
                    if (config.libraryPaths) setLibraryPaths(config.libraryPaths);
                    if (config.threadCount) loadedThreadCount = config.threadCount;
                    setThreadCount(loadedThreadCount);
                } else if (config && config.configured === false) {
                    setAuthStep('setup');
                    return;
                }
            }
        } catch (e) {
            console.error("Init config error:", e);
        }

        // Fallback or Local
        if (!serverMode) {
            const storedUsers = getStorageItem(USERS_STORAGE_KEY, LEGACY_KEYS.users);
            const storedTitle = getStorageItem(APP_TITLE_KEY, LEGACY_KEYS.appTitle);
            const storedSubtitle = getStorageItem(APP_SUBTITLE_KEY, LEGACY_KEYS.appSubtitle);
            const storedSources = getStorageItem(SOURCES_STORAGE_KEY, LEGACY_KEYS.sources);

            if (storedUsers) {
                loadedUsers = JSON.parse(storedUsers);
                if (storedTitle) loadedTitle = storedTitle;
                if (storedSubtitle) loadedSubtitle = storedSubtitle;

                if (storedSources) {
                    const parsedSources = JSON.parse(storedSources);
                    Object.keys(parsedSources).forEach(username => {
                        loadedData[username] = { sources: parsedSources[username], files: [], favoriteFolderPaths: [] };
                    });
                } else {
                    loadedUsers.forEach((u: User) => loadedData[u.username] = { sources: [], files: [], favoriteFolderPaths: [] });
                }
            } else {
                // Fix: Reset state using correct setters
                setCurrentUser(null);
                setAllUserData({});
                setServerFavoriteIds({ files: [], folders: [] });
                setHomeConfig({ mode: 'random' });
                setHomeSubtitle('Your memories, beautifully organized. Rediscover your collection.');
                setSettingsTab('general');
                setAuthStep('setup');
                return;
            }
        }

        setUsers(loadedUsers);
        setAppTitle(loadedTitle);
        setHomeSubtitle(loadedSubtitle);
        setHomeConfig(loadedHomeConfig);

        // Check Persistent Login & Load Cache (Performance)
        const savedUser = getStorageItem(AUTH_USER_KEY, LEGACY_KEYS.authUser);
        const savedViewMode = getStorageItem(VIEW_MODE_KEY, LEGACY_KEYS.viewMode) as ViewMode;

        if (
            savedUser
            && (!savedViewMode || savedViewMode === 'all')
            && isDefaultGalleryCacheScope(
                galleryNavigation.location.view,
                galleryNavigation.location.folderPath,
                galleryNavigation.location.search,
                galleryNavigation.location.sort,
                galleryNavigation.location.filter,
            )
        ) {
            try {
                const cachedUser = loadedUsers.find(user => user.username === savedUser);
                const cData = cachedUser
                    ? readGalleryHomeCache(getStorageItem(CACHE_HOME_KEY, LEGACY_KEYS.cacheHome), cachedUser)
                    : null;
                if (cData && loadedData[savedUser]) {
                    loadedData[savedUser].files = cData.files;
                    galleryContentScopeRef.current = cData.userScope;
                    console.log('Processed Initial Cache:', cData.files.length);
                }
            } catch (e) { }
        }

        setAllUserData(loadedData);

        if (savedUser) {
            const user = loadedUsers.find(u => u.username === savedUser);
            if (user) {
                setCurrentUser(user);
                setAuthStep('app');

                if (serverMode) {
                    // Restore background task state
                    setTimeout(() => { void restoreBackgroundTasks(); }, 100);
                }
                return;
            }
        }

        setAuthStep('login');
    };

    // --- Server Logic: Scan & Poll ---

    const fetchServerFolders = async (parentPath: string | null = null, favoritesOnly = false, navigationEpoch?: number, locationKey?: string, signal?: AbortSignal, searchQuery = '') => {
        const guard = resolveGalleryRequestGuard(
            navigationEpoch,
            locationKey,
            signal,
            navigationRequestEpochRef.current,
            activeLocationKeyRef.current,
            galleryAbortControllerRef.current?.signal,
        );
        if (!isGalleryRequestGuardActive(guard, navigationRequestEpochRef.current, activeLocationKeyRef.current)) return true;
        try {
            const url = appendGalleryFolderQuery('/api/library/folders', parentPath, favoritesOnly, searchQuery);

            const res = await apiFetch(url, { signal: guard.signal });
            if (!res.ok) return false;
            const data = JSON.parse(await res.text());
            if (!data || !Array.isArray(data.folders)) return false;
            if (isGalleryRequestGuardActive(guard, navigationRequestEpochRef.current, activeLocationKeyRef.current)) {
                setServerFolders(data.folders);
            }
            return true;
        } catch (e) {
            if (guard.signal?.aborted) return true;
            console.error('Fetch folders failed', e);
            return false;
        }
    };

    const favFetchRef = useRef<Promise<any> | null>(null);
    const fetchServerFavorites = async () => {
        if (favFetchRef.current) return favFetchRef.current;

        favFetchRef.current = (async () => {
            console.log('[DEBUG] fetchServerFavorites called');
            try {
                const res = await apiFetch('/api/favorites/ids');
                if (res.ok) {
                    const data = await res.json();
                    setServerFavoriteIds(data);
                    return data;
                }
                return { files: [], folders: [] };
            } catch (e) {
                return { files: [], folders: [] };
            } finally {
                favFetchRef.current = null;
            }
        })();

        return favFetchRef.current;
    };

    const fetchServerFiles = async (
        username: string,
        currentData: Record<string, UserData>,
        offset: number = 0,
        reset: boolean = false,
        folderFilter: string | null = null,
        favoritesOnly: boolean = false,
        favoriteIdsOverride?: { files: string[], folders: string[] },
        recursiveFavorites: boolean = false,
        searchQuery?: string,
        navigationEpoch?: number,
        locationKey?: string,
        signal?: AbortSignal,
        mediaFilterOverride?: FilterOption,
        sortOverride?: SortOption,
        manageInitialLoading = false,
    ) => {
        const guard = resolveGalleryRequestGuard(
            navigationEpoch,
            locationKey,
            signal,
            navigationRequestEpochRef.current,
            activeLocationKeyRef.current,
            galleryAbortControllerRef.current?.signal,
        );
        if (!isGalleryRequestGuardActive(guard, navigationRequestEpochRef.current, activeLocationKeyRef.current)) return true;
        const requestId = ++activeGalleryFetchRequestIdRef.current;
        try {
            if (reset && manageInitialLoading) setIsInitialGalleryLoading(true);
            setIsFetchingMore(true);
            const limit = GALLERY_PAGE_SIZE;
            let url = `/api/scan/results?offset=${offset}&limit=${limit}`;
            const effectiveFilter = mediaFilterOverride ?? galleryNavigation.location.filter;
            const effectiveSort = sortOverride ?? galleryNavigation.location.sort;

            const mapSort = (opt: SortOption) => {
                switch (opt) {
                    case 'dateAsc': return 'dateAsc';
                    case 'nameAsc': return 'nameAsc';
                    case 'nameDesc': return 'nameDesc';
                    case 'sizeDesc': return 'sizeDesc';
                    case 'random': return null; // handled separately
                    case 'dateDesc':
                    default: return 'dateDesc';
                }
            };

            if (effectiveSort === 'random') {
                // 携带位置中的随机种子，服务端据此生成跨页稳定的随机顺序
                url += `&random=true&seed=${resolveGalleryRandomSeed(galleryNavigation.location.randomSeed)}`;
            } else {
                const sortParam = mapSort(effectiveSort);
                if (sortParam) url += `&sort=${sortParam}`;
            }

            const effectiveSearch = searchQuery !== undefined ? searchQuery : galleryNavigation.location.search;
            url = appendGalleryScanScopeQuery(url, folderFilter, favoritesOnly, effectiveSearch);
            url = appendGalleryMediaTypeQuery(url, effectiveFilter);
            void recursiveFavorites; // 兼容现有调用签名；收藏夹请求固定不递归。

            const res = await apiFetch(url, { signal: guard.signal });
            if (!res.ok) throw new Error(`API Error: ${res.status}`);

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error("Invalid JSON response");
            }

            if (!data) throw new Error("Empty response data");
            if (!isGalleryRequestGuardActive(guard, navigationRequestEpochRef.current, activeLocationKeyRef.current)) return true;

            // Map isFavorite property - Trust server provided isFavorite
            // But if we have an explicit override (optimistic UI), we could check it. 
            // Since we trust server logic (JOIN), we can use file.isFavorite.
            // Only fall back to favIds list if server didn't provide it (legacy safety).
            const favIds = favoriteIdsOverride || serverFavoriteIds;
            console.log('[DEBUG] Files mapping checks complete');

            const filesWithFavorites = data.files.map((file: MediaItem) => ({
                ...file,
                isFavorite: file.isFavorite !== undefined ? file.isFavorite : (favIds.files.includes(file.path) || favIds.files.includes(file.id))
            }));

            const prevFiles = currentData[username]?.files || [];
            const existingIds = new Set(prevFiles.map(f => f.id));
            const uniqueNew = filesWithFavorites.filter(f => !existingIds.has(f.id));
            const newFiles = reset ? filesWithFavorites : [...prevFiles, ...uniqueNew];
            console.log('[DEBUG] Total files to set:', newFiles.length);

            // 随机分页没有新增项时，显式结束后续加载。
            if (effectiveSort === 'random' && !reset && uniqueNew.length === 0) {
                setHasMoreServer(false);
            }

            setAllUserData({
                ...currentData,
                [username]: {
                    ...currentData[username],
                    files: newFiles,
                    sources: data.sources
                }
            });
            galleryContentScopeRef.current = currentGalleryUserScope;

            setServerTotal(data.total);
            const isDefaultFullLibraryRequest = isDefaultGalleryCacheScope(
                galleryNavigation.location.view,
                galleryNavigation.location.folderPath,
                effectiveSearch,
                effectiveSort,
                effectiveFilter,
            ) && folderFilter === null && !favoritesOnly;
            if (isDefaultFullLibraryRequest && data.totalExact === true) {
                setLibraryTotalCount(data.total);
            }

            if (isDefaultFullLibraryRequest && offset === 0 && currentUser) {
                try {
                    const cacheData = createGalleryHomeCachePayload(
                        currentUser,
                        filesWithFavorites.slice(0, GALLERY_PAGE_SIZE),
                        data.total,
                    );
                    setStorageItem(CACHE_HOME_KEY, JSON.stringify(cacheData), LEGACY_KEYS.cacheHome);
                } catch (e) { console.error('Cache save failed', e); }
            }


            setServerOffset(offset + limit);
            setHasMoreServer(data.hasMore);

            return true;

        } catch (e) {
            console.error("Fetch files failed", e);
            return Boolean(guard.signal?.aborted);
        } finally {
            if (shouldUpdateGalleryFetchingState(
                activeGalleryFetchRequestIdRef.current,
                requestId,
                isGalleryRequestGuardActive(guard, navigationRequestEpochRef.current, activeLocationKeyRef.current),
            )) {
                setIsFetchingMore(false);
                if (reset && manageInitialLoading) setIsInitialGalleryLoading(false);
            }
        }
    };

    const getGalleryQueryKey = useCallback((location: GalleryLocation) => createGalleryQueryKey({
        username: currentGalleryUserScope,
        view: location.view,
        folderPath: location.folderPath,
        search: location.search,
        sort: location.sort,
        filter: location.filter,
        randomSeed: Number(location.randomSeed) || 0,
        layout: location.layout,
    }), [currentGalleryUserScope]);

    const galleryDatasetIdentity = getGalleryDatasetIdentity(currentGalleryUserScope, galleryNavigation.location);

    const pruneGalleryCache = useCallback((protectedQueryKey?: readonly unknown[]) => {
        const entries = queryClient.getQueryCache().findAll({ queryKey: ['galleryFiles'] }).map((query) => {
            const page = query.state.data as GalleryPageCache | undefined;
            return {
                queryKey: query.queryKey,
                itemCount: page?.files.length || 0,
                updatedAt: query.state.dataUpdatedAt,
            };
        });
        getGalleryCacheEvictionKeys(entries, 12, 5_000, protectedQueryKey).forEach((queryKey) => {
            queryClient.removeQueries({ queryKey, exact: true });
        });
    }, [queryClient]);

    const cacheCurrentGallery = useCallback(() => {
        if (!currentUser || !shouldCacheCurrentGallery(isInitialGalleryLoading, isInitialGallerySkeletonCovering, galleryLoadError)) return;
        const queryKey = getGalleryQueryKey(galleryNavigation.location);
        const cached: GalleryPageCache = {
            files: allUserData[currentUser.username]?.files || [],
            serverFolders,
            serverOffset,
            serverTotal,
            hasMoreServer,
        };
        queryClient.setQueryData(queryKey, cached);
        pruneGalleryCache(queryKey);
    }, [allUserData, currentUser, galleryLoadError, galleryNavigation.location, getGalleryQueryKey, hasMoreServer, isInitialGalleryLoading, isInitialGallerySkeletonCovering, pruneGalleryCache, queryClient, serverFolders, serverOffset, serverTotal]);

    useEffect(() => {
        queryClient.removeQueries({ queryKey: ['galleryFiles'] });
    }, [currentGalleryUserScope, queryClient]);

    useEffect(() => {
        if (authStep !== 'app' || !currentUser || !isServerMode) return;
        const location = galleryNavigation.location;
        galleryAbortControllerRef.current?.abort();
        const abortController = new AbortController();
        galleryAbortControllerRef.current = abortController;
        const epoch = activateGalleryLocation(navigationRequestEpochRef, activeLocationKeyRef, location.key);
        endReachedLockRef.current = false;
        activeGalleryFetchRequestIdRef.current += 1;
        setIsFetchingMore(false);
        setIsInitialGalleryLoading(false);
        setIsInitialGallerySkeletonCovering(false);
        setGalleryReadyDatasetIdentity('');
        const cached = queryClient.getQueryData<GalleryPageCache>(getGalleryQueryKey(location));
        if (cached) {
            setGalleryLoadError(false);
            galleryContentScopeRef.current = currentGalleryUserScope;
            setAllUserData((data) => ({
                ...data,
                [currentUser.username]: { ...data[currentUser.username], files: cached.files },
            }));
            setServerFolders(cached.serverFolders);
            setServerOffset(cached.serverOffset);
            setServerTotal(cached.serverTotal);
            setHasMoreServer(cached.hasMoreServer);
            setGalleryReadyDatasetIdentity(galleryDatasetIdentity);
            return;
        }

        const shouldPreserveHydratedFiles = shouldPreserveGalleryHydratedFiles(
            isDefaultGalleryCacheScope(
                location.view,
                location.folderPath,
                location.search,
                location.sort,
                location.filter,
            ),
            galleryContentScopeRef.current,
            currentGalleryUserScope,
            serverOffset,
            allUserData[currentUser.username]?.files.length || 0,
        );
        const shouldCoverWithSkeleton = shouldCoverGalleryWithInitialSkeleton(false, shouldPreserveHydratedFiles);
        if (!shouldPreserveHydratedFiles) {
            setAllUserData((data) => ({
                ...data,
                [currentUser.username]: { ...data[currentUser.username], files: [] },
            }));
        }
        setServerOffset(0);
        setServerTotal(0);
        setServerFolders([]);
        setHasMoreServer(true);
        setIsInitialGalleryLoading(true);
        setIsInitialGallerySkeletonCovering(shouldCoverWithSkeleton);

        const folderFilter = location.view === 'folders' ? location.folderPath : null;
        const favoritesOnly = location.view === 'favorites';
        const load = async () => {
            setGalleryLoadError(false);
            try {
                const favoriteIds = favoritesOnly ? await fetchServerFavorites() : undefined;
                if (!isActiveGalleryRequest(navigationRequestEpochRef.current, epoch, activeLocationKeyRef.current, location.key)) return;
                const results = await waitForGalleryLocationResults(
                    fetchServerFiles(currentUser.username, allUserData, 0, true, folderFilter, favoritesOnly, favoriteIds, false, location.search, epoch, location.key, abortController.signal, location.filter, location.sort, false),
                    fetchServerFolders(folderFilter, favoritesOnly, epoch, location.key, abortController.signal, location.search),
                );
                if (
                    results.some(result => result === false)
                    && isActiveGalleryRequest(navigationRequestEpochRef.current, epoch, activeLocationKeyRef.current, location.key)
                ) {
                    setGalleryLoadError(true);
                } else if (isActiveGalleryRequest(navigationRequestEpochRef.current, epoch, activeLocationKeyRef.current, location.key)) {
                    setGalleryReadyDatasetIdentity(resolveReadyGalleryDatasetIdentity(results, galleryDatasetIdentity));
                }
            } finally {
                if (
                    !abortController.signal.aborted
                    && isActiveGalleryRequest(navigationRequestEpochRef.current, epoch, activeLocationKeyRef.current, location.key)
                ) {
                    setIsInitialGalleryLoading(false);
                    setIsInitialGallerySkeletonCovering(false);
                }
            }
        };
        void load();
        return () => abortController.abort();
    }, [authStep, currentGalleryUserScope, galleryDatasetIdentity, galleryReloadNonce, getGalleryQueryKey, isServerMode, queryClient]);

    const loadMoreServerFiles = async () => {
        if (!canLoadNextGalleryPage({
            isServerMode,
            hasCurrentUser: Boolean(currentUser),
            hasMore: hasMoreServer,
            isFetching: isFetchingMore,
            isInitialLoading: isInitialGalleryLoading,
            isInitialSkeletonCovering: isInitialGallerySkeletonCovering,
            serverOffset,
            readyDatasetIdentity: galleryReadyDatasetIdentity,
            currentDatasetIdentity: galleryDatasetIdentity,
        }) || !currentUser) return;
        const filter = viewMode === 'folders' ? currentPath : null;
        const favs = viewMode === 'favorites';

        const requestEpoch = navigationRequestEpochRef.current;
        const requestLocationKey = activeLocationKeyRef.current;
        await runWithGalleryPaginationLock(endReachedLockRef, async () => {
            await fetchServerFiles(currentUser.username, allUserData, serverOffset, false, filter, favs, undefined, false, galleryNavigation.location.search, requestEpoch, requestLocationKey, galleryAbortControllerRef.current?.signal, galleryNavigation.location.filter, galleryNavigation.location.sort);
        });
    };

    // 首页轮播素材独立于画廊数据集：按首页配置向服务端单独取一小批随机样本，不污染当前画廊列表。
    const [homeFeaturedItems, setHomeFeaturedItems] = useState<MediaItem[]>([]);
    useEffect(() => {
        if (!isServerMode || !currentUser || viewMode !== 'home') return;
        const abortController = new AbortController();
        const loadFeatured = async () => {
            try {
                const res = await apiFetch(buildHomeFeaturedQuery(homeConfig), { signal: abortController.signal });
                if (!res.ok) return;
                const data = await res.json();
                if (!abortController.signal.aborted && Array.isArray(data?.files)) setHomeFeaturedItems(data.files);
            } catch (e) {
                if (!abortController.signal.aborted) console.error('[Home] Failed to load featured media', e);
            }
        };
        void loadFeatured();
        return () => abortController.abort();
    }, [isServerMode, currentUser, viewMode, homeConfig.mode, homeConfig.path]);

    // Re-fetch from server when sort changes to get globally ordered pages
    // 排序、筛选和搜索均由 GalleryLocation 变更触发加载，避免与 History 形成第二入口。

    const stopPolling = () => {
        unifiedPollerRef.current?.stop();
    };

    const fetchSystemStatus = async (forceCheck = false) => {
        if (!isServerMode && !forceCheck) return;
        try {
            const res = await apiFetch('/api/system/status');
            if (res.ok) {
                const data = await res.json();
                setSystemStatus(data);
            } else {
                setSystemStatus(null);
            }
        } catch (e) {
            setSystemStatus(null);
        }
    };

    const handleMonitorUpdate = async (mode: 'realtime' | 'periodic' | 'manual', interval?: number) => {
        if (!isServerMode) return;
        try {
            const res = await apiFetch('/api/system/monitor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, interval, enabled: mode !== 'manual' }) // enabled for legacy back-compat
            });
            if (res.ok) {
                const data = await res.json();
                setSystemStatus(prev => prev ? {
                    ...prev,
                    mode: data.mode || mode,
                    scanInterval: interval
                } : prev);

                if (mode !== 'manual') {
                    fetchWatcherLogs();
                }
            }
        } catch (e) { }
    };

    const fetchWatcherLogs = async () => {
        if (!isServerMode) return;
        try {
            const res = await apiFetch('/api/watcher/logs');
            if (res.ok) {
                const data = await res.json();
                setWatcherLogs(data.logs || []);
            }
        } catch (e) { }
    };

    const handleFetchSmartResults = async () => {
        try {
            const res = await authFetch('/api/thumb/smart-results');
            if (res.ok) setSmartScanResults(await res.json());
        } catch (e) { }
    };

    // 任务全部结束后是否重新加载当前位置：手动任务需要刷新结果，定时扫描不打断浏览
    const reloadWhenTasksIdleRef = useRef(false);

    const startUnifiedPolling = ({ reloadWhenIdle = true }: { reloadWhenIdle?: boolean } = {}) => {
        if (reloadWhenIdle) reloadWhenTasksIdleRef.current = true;
        unifiedPollerRef.current?.start(async (signal) => {
            try {
                const [scanRes, thumbRes] = await Promise.all([
                    apiFetch('/api/scan/status', { signal }),
                    apiFetch('/api/thumb-gen/status', { signal })
                ]);

                if (scanRes.ok) {
                    const scanData = await scanRes.json();
                    setScanStatus(scanData.status);
                    setScanProgress({ count: scanData.count, currentPath: scanData.currentPath || '', currentEngine: '' });
                    scanStatusRef.current = scanData.status;
                }

                if (thumbRes.ok) {
                    const thumbData = await thumbRes.json();
                    setThumbStatus(thumbData.status);
                    thumbStatusRef.current = thumbData.status;
                    if (thumbData.status === 'scanning' || thumbData.status === 'paused') {
                        setThumbProgress({
                            count: thumbData.count || 0,
                            total: thumbData.total || 0,
                            currentPath: thumbData.currentPath || ''
                        });
                    }
                }
            } catch (e) {
                if (!signal.aborted) console.error('[Polling] Failed to refresh background task state', e);
            }

            const isScanActive = scanStatusRef.current === 'scanning' || scanStatusRef.current === 'paused';
            const isThumbActive = thumbStatusRef.current === 'scanning' || thumbStatusRef.current === 'paused';

            if (isScanActive || isThumbActive) {
                return true;
            } else {
                fetchSystemStatus();
                if (settingsTabRef.current === 'system' && currentUserRef.current?.isAdmin) {
                    handleFetchSmartResults();
                }
                // 任务结束后统一走数据集 effect 重新加载当前位置，保证目录/收藏/搜索/排序语义一致
                if (currentUserRef.current && reloadWhenTasksIdleRef.current) reloadCurrentGallery();
                reloadWhenTasksIdleRef.current = false;
                return false;
            }
        });
    };

    /** 页面加载时恢复后台任务状态；仅手动扫描与缩略图任务自动弹出进度窗口。 */
    const restoreBackgroundTasks = async (isActive: () => boolean = () => true) => {
        try {
            const [scanRes, thumbRes] = await Promise.all([
                apiFetch('/api/scan/status'),
                apiFetch('/api/thumb-gen/status')
            ]);
            const scanData = scanRes.ok ? await scanRes.json() : null;
            const thumbData = thumbRes.ok ? await thumbRes.json() : null;
            if (!isActive()) return;

            const scanActive = isBackgroundTaskActive(scanData?.status);
            const thumbActive = isBackgroundTaskActive(thumbData?.status);
            if (scanActive) {
                setScanStatus(scanData.status);
                setScanProgress({ count: scanData.count, currentPath: scanData.currentPath || '', currentEngine: '' });
                scanStatusRef.current = scanData.status;
            }
            if (thumbActive) {
                setThumbStatus(thumbData.status);
                setThumbProgress({ count: thumbData.count, total: thumbData.total, currentPath: thumbData.currentPath });
                thumbStatusRef.current = thumbData.status;
            }
            if (!scanActive && !thumbActive) return;

            const userInitiated = shouldAutoOpenTaskProgress(scanData, thumbData);
            if (userInitiated) setIsUnifiedModalOpen(true);
            startUnifiedPolling({ reloadWhenIdle: userInitiated });
        } catch (e) {
            console.error('[Restore] Failed to check background tasks', e);
        }
    };

    const handleSmartScan = async () => {
        console.log("Starting Smart Scan v2...");
        try {
            const res = await authFetch('/api/thumb/smart-scan', { method: 'POST' });
            if (!res.ok) {
                console.error("Smart scan request failed:", res.status, res.statusText);
                return;
            }
            setThumbStatus('scanning');
            thumbStatusRef.current = 'scanning';
            setIsUnifiedModalOpen(true);
            startUnifiedPolling();
        } catch (e) { console.error("Smart scan failed:", e); }
    };

    const handleSmartRepair = async () => {
        try {
            await authFetch('/api/thumb/smart-repair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repairMissing: true, repairError: true })
            });
            setThumbStatus('scanning');
            thumbStatusRef.current = 'scanning';
            setIsUnifiedModalOpen(true);
            startUnifiedPolling();
        } catch (e) { console.error(e); }
    };



    const startServerScan = async () => {
        if (!isServerMode || !currentUser) return;

        // Optimistic UI: Open modal immediately
        setIsUnifiedModalOpen(true);
        setScanStatus('scanning');
        scanStatusRef.current = 'scanning';

        // Ensure polling starts to pick up progress once server is ready
        startUnifiedPolling();

        try {
            const startRes = await apiFetch('/api/scan/start', { method: 'POST' });
            if (!startRes.ok && startRes.status !== 409) {
                // Revert if failed (except 409 conflict which means already running)
                setScanStatus('idle');
                scanStatusRef.current = 'idle';
                notify.error(t('scan_start_failed'));
            }
        } catch (e) {
            setScanStatus('idle');
            scanStatusRef.current = 'idle';
            notify.error(t('scan_start_failed'), t('network_error'));
        }
    };

    const startThumbnailGen = async () => {
        if (!isServerMode || !currentUser) return;

        // Optimistic UI: Open modal immediately
        setIsUnifiedModalOpen(true);
        setThumbStatus('scanning');
        thumbStatusRef.current = 'scanning';

        startUnifiedPolling();

        try {
            const startRes = await apiFetch('/api/thumb-gen/start', { method: 'POST' });
            if (!startRes.ok && startRes.status !== 409) {
                setThumbStatus('idle');
                thumbStatusRef.current = 'idle';
                notify.error(t('thumb_start_failed'));
            }
        } catch (e) {
            setThumbStatus('idle');
            thumbStatusRef.current = 'idle';
            notify.error(t('thumb_start_failed'), t('network_error'));
        }
    };

    const clearCache = async () => {
        if (!isServerMode) return;
        if (!await confirm({ title: t('clear_cache_title'), description: t('clear_cache_desc'), confirmText: t('clear_action'), destructive: true })) return;
        try {
            await apiFetch('/api/cache/clear', { method: 'POST' });
            setSmartScanResults(null); // Clear local scan results as they are now invalid
            fetchSystemStatus(true);
            notify.success(t('cache_cleared'));
        } catch (e) { notify.error(t('network_error')); }
    };

    const pruneCache = async () => {
        if (!isServerMode) return;
        try {
            const res = await apiFetch('/api/cache/prune', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                notify.success(t('cache_pruned'), String(data.count));
                fetchSystemStatus(true);
            }
        } catch (e) { notify.error(t('network_error')); }
    };

    const handleRegenerateFolder = async (folderPathArg?: string) => {
        const targetPath = folderPathArg || currentPath;
        if (!isServerMode || !targetPath || isRegenerating) return;
        if (!await confirm({ title: t('regenerate_title'), description: t('confirm_regenerate_folder'), confirmText: t('regenerate_action') })) return;

        setIsRegenerating(true);
        // Optimistic UI update
        setThumbStatus('scanning');
        setIsUnifiedModalOpen(true);
        startUnifiedPolling(); // Start polling immediately

        try {
            const res = await apiFetch('/api/thumb/regenerate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: targetPath })
            });
            if (res.ok) {
                // Success - background task started. Polling will pick up status.
                // We don't need to alert.
            } else {
                notify.error(t('regenerate_failed'));
                setIsUnifiedModalOpen(false); // Close if failed to start
            }
        } catch (e) {
            notify.error(t('network_error'));
            setIsUnifiedModalOpen(false);
        } finally {
            setIsRegenerating(false);
        }
    };

    // Restore State on Mount
    useEffect(() => {
        let isMounted = true;
        if (isServerMode && currentUser) {
            fetchSystemStatus(true);
            fetchServerFavorites();

            void restoreBackgroundTasks(() => isMounted);
        }
        return () => {
            isMounted = false;
            stopPolling();
        };
    }, [isServerMode, currentUser]);

    const [isScanReportOpen, setIsScanReportOpen] = useState(false);

    const handleBatchDelete = async (ids: string[]) => {
        try {
            const res = await apiFetch('/api/file/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds: ids })
            });
            if (res.ok) {
                const data = await res.json();
                // Refresh scan results
                handleFetchSmartResults();
                // Optionally refresh file list if we want to be perfect, 
                // but smart scan result update is most important for the modal.
                // And refreshing file list might be heavy.
                // But deleted files should disappear.
                // Let's filter them out locally for immediate feedback if possible, 
                // but a re-fetch is safer.
                if (isServerMode && currentUser) {
                    reloadCurrentGallery();
                }
            }
        } catch (e) {
            console.error(e);
            throw e;
        }
    };

    // --- Effects for Auto-Open Report ---
    // Monitor scan status to auto-open report if errors found
    useEffect(() => {
        if (scanStatus === 'idle' && isServerMode) {
            // If we just finished a scan and have errors, maybe prompt? 
            // But valid "smartResults" might be old. 
            // Ideally we check if timestamp is very recent. 
            // For now, let's just rely on manual button or user intent.
        }
    }, [scanStatus, isServerMode]);

    const handleUnifiedClose = () => {
        // If both idle, we can close
        // If one is active, user probably just wants to hide the modal? 
        // Or we strictly follow: Close button only appears if both IDLE (in Component).
        // So here we just set open false.
        setIsUnifiedModalOpen(false);
        handleFetchSmartResults(); // Refresh results on close to update UI counts
    };

    // Control Handlers
    const controlScan = async (action: 'pause' | 'resume' | 'stop') => {
        // Map 'stop' to 'cancel' for API if needed, or update API to accept 'stop'
        // API accepts 'stop' or 'cancel'. 'stop' is safer for user intent (graceful).
        try {
            await apiFetch('/api/scan/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action === 'stop' ? 'cancel' : action })
            });
            // Optimistic update
            if (action === 'pause') setScanStatus('paused');
            if (action === 'resume') { setScanStatus('scanning'); startUnifiedPolling(); }
            if (action === 'stop') setScanStatus('cancelled');
        } catch (e) { }
    };

    const controlThumb = async (action: 'pause' | 'resume' | 'stop' | 'cancel-item', taskId?: string) => {
        // Map 'stop' to 'cancel'
        try {
            await apiFetch('/api/thumb-gen/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action === 'stop' ? 'cancel' : action, taskId })
            });
            if (action === 'pause') setThumbStatus('paused');
            if (action === 'resume') { setThumbStatus('scanning'); startUnifiedPolling(); }
            if (action === 'stop') setThumbStatus('idle'); // Optimistic
            // For cancel-item, polling will update the queue
        } catch (e) { }
    };

    const handleCancelTask = (id: string) => {
        controlThumb('cancel-item', id);
    };


    const resolveTargetLayout = useCallback((view: GalleryLocation['view']): GridLayout =>
        resolveScopedGalleryLayout(localStorage, window.location.origin, currentUser?.username, view),
    [currentUser?.username]);

    const advanceGalleryDatasetNavigation = (nextLocation: GalleryLocation): boolean => {
        if (!shouldAdvanceGalleryNavigationEpoch(currentGalleryUserScope, galleryNavigation.location, nextLocation)) return false;
        cacheCurrentGallery();
        navigationRequestEpochRef.current += 1;
        return true;
    };

    const resolveNextGalleryLocation = (update: Partial<Omit<GalleryLocation, 'key'>>): GalleryLocation => ({
        ...galleryNavigation.location,
        ...update,
        key: galleryNavigation.location.key,
    });

    const handleGalleryLocationChange = (rawUpdate: UnifiedToolbarLocationUpdate, mode: 'push' | 'replace') => {
        const update = withGalleryRandomSeed(rawUpdate);
        advanceGalleryDatasetNavigation(resolveNextGalleryLocation(update));
        if (typeof update.search === 'string') setActiveSearch(update.search);
        if (update.layout) {
            setLayoutMode(update.layout);
            if (currentUser) {
                writeGalleryLayoutPreference(localStorage, {
                    serverId: window.location.origin,
                    userId: currentUser.username,
                    view: galleryNavigation.location.view,
                }, update.layout);
            }
        }
        galleryNavigation.updateLocation(update, mode);
    };

    const handleSetViewMode = async (mode: ViewMode) => {
        const locationUpdate = createTopLevelViewLocationUpdate(
            galleryNavigation.location.view,
            mode,
            resolveTargetLayout(mode),
        );
        advanceGalleryDatasetNavigation(resolveNextGalleryLocation(locationUpdate));
        setStorageItem(VIEW_MODE_KEY, mode, LEGACY_KEYS.viewMode);
        if (locationUpdate.search === '') setActiveSearch('');
        galleryNavigation.updateLocation(locationUpdate, 'push');
    };

    const handleFolderClick = (path: string) => {
        const update = {
            view: 'folders',
            folderPath: path,
            layout: resolveTargetLayout('folders'),
        } as const;
        advanceGalleryDatasetNavigation(resolveNextGalleryLocation(update));
        galleryNavigation.updateLocation(update, 'push');
    };

    const handleGoBackFolder = () => {
        advanceGalleryDatasetNavigation(resolveNextGalleryLocation({
            view: 'folders',
            folderPath: getParentFolderPath(galleryNavigation.location.folderPath),
        }));
        galleryNavigation.up();
    };

    const handleJumpToFolder = (item: MediaItem) => {
        handleFolderClick(item.folderPath);
    };

    // User Management Handlers
    const handleAddUser = () => {
        setTargetUser(null);
        setUserFormType('add');
        setIsUserModalOpen(true);
    };

    const handleDeleteUser = async (user: User) => {
        if (user.username === currentUser?.username) return; // Can't delete self
        if (await confirm({ title: t('delete_user_title'), description: user.username, confirmText: t('delete_action'), destructive: true })) {
            const updatedUsers = users.filter(u => u.username !== user.username);
            const updatedData = { ...allUserData };
            delete updatedData[user.username];
            persistData(updatedUsers, undefined, updatedData);
        }
    };

    const handleResetPassword = (user: User) => {
        setTargetUser(user);
        setUserFormType('reset');
        setIsUserModalOpen(true);
    };

    const handleRenameUser = (user: User) => {
        setTargetUser(user);
        setUserFormType('rename');
        setIsUserModalOpen(true);
    };

    const handleUserFormSubmit = async (formData: any) => {
        try {
            const pathsArray = formData.allowedPaths.split(/[\n,]/).map((p: string) => p.trim()).filter(Boolean);

            if (userFormType === 'add') {
                if (!formData.username || !formData.password) return;
                const res = await apiFetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: formData.username,
                        password: formData.password,
                        isAdmin: formData.isAdmin,
                        allowedPaths: pathsArray
                    })
                });
                if (!res.ok) throw new Error(await res.text());
            } else if (userFormType === 'rename' && targetUser) {
                const res = await apiFetch(`/api/users/${encodeURIComponent(targetUser.username)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        newUsername: formData.username !== targetUser.username ? formData.username : undefined,
                        newPassword: formData.password || undefined,
                        allowedPaths: pathsArray
                    })
                });
                if (!res.ok) throw new Error(await res.text());
            } else if (userFormType === 'reset' && targetUser) {
                const res = await apiFetch(`/api/users/${encodeURIComponent(targetUser.username)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        newPassword: formData.password,
                        isAdmin: formData.isAdmin // Also allow updating role
                    })
                });
                if (!res.ok) throw new Error(await res.text());
            }

            // Allow time for file write
            await new Promise(r => setTimeout(r, 500));
            // Refresh app state without full reload to preserve logs
            await initApp();
            setIsUserModalOpen(false); // Close modal on success
        } catch (error) {
            console.error(error);
            notify.error(t('user_save_failed'), error instanceof Error ? error.message : undefined);
        }
    };

    const handleToggleFavorite = async (item: MediaItem | string, type: 'file' | 'folder') => {
        if (!currentUser) return;

        // 1. Resolve Target ID and Current Status
        let targetId: string;
        let currentStatus = false;

        if (type === 'file') {
            if (typeof item === 'string') {
                // Fallback or error case, try to find in files? 
                // Assuming it's an ID if passed as string for file type in new logic
                targetId = item;
                const found = files.find(f => f.id === targetId);
                currentStatus = found ? !!found.isFavorite : false;
            } else {
                targetId = item.id;
                currentStatus = !!item.isFavorite;
            }
        } else {
            // Folders use path
            targetId = typeof item === 'string' ? item : item.path;
            currentStatus = serverFavoriteIds.folders.includes(targetId);
        }

        const newStatus = !currentStatus;

        // 2. Optimistic Update
        if (type === 'file') {
            const updatedFiles = files.map(f => f.id === targetId ? { ...f, isFavorite: newStatus } : f);
            setAllUserData({
                ...allUserData,
                [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles }
            });
            // 同步回写播放器队列快照，播放器内收藏心形实时翻转
            patchItem(targetId, { isFavorite: newStatus });

            // Update ID list
            if (newStatus) {
                setServerFavoriteIds(prev => ({ ...prev, files: [...prev.files, targetId] }));
            } else {
                setServerFavoriteIds(prev => ({ ...prev, files: prev.files.filter(id => id !== targetId) }));
            }
        } else {
            // Folder update logic
            if (newStatus) {
                setServerFavoriteIds(prev => ({ ...prev, folders: [...prev.folders, targetId] }));
            } else {
                setServerFavoriteIds(prev => ({ ...prev, folders: prev.folders.filter(id => id !== targetId) }));
            }
        }

        // 3. API Call
        if (isServerMode) {
            try {
                const res = await apiFetch('/api/favorites/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, id: targetId })
                });
                const data = await res.json();

                // 4. Revert on Failure (or correcting state if server disagrees, though unlikely with toggle)
                if (!data.success) {
                    throw new Error(data.error || 'Failed to toggle');
                }
            } catch (e: any) { // Explicitly type 'e' as 'any' or 'unknown' then check
                console.error("Toggle Fav Error:", e);
                // Revert state (Variable logic same as above but swapped status)
                // For brevity, just alerting user or logging. A full revert would repeat the logic above with !newStatus.
                // Given reliability, we accept slight risk of desync on error, or force refresh.
                notify.error(t('favorite_sync_failed'), e?.message);
                // Revert optimistic UI update on error
                if (type === 'file') {
                    const updatedFiles = files.map(f => f.id === targetId ? { ...f, isFavorite: currentStatus } : f);
                    setAllUserData({
                        ...allUserData,
                        [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles }
                    });
                    // 回滚同步播放器队列快照，保持播放器与画廊数据一致
                    patchItem(targetId, { isFavorite: currentStatus });
                    if (currentStatus) { // If it was favorite, add back
                        setServerFavoriteIds(prev => ({ ...prev, files: [...prev.files, targetId] }));
                    } else { // If it was not favorite, remove
                        setServerFavoriteIds(prev => ({ ...prev, files: prev.files.filter(id => id !== targetId) }));
                    }
                } else {
                    if (currentStatus) { // If it was favorite, add back
                        setServerFavoriteIds(prev => ({ ...prev, folders: [...prev.folders, targetId] }));
                    } else { // If it was not favorite, remove
                        setServerFavoriteIds(prev => ({ ...prev, folders: prev.folders.filter(id => id !== targetId) }));
                    }
                }
            }
        } else {
            // Local Mode logic (if any)
            // For client mode, the optimistic update is the final update.
            // No API call, so no revert needed.
            if (type === 'file') {
                const updatedFiles = files.map(f => f.id === targetId ? { ...f, isFavorite: newStatus } : f);
                const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
                setAllUserData(updatedUserData);
                // 同步回写播放器队列快照，播放器内收藏心形实时翻转
                patchItem(targetId, { isFavorite: newStatus });
                persistData(undefined, undefined, updatedUserData);
            } else {
                // Toggle folder path in favorites list
                const currentFavs = allUserData[currentUser.username].favoriteFolderPaths || [];
                const newFavs = currentFavs.includes(targetId)
                    ? currentFavs.filter(p => p !== targetId)
                    : [...currentFavs, targetId];

                const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], favoriteFolderPaths: newFavs } };
                setAllUserData(updatedUserData);
                persistData(undefined, undefined, updatedUserData);
            }
        }
    };

    const handleFolderRename = async (pathStr: string, newName: string) => {
        if (!currentUser) return;
        if (isServerMode) {
            try {
                const res = await apiFetch('/api/folder/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: pathStr, newName })
                });
                const data = await res.json();
                if (data.success) {
                    notify.success(t('folder_renamed'), t('folder_renamed_desc'));
                    if (viewMode === 'favorites') {
                        fetchServerFolders(null, true);
                    } else if (viewMode === 'folders') {
                        fetchServerFolders(currentPath);
                    }
                } else {
                    notify.error(t('operation_failed'), data.error);
                }
            } catch (e) { notify.error(t('network_error')); }
        } else {
            // Client mode rename
            const updatedFiles = files.map(f => {
                if (f.path.startsWith(pathStr + '/')) {
                    const relative = f.path.substring(pathStr.length);
                    const parentDir = pathStr.substring(0, pathStr.lastIndexOf('/'));
                    const newPath = (parentDir ? parentDir + '/' : '') + newName + relative;

                    const newFolderPath = newPath.substring(0, newPath.lastIndexOf('/'));
                    return { ...f, path: newPath, folderPath: newFolderPath };
                }
                return f;
            });
            const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
        }
    };

    const handleFolderDelete = async (pathStr: string) => {
        if (!currentUser) return;
        const folderName = pathStr.split('/').filter(Boolean).pop() || pathStr;
        if (!await confirm({ title: t('delete_folder_title').replace('{name}', folderName), description: `${pathStr}\n${t('delete_folder_desc')}`, confirmText: t('delete_action'), destructive: true })) return;

        if (isServerMode) {
            try {
                const res = await apiFetch('/api/folder/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: pathStr })
                });
                const data = await res.json();
                if (data.success) {
                    // If current view was inside this folder, go up
                    if (currentPath === pathStr || currentPath.startsWith(`${pathStr}/`)) {
                        const parent = pathStr.split('/').slice(0, -1).join('/');
                        handleFolderClick(parent);
                    } else {
                        fetchServerFolders(currentPath);
                    }
                } else {
                    notify.error(t('operation_failed'), data.error);
                }
            } catch (e) { notify.error(t('network_error')); }
        } else {
            // Client mode delete
            const updatedFiles = files.filter(f => !f.path.startsWith(pathStr + '/') && f.path !== pathStr);
            const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
        }
    };

    // 打开媒体：捕获当前视口快照后交给播放器，不再写入导航历史（打开即无历史条目）。
    const handleOpenMedia = (item: MediaItem, sourceItems: MediaItem[] = processedFiles) => {
        const snapshot = galleryViewportRef.current?.captureSnapshot();
        if (snapshot?.locationKey === galleryNavigation.location.key) {
            galleryNavigation.captureImmediateSnapshot({ ...snapshot, loadedOffset: serverOffset });
        }
        const queue = buildPlayerQueue(sourceItems, item.id);
        // 播放器未打开时以共享元素过渡从缩略图放大进入；已打开时直接切换，避免与现有查看器争用过渡名
        if (playerState.isOpen) openPlayer(queue);
        else runHeroTransition(item.id, () => openPlayer(queue));
    };

    const handleFolderGalleryItemClick = useStableMediaItemClick((item) => {
        if (item.mediaType === 'folder') {
            handleFolderClick(item.path);
        } else if (item.mediaType === 'audio') {
            const audioFiles = mixedItems.filter(media => media && media.mediaType === 'audio');
            const clickedIndex = audioFiles.findIndex(media => media.id === item.id);
            setAudioPlaylist(audioFiles);
            setCurrentAudioIndex(clickedIndex >= 0 ? clickedIndex : 0);
            setCurrentAudio(item);
            setIsPlayerMinimized(false);
        } else {
            handleOpenMedia(item);
        }
    });

    const handleMediaGalleryItemClick = useStableMediaItemClick((item) => {
        if (item.mediaType === 'audio') {
            const audioFiles = processedFiles.filter(media => media && media.mediaType === 'audio');
            const clickedIndex = audioFiles.findIndex(media => media.id === item.id);
            setAudioPlaylist(audioFiles);
            setCurrentAudioIndex(clickedIndex >= 0 ? clickedIndex : 0);
            setCurrentAudio(item);
            setIsPlayerMinimized(false);
        } else {
            handleOpenMedia(item);
        }
    });

    // 时间线：按月分桶的视口自行请求数据，打开媒体时以已加载的时间线条目为查看器队列
    const timelineFetchJson = useStableEventHandler(async (url: string, signal?: AbortSignal) => {
        const res = await apiFetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
    const handleTimelineOpenItem = useStableEventHandler((item: MediaItem, loadedItems: MediaItem[]) => {
        if (item.mediaType === 'audio') {
            const audioFiles = loadedItems.filter(media => media.mediaType === 'audio');
            const clickedIndex = audioFiles.findIndex(media => media.id === item.id);
            setAudioPlaylist(audioFiles);
            setCurrentAudioIndex(clickedIndex >= 0 ? clickedIndex : 0);
            setCurrentAudio(item);
            setIsPlayerMinimized(false);
            return;
        }
        handleOpenMedia(item, loadedItems);
    });
    const isTimelineLayout = isServerMode && layoutMode === 'timeline' && (viewMode === 'all' || viewMode === 'favorites');

    const handleScrollToTop = () => {
        galleryNavigation.requestRestore({
            anchorIndex: 0,
            offsetWithinItem: 0,
            fallbackScrollTop: 0,
            loadedOffset: serverOffset,
        });
    };

    const handleViewportSnapshot = (snapshot: ViewportSnapshot) => {
        if (snapshot.locationKey !== galleryNavigation.location.key) return;
        galleryNavigation.captureSnapshot({ ...snapshot, loadedOffset: serverOffset });
    };

    // 视口 props 引用稳定化：以下回调每次渲染都会重建引用，会持续击穿 VirtualGallery 的 memo，
    // 导致播放器 item 切换等无关更新引发背后网格全量重渲染。稳定壳调用时仍执行最新闭包，行为不变。
    const stableLoadNextPage = useStableEventHandler(loadMoreServerFiles);
    const stableOnViewportSnapshot = useStableEventHandler(handleViewportSnapshot);
    const stableToggleFavorite = useStableEventHandler(handleToggleFavorite);
    const stableFolderRename = useStableEventHandler(handleFolderRename);
    const stableFolderDelete = useStableEventHandler(handleFolderDelete);
    const stableRegenerateFolder = useStableEventHandler(handleRegenerateFolder);

    const handleUpdateTitle = (newTitle: string) => {
        persistData(undefined, newTitle, undefined, undefined, undefined, undefined, undefined, true);
    };

    const handleUpdateSubtitle = (newSubtitle: string) => {
        persistData(undefined, undefined, undefined, undefined, newSubtitle, undefined, undefined, true);
    };

    const handleUpdateHomeConfig = (newConfig: HomeScreenConfig) => {
        persistData(undefined, undefined, undefined, undefined, undefined, newConfig, undefined, true);
    };

    const handleUpdateThreadCount = async (newCount: number) => {
        if (newCount > 16 && newCount > threadCount && !concurrencyWarningShown.current) {
            if (await confirm({ title: t('high_concurrency_title'), description: t('concurrency_warning').replace('{count}', newCount.toString()), confirmText: t('continue_action') })) {
                concurrencyWarningShown.current = true;
                persistData(undefined, undefined, undefined, undefined, undefined, undefined, newCount, true);
            }
        } else {
            persistData(undefined, undefined, undefined, undefined, undefined, undefined, newCount, true);
        }
    };

    const handleAddLibraryPath = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newPathInput.trim()) return;
        const newPaths = [...libraryPaths, newPathInput.trim()];
        persistData(undefined, undefined, undefined, newPaths, undefined);
        setNewPathInput('');
    };

    const handleRemoveLibraryPath = (pathToRemove: string) => {
        const newPaths = libraryPaths.filter(p => p !== pathToRemove);
        persistData(undefined, undefined, undefined, newPaths, undefined);
    };

    const handleExportConfig = () => {
        const userSources: Record<string, any[]> = {};
        Object.keys(allUserData).forEach(key => {
            userSources[key] = allUserData[key].sources;
        });

        const config: AppConfig = {
            title: appTitle,
            homeSubtitle: homeSubtitle,
            homeScreen: homeConfig,
            users: users,
            userSources: userSources,
            libraryPaths: libraryPaths,
            lastModified: Date.now()
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", CONFIG_FILE_NAME);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        // Client-side upload simulation (no server processing)
        if (!e.target.files || !currentUser) return;

        const newFiles: MediaItem[] = [];
        const sourceId = generateId();
        const sourceName = `Import ${new Date().toLocaleTimeString()}`;

        Array.from(e.target.files).forEach((file: any) => {
            if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
                const relativePath = file.webkitRelativePath || file.name;
                const folderPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';

                let mediaType: 'image' | 'video' | 'audio' = 'image';
                if (file.type.startsWith('video/')) mediaType = 'video';
                if (file.type.startsWith('audio/')) mediaType = 'audio';

                newFiles.push({
                    id: generateId(),
                    file: file,
                    url: URL.createObjectURL(file),
                    name: file.name,
                    path: relativePath,
                    folderPath: folderPath,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                    mediaType: mediaType,
                    sourceId: sourceId
                });
            }
        });

        if (newFiles.length > 0) {
            const updatedFiles = [...files, ...newFiles];
            const newSource = { id: sourceId, name: sourceName, count: newFiles.length };
            const updatedSources = [...(allUserData[currentUser.username].sources || []), newSource];

            const updatedUserData = {
                ...allUserData,
                [currentUser.username]: {
                    ...allUserData[currentUser.username],
                    files: updatedFiles,
                    sources: updatedSources
                }
            };

            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
        }
    };

    // --- Render Helpers ---

    const processedFiles = useMemo(() => {
        let result = [...files];

        // 1. Folder Filter
        if (viewMode === 'folders') {
            if (!isServerMode) {
                result = result.filter(f => f.folderPath === currentPath);
            } else {
                // In server mode, 'files' should be the content of the current folder.
                // But to safely handle state transitions or cache leaks:
                result = result.filter(f => f.folderPath === currentPath);

                // CRITICAL FIX: If currentPath is empty (root), we must ensure we only show files 
                // that seemingly belong to root (if backend returns absolute paths, this filter might block everything if we don't normalize).
                // But typically backend 'folderPath' matches requested 'currentPath'. 
                // If backend returns absolute '/media/...' and currentPath is '', this filter blocks it (Correct behavior for ghost files).
                // If backend returns relative paths, it works. 
                // Given the issue, enforce strict equality.
            }
        }

        // 2. Favorites Filter (CRITICAL FIX)
        // Enforce favorite filtering even in server mode if we are in favorites view
        // to prevent flashing of non-favorite items during state transitions.
        if (viewMode === 'favorites') {
            result = result.filter(f => f.isFavorite);
        }

        // 3. Media Type Filter
        if (filterOption !== 'all') {
            result = result.filter(f => f.mediaType === filterOption);
        }

        // 4. Sorting：服务端模式下分页已按服务端全局顺序返回，客户端不再二次排序，
        // 避免排序规则差异（如大小写、区域设置）导致续页插入后顺序跳变。
        if (isServerMode) return result;
        if (sortOption === 'random') {
            return seededShuffleGalleryItems(result, resolveGalleryRandomSeed(galleryNavigation.location.randomSeed));
        }
        return sortMedia(result, sortOption);
    }, [files, viewMode, currentPath, filterOption, sortOption, isServerMode, galleryNavigation.location.randomSeed]);


    const nameAscLabel = useMemo(() => {
        const val = t('sort_by_name_asc');
        return val && !String(val).startsWith('sort_by_name_asc') ? val : '名称A-Z';
    }, [t]);

    const nameDescLabel = useMemo(() => {
        const val = t('sort_by_name_desc');
        return val && !String(val).startsWith('sort_by_name_desc') ? val : '名称Z-A';
    }, [t]);

    // Client-side folder logic
    const folderTree = useMemo(() => {
        if (isServerMode || files.length === 0) return null;
        return buildFolderTree(files);
    }, [files, isServerMode]);

    const clientSubfolders = useMemo(() => {
        if (isServerMode || !folderTree) return [];
        return getImmediateSubfolders(folderTree, currentPath);
    }, [folderTree, currentPath, isServerMode]);

    // Combined folders for view
    const visibleFolders = resolveVisibleGalleryFolders(
        viewMode,
        activeSearch,
        isServerMode,
        serverFolders,
        clientSubfolders,
    );

    const mixedItems = useMemo(() => {
        const folderItems: MediaItem[] = visibleFolders.map(f => ({
            id: f.path,
            name: f.name || f.path.split('/').pop() || 'Root',
            path: f.path,
            folderPath: f.path.split('/').slice(0, -1).join('/'),
            url: '',
            type: 'application/x-directory',
            mediaType: 'folder',
            size: 0,
            lastModified: f.lastModified || 0,
            sourceId: 'system',
            mediaCount: f.mediaCount !== undefined ? f.mediaCount : (f as any).count,
            coverMedia: f.coverMedia || (f as any).coverItem,
            isFavorite: isServerMode
                ? serverFavoriteIds.folders.includes(f.path)
                : (allUserData[currentUser?.username || '']?.favoriteFolderPaths || []).includes(f.path)
        }));

        return composeGalleryFolderItems(folderItems, processedFiles, sortOption);
    }, [visibleFolders, processedFiles, isServerMode, serverFavoriteIds, allUserData, currentUser, sortOption]);

    // 视口 items 引用稳定化：filter(Boolean) 会在每次渲染生成新数组并击穿 memo，
    // 这里收敛为仅在数据源或骨架覆盖态变化时重建引用，内容语义与原内联表达式一致。
    const folderGalleryItems = useMemo(
        () => resolveGalleryRenderItems(mixedItems.filter(Boolean), isInitialGallerySkeletonCovering),
        [mixedItems, isInitialGallerySkeletonCovering],
    );
    const filesGalleryItems = useMemo(
        () => resolveGalleryRenderItems(processedFiles.filter(Boolean), isInitialGallerySkeletonCovering),
        [processedFiles, isInitialGallerySkeletonCovering],
    );

    const hasVisibleSearchResults = hasVisibleGallerySearchResults(
        viewMode,
        visibleFolders.length,
        processedFiles.filter(Boolean).length,
        serverFavoriteIds.folders.length,
    );
    const shouldShowSearchEmptyState = shouldShowGallerySearchEmptyState(
        activeSearch,
        hasVisibleSearchResults,
        isFetchingMore,
        isInitialGalleryLoading,
    );


    // Auth/Setup Screens
    if (authStep === 'loading') {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Icons.Loader className="animate-spin text-primary" size={28} />
            </div>
        );
    }

    if (authStep === 'setup' || authStep === 'login') {
        const isSetup = authStep === 'setup';
        // 登录与初始化：暗房氛围（暖黑底 + 黄铜低对比光晕），表单使用 components/kit
        return (
            <div className="relative min-h-screen overflow-hidden bg-background flex items-center justify-center p-4">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{ background: 'radial-gradient(60% 45% at 50% 0%, var(--ambient), transparent 70%), radial-gradient(40% 35% at 85% 100%, color-mix(in srgb, var(--ambient) 60%, transparent), transparent 70%)' }}
                />
                <div className="relative w-full max-w-sm">
                    <div className="mb-8 flex flex-col items-center text-center">
                        <div aria-hidden="true" className="mb-5 flex size-14 items-center justify-center rounded-full border border-primary/40 bg-card shadow-[0_0_40px_-8px_var(--ambient)]">
                            <div className="size-6 rounded-full border-[5px] border-primary/80" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                            {isSetup ? t('welcome') : (appTitle || 'Luvia Gallery')}
                        </h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {isSetup ? t('setup_subtitle') : t('login_subtitle')}
                        </p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-[0_24px_64px_-32px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                    {authError && (
                        <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            <Icons.Alert size={16} className="shrink-0" />
                            {authError}
                        </div>
                    )}

                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (isAuthSubmitting) return;
                        setIsAuthSubmitting(true);
                        try {
                        if (authStep === 'setup') {
                            if (setupForm.password !== setupForm.confirmPassword) {
                                setAuthError(t('passwords_not_match'));
                                return;
                            }

                            const adminUser = {
                                username: setupForm.username,
                                password: setupForm.password,
                                isAdmin: true
                            };

                            if (isServerMode) {
                                try {
                                    // Force initial config sync
                                    const res = await fetch('/api/config', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            users: [adminUser],
                                            title: appTitle || 'Luvia Gallery'
                                        })
                                    });

                                    if (!res.ok) throw new Error(await res.text());

                                    // After success, we need to LOGIN to get the token
                                    const loginRes = await fetch('/api/auth/login', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            username: adminUser.username,
                                            password: adminUser.password
                                        })
                                    });

                                    if (loginRes.ok) {
                                        const data = await loginRes.json();
                                        setStorageItem(TOKEN_STORAGE_KEY, data.token, LEGACY_KEYS.token);
                                        setCurrentUser(data.user);
                                        setStorageItem(AUTH_USER_KEY, data.user.username, LEGACY_KEYS.authUser);
                                        setAuthStep('app');
                                        // Trigger init
                                        initApp();
                                    } else {
                                        setAuthStep('login');
                                    }
                                } catch (err: any) {
                                    setAuthError(`${t('setup_failed')}: ${err.message}`);
                                }
                            } else {
                                // Local mode
                                const newUser: User = { ...adminUser, avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${adminUser.username}` };
                                const newUsers = [newUser];
                                const newData = { [newUser.username]: { sources: [], files: [], favoriteFolderPaths: [] } };
                                persistData(newUsers, undefined, newData);
                                setUsers(newUsers);
                                setAllUserData(newData);
                                setCurrentUser(newUser);
                                setAuthStep('app');
                                setStorageItem(AUTH_USER_KEY, newUser.username, LEGACY_KEYS.authUser);
                            }
                        } else {
                            if (isServerMode) {
                                await fetch('/api/auth/login', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(loginForm)
                                })
                                    .then(async (res) => {
                                        if (res.ok) {
                                            const data = await res.json();
                                            if (data.token) {
                                                setStorageItem(TOKEN_STORAGE_KEY, data.token, LEGACY_KEYS.token);
                                                setCurrentUser(data.user);
                                                setAuthStep('app');
                                                setStorageItem(AUTH_USER_KEY, data.user.username, LEGACY_KEYS.authUser);
                                                setAuthError('');
                                                // 匿名配置不再返回用户列表，登录后用令牌重新拉取完整配置（含管理员可见的用户列表）；
                                                // 媒体与目录首载仍由数据集 effect 聚合。
                                                void initApp();
                                            }
                                        } else {
                                            setAuthError(t('invalid_credentials'));
                                        }
                                    })
                                    .catch(() => setAuthError(t('connection_failed')));
                            } else {
                                const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
                                if (user) {
                                    setCurrentUser(user);
                                    setAuthStep('app');
                                    setStorageItem(AUTH_USER_KEY, user.username, LEGACY_KEYS.authUser);
                                } else {
                                    setAuthError(t('invalid_credentials'));
                                }
                            }
                        }
                        } finally {
                            setIsAuthSubmitting(false);
                        }
                    }} className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="auth-username">{t('username')}</Label>
                            <Input
                                id="auth-username"
                                required
                                autoComplete="username"
                                autoFocus
                                value={isSetup ? setupForm.username : loginForm.username}
                                onChange={e => isSetup ? setSetupForm({ ...setupForm, username: e.target.value }) : setLoginForm({ ...loginForm, username: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="auth-password">{t('password')}</Label>
                            <Input
                                id="auth-password"
                                required
                                type="password"
                                autoComplete={isSetup ? 'new-password' : 'current-password'}
                                value={isSetup ? setupForm.password : loginForm.password}
                                onChange={e => isSetup ? setSetupForm({ ...setupForm, password: e.target.value }) : setLoginForm({ ...loginForm, password: e.target.value })}
                            />
                        </div>
                        {isSetup && (
                            <div className="grid gap-2">
                                <Label htmlFor="auth-confirm-password">{t('confirm_password')}</Label>
                                <Input
                                    id="auth-confirm-password"
                                    required
                                    type="password"
                                    autoComplete="new-password"
                                    value={setupForm.confirmPassword}
                                    onChange={e => setSetupForm({ ...setupForm, confirmPassword: e.target.value })}
                                />
                            </div>
                        )}
                        <Button type="submit" size="lg" className="mt-2 w-full" disabled={isAuthSubmitting}>
                            {isAuthSubmitting && <Icons.Loader className="animate-spin" />}
                            {isSetup ? t('create_admin') : t('sign_in')}
                        </Button>
                    </form>
                    {authStep === 'login' && !isServerMode && users.length === 0 && (
                        <div className="mt-4 text-center">
                            <button type="button" onClick={() => setAuthStep('setup')} className="text-sm text-primary hover:underline">{t('need_setup')}</button>
                        </div>
                    )}
                    </div>
                </div>
            </div>
        );
    }




    // Main App Render
    return (
        <div className={`flex h-screen w-full bg-surface-primary overflow-hidden text-text-primary font-sans transition-colors duration-200 ${isServerMode ? 'server-mode' : ''}`}>
            <Navigation
                appTitle={appTitle}
                viewMode={viewMode}
                setViewMode={handleSetViewMode}
                onUpload={handleUpload}
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                isDesktopSidebarOpen={isDesktopSidebarOpen}
                toggleDesktopSidebar={() => setIsDesktopSidebarOpen(!isDesktopSidebarOpen)}
                totalPhotos={libraryTotalCount || files.length}
                theme={theme}
                toggleTheme={toggleTheme}
                isServerMode={isServerMode}
                onOpenSettings={() => setIsSettingsOpen(true)}
                backgroundTaskActive={!isUnifiedModalOpen && (isBackgroundTaskActive(scanStatus) || isBackgroundTaskActive(thumbStatus))}
                onOpenBackgroundTasks={() => setIsUnifiedModalOpen(true)}
            />

            <main className={`flex-1 flex flex-col min-w-0 relative h-full ${viewMode === 'home' ? 'pt-16 md:pt-0' : 'pt-3 md:pt-0'}`}>
                <UnifiedGalleryToolbar
                    viewMode={viewMode}
                    location={galleryNavigation.location}
                    canGoBack={galleryNavigation.canGoBack}
                    canGoForward={galleryNavigation.canGoForward}
                    onBack={() => { cacheCurrentGallery(); galleryNavigation.back(); }}
                    onForward={() => { cacheCurrentGallery(); galleryNavigation.forward(); }}
                    onUp={handleGoBackFolder}
                    onNavigatePath={handleFolderClick}
                    onNavigateView={(mode) => handleSetViewMode(mode as ViewMode)}
                    onOpenMenu={() => setIsSidebarOpen(true)}
                    onScrollToTop={handleScrollToTop}
                    onLocationChange={handleGalleryLocationChange}
                />

                {/* Content Area */}
                {viewMode === 'home' ? (
                    <Home
                        title={appTitle}
                        items={isServerMode ? homeFeaturedItems : files}
                        totalCount={isServerMode ? (libraryTotalCount || systemStatus?.mediaStats?.totalFiles || 0) : files.length}
                        onEnterLibrary={() => handleSetViewMode('all')}
                        onJumpToFolder={handleJumpToFolder}
                        subtitle={homeSubtitle}
                        config={homeConfig}
                    />
                ) : (
                    <div className="flex-1 overflow-hidden relative">
                        {galleryLoadError && (
                            <GalleryLoadErrorBanner onRetry={() => setGalleryReloadNonce(value => value + 1)} />
                        )}
                        {/* Empty State */}
                        {!activeSearch.trim() && !isServerMode && files.length === 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-text-tertiary">
                                <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                                    <Icons.Image size={40} className="opacity-30" />
                                </div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">{t('empty_library')}</h3>
                                <p className="max-w-xs text-center text-sm">{t('import_local')}</p>
                            </div>
                        )}
                        {shouldShowServerEmptyLibrary({
                            isServerMode,
                            location: galleryNavigation.location,
                            fileCount: files.length,
                            libraryTotalCount,
                            isLoading: isFetchingMore || isInitialGalleryLoading,
                        }) && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                                <Icons.Server size={40} className="mb-4 text-primary" />
                                <h3 className="text-lg font-semibold text-foreground mb-2">{t('connected_to_nas')}</h3>
                                <p className="max-w-md text-center text-sm">{t('configure_nas')}</p>
                                <button onClick={() => { setIsSettingsOpen(true); setSettingsTab('library'); }} className="mt-6 px-6 py-2 bg-primary hover:bg-primary/85 text-primary-foreground rounded-full font-medium transition-colors">
                                    {t('configure_library')}
                                </button>
                            </div>
                        )}

                        {/* Views */}
                        {/* Views */}
                        {shouldShowSearchEmptyState ? (
                            <SearchEmptyState
                                view={galleryNavigation.location.view}
                                folderPath={currentPath}
                                onLocationChange={handleGalleryLocationChange}
                            />
                        ) : viewMode === 'folders' ? (
                            /* Unified View (Folders + Files) */
                            (viewMode === 'folders' || currentPath) && (
                                <div className="flex-1 w-full h-full p-2 md:p-8 flex flex-col min-h-0">
                                    <VirtualGallery
                                        ref={galleryViewportRef}
                                        items={folderGalleryItems}
                                        onItemClick={handleFolderGalleryItemClick}
                                        hasNextPage={isServerMode && hasMoreServer}
                                        isInitialLoading={isInitialGalleryLoading}
                                        isNextPageLoading={isFetchingMore}
                                        loadNextPage={stableLoadNextPage}
                                        itemCount={isInitialGallerySkeletonCovering ? 0 : (isServerMode ? serverTotal + visibleFolders.length : mixedItems.length)}
                                        layout={viewMode === 'folders' && layoutMode === 'timeline' ? 'masonry' : layoutMode}
                                        viewKey={galleryNavigation.location.key}
                                        restoreSnapshot={galleryNavigation.restoreSnapshot}
                                        restoreCommand={galleryNavigation.restoreCommand}
                                        onSnapshotChange={stableOnViewportSnapshot}
                                        onRestoreComplete={galleryNavigation.consumeRestoreSnapshot}
                                        mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                                        onToggleFavorite={stableToggleFavorite}
                                        onRename={stableFolderRename}
                                        onDelete={stableFolderDelete}
                                        onRegenerate={stableRegenerateFolder}
                                    />
                                </div>
                            )
                        ) : (
                            <div className="w-full h-full flex flex-col">
                                {/* Favorite Folders Section (only in favorites view) */}
                                {/* md:pt-24 = 96px（32px 页边距语义 + 64px 浮岛安全区），与网格视图观感一致；
                                    注意不能用 md:p-8 + md:pt-16 叠加——同元素上 pt 会覆盖 p 的 top 分量 */}
                                {viewMode === 'favorites' && isServerMode && !isInitialGallerySkeletonCovering && serverFavoriteIds.folders.length > 0 && (
                                    <div className="p-4 pb-0 md:px-8 md:pb-8 md:pt-24">
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 mb-6">
                                            {serverFolders
                                                .filter(folder => serverFavoriteIds.folders.includes(folder.path))
                                                .map(folder => (
                                                    <FolderCard
                                                        key={folder.path}
                                                        folder={{
                                                            name: folder.name || folder.path.split('/').pop() || 'Root',
                                                            path: folder.path,
                                                            mediaCount: folder.mediaCount !== undefined ? folder.mediaCount : folder.count,
                                                            children: folder.children || {},
                                                            coverMedia: folder.coverMedia || folder.coverItem
                                                        }}
                                                        onClick={(path) => {
                                                            handleFolderClick(path);
                                                        }}
                                                        isFavorite={true}
                                                        onToggleFavorite={(path) => handleToggleFavorite(path, 'folder')}
                                                        onRename={handleFolderRename}
                                                        onDelete={handleFolderDelete}
                                                        onRegenerate={handleRegenerateFolder}
                                                    />
                                                ))}
                                        </div>
                                    </div>
                                )}

                                {/* Files Section */}
                                <div className="flex-1 min-h-0 p-2 md:p-8">
                                    {shouldShowFavoritesEmptyState(
                                        viewMode,
                                        processedFiles.length,
                                        serverFavoriteIds.folders.length,
                                        isInitialGalleryLoading,
                                    ) ? (
                                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                                            <Icons.Heart size={64} className="mb-4 opacity-20" />
                                            <p className="text-lg font-medium">{t('no_favorites')}</p>
                                            <p className="text-sm mt-2">{t('click_heart_to_favorite')}</p>
                                        </div>
                                    ) : isTimelineLayout ? (
                                        <TimelineViewport
                                            ref={galleryViewportRef}
                                            viewKey={galleryNavigation.location.key}
                                            scopeQuery={buildTimelineScopeQuery(galleryNavigation.location)}
                                            fetchJson={timelineFetchJson}
                                            onOpenItem={handleTimelineOpenItem}
                                            mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                                            restoreSnapshot={galleryNavigation.restoreSnapshot}
                                            restoreCommand={galleryNavigation.restoreCommand}
                                            onSnapshotChange={stableOnViewportSnapshot}
                                            onRestoreComplete={galleryNavigation.consumeRestoreSnapshot}
                                        />
                                    ) : (
                                        <VirtualGallery
                                            ref={galleryViewportRef}
                                            items={filesGalleryItems}
                                            onItemClick={handleMediaGalleryItemClick}
                                            hasNextPage={isServerMode && hasMoreServer}
                                            isInitialLoading={isInitialGalleryLoading}
                                            isNextPageLoading={isFetchingMore}
                                            loadNextPage={stableLoadNextPage}
                                            itemCount={isInitialGallerySkeletonCovering ? 0 : (isServerMode ? serverTotal : processedFiles.filter(Boolean).length)}
                                            layout={layoutMode}
                                            viewKey={galleryNavigation.location.key}
                                            restoreSnapshot={galleryNavigation.restoreSnapshot}
                                            restoreCommand={galleryNavigation.restoreCommand}
                                            onSnapshotChange={stableOnViewportSnapshot}
                                            onRestoreComplete={galleryNavigation.consumeRestoreSnapshot}
                                            mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                                            onRegenerate={stableRegenerateFolder}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )
                }
            </main >

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                disablePointerDismissal={isUserModalOpen || showDirPicker}
                appTitle={appTitle}
                homeSubtitle={homeSubtitle}
                homeConfig={homeConfig}
                language={language as 'en' | 'zh'}
                setLanguage={setLanguage as (lang: 'en' | 'zh') => void}
                isServerMode={isServerMode}
                setIsServerMode={setIsServerMode}
                libraryPaths={libraryPaths}
                systemStatus={systemStatus}
                threadCount={threadCount}
                users={users}
                currentUser={currentUser}
                newPathInput={newPathInput}
                setNewPathInput={setNewPathInput}
                onUpdateTitle={handleUpdateTitle}
                onUpdateSubtitle={handleUpdateSubtitle}
                onUpdateHomeConfig={handleUpdateHomeConfig}
                onAddLibraryPath={handleAddLibraryPath}
                onRemoveLibraryPath={handleRemoveLibraryPath}
                onMonitorUpdate={handleMonitorUpdate}
                onUpdateThreadCount={handleUpdateThreadCount}
                onStartScan={startServerScan}
                onStartThumbGen={startThumbnailGen}
                onFetchSmartResults={handleFetchSmartResults}
                onSmartScan={handleSmartScan}
                activeTab={settingsTab}
                onTabChange={setSettingsTab}
                onSmartRepair={handleSmartRepair}
                onExportConfig={handleExportConfig}
                onLogout={handleLogout}
                onAddUser={handleAddUser}
                onRenameUser={handleRenameUser}
                onResetPassword={handleResetPassword}
                onDeleteUser={handleDeleteUser}
                onSetDirPickerContext={setDirPickerContext}
                dirPickerContext={dirPickerContext}
                onShowDirPicker={setShowDirPicker}
                onPruneCache={pruneCache}
                onClearCache={clearCache}
                smartScanResults={smartScanResults}
                onOpenScanReport={() => setIsScanReportOpen(true)}
                thumbStatus={thumbStatus}
                theme={theme}
                onToggleTheme={toggleTheme}
                mediaHoverZoomEnabled={mediaHoverZoomEnabled}
                onMediaHoverZoomChange={handleMediaHoverZoomChange}
                onGenerateWallpaperToken={async (config) => {
                    if (!isServerMode) return '';
                    try {
                        const res = await apiFetch('/api/auth/wallpaper-token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ wallpaperConfig: config })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            return data.token;
                        }
                    } catch (e) { }
                    return '';
                }}
                onFetchWallpaperToken={async () => {
                    if (!isServerMode) return { token: '', config: null };
                    try {
                        const res = await apiFetch('/api/auth/wallpaper-token', { method: 'GET' });
                        if (res.ok) {
                            const data = await res.json();
                            return { token: data.token, config: data.config };
                        }
                    } catch (e) { }
                    return { token: '', config: null };
                }}
                baseUrl={window.location.origin}
            />

            <UserModal
                isOpen={isUserModalOpen}
                onClose={() => setIsUserModalOpen(false)}
                type={userFormType}
                targetUser={targetUser}
                isAdmin={currentUser?.isAdmin || false}
                onBrowsePaths={(onPick) => {
                    allowedPathPickRef.current = onPick;
                    setDirPickerContext('userAllowedPaths');
                    setShowDirPicker(true);
                }}
                onSubmit={handleUserFormSubmit}
            />

            <MediaPlayer onToggleFavorite={handleToggleFavorite} />

            {/* Audio Player */}
            {
                currentAudio && (
                    <AudioPlayer
                        audio={currentAudio}
                        isMinimized={isPlayerMinimized}
                        onMinimize={() => setIsPlayerMinimized(true)}
                        onExpand={() => setIsPlayerMinimized(false)}
                        onClose={() => {
                            setCurrentAudio(null);
                            setAudioPlaylist([]);
                            setCurrentAudioIndex(0);
                        }}
                        playlist={audioPlaylist}
                        onNext={() => {
                            if (currentAudioIndex < audioPlaylist.length - 1) {
                                const nextIndex = currentAudioIndex + 1;
                                setCurrentAudioIndex(nextIndex);
                                setCurrentAudio(audioPlaylist[nextIndex]);
                            }
                        }}
                        onPrevious={() => {
                            if (currentAudioIndex > 0) {
                                const prevIndex = currentAudioIndex - 1;
                                setCurrentAudioIndex(prevIndex);
                                setCurrentAudio(audioPlaylist[prevIndex]);
                            }
                        }}
                    />
                )
            }

            <UnifiedProgressModal
                isOpen={isUnifiedModalOpen}
                onClose={handleUnifiedClose}
                scanStatus={scanStatus}
                scanCount={scanProgress.count}
                scanCurrentPath={scanProgress.currentPath}
                onScanPause={() => controlScan('pause')}
                onScanResume={() => controlScan('resume')}
                onScanStop={() => controlScan('stop')}
                thumbStatus={thumbStatus}
                thumbCount={thumbProgress.count}
                thumbTotal={thumbProgress.total}
                thumbCurrentPath={thumbProgress.currentPath}
                thumbQueue={thumbQueue}
                smartResults={smartScanResults} // Pass analysis results
                onThumbPause={() => controlThumb('pause')}
                onThumbResume={() => controlThumb('resume')}
                onThumbStop={() => controlThumb('stop')}
                onThumbCancelTask={handleCancelTask}
                onStartRepair={handleSmartRepair} // Pass repair handler
            />

            {showDirPicker && (
                <DirectoryPicker
                    isOpen={showDirPicker}
                    onClose={() => setShowDirPicker(false)}
                    onSelect={(path) => {
                        if (dirPickerContext === 'library' || dirPickerContext === 'wallpaper') {
                            setNewPathInput(path);
                        } else {
                            allowedPathPickRef.current?.(path);
                            allowedPathPickRef.current = null;
                        }
                        setShowDirPicker(false);
                    }}
                    initialPath={(dirPickerContext === 'library' || dirPickerContext === 'wallpaper') ? newPathInput : ''}
                />
            )}

            <ScanReportModal
                isOpen={isScanReportOpen}
                onClose={() => setIsScanReportOpen(false)}
                smartResults={smartScanResults}
                onRepair={(ids) => {
                    // Trigger generic repair for now
                    handleSmartRepair();
                    // In future, pass ids to backend if supported
                }}
                onDelete={handleBatchDelete}
                onNavigate={(item) => {
                    setIsScanReportOpen(false);
                    setIsSettingsOpen(false);
                    handleJumpToFolder(item);
                }}
            />
        </div >
    );
}

/** 应用默认导出：PlayerProvider 包裹整个应用，画廊主体与播放器共享同一上下文；ConfirmProvider 提供确认/输入对话框，Toaster 承载提示条。 */
export default function App() {
    return (
        <ConfirmProvider>
            <PlayerProvider>
                <GalleryApp />
            </PlayerProvider>
            <Toaster position="bottom-center" />
        </ConfirmProvider>
    );
}
