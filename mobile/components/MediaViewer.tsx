import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, FlatList, Dimensions, StatusBar, TouchableOpacity, Image, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Music } from 'lucide-react-native';
import { MediaItem } from '../types';
import { getFileUrl, toggleFavorite, fetchExif } from '../utils/api';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { IconButton } from 'react-native-paper';
import { useLanguage } from '../utils/i18n';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useAudio } from '../utils/AudioContext';

interface MediaViewerProps {
    items: MediaItem[];
    initialIndex: number;
    onClose: () => void;
    onToggleFavorite: (id: string, isFavorite: boolean) => void;
}

const { width, height } = Dimensions.get('window');

// Video Component Wrapper
const VideoSlide = ({ item, isActive, showControls, onToggleControls }: { item: MediaItem, isActive: boolean, showControls: boolean, onToggleControls: () => void }) => {
    const url = getFileUrl(item.id);
    const player = useVideoPlayer(url, player => {
        player.loop = true;
    });

    const [isPlaying, setIsPlaying] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (isActive) {
            player.play();
            setIsPlaying(true);
        } else {
            player.pause();
            setIsPlaying(false);
        }
    }, [isActive, player]);

    // Track status
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(player.currentTime * 1000);
            setDuration(player.duration * 1000);
            setIsPlaying(player.playing);
        }, 250);
        return () => clearInterval(interval);
    }, [player]);

    const formatTime = (millis: number) => {
        if (!millis || millis < 0) return "0:00";
        const totalSeconds = Math.floor(millis / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    const handleTogglePlay = () => {
        if (player.playing) {
            player.pause();
            setIsPlaying(false);
        } else {
            player.play();
            setIsPlaying(true);
        }
    };

    return (
        <View className="w-full h-full justify-center items-center bg-black">
            <Pressable onPress={onToggleControls} className="w-full h-full">
                <VideoView
                    player={player}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                    nativeControls={false}
                />
            </Pressable>

            {/* Custom Video Controls Overlay */}
            {showControls && (
                <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(200)}
                    className="absolute inset-0 z-40 justify-center items-center"
                    pointerEvents="box-none"
                >
                    <TouchableOpacity
                        onPress={handleTogglePlay}
                        className="w-20 h-20 bg-black/40 rounded-full items-center justify-center border border-white/10"
                    >
                        {isPlaying ? <Pause color="white" size={40} fill="white" /> : <Play color="white" size={40} fill="white" />}
                    </TouchableOpacity>

                    <View className="absolute bottom-10 left-0 right-0 px-6" style={{ paddingBottom: 20 }}>
                        <View className="bg-black/60 p-4 rounded-2xl border border-white/10 blur-xl">
                            <Slider
                                style={{ width: '100%', height: 30 }}
                                minimumValue={0}
                                maximumValue={duration || 1}
                                value={currentTime}
                                minimumTrackTintColor="#6366f1"
                                maximumTrackTintColor="#374151"
                                thumbTintColor="white"
                                onSlidingComplete={(val) => {
                                    player.currentTime = val / 1000;
                                }}
                            />
                            <View className="flex-row justify-between pt-1">
                                <Text className="text-white/60 text-xs font-medium">{formatTime(currentTime)}</Text>
                                <Text className="text-white/60 text-xs font-medium">{formatTime(duration)}</Text>
                            </View>
                        </View>
                    </View>
                </Animated.View>
            )}
        </View>
    );
};

