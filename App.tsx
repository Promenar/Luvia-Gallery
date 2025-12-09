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
const SOURCES_STORAGE_KEY = 'lumina_sources'; // New key for persisting folder metadata

export default function App() {
  // --- Authentication State ---
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authStep, setAuthStep] = useState<'loading' | 'setup' | 'login' | 'app'>('loading');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [setupForm, setSetupForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [authError, setAuthError] = useState('');

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
  // This functions acts as the "Real-time Database Write" to the local environment.
  const persistData = (newUsers?: User[], newTitle?: string, newAllUserData?: Record<string, UserData>) => {
      const u = newUsers || users;
      const t = newTitle || appTitle;
      const d = newAllUserData || allUserData;

      // Save to React State
      if (newUsers) setUsers(newUsers);
      if (newTitle) setAppTitle(newTitle);
      if (newAllUserData) setAllUserData(newAllUserData);

      // Save to LocalStorage (The Browser DB)
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(u));
      localStorage.setItem(APP_TITLE_KEY, t);
      
      // We only save the sources metadata, not the full file objects (which can't be stringified)
      const sourcesPayload: Record<string, any[]> = {};
      Object.keys(d).forEach(k => {
          sourcesPayload[k] = d[k].sources;
      });
      localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(sourcesPayload));
  };

  // 1. Initial Load
  useEffect(() => {
    const initApp = async () => {
      let configLoaded = false;
      let hydratedData: Record<string, UserData> = {};

      // 1. Try to load from "Server" (Root directory file)
      try {
        const response = await fetch(`/${CONFIG_FILE_NAME}`);
        if (response.ok) {
          const config: AppConfig = await response.json();
          console.log("Loaded config from file:", config);
          if (config.users && config.users.length > 0) {
             setUsers(config.users);
             setAppTitle(config.title || 'Lumina Gallery');
             
             // Hydrate sources from JSON
             config.users.forEach(u => {
                 const sources = config.userSources?.[u.username] || [];
                 hydratedData[u.username] = {
                     sources: sources,
                     files: [] 
                 };
             });
             setAllUserData(hydratedData);
             setAuthStep('login');
             configLoaded = true;
          }
        }
      } catch (e) {
        console.log("No default config file found, falling back to local storage.");
      }

      // 2. Fallback to LocalStorage (Browser DB) if config file didn't fully initialize
      if (!configLoaded) {
          const storedUsers = localStorage.getItem(USERS_STORAGE_KEY);
          const storedTitle = localStorage.getItem(APP_TITLE_KEY);
          const storedSources = localStorage.getItem(SOURCES_STORAGE_KEY);

          if (storedUsers) {
            const parsedUsers = JSON.parse(storedUsers);
            setUsers(parsedUsers);
            setAuthStep('login');
            
            if (storedTitle) setAppTitle(storedTitle);

            // Hydrate sources from LocalStorage
            if (storedSources) {
                const parsedSources = JSON.parse(storedSources);
                Object.keys(parsedSources).forEach(username => {
                    hydratedData[username] = {
                        sources: parsedSources[username],
                        files: []
                    };
                });
                setAllUserData(hydratedData);
            } else {
                // Initialize empty buckets for existing users
                parsedUsers.forEach((u: User) => {
                    hydratedData[u.username] = { sources: [], files: [] };
                });
                setAllUserData(hydratedData);
            }
          } else {
            setAuthStep('setup');
          }
      }

      const savedViewMode = localStorage.getItem(VIEW_MODE_KEY) as ViewMode;
      if (savedViewMode) setViewMode(savedViewMode);
    };

    initApp();
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
    setCurrentPath(''); 
  };

  const handleUpdateTitle = (newTitle: string) => {
    // Real-time update
    persistData(undefined, newTitle, undefined);
  };

  // --- Configuration Management ---
  
  const handleExportConfig = () => {
      // Construct config object representing the "Database"
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
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const json = JSON.parse(e.target?.result as string) as AppConfig;
              if (json.users && json.title) {
                  // Restore User Data Sources
                  const hydratedData: Record<string, UserData> = {};
                  json.users.forEach(u => {
                      const sources = json.userSources?.[u.username] || [];
                      // Preserve existing files if username matches, otherwise reset files
                      const existingFiles = allUserData[u.username]?.files || [];
                      hydratedData[u.username] = {
                          sources: sources,
                          files: existingFiles 
                      };
                  });
                  
                  // Commit to DB (LocalStorage + State)
                  persistData(json.users, json.title, hydratedData);

                  alert("Configuration loaded & Database updated!");
                  if (authStep === 'loading' || authStep === 'setup') setAuthStep('login');
              } else {
                  alert("Invalid configuration file format.");
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
    if (!setupForm.username || !setupForm.password) {
      setAuthError("Please fill all fields");
      return;
    }

    const adminUser: User = {
      username: setupForm.username,
      password: setupForm.password,
      isAdmin: true
    };
    
    const newUsers = [adminUser];
    const newUserData = { [adminUser.username]: { files: [], sources: [] } };
    
    // Commit to DB
    persistData(newUsers, undefined, newUserData);
    
    setCurrentUser(adminUser);
    setAuthStep('app');
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
    if (user) {
      setCurrentUser(user);
      if (!allUserData[user.username]) {
          // Initialize user data bucket if missing
          const newData = { ...allUserData, [user.username]: { files: [], sources: [] } };
          persistData(undefined, undefined, newData);
      }
      setAuthStep('app');
      setAuthError('');
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

  // 3. Admin: Add User
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

    // Commit to DB
    persistData(updatedUsers, undefined, updatedUserData);

    setNewUserForm({ username: '', password: '' });
  };

  // 4. File Handling
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      
      // Commit Metadata to DB (Files themselves stay in memory)
      persistData(undefined, undefined, updatedUserData);
      
      setIsSettingsOpen(false);
    }
  };

  const handleRemoveSource = (id: string) => {
    if (!currentUser) return;

    // Cleanup URLs
    const filesToRemove = files.filter(f => f.sourceId === id);
    filesToRemove.forEach(f => URL.revokeObjectURL(f.url));

    const updatedUserData = {
        ...allUserData,
        [currentUser.username]: {
            files: allUserData[currentUser.username].files.filter(f => f.sourceId !== id),
            sources: allUserData[currentUser.username].sources.filter(s => s.id !== id)
        }
    };

    // Commit to DB
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
    
    return { 
      type: 'mixed', 
      folders: subfolders, 
      photos: media,
      title: title 
    };

  }, [viewMode, currentPath, processedFiles, folderTree]);

  // Cleanup
  useEffect(() => {
    return () => {
      Object.values(allUserData).forEach(userData => {
          userData.files.forEach(f => {
              if (f.url) URL.revokeObjectURL(f.url);
          });
      });
    };
  }, []);

  // Lightbox Helpers
  const getLightboxList = () => {
      if (viewMode === 'all') return processedFiles;
      return content.photos || [];
  };
  
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

  if (authStep === 'loading') return <div className="h-screen flex items-center justify-center text-gray-400">Loading Database...</div>;

  if (authStep === 'setup') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
          <h1 className="text-3xl font-bold text-primary-600 mb-2 text-center">Welcome</h1>
          <p className="text-gray-500 mb-8 text-center">Set up your admin account to start.</p>
          <form onSubmit={handleSetup} className="space-y-4">
            <input type="text" placeholder="Username" value={setupForm.username} onChange={e => setSetupForm({...setupForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Password" value={setupForm.password} onChange={e => setSetupForm({...setupForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Confirm Password" value={setupForm.confirmPassword} onChange={e => setSetupForm({...setupForm, confirmPassword: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700">Create Admin</button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-gray-100">
             <p className="text-xs text-gray-400 text-center mb-2">Already have a {CONFIG_FILE_NAME}?</p>
             <label className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg cursor-pointer transition-colors text-sm font-medium">
                <Icons.Upload size={16} />
                <span>Import Database File</span>
                <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
             </label>
          </div>
        </div>
      </div>
    );
  }

  if (authStep === 'login') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
           <div className="flex justify-center mb-6">
             <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center"><Icons.User className="text-white" /></div>
           </div>
          <h1 className="text-2xl font-bold text-gray-800 text-center mb-8">{appTitle}</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            <input type="password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
            {authError && <p className="text-red-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="w-full bg-primary-600 text-white py-2 rounded-lg font-semibold hover:bg-primary-700">Sign In</button>
          </form>
          {/* Removed Import Config from Login for Security */}
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
                    <p className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Sort By</p>
                    <button onClick={() => setSortOption('dateDesc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${sortOption === 'dateDesc' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Date (Newest) {sortOption === 'dateDesc' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setSortOption('dateAsc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${sortOption === 'dateAsc' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Date (Oldest) {sortOption === 'dateAsc' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setSortOption('nameAsc')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${sortOption === 'nameAsc' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Name (A-Z) {sortOption === 'nameAsc' && <Icons.Check size={14} />}</button>
                    
                    <div className="my-1 border-t border-gray-100" />
                    <p className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Filter</p>
                    <button onClick={() => setFilterOption('all')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${filterOption === 'all' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>All Types {filterOption === 'all' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setFilterOption('image')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${filterOption === 'image' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Images Only {filterOption === 'image' && <Icons.Check size={14} />}</button>
                    <button onClick={() => setFilterOption('video')} className={`w-full text-left px-2 py-1.5 text-sm rounded-lg flex justify-between ${filterOption === 'video' ? 'bg-primary-50 text-primary-600' : 'hover:bg-gray-50'}`}>Videos Only {filterOption === 'video' && <Icons.Check size={14} />}</button>
                </div>
            </div>

             <div className="flex bg-gray-100 p-1 rounded-lg">
                <button onClick={() => setFolderViewLayout('grid')} className={`p-2 rounded-md transition-all ${folderViewLayout === 'grid' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}>
                    <Icons.Grid size={18} />
                </button>
                <button onClick={() => setFolderViewLayout('masonry')} className={`p-2 rounded-md transition-all ${folderViewLayout === 'masonry' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}>
                    <Icons.Masonry size={18} />
                </button>
             </div>

             <button onClick={() => setIsSettingsOpen(true)} className="p-2 ml-2 text-gray-500 hover:bg-gray-100 rounded-full">
                <Icons.Settings size={20} />
             </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 no-scrollbar bg-gray-50/50">
          
          {/* Empty State / Welcome */}
          {files.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 animate-in fade-in duration-700">
              <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 text-indigo-400">
                <Icons.Upload size={40} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome, {currentUser?.username}</h2>
              <p className="text-gray-500 max-w-md mb-8">
                {folderSources.length > 0 
                  ? "Your directory structure is loaded from the database. Due to browser security, please re-select your folders to view content." 
                  : "Your gallery is ready. Import local folders to begin organizing your photos and videos."}
              </p>
              
              <div className="space-y-4">
                  <label className="bg-primary-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg hover:shadow-xl hover:bg-primary-700 transition-all cursor-pointer flex items-center justify-center gap-2 transform hover:-translate-y-0.5">
                    <Icons.Upload size={20} />
                    <span>Import Folder</span>
                    <input type="file" multiple webkitdirectory="true" directory="" onChange={handleFileUpload} className="hidden" />
                  </label>
                  
                  {folderSources.length > 0 && (
                     <div className="text-xs text-orange-500 flex items-center gap-1 justify-center bg-orange-50 px-3 py-1 rounded-full">
                        <Icons.Alert size={12} />
                        <span>{folderSources.length} sources linked in Database (Require Re-auth)</span>
                     </div>
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
                        {(viewMode === 'folders' && content.photos) && (
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Icons.Image size={14} />
                                Files
                            </h3>
                        )}
                        
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
                ) : (
                    (viewMode === 'folders' && (!content.folders || content.folders.length === 0) && currentPath) && (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                             <Icons.Folder size={48} className="mb-4 opacity-20" />
                             <p>This folder is empty.</p>
                        </div>
                    )
                )}
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
                                <div className="flex justify-between items-center mb-4">
                                     <h3 className="font-bold text-gray-800 flex items-center gap-2"><Icons.Settings size={18} /> General Settings</h3>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Website Title</label>
                                     <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            value={appTitle} 
                                            onChange={(e) => handleUpdateTitle(e.target.value)}
                                            className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-white border-gray-200"
                                            placeholder="Enter website title"
                                        />
                                    </div>
                                </div>
                            </section>

                            <section className="pb-6 border-b border-gray-100">
                                <div className="flex justify-between items-center mb-4">
                                     <h3 className="font-bold text-gray-800 flex items-center gap-2"><Icons.FileJson size={18} /> Database Management</h3>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-xl mb-4 border border-blue-100">
                                    <h4 className="text-blue-800 font-semibold text-sm mb-1 flex items-center gap-2"><Icons.Refresh size={14} /> Real-time Sync Active</h4>
                                    <p className="text-sm text-blue-600">
                                        All changes (users, settings, directory structure) are automatically saved to your local database. 
                                        To persist these changes to the server, download the database file and overwrite <code>/{CONFIG_FILE_NAME}</code> in your application root.
                                    </p>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={handleExportConfig} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium text-sm shadow-md">
                                        <Icons.Download size={16} /> Download Database File
                                    </button>
                                    <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm cursor-pointer">
                                        <Icons.Upload size={16} /> Restore Database
                                        <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
                                    </label>
                                </div>
                            </section>
                            </>
                        )}

                        <section>
                             <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2"><Icons.Folder size={18} /> Active Folders</h3>
                             </div>
                             <div className="space-y-3">
                                {folderSources.length === 0 && <p className="text-sm text-gray-400 italic">No folders imported.</p>}
                                {folderSources.map(source => (
                                    <div key={source.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-orange-100 p-2 rounded-lg text-orange-600"><Icons.Folder size={20} /></div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-800">{source.name}</p>
                                                <p className="text-xs text-gray-500">{source.count} files</p>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemoveSource(source.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                            <Icons.Trash size={18} />
                                        </button>
                                    </div>
                                ))}
                                <label className="flex items-center justify-center gap-2 w-full p-4 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 cursor-pointer transition-all">
                                    <Icons.Plus size={20} />
                                    <span className="font-medium">Import another folder</span>
                                    <input type="file" multiple webkitdirectory="true" directory="" onChange={handleFileUpload} className="hidden" />
                                </label>
                             </div>
                        </section>

                        {currentUser?.isAdmin && (
                            <section className="pt-6 border-t border-gray-100">
                                <div className="flex justify-between items-center mb-4">
                                     <h3 className="font-bold text-gray-800 flex items-center gap-2"><Icons.User size={18} /> User Management</h3>
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
                                                        <span className="text-gray-300">|</span>
                                                        <span className="text-gray-500">{u.username === currentUser.username ? 'You' : 'User'}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <form onSubmit={handleAddUser} className="flex gap-2 items-end pt-2">
                                            <div className="flex-1">
                                                <input placeholder="New username" value={newUserForm.username} onChange={e => setNewUserForm({...newUserForm, username: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                                            </div>
                                            <div className="flex-1">
                                                <input type="password" placeholder="Password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none" />
                                            </div>
                                            <button type="submit" className="bg-gray-900 text-white p-2 rounded-lg hover:bg-black transition-colors"><Icons.Plus size={18}/></button>
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