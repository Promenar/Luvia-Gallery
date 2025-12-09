import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem, ViewMode, GridLayout, User, UserData, SortOption, FilterOption, AppConfig } from './types';
import { buildFolderTree, generateId, isVideo, sortMedia } from './utils/fileUtils';
import { Icons } from './components/ui/Icon';
import { Navigation } from './components/Navigation';
import { MediaCard } from './components/PhotoCard';
import { FolderCard } from './components/FolderCard';
import { ImageViewer } from './components/ImageViewer';

const CONFIG_FILE_NAME = 'lumina-config.json';
const USERS_STORAGE_KEY = 'lumina_users';
const VIEW_MODE_KEY = 'lumina_view_mode';
const APP_TITLE_KEY = 'lumina_app_title';
const SOURCES_STORAGE_KEY = 'lumina_sources'; 

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
  const [isSyncing, setIsSyncing] = useState(false);

  // --- App Data State ---
  const [allUserData, setAllUserData] = useState<Record<string, UserData>>({});
  const [appTitle, setAppTitle] = useState('Lumina Gallery');
  
  // Derived state for current user
  const files = useMemo(() => 
    currentUser ? (allUserData[currentUser.username]?.files || []) : [], 
    [currentUser, allUserData]
  );
  const folderSources = useMemo(() => 
    currentUser ? (allUserData[currentUser.username]?.sources || []) : [],
    [currentUser, allUserData]
  );
  
  // --- View State ---
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [folderViewLayout, setFolderViewLayout] = useState<GridLayout>('masonry');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  
  // --- Sort & Filter State ---
  const [sortOption, setSortOption] = useState<SortOption>('dateDesc');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserPanelOpen, setIsUserPanelOpen] = useState(false); 
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '' });

  // --- Persistence Helper ---
  // Handles saving data either to LocalStorage (Client Mode) or Server API (Server Mode)
  const persistData = async (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>) => {
      const u = newUsers || users;
      const t = newTitle || appTitle;
      const d = newAllUserData || allUserData;

      // Update React State
      if (newUsers) setUsers(newUsers);
      if (newTitle) setAppTitle(newTitle);
      if (newAllUserData) setAllUserData(newAllUserData);

      // Construct Config Object
      const userSources: Record<string, any[]> = {};
      Object.keys(d).forEach(k => {
          userSources[k] = d[k].sources;
      });

      const config: AppConfig = {
          title: t,
          users: u,
          userSources: userSources,
          lastModified: Date.now()
      };

      if (isServerMode) {
          // POST to Server
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
          // Save to LocalStorage
          localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(u));
          localStorage.setItem(APP_TITLE_KEY, t);
          localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(userSources));
      }
  };

  // 1. Initial Load & Mode Detection
  useEffect(() => {
    const initApp = async () => {
      try {
        // Try to connect to backend API
        const res = await fetch('/api/config');
        if (res.ok) {
           // --- SERVER MODE DETECTED ---
           setIsServerMode(true);
           const config = await res.json();
           
           if (config && config.users && config.users.length > 0) {
              setUsers(config.users);
              setAppTitle(config.title || 'Lumina Gallery');
              
              // Hydrate user buckets (files are loaded separately via scan)
              const hydratedData: Record<string, UserData> = {};
              config.users.forEach((u: User) => {
                  hydratedData[u.username] = { sources: [], files: [] };
              });
              setAllUserData(hydratedData);
              setAuthStep('login');
              return; 
           } else if (config === null) {
               // Server exists but no config yet
               setAuthStep('setup');
               return;
           }
        }
      } catch (e) {
          // Backend not reachable, assume Client Mode
      }

      // --- CLIENT MODE FALLBACK ---
      const storedUsers = localStorage.getItem(USERS_STORAGE_KEY);
      const storedTitle = localStorage.getItem(APP_TITLE_KEY);
      const storedSources = localStorage.getItem(SOURCES_STORAGE_KEY);
      
      if (storedUsers) {
        const parsedUsers = JSON.parse(storedUsers);
        setUsers(parsedUsers);
        setAuthStep('login');
        if (storedTitle) setAppTitle(storedTitle);

        const hydratedData: Record<string, UserData> = {};
        if (storedSources) {
            const parsedSources = JSON.parse(storedSources);
            Object.keys(parsedSources).forEach(username => {
                hydratedData[username] = { sources: parsedSources[username], files: [] };
            });
        } else {
            parsedUsers.forEach((u: User) => hydratedData[u.username] = { sources: [], files: [] });
        }
        setAllUserData(hydratedData);
      } else {
        setAuthStep('setup');
      }
    };
    
    initApp();

    const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;
    if (savedViewMode) setViewMode(savedViewMode);
  }, []);

  // --- Server Logic: Scan Files ---
  const syncServerFiles = async (username: string) => {
      if (!isServerMode) return;
      setIsSyncing(true);
      try {
          const res = await fetch('/api/scan');
          const data = await res.json();
          
          if (data.files) {
              const updatedUserData = {
                  ...allUserData,
                  [username]: {
                      files: data.files,
                      sources: data.sources
                  }
              };
              setAllUserData(updatedUserData);
              // We don't need to persist the file list itself to config.json, just sources metadata if we wanted to
          }
      } catch (e) {
          console.error("Scan failed", e);
          alert("Failed to scan NAS files.");
      } finally {
          setIsSyncing(false);
      }
  };


  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
    setCurrentPath(''); 
  };

  const handleUpdateTitle = (newTitle: string) => {
    persistData(undefined, newTitle, undefined);
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
      // Logic for importing config file (mostly for backup restore)
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const json = JSON.parse(e.target?.result as string) as AppConfig;
              if (json.users && json.title) {
                  const hydratedData: Record<string, UserData> = {};
                  json.users.forEach(u => {
                       // Preserve existing loaded files if possible
                       const existingFiles = allUserData[u.username]?.files || [];
                       hydratedData[u.username] = { sources: json.userSources?.[u.username] || [], files: existingFiles };
                  });
                  
                  persistData(json.users, json.title, hydratedData);
                  alert("Configuration restored.");
                  if (authStep === 'loading' || authStep === 'setup') setAuthStep('login');
              }
          } catch (err) {
              alert("Failed to parse configuration file.");
          }
      };
      reader.readAsText(file);
  };


  // 2. Authentication Handlers
  const handleSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (setupForm.password !== setupForm.confirmPassword) {
      setAuthError("Passwords do not match");
      return;
    }
    const adminUser: User = {
      username: setupForm.username,
      password: setupForm.password,
      isAdmin: true
    };
    
    const newUsers = [adminUser];
    const newUserData = { [adminUser.username]: { files: [], sources: [] } };
    
    persistData(newUsers, undefined, newUserData);
    setCurrentUser(adminUser);
    setAuthStep('app');
    
    // Auto-scan if on server
    if (isServerMode) syncServerFiles(adminUser.username);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
    if (user) {
      setCurrentUser(user);
      if (!allUserData[user.username]) {
          const newData = { ...allUserData, [user.username]: { files: [], sources: [] } };
          setAllUserData(newData);
      }
      setAuthStep('app');
      setAuthError('');
      
      // Auto-scan if on server
      if (isServerMode) syncServerFiles(user.username);
    } else {
      setAuthError('Invalid credentials');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthStep('login');
    setLoginForm({ username: '', password: '' });
    setCurrentPath('');
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.username || !newUserForm.password) return;
    if (users.find(u => u.username === newUserForm.username)) {
      alert("User already exists");
      return;
    }
    const newUser: User = {
      username: newUserForm.username,
      password: newUserForm.password,
      isAdmin: false
    };
    const updatedUsers = [...users, newUser];
    const updatedUserData = {
        ...allUserData,
        [newUser.username]: { files: [], sources: [] }
    };
    persistData(updatedUsers, undefined, updatedUserData);
    setNewUserForm({ username: '', password: '' });
  };

  // 4. File Handling (Local vs Server)
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    // If in Server Mode, disable local upload or treat it as temporary
    // The main flow for Server Mode is 'syncServerFiles'
    if (isServerMode) {
        alert("In Server Mode, please place files in the mapped NAS directory and click 'Scan NAS Library'.");
        return;
    }

    if (!currentUser) return;
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const sourceId = generateId();
    const firstPath = fileList[0].webkitRelativePath;
    const sourceName = firstPath ? firstPath.split('/')[0] : 'Uploaded Folder';

    const newItems: MediaItem[] = [];
    Array.from(fileList).forEach(file => {
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
      // Only persist metadata locally
      persistData(undefined, undefined, updatedUserData); 
      setIsSettingsOpen(false);
    }
  };

  const handleRemoveSource = (id: string) => {
     if (!currentUser) return;
     const updatedUserData = {
        ...allUserData,
        [currentUser.username]: {
            files: allUserData[currentUser.username].files.filter(f => f.sourceId !== id),
            sources: allUserData[currentUser.username].sources.filter(s => s.id !== id)
        }
    };
    persistData(undefined, undefined, updatedUserData);
  };

  // 5. Data Processing & Folder Tree
  const processedFiles = useMemo(() => {
    let result = files;
    if (filterOption !== 'all') {
      result = result.filter(f => f.mediaType === filterOption);
    }
    return sortMedia(result, sortOption);
  }, [files, filterOption, sortOption]);

  const folderTree = useMemo(() => buildFolderTree(processedFiles), [processedFiles]);

  const content = useMemo(() => {
    if (viewMode === 'all') {
      return { type: 'media', data: processedFiles, title: 'Library' };
    }
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
    const subfolders = Object.values(targetNode.children).sort((a, b) => a.name.localeCompare(b.name));
    const media = processedFiles.filter(f => f.folderPath === currentPath);
    return { type: 'mixed', folders: subfolders, photos: media, title: title };
  }, [viewMode, currentPath, processedFiles, folderTree]);

  // Cleanup
  useEffect(() => {
    return () => {
      // Only revoke Blob URLs (local uploads), not server URLs
      Object.values(allUserData).forEach(userData => {
          userData.files.forEach(f => {
              if (f.file && f.url && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
          });
      });
    };
  }, []);

  const getLightboxList = () => viewMode === 'all' ? processedFiles : (content.photos || []);
  const handleNext = () => {
      if (!selectedItem) return;
      const list = getLightboxList();
      const idx = list.findIndex(p => p.id === selectedItem.id);
      if (idx !== -1 && idx < list.length - 1) setSelectedItem(list[idx + 1]);
  };
  const handlePrev = () => {
      if (!selectedItem) return;
      const list = getLightboxList();
      const idx = list.findIndex(p => p.id === selectedItem.id);
      if (idx > 0) setSelectedItem(list[idx - 1]);
  };


  // --- RENDER ---
  if (authStep === 'loading') return <div className="h-screen flex items-center justify-center text-gray-400">Loading {isServerMode ? 'Server Data' : 'Database'}...</div>;

  // Setup Screen
  if (authStep === 'setup') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
          <h1 className="text-3xl font-bold text-primary-600 mb-2 text-center">Welcome</h1>
          <p className="text-gray-500 mb-8 text-center">{isServerMode ? 'Initialize your NAS Gallery.' : 'Set up your admin account.'}</p>
          <form onSubmit={handleSetup} className="space-y-4">
            <input type="text" placeholder="Username" value={setupForm.username} onChange={e => setSetupForm({...setupForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Password" value={setupForm.password} onChange={e => setSetupForm({...setupForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Confirm Password" value={setupForm.confirmPassword} onChange={e => setSetupForm({...setupForm, confirmPassword: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700">Create Admin</button>
          </form>
          
          {!isServerMode && (
             <div className="mt-8 pt-6 border-t border-gray-100">
                <p className="text-xs text-gray-400 text-center mb-2">Already have a {CONFIG_FILE_NAME}?</p>
                <label className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg cursor-pointer transition-colors text-sm font-medium">
                    <Icons.Upload size={16} />
                    <span>Import Database File</span>
                    <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
                </label>
             </div>
          )}
        </div>
      </div>
    );
  }

  // Login Screen
  if (authStep === 'login') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
           <div className="flex justify-center mb-6">
             <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center"><Icons.User className="text-white" /></div>
           </div>
          <h1 className="text-2xl font-bold text-gray-800 text-center mb-2">{appTitle}</h1>
          {isServerMode && <p className="text-xs text-center text-primary-600 bg-primary-50 py-1 rounded mb-6">NAS Server Connected</p>}
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700">Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white">
      <Navigation 
        appTitle={appTitle}
        viewMode={viewMode}
        setViewMode={handleSetViewMode}
        onUpload={handleFileUpload}
        isSidebarOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        totalPhotos={files.length}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 mt-16 md:mt-0 flex items-center justify-between px-6 border-b border-gray-50 bg-white/80 backdrop-blur-sm z-20 shrink-0">
          <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
            {viewMode === 'folders' ? (
                <div className="flex items-center gap-1 text-sm text-gray-600 overflow-hidden whitespace-nowrap mask-linear-fade">
                    <button 
                        onClick={() => setCurrentPath('')} 
                        className={`hover:bg-gray-100 px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${currentPath === '' ? 'font-bold text-gray-900 bg-gray-50' : ''}`}
                    >
                        <Icons.Folder size={16} className={currentPath === '' ? 'text-primary-600' : 'text-gray-400'} />
                        Root
                    </button>
                    {currentPath && currentPath.split('/').map((part, index, arr) => {
                        const path = arr.slice(0, index + 1).join('/');
                        return (
                            <React.Fragment key={path}>
                                <Icons.ChevronRight size={12} className="text-gray-300" />
                                <button 
                                    onClick={() => setCurrentPath(path)}
                                    className={`hover:bg-gray-100 px-2 py-1 rounded-md transition-colors truncate max-w-[150px] ${index === arr.length - 1 ? 'font-bold text-gray-900 bg-gray-50' : ''}`}
                                >
                                    {part}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <Icons.Image size={20} className="text-primary-600" />
                    <h1 className="text-xl font-bold text-gray-800 truncate">Library</h1>
                    <span className="text-xs text-gray-400 font-normal bg-gray-100 px-2 py-1 rounded-full">{files.length} items</span>
                </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative group z-30">
                <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full flex items-center gap-1">
                    <Icons.Filter size={18} />
                    <Icons.Sort size={14} />
                </button>
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 p-2 hidden group-focus-within:block group-hover:block z-50">
                    <p className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Sort & Filter</p>
                    <button onClick={() => setSortOption('dateDesc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${sortOption === 'dateDesc' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Newest First {sortOption === 'dateDesc' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setSortOption('dateAsc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${sortOption === 'dateAsc' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Oldest First {sortOption === 'dateAsc' && <Icons.Check size={14} />}</button>
                    <div className="my-1 border-t border-gray-100" />
                    <button onClick={() => setFilterOption('all')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${filterOption === 'all' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>All Types {filterOption === 'all' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setFilterOption('video')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${filterOption === 'video' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Videos Only {filterOption === 'video' && <Icons.Check size={14} />}</button>
                </div>
            </div>

             <button onClick={() => setIsSettingsOpen(true)} className="p-2 ml-2 text-gray-500 hover:bg-gray-100 rounded-full">
                <Icons.Settings size={20} />
             </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 no-scrollbar bg-gray-50/50">
          {files.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 text-indigo-400">
                <Icons.Upload size={40} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome, {currentUser?.username}</h2>
              <p className="text-gray-500 max-w-md mb-8">
                {isServerMode 
                 ? "Connected to NAS. Click below to scan your mapped media volume." 
                 : "Your gallery is empty. Import local folders to begin."}
              </p>
              
              <div className="space-y-4">
                  {isServerMode ? (
                      <button 
                        onClick={() => currentUser && syncServerFiles(currentUser.username)}
                        disabled={isSyncing}
                        className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg hover:shadow-xl hover:bg-primary-700 transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                         <Icons.Refresh size={20} className={isSyncing ? "animate-spin" : ""} />
                         <span>{isSyncing ? "Scanning NAS..." : "Scan NAS Library"}</span>
                      </button>
                  ) : (
                    <label className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg hover:shadow-xl hover:bg-primary-700 transition-all cursor-pointer flex items-center justify-center gap-2">
                        <Icons.Upload size={20} />
                        <span>Import Local Folder</span>
                        <input type="file" multiple webkitdirectory="true" directory="" onChange={handleFileUpload} className="hidden" />
                    </label>
                  )}
              </div>
            </div>
          )}

          {files.length > 0 && (
             <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                {(viewMode === 'folders' && content.folders && content.folders.length > 0) && (
                    <div className="mb-10">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Icons.Folder size={14} />
                        {currentPath ? 'Subfolders' : 'Folders'}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {content.folders.map((folder) => (
                        <FolderCard 
                            key={folder.path} 
                            folder={folder} 
                            onClick={(path) => setCurrentPath(path)} 
                        />
                        ))}
                    </div>
                    </div>
                )}

                {(content.data || (content.photos && content.photos.length > 0)) ? (
                    <div>
                        <motion.div 
                        layout
                        className={folderViewLayout === 'masonry' ? 'columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4' : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'}
                        >
                            {(content.data || content.photos || []).map((item) => (
                            <div key={item.id} className="break-inside-avoid">
                                <MediaCard 
                                    item={item} 
                                    onClick={setSelectedItem} 
                                    layout={folderViewLayout} 
                                />
                            </div>
                            ))}
                        </motion.div>
                    </div>
                ) : null}
             </div>
          )}
        </div>
      </main>

      <ImageViewer 
        item={selectedItem} 
        onClose={() => setSelectedItem(null)} 
        onNext={handleNext} 
        onPrev={handlePrev}
      />

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
            <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setIsSettingsOpen(false)}
            >
                <motion.div 
                    initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
                    className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h2 className="font-bold text-xl text-gray-800">Settings</h2>
                        <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-gray-200 rounded-full"><Icons.Close size={20}/></button>
                    </div>
                    
                    <div className="p-6 overflow-y-auto space-y-8 flex-1">
                        
                        {currentUser?.isAdmin && (
                            <>
                            <section className="pb-6 border-b border-gray-100">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4"><Icons.Settings size={18} /> General</h3>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Website Title</label>
                                    <input 
                                        type="text"
                                        value={appTitle} 
                                        onChange={(e) => handleUpdateTitle(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white border-gray-200"
                                    />
                                </div>
                            </section>

                            <section className="pb-6 border-b border-gray-100">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4"><Icons.FileJson size={18} /> Storage & Database</h3>
                                {isServerMode ? (
                                    <div className="bg-green-50 p-4 rounded-xl border border-green-100 space-y-3">
                                        <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
                                            <Icons.Check size={16} /> Server Persistence Active
                                        </div>
                                        <p className="text-sm text-green-700">
                                            Your configuration and user data are automatically saved to the <code>{CONFIG_FILE_NAME}</code> on the NAS.
                                        </p>
                                        <button 
                                            onClick={() => currentUser && syncServerFiles(currentUser.username)} 
                                            disabled={isSyncing}
                                            className="w-full py-2 bg-white border border-green-200 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 flex items-center justify-center gap-2"
                                        >
                                            <Icons.Refresh size={14} className={isSyncing ? 'animate-spin' : ''} />
                                            {isSyncing ? 'Scanning...' : 'Rescan NAS Media Library'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100">
                                        <p className="text-sm text-yellow-800 font-medium mb-2">Running in Client Mode</p>
                                        <p className="text-xs text-yellow-700 mb-3">Deploy via Docker to enable NAS persistence.</p>
                                        <button onClick={handleExportConfig} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-yellow-200 text-yellow-800 rounded-lg text-xs font-medium">
                                            <Icons.Download size={12} /> Backup Config
                                        </button>
                                    </div>
                                )}
                            </section>
                            </>
                        )}

                        {currentUser?.isAdmin && (
                            <section className="pt-6 border-t border-gray-100">
                                <div className="flex justify-between items-center mb-4">
                                     <h3 className="font-bold text-gray-800 flex items-center gap-2"><Icons.User size={18} /> Users</h3>
                                     <button onClick={() => setIsUserPanelOpen(!isUserPanelOpen)} className="text-xs font-medium text-primary-600 hover:underline">{isUserPanelOpen ? 'Hide' : 'Manage'}</button>
                                </div>
                                {isUserPanelOpen && (
                                    <div className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-100">
                                        <div className="space-y-2">
                                            {users.map(u => (
                                                <div key={u.username} className="flex justify-between items-center text-sm p-3 bg-white rounded-lg border border-gray-100">
                                                    <span className="font-medium flex items-center gap-2">{u.username} {u.isAdmin && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-bold">ADMIN</span>}</span>
                                                    <div className="text-xs flex gap-2">
                                                        <span className="text-gray-400">Pass: {u.password}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <form onSubmit={handleAddUser} className="flex gap-2 items-end pt-2">
                                            <input placeholder="Username" value={newUserForm.username} onChange={e => setNewUserForm({...newUserForm, username: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
                                            <input type="password" placeholder="Pass" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
                                            <button type="submit" className="bg-gray-900 text-white p-2 rounded-lg"><Icons.Plus size={18}/></button>
                                        </form>
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                    
                    <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                         <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 px-4 py-2 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium">
                            <Icons.LogOut size={16} /> Sign Out
                         </button>
                         <button onClick={() => setIsSettingsOpen(false)} className="px-6 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">Done</button>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}