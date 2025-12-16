import "./global.css";
import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, FlatList, ActivityIndicator, BackHandler, Text, TouchableOpacity, ScrollView, Platform, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PaperProvider, MD3LightTheme, IconButton } from 'react-native-paper'; // MD3
import { MediaCard } from './components/MediaCard';
import { FolderCard } from './components/FolderCard';
import { Carousel } from './components/Carousel';
import { BottomTabs, Tab } from './components/BottomTabs';
import { SettingsScreen } from './components/SettingsScreen';
import { LoginScreen } from './components/LoginScreen';
import { fetchFolders, fetchFiles, initApi } from './utils/api';
import { MediaItem } from './types';
import { MediaViewer } from './components/MediaViewer';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Types
interface Folder {
  name: string;
  path: string;
  mediaCount: number;
}

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#000000',
    secondaryContainer: '#f0f0f0',
  },
};

const MainScreen = () => {
  const insets = useSafeAreaInsets();

  // Auth State
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('home');
  // showSettings removed in favor of Tab

  // Data State
  const [recentMedia, setRecentMedia] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Library State
  const [libraryFiles, setLibraryFiles] = useState<MediaItem[]>([]);
  const [libraryOffset, setLibraryOffset] = useState(0);
  const [hasMoreLibrary, setHasMoreLibrary] = useState(true);

  // Favorites
  const [favoriteFiles, setFavoriteFiles] = useState<MediaItem[]>([]);

  // Navigation State (Folders Tab)
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<MediaItem[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false); // Pagination

  // Media Viewer State
  const [viewerContext, setViewerContext] = useState<{ items: MediaItem[], index: number } | null>(null);

  // Initial Load (Home Data & API URL & Auth)
  useEffect(() => {
    const init = async () => {
      const { token } = await initApi();
      if (token) {
        setIsLoggedIn(true);
        loadHomeData();
      }
      setCheckingAuth(false);
    };
    init();
  }, []);

  // Load Data when tab changes
  useEffect(() => {
    if (!isLoggedIn) return; // Don't fetch if not logged in

    if (activeTab === 'library' && libraryFiles.length === 0) {
      loadLibraryData(0);
    }
    if (activeTab === 'folders' && folders.length === 0 && !currentPath) {
      loadFolderData(null);
    }
    if (activeTab === 'favorites') {
      loadFavoritesData();
    }
  }, [activeTab, isLoggedIn]);

  // Load Folder Data when path changes
  useEffect(() => {
    if (isLoggedIn && activeTab === 'folders') {
      loadFolderData(currentPath);
    }
  }, [currentPath, isLoggedIn]);

  // Handle Unauthorized (401)
  const handleApiError = (e: any) => {
    console.error(e);
    if (e.message === 'Unauthorized' || e.message?.includes('401')) {
      setIsLoggedIn(false);
      // initApi will clean storage if we implement logout properly, need to manually clear state
    }
  };

  const loadHomeData = async () => {
    setLoading(true);
    try {
      const filesRes = await fetchFiles(undefined, 0, 5);
      setRecentMedia(filesRes.files || []);
    } catch (e) { handleApiError(e); } finally { setLoading(false); }
  };

  const loadLibraryData = async (offset: number, append = false) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);

    try {
      const limit = 50;
      const filesRes = await fetchFiles(undefined, offset, limit);
      const newFiles = filesRes.files || [];

      if (newFiles.length < limit) setHasMoreLibrary(false);
      else setHasMoreLibrary(true);

      if (append) {
        setLibraryFiles(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = newFiles.filter(i => !existingIds.has(i.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setLibraryFiles(newFiles);
      }
      setLibraryOffset(offset);

    } catch (e) { handleApiError(e); } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadFavoritesData = async () => {
    setLoading(true);
    try {
      // Fetch files with FAVORITES=true param
      const filesRes = await fetchFiles(undefined, 0, 100, true);
      setFavoriteFiles(filesRes.files || []);
    } catch (e) { handleApiError(e); } finally { setLoading(false); }
  };

  const loadFolderData = async (path: string | null) => {
    setLoading(true);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    try {
      const queryPath = path === 'root' ? undefined : (path || undefined);
      const [foldersRes, filesRes] = await Promise.all([
        fetchFolders(queryPath),
        queryPath ? fetchFiles(queryPath) : Promise.resolve({ files: [] })
      ]);
      setFolders(foldersRes.folders || []);
      setFolderFiles(filesRes.files || []);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFolderPress = (folder: Folder) => {
    setHistory(prev => currentPath ? [...prev, currentPath] : [...prev, 'root']);
    setCurrentPath(folder.path);
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      setCurrentPath(prev === 'root' ? null : prev);
    } else {
      setCurrentPath(null);
    }
  };

  const handleMediaPress = (item: MediaItem, list: MediaItem[]) => {
    const index = list.findIndex(i => i.id === item.id);
    setViewerContext({ items: list, index: index !== -1 ? index : 0 });
  };

  // Back Button Handling
  useEffect(() => {
    const onBackPress = () => {
      if (viewerContext) {
        setViewerContext(null);
        if (activeTab === 'favorites') loadFavoritesData();
        return true;
      }
      if (activeTab === 'folders' && currentPath) {
        handleBack();
        return true;
      }
      if (activeTab === 'settings') {
        setActiveTab('home');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [viewerContext, activeTab, currentPath, history]);


  if (checkingAuth) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <LoginScreen onLoginSuccess={() => {
        setIsLoggedIn(true);
        loadHomeData();
      }} />
    );
  }

  if (viewerContext) {
    return (
      <MediaViewer
        items={viewerContext.items}
        initialIndex={viewerContext.index}
        onClose={() => {
          setViewerContext(null);
          if (activeTab === 'favorites') loadFavoritesData();
        }}
      // Pass auth token if context requires it? 
      // MediaViewer uses <Image> which needs headers.
      // We might need to pass token to MediaViewer.
      />
    );
  }

  const renderContent = () => {
    return (
      <Animated.View
        key={activeTab}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        className="flex-1"
      >
        {activeTab === 'home' && (
          <ScrollView className="flex-1 bg-gray-50/50" contentContainerStyle={{ paddingBottom: 100 }}>
            {/* Standardized Header */}
            <View className="pt-6 pb-4 px-6 bg-white border-b border-gray-100">
              <Text className="text-3xl font-bold text-gray-900 tracking-tighter">Discover</Text>
              <Text className="text-gray-500 font-medium">Your recent memories</Text>
            </View>

            <View className="mb-6 pt-6">
              <Carousel data={recentMedia} onPress={(i: MediaItem) => handleMediaPress(i, recentMedia)} />
            </View>

            <View className="px-6">
              <Text className="text-xl font-bold text-gray-900 mb-4 tracking-tight">Just Added</Text>
              <View className="flex-row flex-wrap gap-1">
                {recentMedia.slice(0, 6).map(item => (
                  <View key={item.id} className="w-[32%] mb-1">
                    <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, recentMedia)} />
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        )}

        {activeTab === 'library' && (
          <FlatList
            data={libraryFiles}
            keyExtractor={item => item.id}
            numColumns={3}
            columnWrapperStyle={{ justifyContent: 'space-between' }}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            ListHeaderComponent={
              <View className="pt-6 pb-4 px-2">
                <Text className="text-3xl font-bold text-gray-900 tracking-tighter">Library</Text>
                <Text className="text-gray-500 font-medium">All photos and videos</Text>
              </View>
            }
            onEndReached={() => {
              if (hasMoreLibrary && !loadingMore && !loading) {
                loadLibraryData(libraryOffset + 50, true);
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" /> : null}
            renderItem={({ item }) => (
              <View className="w-[32%] mb-2">
                <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, libraryFiles)} />
              </View>
            )}
          />
        )}

        {activeTab === 'favorites' && (
          <FlatList
            data={favoriteFiles}
            keyExtractor={item => item.id}
            numColumns={3}
            columnWrapperStyle={{ justifyContent: 'space-between' }}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            ListHeaderComponent={
              <View className="pt-6 pb-4 px-2">
                <Text className="text-3xl font-bold text-gray-900 tracking-tighter">Favorites</Text>
                <Text className="text-gray-500 font-medium">Your collected moments</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View className="w-[32%] mb-2">
                <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, favoriteFiles)} />
              </View>
            )}
            ListEmptyComponent={
              (!loading) ? (
                <View className="p-20 items-center justify-center opacity-50">
                  <Text className="text-gray-400 font-medium">No Favorites Yet</Text>
                </View>
              ) : null
            }
          />
        )}

        {activeTab === 'folders' && (
          <FlatList
            data={folderFiles}
            keyExtractor={item => item.id}
            numColumns={3}
            columnWrapperStyle={{ justifyContent: 'space-between' }}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            ListHeaderComponent={
              <View>
                {/* Interactive BreadCrumb */}
                {currentPath ? (
                  <TouchableOpacity onPress={handleBack} className="mb-6 flex-row items-center bg-gray-100 self-start px-3 py-1.5 rounded-full active:bg-gray-200">
                    <Text className="text-gray-600 font-medium text-xs">← Back</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="mb-6">
                    <Text className="text-3xl font-bold text-gray-900 tracking-tighter">Folders</Text>
                    <Text className="text-gray-500 font-medium">Browse your collection</Text>
                  </View>
                )}

                {folders.length > 0 && (
                  <View className="mb-4">
                    {!currentPath && <Text className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-widest">Directories</Text>}
                    <View className="flex-row flex-wrap justify-between">
                      {folders.map(folder => (
                        <View key={folder.path} className="w-[48%] mb-4">
                          <FolderCard name={folder.name} onPress={() => handleFolderPress(folder)} />
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {folderFiles.length > 0 && (
                  <Text className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-widest mt-2">
                    Media Files
                  </Text>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <View className="w-[32%] mb-2">
                <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, folderFiles)} />
              </View>
            )}
            ListEmptyComponent={
              (!loading && folders.length === 0) ? (
                <View className="p-20 items-center justify-center opacity-50">
                  <Text className="text-gray-400 font-medium">Empty Folder</Text>
                </View>
              ) : null
            }
          />
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <SettingsScreen />
        )}

      </Animated.View>
    );
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top }} className="bg-white">
      <StatusBar style="dark" />
      <View className="flex-1 bg-white relative">
        {loading && (
          <View className="absolute top-0 left-0 right-0 z-50 items-center pt-4">
            <View className="bg-white/90 px-4 py-2 rounded-full shadow-sm border border-gray-100 flex-row gap-2">
              <ActivityIndicator size="small" color="#000" />
              <Text className="text-xs font-medium text-gray-500">Updating...</Text>
            </View>
          </View>
        )}
        {renderContent()}
      </View>

      <BottomTabs activeTab={activeTab} onTabChange={setActiveTab} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <MainScreen />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
