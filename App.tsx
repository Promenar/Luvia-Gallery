import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig, FolderNode, SystemStatus, HomeScreenConfig } from './types';
import { buildFolderTree, generateId, isVideo, isAudio, sortMedia, getImmediateSubfolders } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { ImageViewer } from './components/ImageViewer';
import { UnifiedProgressModal } from './components/UnifiedProgressModal';
import { ScanStatus } from './components/ScanProgressModal'; // Keeping Type for now if needed, or define in unified
import { VirtualGallery } from './components/VirtualGallery';
import { DirectoryPicker } from './components/DirectoryPicker';
import { Home } from './components/Home';
import { useLanguage } from './contexts/LanguageContext';
import { AudioPlayer } from './components/AudioPlayer';

const CONFIG_FILE_NAME = 'lumina-config.json';
const USERS_STORAGE_KEY = 'lumina_users';
const VIEW_MODE_KEY = 'lumina_view_mode';
const LAYOUT_MODE_KEY = 'lumina_layout_mode';
const APP_TITLE_KEY = 'lumina_app_title';
const APP_SUBTITLE_KEY = 'lumina_app_subtitle';
const SOURCES_STORAGE_KEY = 'lumina_sources';
const THEME_STORAGE_KEY = 'lumina_theme';
const AUTH_USER_KEY = 'lumina_auth_user';

interface ExtendedSystemStatus extends SystemStatus {
    // watcherActive?: boolean; // Deprecated
    mode?: 'periodic' | 'manual';
    scanInterval?: number;
    dbStatus?: string;
    mediaStats?: {
        totalFiles: number;
        images: number;
        videos: number;
        audio: number;
    };
    hardwareAcceleration?: {
        type: string;
        device: string | null;
    };
}

type SettingsTab = 'general' | 'library' | 'system' | 'account';

