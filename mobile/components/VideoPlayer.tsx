import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Dimensions, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getFileUrl } from '../utils/api';
import { MediaItem } from '../types';
import { X } from 'lucide-react-native';

interface VideoPlayerProps {
    item: MediaItem;
    onClose: () => void;
}

const { width, height } = Dimensions.get('window');

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ item, onClose }) => {
    const videoSource = getFileUrl(item.id);

    const player = useVideoPlayer(videoSource, player => {
        player.loop = true;
        player.play();
    });

    return (
        <View className="flex-1 bg-black items-center justify-center relative">
            <TouchableOpacity
                onPress={() => {
                    player.pause();
                    onClose();
                }}
                className="absolute top-10 right-5 z-20 bg-black/50 p-2 rounded-full"
            >
                <X color="white" size={24} />
            </TouchableOpacity>

            <VideoView
                style={{ width: width, height: height * 0.8 }}
                player={player}
                nativeControls
                allowsPictureInPicture
                contentFit="contain"
            />
        </View>
    );
};
