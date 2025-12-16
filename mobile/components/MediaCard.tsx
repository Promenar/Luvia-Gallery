import React from 'react';
import { View, Image, TouchableWithoutFeedback, Dimensions, Text } from 'react-native';
import { MediaItem } from '../types';
import { getThumbnailUrl } from '../utils/api';
import { Play } from 'lucide-react-native';

interface MediaCardProps {
    item: MediaItem;
    onPress: (item: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ item, onPress }) => {
    return (
        <TouchableWithoutFeedback onPress={() => onPress(item)}>
            <View className="rounded-lg overflow-hidden bg-gray-100 relative shadow-sm w-full aspect-square">
                <Image
                    source={{ uri: getThumbnailUrl(item.id) }}
                    className="w-full h-full object-cover"
                    resizeMode="cover"
                // Fade in image?
                />

                {item.mediaType === 'video' && (
                    <View className="absolute inset-0 items-center justify-center bg-black/10">
                        {/* Minimalist Play Icon */}
                        <View className="bg-white/20 backdrop-blur-md p-2 rounded-full border border-white/30 shadow-sm">
                            <Play size={14} color="white" fill="white" />
                        </View>
                        {/* Corner Badge */}
                        <View className="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px]">
                            {/* You can add duration here if available */}
                            <Text className="text-white text-[9px] font-bold tracking-wide">VIDEO</Text>
                        </View>
                    </View>
                )}
            </View>
        </TouchableWithoutFeedback>
    );
};