export default function App() {
    const { t, language, setLanguage } = useLanguage();

    // --- Authentication State ---
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [authStep, setAuthStep] = useState<'loading' | 'setup' | 'login' | 'app'>('loading');
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [setupForm, setSetupForm] = useState({ username: '', password: '', confirmPassword: '' });
    const [authError, setAuthError] = useState('');

    // --- User Management State ---
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [userFormType, setUserFormType] = useState<'add' | 'reset' | 'rename'>('add');
    const [targetUser, setTargetUser] = useState<User | null>(null);
    const [newUserForm, setNewUserForm] = useState({ username: '', password: '', isAdmin: false });

    // --- Server Mode State ---
    const [isServerMode, setIsServerMode] = useState(false);
    const [libraryPaths, setLibraryPaths] = useState<string[]>([]);
    const [newPathInput, setNewPathInput] = useState('');

    // --- Server Pagination State ---
    const [serverTotal, setServerTotal] = useState(0); // Count for CURRENT view (folder or all)
    const [libraryTotalCount, setLibraryTotalCount] = useState(0); // Count for "All Photos" in sidebar
    const [serverOffset, setServerOffset] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
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

    const handleSmartScan = async () => {
        try {
            await fetch('/api/thumb/smart-scan', { method: 'POST' });
            setThumbStatus('scanning'); // Optimistic
            startUnifiedPolling();
        } catch (e) { console.error(e); }
    };

    const handleFetchSmartResults = async () => {
        try {
            const res = await apiFetch('/api/thumb/smart-results');
            if (res.ok) setSmartScanResults(await res.json());
        } catch (e) { }
    };

    const handleSmartRepair = async () => {
        try {
            await apiFetch('/api/thumb/smart-repair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repairMissing: true, repairError: true })
            });
            setThumbStatus('scanning');
            startUnifiedPolling();
        } catch (e) { console.error(e); }
    };



    const scanProgressRef = useRef({ count: 0 }); // Added ref for progress
    const scanStatusRef = useRef<ScanStatus>('idle'); // Added ref for status
    const thumbStatusRef = useRef<'idle' | 'scanning' | 'paused' | 'error'>('idle');
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- App Data State ---
    const [allUserData, setAllUserData] = useState<Record<string, UserData>>({});
    const [appTitle, setAppTitle] = useState('Lumina Gallery');
    const [homeSubtitle, setHomeSubtitle] = useState('Your memories, beautifully organized. Rediscover your collection.');
    const [homeConfig, setHomeConfig] = useState<HomeScreenConfig>({ mode: 'random' });
    const [showDirPicker, setShowDirPicker] = useState(false);

    // Derived state for current user
    const files = useMemo(() =>
        currentUser ? (allUserData[currentUser.username]?.files || []) : [],
        [currentUser, allUserData]
    );

    const favoriteFolderPaths = useMemo(() =>
        currentUser ? (allUserData[currentUser.username]?.favoriteFolderPaths || []) : [],
        [currentUser, allUserData]
    );

    // --- View State ---
    const [viewMode, setViewMode] = useState<ViewMode>('home');
    const [layoutMode, setLayoutMode] = useState<GridLayout>('timeline'); // Default to timeline
    const [currentPath, setCurrentPath] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);

    // --- Audio Player State ---
    const [currentAudio, setCurrentAudio] = useState<MediaItem | null>(null);
    const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
    const [audioPlaylist, setAudioPlaylist] = useState<MediaItem[]>([]);
    const [currentAudioIndex, setCurrentAudioIndex] = useState(0);

    // --- Theme State ---
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

    // --- Sort & Filter State ---
    const [sortOption, setSortOption] = useState<SortOption>('dateDesc');
    const [filterOption, setFilterOption] = useState<FilterOption>('all');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general'); // New state for tabs

    useEffect(() => {
        if (settingsTab === 'system') {
            handleFetchSmartResults();
        }
    }, [settingsTab]);


    // --- Random Sort Stability ---
    const [randomizedFiles, setRandomizedFiles] = useState<MediaItem[]>([]);

    // --- Batch Operations State ---
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [thumbQueue, setThumbQueue] = useState<Array<{ id: string, name: string, total: number }>>([]);

    // --- Theme Logic ---
    useEffect(() => {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as 'light' | 'dark' | 'system' | null;
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
            // Use specific brand colors: dark (#020617) or light (#ffffff)
            metaThemeColor.setAttribute("content", effectiveTheme === 'dark' ? "#020617" : "#ffffff");
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
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    };

    const [threadCount, setThreadCount] = useState<number>(2);

    // --- Persistence Helper ---
    const persistData = async (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>, newLibraryPaths?: string[], newHomeSubtitle?: string, newHomeConfig?: HomeScreenConfig, newThreadCount?: number) => {
        const u = newUsers || users;
        const t = newTitle || appTitle;
        const s = newHomeSubtitle || homeSubtitle;
        const hc = newHomeConfig || homeConfig;
        const d = newAllUserData || allUserData;
        const l = newLibraryPaths || libraryPaths;
        const tc = newThreadCount !== undefined ? newThreadCount : threadCount;

        // Update React State
        if (newUsers) setUsers(newUsers);
        if (newTitle) setAppTitle(newTitle);
        if (newHomeSubtitle) setHomeSubtitle(newHomeSubtitle);
        if (newHomeConfig) setHomeConfig(newHomeConfig);
        if (newAllUserData) setAllUserData(newAllUserData);
        if (newLibraryPaths) setLibraryPaths(newLibraryPaths);
        if (newThreadCount !== undefined) setThreadCount(newThreadCount);

        // Construct Config Object
        const userSources: Record<string, any[]> = {};
        Object.keys(d).forEach(k => {
            userSources[k] = d[k].sources;
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
            try {
                await apiFetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
            } catch (e) {
                console.error("Failed to sync to server", e);
            }
        } else {
            localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(u));
            localStorage.setItem(APP_TITLE_KEY, t);
            localStorage.setItem(APP_SUBTITLE_KEY, s);
            localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(userSources));
        }
    };

    // 1. Initial Load & Mode Detection
    useEffect(() => {
        const initApp = async () => {
            let loadedUsers: User[] = [];
            let loadedData: Record<string, UserData> = {};
            let loadedTitle = 'Lumina Gallery';
            let loadedSubtitle = 'Your memories, beautifully organized. Rediscover your collection.';
            let loadedHomeConfig: HomeScreenConfig = { mode: 'random' };
            let serverMode = false;
            let loadedThreadCount = 2;

            try {
                const res = await fetch('/api/config');
                if (res.ok) {
                    const text = await res.text();
                    let config = null;
                    try {
                        config = JSON.parse(text);
                    } catch (e) { }

                    serverMode = true;
                    setIsServerMode(true);

                    if (config && typeof config === 'object' && config.users && config.users.length > 0) {
                        loadedUsers = config.users;
                        loadedTitle = config.title || 'Lumina Gallery';
                        if (config.homeSubtitle) loadedSubtitle = config.homeSubtitle;
                        if (config.homeScreen) loadedHomeConfig = config.homeScreen;
                        setLibraryPaths(config.libraryPaths || []);
                        if (config.threadCount) loadedThreadCount = config.threadCount;

                        setThreadCount(loadedThreadCount);

                        config.users.forEach((u: User) => {
                            loadedData[u.username] = { sources: [], files: [], favoriteFolderPaths: [] };
                        });
                    } else if (!config || config.configured === false) {
                        setAuthStep('setup');
                        return;
                    }
                }
            } catch (e) { }

            // Fallback or Local
            if (!serverMode || loadedUsers.length === 0) {
                const storedUsers = localStorage.getItem(USERS_STORAGE_KEY);
                const storedTitle = localStorage.getItem(APP_TITLE_KEY);
                const storedSubtitle = localStorage.getItem(APP_SUBTITLE_KEY);
                const storedSources = localStorage.getItem(SOURCES_STORAGE_KEY);

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
                    setAuthStep('setup');
                    return;
                }
            }

            setUsers(loadedUsers);
            setAppTitle(loadedTitle);
            setHomeSubtitle(loadedSubtitle);

            setHomeConfig(loadedHomeConfig);

            // Check Persistent Login & Load Cache (Performance)
            const savedUser = localStorage.getItem(AUTH_USER_KEY);
            const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;

            if (savedUser && (!savedViewMode || savedViewMode === 'home' || savedViewMode === 'all')) {
                try {
                    const cached = localStorage.getItem('lumina_cache_home');
                    if (cached && loadedData[savedUser]) {
                        const cData = JSON.parse(cached);
                        if (cData && Array.isArray(cData.files)) {
                            loadedData[savedUser].files = cData.files;
                            console.log('Processed Initial Cache:', cData.files.length);
                        }
                    }
                } catch (e) { }
            }

            setAllUserData(loadedData);

            if (savedUser) {
                const user = loadedUsers.find(u => u.username === savedUser);
                if (user) {
                    setCurrentUser(user);
                    setAuthStep('app');

                    // Load saved ViewMode to decide what to fetch
                    const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;

                    if (serverMode) {
                        // Ensure state is ready before fetching
                        // At this point, setAllUserData(loadedData) has been called
                        // so loadedData is the current state
                        setTimeout(async () => {
                            console.log('[DEBUG] initApp setTimeout - savedViewMode:', savedViewMode);
                            // CRITICAL: Fetch favorites IDs first and get the data
                            const favoriteIds = await fetchServerFavorites();
                            console.log('[DEBUG] fetchServerFavorites completed, got:', favoriteIds);

                            if (savedViewMode === 'favorites') {
                                console.log('[DEBUG] Fetching favorite files and folders');
                                // Pass favoriteIds directly to avoid state async issue
                                fetchServerFiles(user.username, loadedData, 0, true, null, true, favoriteIds);
                                fetchServerFolders(null, true);
                            } else if (savedViewMode === 'folders') {
                                // Default to root on load if no specific path logic yet
                                fetchServerFolders('', false);
                                // Don't fetch files immediately in folders view unless path is set
                            } else {
                                // Default / All Photos / Home
                                fetchServerFiles(user.username, loadedData, 0, true, null, false, favoriteIds);
                                fetchServerFolders('', false); // Fetch root folders
                            }
                        }, 50);

                        // Restore background task state
                        setTimeout(async () => {
                            try {
                                const [scanRes, thumbRes] = await Promise.all([
                                    fetch('/api/scan/status'),
                                    fetch('/api/thumb-gen/status')
                                ]);

                                let foundActive = false;

                                if (scanRes.ok) {
                                    const scanData = await scanRes.json();
                                    if (scanData.status === 'scanning' || scanData.status === 'paused') {
                                        setScanStatus(scanData.status);
                                        setScanProgress({ count: scanData.count, currentPath: scanData.currentPath || '', currentEngine: '' });
                                        scanStatusRef.current = scanData.status;
                                        foundActive = true;
                                    }
                                }

                                if (thumbRes.ok) {
                                    const thumbData = await thumbRes.json();
                                    if (thumbData.status === 'scanning' || thumbData.status === 'paused') {
                                        setThumbStatus(thumbData.status);
                                        setThumbProgress({ count: thumbData.count, total: thumbData.total, currentPath: thumbData.currentPath });
                                        thumbStatusRef.current = thumbData.status;
                                        foundActive = true;
                                    }
                                }

                                if (foundActive) {
                                    setIsUnifiedModalOpen(true);
                                    startUnifiedPolling();
                                }
                            } catch (e) {
                                console.error('[Restore] Failed to check background tasks', e);
                            }
                        }, 100);
                    }
                    return;
                }
            }

            setAuthStep('login');
        };

        // Check if we are already initialized to prevent double loading
        initApp();

        const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;
        if (savedViewMode) setViewMode(savedViewMode);

        const savedLayout = localStorage.getItem(LAYOUT_MODE_KEY) as GridLayout;
        if (savedLayout) setLayoutMode(savedLayout);
    }, []);

    // --- Browser History Integration ---
    useEffect(() => {
        const onPopState = (event: PopStateEvent) => {
            if (event.state && typeof event.state.path === 'string') {
                const path = event.state.path;
                setCurrentPath(path);
                if (viewMode === 'folders' && isServerMode && currentUser) {
                    fetchServerFiles(currentUser.username, allUserData, 0, true, path);
                    fetchServerFolders(path); // Update subfolders
                }
            } else {
                if (currentPath !== '') {
                    setCurrentPath('');
                    if (isServerMode && currentUser) {
                        fetchServerFiles(currentUser.username, allUserData, 0, true, '');
                        fetchServerFolders('');
                    }
                }
            }
        };

        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [viewMode, currentPath, isServerMode, currentUser, allUserData]);



    // --- Secure Fetch Helper ---
    const apiFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('lumina_token');
        const headers: any = { ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, { ...options, headers });
        if (res.status === 401 || res.status === 403) {
            setAuthStep('login');
            localStorage.removeItem('lumina_token');
            setCurrentUser(null);
        }
        return res;
    };

    // --- Server Logic: Scan & Poll ---

    const fetchServerFolders = async (parentPath: string | null = null, favoritesOnly = false) => {
        try {
            let url = `/api/library/folders`;
            const params = [];
            if (favoritesOnly) params.push('favorites=true');
            // Only append parent if we are not in favorites mode (favorites shows flat list of fav folders)
            if (parentPath !== null && !favoritesOnly) params.push(`parent=${encodeURIComponent(parentPath)}`);

            if (params.length > 0) url += `?${params.join('&')}`;

            const res = await apiFetch(url);
            if (res.ok) {
                const text = await res.text();
                try {
                    const data = JSON.parse(text);
                    if (data && data.folders) {
                        setServerFolders(data.folders);
                    }
                } catch (e) { }
            }
        } catch (e) { }
    };

    const fetchServerFavorites = async () => {
        console.log('[DEBUG] fetchServerFavorites called');
        try {
            const res = await apiFetch('/api/favorites/ids');
            if (res.ok) {
                const data = await res.json();
                console.log('[DEBUG] Favorites IDs received:', data);
                setServerFavoriteIds(data);
                console.log('[DEBUG] serverFavoriteIds state updated');
                return data; // Return data for immediate use
            } else {
                console.error('[DEBUG] Failed to fetch favorites:', res.status);
                return { files: [], folders: [] };
            }
        } catch (e) {
            console.error('[DEBUG] fetchServerFavorites error:', e);
            return { files: [], folders: [] };
        }
    };

    const fetchServerFiles = async (
        username: string,
        currentData: Record<string, UserData>,
        offset: number = 0,
        reset: boolean = false,
        folderFilter: string | null = null,
        favoritesOnly: boolean = false,
        favoriteIdsOverride?: { files: string[], folders: string[] }
    ) => {
        try {
            setIsFetchingMore(true);
            const limit = 500;
            let url = `/api/scan/results?offset=${offset}&limit=${limit}`;

            if (favoritesOnly) {
                url += `&favorites=true`;
            } else if (folderFilter !== null && folderFilter !== undefined) {
                url += `&folder=${encodeURIComponent(folderFilter)}`;
            }

            const res = await apiFetch(url);
            if (!res.ok) throw new Error(`API Error: ${res.status}`);

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error("Invalid JSON response");
            }

            if (!data) throw new Error("Empty response data");

            // Map isFavorite property - use override if provided, otherwise use state
            const favIds = favoriteIdsOverride || serverFavoriteIds;
            console.log('[DEBUG] Mapping isFavorite - using favoriteIds:', favIds);
            console.log('[DEBUG] Received files count:', data.files.length);
            const filesWithFavorites = data.files.map((file: MediaItem) => ({
                ...file,
                isFavorite: favIds.files.includes(file.path)
            }));
            console.log('[DEBUG] Files with favorites mapped:', filesWithFavorites.filter(f => f.isFavorite).length, 'favorites');

            const newFiles = reset ? filesWithFavorites : [...(currentData[username]?.files || []), ...filesWithFavorites];
            console.log('[DEBUG] Total files to set:', newFiles.length);

            setAllUserData({
                ...currentData,
                [username]: {
                    ...currentData[username],
                    files: newFiles,
                    sources: data.sources
                }
            });

            setServerTotal(data.total);
            if (folderFilter === null && !favoritesOnly) {
                setLibraryTotalCount(data.total);

                // Cache First Page (Performance Optimization)
                if (offset === 0) {
                    try {
                        const cacheData = {
                            files: filesWithFavorites.slice(0, 200), // Cache first 200 items
                            total: data.total,
                            timestamp: Date.now()
                        };
                        localStorage.setItem('lumina_cache_home', JSON.stringify(cacheData));
                    } catch (e) { console.error('Cache save failed', e); }
                }
            }


            setServerOffset(offset + limit);
            setHasMoreServer(data.hasMore);

        } catch (e) {
            console.error("Fetch files failed", e);
        } finally {
            setIsFetchingMore(false);
        }
    };

    const loadMoreServerFiles = async () => {
        if (!isServerMode || !currentUser || !hasMoreServer || isFetchingMore) return;
        const filter = viewMode === 'folders' ? currentPath : null;
        const favs = viewMode === 'favorites';
        await fetchServerFiles(currentUser.username, allUserData, serverOffset, false, filter, favs);
    };

    const stopPolling = () => {
        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
            scanTimeoutRef.current = null;
        }
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

    const startUnifiedPolling = () => {
        stopPolling();

        const poll = async () => {
            // Poll Scan
            try {
                const scanRes = await apiFetch('/api/scan/status');
                if (scanRes.ok) {
                    const scanData = await scanRes.json();
                    const newScanStatus = scanData.status as ScanStatus;

                    setScanStatus(newScanStatus);
                    scanStatusRef.current = newScanStatus;

                    if (newScanStatus !== 'idle') {
                        setScanProgress({
                            count: scanData.count || 0,
                            currentPath: scanData.currentPath || '',
                            currentEngine: ''
                        });
                        scanProgressRef.current = { count: scanData.count || 0 };
                    }
                }
            } catch (e) { }

            // Poll Thumb
            try {
                const thumbRes = await apiFetch('/api/thumb-gen/status');
                if (thumbRes.ok) {
                    const thumbData = await thumbRes.json();
                    const newThumbStatus = thumbData.status === 'scanning' || thumbData.status === 'paused' ? thumbData.status : 'idle';

                    // Update Queue (if available)
                    if (thumbData.queue) {
                        setThumbQueue(thumbData.queue);
                    } else {
                        setThumbQueue([]);
                    }

                    // If we encounter an error or finished state that isn't idle, we might want to show it
                    // but for now, track active states.
                    setThumbStatus(thumbData.status);
                    thumbStatusRef.current = thumbData.status;

                    setThumbProgress({
                        count: thumbData.count || 0,
                        total: thumbData.total || 0, // Ensure total is captured
                        currentPath: thumbData.currentPath || ''
                    });
                }
            } catch (e) { }

            // Continue polling if ANY active OR queue has items
            const isScanActive = scanStatusRef.current === 'scanning' || scanStatusRef.current === 'paused';
            const isThumbActive = thumbStatusRef.current === 'scanning' || thumbStatusRef.current === 'paused';

            // Check queue length from state is risky due to closure stale state
            // relying on active status for poll continuation is safer for now.
            // If the queue has items, the status SHOULD be scanning (processing queue)
            // But if we just finished one task and waiting for next tick, it might arguably briefly be idle.
            // But the backend sets status to scanning immediately if queue > 0.
            // So checking status is sufficient.

            if (isScanActive || isThumbActive) {
                scanTimeoutRef.current = setTimeout(poll, 1000);
            } else {
                fetchSystemStatus();
                if (currentUser) {
                    // Refresh library if tasks just finished
                    // This might trigger too often if both finish at slightly different times, but it's safe
                    fetchServerFiles(currentUser.username, allUserData, 0, true, currentPath, viewMode === 'favorites');
                    fetchServerFolders(currentPath);
                }
            }
        };
        poll();
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
                alert("Failed to start scan");
            }
        } catch (e) {
            setScanStatus('idle');
            scanStatusRef.current = 'idle';
            alert("Network error starting scan");
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
                alert("Failed to start thumbnail generation");
            }
        } catch (e) {
            setThumbStatus('idle');
            thumbStatusRef.current = 'idle';
            alert("Network error starting thumbnail generation");
        }
    };

    const clearCache = async () => {
        if (!isServerMode || !confirm('Are you sure you want to clear all cache? Thumbnails will need to be regenerated.')) return;
        try {
            await apiFetch('/api/cache/clear', { method: 'POST' });
            fetchSystemStatus(true);
            alert(t('cache_cleared'));
        } catch (e) { alert('Network error'); }
    };

    const pruneCache = async () => {
        if (!isServerMode) return;
        try {
            const res = await apiFetch('/api/cache/prune', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                alert(`${t('cache_pruned')}: ${data.count} items`);
                fetchSystemStatus(true);
            }
        } catch (e) { alert('Network error'); }
    };

    const handleRegenerateFolder = async (folderPathArg?: string) => {
        const targetPath = folderPathArg || currentPath;
        if (!isServerMode || !targetPath || isRegenerating) return;
        if (!confirm(t('confirm_regenerate_folder') || "Are you sure you want to regenerate thumbnails for this folder and its subfolders?")) return;

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
                alert('Failed to start regeneration');
                setIsUnifiedModalOpen(false); // Close if failed to start
            }
        } catch (e) {
            alert('Network error');
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

            // Check both
            Promise.all([
                apiFetch('/api/scan/status').then(r => r.json()),
                apiFetch('/api/thumb-gen/status').then(r => r.json())
            ]).then(([scanData, thumbData]) => {
                if (!isMounted) return;

                let foundActive = false;

                if (scanData && (scanData.status === 'scanning' || scanData.status === 'paused')) {
                    setScanStatus(scanData.status);
                    setScanProgress({ count: scanData.count, currentPath: scanData.currentPath || '', currentEngine: '' });
                    scanStatusRef.current = scanData.status;
                    foundActive = true;
                }

                if (thumbData && (thumbData.status === 'scanning' || thumbData.status === 'paused')) {
                    setThumbStatus(thumbData.status);
                    setThumbProgress({ count: thumbData.count, total: thumbData.total, currentPath: thumbData.currentPath });
                    thumbStatusRef.current = thumbData.status;
                    foundActive = true;
                }

                if (foundActive) {
                    setIsUnifiedModalOpen(true);
                    startUnifiedPolling();
                }
            }).catch(() => { });
        }
        return () => {
            isMounted = false;
            stopPolling();
        };
    }, [isServerMode, currentUser]);

    const handleUnifiedClose = () => {
        // If both idle, we can close
        // If one is active, user probably just wants to hide the modal? 
        // Or we strictly follow: Close button only appears if both IDLE (in Component).
        // So here we just set open false.
        setIsUnifiedModalOpen(false);
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


    const handleSetViewMode = async (mode: ViewMode) => {
        setViewMode(mode);
        localStorage.setItem(VIEW_MODE_KEY, mode);
        setCurrentPath('');

        if (isServerMode && currentUser) {
            // Clear current files to avoid "flash" of old content when switching views
            // OPTIMIZED: Try to load from cache for 'home'/'all' views
            let initialFiles: MediaItem[] = [];
            if (mode === 'all' || mode === 'home') {
                try {
                    const cached = localStorage.getItem('lumina_cache_home');
                    if (cached) {
                        const cData = JSON.parse(cached);
                        if (cData && Array.isArray(cData.files)) {
                            initialFiles = cData.files;
                            console.log('Loaded from cache:', initialFiles.length);
                        }
                    }
                } catch (e) { }
            }

            const clearedData = {
                ...allUserData,
                [currentUser.username]: {
                    ...allUserData[currentUser.username],
                    files: initialFiles
                }
            };
            setAllUserData(clearedData);

            // CRITICAL: Fetch favorites IDs first and get the data
            const favoriteIds = await fetchServerFavorites();
            console.log('[DEBUG] handleSetViewMode - got favoriteIds:', favoriteIds);

            if (mode === 'all' || mode === 'home') {
                fetchServerFiles(currentUser.username, clearedData, 0, true, null, false, favoriteIds);
                fetchServerFolders(null, false); // Get all folders usually not needed for 'all', but if needed
            } else if (mode === 'favorites') {
                fetchServerFiles(currentUser.username, clearedData, 0, true, null, true, favoriteIds);
                fetchServerFolders(null, true); // Get favorite folders
            } else if (mode === 'folders') {
                fetchServerFolders('', false); // Get ROOT folders
                fetchServerFiles(currentUser.username, clearedData, 0, true, '', false, favoriteIds); // Get ROOT files
            } else {
                fetchServerFolders('', false);
            }
        }
    };

    const handleFolderClick = (path: string, pushState = true) => {
        setCurrentPath(path);
        if (pushState) {
            window.history.pushState({ path }, '', '#folder=' + encodeURIComponent(path));
        }
        if (isServerMode && currentUser) {
            fetchServerFiles(currentUser.username, allUserData, 0, true, path);
            fetchServerFolders(path); // Fetch sub-folders for the new path
        }
    };

    const handleGoBackFolder = () => {
        // Flattened Navigation:
        // If the current path corresponds to one of the configured library roots,
        // pressing "Back" should return to the top-level view, skipping intermediate folders.
        if (libraryPaths && libraryPaths.some(lp => {
            const normalizedLp = lp.replace(/\\/g, '/');
            const normalizedCurrent = currentPath.replace(/\\/g, '/');
            return normalizedLp === normalizedCurrent || normalizedLp === normalizedCurrent + '/';
        })) {
            handleFolderClick('');
            return;
        }

        const parts = currentPath.split('/');
        parts.pop();
        const parentPath = parts.join('/');
        handleFolderClick(parentPath);
    };

    const handleJumpToFolder = (item: MediaItem) => {
        setViewMode('folders');
        localStorage.setItem(VIEW_MODE_KEY, 'folders');
        handleFolderClick(item.folderPath);
    };

    // User Management Handlers
    const handleAddUser = () => {
        setNewUserForm({ username: '', password: '', isAdmin: false });
        setUserFormType('add');
        setIsUserModalOpen(true);
    };

    const handleDeleteUser = (user: User) => {
        if (user.username === currentUser?.username) return; // Can't delete self
        if (confirm(t('delete_user_confirm'))) {
            const updatedUsers = users.filter(u => u.username !== user.username);
            const updatedData = { ...allUserData };
            delete updatedData[user.username];
            persistData(updatedUsers, undefined, updatedData);
        }
    };

    const handleResetPassword = (user: User) => {
        setTargetUser(user);
        setNewUserForm({ username: user.username, password: '', isAdmin: user.isAdmin });
        setUserFormType('reset');
        setIsUserModalOpen(true);
    };

    const handleRenameUser = (user: User) => {
        setTargetUser(user);
        setNewUserForm({ username: user.username, password: '', isAdmin: user.isAdmin });
        setUserFormType('rename');
        setIsUserModalOpen(true);
    };

    const submitUserForm = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newUserForm.username || (userFormType !== 'rename' && !newUserForm.password)) return;

        if (userFormType === 'add') {
            if (users.find(u => u.username === newUserForm.username)) {
                alert('User already exists');
                return;
            }
            const newUser: User = {
                username: newUserForm.username,
                password: newUserForm.password,
                isAdmin: newUserForm.isAdmin,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newUserForm.username}`
            };
            const updatedUsers = [...users, newUser];
            const updatedData = { ...allUserData, [newUser.username]: { sources: [], files: [], favoriteFolderPaths: [] } };
            persistData(updatedUsers, undefined, updatedData);
        } else if (userFormType === 'rename' && targetUser) {
            if (newUserForm.username !== targetUser.username) {
                if (users.find(u => u.username === newUserForm.username)) {
                    alert('Username already taken');
                    return;
                }
                const updatedUsers = users.map(u => {
                    if (u.username === targetUser.username) {
                        return { ...u, username: newUserForm.username };
                    }
                    return u;
                });

                const updatedData = { ...allUserData };
                if (updatedData[targetUser.username]) {
                    updatedData[newUserForm.username] = updatedData[targetUser.username];
                    delete updatedData[targetUser.username];
                }

                if (currentUser?.username === targetUser.username) {
                    const updatedUser = { ...currentUser, username: newUserForm.username };
                    setCurrentUser(updatedUser);
                    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
                }

                persistData(updatedUsers, undefined, updatedData);
            }
        } else if (userFormType === 'reset' && targetUser) {
            const updatedUsers = users.map(u => {
                if (u.username === targetUser.username) {
                    return { ...u, password: newUserForm.password, isAdmin: newUserForm.isAdmin };
                }
                return u;
            });
            persistData(updatedUsers);
        }
        setIsUserModalOpen(false);
    };

    const handleToggleFavorite = async (item: MediaItem | string, type: 'file' | 'folder') => {
        if (!currentUser) return;
        const targetId = typeof item === 'string' ? item : (isServerMode ? item.path : item.id);

        if (isServerMode) {
            try {
                const res = await apiFetch('/api/favorites/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, id: targetId })
                });
                const data = await res.json();
                if (data.success) {
                    // Update local state to reflect change immediately if possible
                    if (type === 'file') {
                        const updatedFiles = files.map(f => f.path === targetId ? { ...f, isFavorite: data.isFavorite } : f);
                        setAllUserData({
                            ...allUserData,
                            [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles }
                        });
                        if (data.isFavorite) {
                            setServerFavoriteIds(prev => ({ ...prev, files: [...prev.files, targetId] }));
                        } else {
                            setServerFavoriteIds(prev => ({ ...prev, files: prev.files.filter(id => id !== targetId) }));
                        }

                        // Critical: Update selectedItem if it is currently open in ImageViewer
                        if (selectedItem && (selectedItem.path === targetId)) {
                            setSelectedItem(prev => prev ? { ...prev, isFavorite: data.isFavorite } : null);
                        }
                    } else {
                        // Update favorite folders list
                        if (data.isFavorite) {
                            setServerFavoriteIds(prev => ({ ...prev, folders: [...prev.folders, targetId] }));
                        } else {
                            setServerFavoriteIds(prev => ({ ...prev, folders: prev.folders.filter(id => id !== targetId) }));
                        }
                        if (viewMode === 'favorites') fetchServerFolders(null, true);
                    }
                }
            } catch (e) { }
        } else {
            // Client mode
            if (type === 'file') {
                const updatedFiles = files.map(f => f.id === targetId ? { ...f, isFavorite: !f.isFavorite } : f);
                const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
                setAllUserData(updatedUserData);
                persistData(undefined, undefined, updatedUserData);

                // Critical: Update selectedItem if it is currently open in ImageViewer
                if (selectedItem && (selectedItem.id === targetId)) {
                    setSelectedItem(prev => prev ? { ...prev, isFavorite: !prev.isFavorite } : null);
                }
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

    const handleRename = async (item: MediaItem, newName: string) => {
        if (!currentUser) return;
        if (isServerMode) {
            try {
                const res = await apiFetch('/api/file/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: item.path, newName: newName })
                });
                const data = await res.json();
                if (data.success) {
                    if (viewMode === 'all') fetchServerFiles(currentUser.username, allUserData, 0, true, null);
                    else if (viewMode === 'folders') fetchServerFiles(currentUser.username, allUserData, 0, true, currentPath);
                } else {
                    alert("Rename failed: " + data.error);
                }
            } catch (e) { alert("Network error"); }
        } else {
            const updatedFiles = files.map(f => {
                if (f.id === item.id) return { ...f, name: newName };
                return f;
            });
            const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
        }
    };

    const handleDelete = async (item: MediaItem) => {
        if (!currentUser) return;
        if (isServerMode) {
            try {
                const res = await apiFetch('/api/file/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: item.path })
                });
                const data = await res.json();
                if (data.success) {
                    setSelectedItem(null);
                    if (viewMode === 'all') fetchServerFiles(currentUser.username, allUserData, 0, true, null);
                    else if (viewMode === 'folders') fetchServerFiles(currentUser.username, allUserData, 0, true, currentPath);
                } else {
                    alert("Delete failed: " + data.error);
                }
            } catch (e) { alert("Network error"); }
        } else {
            const updatedFiles = files.filter(f => f.id !== item.id);
            const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
            setSelectedItem(null);
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
                    alert("Folder renamed. Please rescan library to update database.");
                    if (viewMode === 'favorites') {
                        fetchServerFolders(null, true);
                    } else if (viewMode === 'folders') {
                        fetchServerFolders(currentPath);
                    }
                } else {
                    alert("Error: " + data.error);
                }
            } catch (e) { alert("Network error"); }
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
        if (!currentUser || !confirm(`Are you sure you want to delete folder "${pathStr}" and all its contents?`)) return;

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
                    if (currentPath.startsWith(pathStr)) {
                        const parent = pathStr.split('/').slice(0, -1).join('/');
                        handleFolderClick(parent);
                    } else {
                        fetchServerFolders(currentPath);
                    }
                } else {
                    alert("Error: " + data.error);
                }
            } catch (e) { alert("Network error"); }
        } else {
            // Client mode delete
            const updatedFiles = files.filter(f => !f.path.startsWith(pathStr + '/') && f.path !== pathStr);
            const updatedUserData = { ...allUserData, [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles } };
            setAllUserData(updatedUserData);
            persistData(undefined, undefined, updatedUserData);
        }
    };

    const toggleLayoutMode = () => {
        let newMode: GridLayout = 'grid';
        if (layoutMode === 'grid') newMode = 'masonry';
        else if (layoutMode === 'masonry') newMode = 'timeline';
        else if (layoutMode === 'timeline') newMode = 'grid';

        setLayoutMode(newMode);
        localStorage.setItem(LAYOUT_MODE_KEY, newMode);
    };

    const handleUpdateTitle = (newTitle: string) => {
        persistData(undefined, newTitle, undefined, undefined, undefined);
    };

    const handleUpdateSubtitle = (newSubtitle: string) => {
        persistData(undefined, undefined, undefined, undefined, newSubtitle);
    };

    const handleUpdateHomeConfig = (newConfig: HomeScreenConfig) => {
        persistData(undefined, undefined, undefined, undefined, undefined, newConfig);
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
        if (viewMode === 'folders' && currentPath) {
            if (!isServerMode) {
                result = result.filter(f => f.folderPath === currentPath);
            } else {
                // In server mode, 'files' is the content of the current folder/query. 
                // However, to be safe against race conditions where 'files' might be 'all photos' temporarily:
                result = result.filter(f => f.folderPath === currentPath);
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

        // 4. Sorting
        if (sortOption === 'random') {
            // Stable random sort
            if (randomizedFiles.length > 0 && result.length === randomizedFiles.length && result[0]?.id === randomizedFiles[0]?.id) {
                return randomizedFiles;
            }
            const shuffled = sortMedia(result, 'random');
            setRandomizedFiles(shuffled);
            return shuffled;
        } else {
            result = sortMedia(result, sortOption);
        }

        return result;
    }, [files, viewMode, currentPath, filterOption, sortOption, isServerMode, serverFavoriteIds]);

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
    const visibleFolders = isServerMode ? serverFolders : clientSubfolders;

    const mixedItems = useMemo(() => {
        // Map folders to compatible MediaItem shape
        const folderItems: MediaItem[] = visibleFolders.map(f => ({
            id: f.path, // Use path as ID for folders
            name: f.name || f.path.split('/').pop() || 'Root',
            path: f.path,
            folderPath: f.path.split('/').slice(0, -1).join('/'),
            url: '', // Folders don't have a direct URL
            type: 'application/x-directory',
            mediaType: 'folder', // Now valid in types
            size: 0,
            lastModified: 0,
            sourceId: 'system',
            // Folder specific props
            mediaCount: f.mediaCount !== undefined ? f.mediaCount : (f as any).count,
            coverMedia: f.coverMedia || (f as any).coverItem,
            isFavorite: isServerMode
                ? serverFavoriteIds.folders.includes(f.path)
                : (allUserData[currentUser?.username || '']?.favoriteFolderPaths || []).includes(f.path)
        }));

        // Folders always first
        return [...folderItems, ...processedFiles];
    }, [visibleFolders, processedFiles, isServerMode, serverFavoriteIds, allUserData, currentUser]);


    // Auth/Setup Screens
    if (authStep === 'loading') {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Icons.Loader className="animate-spin text-primary-500" size={32} />
            </div>
        );
    }

    if (authStep === 'setup' || authStep === 'login') {
        // Basic Auth UI
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/30">
                            <div className="w-8 h-8 bg-white/30 rounded-full" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-2">
                        {authStep === 'setup' ? t('welcome') : t('sign_in')}
                    </h1>
                    <p className="text-center text-gray-500 dark:text-gray-400 mb-8">
                        {authStep === 'setup' ? t('setup_admin') : 'Access your Lumina Gallery'}
                    </p>

                    {authError && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-center gap-2">
                            <Icons.Alert size={16} />
                            {authError}
                        </div>
                    )}

                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (authStep === 'setup') {
                            if (setupForm.password !== setupForm.confirmPassword) {
                                setAuthError(t('passwords_not_match'));
                                return;
                            }
                            const newUser = {
                                username: setupForm.username,
                                password: setupForm.password,
                                isAdmin: true,
                                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${setupForm.username}`
                            };
                            const newUsers = [newUser];
                            const newData = { [newUser.username]: { sources: [], files: [], favoriteFolderPaths: [] } };
                            persistData(newUsers, undefined, newData);
                            setUsers(newUsers);
                            setAllUserData(newData);
                            setCurrentUser(newUser);
                            setAuthStep('app');
                            localStorage.setItem(AUTH_USER_KEY, newUser.username);
                        } else {
                            if (isServerMode) {
                                fetch('/api/auth/login', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(loginForm)
                                })
                                    .then(async (res) => {
                                        if (res.ok) {
                                            const data = await res.json();
                                            if (data.token) {
                                                localStorage.setItem('lumina_token', data.token);
                                                setCurrentUser(data.user);
                                                setAuthStep('app');
                                                localStorage.setItem(AUTH_USER_KEY, data.user.username);

                                                // Trigger init fetch if server mode
                                                setTimeout(() => {
                                                    // Make sure fetchServerFiles uses the token now (will be updated in next step)
                                                    fetchServerFiles(data.user.username, allUserData, 0, true, null);
                                                    fetchServerFolders('', false);
                                                }, 100);
                                            }
                                        } else {
                                            setAuthError(t('invalid_credentials'));
                                        }
                                    })
                                    .catch(() => setAuthError('Connection Failed'));
                            } else {
                                const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
                                if (user) {
                                    setCurrentUser(user);
                                    setAuthStep('app');
                                    localStorage.setItem(AUTH_USER_KEY, user.username);
                                } else {
                                    setAuthError(t('invalid_credentials'));
                                }
                            }
                        }
                    }} className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Username</label>
                            <input
                                required
                                type="text"
                                className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                value={authStep === 'setup' ? setupForm.username : loginForm.username}
                                onChange={e => authStep === 'setup' ? setSetupForm({ ...setupForm, username: e.target.value }) : setLoginForm({ ...loginForm, username: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Password</label>
                            <input
                                required
                                type="password"
                                className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                value={authStep === 'setup' ? setupForm.password : loginForm.password}
                                onChange={e => authStep === 'setup' ? setSetupForm({ ...setupForm, password: e.target.value }) : setLoginForm({ ...loginForm, password: e.target.value })}
                            />
                        </div>
                        {authStep === 'setup' && (
                            <div className="space-y-1">
                                <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Confirm Password</label>
                                <input
                                    required
                                    type="password"
                                    className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    value={setupForm.confirmPassword}
                                    onChange={e => setSetupForm({ ...setupForm, confirmPassword: e.target.value })}
                                />
                            </div>
                        )}
                        <button type="submit" className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-lg transition-colors shadow-lg shadow-primary-600/20">
                            {authStep === 'setup' ? t('create_admin') : t('sign_in')}
                        </button>
                    </form>
                    {authStep === 'login' && users.length === 0 && (
                        <div className="mt-4 text-center">
                            <button onClick={() => setAuthStep('setup')} className="text-sm text-primary-600 hover:underline">Need to set up?</button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Helper to render specific tab content
    const renderSettingsContent = () => {
        switch (settingsTab) {
            case 'general':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('appearance')}</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('website_title')}</label>
                                    <input
                                        value={appTitle}
                                        onChange={e => handleUpdateTitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('home_subtitle')}</label>
                                    <input
                                        value={homeSubtitle}
                                        onChange={e => handleUpdateSubtitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('language')}</label>
                                    <select
                                        value={language}
                                        onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    >
                                        <option value="en">English</option>
                                        <option value="zh">中文 (Chinese)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">{t('home_screen_conf')}</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {['random', 'folder', 'single'].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => handleUpdateHomeConfig({ ...homeConfig, mode: m as any })}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${homeConfig.mode === m ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                                            >
                                                {t(m === 'random' ? 'random_all' : (m === 'folder' ? 'specific_folder' : 'single_item'))}
                                            </button>
                                        ))}
                                    </div>
                                    {homeConfig.mode !== 'random' && (
                                        <input
                                            placeholder={t('enter_rel_path')}
                                            value={homeConfig.path || ''}
                                            onChange={e => handleUpdateHomeConfig({ ...homeConfig, path: e.target.value })}
                                            className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm transition-all"
                                        />
                                    )}
                                </div>
                            </div>
                        </section>
                    </div>
                );
            case 'library':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        {!isServerMode ? (
                            <div className="flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                                <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full mb-4">
                                    <Icons.Server size={32} className="text-gray-400" />
                                </div>
                                <h4 className="text-lg font-bold mb-2">{t('running_client_mode')}</h4>
                                <p className="text-center text-sm text-gray-500 max-w-sm mb-6">
                                    {t('client_mode_description')}
                                </p>
                                <button
                                    onClick={() => { setIsServerMode(true); setSettingsTab('system'); }}
                                    className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
                                >
                                    {t('switch_to_server')}
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Library Paths */}
                                <section>
                                    <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('storage_database')}</h4>
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                                        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                                            <h5 className="font-bold text-lg mb-2">{t('library_scan_paths')}</h5>
                                            <p className="text-sm text-gray-500 mb-4">{t('media_served')}</p>
                                            <form onSubmit={handleAddLibraryPath} className="flex gap-2">
                                                <div className="flex-1 relative">
                                                    <input
                                                        value={newPathInput}
                                                        onChange={(e) => setNewPathInput(e.target.value)}
                                                        placeholder="/media"
                                                        className="w-full px-4 py-2 pr-12 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDirPicker(true)}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                                                        title={t('browse')}
                                                    >
                                                        <Icons.FolderOpen size={16} />
                                                    </button>
                                                </div>
                                                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2">
                                                    <Icons.Plus size={18} /> {t('add_path')}
                                                </button>
                                            </form>
                                        </div>
                                        <div className="bg-gray-50 dark:bg-gray-900/50 p-2 space-y-1 max-h-64 overflow-y-auto border-b border-gray-100 dark:border-gray-700">
                                            {libraryPaths.length === 0 && (
                                                <div className="p-4 text-center text-sm text-gray-500 italic">
                                                    {t('scanning_default')} <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1 rounded">/media</span>
                                                </div>
                                            )}
                                            {libraryPaths.map(path => (
                                                <div key={path} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm group">
                                                    <div className="flex items-center gap-3">
                                                        <Icons.Folder size={18} className="text-primary-500" />
                                                        <span className="font-mono text-sm">{path}</span>
                                                    </div>
                                                    <button onClick={() => handleRemoveLibraryPath(path)} className="text-red-500 opacity-0 group-hover:opacity-100 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all">
                                                        <Icons.Trash size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Integrated Monitoring Strategy Selector */}
                                        {systemStatus && (
                                            <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-100 dark:border-gray-700">
                                                <div className="mb-3">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Icons.Activity size={18} className="text-gray-500" />
                                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{t('monitoring_strategy')}</span>
                                                    </div>

                                                    <div className="flex flex-col gap-3">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {(['manual', 'periodic'] as const).map((m) => (
                                                                <button
                                                                    key={m}
                                                                    onClick={() => handleMonitorUpdate(m, systemStatus.scanInterval)}
                                                                    className={`px-3 py-2 rounded-lg text-xs font-medium border capitalize transition-all ${(systemStatus.mode || 'manual') === m
                                                                        ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-sm'
                                                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                                        }`}
                                                                >
                                                                    {t((m + '_mode') as any)}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        <div className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700/50">
                                                            {(systemStatus.mode || 'manual') === 'manual' && <p>{t('monitoring_desc_manual')}</p>}
                                                            {(systemStatus.mode || 'manual') === 'periodic' && (
                                                                <div className="space-y-2">
                                                                    <p>{t('monitoring_desc_periodic')}</p>
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        <span>{t('scan_every')}:</span>
                                                                        <select
                                                                            value={systemStatus.scanInterval || 60}
                                                                            onChange={(e) => handleMonitorUpdate('periodic', parseInt(e.target.value))}
                                                                            className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary-500"
                                                                        >
                                                                            <option value="15">15 {t('minutes')}</option>
                                                                            <option value="30">30 {t('minutes')}</option>
                                                                            <option value="60">1 {t('hour')}</option>
                                                                            <option value="360">6 {t('hours')}</option>
                                                                            <option value="720">12 {t('hours')}</option>
                                                                            <option value="1440">24 {t('hours')}</option>
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Operations */}
                                <section>
                                    <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">Maintenance</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-xl"><Icons.Scan size={24} /></div>
                                                <div>
                                                    <h5 className="font-bold text-gray-900 dark:text-white">{t('scan_library')}</h5>
                                                    <p className="text-xs text-gray-500">Index files from disk</p>
                                                </div>
                                            </div>
                                            <button onClick={startServerScan} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm shadow-blue-500/20">
                                                Start Scan
                                            </button>
                                        </div>

                                        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 rounded-xl"><Icons.Image size={24} /></div>
                                                <div>
                                                    <h5 className="font-bold text-gray-900 dark:text-white">{t('generate_thumbs')}</h5>
                                                    <p className="text-xs text-gray-500">Process missing previews</p>
                                                </div>
                                            </div>
                                            <button onClick={startThumbnailGen} className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm shadow-purple-500/20">
                                                Generate
                                            </button>
                                        </div>
                                    </div>
                                </section>

                            </>
                        )
                        }
                    </div >
                );
            case 'system':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('connection')}</h4>
                            <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl inline-flex w-full md:w-auto">
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${!isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => setIsServerMode(false)}>
                                    {t('client_mode')}
                                </button>
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => setIsServerMode(true)}>
                                    {t('server_mode')}
                                </button>
                            </div>
                        </section>

                        {isServerMode && systemStatus && (
                            <div className="space-y-6">
                                {/* System Dashboard Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                                        <div>
                                            <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                                <Icons.Cpu size={18} className="text-primary-500" /> {t('backend_components')}
                                            </h5>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">FFmpeg (Video)</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg ? t('active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg ? 'bg-green-500' : 'bg-red-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">{t('image_processor')}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg || systemStatus.sharp ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg || systemStatus.sharp ? (systemStatus.imageProcessor || 'Active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg || systemStatus.sharp ? 'bg-green-500' : 'bg-red-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">Database</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.dbStatus === 'connected' ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.dbStatus === 'connected' ? 'Connected' : (systemStatus.dbStatus || 'Unknown')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.dbStatus === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">GPU Acceleration</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-gray-600 bg-gray-100 dark:bg-gray-800'} px-2 py-0.5 rounded uppercase`}>
                                                            {systemStatus.hardwareAcceleration?.type === 'cuda' ? 'NVIDIA CUDA' : (systemStatus.hardwareAcceleration?.type === 'vaapi' ? 'Intel/AMD VAAPI' : 'Disabled')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'bg-green-500' : 'bg-gray-400'}`} />
                                                    </div>
                                                </div>

                                                {/* HW Accel Details Inline */}
                                                {systemStatus.ffmpegHwAccels && systemStatus.ffmpegHwAccels.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 justify-end mt-1 pl-8">
                                                        {systemStatus.ffmpegHwAccels.map(accel => (
                                                            <span key={accel} className="px-2 py-0.5 bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 rounded text-[10px] uppercase font-medium border border-gray-100 dark:border-gray-700">
                                                                {accel}
                                                            </span>
                                                        ))}
                                                    </div>


                                                )}
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-100 dark:border-gray-700">
                                            <span className="text-xs text-gray-400">Platform</span>
                                            <span className="text-xs font-mono text-gray-500 bg-gray-50 dark:bg-gray-900/50 px-2 py-0.5 rounded">{systemStatus.platform}</span>
                                        </div>
                                    </div>

                                    {/* Performance Settings */}
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                                        <div>
                                            <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                                <Icons.Cpu size={18} className="text-orange-500" /> {t('performance_settings')}
                                            </h5>
                                            <div className="space-y-4">
                                                <div>
                                                    <div className="flex justify-between mb-2">
                                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('thumbnail_threads')}</label>
                                                        <span className="text-xs font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded">{threadCount}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max="100"
                                                        step="1"
                                                        value={threadCount}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value);
                                                            setThreadCount(val);
                                                            persistData(undefined, undefined, undefined, undefined, undefined, undefined, val);
                                                        }}
                                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-orange-500"
                                                    />
                                                    <p className="text-xs text-gray-400 mt-1">{t('thumbnail_threads_desc')}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                    {/* Media Statistics */}
                                    {systemStatus.mediaStats && (
                                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                                            <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                                <Icons.Database size={18} className="text-purple-500" /> {t('media_statistics')}
                                            </h5>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl border border-blue-200 dark:border-blue-800">
                                                    <Icons.Image size={24} className="text-blue-600 dark:text-blue-400 mb-2" />
                                                    <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                                                        {systemStatus.mediaStats.images.toLocaleString()}
                                                    </span>
                                                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1">{t('images')}</span>
                                                </div>
                                                <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-xl border border-green-200 dark:border-green-800">
                                                    <Icons.Video size={24} className="text-green-600 dark:text-green-400 mb-2" />
                                                    <span className="text-2xl font-bold text-green-700 dark:text-green-300">
                                                        {systemStatus.mediaStats.videos.toLocaleString()}
                                                    </span>
                                                    <span className="text-xs text-green-600 dark:text-green-400 font-medium mt-1">{t('videos')}</span>
                                                </div>
                                                <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 rounded-xl border border-orange-200 dark:border-orange-800">
                                                    <Icons.Music size={24} className="text-orange-600 dark:text-orange-400 mb-2" />
                                                    <span className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                                                        {systemStatus.mediaStats.audio.toLocaleString()}
                                                    </span>
                                                    <span className="text-xs text-orange-600 dark:text-orange-400 font-medium mt-1">{t('audio')}</span>
                                                </div>
                                                <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-xl border border-purple-200 dark:border-purple-800">
                                                    <Icons.Folder size={24} className="text-purple-600 dark:text-purple-400 mb-2" />
                                                    <span className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                                                        {systemStatus.mediaStats.totalFiles.toLocaleString()}
                                                    </span>
                                                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium mt-1">{t('total_files')}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Cache Control */}
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center justify-between mb-4">
                                                <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                                                    <Icons.Database size={18} className="text-blue-500" /> {t('cache_management')}
                                                </h5>
                                                <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full text-xs font-bold">
                                                    {systemStatus.cacheCount.toLocaleString()} {t('cached')}
                                                </div>
                                            </div>

                                            {/* Coverage Bar */}
                                            <div className="mb-6">
                                                <div className="flex justify-between text-xs mb-1.5">
                                                    <span className="text-gray-500 dark:text-gray-400">{t('cache_coverage')}</span>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                                        {systemStatus.totalItems > 0 ? Math.round((systemStatus.cacheCount / systemStatus.totalItems) * 100) : 0}%
                                                    </span>
                                                </div>
                                                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-green-500 rounded-full transition-all duration-1000"
                                                        style={{ width: `${systemStatus.totalItems > 0 ? Math.min(100, (systemStatus.cacheCount / systemStatus.totalItems) * 100) : 0}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 mt-4">
                                            <button onClick={pruneCache} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-500">
                                                {t('clean_duplicate_cache')}
                                            </button>
                                            <button onClick={clearCache} className="px-4 py-2 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/30">
                                                {t('clear_all_cache')}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Smart Repair */}
                                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                                    <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                        <Icons.Zap size={18} className="text-yellow-500" /> {t('smart_repair') || 'Smart Repair'}
                                    </h5>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                        {t('smart_repair_desc') || 'Scan for missing or broken thumbnails and verify system integrity.'}
                                    </p>

                                    {smartScanResults && smartScanResults.timestamp > 0 ? (
                                        <div className="space-y-4">
                                            <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700/50">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-medium">{t('missing_thumbs') || 'Missing Thumbnails'}</span>
                                                    <span className="font-bold text-red-500">{smartScanResults.missing.length}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm font-medium">{t('broken_thumbs') || 'Corrupted Thumbnails'}</span>
                                                    <span className="font-bold text-orange-500">{smartScanResults.error.length}</span>
                                                </div>
                                                <div className="mt-2 text-xs text-gray-400 text-right">
                                                    {t('last_scan') || 'Last Scan'}: {new Date(smartScanResults.timestamp).toLocaleTimeString()}
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleSmartRepair}
                                                    disabled={thumbStatus === 'scanning' || (smartScanResults.missing.length === 0 && smartScanResults.error.length === 0)}
                                                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${thumbStatus === 'scanning' || (smartScanResults.missing.length === 0 && smartScanResults.error.length === 0) ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm shadow-yellow-500/20'}`}
                                                >
                                                    {thumbStatus === 'scanning' ? (t('processing') || 'Processing...') : (t('repair_now') || 'Repair Issues')}
                                                </button>
                                                <button
                                                    onClick={handleSmartScan}
                                                    disabled={thumbStatus === 'scanning'}
                                                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors"
                                                >
                                                    {t('rescan') || 'Rescan'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleSmartScan}
                                            disabled={thumbStatus === 'scanning'}
                                            className={`w-full py-2.5 rounded-xl font-medium text-sm transition-colors ${thumbStatus === 'scanning' ? 'bg-gray-200 dark:bg-gray-700 text-gray-400' : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30'}`}
                                        >
                                            {thumbStatus === 'scanning' ? (t('processing') || 'Processing...') : (t('start_smart_scan') || 'Start Analysis')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <section className="pt-4 border-t border-gray-100 dark:border-gray-800">
                            <button onClick={handleExportConfig} className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-2">
                                <Icons.Download size={16} /> {t('backup_config')}
                            </button>
                        </section>
                    </div >
                );
            case 'account':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <div className="flex items-center justify-between mb-4 pr-12">
                                <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider">{t('users')}</h4>
                                {currentUser?.isAdmin && (
                                    <button onClick={handleAddUser} className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-1">
                                        <Icons.Plus size={16} /> {t('add_user')}
                                    </button>
                                )}
                            </div>
                            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                                {users.map((user, idx) => (
                                    <div key={user.username} className={`p-4 flex items-center justify-between ${idx !== users.length - 1 ? 'border-b border-gray-50 dark:border-gray-700/50' : ''}`}>
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${user.username === currentUser?.username ? 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                                {user.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h5 className="font-bold text-gray-900 dark:text-white">{user.username}</h5>
                                                    {user.username === currentUser?.username && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">YOU</span>}
                                                </div>
                                                <p className="text-xs text-gray-500">{user.isAdmin ? 'Administrator' : 'User'}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {currentUser?.isAdmin && (
                                                <>
                                                    <button onClick={() => handleResetPassword(user)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title={t('reset_password')}>
                                                        <Icons.Lock size={16} />
                                                    </button>
                                                    <button onClick={() => handleRenameUser(user)} className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors" title="Rename User">
                                                        <Icons.Edit size={16} />
                                                    </button>
                                                    {user.username !== currentUser.username && (
                                                        <button onClick={() => handleDeleteUser(user)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title={t('delete_user')}>
                                                            <Icons.Trash size={16} />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <div className="flex justify-end">
                            <button onClick={() => { setCurrentUser(null); setAuthStep('login'); localStorage.removeItem(AUTH_USER_KEY); }} className="px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2">
                                <Icons.LogOut size={18} />
                                <span>{t('sign_out')}</span>
                            </button>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };



    // Main App Render
    return (
        <div className={`flex h-screen w-full bg-gray-50 dark:bg-gray-900 overflow-hidden text-gray-900 dark:text-gray-100 font-sans transition-colors duration-200 ${isServerMode ? 'server-mode' : ''}`}>
            <Navigation
                appTitle={appTitle}
                viewMode={viewMode}
                setViewMode={handleSetViewMode}
                onUpload={handleUpload}
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                totalPhotos={libraryTotalCount || files.length}
                theme={theme}
                toggleTheme={toggleTheme}
                isServerMode={isServerMode}
                onOpenSettings={() => setIsSettingsOpen(true)}
            />

            <main className="flex-1 flex flex-col min-w-0 relative h-full pt-16 md:pt-0">
                {/* Toolbar */}
                {viewMode !== 'home' && (
                    <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 z-20 shrink-0 absolute md:relative top-0 left-0 right-0 md:top-auto md:left-auto md:right-auto">
                        <div className="flex items-center gap-3 md:hidden">
                            <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-300">
                                <Icons.Menu size={24} />
                            </button>
                            <span className="font-bold text-lg truncate">{appTitle}</span>
                        </div>

                        <div className="hidden md:flex items-center gap-4">
                            {viewMode === 'folders' && currentPath && (
                                <div className="flex items-center gap-2">
                                    <button onClick={handleGoBackFolder} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">
                                        <Icons.Back size={20} />
                                        <span className="font-medium text-lg">{currentPath.split('/').pop()}</span>
                                    </button>
                                    {isServerMode && (
                                        <div />
                                    )}
                                </div>
                            )}
                            {(viewMode === 'all' || viewMode === 'favorites' || (viewMode === 'folders' && !currentPath)) && (
                                <h2 className="text-xl font-bold">{t(viewMode === 'all' ? 'all_photos' : (viewMode === 'favorites' ? 'favorites' : 'folders'))}</h2>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {/* View/Sort Controls */}
                            {viewMode !== 'folders' && (
                                <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                                    <button onClick={() => setFilterOption('all')} className={`p-1.5 rounded-md ${filterOption === 'all' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('all_types')}><Icons.Grid size={16} /></button>
                                    <button onClick={() => setFilterOption('video')} className={`p-1.5 rounded-md ${filterOption === 'video' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('videos_only')}><Icons.Video size={16} /></button>
                                    <button onClick={() => setFilterOption('audio')} className={`p-1.5 rounded-md ${filterOption === 'audio' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('audio_only')}><Icons.Music size={16} /></button>
                                </div>
                            )}

                            {viewMode !== 'folders' && (
                                <div className="relative group">
                                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300">
                                        <Icons.Sort size={20} />
                                    </button>
                                    {/* Invisible bridge to prevent menu closing */}
                                    <div className="absolute left-0 right-0 top-full h-2 bg-transparent" />
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-1 hidden group-hover:block z-50">
                                        <button onClick={() => setSortOption('dateDesc')} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${sortOption === 'dateDesc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{t('newest_first')}</button>
                                        <button onClick={() => setSortOption('dateAsc')} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${sortOption === 'dateAsc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{t('oldest_first')}</button>
                                        <button onClick={() => setSortOption('random')} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${sortOption === 'random' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{t('shuffle_random')}</button>
                                    </div>
                                </div>
                            )}

                            {(viewMode === 'all' || viewMode === 'favorites' || (viewMode === 'folders' && currentPath)) && (
                                <button onClick={toggleLayoutMode} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300" title="Toggle Layout">
                                    {layoutMode === 'masonry' ? <Icons.Masonry size={20} /> : (layoutMode === 'timeline' ? <Icons.List size={20} /> : <Icons.Grid size={20} />)}
                                </button>
                            )}
                        </div>
                    </header>
                )}

                {/* Content Area */}
                {viewMode === 'home' ? (
                    <Home
                        items={files}
                        onEnterLibrary={() => handleSetViewMode('all')}
                        onJumpToFolder={handleJumpToFolder}
                        subtitle={homeSubtitle}
                        config={homeConfig}
                    />
                ) : (
                    <div className="flex-1 overflow-hidden relative">
                        {/* Empty State */}
                        {!isServerMode && files.length === 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                    <Icons.Image size={40} className="opacity-50" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-600 dark:text-gray-300 mb-2">{t('empty_library')}</h3>
                                <p className="max-w-xs text-center text-sm">{t('import_local')}</p>
                            </div>
                        )}
                        {isServerMode && libraryTotalCount === 0 && !isFetchingMore && viewMode === 'all' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                <Icons.Server size={48} className="mb-4 text-primary-500" />
                                <h3 className="text-xl font-bold text-gray-600 dark:text-gray-300 mb-2">{t('connected_to_nas')}</h3>
                                <p className="max-w-md text-center text-sm">{t('configure_nas')}</p>
                                <button onClick={() => { setIsSettingsOpen(true); setSettingsTab('library'); }} className="mt-6 px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-full font-medium transition-colors">
                                    {t('configure_library')}
                                </button>
                            </div>
                        )}

                        {/* Views */}
                        {/* Views */}
                        {viewMode === 'folders' ? (
                            /* Unified View (Folders + Files) */
                            (viewMode === 'folders' || currentPath) && (
                                <div className="flex-1 w-full h-full p-4 md:p-8 flex flex-col min-h-0">
                                    <VirtualGallery
                                        items={mixedItems.filter(Boolean)}
                                        onItemClick={(item) => {
                                            if (item.mediaType === 'folder') {
                                                setViewMode('folders');
                                                localStorage.setItem(VIEW_MODE_KEY, 'folders');
                                                handleFolderClick(item.path);
                                            } else if (item.mediaType === 'audio') {
                                                // Create playlist from all audio files in effective list
                                                // Filter mixedItems to just audio for the playlist
                                                const audioFiles = mixedItems.filter(f => f && f.mediaType === 'audio');
                                                const clickedIndex = audioFiles.findIndex(f => f.id === item.id);
                                                setAudioPlaylist(audioFiles);
                                                setCurrentAudioIndex(clickedIndex >= 0 ? clickedIndex : 0);
                                                setCurrentAudio(item);
                                                setIsPlayerMinimized(false);
                                            } else {
                                                setSelectedItem(item);
                                            }
                                        }}
                                        hasNextPage={isServerMode && hasMoreServer}
                                        isNextPageLoading={isFetchingMore}
                                        loadNextPage={() => loadMoreServerFiles()}
                                        itemCount={isServerMode ? serverTotal + visibleFolders.length : mixedItems.length}
                                        layout={viewMode === 'folders' && layoutMode === 'timeline' ? 'masonry' : layoutMode}
                                        onToggleFavorite={handleToggleFavorite}
                                        onRename={handleFolderRename}
                                        onDelete={handleFolderDelete}
                                        onRegenerate={handleRegenerateFolder}
                                    />
                                </div>
                            )
                        ) : (
                            <div className="w-full h-full flex flex-col">
                                {/* Favorite Folders Section (only in favorites view) */}
                                {viewMode === 'favorites' && isServerMode && serverFavoriteIds.folders.length > 0 && (
                                    <div className="p-4 md:p-8 pb-0">
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
                                                            setViewMode('folders');
                                                            localStorage.setItem(VIEW_MODE_KEY, 'folders');
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
                                <div className="flex-1 min-h-0 p-4 md:p-8">
                                    {viewMode === 'favorites' && processedFiles.length === 0 && serverFavoriteIds.folders.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                                            <Icons.Heart size={64} className="mb-4 opacity-20" />
                                            <p className="text-lg font-medium">{t('no_favorites')}</p>
                                            <p className="text-sm mt-2">{t('click_heart_to_favorite')}</p>
                                        </div>
                                    ) : (
                                        <VirtualGallery
                                            items={processedFiles.filter(Boolean)}
                                            onItemClick={(item) => {
                                                if (item.mediaType === 'audio') {
                                                    // Create playlist from all audio files in current view
                                                    const audioFiles = processedFiles.filter(f => f && f.mediaType === 'audio');
                                                    const clickedIndex = audioFiles.findIndex(f => f.id === item.id);
                                                    setAudioPlaylist(audioFiles);
                                                    setCurrentAudioIndex(clickedIndex >= 0 ? clickedIndex : 0);
                                                    setCurrentAudio(item);
                                                    setIsPlayerMinimized(false); // Show full player initially
                                                } else {
                                                    setSelectedItem(item);
                                                }
                                            }}
                                            hasNextPage={isServerMode && hasMoreServer}
                                            isNextPageLoading={isFetchingMore}
                                            loadNextPage={loadMoreServerFiles}
                                            itemCount={isServerMode ? serverTotal : processedFiles.filter(Boolean).length}
                                            layout={layoutMode}
                                            onRegenerate={handleRegenerateFolder}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )
                }
            </main >

            {/* Settings Modal */}
            <AnimatePresence>
                {
                    isSettingsOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-12"
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="bg-white dark:bg-gray-900 w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row"
                                onClick={e => e.stopPropagation()}
                            >
                                {/* Settings Sidebar */}
                                <div className="w-full md:w-64 bg-gray-50 dark:bg-gray-950/50 border-r border-gray-100 dark:border-gray-800 p-6 flex flex-col gap-1 shrink-0">
                                    <h3 className="text-xl font-bold mb-6 px-2 flex items-center gap-2 text-gray-800 dark:text-white">
                                        <Icons.Settings size={24} className="text-primary-600" /> {t('settings')}
                                    </h3>

                                    <div className="space-y-1">
                                        <button
                                            onClick={() => setSettingsTab('general')}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${settingsTab === 'general' ? 'bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                                        >
                                            <Icons.Settings size={18} /> {t('general')}
                                        </button>
                                        <button
                                            onClick={() => setSettingsTab('library')}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${settingsTab === 'library' ? 'bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                                        >
                                            <Icons.Database size={18} /> {t('storage_database')}
                                        </button>
                                        <button
                                            onClick={() => setSettingsTab('system')}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${settingsTab === 'system' ? 'bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                                        >
                                            <Icons.Cpu size={18} /> {t('system')}
                                        </button>
                                        <button
                                            onClick={() => setSettingsTab('account')}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${settingsTab === 'account' ? 'bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                                        >
                                            <Icons.User size={18} /> {t('users')}
                                        </button>
                                    </div>
                                </div>

                                {/* Settings Content */}
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 bg-white dark:bg-gray-900 relative">
                                    {/* Close Button Mobile - Absolute position inside content area */}
                                    <button onClick={() => setIsSettingsOpen(false)} className="absolute top-4 right-4 p-2 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors z-50">
                                        <Icons.Close size={20} />
                                    </button>

                                    <div className="max-w-3xl mx-auto pt-6">
                                        {renderSettingsContent()}
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >

            {/* User Management Modal */}
            <AnimatePresence>
                {
                    isUserModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-xl p-6"
                            >
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Icons.User size={24} className="text-primary-600" />
                                    {userFormType === 'add' ? t('add_user') : (userFormType === 'rename' ? 'Rename User' : t('reset_password'))}
                                </h3>
                                <form onSubmit={submitUserForm} className="space-y-4">
                                    {(userFormType === 'add' || userFormType === 'rename') && (
                                        <div>
                                            <label className="block text-sm font-medium mb-1">{t('username')}</label>
                                            <input
                                                type="text"
                                                required
                                                className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 outline-none focus:ring-2 focus:ring-primary-500"
                                                value={newUserForm.username}
                                                onChange={e => setNewUserForm({ ...newUserForm, username: e.target.value })}
                                            />
                                        </div>
                                    )}
                                    {userFormType !== 'rename' && (
                                        <div>
                                            <label className="block text-sm font-medium mb-1">{t('password')}</label>
                                            <input
                                                type="password"
                                                required
                                                className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 outline-none focus:ring-2 focus:ring-primary-500"
                                                value={newUserForm.password}
                                                onChange={e => setNewUserForm({ ...newUserForm, password: e.target.value })}
                                            />
                                        </div>
                                    )}
                                    {userFormType === 'add' && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                id="isAdmin"
                                                checked={newUserForm.isAdmin}
                                                onChange={e => setNewUserForm({ ...newUserForm, isAdmin: e.target.checked })}
                                                className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500"
                                            />
                                            <label htmlFor="isAdmin" className="text-sm font-medium">{t('is_admin')}</label>
                                        </div>
                                    )}
                                    <div className="flex justify-end gap-3 pt-4">
                                        <button type="button" onClick={() => setIsUserModalOpen(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">{t('cancel')}</button>
                                        <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-bold transition-colors">{t('save')}</button>
                                    </div>
                                </form>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >

            <ImageViewer
                item={selectedItem}
                onClose={() => setSelectedItem(null)}
                onNext={() => {
                    if (!selectedItem) return;
                    const idx = processedFiles.findIndex(f => f.id === selectedItem.id);
                    if (idx !== -1 && idx < processedFiles.length - 1) setSelectedItem(processedFiles[idx + 1]);
                }}
                onPrev={() => {
                    if (!selectedItem) return;
                    const idx = processedFiles.findIndex(f => f.id === selectedItem.id);
                    if (idx > 0) setSelectedItem(processedFiles[idx - 1]);
                }}
                onDelete={handleDelete}
                onRename={handleRename}
                onJumpToFolder={handleJumpToFolder}
                onToggleFavorite={handleToggleFavorite}
            />

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
                onThumbPause={() => controlThumb('pause')}
                onThumbResume={() => controlThumb('resume')}
                onThumbStop={() => controlThumb('stop')}
                onThumbCancelTask={handleCancelTask}
            />

            {showDirPicker && (
                <DirectoryPicker
                    isOpen={showDirPicker}
                    onClose={() => setShowDirPicker(false)}
                    onSelect={(path) => setNewPathInput(path)}
                    initialPath={newPathInput}
                />
            )}
        </div >
    );
}