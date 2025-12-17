import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Dimensions, FlatList, Image, ViewToken, Text } from 'react-native';
import { useConfig } from '../utils/ConfigContext';
import { fetchFiles, getFileUrl, getThumbnailUrl } from '../utils/api';
import { MediaItem } from '../types';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Full screen width items, with internal padding for the visual card
const ITEM_WIDTH = SCREEN_WIDTH;
const VISUAL_WIDTH = SCREEN_WIDTH - 32; // 16px padding on each side
const ITEM_HEIGHT = VISUAL_WIDTH * 1.25; // 4:5 Aspect Ratio based on the visual card width

interface CarouselViewProps {
    isActive: boolean;
}

export const CarouselView: React.FC<CarouselViewProps> = ({ isActive }) => {
    const { carouselConfig } = useConfig();
    const [items, setItems] = useState<MediaItem[]>([]);
    const flatListRef = useRef<FlatList>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const videoRef = useRef<Video>(null);
    const [videoStatus, setVideoStatus] = useState<AVPlaybackStatus | null>(null);

    // Auto-scroll timer
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Initial Load
    useEffect(() => {
        loadData();
    }, [carouselConfig]);

    // Handle Active State Change
    useEffect(() => {
        if (!isActive) {
            stopTimer();
            if (videoRef.current) videoRef.current.pauseAsync();
        } else {
            resetTimerForCurrentItem();
        }
    }, [isActive]);

    const loadData = async () => {
        try {
            let res: any = { files: [] };
            const commonOptions = { limit: 20, random: true, excludeMediaType: 'audio' };

            if (carouselConfig.sourceType === 'all') {
                res = await fetchFiles(commonOptions);
            } else if (carouselConfig.sourceType === 'folder' && carouselConfig.sourceValue) {
                res = await fetchFiles({ ...commonOptions, folderPath: carouselConfig.sourceValue });
            } else if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                res = await fetchFiles({ ...commonOptions, limit: 5 });
            } else {
                res = await fetchFiles(commonOptions);
            }

            // Client-side filter as backup for audio
            const filteredFiles = (res.files || []).filter((f: MediaItem) => f.mediaType !== 'audio');
            setItems(filteredFiles);
            setActiveIndex(0);
        } catch (e) {
            console.error(e);
        }
    };

    const stopTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const resetTimerForCurrentItem = () => {
        stopTimer();
        if (!isActive || items.length === 0) return;

        const currentItem = items[activeIndex];
        if (!currentItem) return;

        if (currentItem.mediaType === 'image') {
            timerRef.current = setTimeout(() => {
                scrollToNext();
            }, 5000);
        }
    };

    const scrollToNext = () => {
        if (items.length === 0) return;
        const nextIndex = (activeIndex + 1) % items.length;
        if (flatListRef.current) {
            flatListRef.current.scrollToIndex({ index: nextIndex, animated: true });
        }
    };

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (viewableItems.length > 0 && viewableItems[0].index !== null) {
            const newIndex = viewableItems[0].index;
            if (newIndex !== activeIndex) {
                setActiveIndex(newIndex);
            }
        }
    }).current;

    useEffect(() => {
        resetTimerForCurrentItem();
    }, [activeIndex, items, isActive]);


    const renderItem = ({ item, index }: { item: MediaItem, index: number }) => {
        const isFocused = index === activeIndex;

        // Logical Item Container (Full Width)
        // Inner View: The actual visual card (Visual Width, Centered)
        return (
            <View style={{ width: ITEM_WIDTH, height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
                <View
                    style={{ width: VISUAL_WIDTH, height: ITEM_HEIGHT }}
                    className="bg-black rounded-3xl overflow-hidden shadow-xl elevation-5"
                >
                    {item.mediaType === 'video' && isFocused && isActive ? (
                        <Video
                            ref={videoRef}
                            source={{ uri: getFileUrl(item.id) }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode={ResizeMode.COVER}
                            isLooping={false}
                            shouldPlay={true}
                            onPlaybackStatusUpdate={status => {
                                if (status.isLoaded && status.didJustFinish) {
                                    scrollToNext();
                                }
                            }}
                        />
                    ) : (
                        <Image
                            source={{ uri: getThumbnailUrl(item.id) }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                        />
                    )}
                </View>
            </View>
        );
    };

    if (items.length === 0) return null;

    return (
        <View style={{ height: ITEM_HEIGHT }}>
            <FlatList
                ref={flatListRef}
                data={items}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled // Native paging enabled
                showsHorizontalScrollIndicator={false}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                initialNumToRender={1}
                maxToRenderPerBatch={1}
                windowSize={3}
                // We rely on standard paging now, which uses the ListView style width (default full width)
                // removing clipped subviews to ensure smooth paging transitions
                removeClippedSubviews={false}
            />
        </View>
    );
};
