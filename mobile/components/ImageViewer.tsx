import React from 'react';
import { View, Image, TouchableOpacity, Text, Dimensions } from 'react-native';
import { MediaItem } from '../types';
import { getFileUrl } from '../utils/api';
import { X } from 'lucide-react-native';

interface ImageViewerProps {
    item: MediaItem;
    onClose: () => void;
}

const { width, height } = Dimensions.get('window');

export const ImageViewer: React.FC<ImageViewerProps> = ({ item, onClose }) => {
    return (
        <View className="absolute inset-0 bg-black flex-1 items-center justify-center z-50">
            <TouchableOpacity onPress={onClose} className="absolute top-10 right-5 z-10 bg-black/50 p-2 rounded-full">
                <X color="white" size={24} />
            </TouchableOpacity>

            <Image
                source={{ uri: getFileUrl(item.id) }}
                style={{ width, height: height * 0.8 }}
                resizeMode="contain"
            />

            <View className="absolute bottom-10 left-0 right-0 items-center">
                <Text className="text-white text-lg font-bold">{item.name}</Text>
            </View>
        </View>
    );
};
