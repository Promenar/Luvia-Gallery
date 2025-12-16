import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, SectionList, ActivityIndicator, Dimensions } from 'react-native';
import { useTheme, Text } from 'react-native-paper';
import { useAuth } from '../../contexts/AuthContext';
import { SolidGridItem } from '../../components/SolidGridItem';
import { MediaItem } from '../../types';
import { useHeader } from '../../contexts/HeaderContext';

// Helper to format date groups
const formatDateGroup = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    // Check yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";

    // Month Year
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

// Flatten/Group Logic (Mocked for now as we don't have "All Photos" API)
// We will fetch root folders and pretend their contents are "timeline" items for visual demo.
// In real app, we need a recursive fetch or DB query.

export default function LibraryScreen() {
    const theme = useTheme();
    const { token, serverUrl } = useAuth();
    const { setHeader } = useHeader();

    const [sections, setSections] = useState<{ title: string; data: MediaItem[] }[]>([]);
    const [loading, setLoading] = useState(true);

    // Sync Header
    useEffect(() => {
        setHeader({
            title: "Library",
            breadcrumb: "Timeline",
            showBack: false
        });
    }, [setHeader]);

    useEffect(() => {
        // Mock Timeline Fetch
        // 1. Fetch a few folders to get media
        // 2. Assign fake dates if needed or use real mtime

        const fetchTimeline = async () => {
            try {
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                // Fetch Root to find some content
                const res = await fetch(`${serverUrl}/api/library/folders?parentPath=root`, { headers });
                if (!res.ok) throw new Error("Failed to fetch");
                const data = await res.json();

                // Recursively (1 level deep) fetch to get files
                let allFiles: MediaItem[] = [];

                // Just take first 3 folders for demo
                const folders = (data.folders || []).slice(0, 3);

                for (const f of folders) {
                    const subRes = await fetch(`${serverUrl}/api/library/folders?parentPath=${encodeURIComponent(f.path)}`, { headers });
                    if (subRes.ok) {
                        const subData = await subRes.json();

                        // Create Dummy Timeline Data
                        const mockFiles: MediaItem[] = [
                            { id: '1', name: 'Photo_1.jpg', mediaType: 'image', size: 0, lastModified: Date.now(), path: '/mock/1', type: 'file', sourceId: 'local', url: '', folderPath: '/mock' },
                            { id: '2', name: 'Photo_2.jpg', mediaType: 'image', size: 0, lastModified: Date.now(), path: '/mock/2', type: 'file', sourceId: 'local', url: '', folderPath: '/mock' },
                            { id: '3', name: 'Video_1.mp4', mediaType: 'video', size: 0, lastModified: Date.now() - 86400000, path: '/mock/3', type: 'file', sourceId: 'local', url: '', folderPath: '/mock' },
                            { id: '4', name: 'Photo_3.jpg', mediaType: 'image', size: 0, lastModified: Date.now() - 86400000 * 5, path: '/mock/4', type: 'file', sourceId: 'local', url: '', folderPath: '/mock' },
                        ];
                        allFiles = [...mockFiles];
                    }
                }

                // Group by Date
                const groups: Record<string, MediaItem[]> = {};
                allFiles.forEach(item => {
                    const group = formatDateGroup(item.lastModified);
                    if (!groups[group]) groups[group] = [];
                    groups[group].push(item);
                });

                const sectionData = Object.keys(groups).map(key => ({
                    title: key,
                    data: groups[key]
                }));

                setSections(sectionData);

            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };

        fetchTimeline();
    }, [serverUrl, token]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {loading ? (
                <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <View style={{ width: '33%', padding: 1 }}>
                            {/* Grid 3 columns */}
                            <SolidGridItem
                                item={item}
                                onPress={() => { }}
                                onLongPress={() => { }}
                                selected={false}
                                selectionMode={false}
                                authHeaders={token ? { Authorization: `Bearer ${token}` } : undefined}
                            />
                        </View>
                    )}
                    renderSectionHeader={({ section: { title } }) => (
                        <View style={[styles.header, { backgroundColor: 'rgba(15, 17, 21, 0.95)' }]}>
                            <Text variant="titleSmall" style={{ color: '#fff', fontWeight: 'bold' }}>{title}</Text>
                        </View>
                    )}
                    contentContainerStyle={{ paddingBottom: 100 }}
                // numColumns={3} // Not supported in SectionList
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
        alignItems: 'center'
    },
    header: {
        padding: 16,
        paddingVertical: 12,
    }
});
