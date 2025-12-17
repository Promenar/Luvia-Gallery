import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, FlatList, Dimensions, StatusBar, TouchableOpacity, Image, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Music } from 'lucide-react-native';
import { MediaItem } from '../types';
import { getFileUrl, toggleFavorite, fetchExif } from '../utils/api';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { IconButton } from 'react-native-paper';
import { useLanguage } from '../utils/i18n';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Audio } from 'expo-av';

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

// Audio Component Wrapper
const AudioSlide = ({ item, isActive }: { item: MediaItem, isActive: boolean }) => {
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        let currentSound: Audio.Sound | null = null;
        const loadSound = async () => {
            try {
                // Ensure we clean up any previous sound before creating a new one
                if (sound) await sound.unloadAsync();

                const { sound: newSound } = await Audio.Sound.createAsync(
                    { uri: getFileUrl(item.id) },
                    { shouldPlay: isActive, isLooping: true }
                );
                currentSound = newSound;
                setSound(newSound);
                setIsPlaying(isActive);
            } catch (e) {
                console.error("Failed to load sound", e);
            }
        };
        loadSound();
        return () => {
            if (currentSound) currentSound.unloadAsync();
        };
    }, [item.id]);

    useEffect(() => {
        if (sound) {
            if (isActive) {
                sound.playAsync();
                setIsPlaying(true);
            } else {
                sound.pauseAsync();
                setIsPlaying(false);
            }
        }
    }, [isActive, sound]);

    return (
        <View className="w-full h-full justify-center items-center bg-black">
            <View className="w-40 h-40 bg-gray-800 rounded-full items-center justify-center mb-10">
                <Music size={80} color="white" />
            </View>
            <Text className="text-white text-xl font-bold mb-2">{item.name}</Text>
            <Text className="text-gray-400">{isPlaying ? "Playing..." : "Paused"}</Text>
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
    const { t } = useLanguage();
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [showControls, setShowControls] = useState(true);
    const [showInfo, setShowInfo] = useState(false);
    const [exif, setExif] = useState<any>(null);

    // Track favorite state locally for the current item
    const currentItem = items[currentIndex];
    const [isFavorite, setIsFavorite] = useState(currentItem.isFavorite || false);

    useEffect(() => {
        if (items[currentIndex]) {
            const item = items[currentIndex];
            setIsFavorite(item.isFavorite || false);

            // Fetch EXIF if it's an image
            if (item.mediaType === 'image') {
                setExif(null); // Reset first
                fetchExif(item.id).then((data: any) => {
                    if (data) setExif(data);
                });
            } else {
                setExif(null);
            }
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

    // Gesture for Swipe Up
    const pan = Gesture.Pan()
        .activeOffsetY([-20, -20]) // Detect swipe up
        .onEnd((e) => {
            if (e.velocityY < -500) {
                // Swipe Up
                if (!showInfo) {
                    setShowInfo(true);
                }
            } else if (e.velocityY > 500) {
                // Swipe Down
                if (showInfo) {
                    setShowInfo(false);
                } else {
                    onClose();
                }
            }
        })
        .runOnJS(true);

    if (!currentItem) return null;

    return (
        <Modal visible={true} animationType="fade" transparent={false} onRequestClose={onClose}>
            <GestureDetector gesture={pan}>
                <View className="flex-1 bg-black">
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
                                disabled={item.mediaType === 'video' || item.mediaType === 'audio'}
                            >
                                {item.mediaType === 'video' ? (
                                    <VideoSlide item={item} isActive={index === currentIndex} />
                                ) : item.mediaType === 'audio' ? (
                                    <AudioSlide item={item} isActive={index === currentIndex} />
                                ) : (
                                    <ImageSlide item={item} />
                                )}
                            </TouchableOpacity>
                        )}
                    />

                    {/* Top Bar Controls */}
                    {showControls && (
                        <Animated.View
                            entering={FadeIn.duration(200)}
                            exiting={FadeOut.duration(200)}
                            className="absolute top-0 left-0 right-0 z-50 bg-black/60"
                            style={{
                                paddingTop: insets.top,
                                paddingBottom: 8 // Reduced padding to tighten it up
                            }}
                        >
                            <View className="flex-row items-center justify-between px-4">
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
                            entering={SlideInDown.springify().damping(30).mass(0.8)}
                            exiting={SlideOutDown.duration(200)}
                            className="absolute bottom-0 left-0 right-0 bg-black/90 p-6 rounded-t-3xl border-t border-white/10 z-30"
                            style={{ paddingBottom: insets.bottom + 20 }}
                        >
                            <View className="flex-row justify-between items-center mb-4">
                                <Text className="text-white text-lg font-bold">{t('section.details')}</Text>
                                <TouchableOpacity onPress={() => setShowInfo(false)}>
                                    <X color="gray" size={20} />
                                </TouchableOpacity>
                            </View>

                            <View className="gap-3">
                                <View>
                                    <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.file_name')}</Text>
                                    <Text className="text-white text-sm font-medium">{currentItem.name}</Text>
                                </View>
                                <View className="flex-row justify-between">
                                    <View>
                                        <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.date_modified')}</Text>
                                        <Text className="text-white text-sm">{formatDate(currentItem.lastModified)}</Text>
                                    </View>
                                    <View>
                                        <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.size')}</Text>
                                        <Text className="text-white text-sm">{formatSize(currentItem.size)}</Text>
                                    </View>
                                </View>
                                <View>
                                    <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.path')}</Text>
                                    <Text className="text-gray-300 text-xs">{currentItem.path}</Text>
                                </View>

                                {/* EXIF Info */}
                                {exif && (
                                    <View className="flex-row justify-between pt-2 border-t border-white/10 mt-2">
                                        <View>
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">Camera</Text>
                                            <Text className="text-white text-sm">{exif.Model || '--'}</Text>
                                        </View>
                                        <View>
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">ISO</Text>
                                            <Text className="text-white text-sm">{exif.ISO || '--'}</Text>
                                        </View>
                                        <View>
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">Aperture</Text>
                                            <Text className="text-white text-sm">f/{exif.FNumber || '--'}</Text>
                                        </View>
                                    </View>
                                )}
                                {!exif && (
                                    <View className="pt-2 border-t border-white/10 mt-2">
                                        <Text className="text-gray-500 text-xs italic">No EXIF data available</Text>
                                    </View>
                                )}
                            </View>
                        </Animated.View>
                    )}
                </View>
            </GestureDetector>
        </Modal>
    );
};
