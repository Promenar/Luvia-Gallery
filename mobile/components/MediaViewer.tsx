import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Modal, FlatList, Dimensions, StatusBar, TouchableOpacity, Platform, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
const AnimatedExpoImage = Animated.createAnimatedComponent(Image);
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Music } from 'lucide-react-native';
import { MediaItem } from '../types';
import { getFileUrl, toggleFavorite, fetchExif, getThumbnailUrl } from '../utils/api';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
    FadeIn,
    FadeOut,
    SlideInDown,
    SlideOutDown,
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS
} from 'react-native-reanimated';
import { IconButton } from 'react-native-paper';
import { useLanguage } from '../utils/i18n';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import { Play, Pause, SkipBack, SkipForward, RotateCw, PlayCircle, StopCircle } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useAudio } from '../utils/AudioContext';
import * as ScreenOrientation from 'expo-screen-orientation';
import { createDownloadResumable, cacheDirectory, deleteAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useToast } from '../utils/ToastContext';

interface MediaViewerProps {
    items: MediaItem[];
    initialIndex: number;
    onClose: () => void;
    onToggleFavorite: (id: string, isFavorite: boolean) => void;
}



// Video Component Wrapper
const VideoSlide = ({
    item,
    isActive,
    player,
    showControls,
    onToggleControls,
    onToggleOrientation
}: {
    item: MediaItem,
    isActive: boolean,
    player: any,
    showControls: boolean,
    onToggleControls: () => void,
    onToggleOrientation: () => void
}) => {
    const thumbUrl = getThumbnailUrl(item.id);

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
            {/* Placeholder remains while loading or inactive */}
            <Image
                source={{ uri: thumbUrl }}
                className="absolute inset-0 w-full h-full opacity-50"
                contentFit="contain"
                blurRadius={Platform.OS === 'ios' ? 0 : 10}
            />

            <Pressable onPress={onToggleControls} className="w-full h-full">
                {isActive && (
                    <VideoView
                        player={player}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="contain"
                        nativeControls={false}
                    />
                )}
            </Pressable>

            {/* Custom Video Controls Overlay */}
            {showControls && (
                <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(200)}
                    className="absolute bottom-10 left-0 right-0 px-6 z-40"
                    pointerEvents="box-none"
                    style={{ paddingBottom: 20 }}
                >
                    <View className="bg-black/60 p-4 rounded-3xl border border-white/10 flex-row items-center gap-3">
                        <TouchableOpacity onPress={handleTogglePlay} className="p-1">
                            {isPlaying ? <Pause color="white" size={24} fill="white" /> : <Play color="white" size={24} fill="white" />}
                        </TouchableOpacity>

                        <Text className="text-white/60 text-[10px] font-medium w-10 text-center">{formatTime(currentTime)}</Text>

                        <Slider
                            style={{ flex: 1, height: 30 }}
                            minimumValue={0}
                            maximumValue={duration || 1}
                            value={currentTime}
                            minimumTrackTintColor="#6366f1"
                            maximumTrackTintColor="#374151"
                            thumbTintColor="white"
                            onSlidingComplete={(val) => {
                                if (player) {
                                    player.currentTime = val / 1000;
                                }
                            }}
                        />

                        <Text className="text-white/60 text-[10px] font-medium w-10 text-center">{formatTime(duration)}</Text>

                        <TouchableOpacity onPress={onToggleOrientation} className="p-1">
                            <RotateCw color="white" size={20} />
                        </TouchableOpacity>
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
                        contentFit="cover"
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

// Image Component Wrapper with Zoom Gestures
const ImageSlide = ({
    item,
    onZoomChange,
    onToggleControls,
    width,
    height
}: {
    item: MediaItem,
    onZoomChange: (isZoomed: boolean) => void,
    onToggleControls: () => void,
    width: number,
    height: number
}) => {
    const [loaded, setLoaded] = useState(false);

    // Animated values
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const focalX = useSharedValue(0);
    const focalY = useSharedValue(0);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const lastTranslateX = useSharedValue(0);
    const lastTranslateY = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    // Simplified zoom state sync
    const lastZoomed = useRef(false);
    const syncZoomState = (zoomed: boolean) => {
        if (lastZoomed.current !== zoomed) {
            lastZoomed.current = zoomed;
            onZoomChange(zoomed);
        }
    };

    // Pinch Gesture
    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            savedScale.value = scale.value;
        })
        .onUpdate((e) => {
            scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
            runOnJS(syncZoomState)(scale.value > 1.05);
        })
        .onEnd(() => {
            if (scale.value < 1.1) {
                scale.value = withSpring(1);
                translateX.value = withSpring(0);
                translateY.value = withSpring(0);
                runOnJS(syncZoomState)(false);
            }
            savedScale.value = scale.value;
        });

    // Double Tap Gesture
    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd((e) => {
            if (scale.value > 1.1) {
                scale.value = withSpring(1);
                translateX.value = withSpring(0);
                translateY.value = withSpring(0);
                runOnJS(syncZoomState)(false);
            } else {
                scale.value = withSpring(3);
                // Center the zoomed area roughly
                translateX.value = withSpring((width / 2 - e.x) * 2);
                translateY.value = withSpring((height / 2 - e.y) * 2);
                runOnJS(syncZoomState)(true);
            }
        });

    // Single Tap Gesture (for toggling controls)
    const singleTapGesture = Gesture.Tap()
        .numberOfTaps(1)
        .maxDeltaX(10) // Fail if finger moves too much (swipe)
        .onEnd(() => {
            runOnJS(onToggleControls)();
        });

    // Pan Gesture (only when zoomed)
    const panGesture = Gesture.Pan()
        .enabled(true) // Always enabled to allow checks
        .onStart(() => {
            lastTranslateX.value = translateX.value;
            lastTranslateY.value = translateY.value;
        })
        .onUpdate((e) => {
            if (scale.value > 1.05) {
                translateX.value = lastTranslateX.value + e.translationX;
                translateY.value = lastTranslateY.value + e.translationY;
            }
        })
        .activeOffsetX([-20, 20]) // Start pan only after small movement
        .averageTouches(true);

    const composed = Gesture.Simultaneous(
        pinchGesture,
        panGesture,
        Gesture.Exclusive(doubleTapGesture, singleTapGesture)
    );

    return (
        <GestureDetector gesture={composed}>
            <View style={{ width, height }} className="justify-center items-center bg-black overflow-hidden">
                {/* Low-res placeholder */}
                {!loaded && (
                    <Image
                        source={{ uri: getThumbnailUrl(item.id) }}
                        className="absolute inset-0 w-full h-full opacity-50"
                        contentFit="contain"
                        blurRadius={5}
                    />
                )}
                <AnimatedExpoImage
                    source={{ uri: getFileUrl(item.id) }}
                    style={[{ width, height }, animatedStyle]}
                    contentFit="contain"
                    onLoad={() => setLoaded(true)}
                    transition={200}
                />
            </View>
        </GestureDetector>
    );
};

