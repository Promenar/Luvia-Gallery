import React from 'react';
import { View, Image, Pressable, Dimensions, Text } from 'react-native';
import { MediaItem } from '../types';
import { getThumbnailUrl } from '../utils/api';
import { Play, Music, Heart } from 'lucide-react-native';

interface MediaCardProps {
    item: MediaItem;
    onPress: (item: MediaItem) => void;
    onLongPress?: (item: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ item, onPress, onLongPress }) => {
    return (
        <Pressable
            onPress={() => onPress(item)}
            onLongPress={() => onLongPress?.(item)}
            className="w-full"
        >
            <View className="rounded-lg overflow-hidden bg-transparent relative border border-gray-100/50 w-full aspect-square">
                {item.mediaType === 'audio' ? (
                    <View className="w-full h-full bg-indigo-500 items-center justify-center">
                        <Music size={24} color="white" />
                        <View className="absolute bottom-2 left-2 right-2">
                            <Text numberOfLines={1} className="text-white text-[10px] font-medium">{item.name}</Text>
                        </View>
                    </View>
                ) : (
                    <Image
                        source={{ uri: getThumbnailUrl(item.id) }}
                        className="w-full h-full object-cover"
                        resizeMode="cover"
                    />
                )}

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

                {/* Favorite Badge */}
                {item.isFavorite && (
                    <View className="absolute top-1 left-1 bg-white/20 backdrop-blur-md p-1 rounded-full shadow-sm">
                        <Heart size={12} color="#ef4444" fill="#ef4444" />
                    </View>
                )}
            </View>
        </Pressable>
    );
};
