import "./global.css";
import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, FlatList, ActivityIndicator, BackHandler, Text, TouchableOpacity, ScrollView, Platform, LayoutAnimation, UIManager, RefreshControl, Alert } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PaperProvider } from 'react-native-paper';
import { MediaCard } from './components/MediaCard';
import { FolderCard } from './components/FolderCard';
import { Carousel } from './components/Carousel';
import { BottomTabs, Tab } from './components/BottomTabs';
import { SettingsScreen } from './components/SettingsScreen';
import { LoginScreen } from './components/LoginScreen';
import { fetchFolders, fetchFiles, initApi, logout, onLogout } from './utils/api';
import { MediaItem } from './types';
import { MediaViewer } from './components/MediaViewer';
import { ThemeProvider, useTheme } from './utils/ThemeContext';
import { Header } from './components/Header';
import * as Haptics from 'expo-haptics';
import { useLanguage, initLanguage } from './utils/i18n';

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

import { GestureHandlerRootView } from 'react-native-gesture-handler';

const MainScreen = () => {
  const insets = useSafeAreaInsets();
  const { mode, isDark, paperTheme } = useTheme();
  const { t } = useLanguage();

  // Auth State
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('home');

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
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Media Viewer State
  const [viewerContext, setViewerContext] = useState<{ items: MediaItem[], index: number } | null>(null);

  // Initial Load
  useEffect(() => {
    const init = async () => {
      await initLanguage();
      const { token, username } = await initApi();
      if (token) {
        setIsLoggedIn(true);
        setUsername(username || 'User');
        loadHomeData();
      }
      setCheckingAuth(false);
    };
    init();

    // Register Auto-Logout Callback
    onLogout(() => {
      Alert.alert(
        "Session Expired",
        "Your login session has expired. Please login again."
      );
      handleLogout();
    });
  }, []);

  // Load Data when tab changes
  useEffect(() => {
    if (!isLoggedIn) return;

    if (activeTab === 'library' && libraryFiles.length === 0) loadLibraryData(0);
    if (activeTab === 'folders' && folders.length === 0 && !currentPath) loadFolderData(null);
    if (activeTab === 'favorites') loadFavoritesData();
  }, [activeTab, isLoggedIn]);

  // Load Folder Data when path changes
  useEffect(() => {
    if (isLoggedIn && activeTab === 'folders') {
      loadFolderData(currentPath);
    }
  }, [currentPath, isLoggedIn]);

  const handleApiError = (e: any) => {
    console.error(e);
    if (e.message === 'Unauthorized' || e.message?.includes('401')) {
      handleLogout();
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsLoggedIn(false);
    // Reset states
    setActiveTab('home');
    setRecentMedia([]);
    setFolders([]);
    setLibraryFiles([]);
    setFavoriteFiles([]);
  };

  const loadHomeData = async () => {
    setLoading(true);
    try {
      const filesRes = await fetchFiles(undefined, 0, 5);
      setRecentMedia(filesRes.files || []);
    } catch (e) { handleApiError(e); } finally { setLoading(false); setRefreshing(false); }
  };

  const loadLibraryData = async (offset: number, append = false) => {
    if (offset === 0 && !append) setLoading(true);
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
          const uniqueNew = newFiles.filter((i: MediaItem) => !existingIds.has(i.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setLibraryFiles(newFiles);
      }
      setLibraryOffset(offset);

    } catch (e) { handleApiError(e); } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  const loadFavoritesData = async () => {
    setLoading(true);
    try {
      console.log('Loading favorites...');
      const filesRes = await fetchFiles(undefined, 0, 100, true);
      console.log('Favorites response:', JSON.stringify(filesRes));
      if (!filesRes || !filesRes.files) {
        console.error('Favorites response missing files array');
        Alert.alert('Debug', `Invalid Favorites Response: ${JSON.stringify(filesRes)}`);
      }
      setFavoriteFiles(filesRes.files || []);
    } catch (e) {
      console.error('Load Favorites Error:', e);
      Alert.alert('Error', 'Failed to load favorites. Check console.');
      handleApiError(e);
    } finally { setLoading(false); setRefreshing(false); }
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
    } catch (e) { handleApiError(e); } finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeTab === 'home') loadHomeData();
    if (activeTab === 'library') loadLibraryData(0);
    if (activeTab === 'favorites') loadFavoritesData();
    if (activeTab === 'folders') loadFolderData(currentPath);
  }, [activeTab, currentPath]);

  const handleFolderPress = (folder: Folder) => {
    Haptics.selectionAsync();
    setHistory(prev => currentPath ? [...prev, currentPath] : [...prev, 'root']);
    setCurrentPath(folder.path);
  };

  const handleBack = () => {
    Haptics.selectionAsync();
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
    Haptics.selectionAsync();
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
      <View className="flex-1 bg-white dark:bg-black items-center justify-center">
        <ActivityIndicator size="large" color={isDark ? "#fff" : "#000"} />
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
          // Refresh favorites if needed when returning
          if (activeTab === 'favorites') loadFavoritesData();
        }}
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
          <View className="flex-1">
            <Header title={t('header.discover')} subtitle={t('header.discover.sub')} />
            <ScrollView
              className="flex-1 bg-gray-50/50 dark:bg-black"
              contentContainerStyle={{ paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
              <View className="mb-6 pt-6">
                <Carousel data={recentMedia} onPress={(i: MediaItem) => handleMediaPress(i, recentMedia)} />
              </View>

              <View className="px-6">
                <Text className="text-xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">{t('section.just_added')}</Text>
                <View className="flex-row flex-wrap justify-between">
                  {recentMedia.slice(0, 6).map(item => (
                    <View key={item.id} className="w-[32%] mb-1">
                      <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, recentMedia)} />
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {activeTab === 'library' && (
          <View className="flex-1">
            <Header title={t('header.library')} subtitle={t('header.library.sub')} />
            <FlatList
              data={libraryFiles}
              keyExtractor={item => item.id}
              numColumns={3}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
              contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              onEndReached={() => {
                if (hasMoreLibrary && !loadingMore && !loading) {
                  loadLibraryData(libraryOffset + 50, true);
                }
              }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" color={isDark ? "#fff" : "#000"} /> : null}
              renderItem={({ item }) => (
                <View className="w-[32%] mb-2">
                  <MediaCard item={item} onPress={(i: MediaItem) => handleMediaPress(i, libraryFiles)} />
                </View>
              )}
            />
          </View>
        )}

        {activeTab === 'favorites' && (
          <View className="flex-1">
            <Header title={t('header.favorites')} subtitle={t('header.favorites.sub')} />
            <FlatList
              data={favoriteFiles}
              keyExtractor={item => item.id}
              numColumns={3}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
              contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
          </View>
        )}

        {activeTab === 'folders' && (
          <View className="flex-1">
            <Header
              title={currentPath ? (currentPath.split(/[/\\]/).pop() || 'Folders') : 'Folders'}
              subtitle={currentPath ? 'Browse Directory' : 'Browse your collection'}
              showBack={!!currentPath}
              onBack={handleBack}
            />

            <FlatList
              data={folderFiles}
              keyExtractor={item => item.id}
              numColumns={3}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              ListHeaderComponent={
                <View>
                  {/* BreadCrumb removed, handled by Header */}

                  {folders.length > 0 && (
                    <View className="mb-4 pt-4">
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
          </View>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <SettingsScreen onLogout={handleLogout} username={username || 'Guest'} />
        )}

      </Animated.View>
    );
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: isDark ? '#000000' : '#ffffff' }} className="bg-white dark:bg-black">
      <StatusBar style={isDark ? "light" : "dark"} />
      <View className="flex-1 bg-white dark:bg-black relative">
        {loading && !refreshing && (
          /* Non-intrusive loading - mostly for initial or transition, not refresh */
          <View className="absolute top-0 left-0 right-0 z-50 items-center pt-2">
            <View className="bg-white/90 dark:bg-gray-800/90 px-4 py-2 rounded-full shadow-sm border border-gray-100 dark:border-gray-700 flex-row gap-2">
              <ActivityIndicator size="small" color={isDark ? "#fff" : "#000"} />
              <Text className="text-xs font-medium text-gray-500 dark:text-gray-400">Updating...</Text>
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <MainScreen />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

