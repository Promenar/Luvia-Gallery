
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig, FolderNode, SystemStatus, HomeScreenConfig } from './types';
import { buildFolderTree, generateId, isVideo, isAudio, sortMedia } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { ImageViewer } from './components/ImageViewer';
import { ScanProgressModal, ScanStatus } from './components/ScanProgressModal';
import { VirtualGallery } from './components/VirtualGallery';
import { PathAutocomplete } from './components/PathAutocomplete';
import { Home } from './components/Home';
import { useLanguage } from './contexts/LanguageContext';

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
    watcherActive?: boolean;
}

export default function App() {
  const { t, language, setLanguage } = useLanguage();

  // --- Authentication State ---
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authStep, setAuthStep] = useState<'loading' | 'setup' | 'login' | 'app'>('loading');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [setupForm, setSetupForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [authError, setAuthError] = useState('');
  
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
  const [serverFavoriteIds, setServerFavoriteIds] = useState<{files: string[], folders: string[]}>({files:[], folders:[]});
  const [systemStatus, setSystemStatus] = useState<ExtendedSystemStatus | null>(null);

  // --- Scanning & Thumbnail Gen State ---
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanProgress, setScanProgress] = useState({ count: 0, currentPath: '', currentEngine: '' });
  const [jobType, setJobType] = useState<'scan' | 'thumb'>('scan');
  
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- App Data State ---
  const [allUserData, setAllUserData] = useState<Record<string, UserData>>({});
  const [appTitle, setAppTitle] = useState('Lumina Gallery');
  const [homeSubtitle, setHomeSubtitle] = useState('Your memories, beautifully organized. Rediscover your collection.');
  const [homeConfig, setHomeConfig] = useState<HomeScreenConfig>({ mode: 'random' });
  
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
  
  // --- Theme State ---
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  
  // --- Sort & Filter State ---
  const [sortOption, setSortOption] = useState<SortOption>('dateDesc');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserPanelOpen, setIsUserPanelOpen] = useState(false); 
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '' });

  // --- Random Sort Stability ---
  const [randomizedFiles, setRandomizedFiles] = useState<MediaItem[]>([]);

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
        if (theme === 'system') {
            effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
        }
        
        if (effectiveTheme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    };

    applyTheme();

    const handleChange = () => {
        if (theme === 'system') applyTheme();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

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

  // --- Persistence Helper ---
  const persistData = async (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>, newLibraryPaths?: string[], newHomeSubtitle?: string, newHomeConfig?: HomeScreenConfig) => {
      const u = newUsers || users;
      const t = newTitle || appTitle;
      const s = newHomeSubtitle || homeSubtitle;
      const hc = newHomeConfig || homeConfig;
      const d = newAllUserData || allUserData;
      const l = newLibraryPaths || libraryPaths;

      // Update React State
      if (newUsers) setUsers(newUsers);
      if (newTitle) setAppTitle(newTitle);
      if (newHomeSubtitle) setHomeSubtitle(newHomeSubtitle);
      if (newHomeConfig) setHomeConfig(newHomeConfig);
      if (newAllUserData) setAllUserData(newAllUserData);
      if (newLibraryPaths) setLibraryPaths(newLibraryPaths);

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
          lastModified: Date.now()
      };

      if (isServerMode) {
          try {
              await fetch('/api/config', {
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

      try {
        const res = await fetch('/api/config');
        if (res.ok) {
           const text = await res.text();
           let config = null;
           try {
             config = JSON.parse(text);
           } catch(e) {}

           serverMode = true;
           setIsServerMode(true);
           
           if (config && typeof config === 'object' && config.users && config.users.length > 0) {
              loadedUsers = config.users;
              loadedTitle = config.title || 'Lumina Gallery';
              if (config.homeSubtitle) loadedSubtitle = config.homeSubtitle;
              if (config.homeScreen) loadedHomeConfig = config.homeScreen;
              setLibraryPaths(config.libraryPaths || []);
              
              config.users.forEach((u: User) => {
                  loadedData[u.username] = { sources: [], files: [], favoriteFolderPaths: [] };
              });
           } else if (!config || config.configured === false) {
               setAuthStep('setup');
               return;
           }
        }
      } catch (e) {}

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
      setAllUserData(loadedData);

      // Check Persistent Login
      const savedUser = localStorage.getItem(AUTH_USER_KEY);
      if (savedUser) {
          const user = loadedUsers.find(u => u.username === savedUser);
          if (user) {
              setCurrentUser(user);
              setAuthStep('app');
              
              // Load saved ViewMode to decide what to fetch
              const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;

              if (serverMode) {
                  // Ensure state is ready before fetching
                  setTimeout(() => {
                      if (savedViewMode === 'favorites') {
                           // Directly fetch favorites only on init if that's the view
                           fetchServerFiles(user.username, loadedData, 0, true, null, true);
                           fetchServerFolders(true);
                           fetchServerFavorites();
                      } else if (savedViewMode === 'folders') {
                           // If folders view, we assume root unless path is persisted (future enhancement)
                           // For now, load folders
                           fetchServerFolders(false);
                           fetchServerFavorites();
                           // We don't fetch all files in folders mode initially
                      } else {
                           // Default / All Photos / Home
                           fetchServerFiles(user.username, loadedData, 0, true, null);
                           fetchServerFolders(false);
                           fetchServerFavorites();
                      }
                  }, 50);
              }
              return;
          }
      }

      setAuthStep('login');
    };
    
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
               if(viewMode === 'folders' && isServerMode && currentUser) {
                    fetchServerFiles(currentUser.username, allUserData, 0, true, path);
               }
          } else {
               if (currentPath !== '') {
                   setCurrentPath('');
                   if(isServerMode && currentUser) {
                       fetchServerFiles(currentUser.username, allUserData, 0, true, '');
                   }
               }
          }
      };

      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
  }, [viewMode, currentPath, isServerMode, currentUser, allUserData]);


  // --- Server Logic: Scan & Poll ---

  const fetchServerFolders = async (favoritesOnly = false) => {
    try {
        const res = await fetch(`/api/library/folders${favoritesOnly ? '?favorites=true' : ''}`);
        if (res.ok) {
            const text = await res.text();
            try {
                const data = JSON.parse(text);
                if (data && data.folders) {
                    setServerFolders(data.folders);
                }
            } catch(e) {}
        }
    } catch(e) {}
  };

  const fetchServerFavorites = async () => {
      try {
          const res = await fetch('/api/favorites/ids');
          if (res.ok) {
              const data = await res.json();
              setServerFavoriteIds(data);
          }
      } catch(e) {}
  };
  
  const fetchServerFiles = async (
      username: string, 
      currentData: Record<string, UserData>,
      offset: number = 0,
      reset: boolean = false,
      folderFilter: string | null = null,
      favoritesOnly: boolean = false
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

          const res = await fetch(url);
          if (!res.ok) throw new Error(`API Error: ${res.status}`);
          
          const text = await res.text();
          let data;
          try {
             data = JSON.parse(text);
          } catch(e) {
             throw new Error("Invalid JSON response");
          }

          if (!data) throw new Error("Empty response data");

          const newFiles = reset ? data.files : [...(currentData[username]?.files || []), ...data.files];
          
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
          const res = await fetch('/api/system/status');
          if (res.ok) {
              const data = await res.json();
              setSystemStatus(data);
          } else {
              setSystemStatus(null);
          }
      } catch(e) {
          setSystemStatus(null);
      }
  };

  const toggleWatcher = async () => {
      if (!isServerMode) return;
      try {
          const res = await fetch('/api/watcher/toggle');
          if (res.ok) {
              const data = await res.json();
              setSystemStatus(prev => prev ? { ...prev, watcherActive: data.active } : prev);
          }
      } catch(e) {}
  };

  const startPolling = (type: 'scan' | 'thumb' = 'scan') => {
    stopPolling();
    
    const apiEndpoint = type === 'scan' ? '/api/scan/status' : '/api/thumb-gen/status';

    const poll = async () => {
        try {
            const statusRes = await fetch(apiEndpoint);
            if (statusRes.ok) {
                const text = await statusRes.text();
                let statusData;
                try {
                    statusData = JSON.parse(text);
                } catch(e) {}
                
                if (statusData) {
                    setScanStatus(statusData.status);
                    setScanProgress({ 
                        count: statusData.count || 0, 
                        currentPath: statusData.currentPath || '',
                        currentEngine: statusData.currentEngine || ''
                    });

                    if (statusData.status === 'scanning' || statusData.status === 'paused') {
                        scanTimeoutRef.current = setTimeout(poll, 1000);
                        return;
                    }
                }
            }
            if (!statusRes.ok) {
                scanTimeoutRef.current = setTimeout(poll, 2000);
            } else {
                stopPolling();
                // Refresh system status when job ends
                fetchSystemStatus();
            }
        } catch (e) {
            console.error("Poll failed", e);
            scanTimeoutRef.current = setTimeout(poll, 2000);
        }
    };
    
    poll();
  };

  const startServerScan = async () => {
      if (!isServerMode || !currentUser) return;
      try {
          const startRes = await fetch('/api/scan/start', { method: 'POST' });
          if (!startRes.ok && startRes.status !== 409) {
              alert("Failed to start scan");
              return;
          }
          setJobType('scan');
          setIsScanModalOpen(true);
          setScanStatus('scanning');
          startPolling('scan');
      } catch (e) {}
  };

  const startThumbnailGen = async () => {
      if (!isServerMode || !currentUser) return;
      try {
          const startRes = await fetch('/api/thumb-gen/start', { method: 'POST' });
          if (!startRes.ok) {
              const data = await startRes.json();
              alert("Failed to start thumbnail generation: " + (data.error || 'Unknown error'));
              return;
          }
          setJobType('thumb');
          setIsScanModalOpen(true);
          setScanStatus('scanning');
          startPolling('thumb');
      } catch (e) { console.error(e); }
  };

  const clearCache = async () => {
      if (!isServerMode || !confirm('Are you sure you want to clear all cache? Thumbnails will need to be regenerated.')) return;
      try {
          const res = await fetch('/api/cache/clear', { method: 'POST' });
          if (res.ok) {
              alert(t('cache_cleared'));
              fetchSystemStatus();
          } else {
              alert('Failed to clear cache');
          }
      } catch(e) { alert('Network error'); }
  };

  const pruneCache = async () => {
      if (!isServerMode) return;
      try {
          const res = await fetch('/api/cache/prune', { method: 'POST' });
          if (res.ok) {
              const data = await res.json();
              alert(`${t('cache_pruned')}: ${data.count} items`);
              fetchSystemStatus();
          } else {
              alert('Failed to prune cache');
          }
      } catch(e) { alert('Network error'); }
  };

  useEffect(() => {
    let isMounted = true;
    if (isServerMode && currentUser) {
        fetchSystemStatus();
        fetchServerFavorites();
        // Check Scan Status on Mount
        fetch('/api/scan/status')
            .then(async r => {
                if (!r.ok) return;
                const d = await r.json();
                if (isMounted && d && (d.status === 'scanning' || d.status === 'paused')) {
                    setJobType('scan');
                    setIsScanModalOpen(true);
                    setScanStatus(d.status);
                    setScanProgress({ count: d.count, currentPath: d.currentPath, currentEngine: '' });
                    startPolling('scan');
                }
            });
    }
    return () => { 
        isMounted = false; 
        stopPolling();
    };
  }, [isServerMode, currentUser]);

  useEffect(() => {
    if (scanStatus === 'completed' && currentUser && jobType === 'scan') {
        fetchServerFiles(currentUser.username, allUserData, 0, true, null);
        fetchServerFolders();
    }
  }, [scanStatus, jobType]);

  const handleScanControl = async (action: 'pause' | 'resume' | 'cancel') => {
      const apiEndpoint = jobType === 'scan' ? '/api/scan/control' : '/api/thumb-gen/control';
      try {
          await fetch(apiEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action })
          });
          if (action === 'pause') setScanStatus('paused');
          if (action === 'resume') setScanStatus('scanning');
          if (action === 'cancel') setScanStatus('cancelled');
          
          if (action === 'resume') startPolling(jobType);
      } catch(e) {}
  };

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
    setCurrentPath(''); 
    
    if (isServerMode && currentUser) {
        // Clear current files to avoid "flash" of old content when switching views
        const clearedData = { 
              ...allUserData, 
              [currentUser.username]: { 
                  ...allUserData[currentUser.username], 
                  files: [] 
              } 
        };
        setAllUserData(clearedData);

        if (mode === 'all' || mode === 'home') {
             fetchServerFiles(currentUser.username, clearedData, 0, true, null);
             fetchServerFolders(false); // Get all folders
        } else if (mode === 'favorites') {
             fetchServerFiles(currentUser.username, clearedData, 0, true, null, true);
             fetchServerFolders(true); // Get favorite folders
             fetchServerFavorites();
        } else {
             fetchServerFolders(false);
        }
    }
  };

  const handleFolderClick = (path: string, pushState = true) => {
      setCurrentPath(path);
      if (pushState) {
         window.history.pushState({ path }, '', '#folder=' + encodeURIComponent(path));
      }
      if (isServerMode && currentUser) {
          // Clear current files to avoid "flash" of old directory content
          const clearedData = { 
              ...allUserData, 
              [currentUser.username]: { 
                  ...allUserData[currentUser.username], 
                  files: [] 
              } 
          };
          setAllUserData(clearedData);
          
          fetchServerFiles(currentUser.username, clearedData, 0, true, path);
      }
  };

  const handleGoBackFolder = () => {
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

  const handleToggleFavorite = async (item: MediaItem | string, type: 'file' | 'folder') => {
      if (!currentUser) return;
      const targetId = typeof item === 'string' ? item : (isServerMode ? item.path : item.id);

      if (isServerMode) {
          try {
              const res = await fetch('/api/favorites/toggle', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
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
                          setServerFavoriteIds(prev => ({...prev, files: [...prev.files, targetId]}));
                      } else {
                          setServerFavoriteIds(prev => ({...prev, files: prev.files.filter(id => id !== targetId)}));
                      }
                      
                      // Critical: Update selectedItem if it is currently open in ImageViewer
                      if (selectedItem && (selectedItem.path === targetId)) {
                           setSelectedItem(prev => prev ? { ...prev, isFavorite: data.isFavorite } : null);
                      }
                  } else {
                      // Update favorite folders list
                      if (data.isFavorite) {
                          setServerFavoriteIds(prev => ({...prev, folders: [...prev.folders, targetId]}));
                      } else {
                          setServerFavoriteIds(prev => ({...prev, folders: prev.folders.filter(id => id !== targetId)}));
                      }
                      if (viewMode === 'favorites') fetchServerFolders(true);
                  }
              }
          } catch(e) {}
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
      if(!currentUser) return;
      if(isServerMode) {
          try {
              const res = await fetch('/api/file/rename', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ oldPath: item.path, newName: newName })
              });
              const data = await res.json();
              if(data.success) {
                  if (viewMode === 'all') fetchServerFiles(currentUser.username, allUserData, 0, true, null);
                  else if (viewMode === 'folders') fetchServerFiles(currentUser.username, allUserData, 0, true, currentPath);
              } else {
                  alert("Rename failed: " + data.error);
              }
          } catch(e) { alert("Network error"); }
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
      if(!currentUser) return;
      if(isServerMode) {
           try {
              const res = await fetch('/api/file/delete', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ filePath: item.path })
              });
              const data = await res.json();
              if(data.success) {
                  setSelectedItem(null);
                  if (viewMode === 'all') fetchServerFiles(currentUser.username, allUserData, 0, true, null);
                  else if (viewMode === 'folders') fetchServerFiles(currentUser.username, allUserData, 0, true, currentPath);
              } else {
                  alert("Delete failed: " + data.error);
              }
           } catch(e) { alert("Network error"); }
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
             const res = await fetch('/api/folder/rename', {
                 method: 'POST',
                 headers: {'Content-Type': 'application/json'},
                 body: JSON.stringify({ oldPath: pathStr, newName })
             });
             const data = await res.json();
             if (data.success) {
                 alert("Folder renamed. Please rescan library to update database.");
                 fetchServerFolders(viewMode === 'favorites');
             } else {
                 alert("Error: " + data.error);
             }
         } catch(e) { alert("Network error"); }
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
            const res = await fetch('/api/folder/delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ path: pathStr })
            });
            const data = await res.json();
            if (data.success) {
                fetchServerFolders(viewMode === 'favorites');
                // If current view was inside this folder, go up
                if (currentPath.startsWith(pathStr)) {
                    setCurrentPath('');
                }
            } else {
                alert("Error: " + data.error);
            }
        } catch(e) { alert("Network error"); }
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
    
    Array.from(e.target.files).forEach(file => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
            const relativePath = file.webkitRelativePath || file.name;
            const folderPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
            
            let mediaType: 'image'|'video'|'audio' = 'image';
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
  }, [files, viewMode, currentPath, filterOption, sortOption, isServerMode]);


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
                        const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
                        if (user) {
                            setCurrentUser(user);
                            setAuthStep('app');
                            localStorage.setItem(AUTH_USER_KEY, user.username);
                            
                            // Trigger init fetch if server mode
                            if (isServerMode) {
                                setTimeout(() => {
                                   fetchServerFiles(user.username, allUserData, 0, true, null);
                                   fetchServerFolders();
                                }, 100);
                            }
                        } else {
                            setAuthError(t('invalid_credentials'));
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
                            onChange={e => authStep === 'setup' ? setSetupForm({...setupForm, username: e.target.value}) : setLoginForm({...loginForm, username: e.target.value})}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Password</label>
                        <input 
                            required
                            type="password" 
                            className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                            value={authStep === 'setup' ? setupForm.password : loginForm.password}
                            onChange={e => authStep === 'setup' ? setSetupForm({...setupForm, password: e.target.value}) : setLoginForm({...loginForm, password: e.target.value})}
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
                                onChange={e => setSetupForm({...setupForm, confirmPassword: e.target.value})}
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

      <main className="flex-1 flex flex-col min-w-0 relative h-full">
         {/* Toolbar */}
         {viewMode !== 'home' && (
             <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 z-20 shrink-0">
                <div className="flex items-center gap-3 md:hidden">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-300">
                        <Icons.Menu size={24} />
                    </button>
                    <span className="font-bold text-lg truncate">{appTitle}</span>
                </div>

                <div className="hidden md:flex items-center gap-4">
                    {viewMode === 'folders' && currentPath && (
                         <button onClick={handleGoBackFolder} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">
                             <Icons.Back size={20} />
                             <span className="font-medium text-lg">{currentPath.split('/').pop()}</span>
                         </button>
                    )}
                    {(viewMode === 'all' || viewMode === 'favorites' || (viewMode === 'folders' && !currentPath)) && (
                         <h2 className="text-xl font-bold">{t(viewMode === 'all' ? 'all_photos' : (viewMode === 'favorites' ? 'favorites' : 'folders'))}</h2>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* View/Sort Controls */}
                    {viewMode !== 'folders' && (
                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                            <button onClick={() => setFilterOption('all')} className={`p-1.5 rounded-md ${filterOption === 'all' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('all_types')}><Icons.Grid size={16}/></button>
                            <button onClick={() => setFilterOption('video')} className={`p-1.5 rounded-md ${filterOption === 'video' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('videos_only')}><Icons.Video size={16}/></button>
                            <button onClick={() => setFilterOption('audio')} className={`p-1.5 rounded-md ${filterOption === 'audio' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`} title={t('audio_only')}><Icons.Music size={16}/></button>
                        </div>
                    )}
                    
                    {viewMode !== 'folders' && (
                         <div className="relative group">
                             <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300">
                                 <Icons.Sort size={20} />
                             </button>
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
                          <button onClick={() => setIsSettingsOpen(true)} className="mt-6 px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-full font-medium transition-colors">
                              {t('configure_library')}
                          </button>
                     </div>
                 )}

                 {/* Views */}
                 {viewMode === 'folders' && !currentPath ? (
                     <div className="w-full h-full overflow-y-auto p-4 md:p-8">
                         {isServerMode ? (
                             serverFolders.length === 0 ? (
                                 <div className="flex items-center justify-center h-64 text-gray-500">No folders found</div>
                             ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                                    {serverFolders.map(folder => (
                                        <FolderCard 
                                            key={folder.path}
                                            folder={{
                                                name: folder.path.split('/').pop() || 'Root',
                                                path: folder.path,
                                                mediaCount: folder.count,
                                                children: {},
                                                coverMedia: folder.coverItem
                                            }}
                                            onClick={handleFolderClick}
                                            isFavorite={serverFavoriteIds.folders.includes(folder.path)}
                                            onToggleFavorite={(path) => handleToggleFavorite(path, 'folder')}
                                            onRename={handleFolderRename}
                                            onDelete={handleFolderDelete}
                                        />
                                    ))}
                                </div>
                             )
                         ) : (
                            // Client Side Folder Grid
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                                {Object.values(buildFolderTree(files).children).map(node => (
                                     <FolderCard 
                                         key={node.path}
                                         folder={node}
                                         onClick={handleFolderClick}
                                         isFavorite={(allUserData[currentUser?.username || '']?.favoriteFolderPaths || []).includes(node.path)}
                                         onToggleFavorite={(path) => handleToggleFavorite(path, 'folder')}
                                         onRename={handleFolderRename}
                                         onDelete={handleFolderDelete}
                                     />
                                ))}
                            </div>
                         )}
                     </div>
                 ) : (
                     <div className="w-full h-full">
                         <VirtualGallery 
                             items={processedFiles} 
                             onItemClick={setSelectedItem}
                             hasNextPage={isServerMode && hasMoreServer}
                             isNextPageLoading={isFetchingMore}
                             loadNextPage={loadMoreServerFiles}
                             itemCount={isServerMode ? serverTotal : processedFiles.length}
                             layout={layoutMode}
                         />
                     </div>
                 )}
             </div>
         )}
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
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
                        <h3 className="text-xl font-bold mb-6 px-2 flex items-center gap-2"><Icons.Settings size={24} className="text-primary-600"/> {t('settings')}</h3>
                        <div className="space-y-1">
                             <button className="w-full text-left px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600 dark:text-primary-400">{t('general')}</button>
                             {/* Future tabs could go here */}
                        </div>
                        <div className="mt-auto">
                            <button onClick={() => { setCurrentUser(null); setAuthStep('login'); localStorage.removeItem(AUTH_USER_KEY); }} className="w-full text-left px-4 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 text-red-600 flex items-center gap-3 transition-colors">
                                <Icons.LogOut size={20} />
                                <span className="font-medium">{t('sign_out')}</span>
                            </button>
                        </div>
                    </div>

                    {/* Settings Content */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-10">
                         <div className="max-w-3xl mx-auto space-y-10">
                            
                             {/* Server/Client Mode Toggle */}
                             <section>
                                 <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('connection')}</h4>
                                 <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl inline-flex mb-4">
                                     <button className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${!isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => { if(isServerMode) window.location.reload(); }}>
                                         {t('client_mode')}
                                     </button>
                                     <button className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => window.location.reload()}>
                                         {t('server_mode')}
                                     </button>
                                 </div>
                                 <p className="text-sm text-gray-500">
                                     {isServerMode ? t('server_mode_description') : t('client_mode_description')}
                                 </p>
                             </section>

                             {/* Library Paths (Server Only) */}
                             {isServerMode && (
                                 <section>
                                     <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('storage_database')}</h4>
                                     <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden">
                                         <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                                             <h5 className="font-bold text-lg mb-2">{t('library_scan_paths')}</h5>
                                             <p className="text-sm text-gray-500 mb-4">{t('media_served')}</p>
                                             <form onSubmit={handleAddLibraryPath} className="flex gap-2">
                                                 <PathAutocomplete 
                                                     value={newPathInput} 
                                                     onChange={setNewPathInput} 
                                                     onAdd={() => {}} // Handled by form submit
                                                 />
                                                 <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2">
                                                     <Icons.Plus size={18} /> {t('add_path')}
                                                 </button>
                                             </form>
                                         </div>
                                         <div className="bg-gray-50 dark:bg-gray-900/50 p-2 space-y-1">
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
                                     </div>
                                     
                                     {/* Operations */}
                                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                         <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700">
                                             <div className="flex items-center gap-3 mb-2">
                                                 <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-lg"><Icons.Scan size={20} /></div>
                                                 <h5 className="font-bold">{t('scan_library')}</h5>
                                             </div>
                                             <p className="text-sm text-gray-500 mb-4">{t('scan_library_desc')}</p>
                                             <button onClick={startServerScan} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">Start Scan</button>
                                         </div>
                                         
                                         <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700">
                                             <div className="flex items-center gap-3 mb-2">
                                                 <div className="p-2 bg-purple-50 dark:bg-purple-900/30 text-purple-600 rounded-lg"><Icons.Image size={20} /></div>
                                                 <h5 className="font-bold">{t('generate_thumbs')}</h5>
                                             </div>
                                             <p className="text-sm text-gray-500 mb-4">{t('generate_thumbs_desc')}</p>
                                             <button onClick={startThumbnailGen} className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">Generate</button>
                                         </div>
                                     </div>
                                 </section>
                             )}

                             {/* App Config */}
                             <section>
                                 <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('appearance')}</h4>
                                 <div className="space-y-4">
                                     <div>
                                         <label className="block text-sm font-medium mb-1.5">{t('website_title')}</label>
                                         <input 
                                             value={appTitle} 
                                             onChange={e => handleUpdateTitle(e.target.value)} 
                                             className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500"
                                         />
                                     </div>
                                     <div>
                                         <label className="block text-sm font-medium mb-1.5">{t('home_subtitle')}</label>
                                         <input 
                                             value={homeSubtitle} 
                                             onChange={e => handleUpdateSubtitle(e.target.value)} 
                                             className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500"
                                         />
                                     </div>
                                     <div>
                                         <label className="block text-sm font-medium mb-1.5">{t('language')}</label>
                                         <select 
                                             value={language}
                                             onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
                                             className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500"
                                         >
                                             <option value="en">English</option>
                                             <option value="zh">中文 (Chinese)</option>
                                         </select>
                                     </div>
                                     <div>
                                         <label className="block text-sm font-medium mb-2">{t('home_screen_conf')}</label>
                                         <div className="flex gap-4 mb-2">
                                             {['random', 'folder', 'single'].map(m => (
                                                 <button 
                                                     key={m}
                                                     onClick={() => handleUpdateHomeConfig({...homeConfig, mode: m as any})}
                                                     className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border ${homeConfig.mode === m ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                                                 >
                                                     {t(m === 'random' ? 'random_all' : (m === 'folder' ? 'specific_folder' : 'single_item'))}
                                                 </button>
                                             ))}
                                         </div>
                                         {homeConfig.mode !== 'random' && (
                                             <input 
                                                 placeholder={t('enter_rel_path')}
                                                 value={homeConfig.path || ''}
                                                 onChange={e => handleUpdateHomeConfig({...homeConfig, path: e.target.value})}
                                                 className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                                             />
                                         )}
                                     </div>
                                 </div>
                             </section>

                             {/* System Dashboard (Server Only) */}
                             {isServerMode && systemStatus && (
                                 <section>
                                     <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('system_monitoring')}</h4>
                                     <div className="bg-gray-900 text-gray-300 rounded-2xl p-6 font-mono text-xs space-y-4">
                                         <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                                             <span className="text-gray-500">PLATFORM</span>
                                             <span className="text-white">{systemStatus.platform}</span>
                                         </div>
                                         <div className="grid grid-cols-2 gap-4">
                                             <div>
                                                 <p className="text-gray-500 mb-1">FFMPEG</p>
                                                 <div className="flex items-center gap-2">
                                                     <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg ? 'bg-green-500' : 'bg-red-500'}`} />
                                                     <span>{systemStatus.ffmpeg ? 'ACTIVE' : 'MISSING'}</span>
                                                 </div>
                                                 {systemStatus.ffmpegHwAccels?.length > 0 && (
                                                     <p className="mt-1 text-purple-400">{systemStatus.ffmpegHwAccels.join(', ')}</p>
                                                 )}
                                             </div>
                                             <div>
                                                 <p className="text-gray-500 mb-1">SHARP</p>
                                                 <div className="flex items-center gap-2">
                                                     <div className={`w-2 h-2 rounded-full ${systemStatus.sharp ? 'bg-green-500' : 'bg-red-500'}`} />
                                                     <span>{systemStatus.sharp ? 'ACTIVE' : 'MISSING'}</span>
                                                 </div>
                                             </div>
                                         </div>
                                         <div className="border-t border-gray-800 pt-4 flex justify-between items-center">
                                             <span className="text-gray-500">{t('realtime_monitoring')}</span>
                                             <div className="flex items-center gap-4">
                                                 <span className={systemStatus.watcherActive ? 'text-green-400' : 'text-gray-500'}>{systemStatus.watcherActive ? t('enabled') : t('disabled')}</span>
                                                 <button onClick={toggleWatcher} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] uppercase tracking-wide transition-colors">{t('toggle')}</button>
                                             </div>
                                         </div>
                                         <div className="border-t border-gray-800 pt-4 flex justify-between items-center">
                                             <div>
                                                 <span className="text-gray-500 block mb-1">CACHE</span>
                                                 <span className="text-white text-lg">{systemStatus.cacheCount} files</span>
                                             </div>
                                             <div className="flex gap-2">
                                                 <button onClick={pruneCache} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs transition-colors">Prune</button>
                                                 <button onClick={clearCache} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs transition-colors">Clear All</button>
                                             </div>
                                         </div>
                                     </div>
                                 </section>
                             )}

                             <section className="pt-4 border-t border-gray-100 dark:border-gray-800">
                                 <button onClick={handleExportConfig} className="text-sm font-medium text-primary-600 hover:underline">{t('backup_config')}</button>
                             </section>
                         </div>
                    </div>
                    <button onClick={() => setIsSettingsOpen(false)} className="absolute top-4 right-4 p-2 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors z-50">
                        <Icons.Close size={20} />
                    </button>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      <ImageViewer 
          item={selectedItem} 
          onClose={() => setSelectedItem(null)} 
          onNext={() => {
              if(!selectedItem) return;
              const idx = processedFiles.findIndex(f => f.id === selectedItem.id);
              if (idx !== -1 && idx < processedFiles.length - 1) setSelectedItem(processedFiles[idx + 1]);
          }}
          onPrev={() => {
              if(!selectedItem) return;
              const idx = processedFiles.findIndex(f => f.id === selectedItem.id);
              if (idx > 0) setSelectedItem(processedFiles[idx - 1]);
          }}
          onDelete={handleDelete}
          onRename={handleRename}
          onJumpToFolder={handleJumpToFolder}
          onToggleFavorite={handleToggleFavorite}
      />
      
      <ScanProgressModal 
         isOpen={isScanModalOpen}
         status={scanStatus}
         count={scanProgress.count}
         currentPath={scanProgress.currentPath}
         onPause={() => handleScanControl('pause')}
         onResume={() => handleScanControl('resume')}
         onCancel={() => handleScanControl('cancel')}
         onClose={() => setIsScanModalOpen(false)}
         type={jobType}
         title={jobType === 'scan' ? t('scanning_library') : t('generating_thumbnails')}
      />

    </div>
  );
}
