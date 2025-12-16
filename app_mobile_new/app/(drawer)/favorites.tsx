import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useAuth } from '../../contexts/AuthContext';
import { SolidGridItem } from '../../components/SolidGridItem';
import { MediaItem } from '../../types';
import { useHeader } from '../../contexts/HeaderContext';
import { useTheme, Text } from 'react-native-paper';

export default function FavoritesScreen() {
    const theme = useTheme();
    const { token, serverUrl } = useAuth();
    const { setHeader } = useHeader();

    const [items, setItems] = useState<MediaItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setHeader({
            title: "Favorites",
            breadcrumb: "Collections",
            showBack: false
        });
    }, [setHeader]);

    useEffect(() => {
        const fetchFavorites = async () => {
            setLoading(true);
            try {
                // Use the "favorites=true" endpoint
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(`${serverUrl}/api/library/folders?favorites=true`, { headers });
                if (!res.ok) throw new Error("Failed");
                const data = await res.json();

                const mapped: MediaItem[] = (data.folders || []).map((f: any) => ({
                    id: f.path,
                    name: f.name,
                    path: f.path,
                    folderPath: f.path,
                    mediaType: 'folder',
                    thumbnailUrl: f.coverMedia ? `${serverUrl}${f.coverMedia.url}` : undefined,
                    size: 0,
                    type: 'directory',
                    lastModified: 0,
                    sourceId: 'local'
                }));

                setItems(mapped);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchFavorites();
    }, [serverUrl, token]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {loading ? (
                <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
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
                            onPress={() => { }}
                            onLongPress={() => { }}
                            selected={false}
                            selectionMode={false}
                            authHeaders={token ? { Authorization: `Bearer ${token}` } : undefined}
                        />
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