// Audio Component Wrapper
const AudioSlide = ({ item, items, isActive, showControls, onToggleControls }: { item: MediaItem, items: MediaItem[], isActive: boolean, showControls: boolean, onToggleControls: () => void }) => {
    const {
        currentTrack,
        isPlaying,
        duration,
        position,
        playTrack,
        playNext,
        playPrevious,
        togglePlayPause,
        seekTo,
    } = useAudio();

    const [isSeeking, setIsSeeking] = useState(false);
    const [localSeek, setLocalSeek] = useState(0);

    useEffect(() => {
        if (isActive) {
            if (currentTrack?.id !== item.id) {
                playTrack(item, items);
            }
        }
    }, [isActive, item.id, currentTrack?.id]);

    const isCurrent = currentTrack?.id === item.id;
    const sliderValue = (isCurrent && !isSeeking) ? position : (isSeeking ? localSeek : 0);
    const sliderDuration = isCurrent ? duration : 0;
    const sliderPlaying = isCurrent ? isPlaying : false;

    const handleSeek = (val: number) => {
        setIsSeeking(true);
        setLocalSeek(val);
    };

    const handleSeekComplete = async (val: number) => {
        await seekTo(val);
        setIsSeeking(false);
    };

    const formatTime = (millis: number) => {
        if (!millis || millis < 0) return "0:00";
        const totalSeconds = Math.floor(millis / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    const thumbUrl = getFileUrl(item.id);

    return (
        <View className="w-full h-full bg-black">
            <Pressable onPress={onToggleControls} className="flex-1">
                {/* Immersive Background */}
                <View className="absolute inset-0 overflow-hidden">
                    <Image
                        source={{ uri: thumbUrl }}
                        className="w-full h-full opacity-60"
                        blurRadius={Platform.OS === 'ios' ? 0 : 50}
                    />
                    {Platform.OS === 'ios' && (
                        <BlurView intensity={80} tint="dark" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                    )}
                    <View className="absolute inset-0 bg-black/40" />
                </View>

                {/* Content */}
                <View className="flex-1 justify-center items-center px-8">
                    {/* Album Art / Card */}
                    <Animated.View
                        entering={FadeIn.delay(200).duration(800)}
                        className="w-72 h-72 bg-white/5 rounded-3xl items-center justify-center mb-12 shadow-2xl border border-white/10"
                        style={{
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 20 },
                            shadowOpacity: 0.5,
                            shadowRadius: 30,
                        }}
                    >
                        <Music size={120} color="white" strokeWidth={1.5} />
                    </Animated.View>

                    {/* Metadata */}
                    <Animated.View entering={FadeIn.delay(400).duration(600)} className="items-center mb-10">
                        <Text className="text-white text-3xl font-bold text-center mb-2 tracking-tight" numberOfLines={2}>
                            {item.name}
                        </Text>
                        <View className="flex-row items-center bg-white/10 px-3 py-1 rounded-full border border-white/5">
                            <Text className="text-indigo-300 text-xs font-bold uppercase tracking-widest">High Quality Audio</Text>
                        </View>
                    </Animated.View>
                </View>
            </Pressable>

            {/* Glassmorphism Control Panel */}
            <Animated.View
                entering={SlideInDown.springify().damping(25).stiffness(200)}
                className="absolute bottom-12 left-6 right-6"
            >
                <View className="bg-white/10 dark:bg-zinc-900/60 p-6 rounded-[32px] border border-white/20 overflow-hidden">
                    <BlurView intensity={30} tint="dark" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

                    <View className="mb-2">
                        <Slider
                            style={{ width: '100%', height: 40 }}
                            minimumValue={0}
                            maximumValue={sliderDuration || 1}
                            value={sliderValue}
                            minimumTrackTintColor="#818cf8"
                            maximumTrackTintColor="rgba(255,255,255,0.1)"
                            thumbTintColor="white"
                            onValueChange={handleSeek}
                            onSlidingComplete={handleSeekComplete}
                        />
                        <View className="flex-row justify-between px-1">
                            <Text className="text-white/40 text-[10px] font-bold tracking-tighter">{formatTime(sliderValue)}</Text>
                            <Text className="text-white/40 text-[10px] font-bold tracking-tighter">{formatTime(sliderDuration)}</Text>
                        </View>
                    </View>

                    <View className="flex-row items-center justify-center gap-8 py-2">
                        <TouchableOpacity onPress={playPrevious} className="p-2 active:opacity-50">
                            <SkipBack color="white" size={32} fill="white" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={togglePlayPause}
                            className="w-16 h-16 bg-white rounded-full items-center justify-center shadow-xl shadow-indigo-500/50"
                        >
                            {sliderPlaying ? (
                                <Pause color="black" size={32} fill="black" />
                            ) : (
                                <Play color="black" size={32} fill="black" style={{ marginLeft: 4 }} />
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={playNext} className="p-2 active:opacity-50">
                            <SkipForward color="white" size={32} fill="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </Animated.View>
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

    const currentItem = items[currentIndex];
    const [isFavorite, setIsFavorite] = useState(currentItem.isFavorite || false);

    useEffect(() => {
        if (items[currentIndex]) {
            const item = items[currentIndex];
            setIsFavorite(item.isFavorite || false);

            if (item.mediaType === 'image') {
                setExif(null);
                fetchExif(item.id).then((data: any) => {
                    if (data) setExif(data);
                });
            } else {
                setExif(null);
            }
        }
    }, [currentIndex, items]);

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

    const pan = Gesture.Pan()
        .activeOffsetY([-20, -20])
        .onEnd((e) => {
            if (e.velocityY < -500) {
                if (!showInfo) setShowInfo(true);
            } else if (e.velocityY > 500) {
                if (showInfo) setShowInfo(false);
                else onClose();
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
                                    <VideoSlide
                                        item={item}
                                        isActive={index === currentIndex}
                                        showControls={showControls}
                                        onToggleControls={toggleControls}
                                    />
                                ) : item.mediaType === 'audio' ? (
                                    <AudioSlide
                                        item={item}
                                        items={items}
                                        isActive={index === currentIndex}
                                        showControls={showControls}
                                        onToggleControls={toggleControls}
                                    />
                                ) : (
                                    <ImageSlide item={item} />
                                )}
                            </TouchableOpacity>
                        )}
                    />

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

                    {showInfo && (
                        <Animated.View
                            entering={SlideInDown.springify().damping(35).stiffness(350).mass(0.8)}
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
