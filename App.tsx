import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig, FolderNode, SystemStatus, HomeScreenConfig, ExtendedSystemStatus, SettingsTab, ScanStatus } from './types';
import { buildFolderTree, generateId, isVideo, isAudio, sortMedia, getImmediateSubfolders } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { ImageViewer } from './components/ImageViewer';
import { UnifiedProgressModal } from './components/UnifiedProgressModal';
import { VirtualGallery } from './components/VirtualGallery';
import { DirectoryPicker } from './components/DirectoryPicker';
import { Home } from './components/Home';
import { useLanguage } from './contexts/LanguageContext';
import { AudioPlayer } from './components/AudioPlayer';
import { UserModal } from './components/UserModal';
import { SettingsModal } from './components/SettingsModal';

const CONFIG_FILE_NAME = 'lumina-config.json';
const USERS_STORAGE_KEY = 'lumina_users';
const VIEW_MODE_KEY = 'lumina_view_mode';
const LAYOUT_MODE_KEY = 'lumina_layout_mode';
const APP_TITLE_KEY = 'lumina_app_title';
const APP_SUBTITLE_KEY = 'lumina_app_subtitle';
const SOURCES_STORAGE_KEY = 'lumina_sources';
const THEME_STORAGE_KEY = 'lumina_theme';
const AUTH_USER_KEY = 'lumina_auth_user';



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
    const [newUserForm, setNewUserForm] = useState({ username: '', password: '', isAdmin: false, allowedPaths: '' });

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
        console.log("Starting Smart Scan v2...");
        try {
            const res = await authFetch('/api/thumb/smart-scan', { method: 'POST' });
            if (!res.ok) {
                console.error("Smart scan request failed:", res.status, res.statusText);
                return;
            }
            setThumbStatus('scanning');
            thumbStatusRef.current = 'scanning';
            setIsUnifiedModalOpen(true); // Open modal for progress
            startUnifiedPolling();
        } catch (e) { console.error("Smart scan failed:", e); }
    };

    const handleFetchSmartResults = async () => {
        try {
            const res = await authFetch('/api/thumb/smart-results');
            if (res.ok) setSmartScanResults(await res.json());
        } catch (e) { }
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
            setIsUnifiedModalOpen(true); // Open modal for progress
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
    const [dirPickerContext, setDirPickerContext] = useState<'library' | 'userAllowedPaths'>('library');

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

    // --- REFS for Polling (Fixes Stale Closure) ---
    // These refs ensure the polling loop always accesses the latest state without closure issues
    const viewModeRef = useRef<ViewMode>('home');
    const currentPathRef = useRef<string>('');
    const currentUserRef = useRef<User | null>(null);

    // Sync refs with state
    useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
    useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

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
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');

    // Reset settings tab and fetch stats when closing
    useEffect(() => {
        if (!isSettingsOpen) {
            setSettingsTab('general');
        }
    }, [isSettingsOpen]);



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

    const handleLogout = () => {
        localStorage.removeItem('lumina_token');
        localStorage.removeItem(AUTH_USER_KEY);
        setCurrentUser(null);
        setAuthStep('login');
        // Optionally clear other user-specific state
        setAllUserData({});
        setServerFavoriteIds({ files: [], folders: [] });
    };

    // --- Secure Fetch Helper (Consolidated) ---
    const apiFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('lumina_token');
        const headers: any = { ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, { ...options, headers });

        // Handle 401 specifically for auth invalidation
        if (res.status === 401) {
            localStorage.removeItem('lumina_token'); // Clear bad token immediately
            // If we were on /api/config, it might just be the public check during init
            // But if we are already in 'app' mode, it means our session expired
            if (authStep === 'app') {
                handleLogout();
            }
        }
        return res;
    };

    // authFetch is now just an alias for consistency during migration
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
                localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(u));
                localStorage.setItem(APP_TITLE_KEY, t);
                localStorage.setItem(APP_SUBTITLE_KEY, s);
                localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(userSources));
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
        let loadedUsers: User[] = [];
        let loadedData: Record<string, UserData> = {};
        let loadedTitle = 'Lumina Gallery';
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
                        loadedUsers = [{ username: config.username, isAdmin: config.role === 'admin' } as User];
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

                if (serverMode) {
                    // Restore background task state
                    setTimeout(async () => {
                        try {
                            const [scanRes, thumbRes] = await Promise.all([
                                apiFetch('/api/scan/status'),
                                apiFetch('/api/thumb-gen/status')
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

    // 1. Initial Load & Mode Detection
    useEffect(() => {
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
                // Auto-refresh smart scan results if we just finished a thumb task
                if (settingsTab === 'system') {
                    handleFetchSmartResults();
                }

                const user = currentUserRef.current;
                if (user) {
                    const mode = viewModeRef.current;
                    const path = currentPathRef.current;

                    // Only refresh if we are in a relevant view
                    fetchServerFiles(user.username, allUserData, 0, true, path, mode === 'favorites');
                    if (mode === 'folders' || mode === 'favorites') {
                        fetchServerFolders(path, mode === 'favorites');
                    }
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
            setSmartScanResults(null); // Clear local scan results as they are now invalid
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
        setNewUserForm({ username: '', password: '', isAdmin: false, allowedPaths: '' });
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
        setNewUserForm({
            username: user.username,
            password: '',
            isAdmin: user.isAdmin || false,
            allowedPaths: '' // Reset flow usually doesn't show paths, but type requires it. Could show if we want.
        });
        setUserFormType('reset');
        setIsUserModalOpen(true);
    };

    const handleRenameUser = (user: User) => {
        console.log('[DEBUG] Editing user:', user.username, 'AllowedPaths:', user.allowedPaths, 'IsAdmin:', user.isAdmin);
        setTargetUser(user);
        setNewUserForm({
            username: user.username,
            password: '',
            isAdmin: user.isAdmin || false,
            allowedPaths: (user.allowedPaths || []).join('\n')
        });
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
                const res = await apiFetch(`/api/users/${targetUser.username}`, {
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
                const res = await apiFetch(`/api/users/${targetUser.username}`, {
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
            alert('An error occurred');
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

            // Update selected item if open
            if (selectedItem && selectedItem.id === targetId) {
                setSelectedItem(prev => prev ? { ...prev, isFavorite: newStatus } : null);
            }

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
                alert("Failed to sync favorite status: " + e.message);
                // Revert optimistic UI update on error
                if (type === 'file') {
                    const updatedFiles = files.map(f => f.id === targetId ? { ...f, isFavorite: currentStatus } : f);
                    setAllUserData({
                        ...allUserData,
                        [currentUser.username]: { ...allUserData[currentUser.username], files: updatedFiles }
                    });
                    if (selectedItem && selectedItem.id === targetId) {
                        setSelectedItem(prev => prev ? { ...prev, isFavorite: currentStatus } : null);
                    }
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
        persistData(undefined, newTitle, undefined, undefined, undefined, undefined, undefined, true);
    };

    const handleUpdateSubtitle = (newSubtitle: string) => {
        persistData(undefined, undefined, undefined, undefined, newSubtitle, undefined, undefined, true);
    };

    const handleUpdateHomeConfig = (newConfig: HomeScreenConfig) => {
        persistData(undefined, undefined, undefined, undefined, undefined, newConfig, undefined, true);
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

                    <form onSubmit={async (e) => {
                        e.preventDefault();
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
                                            title: appTitle || 'Lumina Gallery'
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
                                        localStorage.setItem('lumina_token', data.token);
                                        setCurrentUser(data.user);
                                        localStorage.setItem(AUTH_USER_KEY, data.user.username);
                                        setAuthStep('app');
                                        // Trigger init
                                        initApp();
                                    } else {
                                        setAuthStep('login');
                                    }
                                } catch (err: any) {
                                    setAuthError("Setup failed: " + err.message);
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
                                localStorage.setItem(AUTH_USER_KEY, newUser.username);
                            }
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

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
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
                onShowDirPicker={setShowDirPicker}
                onPruneCache={pruneCache}
                onClearCache={clearCache}
                smartScanResults={smartScanResults}
                thumbStatus={thumbStatus}
                theme={theme}
                onToggleTheme={toggleTheme}
            />

            <UserModal
                isOpen={isUserModalOpen}
                onClose={() => setIsUserModalOpen(false)}
                type={userFormType}
                targetUser={targetUser}
                isAdmin={currentUser?.isAdmin || false}
                onBrowsePaths={() => { setDirPickerContext('userAllowedPaths'); setShowDirPicker(true); }}
                onSubmit={async (formData) => {
                    // Adapt the internal form submit to the App-level newUserForm state if needed,
                    // or just call submitUserForm directly with adapted logic.
                    // The easiest is to update submitUserForm to accept the form data.
                    await handleUserFormSubmit(formData);
                }}
            />

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
                        if (dirPickerContext === 'library') {
                            setNewPathInput(path);
                        } else {
                            // Append to allowed paths, ensuring newline separation
                            // Use functional update to avoid closure staleness
                            setNewUserForm(prev => {
                                const current = prev.allowedPaths || '';
                                const newValue = current ? (current.trim() + '\n' + path) : path;
                                return { ...prev, allowedPaths: newValue };
                            });
                        }
                        setShowDirPicker(false);
                    }}
                    initialPath={dirPickerContext === 'library' ? newPathInput : ''}
                />
            )}
        </div >
    );
}