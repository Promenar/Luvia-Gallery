import React, { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';
import { View, useWindowDimensions, FlatList, ViewToken, Text, NativeScrollEvent, NativeSyntheticEvent, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useConfig } from '../utils/ConfigContext';
import { fetchFiles, getFileUrl, getThumbnailUrl, getToken } from '../utils/api';
import { getCachedFiles, saveMediaItems } from '../utils/Database';
import { MediaItem } from '../types';
import { useVideoPlayer, VideoView, VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Zap, Image as ImageIcon } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useDerivedValue, withRepeat, withSequence, withDelay, interpolate, Extrapolate, Easing } from 'react-native-reanimated';

const TRANSITION_DURATION = 800; // 渐变时长
const ROTATION_INTERVAL = 7000;  // 轮播间隔（延长至7秒）

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface CarouselViewProps {
    isActive: boolean;
}

// 骨架屏组件 (Simple Pulse Skeleton)
const SkeletonItem = memo(({ width, height }: { width: number, height: number }) => {
    // 使用简单的透明度脉冲动画
    const opacity = useSharedValue(0.5);

    useEffect(() => {
        opacity.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 1000 }),
                withTiming(0.5, { duration: 1000 })
            ),
            -1,
            true
        );
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value
    }));

    return (
        <Animated.View
            style={[{ width, height, overflow: 'hidden' }, animatedStyle]}
            className="bg-gray-200 dark:bg-zinc-800 rounded-[32px] justify-center items-center relative"
        >
            <View className="opacity-20">
                <ImageIcon size={48} color="#94a3b8" />
            </View>
        </Animated.View>
    );
});

// 独立的轮播项组件，负责自身的动画逻辑
const CarouselItem = memo(({
    item,
    index,
    activeIndex,
    fadeOutIndex,
    isActive,
    itemWidth,
    visualWidth,
    itemHeight,
    numVisibleItems,
    isVisible,
    onPress,
}: {
    item: MediaItem,
    index: number,
    activeIndex: number,
    fadeOutIndex: number | null,
    isActive: boolean,
    itemWidth: number,
    visualWidth: number,
    itemHeight: number,
    numVisibleItems: number,
    isVisible: boolean,
    onPress: () => void,
}) => {
    const isFocused = index === activeIndex;
    const isExiting = index === fadeOutIndex;

    const player = useVideoPlayer(isVisible && isActive ? getFileUrl(item.id) : '', (p) => {
        p.loop = true;
        p.muted = true;
        if (isVisible && isActive) p.play();
    });

    useEffect(() => {
        if (isVisible && isActive && item.mediaType === 'video') {
            player.play();
        } else {
            player.pause();
        }
    }, [isVisible, isActive, player, item.mediaType]);

    // 动画透明度：多列模式下始终可见，单列模式下保留渐变效果
    const targetOpacity = (numVisibleItems > 1) ? 1 : (isFocused && !isExiting ? 1 : 0);

    // Ken Burns Effect (Slow Zoom)
    const scale = useSharedValue(1);
    useEffect(() => {
        if (isFocused && isVisible && item.mediaType !== 'video') {
            scale.value = 1;
            scale.value = withTiming(1.15, { duration: 10000, easing: Easing.out(Easing.quad) });
        } else {
            scale.value = withTiming(1, { duration: 500 });
        }
    }, [isFocused, isVisible, item.mediaType]);

    const zoomStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }]
    }));

    // 动画透明度
    const opacity = useSharedValue(0);

    useEffect(() => {
        opacity.value = withTiming(targetOpacity, {
            duration: isExiting ? 500 : (numVisibleItems > 1 ? 0 : TRANSITION_DURATION)
        });
    }, [targetOpacity, isExiting, numVisibleItems]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value
    }));

    return (
        <View style={{ width: itemWidth, height: itemHeight, alignItems: 'center', justifyContent: 'center' }}>
            {/* 底层占位（防止全黑）- 提升可见度并增加渐变背景 */}
            <View
                style={{ width: visualWidth, height: itemHeight, position: 'absolute' }}
                className="bg-gray-100 dark:bg-zinc-900 rounded-3xl overflow-hidden"
            >
                <Image
                    source={{
                        uri: getThumbnailUrl(item.id),
                        headers: { Authorization: `Bearer ${getToken()}` }
                    }}
                    style={{ width: '100%', height: '100%', opacity: 0.25 }}
                    contentFit="cover"
                    blurRadius={20}
                />
                <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)']}
                    className="absolute inset-0"
                />
            </View>

            {/* 内容层（带动画） */}
            <Pressable onPress={onPress}>
                <Animated.View
                    style={[{ width: visualWidth, height: itemHeight }, animatedStyle]}
                    className="bg-black rounded-3xl overflow-hidden shadow-xl elevation-5"
                >
                    {item.mediaType === 'video' && isVisible && isActive ? (
                        <VideoView
                            player={player}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                            nativeControls={false}
                        />
                    ) : (
                        <AnimatedImage
                            source={{
                                uri: getFileUrl(item.id),
                                headers: { Authorization: `Bearer ${getToken()}` }
                            }}
                            placeholder={{
                                uri: getThumbnailUrl(item.id),
                                headers: { Authorization: `Bearer ${getToken()}` }
                            }}
                            style={[{ width: '100%', height: '100%' }, zoomStyle]}
                            contentFit="cover"
                            placeholderContentFit="cover"
                            cachePolicy="memory-disk"
                            transition={500}
                        />
                    )}
                </Animated.View>
            </Pressable>
        </View>
    );
});

