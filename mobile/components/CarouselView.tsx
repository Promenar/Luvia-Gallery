import React, { useEffect, useState, useRef, useCallback, memo } from 'react';
import { View, Dimensions, FlatList, ViewToken, Text, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { useConfig } from '../utils/ConfigContext';
import { fetchFiles, getFileUrl, getThumbnailUrl, getToken } from '../utils/api';
import { MediaItem } from '../types';
import { useVideoPlayer, VideoView, VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useDerivedValue } from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = SCREEN_WIDTH;
const VISUAL_WIDTH = SCREEN_WIDTH - 32;
const ITEM_HEIGHT = VISUAL_WIDTH * 1.45;
const TRANSITION_DURATION = 800; // 渐变时长
const ROTATION_INTERVAL = 7000;  // 轮播间隔（延长至7秒）

interface CarouselViewProps {
    isActive: boolean;
}

// 独立的轮播项组件，负责自身的动画逻辑
const CarouselItem = memo(({
    item,
    index,
    activeIndex,
    fadeOutIndex,
    player,
    isActive
}: {
    item: MediaItem,
    index: number,
    activeIndex: number,
    fadeOutIndex: number | null,
    player: VideoPlayer,
    isActive: boolean
}) => {
    const isFocused = index === activeIndex;
    const isExiting = index === fadeOutIndex;

    // 动画透明度
    const opacity = useSharedValue(0);

    useEffect(() => {
        if (isFocused && !isExiting) {
            // 入场：平滑淡入
            opacity.value = withTiming(1, { duration: TRANSITION_DURATION });
        } else if (isExiting) {
            // 出场：平滑淡出
            opacity.value = withTiming(0, { duration: 500 });
        } else {
            // 非焦点项：保持透明度较低
            opacity.value = withTiming(0, { duration: 300 });
        }
    }, [isFocused, isExiting]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value
    }));

    return (
        <View style={{ width: ITEM_WIDTH, height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
            {/* 底层占位（防止全黑） */}
            <View
                style={{ width: VISUAL_WIDTH, height: ITEM_HEIGHT, position: 'absolute', opacity: 0.15 }}
                className="bg-gray-200 dark:bg-zinc-800 rounded-3xl overflow-hidden"
            >
                <Image
                    source={{
                        uri: getThumbnailUrl(item.id),
                        headers: { Authorization: `Bearer ${getToken()}` }
                    }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    blurRadius={10}
                    transition={1000}
                />
            </View>

            {/* 内容层（带动画） */}
            <Animated.View
                style={[{ width: VISUAL_WIDTH, height: ITEM_HEIGHT }, animatedStyle]}
                className="bg-black rounded-3xl overflow-hidden shadow-xl elevation-5"
            >
                {item.mediaType === 'video' && isFocused && isActive ? (
                    <VideoView
                        player={player}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        nativeControls={false}
                    />
                ) : (
                    <Image
                        source={{
                            uri: getThumbnailUrl(item.id),
                            headers: { Authorization: `Bearer ${getToken()}` }
                        }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        transition={500}
                    />
                )}
            </Animated.View>
        </View>
    );
});

export const CarouselView: React.FC<CarouselViewProps> = ({ isActive }) => {
    const { carouselConfig } = useConfig();
    const [items, setItems] = useState<MediaItem[]>([]);
    const [displayItems, setDisplayItems] = useState<MediaItem[]>([]);
    const flatListRef = useRef<FlatList>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [fadeOutIndex, setFadeOutIndex] = useState<number | null>(null);
    const isInitialScrollDone = useRef(false);

    const player = useVideoPlayer('', (player) => {
        player.loop = false;
        player.muted = true;
    });

    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        loadData();
    }, [carouselConfig]);

    useEffect(() => {
        if (!isActive) {
            stopTimer();
            player.pause();
        } else {
            resetTimerForCurrentItem();
            player.play();
        }
    }, [isActive, player]);

    useEffect(() => {
        const currentItem = displayItems[activeIndex];
        if (currentItem?.mediaType === 'video' && isActive) {
            player.replaceAsync(getFileUrl(currentItem.id)).then(() => {
                player.play();
            });
        }
    }, [activeIndex, displayItems, isActive, player]);

    const loadData = async () => {
        try {
            let res: any = { files: [] };
            const commonOptions = { limit: 30, random: true, excludeMediaType: 'audio' };

            if (carouselConfig.sourceType === 'all') {
                res = await fetchFiles(commonOptions);
            } else if (carouselConfig.sourceType === 'folder' && carouselConfig.sourceValue) {
                res = await fetchFiles({ ...commonOptions, folderPath: carouselConfig.sourceValue, recursive: true });
            } else if (carouselConfig.sourceType === 'favorites') {
                res = await fetchFiles({ ...commonOptions, favorite: true });
            } else if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                // Logic: Fetch files from the parent folder of the selected file
                // Path manipulation (assuming standard slashes from picker)
                const filePath = carouselConfig.sourceValue;
                // Simple dirname implementation
                const lastSlash = filePath.lastIndexOf('/');
                const parentFolder = lastSlash > -1 ? filePath.substring(0, lastSlash) : 'root';

                // Fetch files from that folder (no recursion, just context)
                res = await fetchFiles({ ...commonOptions, folderPath: parentFolder, limit: 100, random: false });
            } else {
                res = await fetchFiles(commonOptions);
            }

            let filteredFiles = (res.files || []).filter((f: MediaItem) => f.mediaType !== 'audio');

            // If a specific file is selected, filter to ONLY that file
            if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                // Determine target ID (we have it directly)
                const targetID = carouselConfig.sourceValue;

                const targetFile = filteredFiles.find((f: MediaItem) => f.id === targetID);

                if (!targetFile) {
                    console.warn('[Carousel] Target ID not found in results:', {
                        targetID,
                        // availableIDs: filteredFiles.map(f => f.id) // Reduced logging to avoid bloat
                    });
                } else {
                    console.log('[Carousel] Found target file by ID:', targetFile.name);
                }

                filteredFiles = targetFile ? [targetFile] : [];
            }

            if (filteredFiles.length > 1) {
                const lastItem = filteredFiles[filteredFiles.length - 1];
                const firstItem = filteredFiles[0];
                const extended = [lastItem, ...filteredFiles, firstItem];
                setItems(filteredFiles);
                setDisplayItems(extended);
                setActiveIndex(1);
                isInitialScrollDone.current = false;
            } else {
                setItems(filteredFiles);
                setDisplayItems(filteredFiles);
                setActiveIndex(0);
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (displayItems.length > 1 && !isInitialScrollDone.current && flatListRef.current) {
            flatListRef.current.scrollToIndex({ index: 1, animated: false });
            isInitialScrollDone.current = true;
        }
    }, [displayItems]);

    const stopTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const resetTimerForCurrentItem = () => {
        stopTimer();
        if (!isActive || displayItems.length === 0) return;

        timerRef.current = setTimeout(() => {
            scrollToNext();
        }, ROTATION_INTERVAL);
    };

    const scrollToNext = () => {
        if (displayItems.length <= 1) return;

        // 步骤1：开始淡出当前项
        setFadeOutIndex(activeIndex);

        // 步骤2：延迟等待淡出完成后执行滚动
        setTimeout(() => {
            const nextIndex = activeIndex + 1;
            if (nextIndex >= displayItems.length) {
                setFadeOutIndex(null);
                return;
            }
            if (flatListRef.current) {
                flatListRef.current.scrollToIndex({ index: nextIndex, animated: true });
                setFadeOutIndex(null);
            }
        }, 600);
    };

    const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / ITEM_WIDTH);

        if (displayItems.length <= 1) {
            setActiveIndex(index);
            return;
        }

        if (index === 0) {
            const realLastIndex = displayItems.length - 2;
            flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
            setActiveIndex(realLastIndex);
        } else if (index === displayItems.length - 1) {
            flatListRef.current?.scrollToIndex({ index: 1, animated: false });
            setActiveIndex(1);
        } else {
            setActiveIndex(index);
        }
    };

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (viewableItems.length > 0 && viewableItems[0].index !== null) {
            const newIndex = viewableItems[0].index;
            setActiveIndex(newIndex);
        }
    }).current;

    useEffect(() => {
        resetTimerForCurrentItem();
    }, [activeIndex, displayItems, isActive]);

    const renderItem = ({ item, index }: { item: MediaItem, index: number }) => {
        return (
            <CarouselItem
                item={item}
                index={index}
                activeIndex={activeIndex}
                fadeOutIndex={fadeOutIndex}
                player={player}
                isActive={isActive}
            />
        );
    };

    if (displayItems.length === 0) return null;

    return (
        <View style={{ height: ITEM_HEIGHT }}>
            <FlatList
                ref={flatListRef}
                data={displayItems}
                renderItem={renderItem}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onViewableItemsChanged={onViewableItemsChanged}
                onMomentumScrollEnd={handleMomentumScrollEnd}
                viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                initialNumToRender={1}
                maxToRenderPerBatch={1}
                windowSize={3}
                removeClippedSubviews={false}
                getItemLayout={(_, index) => ({
                    length: ITEM_WIDTH,
                    offset: ITEM_WIDTH * index,
                    index,
                })}
            />
        </View>
    );
};
