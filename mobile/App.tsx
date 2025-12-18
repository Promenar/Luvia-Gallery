import "./global.css";
import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, FlatList, ActivityIndicator, BackHandler, Text, TouchableOpacity, ScrollView, Platform, LayoutAnimation, UIManager, RefreshControl, Alert, useWindowDimensions, DimensionValue } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PaperProvider } from 'react-native-paper';
import { MediaCard } from './components/MediaCard';
import { FolderCard } from './components/FolderCard';
import { Carousel } from './components/Carousel';
import { BottomTabs, Tab } from './components/BottomTabs';
import { SettingsScreen } from './components/SettingsScreen';
import { LoginScreen } from './components/LoginScreen';
import { ActionMenu } from './components/ActionMenu';
import { deleteFile, deleteFolder, fetchFolders, fetchFiles, initApi, logout, onLogout, toggleFavorite } from './utils/api';
import { MediaItem } from './types';
import { CarouselView } from './components/CarouselView';
import { ConfigProvider } from './utils/ConfigContext';
import { BiometricGate } from './components/BiometricGate';
import { MediaViewer } from './components/MediaViewer';
import { ThemeProvider, useTheme } from './utils/ThemeContext';
import { Header } from './components/Header';
import * as Haptics from 'expo-haptics';
import { useLanguage, initLanguage } from './utils/i18n';
import { AudioProvider, useAudio } from './utils/AudioContext';
import { MiniPlayer } from './components/MiniPlayer';
import { deleteFileFromCache, deleteFolderFromCache, getCachedFiles } from './utils/Database';


// Enable LayoutAnimation removed as it is now a no-op / handled by Reanimated

// Types
interface Folder {
  name: string;
  path: string;
  mediaCount: number;
  isFavorite?: boolean;
}

import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Helper for grid alignment
const formatGridData = (data: MediaItem[], numColumns: number) => {
  if (!data) return [];
  const totalRows = Math.floor(data.length / numColumns);
  let totalLastRow = data.length - (totalRows * numColumns);

  if (totalLastRow === 0) return data;

  const newData = [...data]; // Clone array
  while (totalLastRow !== numColumns && totalLastRow !== 0) {
    // @ts-ignore
    newData.push({ id: `blank-${totalLastRow}-${Date.now()}`, empty: true });
    totalLastRow++;
  }
  return newData;
};