export const MediaViewer: React.FC<MediaViewerProps> = ({ items, initialIndex, onClose, onToggleFavorite }) => {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();
    const { minimizePlayer } = useAudio();
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [showControls, setShowControls] = useState(true);
    const [showInfo, setShowInfo] = useState(false);
    const [exif, setExif] = useState<any>(null);
    const [networkSpeed, setNetworkSpeed] = useState<string>('--');
    const [bitrate, setBitrate] = useState<string>('--');
    const [isZoomed, setIsZoomed] = useState(false);
    const [isSlideshowActive, setIsSlideshowActive] = useState(false);
    const flatListRef = useRef<FlatList>(null);

    // Sync scroll on width change or index change (Slideshow)
    useEffect(() => {
        if (flatListRef.current && items.length > 0) {
            flatListRef.current.scrollToIndex({
                index: currentIndex,
                animated: true // Always animate for smooth slideshow
            });
        }
    }, [width, currentIndex]);

    // Orientation Logic
    useEffect(() => {
        // Unlock orientation on mount to allow auto-rotate (if system setting allows)
        ScreenOrientation.unlockAsync().catch(e => console.error(e));

        return () => {
            // Re-lock to portrait on close
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(e => console.error(e));
        };
    }, []);

    const toggleOrientation = async () => {
        const orientation = await ScreenOrientation.getOrientationAsync();
        if (orientation === ScreenOrientation.Orientation.PORTRAIT_UP || orientation === ScreenOrientation.Orientation.PORTRAIT_DOWN) {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
        } else {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
    };

    // Single Player Architecture
    const player = useVideoPlayer('', p => {
        p.loop = true;
        p.muted = false;
    });

    const currentItem = items[currentIndex];
    const [isFavorite, setIsFavorite] = useState(currentItem.isFavorite || false);

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (items[currentIndex]) {
            const item = items[currentIndex];
            setIsFavorite(item.isFavorite || false);

            if (item.mediaType === 'video') {
                // Calculate Static Bitrate
                const updateBitrate = () => {
                    try {
                        if (item.size && player && player.duration) {
                            const kbps = Math.round((item.size * 8) / (player.duration * 1024));
                            setBitrate(`${kbps} kbps`);
                        } else if (item.size) {
                            setBitrate('Calculating...');
                        }
                    } catch (e) {
                        console.log('Update bitrate error (safe to ignore during transition):', e);
                    }
                };

                player.replaceAsync(getFileUrl(item.id)).then(() => {
                    player.play();
                    // Double check play state after a short delay
                    setTimeout(() => {
                        if (!player.playing) player.play();
                    }, 100);
                    // Update again once loaded
                    timer = setTimeout(updateBitrate, 1000);
                }).catch(e => console.error('Video load error:', e));
                updateBitrate();
            } else {
                player.pause();
                setBitrate('--');
            }

            if (item.mediaType === 'image' || item.mediaType === 'video') {
                setExif(null);
                fetchExif(item.id).then((data: any) => {
                    if (data) setExif(data);
                });
            } else {
                setExif(null);
            }
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [currentIndex, items, player]);

    // Slideshow Logic
    useEffect(() => {
        if (!isSlideshowActive) {
            // Ensure loop is enabled by default when not in slideshow
            if (player) player.loop = true;
            return;
        }

        const current = items[currentIndex];
        if (!current) return;

        let timer: NodeJS.Timeout;

        if (current.mediaType === 'video') {
            // For video, wait for end
            if (player) {
                try {
                    player.loop = false;
                    const subscription = player.addListener('playToEnd', () => {
                        setCurrentIndex(prev => (prev + 1) % items.length);
                    });
                    return () => {
                        try {
                            subscription.remove();
                            // Only attempt to reset loop if player is still valid
                            player.loop = true;
                        } catch (e) {
                            // Player likely released, safe to ignore during unmount
                        }
                    };
                } catch (e) {
                    console.log('Error configuring video player for slideshow:', e);
                }
            }
        } else {
            // For images/audio, wait 5 seconds
            timer = setTimeout(() => {
                setCurrentIndex(prev => (prev + 1) % items.length);
            }, 5000);
        }

        return () => clearTimeout(timer);
    }, [isSlideshowActive, currentIndex, items, player]);

    // Speed Detection Logic
    useEffect(() => {
        let isCancelled = false;
        const measureSpeed = async () => {
            try {
                const startTime = Date.now();
                // Fetch a small chunk (cached or head) to probe
                const response = await fetch(getFileUrl(items[currentIndex].id), {
                    headers: { 'Range': 'bytes=0-102400' } // 100KB probe
                });
                await response.blob();
                const endTime = Date.now();
                const duration = Math.max(endTime - startTime, 1);
                const bps = (100 * 1024 * 8) / (duration / 1000); // bits per second
                const mbps = (bps / 1000000).toFixed(2);
                if (!isCancelled) setNetworkSpeed(`${mbps} Mbps`);
            } catch (e) {
                if (!isCancelled) setNetworkSpeed('Error');
            }
        };

        if (showInfo) {
            measureSpeed();
            const interval = setInterval(measureSpeed, 5000);
            return () => {
                isCancelled = true;
                clearInterval(interval);
            };
        }
    }, [showInfo, currentIndex]);

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

    const { showToast, hideToast } = useToast();
    const [isDownloading, setIsDownloading] = useState(false);
    const downloadResumableRef = useRef<any>(null);

    const handleDownload = async () => {
        if (isDownloading) return;

        try {
            // 1. Request Permission with extreme caution
            try {
                const { status } = await MediaLibrary.requestPermissionsAsync(true);
                if (status !== 'granted') {
                    // If denied but not crashed, we still try sharing as a fallback later 
                    // or we can prompt here. For now, let's proceed to see if we can at least download.
                    console.log('Permission not granted, will attempt sharing fallback if save fails');
                }
            } catch (permError) {
                console.warn('Permission request crashed:', permError);
                // If the request itself crashes (like the user is seeing), we just continue
                // and let the save logic handle the fallback to Sharing.
            }

            setIsDownloading(true);

            // 2. Prepare Download
            const fileUrl = getFileUrl(currentItem.id);
            const fileName = currentItem.name;
            const fileUri = `${cacheDirectory}${fileName}`;

            // 3. Download with Progress Support & Cancellation
            downloadResumableRef.current = createDownloadResumable(
                fileUrl,
                fileUri,
                {},
                (downloadProgress) => {
                    const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                    showToast(t('common.downloading') || 'Downloading...', 'progress', progress * 100, async () => {
                        if (downloadResumableRef.current) {
                            try {
                                await downloadResumableRef.current.cancelAsync();
                            } catch (cancelErr) {
                                console.log('Cancel ignored:', cancelErr);
                            }
                            setIsDownloading(false);
                            hideToast();
                        }
                    });
                }
            );

            const downloadRes = await downloadResumableRef.current.downloadAsync();

            if (!downloadRes || downloadRes.status !== 200) {
                throw new Error('Download failed');
            }

            // 4. Save to Media Library
            try {
                await MediaLibrary.createAssetAsync(downloadRes.uri);
                hideToast(); // Remove progress toast
                showToast(t('common.download_success') || 'Media saved to gallery', 'success');
            } catch (saveError: any) {
                console.warn('MediaLibrary save failed, falling back to sharing:', saveError);
                hideToast();
                const isSharingAvailable = await Sharing.isAvailableAsync();
                if (isSharingAvailable) {
                    await Sharing.shareAsync(downloadRes.uri);
                } else {
                    throw saveError;
                }
            }
            // 5. Cleanup
            await deleteAsync(downloadRes.uri, { idempotent: true });
        } catch (e: any) {
            // Silence if user cancelled - also catch generic "Download failed" from our throw
            const errorMsg = e.message?.toLowerCase() || '';
            const isCancelled = errorMsg.includes('cancel') || errorMsg.includes('cancelled') || errorMsg.includes('download failed');

            if (!isCancelled) {
                console.error('Download error:', e);
                showToast(t('common.download_failed') || 'Failed to download media', 'error');
            } else {
                // If cancelled, reset state silently and ensure no residual toast
                setIsDownloading(false);
                hideToast();
            }
        } finally {
            setIsDownloading(false);
        }
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
        .activeOffsetY(30)
        .failOffsetX([-50, 50])
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
        <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(300)}
            style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'black',
                elevation: 20, // Android Physical Stacking
            }}
        >
            <GestureHandlerRootView style={{ flex: 1 }}>
                <GestureDetector gesture={pan}>
                    <View className="flex-1 bg-black">
                        <StatusBar
                            barStyle="light-content"
                            backgroundColor="transparent"
                            translucent={true}
                        />

                        <FlatList
                            ref={flatListRef}
                            data={items}
                            keyExtractor={item => item.id}
                            horizontal
                            pagingEnabled
                            scrollEnabled={!isZoomed}
                            initialScrollIndex={initialIndex}
                            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                            showsHorizontalScrollIndicator={false}
                            onMomentumScrollEnd={handleScroll}
                            windowSize={3}
                            removeClippedSubviews={true}
                            initialNumToRender={1}
                            maxToRenderPerBatch={1}
                            renderItem={({ item, index }) => (
                                <View style={{ width, height }}>
                                    {item.mediaType === 'video' ? (
                                        <VideoSlide
                                            item={item}
                                            isActive={index === currentIndex}
                                            player={player}
                                            showControls={showControls}
                                            onToggleControls={toggleControls}
                                            onToggleOrientation={toggleOrientation}
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
                                        <ImageSlide
                                            item={item}
                                            width={width}
                                            height={height}
                                            onZoomChange={setIsZoomed}
                                            onToggleControls={toggleControls}
                                        />
                                    )}
                                </View>
                            )}
                        />

                        {showControls && (
                            <Animated.View
                                entering={FadeIn.duration(200)}
                                exiting={FadeOut.duration(200)}
                                className="absolute top-0 left-0 right-0 z-[100] bg-black/40"
                                pointerEvents="box-none"
                                style={{
                                    paddingTop: insets.top,
                                }}
                            >
                                <View className="flex-row items-center justify-between px-4 py-3" pointerEvents="box-none">
                                    <View className="flex-row items-center gap-2">
                                        <IconButton
                                            icon="arrow-left"
                                            iconColor="white"
                                            size={28}
                                            onPress={onClose}
                                            style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
                                        />

                                        <View className="flex-row gap-x-1" pointerEvents="box-none">
                                            {currentItem.mediaType === 'audio' && (
                                                <IconButton
                                                    icon="close-circle-outline"
                                                    iconColor="white"
                                                    size={28}
                                                    onPress={() => {
                                                        minimizePlayer();
                                                        onClose();
                                                    }}
                                                    style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
                                                />
                                            )}
                                            <View className="flex-row gap-2">
                                                {/* Slideshow Toggle */}
                                                <IconButton
                                                    icon={({ size, color }) => (
                                                        isSlideshowActive ?
                                                            <StopCircle size={size} color={color} /> :
                                                            <PlayCircle size={size} color={color} />
                                                    )}
                                                    iconColor={isSlideshowActive ? "#818cf8" : "white"}
                                                    size={24}
                                                    onPress={() => {
                                                        setIsSlideshowActive((prev: boolean) => !prev);
                                                        setShowControls(false); // Hide controls when starting
                                                        showToast(!isSlideshowActive ? t('common.slideshow_start') : t('common.slideshow_stop'), 'info');
                                                    }}
                                                    containerColor="rgba(255,255,255,0.1)"
                                                />
                                                <IconButton
                                                    icon={isFavorite ? "heart" : "heart-outline"}
                                                    iconColor={isFavorite ? "#ef4444" : "white"}
                                                    size={28}
                                                    onPress={handleFavorite}
                                                />
                                                <IconButton
                                                    icon={isDownloading ? "sync" : "download-outline"}
                                                    iconColor="white"
                                                    size={28}
                                                    onPress={handleDownload}
                                                    disabled={isDownloading}
                                                    style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
                                                />
                                                <IconButton
                                                    icon="information-outline"
                                                    iconColor="white"
                                                    size={28}
                                                    onPress={() => setShowInfo(!showInfo)}
                                                    style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
                                                />
                                            </View>
                                        </View>
                                    </View>
                                </View>
                            </Animated.View>
                        )}

                        {showInfo && (
                            <Animated.View
                                key="info-panel"
                                entering={SlideInDown.springify().damping(35).stiffness(350).mass(0.8)}
                                exiting={SlideOutDown.duration(200)}
                                className="absolute bottom-0 left-0 right-0 bg-black/90 p-6 rounded-t-3xl border-t border-white/10 z-30"
                                style={{ paddingBottom: insets.bottom + 20, minHeight: 320 }}
                            >
                                <View className="flex-row justify-between items-center mb-4">
                                    <Text className="text-white text-lg font-bold">{t('section.details')}</Text>
                                    <TouchableOpacity onPress={() => setShowInfo(false)}>
                                        <X color="gray" size={20} />
                                    </TouchableOpacity>
                                </View>

                                <View className="gap-3">
                                    <View className="h-10">
                                        <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.file_name')}</Text>
                                        <Text className="text-white text-sm font-medium" numberOfLines={1}>{currentItem.name}</Text>
                                    </View>
                                    <View className="flex-row justify-between h-10">
                                        <View className="flex-1">
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.date_modified')}</Text>
                                            <Text className="text-white text-sm" numberOfLines={1}>{formatDate(currentItem.lastModified)}</Text>
                                        </View>
                                        <View className="flex-1 items-end">
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.size')}</Text>
                                            <Text className="text-white text-sm" numberOfLines={1}>{formatSize(currentItem.size)}</Text>
                                        </View>
                                    </View>
                                    <View className="h-10">
                                        <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.resolution')}</Text>
                                        <Text className="text-white text-sm" numberOfLines={1}>
                                            {(currentItem.mediaType === 'image' || currentItem.mediaType === 'video') && exif ?
                                                `${exif.ExifImageWidth || exif.width || '--'} × ${exif.ExifImageHeight || exif.height || '--'}` :
                                                currentItem.mediaType === 'video' && !exif ?
                                                    "Detecting..." :
                                                    "--"
                                            }
                                        </Text>
                                    </View>
                                    <View>
                                        <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.path')}</Text>
                                        <Text className="text-gray-300 text-xs">{currentItem.path}</Text>
                                    </View>

                                    <View className="flex-row justify-between pt-2 border-t border-white/10 mt-2 h-12">
                                        <View className="flex-1">
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.network_speed')}</Text>
                                            <Text className="text-white text-sm" numberOfLines={1}>{networkSpeed}</Text>
                                        </View>
                                        <View className="flex-1 items-end">
                                            <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.video_bitrate')}</Text>
                                            <Text className="text-white text-sm" numberOfLines={1}>{bitrate}</Text>
                                        </View>
                                    </View>

                                    {exif ? (
                                        <View className="flex-row justify-between pt-2 border-t border-white/10 mt-2 h-12">
                                            <View className="flex-1">
                                                <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.camera')}</Text>
                                                <Text className="text-white text-sm" numberOfLines={1}>{exif.Model || '--'}</Text>
                                            </View>
                                            <View className="flex-1 items-center">
                                                <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.iso')}</Text>
                                                <Text className="text-white text-sm" numberOfLines={1}>{exif.ISO || '--'}</Text>
                                            </View>
                                            <View className="flex-1 items-end">
                                                <Text className="text-gray-400 text-xs uppercase tracking-wider">{t('label.aperture')}</Text>
                                                <Text className="text-white text-sm" numberOfLines={1}>f/{exif.FNumber || '--'}</Text>
                                            </View>
                                        </View>
                                    ) : (
                                        <View className="pt-2 border-t border-white/10 mt-2 h-12 justify-center">
                                            <Text className="text-gray-500 text-xs italic">{t('label.no_exif')}</Text>
                                        </View>
                                    )}
                                </View>
                            </Animated.View>
                        )}
                    </View>
                </GestureDetector>
            </GestureHandlerRootView>
        </Animated.View>
    );
};
