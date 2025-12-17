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
import { Audio, AVPlaybackStatus, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import Slider from '@react-native-community/slider';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react-native';

interface MediaViewerProps {
    items: MediaItem[];
    initialIndex: number;
    onClose: () => void;
    onToggleFavorite: (id: string, isFavorite: boolean) => void;
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
import { useAudio } from '../utils/AudioContext';
import { ChevronDown } from 'lucide-react-native';

const AudioSlide = ({ item, items, isActive }: { item: MediaItem, items: MediaItem[], isActive: boolean }) => {
    const {
        currentTrack,
        isPlaying,
        duration,
        position,
        playTrack,
        togglePlayPause,
        seekTo,
        playlist,
        minimizePlayer
    } = useAudio();

    // We need to trigger play if this slide is active but not playing this track
    useEffect(() => {
        if (isActive) {
            // If context has a track but it's not this one, or context is empty
            if (currentTrack?.id !== item.id) {
                // Pass full playlist
                playTrack(item, items);
            }
        }
    }, [isActive, item.id]);

    const isCurrent = currentTrack?.id === item.id;
    const sliderValue = isCurrent ? position : 0;
    const sliderDuration = isCurrent ? duration : 0;
    const sliderPlaying = isCurrent ? isPlaying : false;

    const [isSeeking, setIsSeeking] = useState(false);
    const [localSeek, setLocalSeek] = useState(0);

    const handleSeek = (val: number) => {
        setIsSeeking(true);
        setLocalSeek(val);
    };

    const handleSeekComplete = async (val: number) => {
        await seekTo(val);
        setIsSeeking(false);
    };

    const formatTime = (millis: number) => {
        if (!millis) return "0:00";
        const totalSeconds = Math.floor(millis / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <View className="w-full h-full justify-center items-center bg-black/90">
            {/* Album Art / Icon */}
            <View className="w-64 h-64 bg-indigo-600 rounded-2xl items-center justify-center mb-12 shadow-2xl elevation-10 border border-white/10">
                <Music size={100} color="white" />
            </View>

            {/* Title */}
            <View className="mb-8 items-center px-8">
                <Text className="text-white text-2xl font-bold text-center mb-2">{item.name}</Text>
                <Text className="text-gray-400 text-sm">Audio Playback</Text>
            </View>

            {/* Progress Bar */}
            <View className="w-full px-8 mb-4">
                <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={0}
                    maximumValue={sliderDuration || 1} // avoid 0 div
                    value={isSeeking ? localSeek : sliderValue}
                    minimumTrackTintColor="#6366f1"
                    maximumTrackTintColor="#4b5563"
                    thumbTintColor="white"
                    onSlidingStart={() => setIsSeeking(true)}
                    onValueChange={handleSeek}
                    onSlidingComplete={handleSeekComplete}
                />
                <View className="flex-row justify-between mt-[-5px]">
                    <Text className="text-gray-400 text-xs">{formatTime(isSeeking ? localSeek : sliderValue)}</Text>
                    <Text className="text-gray-400 text-xs">{formatTime(sliderDuration)}</Text>
                </View>
            </View>

            {/* Controls */}
            <View className="flex-row items-center gap-10">
                <IconButton
                    icon={sliderPlaying ? "pause" : "play"}
                    iconColor="black"
                    containerColor="white"
                    size={40}
                    onPress={togglePlayPause}
                    style={{ margin: 0 }}
                />
            </View>
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

export const MediaViewer: React.FC<MediaViewerProps> = ({ items, initialIndex, onClose, onToggleFavorite }) => {
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const { minimizePlayer } = useAudio();
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
        onToggleFavorite(currentItem.id, newStatus);
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
        <Modal visible={true} animationType="fade" transparent={true} statusBarTranslucent={true} onRequestClose={onClose}>
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
                                    <AudioSlide item={item} items={items} isActive={index === currentIndex} />
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
                            }}
                        >
                            <View className="flex-row items-center justify-between px-4 py-2">
                                <IconButton
                                    icon="arrow-left"
                                    iconColor="white"
                                    size={28}
                                    onPress={onClose}
                                />

                                <View className="flex-row">
                                    {currentItem.mediaType === 'audio' && (
                                        <IconButton
                                            icon="chevron-down"
                                            iconColor="white"
                                            size={28}
                                            onPress={() => {
                                                minimizePlayer();
                                                onClose();
                                            }}
                                        />
                                    )}
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
