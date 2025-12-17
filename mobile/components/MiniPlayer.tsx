import React from 'react';
import { View, Text, TouchableOpacity, ProgressBarAndroid, Platform } from 'react-native';
import { useAudio } from '../utils/AudioContext';
import { IconButton } from 'react-native-paper';
import { Music, Play, Pause, X } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

interface MiniPlayerProps {
    onMaximize?: () => void;
}

export const MiniPlayer = ({ onMaximize }: MiniPlayerProps) => {
    const { currentTrack, isPlaying, togglePlayPause, closePlayer, maximizePlayer, position, duration } = useAudio();

    if (!currentTrack) return null;

    const handleMaximize = () => {
        maximizePlayer();
        if (onMaximize) onMaximize();
    };

    const progress = duration > 0 ? position / duration : 0;

    return (
        <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(300)}
            className="absolute top-6 right-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-full shadow-sm border border-gray-200 dark:border-gray-700 z-50 overflow-hidden pr-2"
            style={{ maxWidth: 220 }}
        >
            <View className="absolute bottom-0 left-0 right-0 h-[2px]">
                <View style={{ width: `${progress * 100}%` }} className="h-full bg-indigo-500/50" />
            </View>

            <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleMaximize}
                className="flex-row items-center p-1.5"
            >
                {/* Rotating (?) Icon */}
                <View className="w-9 h-9 bg-indigo-100 dark:bg-indigo-900 rounded-full items-center justify-center mr-2.5">
                    <Music size={16} className="text-indigo-600 dark:text-indigo-300" />
                </View>

                {/* Info (Truncated) */}
                <View className="flex-1 mr-3" style={{ maxWidth: 110 }}>
                    <Text numberOfLines={1} className="text-gray-900 dark:text-white font-bold text-xs">
                        {currentTrack.name}
                    </Text>
                </View>

                {/* Controls */}
                <View className="flex-row items-center">
                    <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); togglePlayPause(); }}
                        className="p-1.5"
                    >
                        {isPlaying ?
                            <Pause size={20} className="text-gray-900 dark:text-white" /> :
                            <Play size={20} className="text-gray-900 dark:text-white" />
                        }
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); closePlayer(); }}
                        className="p-1.5"
                    >
                        <X size={18} className="text-gray-400" />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
};