const MainScreen = () => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { mode, isDark, paperTheme } = useTheme();
  const { t } = useLanguage();
  const { isMinimized, maximizePlayer, currentTrack, playlist, currentIndex } = useAudio();

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
  const [favoriteFolders, setFavoriteFolders] = useState<Folder[]>([]);
  const [favoriteOffset, setFavoriteOffset] = useState(0);
  const [hasMoreFavorites, setHasMoreFavorites] = useState(true);

  // Navigation State (Folders Tab)
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<MediaItem[]>([]);
  const [folderOffset, setFolderOffset] = useState(0);
  const [hasMoreFolderFiles, setHasMoreFolderFiles] = useState(true);
  const [history, setHistory] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Media Viewer State
  const [viewerContext, setViewerContext] = useState<{ items: MediaItem[], index: number } | null>(null);

  // Management State
  const [managedItem, setManagedItem] = useState<MediaItem | { type: 'folder', name: string, path: string } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  // 计算动态布局参数
  const { numColumns, folderColumns, cardWidth, folderCardWidth, recentWidth } = React.useMemo(() => {
    const padding = 24;
    const gap = 8;
    // 媒体项目：目标宽度 ~110px
    const cols = Math.max(3, Math.floor((windowWidth - padding + gap) / (110 + gap)));
    // 文件夹项目：目标宽度 ~160px
    const fCols = Math.max(2, Math.floor((windowWidth - padding + gap) / (160 + gap)));

    return {
      numColumns: cols,
      folderColumns: fCols,
      cardWidth: (windowWidth - padding - (cols - 1) * gap) / cols,
      folderCardWidth: (windowWidth - padding - (fCols - 1) * gap) / fCols,
      recentWidth: windowWidth > 600 ? 180 : 150
    };
  }, [windowWidth]);

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
        t('msg.session_expired'),
        t('msg.session_expired_desc')
      );
      handleLogout();
    });
  }, []);

  // Load Data when tab changes
  // Unified Data Loading Effect
  useEffect(() => {
    if (!isLoggedIn) return;

    if (activeTab === 'home') {
      if (recentMedia.length === 0) loadHomeData();
    } else if (activeTab === 'library') {
      if (libraryFiles.length === 0) loadLibraryData(0);
    } else if (activeTab === 'folders') {
      // For folders, we load on every path change or tab focus to ensure fresh view
      loadFolderData(currentPath, 0);
    } else if (activeTab === 'favorites') {
      if (favoriteFiles.length === 0) loadFavoritesData(0);
    }
  }, [activeTab, currentPath, isLoggedIn]);

  const handleApiError = (e: any) => {
    console.error(e);
    if (e.message === 'Unauthorized' || e.message?.includes('401')) {
      handleLogout();
    }
  };

  const handleLogout = async () => {
    await logout(true);
    setIsLoggedIn(false);
    // Reset states
    setActiveTab('home');
    setRecentMedia([]);
    setFolders([]);
    setLibraryFiles([]);
    setFavoriteFiles([]);
    setFavoriteFolders([]);
  };

  const loadHomeData = async (refresh = false) => {
    // 1. 尝试立即获取本地缓存以快速显示
    try {
      if (!refresh) {
        const cached = await getCachedFiles({ limit: 10 });
        if (cached.length > 0) {
          setRecentMedia(cached);
        }
      }
    } catch (e) {
      console.warn('Cache load ignored for home', e);
    }

    setLoading(true);
    try {
      const filesRes = await fetchFiles({ limit: 10, excludeMediaType: 'audio', refresh });
      setRecentMedia(filesRes.files || []);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadLibraryData = async (offset: number, append = false, refresh = false) => {
    if (offset === 0 && !append) setLoading(true);
    else setLoadingMore(true);

    try {
      const limit = 100; // Increased limit for smoother scrolling
      const filesRes = await fetchFiles({ offset, limit, excludeMediaType: 'audio', refresh });
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

  const loadFavoritesData = async (offset: number, append = false, refresh = false) => {
    if (offset === 0 && !append) setLoading(true);
    else setLoadingMore(true);

    try {
      const limit = 50;
      console.log('Loading favorites...', { offset, append });

      const promises: any[] = [
        fetchFiles({ favorite: true, offset, limit, refresh })
      ];

      // Only fetch folders on first page
      if (offset === 0) {
        promises.push(fetchFolders(undefined, true));
      } else {
        promises.push(Promise.resolve(null));
      }

      const [filesRes, foldersRes] = await Promise.all(promises);

      if (foldersRes) {
        const foldersData: Folder[] = (foldersRes.folders || []).map((f: any) => ({
          name: f.name,
          path: f.path,
          mediaCount: f.mediaCount,
          isFavorite: true
        }));
        setFavoriteFolders(foldersData);
      }

      const newFiles = (filesRes.files || []).map((f: MediaItem) => ({ ...f, isFavorite: true }));

      if (newFiles.length < limit) setHasMoreFavorites(false);
      else setHasMoreFavorites(true);

      if (append) {
        setFavoriteFiles(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = newFiles.filter((i: MediaItem) => !existingIds.has(i.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setFavoriteFiles(newFiles);
      }
      setFavoriteOffset(offset);
    } catch (e) {
      console.error('Load Favorites Error:', e);
      handleApiError(e);
    } finally { setLoading(false); setLoadingMore(false); setRefreshing(false); }
  };

  const loadFolderData = async (path: string | null, offset: number, append = false, refresh = false) => {
    if (offset === 0 && !append) setLoading(true);
    else setLoadingMore(true);

    try {
      const limit = 50;
      const queryPath = path === 'root' ? undefined : (path || undefined);

      const promises: any[] = [
        queryPath ? fetchFiles({ folderPath: queryPath, offset, limit, refresh }) : Promise.resolve({ files: [] })
      ];

      // Only fetch subfolders on first page
      if (offset === 0) {
        promises.push(fetchFolders(queryPath));
      } else {
        promises.push(Promise.resolve(null));
      }

      const [filesRes, foldersRes] = await Promise.all(promises);

      if (foldersRes) {
        setFolders((foldersRes.folders || []).map((f: any) => ({
          name: f.name,
          path: f.path,
          mediaCount: f.mediaCount,
          isFavorite: f.isFavorite
        })));
      }

      const newFiles = filesRes.files || [];
      if (newFiles.length < limit) setHasMoreFolderFiles(false);
      else setHasMoreFolderFiles(true);

      if (append) {
        setFolderFiles(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNew = newFiles.filter((i: MediaItem) => !existingIds.has(i.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setFolderFiles(newFiles);
      }
      setFolderOffset(offset);
    } catch (e) { handleApiError(e); } finally { setLoading(false); setLoadingMore(false); setRefreshing(false); }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (activeTab === 'home') loadHomeData(true);
    if (activeTab === 'library') loadLibraryData(0, false, true);
    if (activeTab === 'favorites') loadFavoritesData(0, false, true);
    if (activeTab === 'folders') loadFolderData(currentPath, 0, false, true);
  }, [activeTab, currentPath]);

  const handleFolderPress = (folder: Folder) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (activeTab === 'folders') {
      // Drilling down: Append current path to history
      setHistory(prev => [...prev, currentPath || 'root']);
    } else {
      // Jumping from another tab: Reset history to ensure Back goes to Root
      setHistory(['root']);
    }

    setActiveTab('folders');
    setCurrentPath(folder.path);
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const index = list.findIndex(i => i.id === item.id);
    setViewerContext({ items: list, index: index !== -1 ? index : 0 });
  };

  const handleManagePress = (item: MediaItem | { type: 'folder', name: string, path: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setManagedItem(item);
    setIsMenuVisible(true);
  };

  const handleDelete = async () => {
    if (!managedItem) return;

    Alert.alert(
      t('msg.confirm_delete'),
      t('msg.confirm_delete_desc'),
      [
        { text: t('btn.cancel'), style: 'cancel' },
        {
          text: t('btn.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const item = managedItem as any;
              const isFolder = 'type' in item && item.type === 'folder';

              if (isFolder) {
                console.log('[App] Deleting folder:', item.path);
                await deleteFolder(item.path);
                await deleteFolderFromCache(item.path);
              } else {
                console.log('[App] Deleting file:', item.id, item.path);
                await deleteFile(item.path);
                await deleteFileFromCache(item.id);
              }

              setIsMenuVisible(false);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onRefresh(); // Refresh UI
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to delete');
            }
          }
        }
      ]
    );
  };

  const handleToggleFavoriteFromMenu = async () => {
    if (!managedItem) return;
    const item = managedItem as any;
    const isFolder = 'type' in item && item.type === 'folder';
    const isFavorite = isFolder ? false : item.isFavorite;

    await toggleFavorite(item.id || item.path, !isFavorite, isFolder ? 'folder' : 'file');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onRefresh(); // Simple sync
  };


  // Back Button Handling
  useEffect(() => {
    const onBackPress = () => {
      if (viewerContext) {
        setViewerContext(null);
        if (activeTab === 'favorites') loadFavoritesData(0);
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

  const renderContent = () => {
    return (
      <Animated.View
        key={activeTab}
        entering={FadeIn.duration(150)}
        className="flex-1"
      >
        {activeTab === 'home' && (
          <View className="flex-1">
            <Header title={t('header.discover')} subtitle={t('header.discover.sub')} />
            <ScrollView
              className="flex-1 bg-gray-50/50 dark:bg-black"
              contentContainerStyle={{ paddingBottom: 100 }}
              refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
            >
              <View className="mb-6 pt-0">
                {/* Hero Carousel - Full Width Implementation */}
                <View>
                  <CarouselView isActive={activeTab === 'home'} />
                </View>
              </View>

              <View className="pl-4 mb-4">
                <Text className="text-xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">{t('section.just_added')}</Text>

                {/* Horizontal List for Recent Media */}
                <FlatList
                  data={recentMedia.length > 0 ? recentMedia : [1, 2, 3, 4] as any}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item) => typeof item === 'number' ? `skeleton-${item}` : item.id}
                  contentContainerStyle={{ paddingRight: 16, gap: 12 }}
                  renderItem={({ item }) => {
                    if (typeof item === 'number') {
                      return (
                        <View
                          style={{ width: recentWidth, height: recentWidth * 1.4 }}
                          className="bg-gray-200 dark:bg-zinc-800 rounded-2xl animate-pulse"
                        />
                      );
                    }
                    return (
                      <View style={{ width: recentWidth, height: recentWidth * 1.4 }}>
                        <MediaCard
                          item={item}
                          onPress={() => handleMediaPress(item, recentMedia)}
                          onLongPress={handleManagePress}
                        />
                      </View>
                    );
                  }}
                />
              </View>
            </ScrollView>
          </View>
        )
        }

        {
          activeTab === 'library' && (
            <View className="flex-1">
              <Header title={t('header.library')} subtitle={t('header.library.sub')} />
              <FlatList
                key={`lib-${numColumns}`}
                data={formatGridData(libraryFiles, numColumns)}
                keyExtractor={item => item.id}
                numColumns={numColumns}
                columnWrapperStyle={{ gap: 8 }}
                contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
                onEndReached={() => {
                  if (hasMoreLibrary && !loadingMore && !loading) {
                    loadLibraryData(libraryOffset + 100, true);
                  }
                }}
                onEndReachedThreshold={0.5}
                ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" color={isDark ? "#fff" : "#000"} /> : null}
                renderItem={({ item }) => {
                  // @ts-ignore
                  if (item.empty) return <View style={{ width: cardWidth }} className="mb-2 bg-transparent" />;
                  return (
                    <View style={{ width: cardWidth }} className="mb-2">
                      <MediaCard
                        item={item}
                        onPress={(i: MediaItem) => handleMediaPress(i, libraryFiles)}
                        onLongPress={handleManagePress}
                      />
                    </View>
                  );
                }}
              />
            </View>
          )
        }

        {
          activeTab === 'favorites' && (
            <View className="flex-1">
              <Header title={t('header.favorites')} subtitle={t('header.favorites.sub')} />
              <FlatList
                key={`fav-${numColumns}`}
                data={formatGridData(favoriteFiles, numColumns)}
                keyExtractor={item => item.id}
                numColumns={numColumns}
                columnWrapperStyle={{ gap: 8 }}
                contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
                onEndReached={() => {
                  if (hasMoreFavorites && !loadingMore && !loading) {
                    loadFavoritesData(favoriteOffset + 50, true);
                  }
                }}
                onEndReachedThreshold={0.5}
                ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" color={isDark ? "#fff" : "#000"} /> : null}
                ListHeaderComponent={
                  favoriteFolders.length > 0 ? (
                    <View className="mb-4">
                      <Text className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-widest">{t('folder.directories')}</Text>
                      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                        {favoriteFolders.map(folder => (
                          <View key={folder.path} style={{ width: folderCardWidth }} className="mb-4">
                            <FolderCard
                              name={folder.name}
                              path={folder.path}
                              isFavorite={folder.isFavorite}
                              onPress={() => handleFolderPress(folder)}
                              onLongPress={() => handleManagePress({ type: 'folder', name: folder.name, path: folder.path, isFavorite: folder.isFavorite })}
                            />
                          </View>
                        ))}
                      </View>
                      {favoriteFiles.length > 0 && (
                        <Text className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-widest mt-2">{t('folder.media')}</Text>
                      )}
                    </View>
                  ) : null
                }
                renderItem={({ item }) => {
                  // @ts-ignore
                  if (item.empty) return <View style={{ width: cardWidth }} className="mb-2 bg-transparent" />;
                  return (
                    <View style={{ width: cardWidth }} className="mb-2">
                      <MediaCard
                        item={item}
                        onPress={(i: MediaItem) => handleMediaPress(i, favoriteFiles)}
                        onLongPress={handleManagePress}
                      />
                    </View>
                  );
                }}
                ListEmptyComponent={
                  (!loading && favoriteFiles.length === 0 && favoriteFolders.length === 0) ? (
                    <View className="p-20 items-center justify-center opacity-50">
                      <Text className="text-gray-400 font-medium">{t('empty.favorites')}</Text>
                    </View>
                  ) : null
                }
              />
            </View>
          )
        }

        {
          activeTab === 'folders' && (
            <View className="flex-1">
              <Header
                title={currentPath ? (currentPath.split(/[/\\]/).pop() || t('header.folders')) : t('header.folders')}
                subtitle={currentPath ? t('header.browse') : t('header.folders.sub')}
                showBack={!!currentPath}
                onBack={handleBack}
              />

              <Animated.View
                key={currentPath || 'root'}
                entering={FadeIn.duration(150)}
                style={{ flex: 1 }}
              >
                <FlatList
                  key={`folders-${currentPath}-${numColumns}`}
                  data={formatGridData(folderFiles, numColumns)}
                  keyExtractor={item => item.id}
                  numColumns={numColumns}
                  columnWrapperStyle={{ gap: 8 }}
                  contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                  refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
                  onEndReached={() => {
                    if (hasMoreFolderFiles && !loadingMore && !loading) {
                      loadFolderData(currentPath, folderOffset + 50, true);
                    }
                  }}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" color={isDark ? "#fff" : "#000"} /> : null}
                  ListHeaderComponent={
                    <View>
                      {/* BreadCrumb removed, handled by Header */}

                      {folders.length > 0 && (
                        <View className="mb-4">
                          {!currentPath && <Text className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-widest">{t('folder.directories')}</Text>}
                          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                            {folders.map(folder => (
                              <View key={folder.path} style={{ width: folderCardWidth }} className="mb-4">
                                <FolderCard
                                  name={folder.name}
                                  path={folder.path}
                                  isFavorite={folder.isFavorite}
                                  onPress={() => handleFolderPress(folder)}
                                  onLongPress={() => handleManagePress({ type: 'folder', name: folder.name, path: folder.path, isFavorite: folder.isFavorite })}
                                />
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                      {folderFiles.length > 0 && (
                        <Text className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-widest mt-2">
                          {t('folder.media')}
                        </Text>
                      )}
                    </View>
                  }
                  renderItem={({ item }) => {
                    // @ts-ignore
                    if (item.empty) return <View style={{ width: cardWidth }} className="mb-2 bg-transparent" />;
                    return (
                      <View style={{ width: cardWidth }} className="mb-2">
                        <MediaCard
                          item={item}
                          onPress={(i: MediaItem) => handleMediaPress(i, folderFiles)}
                          onLongPress={handleManagePress}
                        />
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    (!loading && folders.length === 0) ? (
                      <View className="p-20 items-center justify-center opacity-50">
                        <Text className="text-gray-400 font-medium">{t('empty.folder')}</Text>
                      </View>
                    ) : null
                  }
                />
              </Animated.View>
            </View>
          )
        }

        {/* Settings Tab */}
        {
          activeTab === 'settings' && (
            <SettingsScreen onLogout={handleLogout} username={username || 'Guest'} />
          )
        }

      </Animated.View >
    );
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: isDark ? '#000000' : '#ffffff' }} className="bg-white dark:bg-black">
      <StatusBar style={isDark ? "light" : "dark"} />
      <View className="flex-1 bg-white dark:bg-black relative">
        {/* Mobile Unified Loading: Handled by RefreshControl now. */}
        {renderContent()}

        {/* MediaViewer Overlay */}
        {viewerContext && (
          <Animated.View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}
            entering={FadeIn.duration(100)}
            exiting={FadeOut.duration(100)}
          >
            <MediaViewer
              items={viewerContext.items}
              initialIndex={viewerContext.index}
              onClose={() => {
                setViewerContext(null);
              }}
              onToggleFavorite={async (id, isFavorite) => {
                // 1. Optimistic Update Local State
                const updateItem = (item: MediaItem) => item.id === id ? { ...item, isFavorite } : item;

                // Update Context Items (Crucial for Viewer persistence)
                if (viewerContext) {
                  setViewerContext(prev => prev ? { ...prev, items: prev.items.map(updateItem) } : null);
                }

                setRecentMedia(prev => prev.map(updateItem));
                setLibraryFiles(prev => prev.map(updateItem));
                setFavoriteFiles(prev => {
                  if (isFavorite) {
                    return prev.map(updateItem);
                  } else {
                    return prev.filter(i => i.id !== id);
                  }
                });
                setFolderFiles(prev => prev.map(updateItem));

                // 2. Call Backend
                await toggleFavorite(id, isFavorite);

                // 3. Refresh Favorites List if needed (lazy sync)
                if (activeTab === 'favorites' && !isFavorite) {
                  // Already filtered out above optimistically
                }
              }}
            />
          </Animated.View>
        )}
        {activeTab !== 'settings' && !viewerContext && (
          <MiniPlayer onMaximize={() => {
            if (currentTrack && playlist.length > 0) {
              setViewerContext({ items: playlist, index: currentIndex !== -1 ? currentIndex : 0 });
              maximizePlayer(); // sets isMinimized=false
            }
          }} />
        )}
      </View>

      <BottomTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <ActionMenu
        visible={isMenuVisible}
        onClose={() => setIsMenuVisible(false)}
        item={managedItem}
        onToggleFavorite={handleToggleFavoriteFromMenu}
        onDelete={handleDelete}
      />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ConfigProvider>
            <AudioProvider>
              <BiometricGate>
                <MainScreen />
              </BiometricGate>
            </AudioProvider>
          </ConfigProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

