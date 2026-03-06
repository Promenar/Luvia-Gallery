import React from 'react';
import { View, RefreshControl, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { MediaItem } from '../types';
import { MediaCard } from './MediaCard';
import { useAppTheme } from '../utils/ThemeContext';

interface MasonryGalleryProps {
    data: MediaItem[];
    onPress: (item: MediaItem, list: MediaItem[]) => void;
    onLongPress?: (item: MediaItem) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    onEndReached?: () => void;
    onEndReachedThreshold?: number;
    loadingMore?: boolean;
    ListHeaderComponent?: any;
    ListEmptyComponent?: any;
    numColumns?: number;
    onMomentumScrollBegin?: () => void;
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
    onMomentumScrollBegin,
    onEndReachedThreshold = 0.5,
    numColumns = 2
}) => {
    const { isDark } = useAppTheme();

    // Three-tier fallback strategy for aspect ratio
    const getAspectRatio = (item: MediaItem): number => {
        const validRatio = (ratio?: number) => typeof ratio === 'number' && !isNaN(ratio) && isFinite(ratio) && ratio > 0;

        // 1. Priority: Use server-provided aspectRatio (thumbnail)
        if (validRatio(item.aspectRatio)) {
            // 限制极端宽高比，防止UI崩溃
            return Math.min(Math.max(item.aspectRatio!, 0.3), 3.0);
        }

        // 2. Fallback: Calculate from width/height (thumbnail)
        if (validRatio(item.width) && validRatio(item.height)) {
            return Math.min(Math.max(item.width! / item.height!, 0.3), 3.0);
        }

        // 3. Legacy fallback: ID-based random ratio (for old data without dimensions)
        let hash = 0;
        for (let i = 0; i < item.id.length; i++) {
            hash = item.id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const min = 0.75;
        const max = 1.35;
        return min + (Math.abs(hash) % 100) / 100 * (max - min);
    };

    return (
        <View className="flex-1 w-full h-full">
            <FlashList
                data={data}
                // ✨ Enable native Masonry layout
                // @ts-ignore - masonry prop exists in 2.2.0 but types may not be updated
                masonry={true}
                numColumns={numColumns}
                estimatedItemSize={250}
                keyExtractor={(item: MediaItem) => item.id}
                contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
                refreshControl={onRefresh ? <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} /> : undefined}
                onEndReached={onEndReached}
                onMomentumScrollBegin={onMomentumScrollBegin}
                onEndReachedThreshold={onEndReachedThreshold}
                ListHeaderComponent={ListHeaderComponent}
                ListEmptyComponent={ListEmptyComponent}
                ListFooterComponent={
                    <View className="py-8 items-center h-24 justify-center w-full">
                        {loadingMore ? (
                            <ActivityIndicator size="small" color={isDark ? "#fff" : "#000"} />
                        ) : null}
                    </View>
                }
                // @ts-ignore - overrideItemLayout exists but may not be in types
                overrideItemLayout={(layout, item: MediaItem) => {
                    // In masonry mode, set span to 1 (each item takes 1 column)
                    layout.span = 1;
                    // FlashList will automatically calculate height based on aspectRatio
                }}
                renderItem={({ item }: { item: MediaItem }) => (
                    <View className="flex-1 p-1">
                        <MediaCard
                            item={item}
                            aspectRatio={getAspectRatio(item)}
                            onPress={(i) => onPress(i, data)}
                            onLongPress={onLongPress}
                        />
                    </View>
                )}
            />
        </View>
    );
};
