import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig, FolderNode } from './types';
import { buildFolderTree, generateId, isVideo, sortMedia } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { ImageViewer } from './components/ImageViewer';
import { ScanProgressModal, ScanStatus } from './components/ScanProgressModal';
import { VirtualGallery } from './components/VirtualGallery';
import { PathAutocomplete } from './components/PathAutocomplete';
import { Home } from './components/Home';

const CONFIG_FILE_NAME = 'lumina-config.json';
const USERS_STORAGE_KEY = 'lumina_users';
const VIEW_MODE_KEY = 'lumina_view_mode';
const LAYOUT_MODE_KEY = 'lumina_layout_mode';
const APP_TITLE_KEY = 'lumina_app_title';
const SOURCES_STORAGE_KEY = 'lumina_sources'; 
const THEME_STORAGE_KEY = 'lumina_theme';
const AUTH_USER_KEY = 'lumina_auth_user';

export default function App() {
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
  const [serverTotal, setServerTotal] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMoreServer, setHasMoreServer] = useState(true);
  const [serverFolders, setServerFolders] = useState<any[]>([]); // Full list of folders from server

  // --- Scanning State ---
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanProgress, setScanProgress] = useState({ count: 0, currentPath: '' });
  
  // Use timeout ref for recursive polling instead of interval to prevent congestion
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- App Data State ---
  const [allUserData, setAllUserData] = useState<Record<string, UserData>>({});
  const [appTitle, setAppTitle] = useState('Lumina Gallery');
  
  // Derived state for current user
  const files = useMemo(() => 
    currentUser ? (allUserData[currentUser.username]?.files || []) : [], 
    [currentUser, allUserData]
  );
  
  // --- View State ---
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [layoutMode, setLayoutMode] = useState<GridLayout>('masonry'); // 'grid' (Virtual) or 'masonry' (CSS)
  const [currentPath, setCurrentPath] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  // --- Sort & Filter State ---
  const [sortOption, setSortOption] = useState<SortOption>('dateDesc');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserPanelOpen, setIsUserPanelOpen] = useState(false); 
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '' });

  // --- Theme Logic ---
  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as 'light' | 'dark' | null;
    const preferredTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(preferredTheme);
    if (preferredTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // --- Persistence Helper ---
  const persistData = async (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>, newLibraryPaths?: string[]) => {
      const u = newUsers || users;
      const t = newTitle || appTitle;
      const d = newAllUserData || allUserData;
      const l = newLibraryPaths || libraryPaths;

      // Update React State
      if (newUsers) setUsers(newUsers);
      if (newTitle) setAppTitle(newTitle);
      if (newAllUserData) setAllUserData(newAllUserData);
      if (newLibraryPaths) setLibraryPaths(newLibraryPaths);

      // Construct Config Object
      const userSources: Record<string, any[]> = {};
      Object.keys(d).forEach(k => {
          userSources[k] = d[k].sources;
      });

      const config: AppConfig = {
          title: t,
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
          localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(userSources));
      }
  };

  // 1. Initial Load & Mode Detection
  useEffect(() => {
    const initApp = async () => {
      let loadedUsers: User[] = [];
      let loadedData: Record<string, UserData> = {};
      let loadedTitle = 'Lumina Gallery';
      let serverMode = false;

      try {
        const res = await fetch('/api/config');
        if (res.ok) {
           // Safe parsing for config to prevent stream errors
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
              setLibraryPaths(config.libraryPaths || []);
              
              config.users.forEach((u: User) => {
                  loadedData[u.username] = { sources: [], files: [] };
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
          const storedSources = localStorage.getItem(SOURCES_STORAGE_KEY);
          
          if (storedUsers) {
            loadedUsers = JSON.parse(storedUsers);
            if (storedTitle) loadedTitle = storedTitle;

            if (storedSources) {
                const parsedSources = JSON.parse(storedSources);
                Object.keys(parsedSources).forEach(username => {
                    loadedData[username] = { sources: parsedSources[username], files: [] };
                });
            } else {
                loadedUsers.forEach((u: User) => loadedData[u.username] = { sources: [], files: [] });
            }
          } else {
            setAuthStep('setup');
            return;
          }
      }

      setUsers(loadedUsers);
      setAppTitle(loadedTitle);
      setAllUserData(loadedData);

      // Check Persistent Login
      const savedUser = localStorage.getItem(AUTH_USER_KEY);
      if (savedUser) {
          const user = loadedUsers.find(u => u.username === savedUser);
          if (user) {
              setCurrentUser(user);
              setAuthStep('app');
              if (serverMode) {
                  // We delay the sync slightly to ensure state is ready
                  setTimeout(() => {
                      fetchServerFiles(user.username, loadedData, 0, true);
                      fetchServerFolders();
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

  // --- Server Logic: Scan & Poll ---

  // Fetch complete folder structure from server (no pagination)
  const fetchServerFolders = async () => {
    try {
        const res = await fetch('/api/library/folders');
        if (res.ok) {
            // Robust parsing
            const text = await res.text();
            try {
                const data = JSON.parse(text);
                if (data && data.folders) {
                    setServerFolders(data.folders);
                }
            } catch(e) {
                console.error("Failed to parse folders JSON", e);
            }
        }
    } catch(e) {
        console.error("Failed to fetch folders", e);
    }
  };
  
  // Fetch files with pagination
  const fetchServerFiles = async (
      username: string, 
      currentData: Record<string, UserData>,
      offset: number = 0,
      reset: boolean = false,
      folderFilter: string | null = null
  ) => {
      try {
          setIsFetchingMore(true);
          const limit = 500; // Chunk size
          let url = `/api/scan/results?offset=${offset}&limit=${limit}`;
          
          // Explicitly handle empty string for root folder.
          // folderFilter === '' means Root folder.
          // folderFilter === null means "All Files" (no filter).
          if (folderFilter !== null && folderFilter !== undefined) {
              url += `&folder=${encodeURIComponent(folderFilter)}`;
          }

          const res = await fetch(url);
          if (!res.ok) throw new Error("API Error");
          
          // Use text() -> JSON.parse() to avoid ReadableStream 'close' error and handle nulls safely
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
                  files: newFiles,
                  sources: data.sources
              }
          });
          
          setServerTotal(data.total);
          setServerOffset(offset + limit);
          setHasMoreServer(data.hasMore);
          setIsFetchingMore(false);

      } catch (e) {
          console.error("Fetch files failed", e);
          setIsFetchingMore(false);
      }
  };

  const loadMoreServerFiles = async () => {
      if (!isServerMode || !currentUser || !hasMoreServer || isFetchingMore) return;
      // If we are in folders view, pass the current path. If current path is '', pass ''.
      // If we are in 'all' view, pass null.
      const filter = viewMode === 'folders' ? currentPath : null;
      await fetchServerFiles(currentUser.username, allUserData, serverOffset, false, filter);
  };

  const stopPolling = () => {
      if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
      }
  };

  const startPolling = () => {
    stopPolling();
    
    const poll = async () => {
        try {
            const statusRes = await fetch('/api/scan/status');
            if (statusRes.ok) {
                // Safer parsing to prevent crashing on "unexpected non-whitespace character"
                const text = await statusRes.text();
                let statusData;
                try {
                    statusData = JSON.parse(text);
                } catch(e) {
                    // Ignore parsing error, likely network blip or intermediate state
                    console.warn("Status parse error, retrying...", e);
                }
                
                if (statusData) {
                    setScanStatus(statusData.status);
                    setScanProgress({ 
                        count: statusData.count || 0, 
                        currentPath: statusData.currentPath || '' 
                    });

                    if (statusData.status === 'scanning' || statusData.status === 'paused') {
                        // Schedule next poll only if still active
                        scanTimeoutRef.current = setTimeout(poll, 1000);
                        return;
                    }
                }
            }
            
            // If we fall through (not scanning/paused, or error), stop or retry slowly
            // If it was just an error, retry slowly
            if (!statusRes.ok) {
                scanTimeoutRef.current = setTimeout(poll, 2000);
            } else {
                // Finished
                stopPolling();
            }
        } catch (e) {
            console.error("Poll failed", e);
            // Retry safely on network error
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

          setIsScanModalOpen(true);
          setScanStatus('scanning');
          startPolling();

      } catch (e) {
          console.error("Scan init failed", e);
      }
  };

  // Resume scanning UI if server is working in background on reload
  useEffect(() => {
    let isMounted = true;
    if (isServerMode && currentUser) {
        fetch('/api/scan/status')
            .then(async r => {
                if (!r.ok) throw new Error("Status check failed");
                const text = await r.text();
                try {
                    return JSON.parse(text);
                } catch(e) {
                    return { status: 'idle' }; // Safe fallback
                }
            })
            .then(d => {
                if (isMounted && d && (d.status === 'scanning' || d.status === 'paused')) {
                    setIsScanModalOpen(true);
                    setScanStatus(d.status);
                    setScanProgress({ count: d.count, currentPath: d.currentPath });
                    startPolling();
                }
            })
            .catch(e => {
                if (isMounted) console.warn("Failed to check status", e.message);
            });
    }
    return () => { 
        isMounted = false; 
        stopPolling();
    };
  }, [isServerMode, currentUser]);

  // Effect to handle scan completion logic (refresh library)
  useEffect(() => {
    if (scanStatus === 'completed' && currentUser) {
        // Refresh the library when scan completes
        fetchServerFiles(currentUser.username, allUserData, 0, true);
        fetchServerFolders();
    }
  }, [scanStatus]);

  const handleScanControl = async (action: 'pause' | 'resume' | 'cancel') => {
      try {
          await fetch('/api/scan/control', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action })
          });
          // Optimistic update
          if (action === 'pause') setScanStatus('paused');
          if (action === 'resume') setScanStatus('scanning');
          if (action === 'cancel') setScanStatus('cancelled');
          
          if (action === 'resume') startPolling();
      } catch(e) {
          console.error(e);
      }
  };

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
    setCurrentPath(''); 
    
    // Reset file view when switching modes in server mode
    if (isServerMode && currentUser) {
        // If switching to all/folders, fetch relevant data. 
        // Note: fetchServerFiles is called on folder click for specific folders.
        // For 'all', we might want to reset to all files.
        if (mode === 'all') {
             fetchServerFiles(currentUser.username, allUserData, 0, true, null);
        }
    }
  };

  const handleFolderClick = (path: string) => {
      setCurrentPath(path);
      // In server mode, specifically fetch files for this folder to reset pagination
      if (isServerMode && currentUser) {
          fetchServerFiles(currentUser.username, allUserData, 0, true, path);
      }
  };

  const toggleLayoutMode = () => {
      const newMode = layoutMode === 'grid' ? 'masonry' : 'grid';
      setLayoutMode(newMode);
      localStorage.setItem(LAYOUT_MODE_KEY, newMode);
  };

  const handleUpdateTitle = (newTitle: string) => {
    persistData(undefined, newTitle, undefined, undefined);
  };

  const handleAddLibraryPath = (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!newPathInput.trim()) return;
      const newPaths = [...libraryPaths, newPathInput.trim()];
      persistData(undefined, undefined, undefined, newPaths);
      setNewPathInput('');
  };

  const handleRemoveLibraryPath = (pathToRemove: string) => {
      const newPaths = libraryPaths.filter(p => p !== pathToRemove);
      persistData(undefined, undefined, undefined, newPaths);
  };

  const handleExportConfig = () => {
    const userSources: Record<string, any[]> = {};
    Object.keys(allUserData).forEach(key => {
        userSources[key] = allUserData[key].sources;
    });

    const config: AppConfig = {
        title: appTitle,
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
                  
                  persistData(json.users, json.title, hydratedData, json.libraryPaths);
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
      setAuthError("Passwords do not match");
      return;
    }
    const adminUser: User = { username: setupForm.username, password: setupForm.password, isAdmin: true };
    const newUsers = [adminUser];
    const newUserData = { [adminUser.username]: { files: [], sources: [] } };
    persistData(newUsers, undefined, newUserData, []);
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
          fetchServerFiles(user.username, newData, 0, true);
          fetchServerFolders();
      }
    } else {
      setAuthError('Invalid credentials');
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
    persistData(updatedUsers, undefined, updatedUserData, undefined);
    setNewUserForm({ username: '', password: '' });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isServerMode) {
        alert("In Server Mode, please manage Library Paths in Settings and click 'Scan NAS Library'.");
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
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const path = file.webkitRelativePath || file.name;
        const pathParts = path.split('/');
        const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
        
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
          mediaType: isVideo(file.type) ? 'video' : 'image',
          sourceId
        });
      }
    });

    if (newItems.length > 0) {
      const updatedUserData = {
          ...allUserData,
          [currentUser.username]: {
              files: [...(allUserData[currentUser.username]?.files || []), ...newItems],
              sources: [...(allUserData[currentUser.username]?.sources || []), { id: sourceId, name: sourceName, count: newItems.length }]
          }
      };
      setAllUserData(updatedUserData);
      persistData(undefined, undefined, updatedUserData, undefined); 
      setIsSettingsOpen(false);
    }
  };

  const processedFiles = useMemo(() => {
    let result = files;
    if (filterOption !== 'all') {
      result = result.filter(f => f.mediaType === filterOption);
    }
    // Sort logic
    return sortMedia(result, sortOption);
  }, [files, filterOption, sortOption]);

  // Construct Folder Tree
  const folderTree = useMemo(() => {
    if (isServerMode && serverFolders.length > 0) {
        // Build folder tree from flat server list
        const root: FolderNode = {
            name: 'Root',
            path: '',
            children: {},
            mediaCount: 0,
        };
        
        serverFolders.forEach(sf => {
            const parts = sf.path.split('/').filter((p: string) => p);
            let currentNode = root;

            parts.forEach((part: string, index: number) => {
                if (!currentNode.children[part]) {
                    const currentPath = parts.slice(0, index + 1).join('/');
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
    return buildFolderTree(processedFiles);
  }, [processedFiles, isServerMode, serverFolders]);

  const content = useMemo(() => {
    if (viewMode === 'all') {
      return { type: 'media', data: processedFiles, title: 'Library' };
    }
    if (viewMode === 'home') {
        return { type: 'home' };
    }
    // Folders Mode
    let targetNode = folderTree;
    let title = 'Folders';
    if (currentPath) {
       const parts = currentPath.split('/');
       for (const part of parts) {
           if (targetNode.children[part]) {
               targetNode = targetNode.children[part];
           }
       }
       title = parts[parts.length - 1];
    }
    const subfolders = (Object.values(targetNode.children) as FolderNode[]).sort((a, b) => a.name.localeCompare(b.name));
    
    // In Server mode, media for a specific folder is fetched into 'files' when clicking a folder.
    const media = processedFiles.filter(f => f.folderPath === currentPath);
    return { type: 'mixed', folders: subfolders, photos: media, title: title };
  }, [viewMode, currentPath, processedFiles, folderTree]);

  // Helpers (Lightbox, etc)
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
      else if (idx === list.length - 1) setSelectedItem(list[0]); // Loop
  };
  const handlePrev = () => {
      if (!selectedItem) return;
      const list = getLightboxList();
      const idx = list.findIndex(p => p.id === selectedItem.id);
      if (idx > 0) setSelectedItem(list[idx - 1]);
      else if (idx === 0) setSelectedItem(list[list.length - 1]); // Loop
  };

  // --- RENDER ---
  if (authStep === 'loading') return <div className="h-screen flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-900">Loading...</div>;

  if (authStep === 'setup') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md transition-colors">
          <div className="flex justify-end mb-2">
            <button onClick={toggleTheme} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                {theme === 'dark' ? <Icons.Sun size={20} /> : <Icons.Moon size={20} />}
            </button>
          </div>
          <h1 className="text-3xl font-bold text-primary-600 mb-2 text-center">Welcome</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">{isServerMode ? 'Initialize your NAS Gallery.' : 'Set up your admin account.'}</p>
          <form onSubmit={handleSetup} className="space-y-4">
            <input type="text" placeholder="Username" value={setupForm.username} onChange={e => setSetupForm({...setupForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
            <input type="password" placeholder="Password" value={setupForm.password} onChange={e => setSetupForm({...setupForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
            <input type="password" placeholder="Confirm Password" value={setupForm.confirmPassword} onChange={e => setSetupForm({...setupForm, confirmPassword: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700 transition-colors">Create Admin</button>
          </form>
          {!isServerMode && (
             <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700">
                <label className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg cursor-pointer transition-colors text-sm font-medium">
                    <Icons.Upload size={16} /><span>Import Database File</span><input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
                </label>
             </div>
          )}
        </div>
      </div>
    );
  }

  if (authStep === 'login') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 transition-colors">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-sm transition-colors">
           <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center"><Icons.User className="text-white" /></div>
              <button onClick={toggleTheme} className="p-2 text-gray-400 hover:text-primary-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                {theme === 'dark' ? <Icons.Sun size={20} /> : <Icons.Moon size={20} />}
              </button>
           </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white text-center mb-2">{appTitle}</h1>
          {isServerMode && <p className="text-xs text-center text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 py-1 rounded mb-6">NAS Server Connected</p>}
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
            <input type="password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700 transition-colors">Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900 transition-colors">
      <Navigation 
        appTitle={appTitle}
        viewMode={viewMode}
        setViewMode={handleSetViewMode}
        onUpload={handleFileUpload}
        isSidebarOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        totalPhotos={isServerMode ? serverTotal : files.length}
        theme={theme}
        toggleTheme={toggleTheme}
        isServerMode={isServerMode}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {viewMode === 'home' ? (
             <Home items={files} onEnterLibrary={() => handleSetViewMode('folders')} />
        ) : (
        <>
            <header className="h-16 mt-16 md:mt-0 flex items-center justify-between px-6 border-b border-gray-50 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-20 shrink-0 transition-colors">
            <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
                {viewMode === 'folders' ? (
                    <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 overflow-hidden whitespace-nowrap mask-linear-fade">
                        <button onClick={() => handleFolderClick('')} className={`hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${currentPath === '' ? 'font-bold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800' : ''}`}><Icons.Folder size={16} />Root</button>
                        {currentPath && currentPath.split('/').map((part, index, arr) => {
                            const path = arr.slice(0, index + 1).join('/');
                            return (<React.Fragment key={path}><Icons.ChevronRight size={12} className="text-gray-300 dark:text-gray-600" /><button onClick={() => handleFolderClick(path)} className="hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded-md truncate max-w-[150px] transition-colors">{part}</button></React.Fragment>);
                        })}
                    </div>
                ) : (
                    <div className="flex items-center gap-2"><Icons.Image size={20} className="text-primary-600" /><h1 className="text-xl font-bold text-gray-800 dark:text-white truncate">Library</h1></div>
                )}
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={toggleLayoutMode} 
                    className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors hidden sm:block" 
                    title={layoutMode === 'grid' ? "Switch to Waterfall Masonry (Aesthetic)" : "Switch to Grid (Performance)"}
                >
                    {layoutMode === 'grid' ? <Icons.Masonry size={20} /> : <Icons.Grid size={20} />}
                </button>

                <div className="relative group z-30">
                    <button className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full flex items-center gap-1 transition-colors"><Icons.Filter size={18} /><Icons.Sort size={14} /></button>
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-2 hidden group-focus-within:block group-hover:block z-50">
                        <p className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Sort & Filter</p>
                        <button onClick={() => setSortOption('dateDesc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${sortOption === 'dateDesc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>Newest First {sortOption === 'dateDesc' && <Icons.Check size={14} />}</button>
                        <button onClick={() => setSortOption('dateAsc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${sortOption === 'dateAsc' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>Oldest First {sortOption === 'dateAsc' && <Icons.Check size={14} />}</button>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                        <button onClick={() => setFilterOption('all')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${filterOption === 'all' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>All Types {filterOption === 'all' && <Icons.Check size={14} />}</button>
                        <button onClick={() => setFilterOption('video')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between transition-colors ${filterOption === 'video' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>Videos Only {filterOption === 'video' && <Icons.Check size={14} />}</button>
                    </div>
                </div>
                <button onClick={() => setIsSettingsOpen(true)} className="p-2 ml-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"><Icons.Settings size={20} /></button>
            </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 no-scrollbar bg-gray-50/50 dark:bg-gray-900/50 transition-colors">
            {files.length === 0 && !isFetchingMore && viewMode === 'all' && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-6 text-indigo-400"><Icons.Upload size={40} /></div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Welcome, {currentUser?.username}</h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">{isServerMode ? "Connected to NAS. Configure Library Paths in Settings and Scan." : "Import local folders to begin."}</p>
                {isServerMode ? (
                    <button onClick={() => setIsSettingsOpen(true)} className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg hover:bg-primary-700 flex items-center justify-center gap-2 transition-colors"><Icons.Settings size={20} /><span>Configure Library</span></button>
                ) : (
                    <label className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg cursor-pointer flex items-center justify-center gap-2 hover:bg-primary-700 transition-colors"><Icons.Upload size={20} /><span>Import Local Folder</span><input type="file" multiple webkitdirectory="true" directory="" onChange={handleFileUpload} className="hidden" /></label>
                )}
                </div>
            )}

            {(files.length > 0 || isFetchingMore || (viewMode === 'folders' && content.folders.length > 0)) && (
                <div className="h-full w-full"> 
                    
                    {viewMode === 'folders' && content.folders.length > 0 && (
                        <div className="mb-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Icons.Folder size={14} />{currentPath ? 'Subfolders' : 'Folders'}</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {content.folders.map((folder) => (<FolderCard key={folder.path} folder={folder} onClick={handleFolderClick} />))}
                            </div>
                        </div>
                    )}

                    {(viewMode === 'all' || (viewMode === 'folders' && currentPath !== '')) && (
                    <VirtualGallery 
                            layout={layoutMode}
                            items={viewMode === 'all' ? processedFiles : (content.photos || [])}
                            onItemClick={setSelectedItem}
                            hasNextPage={isServerMode ? hasMoreServer : false}
                            isNextPageLoading={isFetchingMore}
                            loadNextPage={loadMoreServerFiles}
                            itemCount={isServerMode && viewMode === 'all' ? serverTotal : processedFiles.length}
                    />
                    )}
                </div>
            )}
            </div>
        </>
        )}
      </main>

      <ImageViewer item={selectedItem} onClose={() => setSelectedItem(null)} onNext={handleNext} onPrev={handlePrev} />
      
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
      />

      <AnimatePresence>
        {isSettingsOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsSettingsOpen(false)}>
                <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl transition-colors" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50"><h2 className="font-bold text-xl text-gray-800 dark:text-white">Settings</h2><button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-500 dark:text-gray-400 transition-colors"><Icons.Close size={20}/></button></div>
                    <div className="p-6 overflow-y-auto space-y-8 flex-1">
                        
                        {currentUser?.isAdmin && (
                            <>
                            <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.Settings size={18} /> General</h3>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Website Title</label>
                                        <input type="text" value={appTitle} onChange={(e) => handleUpdateTitle(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                                    </div>
                                    
                                    {/* Connection Mode Toggle */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-medium text-gray-600 dark:text-gray-400 block">Connection Mode</label>
                                        <div className="flex bg-gray-100 dark:bg-gray-700/50 p-1 rounded-lg">
                                            <button 
                                                onClick={() => setIsServerMode(false)}
                                                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${!isServerMode ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                                            >
                                                Client Mode (Local Browser)
                                            </button>
                                            <button 
                                                onClick={() => setIsServerMode(true)}
                                                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${isServerMode ? 'bg-primary-600 shadow-sm text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                                            >
                                                Server Mode (NAS)
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-400 dark:text-gray-500">
                                            {isServerMode 
                                                ? "Server Mode connects to the backend API to read files from the server's filesystem. Ideal for NAS and large libraries."
                                                : "Client Mode runs entirely in your browser. You manually import folders, and data is stored in LocalStorage."
                                            }
                                        </p>
                                    </div>
                                </div>
                            </section>

                            <section className="pb-6 border-b border-gray-100 dark:border-gray-700">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-4"><Icons.FileJson size={18} /> Storage & Database</h3>
                                {isServerMode ? (
                                    <div className="space-y-4">
                                        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl border border-green-100 dark:border-green-900/50 space-y-3">
                                            <div className="flex items-center gap-2 text-green-800 dark:text-green-300 font-semibold text-sm"><Icons.Check size={16} /> Server Persistence Active</div>
                                            <p className="text-sm text-green-700 dark:text-green-400">Media is served from configured paths.</p>
                                        </div>

                                        <div>
                                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">Library Scan Paths</label>
                                            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Enter absolute mapped paths (e.g. "/photos") or paths relative to default /media.</p>
                                            
                                            <div className="space-y-2 mb-3">
                                                {libraryPaths.length === 0 && <div className="text-sm text-gray-400 italic bg-gray-50 dark:bg-gray-700/50 p-2 rounded">Scanning Default: /media</div>}
                                                {libraryPaths.map(path => (
                                                    <div key={path} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded text-sm">
                                                        <span className="font-mono text-gray-600 dark:text-gray-300">{path}</span>
                                                        <button onClick={() => handleRemoveLibraryPath(path)} className="text-red-500 hover:text-red-700 p-1"><Icons.Trash size={14}/></button>
                                                    </div>
                                                ))}
                                            </div>

                                            <form onSubmit={handleAddLibraryPath} className="flex gap-2">
                                                <PathAutocomplete value={newPathInput} onChange={setNewPathInput} onAdd={handleAddLibraryPath} />
                                                <button type="submit" className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Add Path</button>
                                            </form>
                                        </div>

                                        <button onClick={() => startServerScan()} disabled={scanStatus === 'scanning'} className="w-full py-2 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300 rounded-lg text-sm font-medium hover:bg-primary-100 dark:hover:bg-primary-900/50 flex items-center justify-center gap-2 transition-colors">
                                            <Icons.Refresh size={14} className={scanStatus === 'scanning' ? 'animate-spin' : ''} />{scanStatus === 'scanning' ? 'Scanning in progress...' : 'Scan NAS Library'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl border border-yellow-100 dark:border-yellow-900/30">
                                        <p className="text-sm text-yellow-800 dark:text-yellow-400 font-medium mb-2">Running in Client Mode</p>
                                        <button onClick={handleExportConfig} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-700 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 rounded-lg text-xs font-medium transition-colors"><Icons.Download size={12} /> Backup Config</button>
                                    </div>
                                )}
                            </section>
                            </>
                        )}
                         {currentUser?.isAdmin && (
                            <section className="pt-6 border-t border-gray-100 dark:border-gray-700">
                                <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Icons.User size={18} /> Users</h3><button onClick={() => setIsUserPanelOpen(!isUserPanelOpen)} className="text-xs font-medium text-primary-600 hover:underline">{isUserPanelOpen ? 'Hide' : 'Manage'}</button></div>
                                {isUserPanelOpen && (
                                    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4 space-y-4 border border-gray-100 dark:border-gray-700">
                                        <div className="space-y-2">{users.map(u => (<div key={u.username} className="flex justify-between items-center text-sm p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-100 dark:border-gray-600"><span className="font-medium flex items-center gap-2 text-gray-900 dark:text-white">{u.username} {u.isAdmin && <span className="text-[10px] bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded font-bold">ADMIN</span>}</span><div className="text-xs flex gap-2"><span className="text-gray-400">Pass: {u.password}</span></div></div>))}</div>
                                        <form onSubmit={handleAddUser} className="flex gap-2 items-end pt-2">
                                            <input placeholder="Username" value={newUserForm.username} onChange={e => setNewUserForm({...newUserForm, username: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                                            <input type="password" placeholder="Pass" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 placeholder-gray-400 dark:placeholder-gray-500" />
                                            <button type="submit" className="bg-gray-900 dark:bg-gray-600 text-white p-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-500 transition-colors"><Icons.Plus size={18}/></button>
                                        </form>
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                    <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                         <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 dark:text-red-400 px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-sm font-medium"><Icons.LogOut size={16} /> Sign Out</button>
                         <button onClick={() => setIsSettingsOpen(false)} className="px-6 py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors">Done</button>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}