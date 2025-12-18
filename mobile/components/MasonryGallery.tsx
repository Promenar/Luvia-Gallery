import React from 'react';
import { View, ScrollView, RefreshControl, ActivityIndicator, Text } from 'react-native';
import { MediaItem } from '../types';
import { MediaCard } from './MediaCard';
import { useTheme } from '../utils/ThemeContext';

interface MasonryGalleryProps {
    data: MediaItem[];
    onPress: (item: MediaItem, list: MediaItem[]) => void;
    onLongPress?: (item: MediaItem) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    onEndReached?: () => void;
    onEndReachedThreshold?: number;
    loadingMore?: boolean;
    ListHeaderComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
}

export const MasonryGallery: React.FC<MasonryGalleryProps> = ({
    data,
    onPress,
    onLongPress,
    onRefresh,
    refreshing,
    onEndReached,
    loadingMore,
    ListHeaderComponent,
    ListEmptyComponent,
    onEndReachedThreshold = 0.5
}) => {
    const { isDark } = useTheme();
    const isFetching = React.useRef(false);

    // Reset fetching state when loadingMore changes to false
    React.useEffect(() => {
        if (!loadingMore) {
            isFetching.current = false;
        }
    }, [loadingMore]);

    // Split data into two columns
    const leftColumn: MediaItem[] = [];
    const rightColumn: MediaItem[] = [];

    data.forEach((item, index) => {
        if (index % 2 === 0) leftColumn.push(item);
        else rightColumn.push(item);
    });

    const isCloseToBottom = ({ layoutMeasurement, contentOffset, contentSize }: any) => {
        const threshold = layoutMeasurement.height * onEndReachedThreshold;
        return layoutMeasurement.height + contentOffset.y >= contentSize.height - threshold;
    };

    const getItemAspectRatio = (id: string) => {
        // Simple hash to get a consistent pseudo-random ratio
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        // Map hash to range [0.75, 1.25]
        const min = 0.75;
        const max = 1.25;
        const ratio = min + (Math.abs(hash) % 100) / 100 * (max - min);
        return ratio;
    };

    return (
        <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            refreshControl={onRefresh ? <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} /> : undefined}
            onScroll={({ nativeEvent }) => {
                if (isCloseToBottom(nativeEvent)) {
                    if (!isFetching.current && onEndReached) {
                        isFetching.current = true;
                        onEndReached();
                    }
                }
            }}
            scrollEventThrottle={16}
        >
            {ListHeaderComponent}

            {data.length === 0 ? (
                ListEmptyComponent
            ) : (
                <View className="flex-row" style={{ gap: 12 }}>
                    <View className="flex-1" style={{ gap: 12 }}>
                        {leftColumn.map(item => (
                            <MediaCard
                                key={item.id}
                                item={item}
                                aspectRatio={getItemAspectRatio(item.id)}
                                onPress={(i) => onPress(i, data)}
                                onLongPress={onLongPress}
                            />
                        ))}
                    </View>
                    <View className="flex-1" style={{ gap: 12 }}>
                        {rightColumn.map(item => (
                            <MediaCard
                                key={item.id}
                                item={item}
                                aspectRatio={getItemAspectRatio(item.id)}
                                onPress={(i) => onPress(i, data)}
                                onLongPress={onLongPress}
                            />
                        ))}
                    </View>
                </View>
            )}

            {loadingMore && (
                <View className="py-6 items-center">
                    <ActivityIndicator color={isDark ? "#fff" : "#000"} />
                </View>
            )}
        </ScrollView>
    );
};
