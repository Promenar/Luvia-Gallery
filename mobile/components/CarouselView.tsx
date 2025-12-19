import React, { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';
import { View, useWindowDimensions, FlatList, ViewToken, Text, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { useConfig } from '../utils/ConfigContext';
import { fetchFiles, getFileUrl, getThumbnailUrl, getToken } from '../utils/api';
import { getCachedFiles, saveMediaItems } from '../utils/Database';
import { MediaItem } from '../types';
import { useVideoPlayer, VideoView, VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useDerivedValue } from 'react-native-reanimated';

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
    isActive,
    itemWidth,
    visualWidth,
    itemHeight,
    numVisibleItems,
    isVisible,
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
            {/* 底层占位（防止全黑） */}
            <View
                style={{ width: visualWidth, height: itemHeight, position: 'absolute', opacity: 0.15 }}
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
                />
            </View>

            {/* 内容层（带动画） */}
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
                    <Image
                        source={{
                            uri: getThumbnailUrl(item.id),
                            headers: { Authorization: `Bearer ${getToken()}` }
                        }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                    />
                )}
            </Animated.View>
        </View>
    );
});

export const CarouselView: React.FC<CarouselViewProps> = ({ isActive }) => {
    const { width: windowWidth } = useWindowDimensions();
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
        const numVisible = windowWidth > 900 ? 3 : (windowWidth > 600 ? 2 : 1);
        const width = windowWidth / numVisible;
        const vWidth = width - (numVisible > 1 ? 16 : 32); // 多列时间距小一点
        // 高度计算：增加多列模式下的高度，确保比例协调。单列维持较高比例。
        const vHeight = numVisible > 1 ? Math.min(vWidth * 1.3, 500) : vWidth * 1.45;
        return {
            itemWidth: width,
            visualWidth: vWidth,
            itemHeight: vHeight,
            numVisibleItems: numVisible
        };
    }, [windowWidth]);

    // 移除共享 Player，改为 CarouselItem 内部管理
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
        try {
            let res: any = { files: [] };
            const commonOptions = { limit: 30, random: true, excludeMediaType: 'audio' };

            if (carouselConfig.sourceType === 'all') {
                // 1. 先尝试加载本地缓存以快速显示
                const cached = await getCachedFiles({ limit: 10 });
                if (cached.length > 0) {
                    const filteredCached = cached.filter((f: MediaItem) => f.mediaType !== 'audio');
                    processData(filteredCached);
                }
                res = await fetchFiles(commonOptions);
                // 2. 成功获取线上数据后保存至缓存
                if (res.files && res.files.length > 0) {
                    await saveMediaItems(res.files, 'root');
                }
            } else if (carouselConfig.sourceType === 'folder' && carouselConfig.sourceValue) {
                // 针对特定文件夹，也尝试读取缓存
                const cached = await getCachedFiles({ folderPath: carouselConfig.sourceValue, limit: 10 });
                if (cached.length > 0) {
                    processData(cached);
                }
                res = await fetchFiles({ ...commonOptions, folderPath: carouselConfig.sourceValue, recursive: true });
                if (res.files && res.files.length > 0) {
                    await saveMediaItems(res.files, carouselConfig.sourceValue);
                }
            } else if (carouselConfig.sourceType === 'favorites') {
                const cached = await getCachedFiles({ favorite: true, limit: 10 });
                if (cached.length > 0) {
                    processData(cached);
                }
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

            const filteredFiles = (res.files || []).filter((f: MediaItem) => f.mediaType !== 'audio');

            // If a specific file is selected, handle it (context logic previously there)
            if (carouselConfig.sourceType === 'file' && carouselConfig.sourceValue) {
                const targetID = carouselConfig.sourceValue;
                const targetFile = filteredFiles.find((f: MediaItem) => f.id === targetID);
                processData(targetFile ? [targetFile] : []);
            } else {
                processData(filteredFiles);
            }
        } catch (e) {
            console.error(e);
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
            // Only set activeIndex if not currently interacting or already set
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
        // 使用更稳健的索引计算，避免亚像素误差
        const index = Math.round(offsetX / itemWidth);

        if (displayItems.length <= 1) {
            setActiveIndex(index);
            return;
        }

        // 无缝循环逻辑
        if (index <= 0) {
            // 滚动到开头（克隆的最后一项）-> 立即跳向真实的最后一项
            const realLastIndex = displayItems.length - 2;
            flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
            setActiveIndex(realLastIndex);
        } else if (index >= displayItems.length - 1) {
            // 滚动到结尾（克隆的第一项）-> 立即跳向真实的第一项
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

            // 仍然保留第一个作为 activeIndex 用于自动滚动参考
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
            />
        );
    };

    if (displayItems.length === 0) {
        return (
            <View style={{ height: itemHeight, paddingHorizontal: 16 }}>
                <View
                    style={{ width: visualWidth, height: itemHeight }}
                    className="bg-gray-200 dark:bg-zinc-800 rounded-3xl animate-pulse"
                />
            </View>
        );
    }

    return (
        <View style={{ height: itemHeight }}>
            <FlatList
                ref={flatListRef}
                key={`carousel-${numVisibleItems}`} // 布局改变时重建列表
                data={displayItems}
                renderItem={renderItem}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                horizontal
                pagingEnabled={false} // 禁用原生分页，统一使用间隔捕捉
                snapToInterval={itemWidth}
                snapToAlignment="start"
                decelerationRate="fast"
                disableIntervalMomentum={true} // 增强分页感
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