interface CarouselViewProps {
    isActive: boolean;
    fullScreen?: boolean;
    onPress?: (item: MediaItem, allItems: MediaItem[]) => void;
}

// ... CarouselItem ...

export const CarouselView: React.FC<CarouselViewProps> = ({ isActive, fullScreen = false, onPress }) => {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const { carouselConfig } = useConfig();
    const [items, setItems] = useState<MediaItem[]>([]);
    const [displayItems, setDisplayItems] = useState<MediaItem[]>([]);
    const [visibleIndices, setVisibleIndices] = useState<number[]>([]);
    const flatListRef = useRef<FlatList>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [fadeOutIndex, setFadeOutIndex] = useState<number | null>(null);
    const isInitialScrollDone = useRef(false);

    // 计算动态尺寸
    const { itemWidth, visualWidth, itemHeight, numVisibleItems } = useMemo(() => {
        const numVisible = fullScreen ? 1 : (windowWidth > 900 ? 3 : (windowWidth > 600 ? 2 : 1));
        const width = windowWidth / numVisible;
        const vWidth = width - (numVisible > 1 ? 16 : 32);

        // Full screen height calculation:
        // Use 75% of window height to ensure it doesn't overflow and leaves breathing room.
        const vHeight = fullScreen
            ? (windowHeight * 0.75)
            : (numVisible > 1 ? Math.min(vWidth * 1.3, 500) : vWidth * 1.45);

        return {
            itemWidth: width,
            visualWidth: vWidth,
            itemHeight: vHeight,
            numVisibleItems: numVisible
        };
    }, [windowWidth, windowHeight, fullScreen]);

    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        loadData();
    }, [carouselConfig]);

    useEffect(() => {
        if (!isActive) {
            stopTimer();
        } else {
            resetTimerForCurrentItem();
        }
    }, [isActive]);

    const loadData = async () => {
        const commonOptions = { limit: 30, random: true, excludeMediaType: 'audio' };

        try {
            // 首先尝试从本地加载缓存
            let cached: MediaItem[] = [];
            if (carouselConfig.sourceType === 'all') {
                cached = await getCachedFiles({ limit: 15 });
            } else if (carouselConfig.sourceType === 'folder' && carouselConfig.sourceValue) {
                cached = await getCachedFiles({ folderPath: carouselConfig.sourceValue, limit: 15 });
            } else if (carouselConfig.sourceType === 'favorites') {
                cached = await getCachedFiles({ favorite: true, limit: 15 });
            }

            if (cached.length > 0) {
                const filteredCached = cached.filter((f: MediaItem) => f.mediaType !== 'audio');
                processData(filteredCached);
            }

            // 然后从线上加载
            let res: any = { files: [] };
            if (carouselConfig.sourceType === 'all') {
                res = await fetchFiles(commonOptions);
                if (res.files?.length > 0) await saveMediaItems(res.files);
            } else if (carouselConfig.sourceType === 'folder' && carouselConfig.sourceValue) {
                res = await fetchFiles({ ...commonOptions, folderPath: carouselConfig.sourceValue, recursive: true });
                if (res.files?.length > 0) await saveMediaItems(res.files);
            } else if (carouselConfig.sourceType === 'favorites') {
                res = await fetchFiles({ ...commonOptions, favorite: true });
                // Favorites 状态同步较多，通常这里不直接 INSERT 而是同步所有状态，Database 已有 updateFavoriteStatus
            } else if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                const filePath = carouselConfig.sourceValue;
                const lastSlash = filePath.lastIndexOf('/');
                const parentFolder = lastSlash > -1 ? filePath.substring(0, lastSlash) : 'root';
                res = await fetchFiles({ ...commonOptions, folderPath: parentFolder, limit: 100, random: false });
            } else {
                res = await fetchFiles(commonOptions);
            }

            const filteredFiles = (res.files || []).filter((f: MediaItem) => f.mediaType !== 'audio');

            if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                const targetID = carouselConfig.sourceValue;
                const targetFile = filteredFiles.find((f: MediaItem) => f.id === targetID);
                processData(targetFile ? [targetFile] : []);
            } else if (filteredFiles.length > 0) {
                processData(filteredFiles);
            }
        } catch (e) {
            console.error("[Carousel] Load data failed:", e);
        }
    };

    const processData = (data: MediaItem[]) => {
        if (!data || data.length === 0) return;

        if (data.length > 1) {
            const lastItem = data[data.length - 1];
            const firstItem = data[0];
            const extended = [lastItem, ...data, firstItem];
            setItems(data);
            setDisplayItems(extended);
            setActiveIndex(prev => (prev === 0 ? 1 : prev));
        } else {
            setItems(data);
            setDisplayItems(data);
            setActiveIndex(0);
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
        }, carouselConfig.interval || 7000);
    };

    const scrollToNext = () => {
        if (displayItems.length <= 1) return;
        setFadeOutIndex(activeIndex);
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
        const index = Math.round(offsetX / itemWidth);
        if (displayItems.length <= 1) {
            setActiveIndex(index);
            return;
        }
        if (index <= 0) {
            const realLastIndex = displayItems.length - 2;
            flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
            setActiveIndex(realLastIndex);
        } else if (index >= displayItems.length - 1) {
            flatListRef.current?.scrollToIndex({ index: 1, animated: false });
            setActiveIndex(1);
        } else {
            setActiveIndex(index);
        }
    };

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (viewableItems.length > 0) {
            const indices = viewableItems
                .filter(v => v.index !== null)
                .map(v => v.index as number);
            setVisibleIndices(indices);
            if (viewableItems[0].index !== null) {
                setActiveIndex(viewableItems[0].index);
            }
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
                isActive={isActive}
                itemWidth={itemWidth}
                visualWidth={visualWidth}
                itemHeight={itemHeight}
                numVisibleItems={numVisibleItems}
                isVisible={visibleIndices.includes(index)}
                onPress={() => onPress && onPress(item, items)}
            />
        );
    };

    if (displayItems.length === 0) {
        return (
            <View style={{ height: itemHeight, paddingHorizontal: 16 }}>
                <SkeletonItem width={visualWidth} height={itemHeight} />
            </View>
        );
    }

    return (
        <View style={{ height: itemHeight }}>
            <FlatList
                ref={flatListRef}
                key={`carousel-${numVisibleItems}`}
                data={displayItems}
                renderItem={renderItem}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                horizontal
                pagingEnabled={false}
                snapToInterval={itemWidth}
                snapToAlignment="start"
                decelerationRate="fast"
                disableIntervalMomentum={true}
                showsHorizontalScrollIndicator={false}
                onViewableItemsChanged={onViewableItemsChanged}
                onMomentumScrollEnd={handleMomentumScrollEnd}
                viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                initialNumToRender={numVisibleItems + 2}
                maxToRenderPerBatch={numVisibleItems}
                windowSize={3}
                removeClippedSubviews={false}
                getItemLayout={(_, index) => ({
                    length: itemWidth,
                    offset: itemWidth * index,
                    index,
                })}
            />
        </View>
    );
};
