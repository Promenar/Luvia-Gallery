
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
              if (serverMode) {
                  setTimeout(() => {
                      fetchServerFiles(user.username, loadedData, 0, true, null);
                      fetchServerFolders();
                      fetchServerFavorites();
                  }, 100);
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
        if (mode === 'all' || mode === 'home') {
             fetchServerFiles(currentUser.username, allUserData, 0, true, null);
             fetchServerFolders(false); // Get all folders
        } else if (mode === 'favorites') {
             fetchServerFiles(currentUser.username, allUserData, 0, true, null, true);
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

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", CONFIG_FILE_NAME);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const json = JSON.parse(e.target?.result as string) as AppConfig;
              if (json.users && json.title) {
                  const hydratedData: Record<string, UserData> = {};
                  json.users.forEach(u => {
                       const existingFiles = allUserData[u.username]?.files || [];
                       hydratedData[u.username] = { sources: json.userSources?.[u.username] || [], files: existingFiles };
                  });
                  
                  persistData(json.users, json.title, hydratedData, json.libraryPaths, json.homeSubtitle, json.homeScreen);
                  alert("Configuration restored.");
                  if (authStep === 'loading' || authStep === 'setup') setAuthStep('login');
              }
          } catch (err) {
              alert("Failed to parse configuration file.");
          }
      };
      reader.readAsText(file);
  };

  const handleSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (setupForm.password !== setupForm.confirmPassword) {
      setAuthError(t('passwords_not_match'));
      return;
    }
    const adminUser: User = { username: setupForm.username, password: setupForm.password, isAdmin: true };
    const newUsers = [adminUser];
    const newUserData = { [adminUser.username]: { files: [], sources: [] } };
    persistData(newUsers, undefined, newUserData, [], undefined);
    setCurrentUser(adminUser);
    localStorage.setItem(AUTH_USER_KEY, adminUser.username); // Auto-login next time
    setAuthStep('app');
    if (isServerMode) {
        fetchServerFiles(adminUser.username, newUserData, 0, true);
        fetchServerFolders();
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
    if (user) {
      setCurrentUser(user);
      localStorage.setItem(AUTH_USER_KEY, user.username); // Persist login
      
      let newData = allUserData;
      if (!allUserData[user.username]) {
          newData = { ...allUserData, [user.username]: { files: [], sources: [] } };
          setAllUserData(newData);
      }
      setAuthStep('app');
      setAuthError('');
      if (isServerMode) {
          fetchServerFiles(user.username, newData, 0, true, null); // Load sidebar count
          fetchServerFolders();
          fetchServerFavorites();
      }
    } else {
      setAuthError(t('invalid_credentials'));
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem(AUTH_USER_KEY); // Clear persistence
    setAuthStep('login');
    setLoginForm({ username: '', password: '' });
    setCurrentPath('');
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.username || !newUserForm.password) return;
    if (users.find(u => u.username === newUserForm.username)) { alert("User already exists"); return; }
    const newUser: User = { username: newUserForm.username, password: newUserForm.password, isAdmin: false };
    const updatedUsers = [...users, newUser];
    const updatedUserData = { ...allUserData, [newUser.username]: { files: [], sources: [] } };
    persistData(updatedUsers, undefined, updatedUserData, undefined, undefined);
    setNewUserForm({ username: '', password: '' });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isServerMode) {
        alert(t('configure_nas'));
        return;
    }
    if (!currentUser) return;
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const sourceId = generateId();
    const firstPath = fileList[0].webkitRelativePath;
    const sourceName = firstPath ? firstPath.split('/')[0] : 'Uploaded Folder';

    const newItems: MediaItem[] = [];
    Array.from(fileList).forEach((file: File) => {
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const path = file.webkitRelativePath || file.name;
        const pathParts = path.split('/');
        const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
        
        let mediaType: 'image' | 'video' | 'audio' = 'image';
        if (isVideo(file.type)) mediaType = 'video';
        if (isAudio(file.type)) mediaType = 'audio';

        newItems.push({
          id: generateId(),
          file,
          url: URL.createObjectURL(file),
          name: file.name,
          path,
          folderPath,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          mediaType: mediaType,
          sourceId
        });
      }
    });

    if (newItems.length > 0) {
      const updatedUserData = {
          ...allUserData,
          [currentUser.username]: {
              ...allUserData[currentUser.username],
              files: [...(allUserData[currentUser.username]?.files || []), ...newItems],
              sources: [...(allUserData[currentUser.username]?.sources || []), { id: sourceId, name: sourceName, count: newItems.length }]
          }
      };
      setAllUserData(updatedUserData);
      persistData(undefined, undefined, updatedUserData, undefined, undefined); 
      setIsSettingsOpen(false);
    }
  };

  const processedFiles = useMemo(() => {
    let result = files;
    if (viewMode === 'favorites' && !isServerMode) {
        result = result.filter(f => f.isFavorite);
    }

    if (filterOption !== 'all') {
      result = result.filter(f => f.mediaType === filterOption);
    }
    if (sortOption === 'random') {
        if (randomizedFiles.length !== result.length) {
            const shuffled = sortMedia(result, 'random');
            setRandomizedFiles(shuffled);
            return shuffled;
        }
        return randomizedFiles;
    }
    return sortMedia(result, sortOption);
  }, [files, filterOption, sortOption, randomizedFiles, viewMode, isServerMode]);

  const folderTree = useMemo(() => {
    if (isServerMode && serverFolders.length > 0) {
        const root: FolderNode = { name: 'Root', path: '', children: {}, mediaCount: 0 };
        serverFolders.forEach(sf => {
            const parts = sf.path.split('/').filter((p: string) => p);
            const hasLeadingSlash = sf.path.startsWith('/');
            let currentNode = root;
            parts.forEach((part: string, index: number) => {
                if (!currentNode.children[part]) {
                    let currentPath = parts.slice(0, index + 1).join('/');
                    if (hasLeadingSlash) currentPath = '/' + currentPath;

                    const match = serverFolders.find(f => f.path === currentPath);
                    currentNode.children[part] = {
                        name: part,
                        path: currentPath,
                        children: {},
                        mediaCount: match ? match.count : 0, 
                        coverMedia: match ? match.coverItem : undefined
                    };
                }
                currentNode = currentNode.children[part];
            });
        });
        return root;
    }
    // Client mode folder tree construction
    return buildFolderTree(files);
  }, [files, isServerMode, serverFolders]);

  const content = useMemo(() => {
    if (viewMode === 'all') {
      return { type: 'media', data: processedFiles, title: t('library') };
    }
    if (viewMode === 'favorites') {
        // In client mode, we need to filter folders manually
        let subfolders: FolderNode[] = [];
        if (!isServerMode) {
             subfolders = favoriteFolderPaths.map(path => {
                const cover = files.find(f => f.folderPath === path && f.mediaType === 'image');
                return {
                    name: path.split('/').pop() || path,
                    path: path,
                    children: {},
                    mediaCount: files.filter(f => f.folderPath === path).length,
                    coverMedia: cover
                } as FolderNode;
            });
        } else {
            // Server mode returns already filtered folders list in `serverFolders`
            subfolders = serverFolders.map(sf => ({
                name: sf.path.split('/').pop() || sf.path,
                path: sf.path,
                children: {},
                mediaCount: sf.count,
                coverMedia: sf.coverItem
            }));
        }
        return { type: 'mixed', folders: subfolders, photos: processedFiles, title: t('favorites') };
    }
    if (viewMode === 'home') {
        return { type: 'home' };
    }
    let targetNode = folderTree;
    let title = t('folders');
    if (currentPath) {
       const parts = currentPath.split('/').filter(p => p);
       for (const part of parts) {
           if (targetNode.children[part]) {
               targetNode = targetNode.children[part];
           }
       }
       title = parts[parts.length - 1] || t('folders');
    }
    const subfolders = (Object.values(targetNode.children) as FolderNode[]).sort((a, b) => a.name.localeCompare(b.name));
    
    const media = isServerMode ? processedFiles : processedFiles.filter(f => f.folderPath === currentPath);
    
    return { type: 'mixed', folders: subfolders, photos: media, title: title };
  }, [viewMode, currentPath, processedFiles, folderTree, t, isServerMode, serverFolders, favoriteFolderPaths, files]);

  // Helpers
  useEffect(() => {
    return () => {
      (Object.values(allUserData) as UserData[]).forEach(userData => {
          userData.files.forEach(f => {
              if (f.file && f.url && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
          });
      });
    };
  }, []);

  const getLightboxList = () => {
    if (viewMode === 'home') return files;
    return viewMode === 'all' ? processedFiles : (content.photos || []);
  };
  
  const handleNext = () => {
      if (!selectedItem) return;
      const list = getLightboxList();
      const idx = list.findIndex(p => p.id === selectedItem.id);
      if (idx !== -1 && idx < list.length - 1) setSelectedItem(list[idx + 1]);
      else if (idx === list.length - 1) setSelectedItem(list[0]);
  };
  const handlePrev = () => {
      if (!selectedItem) return;
      const list = getLightboxList();
      const idx = list.findIndex(p => p.id === selectedItem.id);
      if (idx > 0) setSelectedItem(list[idx - 1]);
      else if (idx === 0) setSelectedItem(list[list.length - 1]);
  };

  const isFavoriteFolder = (path: string) => {
      if (isServerMode) return serverFavoriteIds.folders.includes(path);
      return favoriteFolderPaths.includes(path);
  };

  // --- RENDER ---
  if (authStep === 'loading') return <div className="h-[100dvh] flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-900">Loading...</div>;

  if (authStep === 'setup') {
      return (
        <div className="h-[100dvh] flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md transition-colors">
                <div className="flex justify-end mb-2">
                    <div className="flex gap-1">
                        <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-bold text-xs w-9 h-9">
                            {language === 'en' ? 'ZH' : 'EN'}
                        </button>
                        <button onClick={toggleTheme} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            {theme === 'system' ? <Icons.Monitor size={20} /> : (theme === 'dark' ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />)}
                        </button>
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-primary-600 mb-2 text-center">{t('welcome')}</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">{isServerMode ? t('init_nas') : t('setup_admin')}</p>
                <form onSubmit={handleSetup} className="space-y-4">
                    <input type="text" placeholder="Username" value={setupForm.username} onChange={e => setSetupForm({...setupForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                    <input type="password" placeholder="Password" value={setupForm.password} onChange={e => setSetupForm({...setupForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                    <input type="password" placeholder="Confirm Password" value={setupForm.confirmPassword} onChange={e => setSetupForm({...setupForm, confirmPassword: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                    {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
                    <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700 transition-colors">{t('create_admin')}</button>
                </form>
                {!isServerMode && (<div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700"><label className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg cursor-pointer transition-colors text-sm font-medium"><Icons.Upload size={16} /><span>{t('import_db')}</span><input type="file" accept=".json" onChange={handleImportConfig} className="hidden" /></label></div>)}
            </div>
        </div>
      );
  }

  if (authStep === 'login') {
      return (
        <div className="h-[100dvh] flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-sm transition-colors">
                <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center">
                        <Icons.User className="text-white" />
                    </div>
                    <div className="flex gap-1">
                        <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-bold text-xs w-9 h-9" title={t('language')}>
                            {language === 'en' ? 'ZH' : 'EN'}
                        </button>
                        <button onClick={toggleTheme} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            {theme === 'system' ? <Icons.Monitor size={20} /> : (theme === 'dark' ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />)}
                        </button>
                    </div>
                </div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white text-center mb-2">{appTitle}</h1>
                {isServerMode && <p className="text-xs text-center text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 py-1 rounded mb-6">{t('nas_connected')}</p>}
                <form onSubmit={handleLogin} className="space-y-4">
                    <input type="text" placeholder="Username" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                    <input type="password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                    {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
                    <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700 transition-colors">{t('sign_in')}</button>
                </form>
            </div>
        </div>
      );
  }

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] bg-white dark:bg-gray-900 transition-colors">
      <Navigation 
        appTitle={appTitle}
        viewMode={viewMode}
        setViewMode={handleSetViewMode}
        onUpload={handleFileUpload}
        isSidebarOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        totalPhotos={isServerMode ? libraryTotalCount : files.length} 
        theme={theme}
        toggleTheme={toggleTheme}
        isServerMode={isServerMode}
        onOpenSettings={() => { fetchSystemStatus(); setIsSettingsOpen(true); }}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {viewMode === 'home' ? (
             <Home 
                items={files} 
                onEnterLibrary={() => handleSetViewMode('folders')} 
                onJumpToFolder={handleJumpToFolder}
                subtitle={homeSubtitle}
                config={homeConfig}
             />
        ) : (
        <>
            <header className="h-16 flex items-center justify-between px-6 border-b border-gray-50 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-20 shrink-0 transition-colors">
            <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
                {viewMode === 'folders' || (viewMode === 'favorites' && currentPath) ? (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 overflow-hidden whitespace-nowrap mask-linear-fade">
                         {currentPath && (
                            <button 
                                onClick={handleGoBackFolder} 
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors mr-1 flex items-center gap-1 text-gray-500"
                                title="Go Up"
                            >
                                <Icons.Up size={18} />
                                <span className="text-xs font-bold hidden sm:block">UP</span>
                            </button>
                         )}

                        <button onClick={() => handleFolderClick('')} className={`hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${currentPath === '' ? 'font-bold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800' : ''}`}><Icons.Folder size={16} />Root</button>
                        {currentPath && currentPath.split('/').filter(p => p).map((part, index, arr) => {
                            const hasLeading = currentPath.startsWith('/');
                            const path = (hasLeading ? '/' : '') + arr.slice(0, index + 1).join('/');
                            return (<React.Fragment key={path}><Icons.ChevronRight size={12} className="text-gray-300 dark:text-gray-600" /><button onClick={() => handleFolderClick(path)} className="hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded-md truncate max-w-[150px] transition-colors">{part}</button></React.Fragment>);
                        })}
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        {viewMode === 'favorites' ? <Icons.Heart size={20} className="text-red-500" fill="currentColor" /> : <Icons.Image size={20} className="text-primary-600" />}
                        <h1 className="text-xl font-bold text-gray-800 dark:text-white truncate">{viewMode === 'favorites' ? t('favorites') : t('library')}</h1>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={toggleLayoutMode} 
                    className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors" 
                    title={layoutMode === 'grid' ? "Switch to Waterfall Masonry" : layoutMode === 'masonry' ? "Switch to Timeline" : "Switch to Grid"}
                >
                    {layoutMode === 'grid' ? <Icons.Masonry size={20} /> : layoutMode === 'masonry' ? <Icons.List size={20} /> : <Icons.Grid size={20} />}
                </button>

                <div className="relative group z-30 h-full flex items-center">
                    <button className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full flex items-center gap-1 transition-colors group-hover:bg-gray-100 dark:group-hover:bg-gray-800"><Icons.Filter size={18} /><Icons.Sort size={14} /></button>
                    {/* Transparent Bridge to prevent mouse falling through */}
                    <div className="absolute top-[80%] right-0 h-6 w-full bg-transparent hidden group-hover:block" />
                    
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-2 hidden group-hover:block z-50 animate-in fade-in zoom-in-95 duration-200">
                        <p className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">{t('sort_filter')}</p>
                        <button onClick={() => setSortOption('dateDesc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${sortOption === 'dateDesc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('newest_first')} {sortOption === 'dateDesc' && <Icons.Check size={14} />}</button>
                        <button onClick={() => setSortOption('dateAsc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${sortOption === 'dateAsc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('oldest_first')} {sortOption === 'dateAsc' && <Icons.Check size={14} />}</button>
                        {viewMode === 'all' && (
                             <button onClick={() => setSortOption('random')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${sortOption === 'random' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('shuffle_random')} {sortOption === 'random' && <Icons.Check size={14} />}</button>
                        )}
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                        <button onClick={() => setFilterOption('all')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${filterOption === 'all' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('all_types')} {filterOption === 'all' && <Icons.Check size={14} />}</button>
                        <button onClick={() => setFilterOption('video')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${filterOption === 'video' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('videos_only')} {filterOption === 'video' && <Icons.Check size={14} />}</button>
                        <button onClick={() => setFilterOption('audio')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${filterOption === 'audio' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('audio_only')} {filterOption === 'audio' && <Icons.Check size={14} />}</button>
                    </div>
                </div>
            </div>
            </header>

            <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50 dark:bg-gray-900/50 transition-colors">
            {files.length === 0 && !isFetchingMore && viewMode === 'all' && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 overflow-y-auto">
                <div className="w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-6 text-indigo-400"><Icons.Upload size={40} /></div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">{t('welcome')}, {currentUser?.username}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">{isServerMode ? t('configure_nas') : t('import_local')}</p>
                {isServerMode ? (
                    <button onClick={() => setIsSettingsOpen(true)} className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg hover:bg-primary-700 flex items-center justify-center gap-2 transition-colors"><Icons.Settings size={20} /><span>{t('configure_library')}</span></button>
                ) : (
                    <label className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg cursor-pointer flex items-center justify-center gap-2 hover:bg-primary-700 transition-colors">
                        <Icons.Upload size={20} />
                        <span>{t('import_local_folder')}</span>
                        <input 
                            type="file" 
                            multiple 
                            {...({ webkitdirectory: "true", directory: "" } as any)} 
                            onChange={handleFileUpload} 
                            className="hidden" 
                        />
                    </label>
                )}
                </div>
            )}

            {(files.length > 0 || isFetchingMore || (viewMode === 'folders' && content.folders.length > 0) || (viewMode === 'favorites')) && (
                <>
                    {((viewMode === 'folders' && content.folders.length > 0) || (viewMode === 'favorites' && content.folders.length > 0)) && (
                        <div className="p-4 md:p-8 pb-0 shrink-0 max-h-[40vh] overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-500">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Icons.Folder size={14} />{t('folders')}
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {content.folders.map((folder) => (
                                    <FolderCard 
                                        key={folder.path} 
                                        folder={folder} 
                                        onClick={(path) => handleFolderClick(path)}
                                        isFavorite={isFavoriteFolder(folder.path)}
                                        onToggleFavorite={(p) => handleToggleFavorite(p, 'folder')}
                                        onRename={handleFolderRename}
                                        onDelete={handleFolderDelete}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {(viewMode === 'all' || (viewMode === 'folders' && currentPath !== '') || viewMode === 'favorites') && (
                        <div className="flex-1 min-h-0 p-4 md:p-8 pt-4 w-full"> 
                            {viewMode === 'favorites' && (
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Icons.Image size={14} />{t('all_photos')}</h3>
                            )}
                            <VirtualGallery 
                                    layout={layoutMode}
                                    items={viewMode === 'all' || viewMode === 'favorites' ? processedFiles : (content.photos || [])}
                                    onItemClick={setSelectedItem}
                                    hasNextPage={isServerMode ? hasMoreServer : false}
                                    isNextPageLoading={isFetchingMore}
                                    loadNextPage={loadMoreServerFiles}
                                    itemCount={isServerMode && (viewMode === 'all' || viewMode === 'favorites') ? serverTotal : processedFiles.length}
                            />
                        </div>
                    )}
                </>
            )}
            </div>
        </>
        )}
      </main>

      <ImageViewer 
        item={selectedItem} 
        onClose={() => setSelectedItem(null)} 
        onNext={handleNext} 
        onPrev={handlePrev}
        onDelete={handleDelete}
        onRename={handleRename}
        onJumpToFolder={handleJumpToFolder}
        onToggleFavorite={handleToggleFavorite}
      />
      
      {/* Scan Progress Modal */}
      <ScanProgressModal 
        isOpen={isScanModalOpen}
        status={scanStatus}
        count={scanProgress.count}
        currentPath={scanProgress.currentPath}
        onPause={() => handleScanControl('pause')}
        onResume={() => handleScanControl('resume')}
        onCancel={() => handleScanControl('cancel')}
        onClose={() => setIsScanModalOpen(false)}
        title={jobType === 'scan' ? t('scanning_library') : `${t('generating_thumbnails')} ${scanProgress.currentEngine ? `(${scanProgress.currentEngine})` : ''}`}
        type={jobType}
      />

      <AnimatePresence>
        {isSettingsOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsSettingsOpen(false)}>
                <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl transition-colors" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50"><h2 className="font-bold text-xl text-gray-800 dark:text-white">{t('settings')}</h2><button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-500 dark:text-gray-400 transition-colors"><Icons.Close size={20}/></button></div>
                    <div className="p-6 overflow-y-auto space-y-8 flex-1">
                        
                        {/* APPEARANCE SECTION (Both Modes) */}
                        <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                            <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.Monitor size={18} /> {t('appearance')}</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">{t('theme')}</label>
                                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                        {['light', 'dark', 'system'].map((m) => (
                                            <button
                                                key={m}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize ${theme === m ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
                                                onClick={() => { setTheme(m as any); localStorage.setItem(THEME_STORAGE_KEY, m); }}
                                            >
                                                {t(m === 'light' ? 'light_mode' : m === 'dark' ? 'dark_mode' : 'follow_system')}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">{t('language')}</label>
                                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                        <button onClick={() => setLanguage('en')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${language === 'en' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>English</button>
                                        <button onClick={() => setLanguage('zh')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${language === 'zh' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>中文</button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* CONNECTION SECTION */}
                        <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                            <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.Server size={18} /> {t('connection')}</h3>
                            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                <div>
                                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                                        {isServerMode ? t('server_mode') : t('client_mode')}
                                        <span className={`w-2 h-2 rounded-full ${isServerMode ? (systemStatus ? 'bg-green-500' : 'bg-yellow-500') : 'bg-orange-500'}`} />
                                    </h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {isServerMode ? t('server_mode_description') : t('client_mode_description')}
                                    </p>
                                </div>
                                <button 
                                    onClick={() => {
                                        if(isServerMode) {
                                            setIsServerMode(false);
                                            setSystemStatus(null);
                                        } else {
                                            setIsServerMode(true);
                                            setTimeout(() => {
                                                fetchSystemStatus(true);
                                                fetchServerFolders();
                                            }, 100);
                                        }
                                    }}
                                    className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                    {t('toggle')}
                                </button>
                            </div>
                        </section>

                        {/* SERVER DASHBOARD */}
                        {isServerMode && (
                            <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Icons.Activity size={18} /> {t('system_monitoring')}</h3>
                                {!systemStatus ? (
                                     <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                         <Icons.AlertTriangle className="text-red-500" />
                                         <div>
                                             <p className="text-sm font-bold text-red-700 dark:text-red-400">{t('server_offline')}</p>
                                             <p className="text-xs text-red-600 dark:text-red-500">{t('server_offline_desc')}</p>
                                         </div>
                                         <button onClick={() => fetchSystemStatus(true)} className="ml-auto px-3 py-1 bg-white dark:bg-gray-800 shadow-sm rounded-lg text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">{t('retry')}</button>
                                     </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                        {/* Core Components Status */}
                                        <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                                            <h4 className="text-xs uppercase font-bold text-gray-500 mb-3">{t('backend_components')}</h4>
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><Icons.Database size={14}/> {t('database')}</span>
                                                    <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded text-[10px] font-bold">ONLINE</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><Icons.Cpu size={14}/> {t('video_engine')}</span>
                                                     {systemStatus.ffmpeg ? <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded text-[10px] font-bold">FFMPEG</span> : <span className="text-red-500 bg-red-500/10 px-2 py-0.5 rounded text-[10px] font-bold">MISSING</span>}
                                                </div>
                                                 <div className="flex justify-between items-center text-sm">
                                                    <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><Icons.Image size={14}/> {t('image_engine')}</span>
                                                     {systemStatus.sharp ? <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded text-[10px] font-bold">SHARP</span> : <span className="text-red-500 bg-red-500/10 px-2 py-0.5 rounded text-[10px] font-bold">MISSING</span>}
                                                </div>
                                                 <div className="flex justify-between items-center text-sm">
                                                    <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300"><Icons.Zap size={14}/> {t('hw_accel')}</span>
                                                     {systemStatus.ffmpegHwAccels.length > 0 ? (
                                                        <div className="flex gap-1">
                                                            {systemStatus.ffmpegHwAccels.slice(0, 2).map(a => <span key={a} className="text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">{a}</span>)}
                                                        </div>
                                                     ) : <span className="text-gray-400 text-[10px]">OFF</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Library Stats */}
                                        <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                                             <h4 className="text-xs uppercase font-bold text-gray-500 mb-3">{t('library_stats')}</h4>
                                             <div className="flex items-end justify-between mb-4">
                                                 <div>
                                                     <p className="text-2xl font-bold text-gray-800 dark:text-white">{systemStatus.totalItems}</p>
                                                     <p className="text-xs text-gray-400">{t('total_assets')}</p>
                                                 </div>
                                                 <div className="text-right">
                                                     <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{systemStatus.mediaBreakdown.video}</p>
                                                     <p className="text-xs text-gray-400">Videos</p>
                                                 </div>
                                             </div>
                                             <div className="flex gap-2 text-[10px]">
                                                <div className="flex-1 bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600 text-center">
                                                    <strong className="block text-gray-800 dark:text-gray-200">{systemStatus.mediaBreakdown.image}</strong> Images
                                                </div>
                                                <div className="flex-1 bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600 text-center">
                                                    <strong className="block text-gray-800 dark:text-gray-200">{systemStatus.mediaBreakdown.audio}</strong> Audio
                                                </div>
                                             </div>
                                        </div>

                                        {/* Cache Stats */}
                                        <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                                             <h4 className="text-xs uppercase font-bold text-gray-500 mb-3">{t('cache_management')}</h4>
                                             <div className="mb-3">
                                                 <div className="flex justify-between text-sm mb-1">
                                                     <span className="text-gray-600 dark:text-gray-400">Thumbnails</span>
                                                     <span className="font-bold text-gray-800 dark:text-white">{systemStatus.cacheCount}</span>
                                                 </div>
                                                 <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (systemStatus.cacheCount / (systemStatus.totalItems || 1)) * 100)}%` }}></div>
                                                 </div>
                                             </div>
                                             <div className="flex flex-col gap-2 mt-auto">
                                                <button onClick={clearCache} className="w-full py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 hover:border-red-200 transition-colors">{t('clear_all_cache')}</button>
                                             </div>
                                        </div>

                                         {/* Watcher (Full Width) */}
                                         <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-700 sm:col-span-2 lg:col-span-3 flex justify-between items-center">
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2"><Icons.Scan size={16} /> {t('auto_scan')}</h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Automatically detect changes in library folders.</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold uppercase ${systemStatus.watcherActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400'}`}>
                                                    <div className={`w-2 h-2 rounded-full ${systemStatus.watcherActive ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                                                    {systemStatus.watcherActive ? 'Running' : 'Stopped'}
                                                </div>
                                                <button onClick={toggleWatcher} className={`relative w-10 h-6 rounded-full transition-colors ${systemStatus.watcherActive ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                                                    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow transition-transform ${systemStatus.watcherActive ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>
                        )}

                        {currentUser?.isAdmin && (
                            <>
                            <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.Settings size={18} /> {t('general')}</h3>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('website_title')}</label>
                                        <input type="text" value={appTitle} onChange={(e) => handleUpdateTitle(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('home_subtitle')}</label>
                                        <input type="text" value={homeSubtitle} onChange={(e) => handleUpdateSubtitle(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                                    </div>
                                    
                                    <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-700">
                                         <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">{t('home_screen_conf')}</label>
                                         <div className="space-y-2">
                                            <div className="flex flex-col sm:flex-row gap-4">
                                                 <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                     <input type="radio" checked={homeConfig.mode === 'random'} onChange={() => handleUpdateHomeConfig({ mode: 'random' })} />
                                                     {t('random_all')}
                                                 </label>
                                                 <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                     <input type="radio" checked={homeConfig.mode === 'folder'} onChange={() => handleUpdateHomeConfig({ mode: 'folder', path: homeConfig.path || '' })} />
                                                     {t('specific_folder')}
                                                 </label>
                                                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                     <input type="radio" checked={homeConfig.mode === 'single'} onChange={() => handleUpdateHomeConfig({ mode: 'single', path: homeConfig.path || '' })} />
                                                     {t('single_item')}
                                                 </label>
                                            </div>
                                            {(homeConfig.mode === 'folder' || homeConfig.mode === 'single') && (
                                                <input 
                                                    type="text" 
                                                    value={homeConfig.path || ''} 
                                                    onChange={(e) => handleUpdateHomeConfig({ ...homeConfig, path: e.target.value })}
                                                    placeholder={t('enter_rel_path')}
                                                    className="w-full px-3 py-2 text-sm border rounded-lg outline-none bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500"
                                                />
                                            )}
                                         </div>
                                    </div>
                                </div>
                            </section>
                            
                            {/* STORAGE & DATABASE SECTION */}
                            <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.Folder size={18} /> {t('storage_database')}</h3>
                                
                                {isServerMode ? (
                                    <div className="space-y-4">
                                        <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-xl border border-primary-100 dark:border-primary-800/50">
                                            <div className="flex items-start gap-3">
                                                <Icons.Check className="text-primary-600 dark:text-primary-400 mt-1" size={20} />
                                                <div>
                                                    <h4 className="font-bold text-primary-900 dark:text-primary-100 text-sm">{t('server_persistence')}</h4>
                                                    <p className="text-xs text-primary-700 dark:text-primary-300 mt-1">{t('media_served')}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('library_scan_paths')}</label>
                                            <div className="flex flex-col gap-2">
                                                {libraryPaths.length === 0 && (
                                                    <div className="text-sm text-gray-400 italic bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">{t('scanning_default')} (/media)</div>
                                                )}
                                                {libraryPaths.map(path => (
                                                    <div key={path} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
                                                        <Icons.Folder size={14} className="text-gray-400" />
                                                        <span className="text-sm font-mono flex-1 truncate">{path}</span>
                                                        <button onClick={() => handleRemoveLibraryPath(path)} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 p-1 rounded"><Icons.Trash size={14} /></button>
                                                    </div>
                                                ))}
                                                <form onSubmit={handleAddLibraryPath} className="flex gap-2 mt-1">
                                                     <PathAutocomplete value={newPathInput} onChange={setNewPathInput} onAdd={handleAddLibraryPath} />
                                                     <button type="submit" disabled={!newPathInput} className="bg-gray-900 dark:bg-gray-700 text-white px-3 rounded-lg text-sm font-medium disabled:opacity-50">{t('add_path')}</button>
                                                </form>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-2">
                                            <button onClick={startServerScan} className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 border border-gray-200 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 rounded-xl transition-all group">
                                                <Icons.Refresh size={24} className="text-gray-400 group-hover:text-primary-600 mb-2" />
                                                <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('scan_library')}</span>
                                                <span className="text-[10px] text-gray-400 mt-1">{t('scan_started')}</span>
                                            </button>
                                            <button onClick={startThumbnailGen} className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 border border-gray-200 dark:border-gray-700 hover:border-primary-200 dark:hover:border-primary-800 rounded-xl transition-all group">
                                                <Icons.Image size={24} className="text-gray-400 group-hover:text-primary-600 mb-2" />
                                                <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{t('generate_thumbs')}</span>
                                                <span className="text-[10px] text-gray-400 mt-1">{t('thumbs_started')}</span>
                                            </button>
                                        </div>
                                        
                                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('cache_management')}</h4>
                                            <div className="flex gap-3">
                                                 <button onClick={clearCache} className="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2"><Icons.Trash size={14}/> {t('clear_all_cache')}</button>
                                                 <button onClick={pruneCache} className="px-3 py-2 text-xs font-medium text-orange-600 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 rounded-lg transition-colors flex items-center gap-2"><Icons.Filter size={14}/> {t('prune_legacy_cache')}</button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl border border-orange-100 dark:border-orange-800/50">
                                         <div className="flex items-start gap-3">
                                             <Icons.Alert size={20} className="text-orange-600 dark:text-orange-400 mt-1" />
                                             <div>
                                                 <h4 className="font-bold text-orange-900 dark:text-orange-100 text-sm">{t('running_client_mode')}</h4>
                                                 <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">Data is stored in your browser's LocalStorage. Clearing browser data will lose your library index.</p>
                                                 <button onClick={handleExportConfig} className="mt-3 text-xs bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-100 px-3 py-1.5 rounded-lg font-bold hover:bg-orange-300 transition-colors flex items-center gap-2 w-fit"><Icons.Download size={12} /> {t('backup_config')}</button>
                                             </div>
                                         </div>
                                     </div>
                                )}
                            </section>

                            {/* USER MANAGEMENT SECTION */}
                            <section>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Icons.User size={18} /> {t('users')}</h3>
                                    <button onClick={() => setIsUserPanelOpen(!isUserPanelOpen)} className="text-xs font-bold text-primary-600 hover:bg-primary-50 px-2 py-1 rounded transition-colors">{isUserPanelOpen ? t('hide') : t('manage')}</button>
                                </div>
                                
                                {isUserPanelOpen && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <div className="space-y-2">
                                            {users.map(u => (
                                                <div key={u.username} className="flex justify-between items-center bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2 h-2 rounded-full ${u.isAdmin ? 'bg-purple-500' : 'bg-gray-400'}`} />
                                                        <span className="text-sm font-medium">{u.username}</span>
                                                    </div>
                                                    <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">{u.isAdmin ? 'Admin' : 'User'}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <form onSubmit={handleAddUser} className="flex gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                            <input placeholder="New Username" value={newUserForm.username} onChange={e => setNewUserForm({...newUserForm, username: e.target.value})} className="flex-1 px-3 py-1.5 text-sm border rounded-lg outline-none bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600" />
                                            <input type="password" placeholder="Password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} className="flex-1 px-3 py-1.5 text-sm border rounded-lg outline-none bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600" />
                                            <button type="submit" className="bg-gray-900 dark:bg-gray-600 text-white px-3 rounded-lg text-sm font-bold"><Icons.Plus size={16}/></button>
                                        </form>
                                    </div>
                                )}
                            </section>
                            </>
                        )}
                    </div>
                    <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                         <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 dark:text-red-400 px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-sm font-medium"><Icons.LogOut size={16} /> {t('sign_out')}</button>
                         <button onClick={() => setIsSettingsOpen(false)} className="px-6 py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors">{t('done')}</button>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
