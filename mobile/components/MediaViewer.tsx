import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Modal, FlatList, Dimensions, StatusBar, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { MediaItem } from '../types';
import { getFileUrl, toggleFavorite } from '../utils/api';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { IconButton } from 'react-native-paper';

interface MediaViewerProps {
    items: MediaItem[];
    initialIndex: number;
    onClose: () => void;
}

const { width, height } = Dimensions.get('window');

// Video Component Wrapper
const VideoSlide = ({ item, isActive }: { item: MediaItem, isActive: boolean }) => {
    const url = getFileUrl(item.id);
    const player = useVideoPlayer(url, player => {
        player.loop = true;
    });

    useEffect(() => {
        if (isActive) {
            player.play();
        } else {
            player.pause();
        }
    }, [isActive, player]);

    return (
        <View className="w-full h-full justify-center items-center bg-black">
            <VideoView
                player={player}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                nativeControls={true}
            />
        </View>
    );
};

// Image Component Wrapper
const ImageSlide = ({ item }: { item: MediaItem }) => {
    return (
        <View className="w-full h-full justify-center items-center bg-black">
            <Image
                source={{ uri: getFileUrl(item.id) }}
                className="w-full h-full"
                resizeMode="contain"
            />
        </View>
    );
};

export const MediaViewer: React.FC<MediaViewerProps> = ({ items, initialIndex, onClose }) => {
    const insets = useSafeAreaInsets();
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [showControls, setShowControls] = useState(true);
    const [showInfo, setShowInfo] = useState(false);

    // Track favorite state locally for the current item
    const currentItem = items[currentIndex];
    const [isFavorite, setIsFavorite] = useState(currentItem.isFavorite || false);

    useEffect(() => {
        if (items[currentIndex]) {
            setIsFavorite(items[currentIndex].isFavorite || false);
        }
    }, [currentIndex, items]);

    // Auto-hide controls
    useEffect(() => {
        if (showControls && !showInfo) {
            const timer = setTimeout(() => setShowControls(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [showControls, showInfo]);

    const toggleControls = () => {
        setShowControls(prev => !prev);
        if (showInfo) setShowInfo(false);
    };

    const handleFavorite = async () => {
        const newStatus = !isFavorite;
        setIsFavorite(newStatus);
        currentItem.isFavorite = newStatus;
        await toggleFavorite(currentItem.id, newStatus);
    };

    const handleScroll = useCallback((event: any) => {
        const slideSize = event.nativeEvent.layoutMeasurement.width;
        const index = event.nativeEvent.contentOffset.x / slideSize;
        const roundIndex = Math.round(index);
        if (roundIndex !== currentIndex) {
            setCurrentIndex(roundIndex);
        }
    }, [currentIndex]);

    // Format utility
    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString();
    };

    if (!currentItem) return null;

    return (
        <Modal visible={true} animationType="fade" transparent={false} onRequestClose={onClose}>
            <View className="flex-1 bg-black">
                {/* Immersive Status Bar - Transparent to show content behind */}
                <StatusBar
                    hidden={!showControls}
                    barStyle="light-content"
                    backgroundColor="transparent"
                    translucent={true}
                />

                {/* Main Content List */}
                <FlatList
                    data={items}
                    keyExtractor={item => item.id}
                    horizontal
                    pagingEnabled
                    initialScrollIndex={initialIndex}
                    getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleScroll}
                    renderItem={({ item, index }) => (
                        <TouchableOpacity
                            activeOpacity={1}
                            onPress={toggleControls}
                            style={{ width, height }}
                            disabled={item.mediaType === 'video'}
                        >
                            {item.mediaType === 'video' ? (
                                <VideoSlide item={item} isActive={index === currentIndex} />
                            ) : (
                                <ImageSlide item={item} />
                            )}
                        </TouchableOpacity>
                    )}
                />

                {/* Invisible Top Trigger Zone for showing controls */}
                {!showControls && (
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={() => setShowControls(true)}
                        className="absolute top-0 left-0 right-0 h-24 z-10"
                    />
                )}

                {/* Top Bar Controls - ABSOLUTE POSITIONED AT TOP 0 */}
                {/* Fixed Manual Layout to Prevent Gaps */}
                {showControls && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(200)}
                        className="absolute top-0 left-0 right-0 z-50 bg-black/40"
                        style={{
                            paddingTop: insets.top,
                            height: insets.top + 60, // Fixed height ensuring coverage
                        }}
                    >
                        <View className="flex-1 flex-row items-center justify-between px-2 h-full">
                            <IconButton
                                icon="arrow-left"
                                iconColor="white"
                                size={28}
                                onPress={onClose}
                            />

                            <View className="flex-row">
                                <IconButton
                                    icon={isFavorite ? "heart" : "heart-outline"}
                                    iconColor={isFavorite ? "#ef4444" : "white"}
                                    size={28}
                                    onPress={handleFavorite}
                                />
                                <IconButton
                                    icon="information-outline"
                                    iconColor="white"
                                    size={28}
                                    onPress={() => setShowInfo(!showInfo)}
                                />
                            </View>
                        </View>
                    </Animated.View>
                )}

                {/* Info Overlay */}
                {showInfo && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(200)}
                        className="absolute bottom-0 left-0 right-0 bg-black/90 p-6 rounded-t-3xl border-t border-white/10 z-30"
                        style={{ paddingBottom: insets.bottom + 20 }}
                    >
                        <View className="flex-row justify-between items-center mb-4">
                            <Text className="text-white text-lg font-bold">Details</Text>
                            <TouchableOpacity onPress={() => setShowInfo(false)}>
                                <X color="gray" size={20} />
                            </TouchableOpacity>
                        </View>

                        <View className="gap-3">
                            <View>
                                <Text className="text-gray-400 text-xs uppercase tracking-wider">Filename</Text>
                                <Text className="text-white text-sm font-medium">{currentItem.name}</Text>
                            </View>
                            <View className="flex-row justify-between">
                                <View>
                                    <Text className="text-gray-400 text-xs uppercase tracking-wider">Date Modified</Text>
                                    <Text className="text-white text-sm">{formatDate(currentItem.lastModified)}</Text>
                                </View>
                                <View>
                                    <Text className="text-gray-400 text-xs uppercase tracking-wider">Size</Text>
                                    <Text className="text-white text-sm">{formatSize(currentItem.size)}</Text>
                                </View>
                            </View>
                            <View>
                                <Text className="text-gray-400 text-xs uppercase tracking-wider">Path</Text>
                                <Text className="text-gray-300 text-xs">{currentItem.path}</Text>
                            </View>
                        </View>
                    </Animated.View>
                )}
            </View>
        </Modal>
    );
};
