import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useAuth } from '../contexts/AuthContext';
import { SolidHeader } from '../components/SolidHeader';
import { SolidGridItem } from '../components/SolidGridItem';
import { MediaItem, FolderNode } from '../../types';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useTheme, Text } from 'react-native-paper';

import { useHeader } from '../contexts/HeaderContext';

interface FolderBrowserProps {
  initialPath?: string;
  isRoot?: boolean;
}

export default function FolderBrowser({ initialPath = 'root', isRoot = false }: FolderBrowserProps) {
  const { token, serverUrl } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { setHeader } = useHeader();

  // Use local params if this is a pushed route, otherwise props
  const params = useLocalSearchParams();
  const currentPath = (params.path as string) || initialPath;

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let url = `${serverUrl}/api/library/folders`;
      // Root request logic
      if (currentPath === 'root') {
        url += `?parentPath=root`;
      } else {
        url += `?parentPath=${encodeURIComponent(currentPath)}`;
      }

      console.log(`fetching: ${url}`);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthorized");
        throw new Error(`Failed to fetch: ${res.status}`);
      }

      const rawData = await res.json();
      console.log("� Raw Data Type:", Array.isArray(rawData) ? "Array" : "Object", Array.isArray(rawData) ? `Len: ${rawData.length}` : Object.keys(rawData));

      let parsedItems: any[] = [];

      // Strategy 1: If it's a direct Array, use it
      if (Array.isArray(rawData)) {
        parsedItems = rawData;
      }
      // Strategy 2: If it's an Object, merge known fields
      else if (typeof rawData === 'object' && rawData !== null) {
        const folders = rawData.folders || rawData.directories || [];
        const files = rawData.files || rawData.media || rawData.items || [];
        parsedItems = [...folders, ...files];
      }

      // Strategy 3: Auto-classify items & Map to MediaItem
      const formattedItems: MediaItem[] = parsedItems.map((item: any) => {
        // Logic: It's a folder if it has 'mediaCount' or 'coverMedia' or is explicitly marked
        // Also check if type is 'directory' or 'folder'
        const isFolder = item.type === 'folder' || item.type === 'directory' || item.mediaCount !== undefined || item.coverMedia !== undefined || item.mediaType === 'folder';

        const id = item.id || item.path || item.name;

        return {
          id: id,
          name: item.name || item.filename || 'Unknown',
          path: item.path || id,
          folderPath: isFolder ? item.path : (currentPath === 'root' ? '' : currentPath),

          // CRITICAL: SolidGridItem depends on 'mediaType' ('folder' | 'video' | 'image')
          mediaType: isFolder ? 'folder' : (item.type === 'video' || item.mediaType === 'video' ? 'video' : 'image'),

          url: isFolder ? '' : `${serverUrl}/api/media/stream/${id}`, // Add valid URL field

          thumbnailUrl: isFolder
            ? (item.coverMedia ? `${serverUrl}${item.coverMedia.url}` : undefined)
            : `${serverUrl}/api/media/thumb/${id}`,

          size: item.size || 0,
          type: isFolder ? 'directory' : 'file',
          lastModified: item.mtimeMs || item.lastModified || 0,
          sourceId: 'local'
        };
      });

      console.log(`✅ Loaded: ${formattedItems.length} items`);
      setItems(formattedItems);

    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentPath, serverUrl, token]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Sync Header
  useEffect(() => {
    const title = params.name ? (params.name as string) : "Folders";
    const breadcrumb = isRoot ? "Internal Storage" : currentPath;

    setHeader({
      title: title,
      breadcrumb: breadcrumb,
      showBack: !isRoot,
      leftIcon: isRoot ? 'menu' : 'arrow-left',
      onLeftPress: isRoot
        ? () => navigation.dispatch(DrawerActions.openDrawer())
        : () => { if (router.canGoBack()) router.back(); },
      onBack: !isRoot ? () => {
        if (router.canGoBack()) router.back();
      } : undefined
    });
  }, [currentPath, isRoot, params.name, setHeader, router, navigation]);

  const handlePress = (item: MediaItem) => {
    if (selectionMode) {
      toggleSelection(item.id);
    } else {
      if (item.mediaType === 'folder') {
        // Navigate deeper
        router.push({
          pathname: '/(drawer)/folders/browse',
          params: { path: item.path, name: item.name }
        });
      } else {
        // Open Media Viewer (TODO)
        console.log("Open media", item.name);
      }
    }
  };

  const handleLongPress = (item: MediaItem) => {
    setSelectionMode(true);
    toggleSelection(item.id);
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);

    setSelectedIds(newSelected);
    if (newSelected.size === 0) setSelectionMode(false);
  };

  // NOTE: Breadcrumb logic should ideally communicate back to the Global Header.
  // For now, simpler implementation as we have internal state.
  // Actually, since the header is global, we need a way to set its state. 
  // But per instructions, we just start with static. 
  // I will leave the header in the browser for now commented out, 
  // OR rely on the global one. 
  // The global one is static "Internal Storage" for now.

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* 
         Global Header is handling the top bar. 
         We just render content here.
      */}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: theme.colors.error }}>{error}</Text>
          {error === 'Unauthorized' && <Text style={{ color: '#fff' }}>Please Login</Text>}
        </View>
      ) : (
        <FlashList
          data={items}
          numColumns={2}
          // @ts-ignore
          estimatedItemSize={150}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <SolidGridItem
              item={item}
              onPress={handlePress}
              onLongPress={handleLongPress}
              selected={selectedIds.has(item.id)}
              selectionMode={selectionMode}
              authHeaders={{ 'Authorization': `Bearer ${token}` }}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
